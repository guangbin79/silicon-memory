# dream（做梦）接口实现计划·修订版 v2

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现做梦接口——groom 定时调用的记忆自动整理统一面：全机械 LWW 近重收敛（零 LLM 裁决）＋既有三维护操作收编为相位，附 `/recall` 折叠与 capture 预检闸。

**Architecture:** server 侧新增 `dream.py`（配对→LWW 定向→执行→报告，全参数注入可测，无 LLM），经 `semantic-memory dream`（server CLI 子命令＝引擎面）暴露；mjs 侧 maintain hot 收敛为单一 dream 委托——**不设 `silicon-memory dream` 外层根命令**（v2.2 裁定：机面唯一入口＝maintain，人面＝notify 邮件）。方向全走 `updated_at`；正确性交给反复记忆（复活重裁自修复）。

**Tech Stack:** Python（server/src/semantic_memory，pytest）＋ Node ESM（bin/lifecycle.mjs，node:test）＋ bash（ae.mjs 测试脚本）。

**Spec:** `docs/superpowers/specs/2026-11-26-memory-groom-supersede-design.md`（Task 1 落库；源 `/home/guangbin/.opencode/plan/2026-11-26-memory-groom-supersede-design.md`——先读 spec 再动工）

## Global Constraints

- **零 LLM**：dream 全程无模型调用——无裁决、无置信分、无 M/E/H 分档（E 取消）；只有 M（自动挂指针）与 H-tie（时间平局留人）。
- 零物理删除：M 动作上限＝`superseded_by` 指针；`deleted` 只有既有 `run_maintenance` TTL 相位可动。
- 方向只由 `memories.updated_at` 定（LWW，touch＝再确认）；重述/翻供不区分；同刻平局→H-tie 零执行、进报告。
- **实例指针无人工豁免**：`dream_apply` 不做来源判别，允许覆盖/翻回人工 retire 指针（用户裁定 2026-11-26；人工仅立法与平局）。
- 配置：`pair_sim`＝0.92（env `MEMORY_DREAM_PAIR_SIM`）、`max_per_night`＝200（`MEMORY_DREAM_MAX_PER_NIGHT`，**遗忘限速**，自然日跨 invocation 记账，report-only 同计费）、`fold_sim`＝0.95（`MEMORY_FOLD_SIM`）。
- report-only：supersede 相位全管线 dry-run（配对定向照跑、写零落）；distill/purge 相位 `skipped:report_only`；noise 相位 dry_run。
- 无 embedder（向量不可用）→ supersede 相位 `skipped:unavailable`，其余相位照跑。
- 异常局部降级：配对/执行出错→相位内 errors 计数、跳过该批，不抛穿 `run_dream`。
- **相位间写提交后才进下一相位**（all_vectors 写后读缓存窗口，db.py 注释明令；禁跨相位事务）。
- maintain 五根命令报告契约不变；hot 三 op（noiseSweep/purge/distill）收敛为单一 `dream` op（已知 op 名变更）。
- **无外层根命令（v2.2）**：不新增 `silicon-memory dream` mjs/bash 命令面；dream 引擎面＝server CLI 子命令；机面唯一 apply 入口＝`maintain --apply`；`--apply` 纪律（仅归 02:00 调度所有者，普通会话禁日常）写进 dream 子命令 help 文本与 `skills/unified-memory/SKILL.md` 命令表。
- server CLI `_KNOWN_COMMANDS` 白名单加 `"dream"`（rc2 收口同步）。**部署序：server CLI 先于 mjs 委托面**。
- 显式 remember/capture 直存语义不变；经验层 groom 波、云通道并流、知识层新代码不在本计划。

## Review Focus

1. **LWW 翻转＝正确性机制**：被取代条目再确认（touch 刷 updated_at）→ 次夜翻回（含翻回人工 retire 指针）→ Task 1（`dream_apply` 清反向指针、无来源豁免）＋Task 2（revival 进配对池）测试钉住。
2. **翻供对不区分**："偏好X/不再偏好X"高相似对 → 无模型参与，新者存活 → Task 3 测试钉住。
3. **时间平局**：`a_ts==b_ts` → H-tie 零执行 → Task 3 测试钉住。
4. **无 embedder**：supersede skipped、noise/purge 照跑 → Task 4 测试钉住。
5. **折叠误伤**：cos<fold_sim 相似对双双存活；跨域不折 → Task 7 测试钉住。

---

### Task 1: store 原语＋档案落库

**Files:**
- Modify: `server/src/semantic_memory/db.py`
- Create: `server/tests/test_dream.py`
- Create: `docs/superpowers/specs/2026-11-26-memory-groom-supersede-design.md`、`docs/superpowers/plans/2026-11-26-memory-dream.md`（自 `/home/guangbin/.opencode/plan/` 同名文件复制）

**Interfaces:**
- Produces:
  - `MemoryStore.dream_apply(self, loser: str, winner: str) -> bool`——置 `loser.superseded_by=winner, superseded_at=now`；若 `winner.superseded_by == loser` 先清空（翻转容许）；**无来源判别**（注释引用裁定：实例指针全机械 LWW，人工 retire 不豁免）；返回是否变更。
  - `MemoryStore.revival_candidates(self, since: float) -> list[sqlite3.Row]`——`superseded_by IS NOT NULL AND deleted=0 AND updated_at>?`，列 `uid, updated_at`。
  - `MemoryStore.vectors_of(self, uids: list[str]) -> dict[str, "np.ndarray | None"]`。
  - `MemoryStore.distinct_projects(self) -> list[str]`——`deleted=0 AND superseded_by IS NULL` 活跃 project 去重。

- [ ] **Step 1: 失败测试**

```python
def test_dream_apply_reverses_pointer(tmp_path):
    # B 已 superseded_by=A（前向，含人工来源）→ dream_apply(A, B) 翻转无豁免
    assert store.dream_apply("uid_a", "uid_b") is True
    assert db_row("uid_b")["superseded_by"] == "uid_a"
    assert db_row("uid_a")["superseded_by"] is None

def test_revival_candidates_only_recently_touched(tmp_path):
    # superseded 且 updated_at>since 进候选；其余不进
```

- [ ] **Step 2: 红**——`server/venv/bin/python -m pytest server/tests/test_dream.py -q`，FAIL（AttributeError）
- [ ] **Step 3: 实现**（dream_apply 单事务：先清 winner 反向指针再落 loser 指针，提交后返回；不碰 `deleted`）
- [ ] **Step 4: 绿**
- [ ] **Step 5: 落库＋提交**

```bash
cp /home/guangbin/.opencode/plan/2026-11-26-memory-groom-supersede-design.md docs/superpowers/specs/
cp /home/guangbin/.opencode/plan/2026-11-26-memory-dream.md docs/superpowers/plans/
git add docs/superpowers server/src/semantic_memory/db.py server/tests/test_dream.py
git commit -m "feat(dream): store 原语（翻转容许 supersede/复活候选/向量批取）＋设计稿落库"
```

### Task 2: 配对＋预算＋日志 schema（前置）

**Files:**
- Create: `server/src/semantic_memory/dream.py`
- Modify: `server/tests/test_dream.py`

**Interfaces:**
- Produces:
  - `Pair`：dict `{a_uid, a_ts, b_uid, b_ts, domain}`，恒 `a_ts < b_ts`（ts 相等的不配——留 Task 3 判 H-tie：改为 `a_ts <= b_ts` 入对，方向判定在路由）。
  - `collect_pairs(store, cfg, last_run_ts: float | None) -> list[Pair]`——global 桶 `all_vectors(None,"global")`＋各 project 桶 `all_vectors(p,"all")`；cos≥`cfg.pair_sim` 成对；`revival_candidates(last_run_ts)` 并入配对池；前夜日志已报且两侧 `updated_at<=last_run_ts` 的对跳过（H-tie 不重复报）；预算截断＋报告标记。
  - **日志 schema（本任务钉死，Task 4 照写）**：JSONL，每行 `{date, a_uid, b_uid, loser, winner, outcome}`，`outcome ∈ {"M","H-tie"}`；职责＝平局去重＋事后审计/回滚依据。
  - `day_state(path) -> dict`／`spend(path, n) -> bool`——`{"date","pairs":N}` 自然日计数。

- [ ] **Step 1: 失败测试**——global 层两条改写近重配成对且 `a_uid`=旧；project/global 桶不交叉；`max_per_night=2` 配 3 对出 2＋截断标记；前夜已报 H-tie 对跳过；revival 条目入池。
- [ ] **Step 2: 红**（ModuleNotFoundError）；- [ ] **Step 3: 实现**（纯函数＋store 注入，无 LLM/embedder 依赖）；- [ ] **Step 4: 绿**
- [ ] **Step 5: 提交**——`"feat(dream): 同域配对＋遗忘限速＋日志 schema"`

### Task 3: LWW 定向＋平局路由（无裁决）

**Files:**
- Modify: `server/src/semantic_memory/dream.py`、`server/tests/test_dream.py`

**Interfaces:**
- Produces: `route(pairs, cfg) -> list[Action]`——`Action {pair, tier, loser, winner}`：`a_ts < b_ts`→`{tier:"M", loser:a_uid, winner:b_uid}`；`a_ts == b_ts`→`{tier:"H-tie", loser:None, winner:None}`。**无 model_call、无置信分、无 relation。**

- [ ] **Step 1: 失败测试**——①"偏好X/不再偏好X"对（fake 向量高 cos）→ M 且 loser=旧侧（无模型参与）；②ts 相等→H-tie 且 loser/winner 为 None；③route 全程无 LLM 调用（无可注入面即证明）。
- [ ] **Step 2-4: 红绿**；- [ ] **Step 5: 提交**——`"feat(dream): 纯 LWW 定向＋平局留人"`

### Task 4: 执行＋报告＋相位编排

**Files:**
- Modify: `server/src/semantic_memory/dream.py`、`server/tests/test_dream.py`

**Interfaces:**
- Consumes: `flush_distill_queue(store, distiller, embedder=embedder)`、`noise_sweep(store, dry_run)`、`run_maintenance(store, ttl_artifact_days=…, ttl_injection_days=…, ttl_stale_days=…, dry_run=…)`（相位 2-4＝server.py main() 三分支同款调用）。
- Produces:
  - `run_dream(store, cfg, distiller, embedder, apply: bool = False) -> dict`——report `{status, day_state, phases: {supersede, distill, noise, purge}, errors}`；相位序 supersede→distill→purge→noise，**每相位写提交后再进下一相位**。supersede：配对→route→apply 才 `dream_apply`；报告全量列对（人事后抽查/回滚依据）；无 embedder→`skipped:unavailable`。distill/purge 相位 apply-only；noise `dry_run=not apply`。
  - `write_dream_log(report) -> Path`——按 Task 2 schema 写 JSONL（对齐 `write_noise_sweep_log` 模式）。
  - **报告常驻 `notify` 段（邮件就绪，spec「通知面」）**：`subject`（一行计数）＋`text`（预渲染正文，直接当邮件 body，**大白话无术语**——"归并/让位/翻回来/拿不定主意等你定/久无人用自然过期"，术语不出现）＋`important[]`＋`counts`。重要筛选全机械：H-tie 全列附处置命令；翻回对全列；解释类（kind!="fact"）取代对全列附旧/新摘要；fact 对只计数；预算截断与相位异常全列。report-only 正文加 `DRY-RUN（未执行）`前缀。发邮件归定时器（部署方），本仓零 SMTP。

- [ ] **Step 1: 失败测试**——①apply=False：`dream_apply` 零调用、distill/purge `skipped:report_only`；②apply=True：M 对落指针、H-tie 不执行、日志含全量对；③无 embedder：supersede skipped、noise/purge 照跑；④配对抛错：errors 非空、正常返回；⑤notify：counts 正确，H-tie/翻回/解释类各入 `important`，fact 对仅计数，正文无技术术语（断言不含 "supersede"/"LWW"/"updated_at"），report-only 时 text 含 `DRY-RUN` 前缀。
- [ ] **Step 2-4: 红绿**；- [ ] **Step 5: 提交**——`"feat(dream): 四相位编排＋report-only/--apply＋局部降级"`

### Task 5: 配置＋server CLI

**Files:**
- Modify: `server/src/semantic_memory/config.py`、`server/src/semantic_memory/server.py`、`server/tests/test_dream.py`

**Interfaces:**
- Produces: cfg 键 `pair_sim=0.92, max_per_night=200, fold_sim=0.95`（env `MEMORY_DREAM_PAIR_SIM`/`MEMORY_DREAM_MAX_PER_NIGHT`/`MEMORY_FOLD_SIM`，沿既有 `s("ENV","key","default")` 模式）；`_KNOWN_COMMANDS`＋`"dream"`；main() 分支：`if cmd == "dream": print(json.dumps(run_dream(store, cfg, distiller, embedder, apply="--apply" in args), ensure_ascii=False)); return`

- [ ] **Step 1: 失败测试**——`MEMORY_DREAM_PAIR_SIM=0.95`→`cfg.pair_sim==0.95`；`"dream" in _KNOWN_COMMANDS`。
- [ ] **Step 2-4: 红绿**；- [ ] **Step 5: 提交**——`"feat(dream): 配置键＋管理子命令（rc2 收口）"`

### Task 6: 蒸馏带自动新取旧（取消提问）

**Files:**
- Modify: `server/src/semantic_memory/distiller.py`（提示词移除带邻居裁决段）、`server/src/semantic_memory/lifecycle.py`（flush 带邻居处理）
- Test: `server/tests/test_dream.py` 追加

**规则（pinned）：** 带邻居不再进提示词问"是否取代/是否同题"——模型只管蒸馏本身。应用侧：带邻居 cos≥`cfg.pair_sim` 且 <NEAR_HI(0.98) → 自动 `supersedes` 对 `(new=本批新条, old=带邻居)` 进既有 SQL（`superseded_by IS NULL` 守卫保留）；<pair_sim 的带邻居不动（由 dream 存量面/TTL 兜）；≥NEAR_HI 仍走既有 touch 不新增。

- [ ] **Step 1: 失败测试**——构造带邻居 cos 0.95（[pair_sim, NEAR_HI) 区间）：flush 后旧条被标、新条插入，**模型输出无需 supersedes 字段**；cos 0.80 带邻居：不标。
- [ ] **Step 2-4: 红绿**（只动提示词带邻居段与应用判定，不动队列结构）；- [ ] **Step 5: 提交**——`"feat(dream): 蒸馏带取消裁决提问，≥pair_sim 自动新取旧"`

### Task 7: /recall 近重折叠（可提前至 Task 1 后执行，独立止血）

**Files:**
- Modify: `server/src/semantic_memory/server.py`（`_recall_hits` 尾部）、`server/tests/test_dream.py`

**Interfaces:**
- Consumes: `store.vectors_of(uids)`、`cfg.fold_sim`。
- Produces: 同域分组（project 相等，`None==None`）；组内 cos≥`fold_sim` 簇折叠为 `max(updated_at)` 一条（平局比 created_at 再比 uid）；无向量条目原样保留；`rest_recall` 响应加 `"folded": N`（additive）。

- [ ] **Step 1: 失败测试**——同域近重仅新者返回＋`folded==1`；阈下双双返回；跨域不折；无向量存活。
- [ ] **Step 2-4: 红绿**；- [ ] **Step 5: 提交**——`"feat(dream): /recall 注入前 LWW 折叠（零存储写）"`

### Task 8: mjs 面——maintain hot 委托＋SKILL 命令表（v2.2：砍外层根命令）

**Files:**
- Modify: `bin/lifecycle.mjs`、`bin/lifecycle.test.mjs`、`README.md`、`README.zh-CN.md`、`skills/unified-memory/SKILL.md`、`docs/superpowers/{specs,plans}/` 落库档案（v2.2 重拷）

**Interfaces:**
- Produces: `adapters.hot.dream = async ({apply}) => smCli(["dream", ...(apply?["--apply"]:[])])`；maintain hot 车厢（lifecycle.mjs:156-171）三动作收敛为单一 `{layer:"hot", op:"dream", dry_run:!apply}`＋report 嵌 dream 报告。**不新增 `silicon-memory dream` 根命令**（用户裁定：外层入口唯一＝maintain；dream 引擎面＝server CLI 子命令；人面＝notify 邮件）——无 `cmdDream`、bash 不加 `dream)` case、`runLifecycle` 不接 dream 命令。
- `skills/unified-memory/SKILL.md` 命令表补 dream 行（对齐 maintain 行格式）：引擎面 `semantic-memory dream`——report-only 安全诊断；`--apply` 仅归 02:00 调度所有者，普通 agent 日常禁用。
- server CLI dream 子命令 help/usage 文本写同款纪律句。

- [ ] **Step 1: 失败测试**——①`maintain --apply`→hot 仅一个 dream 动作（旧三 op 断言改写）；②report-only→`dry_run:true`；③缺省 maintain→dream 照调；④`dream` 作为 runLifecycle 命令＝UsageError rc2（钉住无根命令）。
- [ ] **Step 2-4: 红绿**（删 maintain 三旧段与 adapters 对应项，保留 recall/settle/supersede/dream；README 更新为「maintain hot 委托 dream 引擎」口径，无根命令）
- [ ] **Step 5: 档案同步＋提交**——把 v2.2 源计划与设计稿（`/home/guangbin/.opencode/plan/` 同名文件）重拷入 `docs/superpowers/{specs,plans}/` 覆盖 v2.1 副本；`git commit -m "feat(dream): maintain hot 委托＋SKILL 命令表纪律行（v2.2 砍根命令）"`

### Task 9: capture 预检闸（收窄谓词＋已处置豁免）

**Files:**
- Modify: `skills/agent-experience/bin/ae.mjs`（`cmdCapture` 前置预检＋`--force-new`）
- Create: `skills/agent-experience/bin/test-capture-gate.sh`（模式对齐 `test-capture-write.sh`）

**Interfaces:**
- Produces: `cmdCapture(store, draftPath, forceNew=false)`——写盘前：①候选＝`grep "^project: <P>"`∩`grep "^type: <T>"`；②命中收窄＝候选中 tags 与草稿交集≥1 或 summary/根因行关键词重叠；③**已处置豁免**：命中 id 出现在草稿 frontmatter `related:`/`supersedes:` 链→放行；④未处置命中且未 forceNew→stderr 列候选＋提示，rc2，**store 零接触**（闸先于 id 铸造/INDEX/落盘）。

- [ ] **Step 1: 失败测试**（bash mkdtemp store 夹具）——①同 project+type 但 tags 无交集→**不拦**直接落盘；②tags 交集命中未处置→rc2 零写；③命中但草稿 `related:` 已链→放行；④`--force-new`→放行。
- [ ] **Step 2-4: 红绿**；- [ ] **Step 5: 全量回归**——`server/venv/bin/python -m pytest server/tests -q`＋`node --test bin/lifecycle.test.mjs`＋`bash skills/agent-experience/bin/test-capture-gate.sh`＋既有 `test-capture-write.sh` 不回归；- [ ] **Step 6: 提交**——`"feat(dream): capture 预检闸（收窄谓词＋related 链豁免）"`

---

**覆盖说明（非任务项）**：知识层修正归写入面 ingest＋lint 兜漏（既有路径，无新代码）；热层人事后审＝dream 报告全量列对＋逐对 `retire` 回滚；经验层 groom 矛盾波（强度键＝max(created_at, reuses.md 最近复用)，只读聚合）与云通道并流＝部署方/后续项。
