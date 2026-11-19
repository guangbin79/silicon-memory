# 2026-11-19 .gitattributes union 规则追加后自动 commit（范围 A）

## 意图
log.md/feedback.md 是 append-only 知识日志，靠仓根 .gitattributes 两行 merge=union 规则免并行追加丢行。规则只落工作区不提交时到不了其他 clone——追加成功后自动 commit，规则才能随版本库分发、在他机合并时生效。

## 决策
- 范围 A：仅本次真的追加了规则（appended.length > 0）且 .gitattributes 写入成功才 commit；规则已在（幂等重跑）零 commit。
- commit 命令：`git -C <repoRoot> add -- .gitattributes` ＋ `git -C <repoRoot> commit -m "chore: add union merge driver for append-only knowledge files" -- .gitattributes`。新建 .gitattributes 未跟踪时 partial-commit pathspec 只认已跟踪文件，故先 add 此路径——仍仅此 pathspec，不 add/commit 其他路径，绝不 push。
- 失败降级（与 writeFileSync 失败同款）：commit 失败（非真仓/无 identity/只读/rebase 中途）→ stderr 一行警告（git stderr 首个非空行，空则 exit/signal 兜底），appended 照实返回、lint rc 语义不变、不崩。
- ident 探针先行：`git var GIT_COMMITTER_IDENT`（与 commit 同源判定）失败即在 add 前降级——无 identity（CI 常态）不再留下 add 成功后 commit 失败的暂存区残留；git 调用带 30s timeout，用户仓 pre-commit 钩子挂起不拖死 lint。
- subject 严格等于上述固定消息，便于审计与幂等识别。

## 已知残留（终闸 B 册裁定：记录不改，改则越批准设计）
- commit 对象是整份 .gitattributes：既有未提交的 WIP 行会被一并卷入该 chore commit（partial-commit pathspec 语义固有）。
- rebase/merge 中途等 add 成功而 commit 失败的残余场景仍可能留暂存（罕见，pathspec 限 .gitattributes）。
- 自动 commit 会执行用户仓 git 钩子（不主动 --no-verify/改 hooksPath——属批准命令语义外的策略变更）；挂起由 timeout 兜底。

## 非目标
- 不 push。
- 不自愈「规则已在但未提交」的存量仓（appended 为空即零动作）。
- 不改 lint rc 语义与 unionLine 输出契约；不碰 lint/*.sh、server/、bin/。

## 验证口径（selfcheck 内自动化）
- 真 git init 夹具：lint 后恰好 1 个 commit；subject 严格相等；commit 只含 .gitattributes 且恰 2 行 merge=union；二次 lint 零新 commit。
- .git 标记目录夹具（非真仓）：降级不崩、appended 照实（既有 union 测试段覆盖）。
- 任务页 verify_cmd（A1–A4）全绿。
