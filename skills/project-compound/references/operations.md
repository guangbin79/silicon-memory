# Ingest 全语义（Step 0-6）

> SKILL.md 快路径的完整语义层；条目模板与写作规则为权威版本。

### Step 0: 应用回写（Application Feedback，先于分类执行）

本次任务**实际应用**了既有条目（指导了做法/作为先例引用）→ 向 `./docs/agents/knowledge/feedback.md` 追加一行（首次使用时创建，首行列头注释 `# date | id | project | harness | outcome | note`）：

```
{YYYY-MM-DD} | {module}/{slug} | {project} | {harness} | worked|needed-adjustment|obsolete | {一句话说明}
```

- 条目用其 `**Id:**` 引用；仅真实应用才写，禁止仪式性空行
- 与经验层对称且互不混写：经验 ID → reuses.md；条目 Id → feedback.md（各自 lint 校验各自引用）
- 读侧机械化：准备应用条目前可 `grep '{slug}' feedback.md` 查历史效果——有 needed-adjustment/obsolete 即衰减信号，下探验证后再采用；纯查阅不触发
- 聚合检查（同条目负面 ≥2 → supersede 复审提案）待 feedback.md 出现首批真实数据后另行提案，本版不设

### Step 1: Classify Knowledge

After task completion, ask:
- Chose between alternatives? --> Decision
- Used non-obvious approach? --> Strategy
- Found and fixed a bug? --> Bug Experience
- Tried an approach that failed and should not be repeated? --> Failed Approach
- Created/changed module structure? --> Module Info
- Completed a task plan (all steps checked)? --> Task Archive

Multiple types can apply to one task.

None match (trivial change, obvious rationale)? --> **No material**: append a log-only entry (Types: No material), skip Steps 2-5. Never force entries — ritual content is worse than no content. Module name for the log header: file topic per Step 2 (e.g. `readme`); use `-` when not determinable.

### Step 2: Determine Target Module

- Feature on component X --> module name = X
- Cross-cutting concern (auth, error handling) --> use topic name
- Infrastructure (build, CI) --> use `infra`
- Documentation change (README, docs/) --> module name = file topic (e.g. `readme`, `writing-guide`)
- Uncertain? Check `./docs/agents/knowledge/knowledge-index.md`

### Step 3: Write Record

#### Module File Template

Create `./docs/agents/knowledge/modules/{module-name}.md`:

```markdown
# {Module Name}

> Last updated: {date}

## Overview
- {brief description}
- Key files: {relative paths}
- Dependencies: {deps}
- See also: [{linked-module}]({linked-module}.md)

## Decisions

### {Decision Title} ({date})
- **Id:** {module}/{slug}           # slug 短横线英文小写；新条目必填，存量随下次触碰补
- **Source:** {commit hash | ./tasks/{file} | session id}
- **Chosen:** {what}
- **Alternatives:** {what else}
- **Reason:** {why}
- **Tradeoff:** {what we gave up}
- **Supersedes:** {prior decision, if any}

## Strategies

### {Strategy Title} ({date})
- **Id:** {module}/{slug}
- **Source:** {commit hash | ./tasks/{file} | session id}
- **Problem:** {what needed solving}
- **Approach:** {what we did}
- **When to reuse:** {similar situations}

## Bug Experience

### {Bug Title} ({date})
- **Id:** {module}/{slug}
- **Source:** {commit hash | ./tasks/{file} | session id}
- **Symptom:** {what went wrong}
- **Root cause:** {why}
- **Fix:** {what changed}
- **Prevention:** {how to avoid}

## Failed Approaches

### {Failed Approach Title} ({date})
- **Id:** {module}/{slug}
- **Source:** {commit hash | ./tasks/{file} | session id}
- **Problem:** {what needed solving}
- **What was tried:** {the approach that failed}
- **Why it failed:** {root cause, with evidence}
- **Do not repeat:** {what to avoid; `See also: [{module}]({module}.md)` if related}

## Open Questions
<!-- Gaps that future work should address -->
- {question or unknown}
```

#### Writing Rules

| Rule | Detail |
|------|--------|
| Concise | One bullet per fact, no paragraphs |
| Relative paths | Use `./` prefix for project paths |
| No emoji | Plain text only |
| Date format | YYYY-MM-DD |
| Bilingual OK | Chinese for domain, English for code/tech |
| Append-first | Append by default, revise only when superseding |
| Cross-reference | Add `See also: [{module}]({module}.md)` for related modules（同目录文件相对链接） |
| Supersede | New decisions that override old ones: add **Supersedes** field, mark old entry with `> **Superseded by:** {new decision} ({date})` |
| Feedback log | 任务应用了条目 → Ingest Step 0 向 feedback.md 追加一行（格式见 Ingest 流程）；仅真实应用才写 |
| Entry Id | 每个条目首个 bullet：`- **Id:** {module}/{slug}`；条目被外部引用（feedback.md）的唯一锚点，新条目必填 |
| Source line | First bullet of every entry: `- **Source:** {commit hash | ./tasks/{file} | session id}`. Omit only when nothing is referenceable — never a placeholder |
| Link paths | Inside files use file-relative links (`../modules/x.md`); in conversation use project-root paths (`./docs/agents/knowledge/...`) |

### Step 4: Cross-Reference

A single ingest may touch multiple wiki pages. Ask:
- Does this decision affect other modules? --> Add `See also` link in those modules
- Does this fix relate to a prior bug in another module? --> Link both
- Does this introduce a dependency? --> Update both modules' Overview

### Step 5: Update Index

When adding a NEW module:

Edit `./docs/agents/knowledge/knowledge-index.md`:
- Add row to "模块列表" table
- Columns: module name, one-line description, summary path, detail directory

### Step 6: Append to Log

Edit `./docs/agents/knowledge/log.md`:

```markdown
## [{date}] ingest | {module-name}
- {1-2 line summary of what was recorded}
- Types: {Decision/Strategy/Bug/Failed Approach/Feedback/Module Info/No material}
```

Log is append-only, parseable: `grep "^## \[" log.md | tail -5` shows last 5 entries.
