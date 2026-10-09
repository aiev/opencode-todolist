import type { Plugin } from "@opencode/plugin"
import {
  TODO_PRIORITIES,
  TODO_STATUSES,
  hasOpenTodos,
  normalizeTodos,
  parseTodoRecord,
  renderTodos,
  storageKey,
} from "./todos.js"
import { applyTodoWrite, findItem, itemTimeLabel, timingSummary } from "./timing.js"
import { TODO_SETTINGS_KEY, TodolistRpc, normalizeTodoSettings } from "./rpc.js"

export * from "./todos.js"

const TODOS_INPUT_SCHEMA = {
  type: "object",
  properties: {
    todos: {
      type: "array",
      description: "The complete todo list. This replaces any previous list.",
      items: {
        type: "object",
        properties: {
          content: {
            type: "string",
            description: "Imperative description of the task.",
          },
          status: {
            type: "string",
            enum: [...TODO_STATUSES],
            description: "Current state of the task.",
          },
          priority: {
            type: "string",
            enum: [...TODO_PRIORITIES],
            description: "Optional priority of the task.",
          },
        },
        required: ["content", "status"],
        additionalProperties: false,
      },
    },
  },
  required: ["todos"],
  additionalProperties: false,
}

const TODO_READ_INPUT_SCHEMA = {
  type: "object",
  properties: {},
  additionalProperties: false,
}

const TODOWRITE_DESCRIPTION = [
  "Create or replace the session todo list.",
  "Pass the complete list every time; it replaces any previous one.",
  "Use it to plan multi-step work and keep status current: keep exactly one task in_progress while working on it,",
  "mark tasks completed as soon as they are done, and cancel tasks that are no longer needed.",
  "Prefer short, imperative task descriptions.",
].join(" ")

const TODOREAD_DESCRIPTION =
  "Read the current session todo list. Use it to recover the list after context compaction or to check progress before starting the next task."

/**
 * Injected into `system` while the session has a todo list so the model keeps
 * statuses current as it works instead of batching updates. The text is
 * byte-identical on every request: changing the head of the token stream would
 * invalidate the whole prefix cache.
 */
const UPDATE_REMINDER_TEXT =
  "Keep the session todo list current in the same step: mark finished items completed immediately, never in batch, and set the next item in_progress before starting it."

const plugin: Plugin.Plugin = {
  id: "aiev.todolist",

  async setup(ctx: Plugin.Context) {
    const tools = await ctx.tool.transform((editor) => {
      editor.add({
        name: "todowrite",
        description: TODOWRITE_DESCRIPTION,
        input: TODOS_INPUT_SCHEMA,
        options: { codemode: false },
        execute: async (input, context) => {
          const todos = normalizeTodos(input)
          const at = Date.now()
          const key = storageKey(context.sessionID)
          const previous = parseTodoRecord(await ctx.storage.get(key))
          const timing = applyTodoWrite(previous?.timing, todos, at)
          await ctx.storage.set(key, { todos, updatedAt: at, timing })
          return {
            content: `Todo list updated (${todos.length} ${todos.length === 1 ? "item" : "items"}):\n${renderTodos(todos)}`,
          }
        },
      })

      editor.add({
        name: "todoread",
        description: TODOREAD_DESCRIPTION,
        input: TODO_READ_INPUT_SCHEMA,
        options: { codemode: false },
        execute: async (_input, context) => {
          const record = parseTodoRecord(await ctx.storage.get(storageKey(context.sessionID)))
          const todos = record?.todos ?? []
          const now = Date.now()
          const summary = timingSummary(record?.timing, now)
          const run = record?.timing?.current ?? record?.timing?.last
          const list = renderTodos(todos, (todo) => itemTimeLabel(findItem(run, todo.content), now))
          return { content: `Current todo list${summary ? ` (${summary})` : ""}:\n${list}` }
        },
      })
    })

    let settings = normalizeTodoSettings(await ctx.storage.get(TODO_SETTINGS_KEY))

    const rpc = await ctx.rpc.register(TodolistRpc, {
      getSettings: async () => settings,
      setSettings: async (input) => {
        settings = normalizeTodoSettings(input)
        await ctx.storage.set(TODO_SETTINGS_KEY, settings)
        return settings
      },
    })

    // Rendered notices already sent per session. On tool-driven continuations
    // an unchanged list is skipped so the previous step's tokens stay
    // cacheable. A fresh user turn always gets the notice back: injected
    // messages are not persisted, so the model only ever sees the notice in
    // the request that carries it.
    const injected = new Map<string, string>()

    const context = await ctx.session.hook("context", async (event) => {
      const record = parseTodoRecord(await ctx.storage.get(storageKey(event.sessionID)))

      // Sticky per session: present from the first list onward, including after
      // the last task closes, so the head never changes again for the session.
      if (settings.updateReminders && record) {
        event.system.push({ type: "text", text: UPDATE_REMINDER_TEXT })
      }

      const todos = record?.todos ?? []
      if (!hasOpenTodos(todos)) {
        injected.delete(event.sessionID)
        return
      }

      const text = [
        "Current todo list for this session (automatic context update, not a user request):",
        renderTodos(todos),
        "",
        "Continue the current task and keep this list current with the todowrite tool as work progresses.",
      ].join("\n")

      const last = event.messages.at(-1)
      const freshTurn = last === undefined || last.role === "user"
      if (!freshTurn && injected.get(event.sessionID) === text) return

      // Append the list to the END of the request, not to `system`. The system
      // prompt is the head of the token stream, so the list changing there
      // invalidates the whole prefix / KV cache on every todowrite (and the
      // block vanishing when the last task closes is the largest such change).
      // A trailing message only perturbs the tail, so the conversation prefix
      // stays cacheable. `user` is used because some chat templates reject a
      // system message anywhere but the beginning.
      event.messages.push({
        role: "user",
        content: [{ type: "text", text }],
      })
      injected.set(event.sessionID, text)
    })

    // After a checkpoint the notice is gone from the model's context, so the
    // next request injects it again even when the list did not change.
    const compaction = await ctx.session.hook("compaction", (event) => {
      injected.delete(event.sessionID)
    })

    // Drop the stored list when its session is deleted. Records are tiny, so a
    // startup sweep is unnecessary; the event covers deletions while running.
    const deleted = new AbortController()
    const cleanup = (async () => {
      try {
        for await (const event of ctx.event.subscribe({ signal: deleted.signal })) {
          if (event.type !== "session.deleted") continue
          const sessionID = event.data?.sessionID ?? event.durable?.aggregateID
          if (sessionID) {
            injected.delete(sessionID)
            await ctx.storage.remove(storageKey(sessionID))
          }
        }
      } catch (error) {
        if (!deleted.signal.aborted) {
          console.warn("[aiev.todolist] session.deleted listener stopped:", error)
        }
      }
    })()

    return async () => {
      deleted.abort()
      await cleanup
      await context.dispose()
      await compaction.dispose()
      await rpc.dispose()
      await tools.dispose()
    }
  },
}

export default plugin
