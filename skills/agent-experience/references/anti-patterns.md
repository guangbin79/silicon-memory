# AE Anti-patterns — Common Mistakes 全表（第二层披露）

> capture 判定犹豫、呈报草稿或评审前必读；与 operations.md 的三分支判例互补。

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| Paragraphs instead of bullets | One fact per bullet |
| Nested YAML in frontmatter | Flat keys only, one line per key |
| Multi-line YAML values | Keep each value on its single line |
| Absolute project-specific paths in body | Use `./` relative paths, note the `project` field for context |
| Forgetting the `project` field | Always set it; cross-project value depends on it |
| Auto-storing drafts as confirmed | Drafts stay `draft` until a human reviews |
| Skipping the dedup grep-before-write | Always grep for same title/tags first |
| Loading more than Top-5 results | Hard cap at 5, newest first |
| Silently proceeding on zero matches | Note "无匹配经验" explicitly |
| Adding embeddings/vector search/BM25 | grep + sort only, by design |
| **decision 与 architecture 混记** | 原子单选（一轮、either/or）→ decision；多面设计（含 (a)(b)(c) 子决策、跨多轮）→ architecture。同主题只记一处 |
| **把 Y/N 确认掰成 2-options 凑 capture** | 只有真正 ≥2 并列候选且留下可复用偏好才记录；确认性提问不触发 decision capture |
| **`related:` 链深 > 3 跳** | 只链直接前驱，链深 ≤ 3；超长链说明该走 `Supersedes-candidate:` 或升华为语义记忆 |
| **提问前漏跑 Pre-ask Query** | 凡抛 ≥2 候选单选，必先 grep `type: decision`；0 命中也需在 thinking 标注「无匹配决策」 |
| **把约束当决策 capture** | 外部硬约束（平台限制、API 契约）不是用户选择，记 `type: other` 或不记；decision 只收「本来可走多条路、用户选了一条」的情形 |
| **summary 含 `\|`、ASCII `: ` 或写成多行** | 单行；`\|` 会劈开 INDEX 列，用 `;`；冒号用全角 `：`；多行违反 flat YAML |
| **summary 无具体标识**（"修了个 bug"级） | 必含错误片段/库名/工具名/选中选项名——INDEX 第 5 列要可 grep；decision 记录无人工闸门，全靠此规则 |
| **只读 INDEX/summary 就提升华或翻 Supersedes** | 先通读目标记录全文；提案内引**逐字可 grep** 的证据（转述不算）；supersession 新旧两条记录都要证据 |
| 查询只用单语言关键词 | 中英双写后再 grep（L0）；语料侧不做双语化（2026-09-22 决策） |
| **命中实质影响了任务却不回写 reuses.md**（借口：未复验不算影响 / capture dedup-skip 所以收尾无事可做） | 回写是收尾第 0 步，先于并独立于 Capture；命中被用于产出（哪怕只是方案/先例呈现）即回写；not-helped 也记；零命中不写 |
| **给 opencode 采集的记录硬写 harness: opencode** | 默认省略；仅非默认 harness 标注 provenance |
| **dedup 命中一律 skip** | 同根因且有可区分新信息（不同项目/技术栈、不同修法、明确新发生）才新建记录并 `related:` 链旧；同 project 同根因同表现的复述 = 逐字同事件，skip/update |
| **Reflect 一轮 grep 就出结论** | ≤5 轮、换词依据是上一轮读到的内容；无逐字证据（≥2 project）的模式不写进报告 |

## dedup 三分支注记（承 operations.md Step 1）

| dedup 三分支（related: 佐证链） | Hindsight observations proof-count 本地化 (2026-09-26)；raw 只追加，佐证靠新记录 related 聚集，不回写旧记录 |
