# Lint 判据全表（Tier 1/2/3）

> SKILL.md 快路径的完整判据层。

## Operation: Lint

Health-check the wiki periodically. Split findings into three tiers:

### Tier 1: Safe fixes (apply automatically)

| Check | Fix |
|-------|-----|
| Index gap | File in `modules/` missing from index --> add row with `(no summary)` placeholder |
| Dead index entry | Index row points to nonexistent file --> prefix Description with `[MISSING]`; never delete the row |
| Updated drift | Index row out of sync with module page header/Overview --> page wins, sync index |

### Tier 2: Decision issues (report, never auto-fix)

| Check | What to Look For |
|-------|-----------------|
| Broken links | 文件内相对链接（含 `See also`）指向不存在的文件 |
| Asymmetric supersede | `**Supersedes:**` without matching `> **Superseded by:**` on the old entry, or vice versa |
| Dead Source links | Source references (commit/task file) that no longer resolve |
| Contradictions | Decisions in different modules that conflict |
| Stale claims | Decisions superseded by newer work but not marked |

### Tier 3: Report only

| Check | What to Look For |
|-------|-----------------|
| Orphan pages | Modules with no inbound `See also` links |
| Missing pages | Concepts referenced but lacking their own module |
| Open questions | `## Open Questions` items that are now resolved |
| Gaps | Important concepts mentioned nowhere in wiki |

Rules:
- Unfixable findings stay reported — never force a fix by inventing content or links
- Append result to `log.md`: `## [{date}] lint | {N} issues found, {M} auto-fixed` plus one bullet per Tier 1/2 finding

