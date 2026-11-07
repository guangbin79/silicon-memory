# AE Templates — Schema 与 Body Templates（第二层披露）

> 新建记录要模板时读本文件：Schema（flat frontmatter 契约）、六类 type 模板、INDEX Rebuild。

## Schema

Flat YAML frontmatter only. Grep-compatible: one key per line, at column 0. NO nested objects, NO multi-line values.

```yaml
---
id: YYYYMMDD-HHMMSS-<4hex>
created_at: YYYY-MM-DD
type: debug | architecture | integration | tool | decision | other
project: <source-project-name>
summary: <one line; 问题+关键因果+结果; ≥1 concrete identifier>
tags: comma,separated,keywords
related: <id1>,<id2>              # 可选；peer 交叉引用，逗号分隔的 experience ID
harness: <agent-runtime>            # 可选；采集/回写 harness，opencode 可省略
epistemic: observational | interpretive | belief  # 可选；观察类=事实可由提交物/命令输出直接复验（捕获即 confirmed，D3 扩展）；解释类=推断/权衡（draft 待人工审）；belief=结构化信念（见下方 belief 记录形态）；缺省=未分型，存量不回填
holds: <适用边界一句话>             # 可选；epistemic: belief 必填（validate 强制）——该信念成立的前提/适用边界
falsifies: <证伪条件一句话>         # 可选；epistemic: belief 必填（validate 强制）——可观察的证伪信号
conflict: <other-belief-id>        # 可选；与另一信念记录的双向矛盾标记键（仅 frontmatter，禁入 body）
status: draft | confirmed | archived | rejected
schema_version: 1
---
```

| Field | Rule |
|-------|------|
| id | `YYYYMMDD-HHMMSS-<4hex>`, matches the filename |
| created_at | `YYYY-MM-DD`, used for sort order |
| type | Exactly one of the six values |
| project | Source project directory name, never omit |
| summary | One line: 问题+关键因果+结果. No `\|` and no ASCII `: ` inside (full-width ： OK). MUST contain ≥1 concrete identifier (error fragment / lib or tool name / chosen option). Required for new captures; legacy falls back to title |
| tags | Comma-separated on ONE line, lowercase（技术专名/API 名保留原文，如 setBusEndpoints）, no spaces after commas preferred |
| status | Starts as `draft` |
| schema_version | `1`; bump only on breaking schema change |
| related | 可选。逗号分隔的 experience ID（peer 交叉引用，非替代）。只链直接前驱，链深 ≤ 3 跳。默认查询不展开 |
| harness | 可选。记录该经验的采集 agent harness（opencode 默认可省略）；跨 harness 复用统计主要靠 reuses.md 第 4 列，此字段仅 provenance |
| epistemic | 可选。observational = 机器可验事实——捕获即 `confirmed`（D3 扩展，边界见 operations.md）；interpretive = 推断/权衡——`draft` 待人工；缺省 = 未分型 |
| holds | 可选。`epistemic: belief` 时必填（缺则 BELIEF_MISSING_FIELD）：信念成立的适用边界，flat 单行 |
| falsifies | 可选。`epistemic: belief` 时必填（缺则 BELIEF_MISSING_FIELD）：可观察的证伪条件，flat 单行 |
| conflict | 可选。与另一 belief 记录 id 的双向矛盾标记；只写 frontmatter，禁入 body（矛盾协议见 operations.md） |

**`related:` vs `Supersedes-candidate:` 语义区分（必读）：**

| 字段 | 语义 | 对被引记录的影响 |
|------|------|------------------|
| `Supersedes-candidate: <id>` | 替代关系（新记录取代旧记录） | 旧记录候选 → `archived` |
| `related: <id1>,<id2>` | peer 交叉引用（同级并列，互不替代） | 不改变任何记录的 status |

`related:` 是软链接，仅用于 Pre-ask Query 命中后的语境串联；不引入并行的 supersession 机制，复用现有 `Supersedes-candidate:` 语义。

## Body Templates

**decision vs architecture 边界（一条规则）：**

- `decision` = 原子单选，一轮用户交互内解决，范围窄（例：「OAuth vs session cookies」「FTS5 vs LIKE」）。
- `architecture` = 多面设计，含 tradeoffs，跨多轮迭代、影响面项目级（例：「导航引擎整体架构」）。
- **启发式**：选项带 (a)(b)(c)(d) 子决策 → architecture；干净的 either/or → decision。
- **同一主题禁止双重记录**：已在 architecture 里决议的子项，不再单独 capture 为 decision；反之 decision 也不升级成 architecture 模板凑字段。

**禁止把 Y/N 问题硬掰成 2-options 以触发 capture：** 只有真正存在 ≥2 个并列候选、且选择会留下可复用偏好的问题，才走 Pre-ask Query + Capture Decision。确认性提问（「这样做可以吗？」）不记录。

### type: debug

```markdown
# {Title}
## Symptom
## Reproduce
## Hypotheses Tried
## Root Cause
## Fix
## Prevention
```

### type: architecture

```markdown
# {Title}
## Context
## Options Considered
## Decision
## Rationale
## Tradeoffs
```

### type: integration

```markdown
# {Title}
## Library
## What Integrated
## Approach
## Gotchas
```

### type: tool

```markdown
# {Title}
## Tool
## Usage Pattern
## Tips
## Pitfalls
```

### type: decision

```markdown
# {Title}
## Decision Point
## Options Considered
## User Choice
## Rationale [inferred]
## Context
## Triggers
## Follow-up Verification
```

字段说明：

- **`## Decision Point`**：一句话点明要解决的单选问题（原子、一轮可解）。例：「POI 全文检索用 FTS5 还是 LIKE」。
- **`## Options Considered`**：≥2 个并列候选，每项一句话要点 + 关键代价。禁止只有 1 个选项（单选项 = 确认，不记录）。
- **`## User Choice`**：用户实际选中的那个候选（原样写候选名，不改写）。
- **`## Rationale [inferred]`**：agent 推断的理由，**必须带 `[inferred]` 标记**。用户随后纠正 → 改标 `[confirmed YYYY-MM-DD]`。推断与确认不可混写。
- **`## Context`**：触发该决策的代码/任务上下文（用 `./` 相对路径，结合 `project:` 字段）。
- **`## Triggers`**：什么场景下应复用此偏好（关键词，便于 Pre-ask Query grep 命中）。
- **`## Follow-up Verification`**：该决策落地的验收点 / 待回看项（可为空，但小节标题必须保留）。

可选小节（命中条件时追加）：

- **`## User-Proposed Alternative`**：用户选了 options 列表之外的方案（见 A5）→ 必加此小节，并在 `tags:` 追加 `user-proposed`（高信号记录）。
- **敏感决策（A7）**：body 只描述决策**模式**，绝不写密钥/口令/内部凭证；`tags:` 追加 `sensitive`，跨项目呈现时降级为「仅供参考」。

### type: other

```markdown
# {Title}
(narrative body)
```

### epistemic: belief（信念记录，#0025）

信念（跨任务规律的置信命题，蒸馏自 ≥1 条 confirmed 经验）以独立记录落库：**`type: other` ＋ `epistemic: belief` ＋ `status: draft`**——永不直接 confirmed（转正只经证据阈值，`ae.mjs score` 按 e-thresholds 政策卡）。硬性：

- frontmatter `holds:`（适用边界）与 `falsifies:`（证伪条件）必填（validate 强制，缺则 BELIEF_MISSING_FIELD）；
- body 首段下一行 `Evidence: E0（draft 信念蒸馏）`（lint §10 对新记录强制 Evidence 行）；
- body 含逐字引用：源记录 id ＋ 原文短引（`> …`）——蒸馏链可追溯；
- Wave 2 聚类豁免：belief 记录不参与重复聚类与 merge 候选（信念非事件）；
- 矛盾时仅以 frontmatter `conflict: <对方id>` 双向标记，禁改 body（见 operations.md「矛盾检测」）。
## INDEX Rebuild

INDEX.md is a derived cache. Rebuild it any time from the source of truth (the experience files):

**`related:` 不计入 INDEX 列。** INDEX.md 维持 6 列（`id | created_at | type | project | summary | tags`）；第 5 列为 `summary`，legacy 无 summary 的记录回退 `# ` 标题；`related:` 是软交叉引用，不进缓存表，需要时直接 grep 文件本身。

```bash
cd <store>
grep -h "^id:" experiences/*.md 2>/dev/null | sort
```

To fully regenerate the table rows, extract the fields per file and join them; the command above is the canonical id listing used to verify consistency.

### Full table rebuild

To reconstruct all INDEX.md rows from experience files:

```bash
cd <store>
for f in experiences/*.md; do
  [ -f "$f" ] || continue
  id=$(grep "^id:" "$f" | cut -d' ' -f2)
  date=$(grep "^created_at:" "$f" | cut -d' ' -f2)
  type=$(grep "^type:" "$f" | cut -d' ' -f2)
  project=$(grep "^project:" "$f" | cut -d' ' -f2)
  tags=$(grep "^tags:" "$f" | cut -d' ' -f2-)
  summary=$(grep -m1 "^summary:" "$f" | cut -d' ' -f2- -s)
  [ -z "$summary" ] && summary=$(grep -m1 "^# " "$f" | sed 's/^# //')
  echo "$id | $date | $type | $project | $summary | $tags"
done | sort
```

The `[ -f "$f" ] || continue` guards against an empty store where the glob doesn't expand.

