import type { Plugin } from "@opencode/plugin"
import { parseTodoRecord, renderTodos, storageKey, type Todo } from "./todos.js"
import { latestTodosFromMessages } from "./tui-data.js"

const TODO_COMMAND_DESCRIPTION =
  "Show the current session todo list: completed items marked, current task identified. Same list the todowrite/todoread tools manage."

/**
 * Plugin storage is authoritative: every `todowrite` writes it synchronously
 * before the call returns, and `todoread` reads it back. That is the "same list
 * the todowrite/todoread tools manage" this command advertises.
 *
 * The message log is a lossy projection of the same data - it is subject to
 * compaction and retention, and its `time` fields can order a write
 * differently. Reading it first lets `/todo` report a stale list whenever the
 * two disagree, which is exactly what happens after a session restart or a
 * compaction boundary.
 *
 * The log is still consulted as a fallback so the command keeps working when
 * storage has no record yet, and so it stays in step with the TUI strip (the
 * strip cannot read plugin storage and relies on the log reader).
 */
export async function todosFromMessageSources(
  ctx: Plugin.Context,
  sessionID: string,
): Promise<Array<Todo> | undefined> {
  const record = parseTodoRecord(await ctx.storage.get(storageKey(sessionID)))
  if (record) return record.todos
  const todos = latestTodosFromMessages(await ctx.session.context({ sessionID }))
  return todos
}

/** On-demand report for /todo: counts, current task, full list. */
export function renderTodoReport(todos: Array<Todo>): string {
  if (todos.length === 0) {
    return "Todo [0/0]: the todo list is empty."
  }
  const done = todos.filter((t) => t.status === "completed").length
  const open = todos.filter((t) => t.status === "pending" || t.status === "in_progress").length
  const current = todos.find((t) => t.status === "in_progress") ?? todos.find((t) => t.status === "pending")
  const currentLine = current
    ? `Current task: ${current.content}`
    : "Current task: none - every item is completed or cancelled."
  return `Todo [${done}/${todos.length}] - ${open} open\n${currentLine}\n${renderTodos(todos)}`
}

/** Registers the `/todo` command. Returns a `{ dispose }` handle for setup teardown. */
export async function registerTodoCommand(
  ctx: Plugin.Context,
): Promise<{ dispose: () => Promise<void> }> {
  const noop = async (): Promise<void> => {}
  if (!ctx.command || typeof ctx.command.transform !== "function") {
    return { dispose: noop }
  }
  const command = await ctx.command.transform((editor) => {
    editor.add({
      name: "todo",
      description: TODO_COMMAND_DESCRIPTION,
      execute: async ({ sessionID, prompt, delivery }) => {
        const todos = await todosFromMessageSources(ctx, sessionID)
        await ctx.session.prompt({
          ...prompt,
          sessionID,
          text: todos ? renderTodoReport(todos) : "No todo list found for this session.",
          delivery,
        })
      },
    })
  })
  return { dispose: () => command.dispose() }
}
