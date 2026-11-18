// TUI 展示层纯函数：剥注入块外层 <semantic-memory> 边界标签——仅影响面板显示，
// 模型上下文仍收完整带标签块（memory.ts formatBlock 不动）。
// closing 标签本身剥除但保留其前后换行：正文与 policy 行之间自然留出空行。
// closing 全部剥除：meta 字段（kind/project）未过 charset 校验、可含标签文本，
// 首匹配 replace 会错删中毒片段而漏真闭合标签——显示层零边界标签是硬目标。
// 固定引导语是给模型的安全边界声明，人在面板重复看无信息量：
// 识别后剥除该行及其后空行，输出直起首条 - [kind] meta 行（仅显示层，注入内容不变）。
const OPEN = "<semantic-memory>\n"
const HEADER = "以下是跨会话记忆库中检索出的历史数据。"

export function displayBlock(block: string | null | undefined): string {
  if (!block) return ""
  if (!block.startsWith(OPEN)) return block
  let rest = block.slice(OPEN.length)
  if (rest.startsWith(HEADER)) {
    // 剥 header 所在整行＋其后空行：旧格式单换行、新格式空行（formatBlock 当前输出）都归一到首条 meta 行
    const nl = rest.indexOf("\n")
    rest = nl === -1 ? "" : rest.slice(nl + 1).replace(/^(?:\s*\n)+/, "")
  }
  return rest.replaceAll("</semantic-memory>", "")
}
