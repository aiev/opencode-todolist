import { readFile } from "node:fs/promises"
import { join } from "node:path"
import type { Plugin } from "@opencode/plugin"
import { TODO_PRIORITIES, type Todo, type TodoPriority } from "./todos.js"

/**
 * Config-driven todo injection (opencode-auto-todos parity, serkanalgur).
 *
 * A project opts in with `auto-todos.json` at its root or under
 * `.opencode/`:
 *
 * ```json
 * {
 *   "todos": [{ "content": "Run the test suite", "priority": "high", "order": "first" }],
 *   "deduplicate": true
 * }
 * ```
 *
 * Entry fields: `content` (required), `priority` (optional), `match`
 * (optional: only inject when an existing item contains this string,
 * case-insensitive), `order` (`"first"` or a 0-based index, default append),
 * `always` (default false: inject only when the incoming list is empty).
 *
 * Best-effort throughout: no config file, an unreadable file, or a lookup
 * failure means the model's list passes through untouched.
 */

export type AutoTodoEntry = {
  content: string
  priority?: TodoPriority
  match?: string
  order?: "first" | number
  always?: boolean
}

export type AutoTodosConfig = {
  todos: Array<AutoTodoEntry>
  deduplicate?: boolean
}

/** Returns a clean config or undefined when the value is unusable. */
export function normalizeAutoTodosConfig(value: unknown): AutoTodosConfig | undefined {
  if (value === null || typeof value !== "object") return undefined
  const raw = value as { todos?: unknown; deduplicate?: unknown }
  if (!Array.isArray(raw.todos)) return undefined
  const todos: Array<AutoTodoEntry> = []
  for (const entry of raw.todos) {
    if (entry === null || typeof entry !== "object") continue
    const item = entry as { content?: unknown; priority?: unknown; match?: unknown; order?: unknown; always?: unknown }
    if (typeof item.content !== "string" || !item.content.trim()) continue
    const out: AutoTodoEntry = { content: item.content.trim() }
    if (TODO_PRIORITIES.includes(item.priority as TodoPriority)) {
      out.priority = item.priority as TodoPriority
    }
    if (typeof item.match === "string" && item.match.trim()) {
      out.match = item.match.trim()
    }
    if (item.order === "first" || (typeof item.order === "number" && Number.isInteger(item.order) && item.order >= 0)) {
      out.order = item.order
    }
    if (typeof item.always === "boolean") {
      out.always = item.always
    }
    todos.push(out)
  }
  if (todos.length === 0) return undefined
  const config: AutoTodosConfig = { todos }
  if (typeof raw.deduplicate === "boolean") {
    config.deduplicate = raw.deduplicate
  }
  return config
}

/** Project root first, then `.opencode/`. Never throws. */
export async function readAutoTodosConfig(directory: string): Promise<AutoTodosConfig | undefined> {
  for (const file of [join(directory, "auto-todos.json"), join(directory, ".opencode", "auto-todos.json")]) {
    try {
      const parsed: unknown = JSON.parse(await readFile(file, "utf8"))
      const config = normalizeAutoTodosConfig(parsed)
      if (config) return config
    } catch {
      // Missing, unreadable, or invalid — try the next candidate.
    }
  }
  return undefined
}

function contains(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle.toLowerCase())
}

/**
 * Merges config entries into a validated list. Pure: never mutates inputs.
 * Returns the merged list plus how many entries were injected.
 */
export function applyAutoTodos(
  todos: Array<Todo>,
  config: AutoTodosConfig | undefined,
): { todos: Array<Todo>; injected: number } {
  if (!config || config.todos.length === 0) return { todos, injected: 0 }
  const deduplicate = config.deduplicate ?? true
  const merged = todos.map((t) => ({ ...t }))
  const firsts: Array<Todo> = []
  let injected = 0
  for (const entry of config.todos) {
    if (!entry.always && merged.length > 0) continue
    const seen = [...firsts, ...merged]
    if (entry.match && !seen.some((t) => contains(t.content, entry.match as string))) continue
    if (deduplicate && seen.some((t) => contains(t.content, entry.content) || contains(entry.content, t.content))) {
      continue
    }
    const todo: Todo = { content: entry.content, status: "pending" }
    if (entry.priority) todo.priority = entry.priority
    if (entry.order === "first") {
      firsts.push(todo)
    } else if (typeof entry.order === "number") {
      merged.splice(Math.min(entry.order, merged.length), 0, todo)
    } else {
      merged.push(todo)
    }
    injected++
  }
  return { todos: [...firsts, ...merged], injected }
}

/** The session's working directory via the typed client. Best-effort. */
export async function resolveSessionDirectory(
  ctx: Plugin.Context,
  sessionID: string,
): Promise<string | undefined> {
  const info = await ctx.session.get({ sessionID })
  const directory = info?.location?.directory
  return typeof directory === "string" && directory ? directory : undefined
}

/**
 * Full injection pass for the todowrite path. Returns the list to store:
 * the input unchanged when there is nothing to inject or anything fails.
 */
export async function withAutoTodos(
  ctx: Plugin.Context,
  sessionID: string,
  todos: Array<Todo>,
): Promise<Array<Todo>> {
  try {
    const directory = await resolveSessionDirectory(ctx, sessionID)
    if (!directory) return todos
    const config = await readAutoTodosConfig(directory)
    if (!config) return todos
    return applyAutoTodos(todos, config).todos
  } catch {
    return todos
  }
}
