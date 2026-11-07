---
name: project-compound
description: |
  Use when the user says 知识积累/知识沉淀/记录知识/知识更新/知识查询 (knowledge accumulation/recording/update/query), or when starting a task on an unfamiliar module, after fixing bugs, after making design decisions, when investigating issues across modules, or when project knowledge needs recording or querying from ./docs/agents/knowledge/.
---
> ⚠️ Superseded by `unified-memory`（sidecar Phase 3，2026-10-11）：memory＋knowledge 已有统一入口；本 skill 语义与数据面不变，references 仍是唯一真源。
> 统一入口：`skills/unified-memory/SKILL.md` ｜ CLI：`silicon-memory knowledge {query|ingest|lint}`（机械面）＋本 skill Ingest/Lint 过程（语义面）


# Project Compound

## Overview

Incremental, compounding knowledge wiki for this project. The LLM builds and maintains a structured wiki that sits between raw experience and future problem-solving. Knowledge is compiled once, cross-referenced, and kept current — not re-derived on every task.

**Core principle:** The wiki is a persistent, compounding artifact. Every completed task makes it richer. Cross-references are already there. Contradictions are flagged. The synthesis already reflects everything learned so far.

## When to Use

- Task completed (feature, bugfix, refactor)
- Design decision with non-obvious tradeoffs
- Bug root cause identified
- Need to query prior knowledge before acting
- Periodic knowledge health check (lint)
- All tasks in tasks.md completed (trigger archive)

## When NOT to Use

- Trivial changes (typo, single-line) — don't create module entries; if a closing ingest is mandated anyway, walk the flow and take the No material log-only path
- Task still in progress
- Obvious rationale, no learning value

## Three Operations

| Operation | Purpose | Trigger |
|-----------|---------|---------|
| **Ingest** | Integrate new knowledge into wiki | Task completed, decision made, bug fixed |
| **Query** | Search wiki, synthesize answer, file back | Before acting on unfamiliar module, investigating issue |
| **Lint** | Health-check wiki for drift and gaps | Periodically, or before major work on existing module |

## Directory Structure

```
docs/agents/knowledge/
  knowledge-index.md              # Content-oriented catalog (Layer 1)
  log.md                          # Chronological append-only log
  feedback.md                     # Entry application feedback (append-only, cross-task)
  modules/                        # Module knowledge pages (Layer 2)
    {module-name}.md              # Interlinked, structured per template
```

## Bootstrap (first ingest only)

Before the first ingest, create only what is missing — never overwrite existing files:

- `modules/` directory
- `knowledge-index.md` with the seed table:

  ```markdown
  # Knowledge Index

  ## 模块列表

  | Module | Description | Summary Path | Detail Directory |
  |--------|-------------|--------------|------------------|
  ```

- `log.md` with heading `# Knowledge Log`

Files already exist? Skip silently.

## References (read on trigger, not upfront)

- Ingest 收尾执行/条目四类型模板/写作规则不熟 → read `references/operations.md`（Step 0-6 全语义）
- Lint 执行或判据存疑 → read `references/lint.md`（Tier 1/2/3 全表）
- 写出的内容疑似坏味道 → read `references/anti-patterns.md`（Common Mistakes）

常规操作走下方快路径即可，不必通读 references。

## Operation: Ingest (fast path)

0. **应用回写（先于分类）**：本次任务实际应用了既有条目 → 向 `feedback.md` 追加一行 `{YYYY-MM-DD} | {module}/{slug} | {project} | {harness} | worked|needed-adjustment|obsolete | {一句话说明}`（条目用其 `**Id:**` 引用；仅真实应用才写；语义细节见 references/operations.md Step 0）
1. **Classify**：Chose between alternatives → Decision；non-obvious approach → Strategy；found and fixed a bug → Bug Experience；failed approach not to repeat → Failed Approach；module structure changed → Module Info；task plan completed → Task Archive。None match → **No material**：log-only entry（Types: No material），skip Steps 2-5；never force entries
2. **Target module**：component X → X；cross-cutting concern (auth, error handling) → topic name；infrastructure (build, CI) → `infra`；documentation → file topic (e.g. `readme`)；uncertain → check `knowledge-index.md`
3. **Write record**：create/append `modules/{module-name}.md` per the full template in `references/operations.md`（每条目首 bullets：`**Id:** {module}/{slug}` + `**Source:** {commit hash | ./tasks/{file} | session id}`；Decision 另含 Chosen/Alternatives/Reason/Tradeoff/Supersedes）
4. **Cross-reference**：decision affects other modules → add `See also` in those modules；fix relates to prior bug elsewhere → link both；new dependency → update both Overviews
5. **Update index**（new module only）：add row to 模块列表 — module name, one-line description, summary path, detail directory
6. **Append to log**（append-only, parseable）：

   ```markdown
   ## [{date}] ingest | {module-name}
   - {1-2 line summary of what was recorded}
   - Types: {Decision/Strategy/Bug/Failed Approach/Feedback/Module Info/No material}
   ```

   `grep "^## \[" log.md | tail -5` shows last 5 entries.

## Operation: Query (fast path)

Read `knowledge-index.md` → read relevant module pages → synthesize answer → return.

Good answers compound. If a query produces a comparison, analysis, or connection not yet in the wiki — file it back:
1. Append the synthesis to `./docs/agents/knowledge/modules/{module}.md` as a new entry（套最接近的条目模板；`Source: query synthesis` + 日期）
2. Append to `log.md`:

   ```markdown
   ## [{date}] query | synthesis -> {module}
   - Types: Synthesis
   ```

Likewise: if this task actually applied an existing wiki entry, write one feedback.md line at the closing ingest (Ingest Step 0). Only on actual use - never as ritual.

## Operation: Lint (fast path)

- **Tier 1 safe fixes（auto-apply）**：modules/ file missing from index → add row with `(no summary)` placeholder；index row points to nonexistent file → prefix Description with `[MISSING]`，never delete the row；index/module drift → page wins, sync index
- **Tier 2 decision issues / Tier 3 report-only**（broken links、asymmetric supersede、dead Source links、contradictions、stale claims、orphan/missing pages、resolved open questions、gaps）→ report, never auto-fix；full tables in `references/lint.md`
- Append to log.md: `## [{date}] lint | {N} issues found, {M} auto-fixed` plus one bullet per Tier 1/2 finding

## Quick Reference

| Action | How |
|--------|-----|
| Ingest after task | Classify → Write → Cross-ref → Index → Log |
| Query knowledge | Read index → Read modules → Synthesize → File back if new |
| Lint wiki | Tier 1 auto-fix → Tier 2/3 report → log `N issues found, M auto-fixed` |
| Add cross-reference | `See also: [module-name](module-name.md)` in Overview |
| Supersede old decision | Add **Supersedes** in new, mark old with `> **Superseded by:**` |
| Check recent activity | `grep "^## \[" ./docs/agents/knowledge/log.md \| tail -5` |
| Archive completed task | Read ./tasks/{file}, run ingest, mark in ./tasks.md as [DONE] |
| Write entry feedback | Task applied an entry -> Ingest Step 0: append feedback.md line `date \| module/slug \| project \| harness \| outcome \| note` |
| First ingest | Bootstrap: create missing index/log/modules seeds |

## Common Mistakes

全表（12 条 Mistake|Fix）见 `references/anti-patterns.md`。高频三条：one fact per bullet（禁段落）；`./` 相对路径；琐碎变更走 No material log-only 路径。

## Related Docs

- `./docs/agents/knowledge/knowledge-index.md` - content index
- `./docs/agents/knowledge/log.md` - chronological log
- `./docs/agents/writing-guide.md` - documentation conventions
- `./docs/agents/index.md` - overall docs structure
