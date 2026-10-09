import assert from "node:assert/strict"
import test from "node:test"
import type { Plugin } from "@opencode/plugin"
import { registerTodoCommand, renderTodoReport, todosFromMessageSources } from "../src/todo-command"
import type { Todo } from "../src/todos"

function message(parts: unknown[]) {
  return { content: parts }
}

function tool(name: string, status: string, input: unknown, at?: number) {
  return {
    type: "tool",
    name,
    state: { status, input },
    ...(at === undefined ? {} : { time: { created: at } }),
  }
}

function fakeTodoCtx(messages: unknown[], stored?: unknown) {
  return {
    session: { context: async () => messages, prompt: async () => ({}) },
    storage: { get: async () => stored },
  } as unknown as Plugin.Context
}

test("todosFromMessageSources returns the newest completed todowrite list", async () => {
  const messages = [
    message([tool("todowrite", "completed", { todos: [{ content: "New", status: "in_progress" }] }, 2_000)]),
    message([tool("todowrite", "completed", { todos: [{ content: "Old", status: "pending" }] }, 1_000)]),
  ]
  const todos = await todosFromMessageSources(fakeTodoCtx(messages), "ses_1")
  assert.equal(todos?.length, 1)
  assert.equal(todos?.[0].content, "New")
})

test("todosFromMessageSources returns undefined, never [], when there is no list", async () => {
  const messages = [message([tool("other", "completed", {})])]
  assert.equal(await todosFromMessageSources(fakeTodoCtx(messages), "ses_1"), undefined)
})

test("todosFromMessageSources falls back to same-plugin storage", async () => {
  const stored = { todos: [{ content: "Stored", status: "pending" }], updatedAt: 1 }
  const todos = await todosFromMessageSources(fakeTodoCtx([], stored), "ses_1")
  assert.equal(todos?.[0].content, "Stored")
})

test("renderTodoReport counts completed of total and names the current task", () => {
  const todos: Array<Todo> = [
    { content: "Done", status: "completed" },
    { content: "Doing", status: "in_progress" },
    { content: "Next", status: "pending" },
  ]
  const report = renderTodoReport(todos)
  assert.match(report, /^Todo \[1\/3\] - 2 open/)
  assert.match(report, /Current task: Doing/)
})

test("renderTodoReport on an empty list is distinguishable from a failed read", () => {
  assert.equal(renderTodoReport([]), "Todo [0/0]: the todo list is empty.")
})

test("renderTodoReport says so when nothing is open", () => {
  const todos: Array<Todo> = [{ content: "Done", status: "completed" }]
  assert.match(renderTodoReport(todos), /Current task: none/)
})

test("registerTodoCommand wires /todo to a session prompt", async () => {
  type Added = {
    execute: (args: { sessionID: string; prompt: unknown; delivery: unknown }) => Promise<void>
  }
  const added: Array<Added> = []
  const prompted: unknown[] = []
  const ctx = {
    command: {
      transform: async (callback: (editor: { add: (cmd: Added) => void }) => void) => {
        callback({ add: (cmd: Added) => { added.push(cmd) } })
        return { dispose: async () => {} }
      },
    },
    session: {
      context: async () => [],
      prompt: async (input: unknown) => { prompted.push(input); return {} },
    },
    storage: { get: async () => undefined },
  } as unknown as Plugin.Context
  const registration = await registerTodoCommand(ctx)
  assert.equal(added.length, 1)
  await added[0].execute({ sessionID: "ses_1", prompt: {}, delivery: "steady" })
  assert.equal(prompted.length, 1)
  await registration.dispose()
})

test("registerTodoCommand no-ops when command.transform is absent", async () => {
  const registration = await registerTodoCommand({} as unknown as Plugin.Context)
  await registration.dispose()
})
