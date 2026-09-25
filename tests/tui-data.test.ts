import assert from "node:assert/strict"
import test from "node:test"
import { headerLabel, latestTodosFromMessages } from "../src/tui-data"

function message(parts: unknown[]) {
  return { content: parts }
}

function tool(name: string, status: string, input: unknown) {
  return { type: "tool", name, state: { status, input } }
}

test("latestTodosFromMessages picks the most recent completed todowrite", () => {
  const messages = [
    message([tool("todowrite", "completed", { todos: [{ content: "Old", status: "pending" }] })]),
    message([tool("todoread", "completed", {})]),
    message([tool("todowrite", "completed", { todos: [{ content: "New", status: "in_progress", priority: "high" }] })]),
    message([tool("todowrite", "error", { todos: [{ content: "Failed", status: "pending" }] })]),
  ]
  assert.deepEqual(latestTodosFromMessages(messages), [{ content: "New", status: "in_progress", priority: "high" }])
})

test("latestTodosFromMessages ignores malformed history and empty input", () => {
  assert.equal(latestTodosFromMessages(undefined), undefined)
  assert.equal(latestTodosFromMessages([]), undefined)
  assert.equal(latestTodosFromMessages([message([tool("todowrite", "completed", {})])]), undefined)
  assert.equal(
    latestTodosFromMessages([
      message([tool("todowrite", "completed", { todos: [{ content: "X", status: "nope" }] })]),
    ]),
    undefined,
  )
})

test("latestTodosFromMessages keeps the last valid list when a later call is invalid", () => {
  const messages = [
    message([tool("todowrite", "completed", { todos: [{ content: "Keep", status: "pending" }] })]),
    message([tool("todowrite", "completed", { todos: "broken" })]),
  ]
  assert.deepEqual(latestTodosFromMessages(messages), [{ content: "Keep", status: "pending" }])
})

const sample = [
  { content: "a", status: "completed" as const },
  { content: "b", status: "pending" as const },
  { content: "c", status: "in_progress" as const },
  { content: "d", status: "pending" as const },
]

test("headerLabel formats count and percentage", () => {
  assert.equal(headerLabel(sample, { count: true, percent: true }), "Todo [1/4] · 25%")
  assert.equal(headerLabel(sample, { count: true, percent: false }), "Todo [1/4]")
  assert.equal(headerLabel(sample, { count: false, percent: true }), "Todo 25%")
  assert.equal(headerLabel(sample, { count: false, percent: false }), "Todo")
})

test("headerLabel rounds and handles an empty list", () => {
  const thirds = [
    { content: "a", status: "completed" as const },
    { content: "b", status: "pending" as const },
    { content: "c", status: "pending" as const },
  ]
  assert.equal(headerLabel(thirds, { count: true, percent: true }), "Todo [1/3] · 33%")
  assert.equal(headerLabel([], { count: true, percent: true }), "Todo [0/0] · 0%")
})
