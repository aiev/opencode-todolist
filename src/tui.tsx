/** @jsxImportSource @opentui/solid */
import { createSignal, For, Show } from "solid-js"
import type { Plugin } from "@opencode/plugin/tui"
import type { Todo, TodoStatus } from "./todos.js"
import { latestTodosFromMessages } from "./tui-data.js"

const COLLAPSE_THRESHOLD = 2

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

/** V1-parity todo list at the end of the sidebar. */
function TodoStrip(props: { context: Plugin.Context; sessionID: string }) {
  const [open, setOpen] = createSignal(true)

  const todos = () => {
    try {
      return latestTodosFromMessages(props.context.data.session.message.list(props.sessionID)) ?? []
    } catch {
      return []
    }
  }
  const show = () => todos().length > 0 && todos().some((todo) => todo.status !== "completed")
  const collapsible = () => todos().length > COLLAPSE_THRESHOLD

  return (
    <Show when={show()}>
      <box flexDirection="column" gap={0}>
        <box flexDirection="row" gap={1} onMouseDown={() => collapsible() && setOpen((value) => !value)}>
          <Show when={collapsible()}>
            <text fg={props.context.theme.text.base}>{open() ? "▼" : "▶"}</text>
          </Show>
          <text fg={props.context.theme.text.base}>
            <b>Todo</b>
          </text>
        </box>
        <Show when={!collapsible() || open()}>
          <For each={todos()}>{(todo) => <TodoRow context={props.context} todo={todo} />}</For>
        </Show>
      </box>
    </Show>
  )
}

const mod: Plugin.Definition = {
  id: "aiev.todolist.tui",

  setup(context) {
    context.ui.slot({
      append: "sidebar.content",
      render: (props) => <TodoStrip context={context} sessionID={props.sessionID} />,
    })
  },
}

export default mod
