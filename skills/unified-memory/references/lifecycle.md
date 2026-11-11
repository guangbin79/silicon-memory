# Lifecycle 根命令（统一记忆控制面）

> ag-f51f40 产物：`bin/lifecycle.mjs`——`silicon-memory` 生命周期五根命令的编排层。
> 一个入口、三层适配器、统一 JSON 报告；不替代旧 `memory`/`knowledge` 子命令（两者保持兼容）。

## 公开命令

| 命令 | 参数 | 语义 |
|------|------|------|
| `load` | `--project <path> --session <id> --query <text> [--store <dir>] [--limit <n>] --json` | 跨层装配候选：知识(3)→经验(3)→热(5)；`--limit` 仅覆盖热层。命中规范化为 `hot:<uid>`／`exp:<文件名去.md>`／`know:<modules 相对路径去.md>` 引用，入 `candidates`。不同层不比较分数，固定装配序＋每层默认限额 |
| `settle` | `--project <path> --session <id> --json` | 调热层 settle 适配器（生产映射 `POST /idle`，触发蒸馏队列 flush）；返回 `agent_actions`：`agent-experience.capture-if-signaled` 与 `project-compound.ingest-if-material`。不自动调 LLM、不写经验/知识 |
| `maintain` | `[--project <path>] [--scope hot,experience,knowledge] [--phase all\|groom\|judge] [--apply] [--store <dir>] --json` | 缺省 report-only。热层三操作：`distill`（生产暂无 HTTP/CLI 面，适配器占位报 skipped）、`purge`（`--apply` 才执行）、`noiseSweep`（自带 dry_run，report-only 也安全跑）。经验层 `groom`：`SM_EXPERIENCE_RUNNER` 未配置只报 `skipped:groom_unavailable`，绝不扫描 home。知识层 `ae.mjs knowledge lint`：rc1 有发现记 `status=findings`（非 failed，rc0） |
| `promote` | `--proposal <path> [--apply] [--experience <id> --to <know ref>] --json` | dry-run 只做 proposal 校验（`verdict:` 解析）＋返回 project-compound ingest 指令，status=candidate。`--apply` 需提案含 `verdict: approved`，且须给 `--experience/--to`，调 `ae.mjs promote` 写温层 `promoted_to` 标记。不得自动写知识页——知识页写入归 ingest（agent 过程） |
| `retire` | `--ref hot:<uid>\|exp:<id> --by hot:<uid>\|exp:<id> --json` | 同层退役：hot→`POST /supersede`；exp→`ae.mjs supersede`。跨层组合 rc2 |

## 报告与退出码契约

统一报告 JSON：`{operation, actions, agent_actions, candidates, reports, errors}`。

- `action.status ∈ done | skipped | findings | candidate | failed`
- 单层失败不阻断其他层；任一 `failed` → 进程退出码 **1**
- 参数错误（缺必填/非法值/未知选项/跨层组合/未批准提案 apply）→ **rc2**
- `done / skipped / findings / candidate` → **rc0**

## 内部适配器边界

`runLifecycle(argv, adapters)` 可注入三层适配器（测试用假适配器零接触真实记忆库）；缺省 `defaultAdapters()`：

| 层 | 接口 | 生产映射 |
|----|------|----------|
| hot | `recall({query,limit,project})` / `settle({project,session})` / `supersede({uid,by})` / `purge()` / `noiseSweep({dry_run})` / `distill({apply})` | 语义记忆服务 HTTP（`MEMORY_PLUGIN_URL`，默认 8765；`MEMORY_PLUGIN_TOKEN` 鉴权）：`/recall`、`/idle`、`/supersede`、`/api/maintenance/purge`、`/api/maintenance/noise_sweep`；distill 暂为占位。维护面 403 bulk-disabled（服务端未配 `MEMORY_TOKEN` 时 `_bulk_guard` 恒拒）降级 `skipped:bulk_disabled_without_token`，不判失败 |
| experience | `query({query,store})`（返回 `{experiences,knowledge,knowledge_root}`＝一次 `ae.mjs knowledge query` 跨层调用） / `groom({phase,apply,project,store})` / `supersede({id,by})` / `promote({id,to})` | `skills/agent-experience/bin/ae.mjs`；groom 走部署方 runner：`SM_EXPERIENCE_RUNNER` 值按空白切分，追加 `--phase <p> [--apply] --json`，未配置则无 groom 面 |
| knowledge | `lint({store})`（返回 `{rc,out}`） | `ae.mjs knowledge lint`（rc1=findings） |

## 02:00 maintain --apply 计划

- 现状：`maintain` 缺省 report-only；服务内已有每日定点 `noise_sweep_at`（noise 清扫常驻服务线程）。
- 计划：部署方在 crontab 以 `02:00` 定点跑 `silicon-memory maintain --apply --json`（热层 purge 实清＋noiseSweep 实删；知识层 findings 落报告；经验层待 runner 配置）。**前置：服务端须配 `MEMORY_TOKEN`**——`/api/maintenance/*` 批量维护面在无 token 服务上恒 403（适配器降级 `skipped:bulk_disabled_without_token`，`--apply` 不生效而非报错）。上线先以 report-only 跑观察窗口（报告进 `reports` 字段，`errors` 为空即健康），再切 `--apply`。
- 本仓不改 dotfiles/crontab——接线归部署方（与治理类 CLI 同边界）。
