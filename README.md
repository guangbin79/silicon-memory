# silicon-memory

统一记忆能力仓：**项目知识库＋全局经验库＋共享语义记忆** 三层，一个 URL 安装即得。数据原地不动——安装只"接管/指向"，不迁移、不转换。

| 层 | 记什么 | 数据在哪 | 机制 |
|----|--------|----------|------|
| 项目知识库（semantic） | 提炼后的项目结论/决策/策略 | 各项目 `./docs/agents/knowledge/` | project-compound 过程 |
| 全局经验库（episodic） | 原始任务经验，跨项目可移植 | 安装时配置（默认 `~/.agent-experiences`） | agent-experience skill＋`ae.mjs` |
| 共享语义记忆（动态） | 跨会话热点注入与检索 | 安装时配置（默认 `~/.hotmem`） | Python MCP server（BM25＋向量＋蒸馏） |

## 安装

```bash
git clone https://github.com/guangbin79/silicon-memory && cd silicon-memory
./install.sh        # 交互询问两个目录；或 --exp-store/--data-dir 非交互
```

产物（全部幂等，重跑零副作用）：

- `~/.config/silicon-memory/config`——两个目录答案（`SM_EXP_STORE`／`SM_DATA_DIR`）
- `~/.local/bin/silicon-memory`——统一 CLI
- `~/.local/bin/semantic-memory`——MCP server（uv venv）
- `~/.config/opencode/skills/{agent-experience,project-compound,unified-memory}`——skill 软链
- `~/.config/agentctl/ext/{memory,knowledge}.sh`——agentctl 扩展落件（见 [docs/ext-contract.md](docs/ext-contract.md)）
- shell rc 补 `MEMORY_DATA_DIR` export（已有则零写入）

## CLI

```
silicon-memory memory capture|id|query|supersede|promote|validate|index|cards|score|verify|lint <store>
silicon-memory knowledge query|ingest|lint
```

## 接线（opencode）

- **插件捕获面**：`cp server/integrations/opencode/memory.ts ~/.config/opencode/plugins/`（零 npm 依赖；自动起停 server）
- **MCP 工具面**：opencode.json 的 mcp 段注册 `semantic-memory serve`（示例见 `server/README.md`）
- 其他 harness：手动接线说明同文件；安装器只自动化 opencode

## 语义记忆配置

- 数据目录 `config.toml`：`device`／`model_path`／`distill_model`／`noise_prefixes`（任务事件噪声前缀表，默认空＝惰性；样例 `["[agora]"]`）
- 模型文件（GGUF）放 `<data>/models/`，缺失时 server 以纯 BM25 降级
- 前缀表插件侧：`~/.config/silicon-memory/config` 加 `SM_NOISE_PREFIXES=[agora]`（逗号分隔）

## agentctl 扩展契约

`~/.config/agentctl/ext/<族名>.sh`——文件名＝命令族名，内容＝一行 `exec <cli> <族> "$@"`，可选 `# desc:` 头。写文件即注册，删文件即卸载。详见 [docs/ext-contract.md](docs/ext-contract.md)。

## License

见 [LICENSE](LICENSE)。
