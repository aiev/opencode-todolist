import type { Plugin } from "@opencode/plugin"
import { parseTodoRecord, renderTodos, storageKey, type Todo } from "./todos.js"
import { latestTodosFromMessages } from "./tui-data.js"

const TODO_COMMAND_DESCRIPTION =
  "Show the current session todo list: completed items marked, current task identified. Same list the todowrite/todoread tools manage."

/**
 * Newest completed `todowrite` in the session log wins: `todowrite` replaces the
 * whole list, so the newest completed call IS the current list. The reader is
 * reused from tui-data (the same one the TUI strip relies on), so the command
 * and the strip can never disagree about what the latest list is.
 */
export async function todosFromMessageSources(
  ctx: Plugin.Context,
  sessionID: string,
): Promise<Array<Todo> | undefined> {
  const todos = latestTodosFromMessages(await ctx.session.context({ sessionID }))
  if (todos) return todos
  // Same-plugin storage is the fallback for a log with no completed todowrite.
  // Returns undefined - never [] - when neither source has a list.
  const record = parseTodoRecord(await ctx.storage.get(storageKey(sessionID)))
  return record?.todos
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
  const command = await ctx.command.transform((editor) => {    editor.add({
      name: "todo",
      description: TODO_COMMAND_DESCRIPTION,
      execute: async ({ sessionID, prompt, delivery }) => {
        const todos = (await todosFromMessageSources(ctx, sessionID)) ?? []
        await ctx.session.prompt({
          ...prompt,
          sessionID,
          text: renderTodoReport(todos),
          delivery,
        })
      },
    })
  })
  return { dispose: () => command.dispose() }
}
