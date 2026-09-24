export type TodoStatus = "pending" | "in_progress" | "completed" | "cancelled"
export type TodoPriority = "high" | "medium" | "low"

export type Todo = {
  content: string
  status: TodoStatus
  priority?: TodoPriority
}

export type TodoRecord = {
  todos: Array<Todo>
  updatedAt: number
}

export const TODO_STATUSES: ReadonlyArray<TodoStatus> = ["pending", "in_progress", "completed", "cancelled"]
export const TODO_PRIORITIES: ReadonlyArray<TodoPriority> = ["high", "medium", "low"]

export const STORAGE_PREFIX = "todos/"

export const STATUS_MARK: Record<TodoStatus, string> = {
  pending: "[ ]",
  in_progress: "[•]",
  completed: "[x]",
  cancelled: "[-]",
}

export function storageKey(sessionID: string): string {
  return `${STORAGE_PREFIX}${sessionID}`
}

/**
 * Validates a `todowrite` payload. Throws a descriptive error on malformed
 * input so the model can correct itself.
 */
export function normalizeTodos(input: unknown): Array<Todo> {
  if (input === null || typeof input !== "object" || !("todos" in input)) {
    throw new Error("todowrite requires a `todos` array")
  }
  const todos = (input as { todos?: unknown }).todos
  if (!Array.isArray(todos)) {
    throw new Error("`todos` must be an array")
  }
  return todos.map((entry, index) => {
    if (entry === null || typeof entry !== "object") {
      throw new Error(`todo #${index + 1} must be an object`)
    }
    const item = entry as { content?: unknown; status?: unknown; priority?: unknown }
    const content = typeof item.content === "string" ? item.content.trim() : ""
    if (!content) {
      throw new Error(`todo #${index + 1} requires a non-empty \`content\` string`)
    }
    if (!TODO_STATUSES.includes(item.status as TodoStatus)) {
      throw new Error(`todo #${index + 1} has invalid \`status\` (expected one of: ${TODO_STATUSES.join(", ")})`)
    }
    const todo: Todo = { content, status: item.status as TodoStatus }
    if (item.priority !== undefined) {
      if (!TODO_PRIORITIES.includes(item.priority as TodoPriority)) {
        throw new Error(`todo #${index + 1} has invalid \`priority\` (expected one of: ${TODO_PRIORITIES.join(", ")})`)
      }
      todo.priority = item.priority as TodoPriority
    }
    return todo
  })
}

/** Renders a todo list as plain text for tool output and context injection. */
export function renderTodos(todos: Array<Todo>): string {
  if (todos.length === 0) {
    return "(the todo list is empty)"
  }
  return todos
    .map((todo, index) => {
      const priority = todo.priority ? ` — ${todo.priority} priority` : ""
      return `${index + 1}. ${STATUS_MARK[todo.status]} ${todo.content}${priority}`
    })
    .join("\n")
}

/** Reads a stored record defensively; returns undefined when the value is unusable. */
export function parseTodoRecord(value: unknown): TodoRecord | undefined {
  if (value === null || typeof value !== "object") return undefined
  const stored = value as { todos?: unknown; updatedAt?: unknown }
  if (!Array.isArray(stored.todos)) return undefined
  const todos: Array<Todo> = []
  for (const entry of stored.todos) {
    if (entry === null || typeof entry !== "object") continue
    const item = entry as { content?: unknown; status?: unknown; priority?: unknown }
    if (typeof item.content !== "string" || !TODO_STATUSES.includes(item.status as TodoStatus)) continue
    const todo: Todo = { content: item.content, status: item.status as TodoStatus }
    if (TODO_PRIORITIES.includes(item.priority as TodoPriority)) {
      todo.priority = item.priority as TodoPriority
    }
    todos.push(todo)
  }
  return { todos, updatedAt: typeof stored.updatedAt === "number" ? stored.updatedAt : 0 }
}

export function hasOpenTodos(todos: Array<Todo>): boolean {
  return todos.some((todo) => todo.status === "pending" || todo.status === "in_progress")
}
