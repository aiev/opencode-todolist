import type { Plugin } from "@opencode/plugin/tui"

export type TodoDisplaySettings = {
  count: boolean
  percent: boolean
  gap: 0 | 1 | 2
  collapseThreshold: 2 | 3 | 5
}

export const DEFAULT_SETTINGS: TodoDisplaySettings = {
  count: true,
  percent: true,
  gap: 1,
  collapseThreshold: 2,
}

export const SETTINGS_KEY = "aiev.todolist.settings"

const GAP_VALUES: ReadonlyArray<TodoDisplaySettings["gap"]> = [0, 1, 2]
const THRESHOLD_VALUES: ReadonlyArray<TodoDisplaySettings["collapseThreshold"]> = [2, 3, 5]

/** Coerces stored settings (which may predate a field or be corrupted) into valid values. */
export function normalizeSettings(value: unknown): TodoDisplaySettings {
  if (value === null || typeof value !== "object") return { ...DEFAULT_SETTINGS }
  const raw = value as Record<string, unknown>
  return {
    count: typeof raw.count === "boolean" ? raw.count : DEFAULT_SETTINGS.count,
    percent: typeof raw.percent === "boolean" ? raw.percent : DEFAULT_SETTINGS.percent,
    gap: GAP_VALUES.includes(raw.gap as TodoDisplaySettings["gap"])
      ? (raw.gap as TodoDisplaySettings["gap"])
      : DEFAULT_SETTINGS.gap,
    collapseThreshold: THRESHOLD_VALUES.includes(raw.collapseThreshold as TodoDisplaySettings["collapseThreshold"])
      ? (raw.collapseThreshold as TodoDisplaySettings["collapseThreshold"])
      : DEFAULT_SETTINGS.collapseThreshold,
  }
}

const nextTick = () => new Promise<void>((resolve) => setTimeout(resolve, 0))
const onOff = (value: boolean) => (value ? "on" : "off")

/**
 * Native settings menu: each pick applies and persists immediately, then the
 * menu reopens (the host closes the dialog before the next select).
 */
export function openSettingsMenu(
  context: Plugin.Context,
  settings: TodoDisplaySettings,
  update: (mutation: (draft: TodoDisplaySettings) => void) => Promise<void>,
): void {
  void (async () => {
    while (true) {
      const choice = await context.ui.dialog.select<string>({
        title: "Todolist settings",
        options: [
          { title: `Show count: ${onOff(settings.count)}`, value: "count" },
          { title: `Show percentage: ${onOff(settings.percent)}`, value: "percent" },
          { title: `Header gap: ${settings.gap}`, value: "gap" },
          { title: `Collapse threshold: ${settings.collapseThreshold}`, value: "threshold" },
        ],
      })
      if (choice === undefined) return

      if (choice === "count") {
        await update((draft) => {
          draft.count = !draft.count
        })
      } else if (choice === "percent") {
        await update((draft) => {
          draft.percent = !draft.percent
        })
      } else if (choice === "gap") {
        const picked = await context.ui.dialog.select<TodoDisplaySettings["gap"]>({
          title: "Header gap",
          options: GAP_VALUES.map((value) => ({ title: String(value), value })),
          current: settings.gap,
        })
        if (picked !== undefined) {
          await update((draft) => {
            draft.gap = picked
          })
        }
      } else if (choice === "threshold") {
        const picked = await context.ui.dialog.select<TodoDisplaySettings["collapseThreshold"]>({
          title: "Collapse threshold",
          options: THRESHOLD_VALUES.map((value) => ({ title: String(value), value })),
          current: settings.collapseThreshold,
        })
        if (picked !== undefined) {
          await update((draft) => {
            draft.collapseThreshold = picked
          })
        }
      }

      await nextTick()
    }
  })()
}
