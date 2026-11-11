# Knowledge Index

## 模块列表

| Module | Description | Summary Path | Detail Directory |
|--------|-------------|--------------|------------------|
| cli-retrieval-entry | CLI 检索入口语义：`memory query` 是 dedup 查重别名，跨层检索真入口是 `knowledge query` | ./docs/agents/knowledge/modules/cli-retrieval-entry.md | ./docs/agents/knowledge/modules/ |
| unified-lifecycle | 统一生命周期控制面：`load/settle/maintain/promote/retire` 为公开根命令，旧 `memory`/`knowledge` 为兼容适配器；夜间调度单一拥有者（外部 02:00 `maintain --apply`＋`MEMORY_NOISE_SWEEP_AT=off`） | ./docs/agents/knowledge/modules/unified-lifecycle.md | ./docs/agents/knowledge/modules/ |
