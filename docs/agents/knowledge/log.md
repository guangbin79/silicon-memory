# Knowledge Log

## [2026-11-07] ingest | cli-retrieval-entry
- Bootstrap 知识层并沉淀 CLI 检索入口语义：`memory query` 是 dedup 查重别名，跨层检索真入口是 `knowledge query`；两 README FAQ 表格曾错指前者，已修 @383c334
- Types: Bug Experience
## [2026-11-11] ingest | unified-lifecycle
- 沉淀统一生命周期控制面结论：公开面＝load/settle/maintain/promote/retire 根命令（不加 cycle 前缀），旧 memory/knowledge 为兼容适配器；夜间调度单一拥有者（外部 02:00 maintain --apply＋MEMORY_NOISE_SWEEP_AT=off，standalone 留内置 03:30）；热维护走本地 semantic-memory CLI 不依赖 HTTP token；集成测试夹具须 git 化带独立 origin @f8ea3e1 @5a25c4a @cd8adf0(dotfiles) @772736e @3a88c2e
- Types: Decision/Strategy/Bug Experience/Module Info
## [2026-11-18] ingest | injection-quality
- 沉淀热记忆注入质量门与展示格式结论：/recall 出口统一终门（is_task_event_noise 过滤历史回执＋MEMORY_RECALL_MIN_RERANK 默认 0.5、低分整条丢弃、gate_degraded 停注入保手动查询）；注入块元数据前置＋正文缩进＋meta 折行防伪造列 0；TUI 只剥面板壳而模型上下文永远保留完整 <semantic-memory> 边界；冲突指引退役入口修正为 memory_supersede/silicon-memory retire @c4b8d15 @7446ee3 @65d3dd8 @64850c9 @7d3a98a @e57f266 @f5322ef
- Types: Decision/Strategy/Bug Experience/Module Info
## [2026-11-18] ingest | injection-quality
- 沉淀 injection-quality/symlink-store-capture-commit：Git 2.43 把 symlink 字面绝对路径的 pathspec 判 outside repository（rev-parse 能解析真实仓根也不行），gitCommitStore 改 `fs.realpathSync` 后 root/add/staged/commit 全链用 realStore；提交失败走 `capture-commit-failed id/stage/rc/error` 结构化输出且 capture rc 保持 0 防重复 @c1240e7 @237d5bd
- Types: Bug Experience
## [2026-11-18] ingest | injection-quality
- 沉淀 injection-quality/conflict-threshold（冲突标注阈值默认 cos 0.90：969 条 live decision 下 0.60 有 7542 对、0.90 仅 41 对，域外 fail-fast，⚠ 仅候选信号人工裁决）与 injection-quality/noise-credential-hardening（验证门/交付链回执覆盖收敛、`Credential <task-id>` 行首族＋无冒号 token 变体硬拒、分隔符匹配限行内防跨行误杀；noise-sweep 收口后活动库 3841 条、凭据谓词/粗筛均 0、noise 测试 83 passed） @1ca5c52 @d87b83d @dc0f412 @be1ec09 @789e5f3 @4265f07
- Types: Decision
## [2026-11-26] ingest | dream-retention
- 沉淀 dream（做梦）任务群知识（任务 ag-4b1d5d＋ag-581248 已合并 @1b41b0c @bc4e05c）：裁定链四条——取消 LLM 裁决（正确＝反复记忆的结果、复活重裁＝正确性机制本身）、LWW 键＝updated_at＋实例指针无人工豁免（人工仅立法与平局）、外层根命令砍除（引擎面 server 子命令／机面 maintain --apply 唯一入口／人面 notify 邮件）、经验层强度键＝reuses.md 只读聚合不回写 frontmatter；Bug×2——capture 预检闸「关键词重叠」谓词退化（停用词＋CJK 二元组＋共享键≥2 修复）、verify 门裸 pytest 下 CLI 子进程须 PYTHONPATH=src
- Types: Decision/Bug Experience
