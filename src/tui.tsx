/** @jsxImportSource @opentui/solid */
import { createSignal, For, Show } from "solid-js"
import type { Plugin } from "@opencode/plugin/tui"
import type { Todo, TodoStatus } from "./todos.js"
import { headerLabel, latestTodosFromMessages } from "./tui-data.js"
import {
  normalizeSettings,
  openSettingsMenu,
  SETTINGS_KEY,
  type TodoDisplaySettings,
} from "./tui-settings.js"

/** V1 glyphs: ✓ completed, • in progress, blank otherwise. */
function mark(status: TodoStatus): string {
  if (status === "completed") return "✓"
  if (status === "in_progress") return "•"
  return " "
}

function TodoRow(props: { context: Plugin.Context; todo: Todo }) {
  const color = () =>
    props.todo.status === "in_progress"
      ? props.context.theme.text.feedback.warning.base
      : props.context.theme.text.muted

  return (
    <box flexDirection="row" gap={0}>
      <text flexShrink={0} style={{ fg: color() }}>
        {`[${mark(props.todo.status)}] `}
      </text>
      <text flexGrow={1} wrapMode="word" style={{ fg: color() }}>
        {props.todo.content}
      </text>
    </box>
  )
}

/** V1-parity todo list at the end of the sidebar, with configurable heading. */
function TodoStrip(props: { context: Plugin.Context; sessionID: string; settings: TodoDisplaySettings }) {
  const [open, setOpen] = createSignal(true)
  const display = () => normalizeSettings(props.settings)

  const todos = () => {
    try {
      return latestTodosFromMessages(props.context.data.session.message.list(props.sessionID)) ?? []
    } catch {
      return []
    }
  }
  const show = () => todos().length > 0 && todos().some((todo) => todo.status !== "completed")
  const collapsible = () => todos().length > display().collapseThreshold

  return (
    <Show when={show()}>
      <box
        flexDirection="column"
        gap={0}
        border={display().border}
        {...(display().border ? { borderColor: props.context.theme.text.muted } : {})}
        paddingLeft={display().border ? 1 : 0}
        paddingRight={display().border ? 1 : 0}
      >
        <box flexDirection="row" gap={1} onMouseDown={() => collapsible() && setOpen((value) => !value)}>
          <Show when={collapsible()}>
            <text fg={props.context.theme.text.base}>{open() ? "▼" : "▶"}</text>
          </Show>
          <text fg={props.context.theme.text.base}>
            <b>{headerLabel(todos(), display())}</b>
          </text>
        </box>
        <Show when={display().gap > 0}>
          <text fg={props.context.theme.text.muted}>{"─".repeat(12)}</text>
        </Show>
        <Show when={display().gap > 1}>
          <box height={display().gap - 1} />
        </Show>
        <Show when={!collapsible() || open()}>
          <For each={todos()}>{(todo) => <TodoRow context={props.context} todo={todo} />}</For>
        </Show>
      </box>
    </Show>
  )
}

/** Settings command lives in the app slot so it stays available when the sidebar is hidden. */
function SettingsRoot(props: {
  context: Plugin.Context
  settings: TodoDisplaySettings
  update: (mutation: (draft: TodoDisplaySettings) => void) => Promise<void>
}) {
  props.context.keymap.layer(() => ({
    mode: "global" as const,
    commands: [
      {
        id: "aiev.todolist.settings",
        title: "Todolist: Settings",
        description: "Configure the sidebar todo list",
        slash: { name: "todo-sections" },
        palette: true,
        run: () => openSettingsMenu(props.context, props.settings, props.update),
      },
    ],
  }))
  return null
}

const mod: Plugin.Definition = {
  id: "aiev.todolist.tui",

  setup(context) {
    const [settings, updateSettings] = context.storage.store<TodoDisplaySettings>(SETTINGS_KEY, {
      initial: normalizeSettings(undefined),
    })

    context.ui.slot({
      append: "app",
      render: () => <SettingsRoot context={context} settings={settings} update={updateSettings} />,
    })

    context.ui.slot({
      append: "sidebar.content",
      render: (props) => <TodoStrip context={context} sessionID={props.sessionID} settings={settings} />,
    })
  },
}

export default mod
