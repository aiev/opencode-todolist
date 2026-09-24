import assert from "node:assert/strict"
import test from "node:test"
import type { Plugin } from "@opencode/plugin"
import plugin from "../src/index"

type ToolDef = {
  name: string
  execute: (input: unknown, context: { sessionID: string }) => Promise<{ content?: string }>
}

type ContextHook = (event: { sessionID: string; system: Array<{ type: string; text: string }> }) => Promise<void> | void

function fakeContext() {
  const tools = new Map<string, ToolDef>()
  const hooks = new Map<string, ContextHook>()
  const storage = new Map<string, unknown>()

  const editor = {
    add: (tool: ToolDef) => tools.set(tool.name, tool),
    update: () => {},
    remove: () => {},
    namespace: () => {},
    list: () => [],
    get: () => undefined,
  }

  const context = {
    tool: {
      transform: async (callback: (value: unknown) => void) => {
        callback(editor)
        return { dispose: async () => {} }
      },
    },
    session: {
      hook: async (name: string, callback: ContextHook) => {
        hooks.set(name, callback)
        return { dispose: async () => {} }
      },
    },
    storage: {
      get: async (key: string) => storage.get(key),
      set: async (key: string, value: unknown) => {
        storage.set(key, value)
      },
      remove: async (key: string) => {
        storage.delete(key)
      },
      scan: async () => ({ entries: [] }),
    },
  } as unknown as Plugin.Context

  return { context, tools, hooks, storage }
}

test("setup registers todowrite and todoread", async () => {
  const fake = fakeContext()
  await plugin.setup(fake.context)
  assert.deepEqual([...fake.tools.keys()].sort(), ["todoread", "todowrite"])
})

test("todos are stored and read per session", async () => {
  const fake = fakeContext()
  await plugin.setup(fake.context)

  const write = fake.tools.get("todowrite")!
  const written = await write.execute(
    { todos: [{ content: "A", status: "pending", priority: "high" }] },
    { sessionID: "ses_1" },
  )
  assert.match(written.content ?? "", /Todo list updated \(1 item\)/)

  const stored = fake.storage.get("todos/ses_1") as { todos: unknown[]; updatedAt: number }
  assert.deepEqual(stored.todos, [{ content: "A", status: "pending", priority: "high" }])
  assert.equal(typeof stored.updatedAt, "number")

  const read = fake.tools.get("todoread")!
  const mine = await read.execute({}, { sessionID: "ses_1" })
  assert.match(mine.content ?? "", /1\. \[ \] A — high priority/)
  const other = await read.execute({}, { sessionID: "ses_2" })
  assert.match(other.content ?? "", /empty/)
})

test("context hook injects the open todo list into the system prompt", async () => {
  const fake = fakeContext()
  await plugin.setup(fake.context)
  await fake.tools.get("todowrite")!.execute(
    { todos: [{ content: "Open task", status: "in_progress" }] },
    { sessionID: "ses_1" },
  )

  const event = { sessionID: "ses_1", system: [] as Array<{ type: string; text: string }> }
  await fake.hooks.get("context")!(event)

  assert.equal(event.system.length, 1)
  assert.match(event.system[0].text, /Open task/)
  assert.match(event.system[0].text, /todowrite/)
})

test("context hook stays quiet when nothing is open", async () => {
  const fake = fakeContext()
  await plugin.setup(fake.context)
  await fake.tools.get("todowrite")!.execute(
    { todos: [{ content: "Done", status: "completed" }] },
    { sessionID: "ses_1" },
  )

  const finished = { sessionID: "ses_1", system: [] as Array<{ type: string; text: string }> }
  await fake.hooks.get("context")!(finished)
  assert.equal(finished.system.length, 0)

  const unknown = { sessionID: "ses_unknown", system: [] as Array<{ type: string; text: string }> }
  await fake.hooks.get("context")!(unknown)
  assert.equal(unknown.system.length, 0)
})
