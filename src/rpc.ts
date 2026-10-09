import { Rpc } from "@opencode/plugin/rpc"

/** Server-side settings that control model-context behavior. */
export type TodoSettings = {
  updateReminders: boolean
}

export const DEFAULT_SETTINGS: TodoSettings = {
  updateReminders: true,
}

/** Plugin-wide storage key for the server settings record. */
export const TODO_SETTINGS_KEY = "settings"

/** Coerces stored settings (which may predate a field or be corrupted) into valid values. */
export function normalizeTodoSettings(value: unknown): TodoSettings {
  if (value === null || typeof value !== "object") return { ...DEFAULT_SETTINGS }
  const raw = value as { updateReminders?: unknown }
  return {
    updateReminders:
      typeof raw.updateReminders === "boolean" ? raw.updateReminders : DEFAULT_SETTINGS.updateReminders,
  }
}

/**
 * RPC surface for the settings the TUI menu edits but the server plugin owns.
 * Both plugins have separate storage, so behavior settings are read and written
 * through this RPC instead of the TUI's local store.
 */
export const TodolistRpc = Rpc.define({
  id: "aiev.todolist",
  methods: {
    getSettings: {
      input: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      output: {
        type: "object",
        properties: { updateReminders: { type: "boolean" } },
        required: ["updateReminders"],
        additionalProperties: false,
      },
    },
    setSettings: {
      input: {
        type: "object",
        properties: { updateReminders: { type: "boolean" } },
        required: ["updateReminders"],
        additionalProperties: false,
      },
      output: {
        type: "object",
        properties: { updateReminders: { type: "boolean" } },
        required: ["updateReminders"],
        additionalProperties: false,
      },
    },
  },
  events: {},
})
