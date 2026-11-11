# Unified Lifecycle

> Last updated: 2026-11-11

## Overview
- 统一记忆公开控制面＝`silicon-memory` 生命周期五根命令：`load`/`settle`/`maintain`/`promote`/`retire`（编排层）
- 旧 `memory`/`knowledge` 子命令降为内部适配器/兼容面，保持可用但不新增能力
- `/recall`、`/ingest`、遥测端点是内部数据面，不属于公开控制面
- Key files: ./bin/lifecycle.mjs, ./skills/unified-memory/references/lifecycle.md

## Decision

### 不加 cycle 前缀，统一根命令直接表达生命周期动作（2026-11-11）
- **Id:** unified-lifecycle/no-cycle-prefix
- **Source:** f8ea3e1, 5a25c4a
- **裁定:** 用户 2026-11-11 裁定「既然全量切换，cycle 反而多一层概念」——全量切换后分组前缀是多余概念层
- **落地:** f8ea3e1 以五个根命令直接落地控制面；5a25c4a 收口 serve 入口未知命令 rc2，stale 维护调用不再落穿 serve
- **Prevention:** 新增生命周期能力优先挂到既有根命令的参数面与报告契约，不引入分组前缀层

### 夜间调度单一拥有者（2026-11-11）
- **Id:** unified-lifecycle/single-schedule-owner
- **Source:** 5a25c4a, dotfiles cd8adf0, ./server/src/semantic_memory/config.py
- **规则:** 同一清扫任一时刻只有一个拥有者：接管方外部 crontab 定点 `02:00` 跑 `silicon-memory maintain --apply --json`，同时服务配置 `MEMORY_NOISE_SWEEP_AT=off`（config.toml `noise_sweep_at="off"` 同义）——serve 不启动内置夜扫线程
- **例外:** standalone（未接管调度）保留内置缺省 `03:30` 夜扫
- **接线边界:** 本仓不改 dotfiles/crontab，接线归部署方

## Strategy
- 热维护三操作（`purge`/`noise-sweep`/`distill`）走本地 `semantic-memory` CLI，不经 HTTP 批量闸、不依赖 `MEMORY_TOKEN`
- 插件控制面 settle 端点＝`/api/memory/settle`（旧 `/idle` 为兼容别名）
- 插件控制面 retire 端点＝`/api/memory/retire`（旧 `/supersede` 为兼容别名）
- 经验治理 runner＝dotfiles `mounts/opencode/groom-cron.sh`，经 `SM_EXPERIENCE_RUNNER` 注入 maintain 的 groom 面，未配置只报 `skipped:groom_unavailable`，且禁递归调用
- `maintain` 缺省 report-only，`--apply` 才实清；上线先跑观察窗口（`errors` 为空即健康）再切 `--apply`

## Bug Experience

### 插件集成测试项目夹具必须是有 origin 的临时 git 仓库（2026-11-11）
- **Id:** unified-lifecycle/integration-fixture-git-origin
- **Source:** 772736e, 3a88c2e
- **Symptom:** 夹具固定 `/tmp/mockproj` 非 git 无 origin——自动捕获被 `unresolvable_project` 拒收、显式 remember 降级全局，项目召回必空
- **Root cause:** 项目归一键来自 git origin；裸目录无归一键，W 写侧门把项目写降级为全局写
- **Fix:** `mockRepo(name)`＝mkdtemp 临时 git 仓＋各项目独立 origin（避免归一键撞桶串扰）；归一键 `*_KEY` 供 `/api/memories` 原样匹配，recall/ingest/ctx 仍传原路径走服务端 `resolve_project`
- **Prevention:** 任何触达项目归一/写路径的测试夹具一律 mkdtemp＋`git init`＋独立 origin，禁用固定裸目录
