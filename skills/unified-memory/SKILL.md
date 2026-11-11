---
name: unified-memory
description: |
  Use when the user says 经验记忆/查询经验/记录经验 OR 知识积累/知识沉淀/记录知识/知识查询, or before/after a task hitting any capture signal (bug, weighed decision, reusable pitfall) to query or capture memory across BOTH layers (cross-project experiences + project knowledge pages) through one CLI surface. Unified entry that supersedes the agent-experience and project-compound entry points (sidecar Phase 3); those skills remain as semantic references.
  中文描述：统一记忆入口——经验层（<store>，跨项目 episodic）＋知识层（docs/agents/knowledge，项目 semantic）经 silicon-memory CLI 单命令面跨层检索与沉淀。
---

# Unified Memory

> 侧车 Phase 3 产物：一个入口、两层记忆、零数据迁移。接管 agent-experience 与 project-compound 的入口职责；两者的 references 仍是各自语义的唯一真源（本 skill 不复制语义，只做入口与路由）。

## When to Use

- 非平凡任务开工前：`silicon-memory load --project <repo> --session <session-or-task-id> --query <中英关键词> --json` 跨层装配候选（知识 3＋经验 3＋热 5）；`--session` 没有真实会话 id 时用稳定任务 id，禁止编造跨任务复用状态
- 非平凡任务收尾后：`silicon-memory settle --project <repo> --session <同上> --json` 读回 `agent_actions`——命中 `agent-experience.capture-if-signaled` 才走 agent-experience capture（五步），命中 `project-compound.ingest-if-material` 才走 project-compound ingest（六步）；无信号／No material 不保存；实际复用照旧写 reuses.md／feedback.md／既有反馈面
- 知识库健康检查：`silicon-memory knowledge lint`（机械面，见下「Lint 分工」）

## 角色边界

- 任务 owner：load＋settle 全套（开工装配＋收尾信号解读）
- dispatcher：可 load 预研，不代 worker settle
- 只读 subagent：仅 load 返回引用，不 settle 不沉淀
- 普通 agent 禁日常 `maintain --apply`（02:00 调度唯一拥有者）

## Data Layout（两层原地不动——无迁移、无格式转换）

| Layer | 记什么 | 在哪里 | 机制 |
|-------|--------|--------|------|
| memory（episodic） | 原始任务经验，跨项目可移植 | `<store>/`（experiences/*.md、policies/、reuses.md、skill-uses.md） | `ae.mjs`（agent-experience skill） |
| knowledge（semantic） | 提炼后的项目结论/决策/策略 | `./docs/agents/knowledge/`（每项目；modules/*.md＋knowledge-index.md＋log.md＋feedback.md） | project-compound 过程 |

经验→知识的升华（promote to semantic）仍走 project-compound ingest（先通读全文＋引逐字证据）。

## Command Map（silicon-memory CLI，harness 无关）

公开控制面（日常入口）：

| 命令 | 效果 |
|------|------|
| `silicon-memory load` | `--project <repo> --session <id> --query <中英关键词> --json` 跨层装配候选：知识(3)→经验(3)→热(5)，引用形如 `hot:<uid>`／`exp:<文件名>`／`know:<modules 相对路径>`。固定配额装配器不是全量检索——全库查重／退役档案深查用下方内部命令或 grep |
| `silicon-memory settle` | `--project <repo> --session <同上> --json` 返回 `agent_actions`（capture-if-signaled／ingest-if-material）；不自动调 LLM、不写经验/知识 |
| `silicon-memory maintain` | 缺省 report-only；`--apply` 仅归 02:00 调度拥有者，普通 agent 日常禁用 |
| `silicon-memory promote` | 仅 `verdict: approved` 提案可 `--apply`；知识页写入仍归 ingest |
| `silicon-memory retire` | 仅确认语义互斥才退役；不确定先问人 |

命令语义、适配器边界与报告/退出码契约见 `references/lifecycle.md`。

内部适配器（旧命令不删除、不改语义，降为内部执行器）：

| 命令 | 效果 | 底层 |
|------|------|------|
| `silicon-memory memory query "<词>"` | 经验层全文查重（大小写不敏感超集），输出 {hits} | `ae.mjs dedup` |
| `silicon-memory memory capture` | 无参铸经验 ID（YYYYMMDD-HHMMSS-<4hex>）；`capture --from <draft.md>` 落盘：id 缺省铸+回填→validate 过闸（失败 store 零接触）→写 experiences/<id>.md→INDEX 追加行，stdout 输出 id+路径 | `ae.mjs capture` |
| `silicon-memory memory validate <file>` | 经验 frontmatter 契约检查 | `ae.mjs validate` |
| `silicon-memory memory index` | INDEX.md 漂移检查（--check） | `ae.mjs index` |
| `silicon-memory memory cards` / `score` / `verify` | 呈批卡／技能评分／锚点抽查 | `ae.mjs cards/score/verify-anchors` |
| `silicon-memory memory lint <store>` | 经验库跨文件检查 | `lint/lint.sh`（已升格为子命令） |
| `silicon-memory knowledge query "<词>"` | **跨层检索**：experiences＋modules/*.md＋knowledge-index.md，输出 {experiences,knowledge,knowledge_root} | `ae.mjs knowledge query` |
| `silicon-memory knowledge lint` | 知识库机械检查（只读报告，发现即 rc1） | `ae.mjs knowledge lint` |
| `silicon-memory knowledge ingest` | 打印 ingest runbook（ingest 本身是 agent 过程，无脚本入口） | project-compound skill |

> 治理类命令（practice／policy／evolution／groom／mount／constitution）属部署方私有 CLI，不在本仓范围。

路径解析：knowledge root＝`$AE_KNOWLEDGE_PATH` > 自 cwd 向上找 `docs/agents/knowledge`（与 project-compound 的 `./docs` 相对语义一致）；经验 store 覆盖沿用 `--store`。

`knowledge query`（语义层）不在盲视作用域内——盲视仅覆盖 `memory query --scope=verifier`；同 UID 下 verifier 文件系统可达性为记录在案的天花板（UID 分离 out of scope）。

## Lint 分工（机械面 vs 语义面）

- **机械面（`silicon-memory knowledge lint`，ae.mjs 只读）**：Tier 1 索引双向一致（INDEX_GAP／DEAD_INDEX_ENTRY）＋bootstrap 在场（BOOTSTRAP_MISSING）＋Tier 2 相对 md 断链（BROKEN_LINK）。发现即 rc1 逐项点名，不写不修。
- **语义面（project-compound Lint 过程，agent 执行）**：Tier 1 auto-fix（补 (no summary) 占位行／[MISSING] 前缀／索引同步）、Tier 2 判断项（矛盾/过期/asymmetric supersede/dead Source）、Tier 3（orphan/gaps）＋log.md 落档。机械面发现的问题按该过程修复。

## Related Docs

- `skills/agent-experience/SKILL.md`＋`references/` — 经验层语义真源（顶部已加 superseded 注记）
- `skills/project-compound/SKILL.md`＋`references/` — 知识层语义真源（顶部已加 superseded 注记）
- `~/.dotfiles/.agent-experiences/` 内的 store 侧文档（README.md、GROOMING.md）— 部署方随 store 维护
- `docs/agents/knowledge/modules/experience-memory.md` — 经验记忆设计原理
