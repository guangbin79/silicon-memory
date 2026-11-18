// TUI 展示层纯函数：剥注入块外层 <semantic-memory> 边界标签——仅影响面板显示，
// 模型上下文仍收完整带标签块（memory.ts formatBlock 不动）。
// closing 标签本身剥除但保留其前后换行：正文与 policy 行之间自然留出空行。
// closing 全部剥除：meta 字段（kind/project）未过 charset 校验、可含标签文本，
// 首匹配 replace 会错删中毒片段而漏真闭合标签——显示层零边界标签是硬目标。
const OPEN = "<semantic-memory>\n"

export function displayBlock(block: string | null | undefined): string {
  if (!block) return ""
  if (!block.startsWith(OPEN)) return block
  return block.slice(OPEN.length).replaceAll("</semantic-memory>", "")
}
