# 2026-11-19 .gitattributes union 规则追加后自动 commit（范围 A）

## 意图
log.md/feedback.md 是 append-only 知识日志，靠仓根 .gitattributes 两行 merge=union 规则免并行追加丢行。规则只落工作区不提交时到不了其他 clone——追加成功后自动 commit，规则才能随版本库分发、在他机合并时生效。

## 决策
- 范围 A：仅本次真的追加了规则（appended.length > 0）且 .gitattributes 写入成功才 commit；规则已在（幂等重跑）零 commit。
- commit 命令：`git -C <repoRoot> add -- .gitattributes` ＋ `git -C <repoRoot> commit -m "chore: add union merge driver for append-only knowledge files" -- .gitattributes`。新建 .gitattributes 未跟踪时 partial-commit pathspec 只认已跟踪文件，故先 add 此路径——仍仅此 pathspec，不 add/commit 其他路径，绝不 push。
- 失败降级（与 writeFileSync 失败同款）：commit 失败（非真仓/.git 标记目录/无 identity/只读/rebase 中途）→ stderr 一行警告（取 git stderr 首个非空行），appended 照实返回、lint rc 语义不变、不崩。
- subject 严格等于上述固定消息，便于审计与幂等识别。

## 非目标
- 不 push。
- 不自愈「规则已在但未提交」的存量仓（appended 为空即零动作）。
- 不改 lint rc 语义与 unionLine 输出契约；不碰 lint/*.sh、server/、bin/。

## 验证口径（selfcheck 内自动化）
- 真 git init 夹具：lint 后恰好 1 个 commit；subject 严格相等；commit 只含 .gitattributes 且恰 2 行 merge=union；二次 lint 零新 commit。
- .git 标记目录夹具（非真仓）：降级不崩、appended 照实（既有 union 测试段覆盖）。
- 任务页 verify_cmd（A1–A4）全绿。
