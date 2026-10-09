import assert from "node:assert/strict"
import test from "node:test"
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Plugin } from "@opencode/plugin"
import plugin from "../src/index"
import {
  applyAutoTodos,
  normalizeAutoTodosConfig,
  readAutoTodosConfig,
  type AutoTodosConfig,
} from "../src/auto-todos"
import type { Todo } from "../src/todos"

const T = (content: string, status: Todo["status"] = "pending"): Todo => ({ content, status })

test("normalizeAutoTodosConfig accepts a valid config", () => {
  const config = normalizeAutoTodosConfig({
    todos: [{ content: "Run tests", priority: "high", order: "first", always: true }],
    deduplicate: false,
  })
  assert.deepEqual(config, {
    todos: [{ content: "Run tests", priority: "high", order: "first", always: true }],
    deduplicate: false,
  })
})

test("normalizeAutoTodosConfig drops bad entries, undefined when none valid", () => {
  assert.equal(normalizeAutoTodosConfig({ todos: [{ content: "  " }, null, 7] }), undefined)
  assert.equal(normalizeAutoTodosConfig({}), undefined)
  assert.equal(normalizeAutoTodosConfig(null), undefined)
  const config = normalizeAutoTodosConfig({ todos: [{ content: "Keep", priority: "urgent" }] })
  assert.deepEqual(config?.todos, [{ content: "Keep" }])
})

test("readAutoTodosConfig prefers project root over .opencode/", async () => {
  const dir = mkdtempSync(join(tmpdir(), "auto-todos-"))
  try {
    assert.equal(await readAutoTodosConfig(dir), undefined)
    mkdirSync(join(dir, ".opencode"))
    writeFileSync(join(dir, ".opencode", "auto-todos.json"), JSON.stringify({ todos: [{ content: "Nested" }] }))
    assert.equal((await readAutoTodosConfig(dir))?.todos[0].content, "Nested")
    writeFileSync(join(dir, "auto-todos.json"), JSON.stringify({ todos: [{ content: "Root" }] }))
    assert.equal((await readAutoTodosConfig(dir))?.todos[0].content, "Root")
    writeFileSync(join(dir, "auto-todos.json"), "{ broken")
    assert.equal((await readAutoTodosConfig(dir))?.todos[0].content, "Nested")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("applyAutoTodos injects into an empty list by default", () => {
  const config: AutoTodosConfig = { todos: [{ content: "Version bump" }] }
  const { todos, injected } = applyAutoTodos([], config)
  assert.equal(injected, 1)
  assert.deepEqual(todos, [{ content: "Version bump", status: "pending" }])
})

test("applyAutoTodos skips non-empty lists unless always", () => {
  const config: AutoTodosConfig = { todos: [{ content: "Version bump" }] }
  const { todos, injected } = applyAutoTodos([T("Work")], config)
  assert.equal(injected, 0)
  assert.deepEqual(todos, [T("Work")])
  const always: AutoTodosConfig = { todos: [{ content: "Version bump", always: true }] }
  const second = applyAutoTodos([T("Work")], always)
  assert.equal(second.injected, 1)
  assert.equal(second.todos.length, 2)
})

test("applyAutoTodos deduplicates and honors match + order", () => {
  const config: AutoTodosConfig = {
    todos: [
      { content: "Run tests", order: "first", always: true },
      { content: "Run tests", always: true },
      { content: "Write docs", match: "missing", always: true },
    ],
  }
  const { todos, injected } = applyAutoTodos([T("Write code")], config)
  assert.equal(injected, 1)
  assert.equal(todos[0].content, "Run tests")
})

type ExecTool = { execute: (input: unknown, ctx: unknown) => Promise<{ content?: string }> }

function fakeSetupCtx(directory?: string) {
  const tools = new Map<string, ExecTool>()
  const storage = new Map<string, unknown>()
  const context = {
    tool: {
      transform: async (callback: (editor: { add: (tool: unknown) => void }) => void) => {
        callback({ add: (tool: unknown) => tools.set((tool as { name: string }).name, tool as ExecTool) })
        return { dispose: async () => {} }
      },
    },
    command: { transform: async () => ({ dispose: async () => {} }) },
    session: {
      hook: async () => ({ dispose: async () => {} }),
      prompt: async () => ({}),
      get: async () => (directory ? { location: { directory } } : undefined),
    },
    storage: {
      get: async (key: string) => storage.get(key),
      set: async (key: string, value: unknown) => void storage.set(key, value),
      remove: async (key: string) => void storage.delete(key),
    },
    rpc: {
      register: async () => ({ dispose: async () => {}, events: { emit: async () => {} } }),
    },
    event: { subscribe: async function* () {} },
  } as unknown as Plugin.Context
  return { context, tools, storage }
}

test("todowrite merges auto-todos from the session directory", async () => {
  const dir = mkdtempSync(join(tmpdir(), "auto-todos-"))
  try {
    writeFileSync(
      join(dir, "auto-todos.json"),
      JSON.stringify({ todos: [{ content: "Version bump", always: true }] }),
    )
    const { context, tools, storage } = fakeSetupCtx(dir)
    await plugin.setup(context)
    const written = await tools.get("todowrite")!.execute({ todos: [T("Work")] }, { sessionID: "ses_auto" })
    assert.match(written.content ?? "", /2 items/)
    assert.match(written.content ?? "", /Version bump/)
    const stored = storage.get("todos/ses_auto") as { todos: Todo[] }
    assert.equal(stored.todos.length, 2)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("todowrite passes through untouched without a config file", async () => {
  const { context, tools } = fakeSetupCtx()
  await plugin.setup(context)
  const written = await tools.get("todowrite")!.execute({ todos: [T("Work")] }, { sessionID: "ses_plain" })
  assert.match(written.content ?? "", /1 item/)
})
