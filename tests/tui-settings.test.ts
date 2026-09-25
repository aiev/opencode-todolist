import assert from "node:assert/strict"
import test from "node:test"
import { DEFAULT_SETTINGS, normalizeSettings } from "../src/tui-settings"

test("normalizeSettings keeps valid stored values", () => {
  assert.deepEqual(normalizeSettings({ count: false, percent: false, gap: 2, collapseThreshold: 5 }), {
    count: false,
    percent: false,
    gap: 2,
    collapseThreshold: 5,
  })
})

test("normalizeSettings falls back per field for invalid values", () => {
  assert.deepEqual(normalizeSettings(undefined), DEFAULT_SETTINGS)
  assert.deepEqual(normalizeSettings({ count: "nope", percent: 1, gap: 9, collapseThreshold: 4 }), DEFAULT_SETTINGS)
  assert.deepEqual(normalizeSettings({ count: false }), { ...DEFAULT_SETTINGS, count: false })
})
