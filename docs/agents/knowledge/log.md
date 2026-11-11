# Knowledge Log

## [2026-11-07] ingest | cli-retrieval-entry
- Bootstrap 知识层并沉淀 CLI 检索入口语义：`memory query` 是 dedup 查重别名，跨层检索真入口是 `knowledge query`；两 README FAQ 表格曾错指前者，已修 @383c334
- Types: Bug Experience
## [2026-11-11] ingest | unified-lifecycle
- 沉淀统一生命周期控制面结论：公开面＝load/settle/maintain/promote/retire 根命令（不加 cycle 前缀），旧 memory/knowledge 为兼容适配器；夜间调度单一拥有者（外部 02:00 maintain --apply＋MEMORY_NOISE_SWEEP_AT=off，standalone 留内置 03:30）；热维护走本地 semantic-memory CLI 不依赖 HTTP token；集成测试夹具须 git 化带独立 origin @f8ea3e1 @5a25c4a @cd8adf0(dotfiles) @772736e @3a88c2e
- Types: Decision/Strategy/Bug Experience/Module Info
