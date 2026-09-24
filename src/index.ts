import type { Plugin } from "@opencode/plugin"
import {
  TODO_PRIORITIES,
  TODO_STATUSES,
  normalizeTodos,
  parseTodoRecord,
  renderTodos,
  storageKey,
} from "./todos.js"

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
          await ctx.storage.set(storageKey(context.sessionID), { todos, updatedAt: Date.now() })
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
          return { content: `Current todo list:\n${renderTodos(todos)}` }
        },
      })
    })

    const context = await ctx.session.hook("context", async (event) => {
      const record = parseTodoRecord(await ctx.storage.get(storageKey(event.sessionID)))
      const todos = record?.todos ?? []
      if (!todos.some((todo) => todo.status === "pending" || todo.status === "in_progress")) return
      event.system.push({
        type: "text",
        text: [
          "Current todo list for this session:",
          renderTodos(todos),
          "",
          "Keep it current with the todowrite tool as work progresses.",
        ].join("\n"),
      })
    })

    return async () => {
      await context.dispose()
      await tools.dispose()
    }
  },
}

export default plugin
