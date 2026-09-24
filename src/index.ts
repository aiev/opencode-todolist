import type { Plugin } from "@opencode/plugin"

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

const STATUS_MARK: Record<TodoStatus, string> = {
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
      if (!hasOpenTodos(todos)) return
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
