---
name: agent-experience
description: |
  Use when the user says 经验记忆/经验沉淀/记录经验/查询经验/agent-experience, or when starting a task hitting any capture signal (bug, weighed decision, reusable pitfall; query prior experience first), or after completing such a task (capture the experience as a draft), especially for debugging, architecture, and integration work.
  中文描述：跨项目经验记忆系统，支持 capture（捕获）、query（查询）、supersede（退役标记）/promote（升华标记）操作，agent 半自动记录任务经验并跨项目复用。
---
> ⚠️ Superseded by `unified-memory`（sidecar Phase 3，2026-10-11）：memory＋knowledge 已有统一入口；本 skill 语义与数据面不变，references 仍是唯一真源。
> 统一入口：`skills/unified-memory/SKILL.md` ｜ CLI：`silicon-memory memory …`＋`silicon-memory knowledge {query|ingest|lint}`


# Agent Experience
> 候选状态：skill-evolution 人工晋升门控（#0024-ae-cards-passive-review，基于 #0023 候选副本的超集）；未晋升前仅文件在场，不接线 ~/.config，live 技能零改动。

## Overview

Cross-project episodic memory for agents. Each experience is one raw, first-person record of a task: what broke, what was tried, what worked, what was decided. Unlike project-compound (which stores synthesized conclusions inside one project), experiences are portable across all projects on this machine.

**Core principle:** One file per experience. INDEX.md is regenerable from the experience files. Everything is retrievable with plain `grep` + `sort`. No database, no embeddings, no daemon. 平面 markdown 天然跨 harness：任何运行时（opencode/cursor/codex…）的 agent 都能直接读写本库，无 harness lock-in；可选 `harness:` 字段仅作来源标注。

Memory layers:

| Layer | What it holds | Where it lives |
|-------|---------------|----------------|
| Working memory | Current conversation | opencode context |
| Episodic memory (this skill) | Raw task experiences, cross-project | `<store>/` |
| Community memory | 公共失败课（只读 advisory） | misakanet.org/mcp（MCP，零命中回退） |
| Semantic memory | Synthesized project conclusions | `./docs/agents/knowledge/` via project-compound |

## When to Use

- Before starting a task hitting any capture signal: query for related prior experience
- After completing a task hitting any capture signal: capture the experience as a draft
- Debugging sessions: what failed, what fixed it
- Architecture decisions: options weighed, tradeoffs accepted
- Integration work: library gotchas, version pitfalls

## When NOT to Use

- Trivial changes (typo, single-line, obvious fix)
- Task still in progress
- Harness friction (skill rules, AGENTS.md, hooks) → fix immediately or record here as type: other
- Synthesized semantic knowledge for this project - route to `project-compound ingest`

## Five Operations

| Operation | Purpose | Trigger |
|-----------|---------|---------|
| **capture** | Record a task experience as a draft | Task hits any capture signal (bug / weighed decision / reusable pitfall) |
| **query** | Retrieve related prior experiences | Before starting a task hitting any capture signal |
| **pre-ask query** | Retrieve prior decisions before bothering the user | Agent about to ask a single-choice question with ≥2 options |
| **reflect** | Mine cross-record patterns via a bounded grep loop | Periodic review; groom Wave 5.5 (see GROOMING.md) |
| **lifecycle** | Manage draft/confirmed/archived/rejected status | Human review, promotion, cleanup |

## Write Safety (concurrency)

Existing experience files are append-hostile under multi-session use: a stale whole-file write-back silently drops newer appends (incident 20261027-090312-d7d1 — ~30 lines lost to a concurrent groom/ingest rewrite).

- Batch flows (groom / ingest / judge / recorder): existing experience files created by OTHER sessions are **read-only**. New knowledge goes through `capture` as a new id — never patch an existing file to "add" content.
- If rewriting an existing file is unavoidable: CAS first — record `mtime` + content hash at read time, re-verify immediately before writing; on mismatch stop and escalate to the human.
- Interactive sessions editing their own capture: append at EOF; if your edit tool reports a match failure, treat it as a conflict signal (someone changed the file), not an error to work around.

## Directory Structure

```
<store>/
  experiences/                  # One markdown file per experience
    {id}.md                     # Flat YAML frontmatter + typed body
  digests/                      # Weekly campaign digests (derived, never hand-tokenized)
  reviews/                      # Draft-review recommendation reports (derived)
  INDEX.md                      # Regenerable catalog (grep output)
  reuses.md                     # Append-only 复用日志（one line per reuse event；primary data 非 derived）
  skill-uses.md                  # Append-only 技能使用日志（七列双录：used＋considered-but-not-used；ae.mjs score/verify-anchors 数据面）
  proposals/                    # Grooming 提案（merge-/cold-/sublime-；sublime=升华提案，verdict: pending 待人工）
  CARDS.md                      # gitignored 再生品：silicon-memory memory cards > <store>/CARDS.md（events 默认 .skill-evolution/events.md，可经 AE_EVENTS_PATH 覆盖）
  README.md                     # What this store is and how to rebuild it
```

Store location is configured at silicon-memory install time (`~/.config/silicon-memory/config`, key `SM_EXP_STORE`); it follows the developer via whatever backup owns that path (e.g. a dotfiles repo).

## Operation: Capture (fast path)

Step 0-6 全语义、dedup 三分支判例、证据定级 E0-E4（Step 3.5）、Capture Decision、Reflect、Lifecycle 见 `references/operations.md`；capture 判定犹豫或评审草稿时先读 `references/anti-patterns.md`；新建记录要模板读 `references/templates.md`——触发式按需读取，勿全量预读。

先锚定目录再调 CLI（硬性）：`~/.config/opencode/skills/agent-experience` 由安装器 symlink 至本仓 skills 目录，`readlink -f` 返回的就是技能目录本身——**勿再 dirname 剥层**；评测 fakehome 下 override symlink 同构成立。

```bash
AE_DIR="$(readlink -f ~/.config/opencode/skills/agent-experience)"
```

五步（收尾第 0 步＝技能使用双录 skill-uses.md＋复用回写 reuses.md，均先于并独立于 Capture，见 operations.md「技能使用记录」「复用回写」节）：

1. **Dedup**：`silicon-memory memory query "<中英关键词>"`——只报命中不裁决；命中三分支（细则/判例见 `references/operations.md` Step 1）：同 project+根因+表现、无真增量（仅日期不同不算新发生）→ 更新或跳过**不得新建**；不同项目/不同修法/明确新发生 → 新建+`related:` 链旧 ID；存疑 → 按无增量跳过。证据定级争议 → operations.md Step 3.5
2. **Gen ID**（可省）：`silicon-memory memory id`（格式 `YYYYMMDD-HHMMSS-<4hex>`）——`capture --from` 会在 id 缺省时自动铸并回填
3. **写草稿**：按 `references/templates.md` 套 Schema 与对应 type 模板写完整 frontmatter 草稿（id 行可缺省）至临时路径，`status: draft`；硬性：body 首段下一行 `Evidence: E<n>（依据一句话）`；query 阶段零命中则 `tags:` 追加 `gap-fill`；信念类记录（`epistemic: belief`）按 templates.md「epistemic: belief」schema＋operations.md「Capture Belief」流（holds/falsifies 必填，矛盾仅 frontmatter `conflict:` 双向标记）
4. **落盘 + INDEX**：`silicon-memory memory capture --from <草稿路径>`——id 缺省铸+回填→validate 过闸（失败 rc≠0 且 store 零接触）→写 `experiences/<id>.md`→追加 INDEX.md 一行→`silicon-memory memory index --check`。溯源：2026-10-22 捕获经 write 工具直写 store 被委托闸拦，捕获落盘改经 CLI
5. **Human review**：呈报草稿；用户置 `confirmed`／`rejected`，解释类 agent 永不自翻；观察类（`epistemic: observational`＝事实可由提交物/命令输出直接复验）捕获即 `confirmed`——D3 扩展。即时的逐决策 Capture Decision 见 operations.md
6. **Retire / Promote**：被推翻 → `silicon-memory memory supersede <旧id> --by <新id>`（`superseded_by:`）；升华入语义层 → `promote <id> --to <语义页引用>`（`promoted_to:`）。两标记查询默认滤除、零物理删除（warm-supersede-marking 教条，2026-10-18）

## Operation: Query (fast path)

dot 流程、社区记忆层零命中回退、Pre-ask Query（≥2 候选单选提问前必查）、复用回写全规则见 `references/operations.md`。硬性：L0 双语关键词（概念词中英双写、技术专名保留原文，分别两条 grep）；Top-5 cap（无论命中多少，最多读 5 个文件，取最新）。

```bash
cd <store>
grep -l "^type: debug" experiences/*.md                   # by type
grep -l "^tags:.*cmake" experiences/*.md                 # by tag
grep -l "^project: HXProjectTemplate" experiences/*.md   # by project
# newest first, cap Top-5
grep -l "^type: debug" experiences/*.md | xargs grep -H "^created_at:" | sort -t: -k3 -r | head -5
```

- 零命中：thinking 标注「无匹配经验」→ 社区回退 `misakanet_search`（advisory；MCP 不可用降级、永不阻塞）→ 仍无命中＝本地 gap-fill 信号；最终回答须一句话说明回退结果；不为确认无关而通读无关记录
- 命中被用于产出（引用/调整方向/呈现为先例）→ 收尾向 `reuses.md` 追加一行；判定不适用记 `not-helped`；零命中不写
- 空库：`experiences/*.md` 不匹配——bash 重定向 `2>/dev/null`，zsh 先 `setopt NULL_GLOB`；空结果即「无匹配经验」，照常继续

## Quick Reference

| Action | How |
|--------|-----|
| Capture experience | Dedup check → draft (id 可省) → `capture --from <draft>` 落盘（validate+INDEX 自动） → human review |
| Capture a decision | Pre-ask hits → draft (epistemic: interpretive, status: confirmed, rationale `[inferred]`) → `capture --from <draft>` → human review |
| Query experience | grep tags/type/project → sort created_at desc → cap Top-5 |
| Pre-ask query | grep `type: decision` + tags → sort desc → cap Top-5 → tiered hit behavior (0/1/≥2) |
| 记复用（reuse write-back） | 命中实际影响了做法 → 收尾追加 reuses.md 一行：date \| id \| project \| harness \| helped/not-helped/counter \| note |
| 记技能使用（skill-uses 双录） | 收尾追加 skill-uses.md 一行：date \| skill \| task \| trigger \| sections \| anchors \| note（used＋considered 双录，机会分母 v0；anchors 必填可解析） |
| Capture a belief | templates.md belief schema（type: other＋epistemic: belief＋holds/falsifies＋`Evidence: E0（draft 信念蒸馏）`）→ operations.md「Capture Belief」；矛盾仅 frontmatter `conflict:` 双向标记 |
| Score / verify anchors | `silicon-memory memory score`（e-thresholds v0 逐技能 verdict，stdout-only 只读）／`silicon-memory memory verify --sample 1.0`（anchors 抽查，violation 即 rc1） |
| Confirm a draft | 解释类：Human edits `status: draft` to `confirmed`；观察类免人工——捕获即 confirmed（D3 扩展） |
| Run store lint | `silicon-memory memory lint <store>` (ID/fields/summary format/INDEX sync; run before manual review) |
| Propose merge/slim | Wave 2 短名单 → proposals/merge-<D>-<slug>.md（verdict: pending 待人工） |
| Apply approved proposals | Wave 6.5 机械落库（上限与漂移校验见 GROOMING 常量区/提案文件规范） |
| Generate CARDS 呈批卡 | `silicon-memory memory cards > <store>/CARDS.md`（stdout-only 只读；events 源 AE_EVENTS_PATH > .skill-evolution/events.md；两跑确定性）
| Rebuild INDEX | `grep -h "^id:" experiences/*.md 2>/dev/null \| sort` |
| Promote to semantic | `project-compound ingest` (manual; read full record + cite verbatim evidence first) |
| Exclude stale/rejected | `grep -L "^status: \(archived\|rejected\)" experiences/*.md` |
| Run reflect | 选域 ≥5 条 confirmed → ≤5 轮 grep 循环（读后换词）→ 通读 ≤20 → 产出 reviews/reflect-<date>.md（只读，提案待人工） |

## Related Docs

- `project-compound` skill - semantic memory layer (synthesized project knowledge)
- `<store>/README.md` - storage layout and rebuild instructions
