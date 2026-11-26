# Dream Retention

> Last updated: 2026-11-26

## Overview
- dream（做梦）＝记忆巩固引擎：同域近重 LWW 取代（遗忘加速器）＋TTL 收账（遗忘主引擎）＋复活重裁（误遗忘自修复），全机械零 LLM；max_per_night=200 遗忘限速（自然日跨 invocation 记账）
- 三面纪律：引擎面＝`semantic-memory dream`（server CLI 管理子命令）、机面＝`maintain --apply` 唯一 apply 入口（hot 车厢薄委托、02:00 单一拥有者）、人面＝notify 大白话邮件（产出即止，发送归部署方定时器）
- Key files: ./server/src/semantic_memory/dream.py, ./docs/superpowers/specs/2026-11-26-memory-groom-supersede-design.md, ./docs/superpowers/plans/2026-11-26-memory-dream.md, ./bin/lifecycle.mjs, ./skills/agent-experience/bin/ae.mjs
- See also: [unified-lifecycle](unified-lifecycle.md)

## Decision

### 取消 LLM 裁决机制——正确＝反复记忆的结果（2026-11-26）
- **Id:** dream-retention/no-llm-adjudication
- **Source:** ./docs/superpowers/specs/2026-11-26-memory-groom-supersede-design.md, 85add17, 390f6fe, /home/guangbin/.opencode-agora-plaza/wiki/wiki/why/ag-4b1d5d.md
- **裁定:** 做梦的关键是将错误记忆遗忘而非百分百保证正确——正确是被反复记忆而存活的内容（系统输出、非任何相位输入），故取消 LLM 裁决机制；复活重裁＝正确性机制本身（误遗忘自修复），翻不回的本就该忘
- **落地:** 四相位全机械管线（1aadb47 store 原语→8029fc4 编排）；85add17 纯 LWW 定向＋平局留人；390f6fe 蒸馏带邻居不再提问模型、≥pair_sim 自动新取旧（`superseded_by IS NULL` 守卫保留）
- **Prevention:** groom 类需求用机械信号（时间/复用/相似度）表达语义，禁引入 LLM 判同题性/正确性相位；误遗忘交给复活重裁＋TTL 兜底，不回头补裁决
- **Verbatim evidence（design §哲学／why ag-4b1d5d）:**

  ```text
  # docs/superpowers/specs/2026-11-26-memory-groom-supersede-design.md §哲学：
  **做梦＝记忆巩固：将重要的记忆加深，将不重要的记忆遗忘；不从正确与否出发——正确是反复记忆的结果。**
  **误遗忘自修复**：重要记忆被错杀后会被再次说起、再 touch，排序键刷新→复活重裁翻回；翻不回的本就该忘。**复活重裁＝正确性机制本身**，不是补丁。
  # wiki/wiki/why/ag-4b1d5d.md §备选与裁决：
  最终形态：**取消裁决机制**——"做梦的关键是将错误记忆遗忘，而不是百分百保证正确，正确是反复记忆的结果"
  ```

### LWW 排序键＝updated_at，实例指针无人工豁免（2026-11-26）
- **Id:** dream-retention/lww-updated-at-no-human-exemption
- **Source:** ./docs/superpowers/specs/2026-11-26-memory-groom-supersede-design.md, 85add17, /home/guangbin/.opencode-agora-plaza/wiki/wiki/why/ag-4b1d5d.md
- **裁定:** 方向由时间定——`updated_at` 新者存续（touch＝再确认，最近确认时间非创建时间），同刻平局不执行、进报告留人；人工仅立法与平局，人工 retire＝带时间戳的裁定事件平等进入 LWW，实例指针无豁免、覆盖/翻回人工指针是特性
- **落地:** 旧条目挂 `superseded_by=新uid`（可逆指针、零物理删除、不改 status/真值）；85add17 纯 LWW 定向＋平局留人；A1 人工指针豁免提案被驳回（防 dream 推翻人工 retire）后按此落地
- **Prevention:** 实例指针全机械——加人工豁免/白名单前先过「人工仅立法与平局」教条；平局不静默仲裁，报告列对留人定夺
- **Verbatim evidence（design §核心机制）:**

  ```text
  2. **方向（LWW）**：`updated_at` 新者存续（touch＝再确认，最近确认时间非创建时间）；**同刻平局→不执行，进报告留人**（人工仅立法与平局）。
  3. **执行**：旧条目挂 `superseded_by=新uid`（可逆指针、零物理删除、不改 status/真值）。**实例指针无人工豁免**：人工 retire＝一次带时间戳的裁定事件，与后续再确认平等进入 LWW
  # wiki/wiki/why/ag-4b1d5d.md：
  人工指针豁免提案（防 dream 推翻人工 retire）被驳回：入库已人工裁定，人工仅立法与平局——实例指针全机械。
  ```

### 不设 silicon-memory dream 外层根命令（2026-11-26）
- **Id:** dream-retention/no-outer-root-command
- **Source:** ./docs/superpowers/specs/2026-11-26-memory-groom-supersede-design.md, 9c3f5c8, 8dff698, fa24d1b
- **裁定:** 三落点分工——引擎面＝`semantic-memory dream`（server CLI 管理子命令、rc2 白名单同步）；机面＝唯一 apply 入口 `maintain --apply`（hot 车厢薄委托 dream、02:00 单一拥有者、接线归部署方）；人面＝notify 邮件大白话正文；不设 `silicon-memory dream` 外层根命令
- **落地:** 9c3f5c8 maintain hot 委托＋SKILL 命令表纪律行（v2.2 砍根命令）；`--apply` 纪律仅归 02:00 调度所有者、report-only 任何会话可跑；纪律落地三处＝dream 子命令 help、./skills/unified-memory/SKILL.md 命令表、dotfiles AGENTS 清单行（部署方）；设计稿把该裁定记为 2026-11-27（本页落库与提交时间线均为 11-26，相差一天——引文照录未改）
- **Prevention:** 新 groom 能力不加外层根命令——挂 maintain 参数面或 server 管理子命令；apply 权恒单一拥有者（02:00 调度），普通会话禁日常 apply
- **Verbatim evidence（design §dream 接口）:**

  ```text
  **不设 `silicon-memory dream` 外层根命令**（用户裁定 2026-11-27）：机面唯一 apply 入口＝`maintain --apply`（hot 车厢薄委托 dream，02:00 单一拥有者，接线归部署方，报告契约不变）；人面＝notify 邮件「做梦」。
  纪律落地三处：dream 子命令 help 文本、`skills/unified-memory/SKILL.md` 命令表、dotfiles AGENTS 清单行（部署方）。
  # git log b5daf9e..bc4e05c：
  9c3f5c8 feat(dream): maintain hot 委托＋SKILL 命令表纪律行（v2.2 砍根命令）
  ```

### 经验层强度键＝reuses.md 只读聚合，不回写 frontmatter（2026-11-26）
- **Id:** dream-retention/experience-strength-key
- **Source:** ./docs/superpowers/specs/2026-11-26-memory-groom-supersede-design.md（§分层落点）, 1aadb47
- **裁定:** 强度键＝`max(created_at, reuses.md 中该 id 最近复用时间)`——reuses.md＝经验层的反复记忆信号（复用即再确认、append-only 主数据），groom 波只读聚合、现算现用、不回写 frontmatter（090312 判例合规）
- **落地:** dream store 原语（1aadb47 翻转容许 supersede/复活候选）供波借用；复活自动：旧经验重新被复用→强度键刷新→下波翻回；经验无 TTL、groom 波归部署方 runner（SM_EXPERIENCE_RUNNER），仓内不落回写路径
- **Prevention:** 「把聚合结果写回存储」类优化先过 090312 判例（并发回写覆盖）——append-only 主数据＋只读聚合是共写安全边界，不造第二写点
- **Verbatim evidence（design §分层落点）:**

  ```text
  **强度键＝`max(created_at, reuses.md 中该 id 最近复用时间)`**——reuses.md＝经验层的反复记忆信号（复用即再确认，append-only 主数据）；groom 波运行时**只读聚合、现算现用**，不回写 frontmatter（090312 判例合规）。
  复活因此自动：旧经验重新被复用→强度键刷新→下波翻回。经验无 TTL（重要记忆只被取代不过期）。
  ```

## Bug Experience

### 「关键词重叠」规格短语被字面实现为单键命中，capture 预检闸自我失效（2026-11-26）
- **Id:** dream-retention/keyword-overlap-predicate
- **Source:** bc4e05c, bcc6ec0, /home/guangbin/.opencode-agora-plaza/wiki/tasks/ag-581248.md, /home/guangbin/.opencode-agora-plaza/state/messages/00015479.md
- **Symptom:** capture 预检闸（bcc6ec0）在同 project+type 的任意两段自然语言 summary 间近乎必撞——虚词单键即命中即拦，正常新经验全被当重复，闸自我失效
- **Root cause:** 设计稿命中判据写成「summary/根因行关键词重叠」级模糊短语，未钉死什么算一个键、几个键算命中；实现侧字面落成无停用词、无长度门、阈值≥1 的单键命中
- **Fix:** bc4e05c（ag-581248）：ASCII 词分支仅留 length≥3、非纯数字、非 STOP（固定 20 词）的词；二元组分支只发射含 ≥1 个 CJK 字符者（纯 ASCII 二元组不发射）；关键词路径 narrowed 需共享不同键 ≥2（tags 交集 ≥1 路径原样）；TDD 先红后绿 10/10
- **Prevention:** 谓词类规格必须钉到「什么算一个键＋几个键算命中」（过滤规则＋阈值逐项写死），禁留「关键词重叠」级模糊短语；评审对谓词段落先做机械撞车反证再放行
- **Verbatim evidence（任务页 ag-581248／结论笔记 00015479）:**

  ```text
  # wiki/tasks/ag-581248.md goal：
  现谓词在同 project+type 的任意两段自然语言 summary 间近乎必撞，闸自我失效
  # state/messages/00015479.md 【交付】：
  ae.mjs gateKeywords：ASCII 分支仅留 ≥3 字符、非纯数字、非 STOP（固定 20 词逐词照抄）的词；二元组分支只发射含 ≥1 个 CJK 字符者（v2 类纯 ASCII 二元组不发射）。
  ae.mjs captureGate：关键词路径 narrowed 需共享不同键 ≥2（中英混算）；tags 交集路径 ≥1 原样未动。
  ```

### verify 门裸 pytest 下 CLI 子进程测试须 PYTHONPATH=src（2026-11-26）
- **Id:** dream-retention/pythonpath-verify-gate
- **Source:** 1b41b0c, /home/guangbin/.opencode-agora-plaza/wiki/tasks/ag-4b1d5d.md, /home/guangbin/.opencode-agora-plaza/state/messages/00015427.md
- **Symptom:** ag-4b1d5d verify 门两轮红之次红——门以裸 pytest（系统 python、无 numpy）运行，`test_cli_purge_dry_run` 的 CLI 子进程缺 `PYTHONPATH=src`，系统 python 下 `semantic_memory` 不可导入而失败
- **Root cause:** CLI 冒烟用 `sys.executable -m semantic_memory` 子进程，不继承 pytest 注入的 pythonpath（pyproject `pythonpath=["src"]` 只作用于 pytest 进程内 import）；venv runner 靠 editable pth 掩盖缺口，系统 python runner 才暴露
- **Fix:** 1b41b0c 给该子进程补 `PYTHONPATH=src`（对齐 ./server/tests/test_lifecycle.py 既有兄弟用例的 env 注入模式；历史笔记的 lifecycle.py:502 系行号漂移前简写，见下方引文照录）；两 runner 全绿复验：venv pytest 509/3、系统 python 474/5（numpy 缺失致 test_dream 模块级 skip，非失败）
- **Prevention:** 新增 CLI 子进程用例照抄 ./server/tests/test_lifecycle.py 的 CLI 子进程 env 注入模式（`PYTHONPATH=src` 显式传给子进程，仓内多处同款；勿引用行号防漂移）；worktree 防测错对象＝`cd server && pytest tests -q`（pyproject pythonpath 使 worktree src 先于 editable pth）
- **Verbatim evidence（过程笔记 00015427／任务页 ag-4b1d5d）:**

  ```text
  # state/messages/00015427.md：
  ②次红＝gate 以裸 pytest（系统 python、无 numpy）运行——既有 test_cli_purge_dry_run 的 CLI 子进程缺 PYTHONPATH=src（其兄弟用例本就有），系统 python 下模块不可导入；已补齐同款（对齐 lifecycle.py:502 既有模式）
  # wiki/tasks/ag-4b1d5d.md 执行事实：
  Task 5 的 CLI 冒烟/rc2 收口在 pytest 内用 sys.executable -m semantic_memory 子进程实现（PYTHONPATH=src，勿依赖 PATH 上的 semantic-memory）
  ```
