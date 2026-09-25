import { normalizeTodos, type Todo } from "./todos.js"
import type { TodoDisplaySettings } from "./tui-settings.js"

type ToolPart = {
  type?: unknown
  name?: unknown
  state?: { status?: unknown; input?: unknown } | undefined
}

/**
 * Scans session messages for the most recent completed `todowrite` call and
 * returns its normalized list. Used by the TUI strip, which has no access to
 * the plugin storage.
 */
export function latestTodosFromMessages(messages: ReadonlyArray<unknown> | undefined): Array<Todo> | undefined {
  if (!Array.isArray(messages)) return undefined
  let latest: Array<Todo> | undefined
  for (const message of messages) {
    if (message === null || typeof message !== "object") continue
    const content = (message as { content?: unknown }).content
    if (!Array.isArray(content)) continue
    for (const part of content) {
      if (part === null || typeof part !== "object") continue
      const tool = part as ToolPart
      if (tool.type !== "tool" || tool.name !== "todowrite") continue
      if (tool.state?.status !== "completed") continue
      try {
        latest = normalizeTodos(tool.state.input)
      } catch {
        // Keep the previous valid list when a historical call is malformed.
      }
    }
  }
  return latest
}

/**
 * Builds the strip heading: `Todo [done/total] · NN%`, dropping either part
 * according to the display settings and falling back to plain `Todo`.
 */
export function headerLabel(
  todos: ReadonlyArray<Todo>,
  display: Pick<TodoDisplaySettings, "count" | "percent">,
): string {
  const total = todos.length
  const done = todos.filter((todo) => todo.status === "completed").length
  const percent = total === 0 ? 0 : Math.round((done / total) * 100)
  const parts: Array<string> = []
  if (display.count) parts.push(`[${done}/${total}]`)
  if (display.percent) parts.push(`${percent}%`)
  return parts.length === 0 ? "Todo" : `Todo ${parts.join(" · ")}`
}
