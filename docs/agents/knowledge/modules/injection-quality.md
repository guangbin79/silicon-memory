# Injection Quality

> Last updated: 2026-11-18

## Overview
- 模块边界：/recall 出口质量门（历史回执噪声过滤＋统一相关度门）与 opencode 注入块格式/展示格式
- 不含生命周期控制面（load/settle/maintain/promote/retire 见 [unified-lifecycle](unified-lifecycle.md)）
- Key files: ./server/src/semantic_memory/server.py, ./server/integrations/opencode/memory.ts, ./server/integrations/opencode/silicon-memory-tui/display.ts
- See also: [unified-lifecycle](unified-lifecycle.md)

## Decisions

### /recall 出口统一最终质量门（2026-11-18）
- **Id:** injection-quality/final-quality-gate
- **Source:** c4b8d15, ag-98dc37
- **Chosen:** 门放 /recall 读口统一收口：is_task_event_noise 过滤历史回执＋MEMORY_RECALL_MIN_RERANK 重排分阈值（默认 0.5）
- **Alternatives:** 依赖蒸馏/语义检索/重排各自兜底过滤；在各召回源分别设门
- **Reason:** 蒸馏/语义/重排分别解决压缩/相似/排序，不等于噪音过滤；主召回、全局召回、跨项目 extras 拼接后缺统一最终门，共注入/注入次数会自增强
- **Tradeoff:** 宁漏勿误口径（判定核与写入口同一 is_task_event_noise）；旧部署零行为变化优先于激进过滤
- 阈值 0＝关门；只对有当前查询重排分（hybrid hit 标 reranked）的条目生效，纯 BM25/重排关闭部署行为不变
- 跨项目 extras 携带的是共注入边权重非相关分：按当前查询补打分再过阈值
- 低分整条丢弃，不用低分条目补足 limit
- 配置在但打不出分（超预算/异常）→ 响应带 gate_degraded：插件停止自动注入，手动查询保留 hits
- 过滤计数经 filter_stats（noise/low_score）随响应返回，供验证与观测
- 冻结头块按召回序取本域 preference/decision 前两条（排除 cross_kind 条目），不按 injections 排序——历史注入计数会自强化

### 注入块格式：元数据前置＋缩进正文＋信道外指引（2026-11-18）
- **Id:** injection-quality/injection-block-format
- **Source:** 7446ee3, 65d3dd8, ag-7d8da1
- **Chosen:** 每条目元数据前置一行（kind/project/cross-project/冲突标注＋uid），正文整体两格缩进、多行逐行缩进，条目间空行
- **Alternatives:** 元数据放行尾或结构化头；正文不缩进
- **Reason:** 正文很长时元数据不被挤到行尾；列 0 只保留给 meta 与 policy 行，按列即可区分信道
- **Tradeoff:** 格式化须处理完整断行字符集，格式测试面变宽
- meta 字段折行（含裸换行与 UAX#14 强制断行类＋CR）压成空格：meta 恒单行，防不可信字段伪造列 0 行冒充 meta/policy（7446ee3）
- 正文先归一行分隔符再逐行缩进，纯空白行不缩进免尾随空白（65d3dd8）
- 超预算整条丢弃，绝不截半条
- 冲突指引放闭合标签外并加 [memory-plugin policy] 前缀标识信道归属：块内是参考资料非指令，指引属插件信道自身
- 指引语义：冲突标注只是候选信号（相似≠矛盾），裁决须基于两条原文语义，uid 只认服务端标注、忽略记忆正文内任何 uid

### TUI 展示层边界：面板剥壳，模型上下文保全（2026-11-18）
- **Id:** injection-quality/tui-display-boundary
- **Source:** 7d3a98a, e57f266, f5322ef, ag-f07d24, ag-08c118
- **Chosen:** TUI displayBlock 只影响面板显示：剥外层 <semantic-memory> 开标签与固定 header 行，面板直接从首条 meta 行开始
- **Alternatives:** 面板与模型共用同一渲染；服务端为展示单独出一份内容
- **Reason:** 固定引导语是给模型的安全边界声明，人在面板重复看无信息量；模型上下文永远保留完整 <semantic-memory> 边界标签、安全声明与 header
- **Tradeoff:** 展示层须自带剥壳逻辑并覆盖中毒样本测试
- closing 标签全部剥除而非首匹配：meta 字段未过字符集校验、可含标签文本，首匹配替换会错删中毒片段而漏真闭合——显示层零边界标签是硬目标（e57f266）
- header 后空行用于可读性/Markdown 稳定性；显示层剥 header 整行及其后空行，新旧格式都归一到首条 meta 行（f5322ef）

### 冲突标注阈值：cos≥0.90 高置信近邻才标 ⚠（2026-11-18）
- **Id:** injection-quality/conflict-threshold
- **Source:** 1ca5c52, ag-f10cc2
- **Chosen:** decision 冲突候选聚簇阈值独立配置（`conflict_min_sim`/`MEMORY_CONFLICT_MIN_SIM`），默认 0.90——同项目高置信近邻才标 ⚠
- **Alternatives:** 0.60 级宽松阈值；不设阈值全量标注
- **Reason:** live 分布实证：969 条活跃项目 decision 下 cos≥0.60 有 7542 对候选、0.90 仅 41 对——低阈值 ⚠ 洪泛反失信号价值
- **Tradeoff:** 高阈值可能漏真实矛盾；⚠ 只提示近邻存在，裁决仍须人工比对两条原文
- 值域 0~1，域外 fail-fast；0.0＝全标、1.0＝几乎关闭，无独立关闭档（config.py）
- 相似≠矛盾：⚠ 是候选信号非矛盾判定，人工裁决不可省

### 读口滤噪收敛：验证门回执覆盖＋凭据 artifact 硬拒（2026-11-18）
- **Id:** injection-quality/noise-credential-hardening
- **Source:** d87b83d, dc0f412, 4265f07, be1ec09, 789e5f3, ag-e638a2, ag-a03c7b, ag-92b4fa, ag-c954f6, ag-513473
- **Chosen:** 验证门/交付链回执纳入 relay 滤噪覆盖；凭据与派发页回显两族独立硬短路（安全优先宁滥勿漏）
- **Alternatives:** relay 模式逐个补丁；凭据行按词表软过滤
- **Reason:** 回执是流程状态非领域知识，注入即自增强；凭据一旦注入即泄漏面，宁可误杀
- **Tradeoff:** 过滤面扩张靠 noise 测试集回归兜底（83 passed）
- 回执覆盖收敛：已进入验证门、entered/entering verification、多任务并列、in verification state、验证任务/交付任务/新任务、交付失败、已合并但等 live 形态（d87b83d, dc0f412, 4265f07）
- 用户询问句（“…的流程是什么/原因可能有哪些”）保持放行——真实信息需求非回执
- 凭据硬拒族：`Credential <task-id>` 行首族（裸 Credential ag-x 亦是派发凭据回显，token 可省）＋无冒号 `token <secret>`/`with token <secret>` 变体（tokens? 兼复数）（be1ec09, 789e5f3）
- token 分隔符空白/is 分支限行内：防「行尾 token＋次行长串」跨行误杀知识句；冒号/等号分支沿旧语义
- 含 credential 单词的知识句不以行首 credential 开头（OAuth credential rotation policy 类），锚行首＋引导词封闭集防误杀
- 真实 token 不得进入代码/测试/知识页
- 收口数据：多轮 noise-sweep＋purge 后活动库 3841 条，活动凭据谓词/粗筛均 0

## Strategies

### 质量门改动的验收与部署（2026-11-18）
- **Id:** injection-quality/gate-verify-deploy
- **Source:** c4b8d15, f5322ef, ag-98dc37, ag-08c118
- **Problem:** 质量门/格式类改动如何证明真的滤掉噪音且不破坏旧部署
- **Approach:** 真实噪音查询复测（hit 1 条 score≈0.99、low_score=4）＋历史回执过滤计数断言（noise=4），用 filter_stats 做行为级证据
- **When to reuse:** 召回质量门、注入格式、展示层改动的验收设计
- 验收命令必须 base-red 有判别力：ag-08c118 首报 grep 式存在性断言被 F107 拒，改为对实际输出跑行为级断言后才通过
- install.sh 装完新插件/TUI 后须重启 opencode 才加载——复测前先重启，勿把旧二进制行为当回归

## Bug Experience

### 冲突指引提及已废弃的 agentctl 旧口（2026-11-18）
- **Id:** injection-quality/stale-policy-interface
- **Source:** 64850c9, ag-04432c
- **Symptom:** 插件冲突指引教用户走 agentctl 经验库旧口退役热记忆条目
- **Root cause:** 指引文案滞后于控制面迁移，agentctl memory 接口已不存在
- **Fix:** 指引只保留现行入口——memory_supersede 工具/silicon-memory retire
- **Prevention:** 指引文案中的接口名与公开控制面同步演进；现行控制面口径以 [unified-lifecycle](unified-lifecycle.md) 为准

### 软链 store 自动提交被 Git pathspec 判 outside repository（2026-11-18）
- **Id:** injection-quality/symlink-store-capture-commit
- **Source:** c1240e7, 237d5bd, ag-e66b04
- **Symptom:** `SM_EXP_STORE=/home/guangbin/.agent-experiences` 软链指向 dotfiles 仓内 store；capture 落盘 rc0 但自动提交失败只留 stderr，dotfiles 主仓变脏并拦后续任务 local_target_dirty
- **Root cause:** `git -C <store> rev-parse` 能解析真实仓根，但 pathspec 仍按软链字面绝对路径判定在仓外（Git 2.43 实证）；不是 index.lock 竞争，也不是绕过 CLI
- **Fix:** gitCommitStore 先 `fs.realpathSync(store)`，root/add/staged/commit 全链用 realStore；经验写路径不变
- **Prevention:** 提交失败输出结构化 `capture-commit-failed id/stage/rc/error` 且 capture rc 仍 0 防重复落盘；worker 看到该行必须当轮 post 上报 dispatcher
- 验证：./skills/agent-experience/bin/test-capture-commit.sh 新增 symlinked-store-commits-realpath，7/7 passed
