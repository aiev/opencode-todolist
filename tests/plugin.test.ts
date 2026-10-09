import assert from "node:assert/strict"
import test, { mock } from "node:test"
import type { Plugin } from "@opencode/plugin"
import plugin from "../src/index"

type ToolDef = {
  name: string
  execute: (input: unknown, context: { sessionID: string }) => Promise<{ content?: string }>
}

type SystemPart = { type: string; text: string }
type ContextMessage = { role: string; content: Array<{ type: string; text: string }> }
type ContextEvent = {
  sessionID: string
  system: Array<SystemPart>
  messages: Array<ContextMessage>
}
type HookEvent = {
  sessionID: string
  system?: Array<SystemPart>
  messages?: Array<ContextMessage>
}

type Hook = (event: HookEvent) => Promise<void> | void

function fakeEvents() {
  const queue: Array<unknown> = []
  let wake: (() => void) | undefined
  let closed = false
  const signalDone = () => {
    closed = true
    wake?.()
    wake = undefined
  }
  const subscribe = (options?: { signal?: AbortSignal }) => {
    options?.signal?.addEventListener("abort", signalDone)
    return {
      [Symbol.asyncIterator]() {
        return {
          async next() {
            while (queue.length === 0 && !closed) {
              await new Promise<void>((resolve) => {
                wake = resolve
              })
            }
            if (queue.length === 0) return { value: undefined, done: true }
            return { value: queue.shift(), done: false }
          },
        }
      },
    }
  }
  return {
    subscribe,
    emit(event: unknown) {
      queue.push(event)
      wake?.()
      wake = undefined
    },
  }
}

function fakeContext() {
  const tools = new Map<string, ToolDef>()
  const hooks = new Map<string, Hook>()
  const storage = new Map<string, unknown>()
  const events = fakeEvents()

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
      hook: async (name: string, callback: Hook) => {
        hooks.set(name, callback)
        return { dispose: async () => {} }
      },
    },
    event: {
      subscribe: events.subscribe,
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

  return { context, tools, hooks, storage, events }
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

test("context hook appends the open todo list at the tail", async () => {
  const fake = fakeContext()
  await plugin.setup(fake.context)
  await fake.tools.get("todowrite")!.execute(
    { todos: [{ content: "Open task", status: "in_progress" }] },
    { sessionID: "ses_1" },
  )

  const event: ContextEvent = { sessionID: "ses_1", system: [], messages: [] }
  await fake.hooks.get("context")!(event)

  // Nothing is added to the head; the list is the last message instead.
  assert.equal(event.system.length, 0)
  assert.equal(event.messages.length, 1)
  const injected = event.messages[0]
  assert.equal(injected.role, "user")
  assert.match(injected.content[0].text, /Open task/)
  assert.match(injected.content[0].text, /todowrite/)
})

test("a status change never touches the system prompt", async () => {
  const fake = fakeContext()
  await plugin.setup(fake.context)
  const write = fake.tools.get("todowrite")!

  await write.execute({ todos: [{ content: "A", status: "in_progress" }] }, { sessionID: "ses_1" })
  const before: ContextEvent = { sessionID: "ses_1", system: [{ type: "text", text: "base" }], messages: [] }
  await fake.hooks.get("context")!(before)

  await write.execute(
    { todos: [{ content: "A", status: "completed" }, { content: "B", status: "pending" }] },
    { sessionID: "ses_1" },
  )
  const after: ContextEvent = { sessionID: "ses_1", system: [{ type: "text", text: "base" }], messages: [] }
  await fake.hooks.get("context")!(after)

  // Head byte-identical (the prefix stays cacheable); only the tail changed.
  assert.deepEqual(after.system, before.system)
  assert.equal(before.messages.length, 1)
  assert.equal(after.messages.length, 1)
  assert.notEqual(after.messages[0].content[0].text, before.messages[0].content[0].text)
})

test("context hook stays quiet when nothing is open", async () => {
  const fake = fakeContext()
  await plugin.setup(fake.context)
  await fake.tools.get("todowrite")!.execute(
    { todos: [{ content: "Done", status: "completed" }] },
    { sessionID: "ses_1" },
  )

  const finished: ContextEvent = { sessionID: "ses_1", system: [], messages: [] }
  await fake.hooks.get("context")!(finished)
  assert.equal(finished.system.length, 0)
  assert.equal(finished.messages.length, 0)

  const unknown: ContextEvent = { sessionID: "ses_unknown", system: [], messages: [] }
  await fake.hooks.get("context")!(unknown)
  assert.equal(unknown.system.length, 0)
  assert.equal(unknown.messages.length, 0)
})

test("context hook skips an unchanged list on tool continuations", async () => {
  const fake = fakeContext()
  await plugin.setup(fake.context)
  const hook = fake.hooks.get("context")!
  await fake.tools.get("todowrite")!.execute(
    { todos: [{ content: "Open task", status: "in_progress" }] },
    { sessionID: "ses_1" },
  )

  const fresh: ContextEvent = {
    sessionID: "ses_1",
    system: [],
    messages: [{ role: "user", content: [{ type: "text", text: "go" }] }],
  }
  await hook(fresh)
  assert.equal(fresh.messages.length, 2)

  // A tool-driven continuation with the same list appends nothing, so the
  // previous step's tokens stay cacheable.
  const continuation: ContextEvent = {
    sessionID: "ses_1",
    system: [],
    messages: [
      { role: "user", content: [{ type: "text", text: "go" }] },
      { role: "assistant", content: [{ type: "text", text: "working" }] },
      { role: "tool", content: [] },
    ],
  }
  await hook(continuation)
  assert.equal(continuation.messages.length, 3)
})

test("a changed list is re-injected on a tool continuation", async () => {
  const fake = fakeContext()
  await plugin.setup(fake.context)
  const hook = fake.hooks.get("context")!
  const write = fake.tools.get("todowrite")!

  await write.execute({ todos: [{ content: "A", status: "in_progress" }] }, { sessionID: "ses_1" })
  const fresh: ContextEvent = {
    sessionID: "ses_1",
    system: [],
    messages: [{ role: "user", content: [{ type: "text", text: "go" }] }],
  }
  await hook(fresh)

  await write.execute(
    { todos: [{ content: "A", status: "completed" }, { content: "B", status: "pending" }] },
    { sessionID: "ses_1" },
  )
  const continuation: ContextEvent = {
    sessionID: "ses_1",
    system: [],
    messages: [
      { role: "user", content: [{ type: "text", text: "go" }] },
      { role: "assistant", content: [{ type: "text", text: "working" }] },
      { role: "tool", content: [] },
    ],
  }
  await hook(continuation)
  assert.equal(continuation.messages.length, 4)
  assert.match(continuation.messages[3].content[0].text, /2\. \[ \] B/)
})

test("a fresh user turn always gets the list back", async () => {
  const fake = fakeContext()
  await plugin.setup(fake.context)
  const hook = fake.hooks.get("context")!
  await fake.tools.get("todowrite")!.execute(
    { todos: [{ content: "Open task", status: "in_progress" }] },
    { sessionID: "ses_1" },
  )

  const first: ContextEvent = {
    sessionID: "ses_1",
    system: [],
    messages: [{ role: "user", content: [{ type: "text", text: "go" }] }],
  }
  await hook(first)
  assert.equal(first.messages.length, 2)

  // Injected notices are not persisted, so a new user turn re-injects even
  // when the list is unchanged.
  const second: ContextEvent = {
    sessionID: "ses_1",
    system: [],
    messages: [
      { role: "user", content: [{ type: "text", text: "go" }] },
      { role: "assistant", content: [{ type: "text", text: "done?" }] },
      { role: "user", content: [{ type: "text", text: "continue" }] },
    ],
  }
  await hook(second)
  assert.equal(second.messages.length, 4)
})

test("compaction makes the next request inject the list again", async () => {
  const fake = fakeContext()
  await plugin.setup(fake.context)
  const hook = fake.hooks.get("context")!
  const compact = fake.hooks.get("compaction")!
  await fake.tools.get("todowrite")!.execute(
    { todos: [{ content: "Open task", status: "in_progress" }] },
    { sessionID: "ses_1" },
  )

  const fresh: ContextEvent = {
    sessionID: "ses_1",
    system: [],
    messages: [{ role: "user", content: [{ type: "text", text: "go" }] }],
  }
  await hook(fresh)

  const continuation: ContextEvent = {
    sessionID: "ses_1",
    system: [],
    messages: [
      { role: "user", content: [{ type: "text", text: "go" }] },
      { role: "assistant", content: [{ type: "text", text: "working" }] },
      { role: "tool", content: [] },
    ],
  }
  await hook(continuation)
  assert.equal(continuation.messages.length, 3)

  await compact({ sessionID: "ses_1" })

  const after: ContextEvent = {
    sessionID: "ses_1",
    system: [],
    messages: [
      { role: "user", content: [{ type: "text", text: "go" }] },
      { role: "assistant", content: [{ type: "text", text: "summary" }] },
      { role: "tool", content: [] },
    ],
  }
  await hook(after)
  assert.equal(after.messages.length, 4)
})

test("closing and reopening the list resets the guard", async () => {
  const fake = fakeContext()
  await plugin.setup(fake.context)
  const hook = fake.hooks.get("context")!
  const write = fake.tools.get("todowrite")!

  await write.execute({ todos: [{ content: "A", status: "in_progress" }] }, { sessionID: "ses_1" })
  const fresh: ContextEvent = {
    sessionID: "ses_1",
    system: [],
    messages: [{ role: "user", content: [{ type: "text", text: "go" }] }],
  }
  await hook(fresh)

  const continuation = (): ContextEvent => ({
    sessionID: "ses_1",
    system: [],
    messages: [
      { role: "user", content: [{ type: "text", text: "go" }] },
      { role: "assistant", content: [{ type: "text", text: "working" }] },
      { role: "tool", content: [] },
    ],
  })

  await write.execute({ todos: [{ content: "A", status: "completed" }] }, { sessionID: "ses_1" })
  const closed = continuation()
  await hook(closed)
  assert.equal(closed.messages.length, 3)

  // Reopening with an identical render still injects: the notice from the
  // earlier run is no longer in context.
  await write.execute({ todos: [{ content: "A", status: "in_progress" }] }, { sessionID: "ses_1" })
  const reopened = continuation()
  await hook(reopened)
  assert.equal(reopened.messages.length, 4)
})

test("todoread reports a running timer for the current run", async () => {
  mock.timers.enable({ apis: ["Date"], now: 1_000 })
  try {
    const fake = fakeContext()
    await plugin.setup(fake.context)
    const write = fake.tools.get("todowrite")!
    await write.execute({ todos: [{ content: "Work", status: "in_progress" }] }, { sessionID: "ses_1" })

    mock.timers.tick(252_000)
    const output = await fake.tools.get("todoread")!.execute({}, { sessionID: "ses_1" })
    assert.match(output.content ?? "", /running for 4m12s/)
    assert.match(output.content ?? "", /\[•\] Work — 4m12s/)
  } finally {
    mock.timers.reset()
  }
})

test("todoread reports the total when the run finishes", async () => {
  mock.timers.enable({ apis: ["Date"], now: 1_000 })
  try {
    const fake = fakeContext()
    await plugin.setup(fake.context)
    const write = fake.tools.get("todowrite")!
    await write.execute({ todos: [{ content: "A", status: "pending" }] }, { sessionID: "ses_1" })

    mock.timers.tick(120_000)
    await write.execute({ todos: [{ content: "A", status: "completed" }] }, { sessionID: "ses_1" })

    const output = await fake.tools.get("todoread")!.execute({}, { sessionID: "ses_1" })
    assert.match(output.content ?? "", /finished in 2m00s/)
    assert.match(output.content ?? "", /\[x\] A/)
  } finally {
    mock.timers.reset()
  }
})

test("session.deleted removes the stored list for that session", async () => {
  const fake = fakeContext()
  const dispose = (await plugin.setup(fake.context)) as () => Promise<void>
  try {
    await fake.tools.get("todowrite")!.execute({ todos: [{ content: "A", status: "pending" }] }, { sessionID: "ses_1" })
    assert.ok(fake.storage.has("todos/ses_1"))

    fake.events.emit({ type: "session.created", data: { sessionID: "ses_1" } })
    await new Promise((resolve) => setImmediate(resolve))
    assert.ok(fake.storage.has("todos/ses_1"))

    fake.events.emit({ type: "session.deleted", data: { sessionID: "ses_1" }, durable: { aggregateID: "ses_1" } })
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(fake.storage.has("todos/ses_1"), false)
  } finally {
    await dispose()
  }
})
