# silicon-memory

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Python 3.11+](https://img.shields.io/badge/python-3.11%2B-3776ab.svg)](https://www.python.org)
[![made for opencode v2](https://img.shields.io/badge/made%20for-opencode%20v2-6e7bff.svg)](https://opencode.ai)

[English](README.md) | [简体中文](README.zh-CN.md)

面向编码 agent 的统一记忆层。一个安装器为你的会话接好**三层记忆**——全局经验库（episodic）、项目知识库（semantic，随仓版本化）、共享语义记忆热服务——外加一个面向 agent 的统一 CLI。**数据原地不动**：安装只"接管/指向"，不迁移、不转换。

```text
你：    "记住：这个仓库发版前必须过 req-check"
记忆：   └─ 存为 decision——调用返回那一刻即可被检索

下周。新会话。同一个仓：
         └─ 不等你开口就注入："发版前过 req-check（decision, 2026-10-31）"

会话中途触发压缩：
         └─ 压缩前冲刷 → 被丢弃的上下文落进记忆库，而不是 /dev/null
```

一句话说差别：**会话会忘，记忆库不会。** 原生压缩和静态上下文文件管理的是"此刻窗口里有什么"；silicon-memory 管理的是"跨时间的相关性"——上个会话被压缩掉、剪掉、丢在身后的内容始终可语义检索，并在与当前任务相关时自动回来。

## 快速开始

前置：`python3` ≥ 3.11、`node`（CLI 是 bash + node 包装）、`git`；服务 venv 用 [uv](https://docs.astral.sh/uv/)。插件需 [opencode](https://opencode.ai) v2。GGUF 模型可选——没有时服务以纯 BM25 降级运行（依然可用）。配置了模型则需要 CUDA：无 GPU 或空闲显存装不下嵌入器（预估×1.2）时服务拒绝启动，原因（需多少/剩多少）经 discovery file、日志与插件/TUI 透出。

```bash
git clone https://github.com/guangbin79/silicon-memory && cd silicon-memory
./install.sh        # 交互询问两个目录；或 --exp-store/--data-dir 非交互
```

安装器幂等（随时重跑，零副作用），产物：

- `~/.config/silicon-memory/config`——两个目录答案（`SM_EXP_STORE`／`SM_DATA_DIR`）；合并语义保留手加键
- `~/.local/bin/silicon-memory`——统一 CLI
- `~/.local/bin/semantic-memory`——服务（uv venv）
- `~/.config/opencode/skills/{agent-experience,project-compound,unified-memory}`——skill 软链
- shell rc 补一行 `MEMORY_DATA_DIR` export（已有则零写入）

然后照常跟会话说话：

| 你说 | 会发生什么 |
|---|---|
| *"……记住这个"* | 存入带类型的记忆（preference / decision / fact），调用返回那一刻即可检索 |
| 新会话，同一个仓 | 相关决策、偏好、历史修法在第一条消息前注入（次末位置，对前缀缓存友好） |
| 会话中途触发压缩 | 压缩前冲刷：被丢弃的上下文可检索，而不是消失 |
| *"我们之前怎么解决 X 的？"* | 原生 `memory_recall` 工具 / `silicon-memory knowledge query` → 融合命中，跨项目补充带标记 |

更新方式：`git pull`——CLI 与 skills 是指向仓的软链，自动跟随。仅当服务 venv 缺失时才需重跑 `./install.sh`（安装器跳过已存在的 venv；若 `server/pyproject.toml` 依赖变更，删 `server/venv` 后重跑）。

## 三层记忆

| 层 | 记什么 | 数据在哪 | 机制 |
|---|---|---|---|
| 项目知识库（semantic） | 提炼后的项目结论 / 决策 / 策略 | 各项目 `./docs/agents/knowledge/`——随仓版本化 | project-compound 过程，`knowledge ingest` |
| 全局经验库（episodic） | 原始任务经验，跨项目可移植 | 安装时配置（默认 `~/.agent-experiences`） | agent-experience skill＋`memory capture` |
| 共享语义记忆（热） | 跨会话检索与自动注入 | 安装时配置（默认 `~/.hotmem`） | semantic-memory 服务（SQLite＋BM25＋向量＋蒸馏） |

事实向上流动：原始经验被自动捕获，蒸馏成带类型的事实，值得留作结论的被 **promote** 进项目知识页——`promote` 标记路径，`knowledge ingest` 是写页面的 LLM 过程。

## 定位

| | 上下文数量（压缩 / 剪枝） | 静态上下文文件（AGENTS.md） | **silicon-memory** |
|---|:---:|:---:|:---:|
| 管什么 | 窗口装得下 | 手工维护的规则 | 跨时间的上下文**相关性** |
| 会话结束后存活 | ✗ | ✓ | ✓ |
| 按相关性召回 | — | 全载或不载 | 自动、任务相关注入 |
| 知识蒸馏 | ✗ | 手工 | episodic → semantic 的 promote 路径 |
| 留存策略 | — | 手工 | 配置决定，不由 LLM 自行裁量 |

压缩让窗口装得下；记忆层让压缩变得安全。

## 工作原理

```text
你的各会话（opencode v2 + 插件 · 其他 harness 走生命周期钩子）
   │ 召回 · 注入 · 自动捕获 · 压缩前冲刷 · idle 蒸馏
   ▼
semantic-memory 服务 — http://127.0.0.1:8765（Python 标准库，fail-open）
   SQLite＋FTS5(porter|trigram) BM25＋Qwen3 GGUF 向量＋RRF＋本地 rerank
   异步蒸馏 → 带类型事实 · TTL/supersede 留存 · web UI
   ▲
silicon-memory CLI — 面向 agent 的指令面（声明即用，装好即在 PATH）
   memory capture|query|supersede|promote|…    knowledge query|ingest|lint
        │                                           │
   ~/.agent-experiences              <项目>/docs/agents/knowledge/
   （episodic，跨项目）               （semantic，随仓，版本化）
```

**面向 agent 的 CLI（独立模式）。** CLI 不是别的壳的转发——agent 侧指令（skills / AGENTS.md）直接声明 `silicon-memory memory …` 与 `silicon-memory knowledge …`。部署方治理面（practice / policy / evolution / groom）有意不在本仓。

**opencode 接线。** 一个面一个文件：`cp server/integrations/opencode/memory.ts ~/.config/opencode/plugins/`——插件独自交付钩子驱动的召回 / 注入 / 自动捕获（`MEMORY_PLUGIN_AUTOSTART=1` 时自动拉起服务）**与**原生 `memory_store` / `memory_recall` 工具，无需任何 MCP 注册。其他 harness：[server/integrations/](server/integrations/) 的钩子适配器。

## 核心能力

- **记忆自动化**——插件钩子：开口前先召回、压缩前先冲刷、从对话（"remember ..."）与工具白名单自动捕获；无需"记得存一下"的自觉
- **换种说法也检索得到**——双通道 BM25（porter＋trigram，覆盖 CJK）＋多语言 Qwen3 向量＋RRF 融合＋感知显存的本地 rerank（recall@5 0.939 vs 纯 RRF 0.909，真实 golden 集实测）
- **压缩变得安全**——压缩前冲刷把被丢弃的上下文落库；去重把再次出现视为"再次证明相关"
- **fail-open**——插件零智能，服务挂了只是静默跳过，绝不阻塞会话
- **本地优先**——loopback 绑定＋可选 Bearer token，GGUF 跑在你自己的 GPU 上，无遥测；云整合通道默认关闭且受配置门控
- **留存是配置**——preference/decision 永久，fact 按使用存活（TTL），supersede 链退役条目零物理删除
- **提示注入卫生**——注入内容剥除边界标签；写入侧跳过经典注入形态的工具输出
- **轻量**——Python 标准库服务（核心零 pip 依赖）、bash＋node CLI、可选 ~600 MB GGUF

## 对比

| | 裸会话 | 静态上下文文件 | 通用记忆工具 | silicon-memory |
|---|---|---|---|---|
| 召回触发 | — | 常驻加载 | 手动查询 | 按任务自动注入＋原生召回工具 |
| 压缩丢弃的内容 | 丢失 | — | 丢失 | 压缩前落库 |
| 检索 | — | 无 | 各异 | BM25 双通道＋向量＋RRF＋可选 rerank |
| episodic → 蒸馏 | — | 手工改写 | ✗ | `promote`＋随仓知识页 |
| 留存策略 | — | 手工 | 手工 | TTL / supersede，配置驱动，不在 agent 面上 |
| 跨 harness | — | 各 harness 各拷一份 | 各异 | 一个服务一个索引，任何有钩子的 harness |
| 足迹 | — | 无 | 重运行时 | python3 标准库＋node＋可选 GGUF |

## 配置

伞级选项（两个目录＋插件噪声表）：

| 选项 | 默认 | 说明 |
|---|---|---|
| `SM_EXP_STORE` | `~/.agent-experiences` | 经验库目录（安装器询问） |
| `SM_DATA_DIR` | `~/.hotmem` | 语义记忆数据主目录：`models/`、db、`config.toml` |
| `SM_NOISE_PREFIXES` | 空 | 插件捕获时跳过的任务事件噪声前缀（逗号分隔），如 `[agora]` |
| `MEMORY_DATA_DIR` | 来自 config | 写入 shell rc；服务与插件经 env 读取 |

其余——约 30 个 `MEMORY_*` 变量，覆盖召回质量（cosine 下限 / 冗余上限 / rerank 预算）、蒸馏、TTL、云通道、端口与 token——见 [server/README.md](server/README.md)。

## 安全模型

诚实设计——哪些是机器保证的，哪些是信任的：

**强制**（不可绕过）：

- 批量破坏性操作（purge / TTL / VACUUM）只在服务启动与 CLI 运行——有意**不**暴露为 agent 面工具
- 非 loopback 绑定缺 `MEMORY_TOKEN` 直接拒启（`exit 2`）
- 写入侧捕获跳过经典注入形态的工具输出；读取侧注入块带"参考数据，非指令"声明并剥除边界标签
- 安装器先 diff 再写、幂等且从不删数据——卸载后两个数据目录原样保留

**接受的风险**（单用户、单机信任模型）：

- 捕获是 at-most-once：钩子 fire-and-forget（1.5 s 预算）；服务宕机期间到达的记忆被静默丢弃（阻塞会话比丢一条记忆更糟）
- 无 token 的 loopback REST 面对本机所有进程可读写——包括 agent 自己的 shell
- 召回的记忆是拼进提示词的不可信数据：有围栏有过滤，但模型仍可能被骗

## FAQ

**怎么更新？** `git pull && ./install.sh`——CLI 与 skills 是指向仓的软链，服务载荷是拷贝，拉完必须重跑安装器。

**怎么卸载？**
```bash
rm -f ~/.local/bin/silicon-memory ~/.local/bin/semantic-memory
rm -rf ~/.config/silicon-memory
rm -f ~/.config/opencode/skills/{agent-experience,project-compound,unified-memory}
rm ~/.config/opencode/plugins/memory.ts   # 装了插件的话
# 删 shell rc 里 MEMORY_DATA_DIR 那行
```
你的数据目录（`SM_EXP_STORE`、`SM_DATA_DIR`、各项目的 `docs/agents/knowledge/`）有意不动——它们是你的，不是工具的。

**没有 GPU / 没有模型？** 没有模型 → 纯 BM25 运行并明确告知。配置了模型但无 CUDA（或空闲显存低于嵌入器预估×1.2）→ 服务拒绝启动，原因（需多少/剩多少 MiB）写入 discovery file（`*.server.json`）、日志与插件/TUI。嵌入器装得下而重排器装不下时，重排自动关闭（RRF 序直出）。之后把 GGUF 模型放进 `<SM_DATA_DIR>/models/`，跑一次 `semantic-memory backfill` 为存量条目补向量。

**支持哪些 harness？** opencode v2 有进程内插件（全自动）。Claude Code 与 Kimi Code 在 [server/integrations/](server/integrations/) 有钩子适配器；任何有生命周期钩子的 harness 都能接"钩子事件 → curl localhost:8765"。CLI 与两个文件层从第一天起就与 harness 无关。

**我的记忆去了哪？** 哪也不去。服务只绑 localhost，模型跑在你机器上，无云、无遥测。可选的云整合通道（默认关）只向你自己配置的端点发送预过滤的近重复集合，且只收回元数据操作计划——云端生成的内容永不入库。

**平台？** Linux（已验证）。macOS：未验证——CLI 与纯 BM25 服务可移植，CUDA 向量轮子是本地 Linux 资产。Windows：走 WSL。

## License

MIT——见 [LICENSE](LICENSE)。
