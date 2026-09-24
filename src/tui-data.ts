import { normalizeTodos, type Todo } from "./todos.js"

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
