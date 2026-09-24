/** @jsxImportSource @opentui/solid */
import { For, Show } from "solid-js"
import type { Plugin } from "@opencode/plugin/tui"
import { hasOpenTodos, STATUS_MARK, type Todo, type TodoPriority } from "./todos.js"
import { latestTodosFromMessages } from "./tui-data.js"

const MAX_VISIBLE = 8

function prioritySuffix(priority: TodoPriority | undefined): string {
  return priority ? ` · ${priority}` : ""
}

function colorOf(context: Plugin.Context, todo: Todo) {
  const theme = context.theme
  if (todo.status === "completed" || todo.status === "cancelled") return theme.text.muted
  if (todo.status === "in_progress") return theme.text.feedback.info.base
  if (todo.priority === "high") return theme.text.feedback.warning.base
  return theme.text.base
}

/** Compact todo list rendered at the end of the session sidebar while any task is open. */
function TodoStrip(props: { context: Plugin.Context; sessionID: string }) {
  const todos = () => {
    try {
      return latestTodosFromMessages(props.context.data.session.message.list(props.sessionID)) ?? []
    } catch {
      return []
    }
  }
  const openCount = () => todos().filter((todo) => todo.status === "pending" || todo.status === "in_progress").length
  const visible = () => todos().slice(0, MAX_VISIBLE)
  const overflow = () => Math.max(0, todos().length - MAX_VISIBLE)

  return (
    <Show when={hasOpenTodos(todos())}>
      <box flexDirection="column" gap={0} paddingLeft={1} paddingRight={1}>
        <text>
          <span style={{ fg: props.context.theme.text.muted }}>
            {`Todos · ${openCount()}/${todos().length} open`}
          </span>
        </text>
        <For each={visible()}>
          {(todo) => (
            <text>
              <span style={{ fg: colorOf(props.context, todo) }}>{`${STATUS_MARK[todo.status]} ${todo.content}`}</span>
              <Show when={todo.priority}>
                <span style={{ fg: props.context.theme.text.muted }}>{prioritySuffix(todo.priority)}</span>
              </Show>
            </text>
          )}
        </For>
        <Show when={overflow() > 0}>
          <text>
            <span style={{ fg: props.context.theme.text.muted }}>{`… ${overflow()} more`}</span>
          </text>
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
