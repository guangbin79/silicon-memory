// TUI 侧边栏面板：显示**当前会话**实际注入进上下文的记忆块（semantic-memory 服务遥测）。
// 挂载点：sidebar.content 槽（与内置 Todo 面板同机制，@opencode/plugin/tui）。
// 数据源：GET /api/injections?session_id=<本会话>（注入上报携带的块全文），5s 轮询。
// 设计约束：纯只读展示——不往模型上下文加任何内容，服务离线时静默保持旧态。
//
// 安装（实体目录形态，TUI 发现只认目录/软链；软链目标若被删会锚死陈旧入口点，2026-11-09 事故）。
// 升级须先删再拷：dest 已存在时裸 cp 会嵌套目录，顶层 ./tui 滞留旧副本、新代码永不加载（仓根为 CWD）：
//   rm -rf ~/.config/opencode/plugins/silicon-memory-tui && cp -rfp server/integrations/opencode/silicon-memory-tui ~/.config/opencode/plugins/silicon-memory-tui
// 入口约定：目录下 ./tui 解析为本文件（tui.tsx）。
import { Plugin } from "@opencode/plugin/tui"
import { createSignal, onCleanup, onMount, Show } from "solid-js"

const SERVICE = (process.env.MEMORY_PLUGIN_URL ?? "http://127.0.0.1:8765").replace(/\/$/, "")
const POLL_MS = 5000
const MAX_ROWS = 5

type Inj = { ts: number; hook: string; project: string | null; chars: number; block: string | null }

/** 服务拒启原因：discovery file 的 refused/reason（2026-11-09 启动门）；null=非拒启。
 *  镜像 paths.py/config.py：MEMORY_DB_PATH > MEMORY_DATA_DIR > XDG/memory-mcp > ~/semantic-memory；
 *  空串视同未设＋~/ 展开；discovery 可被 MEMORY_DISCOVERY_FILE 迁移/关闭（""/off/none）。 */
async function refusalReason(): Promise<string | null> {
  try {
    const { readFile } = await import("node:fs/promises")
    const os = await import("node:os")
    const home = os.homedir()
    const expand = (p: string): string => (p.startsWith("~/") ? `${home}/${p.slice(2)}` : p)
    const xdg = expand(process.env.XDG_DATA_HOME || "")
    const dataDir = expand(process.env.MEMORY_DATA_DIR || "")
      || (xdg ? `${xdg}/memory-mcp` : `${home}/semantic-memory`)
    const db = process.env.MEMORY_DB_PATH || `${dataDir}/data/memory.db`
    const custom = (process.env.MEMORY_DISCOVERY_FILE || "").trim()
    const discovery = custom && !["off", "none"].includes(custom.toLowerCase())
      ? custom
      : `${db}.server.json`
    const info = JSON.parse(await readFile(discovery, "utf8"))
    return info?.refused && typeof info.reason === "string" ? info.reason : null
  } catch { return null }
}

export function SidebarMemory(props: { context: Plugin.Context; sessionID: string }) {
  const [rows, setRows] = createSignal<Inj[]>([])
  const [degraded, setDegraded] = createSignal<string | null>(null)
  const [online, setOnline] = createSignal<boolean | null>(null)
  const [refused, setRefused] = createSignal<string | null>(null)
  const [rowsOk, setRowsOk] = createSignal(false) // 零态前提：injections 拉取成功——health 探活≠数据可读
  const theme = props.context.theme

  const refresh = async () => {
    try {
      const h = await fetch(`${SERVICE}/health`)
      if (h.ok) {
        const hd = await h.json()
        setDegraded(hd.gpu_degraded ?? null)
        setOnline(true)
        setRefused(null)
      } else {
        setOnline(false)
        setRefused(await refusalReason())
      }
    } catch {
      setOnline(false) /* 服务离线：保持旧态，下轮再试（rows/degraded 不动） */
      setRefused(await refusalReason())
    }
    try {
      const res = await fetch(
        `${SERVICE}/api/injections?session_id=${encodeURIComponent(props.sessionID)}&limit=${MAX_ROWS}`,
      )
      if (!res.ok) { setRowsOk(false); return }
      const data = await res.json()
      setRows(data.injections ?? [])
      setRowsOk(true)
    } catch { setRowsOk(false) /* rows 保持旧态，但零态不得假断言「无注入」 */ }
  }
  onMount(() => {
    void refresh()
    const timer = setInterval(refresh, POLL_MS)
    onCleanup(() => clearInterval(timer))
  })

  const rel = (ts: number) => {
    const s = Math.max(0, Math.floor(Date.now() / 1000 - ts))
    if (s < 60) return `${s}s`
    if (s < 3600) return `${Math.floor(s / 60)}m`
    if (s < 86400) return `${Math.floor(s / 3600)}h`
    return `${Math.floor(s / 86400)}d`
  }

  // 用户只关心最后一次请求注入了什么：取最新一条；若其后发生过压缩（上下文重建），
  // 则该注入已不在上下文——无可示。
  const latest = () => {
    const cutoff = rows().reduce((acc, r) => (r.hook === "compaction-reset" ? Math.max(acc, r.ts) : acc), 0)
    return rows().find((r) => r.ts > cutoff && r.hook !== "compaction-reset")
  }

  const [view, updateView] = props.context.storage.store("open", { initial: { open: true } })

  return (
    <>
      {/* 服务拒启（2026-11-09 启动门）：离线时透出原因——让位于陈旧熔断态之上（离线时 degraded 是旧运行残留） */}
      <Show when={online() === false && refused()}>
        {(why) => (
          <box>
            <text fg={theme.text.base}><b>热记忆未启动</b></text>
            <text fg={theme.text.muted}>{why()}</text>
          </box>
        )}
      </Show>
      {/* 熔断期：仅在线展示；离线时 degraded 为旧态残留，拒启原因更新鲜 */}
      <Show when={online() !== false && degraded()}>
        <box>
          <text fg={theme.text.base}><b>记忆服务已熔断</b></text>
          <text fg={theme.text.muted}>{degraded()}</text>
        </box>
      </Show>
      <Show when={!degraded() && latest()}>
        {(inj) => (
          <box>
            <box flexDirection="row" gap={1}>
              <text onMouseDown={() => void updateView((draft) => { draft.open = !draft.open }).catch(() => {})}>
                {view.open ? "▼ " : "▶ "}{/* 尾随空格：▼ 东亚模糊宽度在 CJK 端终端占 2 格，吃掉 gap 单元 */}
              </text>
              <text fg={theme.text.base}><b>Context Injection</b></text>
              <text fg={theme.text.muted}>{rel(inj().ts)} · {inj().project ?? "-"} · {inj().hook}</text>
            </box>
            <Show when={view.open}>
              <text fg={theme.text.base}>{inj().block ?? ""}</text>
            </Show>
          </box>
        )}
      </Show>
      {/* 零命中是相关性召回的常态而非故障，空白会被误读为「插件未加载」——如实显示已连接零态 */}
      <Show when={!degraded() && online() && rowsOk() && !latest()}>
        <box>
          <text fg={theme.text.muted}>semantic-memory · 已连接 · 本会话无相关记忆注入</text>
        </box>
      </Show>
    </>
  )
}

export default Plugin.define({
  id: "opencode.sidebar.memory",
  setup(context) {
    context.ui.slot({
      append: "sidebar.content",
      render: (props) => <SidebarMemory context={context} sessionID={props.sessionID} />,
    })
  },
})
