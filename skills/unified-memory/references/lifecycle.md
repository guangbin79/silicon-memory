# Lifecycle 根命令（统一记忆控制面）

> ag-f51f40 产物：`bin/lifecycle.mjs`——`silicon-memory` 生命周期五根命令的编排层。
> 一个入口、三层适配器、统一 JSON 报告；不替代旧 `memory`/`knowledge` 子命令（两者保持兼容）。

## 公开命令

| 命令 | 参数 | 语义 |
|------|------|------|
| `load` | `--project <path> --session <id> --query <text> [--store <dir>] [--limit <n>] --json` | 跨层装配候选：知识(3)→经验(3)→热(5)；`--limit` 仅覆盖热层。命中规范化为 `hot:<uid>`／`exp:<文件名去.md>`／`know:<modules 相对路径去.md>` 引用，入 `candidates`。不同层不比较分数，固定装配序＋每层默认限额 |
| `settle` | `--project <path> --session <id> --json` | 调热层 settle 适配器（生产映射 `POST /api/memory/settle`，触发蒸馏队列 flush；旧 `/idle` 为兼容别名）；返回 `agent_actions`：`agent-experience.capture-if-signaled` 与 `project-compound.ingest-if-material`。不自动调 LLM、不写经验/知识 |
| `maintain` | `[--project <path>] [--scope hot,experience,knowledge] [--phase all\|groom\|judge] [--apply] [--store <dir>] --json` | 缺省 report-only。热层三操作均走本地 `semantic-memory` CLI（不经 HTTP 批量闸，无需 `MEMORY_TOKEN`）：`distill`、`purge`（`--apply` 才执行）、`noiseSweep`（`noise-sweep --dry-run`，自带 dry_run，report-only 也安全跑）。经验层 `groom`：`SM_EXPERIENCE_RUNNER` 未配置只报 `skipped:groom_unavailable`，绝不扫描 home。知识层 `ae.mjs knowledge lint`：rc1 有发现记 `status=findings`（非 failed，rc0） |
| `promote` | `--proposal <path> [--apply] [--experience <id> --to <know ref>] --json` | dry-run 只做 proposal 校验（`verdict:` 解析）＋返回 project-compound ingest 指令，status=candidate。`--apply` 需提案含 `verdict: approved`，且须给 `--experience/--to`，调 `ae.mjs promote` 写温层 `promoted_to` 标记。不得自动写知识页——知识页写入归 ingest（agent 过程） |
| `retire` | `--ref hot:<uid>\|exp:<id> --by hot:<uid>\|exp:<id> --json` | 同层退役：hot→`POST /api/memory/retire`（旧 `/supersede` 为兼容别名）；exp→`ae.mjs supersede`。跨层组合 rc2 |

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
| hot | `recall({query,limit,project})` / `settle({project,session})` / `supersede({uid,by})` / `purge()` / `noiseSweep({dry_run})` / `distill({apply})` | 语义记忆服务（`MEMORY_PLUGIN_URL`，默认 8765；`MEMORY_PLUGIN_TOKEN` 鉴权）：`/recall`、`/api/memory/settle`（旧 `/idle` 兼容别名）、`/api/memory/retire`（旧 `/supersede` 兼容别名）；维护三操作走本地 CLI：`purge`→`semantic-memory purge`、`noiseSweep`→`semantic-memory noise-sweep [--dry-run]`、`distill`→`semantic-memory distill`。CLI 解析链 `SM_SEMANTIC_MEMORY_BIN` > 仓内 `server/venv/bin/semantic-memory` > `~/.local/bin/semantic-memory` > PATH；spawn 失败/非零 rc/坏 JSON 抛错记 `failed`（不吞错） |
| experience | `query({query,store})`（返回 `{experiences,knowledge,knowledge_root}`＝一次 `ae.mjs knowledge query` 跨层调用） / `groom({phase,apply,project,store})` / `supersede({id,by})` / `promote({id,to})` | `skills/agent-experience/bin/ae.mjs`；groom 走部署方 runner：`SM_EXPERIENCE_RUNNER` 值按空白切分，追加 `--phase <p> [--apply] --json`，未配置则无 groom 面 |
| knowledge | `lint({store})`（返回 `{rc,out}`） | `ae.mjs knowledge lint`（rc1=findings） |

## 02:00 maintain --apply 计划（单调度拥有者规则）

- 现状：`maintain` 缺省 report-only；服务内有每日定点 `noise_sweep_at` 夜扫线程（standalone 缺省 `03:30`）。
- 单调度拥有者：同一清扫任一时刻只有一个拥有者。部署方在 crontab 以 `02:00` 定点跑 `silicon-memory maintain --apply --json`（热层 purge 实清＋noiseSweep 实删＋distill flush；知识层 findings 落报告；经验层待 runner 配置）时，须同时把服务配置改为外部统一调度模式——`MEMORY_NOISE_SWEEP_AT=off`（config.toml `noise_sweep_at="off"` 同义）：serve 不启动内置夜扫线程。standalone（未接管调度）缺省仍 `03:30` 内置。热层维护已走本地 CLI，`--apply` 不再依赖 `MEMORY_TOKEN`（HTTP 批量闸仅剩 `/api/maintenance/*` 网页面，与 maintain 无关）。上线先以 report-only 跑观察窗口（报告进 `reports` 字段，`errors` 为空即健康），再切 `--apply`。
- 本仓不改 dotfiles/crontab——接线归部署方（与治理类 CLI 同边界）。
