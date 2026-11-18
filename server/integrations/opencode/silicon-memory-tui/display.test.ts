// TUI 展示层纯函数回归测试（bun test）：displayBlock 只做显示层外层标签剥除——
// null/undefined/空串归一空串、普通文本原样、注入块剥 opening/closing 标签且
// 保留换行结构（policy 行独立成行、前留空行）；缺 closing 不抛异常。
// 跑法：cd server/integrations/opencode && bun test silicon-memory-tui/display.test.ts
import { describe, expect, test } from "bun:test"
import { displayBlock } from "./display"

describe("displayBlock：TUI 展示层剥外层标签", () => {
  test("A null/undefined/空串 → 空串", () => {
    expect(displayBlock(null)).toBe("")
    expect(displayBlock(undefined)).toBe("")
    expect(displayBlock("")).toBe("")
  })

  test("B 普通非记忆文本原样返回", () => {
    expect(displayBlock("hello")).toBe("hello")
    expect(displayBlock("a\nb")).toBe("a\nb")
  })

  test("C 典型注入块：剥 opening/closing，header/meta/body/policy 保留且 policy 前有空行", () => {
    const block = "<semantic-memory>\nheader\n\n- [fact] [project: p]\n  body\n</semantic-memory>\n[memory-plugin policy] x"
    const out = displayBlock(block)
    expect(out).not.toContain("<semantic-memory")
    expect(out).not.toContain("</semantic-memory")
    expect(out.startsWith("header")).toBe(true)
    expect(out).toContain("- [fact] [project: p]\n  body\n")
    expect(out).toContain("body\n\n[memory-plugin policy] x")
  })

  test("D 缺 closing 的异常输入只剥 opening，不抛异常", () => {
    expect(displayBlock("<semantic-memory>\nheader\n")).toBe("header\n")
  })
})
