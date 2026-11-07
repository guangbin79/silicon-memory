#!/usr/bin/env bash
# PASS 条件：ae.mjs cards 对 fixture store+fixture events（AE_EVENTS_PATH 显式注入）输出
# 五类呈批卡 ①五节标题齐（含信念证据晋升） ②canary 卡（promoted|agent  # canary 且有  # canary 使用 注记）
# ③reuses.md 第 2 列命中的 draft 出卡 ④无命中 draft 不出卡 ⑤两跑 stdout 逐字节一致
# ⑥零命中全空态 rc0 不 crash；并验证 QA 失败面：删注记→canary 卡消失
# ⑦欠账负边界日期运行时相对化（F2 时间炸弹修复 2026-10-10）：#0002=now-2d、#0005=now+40d，任何墙钟日期恒绿
set -u
cd store || { echo "FAIL: 缺 store/ 目录"; exit 1; }
WS=$(cd .. && pwd)

# 被测 CLI＝候选副本（AE_SKILL_SRC 裁决面）：优先 $0 相对候选根，回退引擎 fakehome 技能软链
SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
CLI="$SCRIPT_DIR/../../../bin/ae.mjs"
[ -f "$CLI" ] || CLI="$WS/.eval-home/.config/opencode/skills/agent-experience/bin/ae.mjs"
[ -f "$CLI" ] || { echo "FAIL: 无法定位候选 bin/ae.mjs"; exit 1; }

EVSRC="$WS/events-fixture.md"
[ -f "$EVSRC" ] || { echo "FAIL: 缺 events-fixture.md"; exit 1; }

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
cp "$EVSRC" "$tmp/events.md"
# F2 时间炸弹修复（2026-10-10）：欠账负边界样本 promoted 日期运行时相对化（sed 落在 fixture 副本）——
# #0002 redate 为 now-2 天（恒 <14 天不出卡），追加 #0005 为 now+40 天未来样本（age 为负亦不出卡）；
# ≥14 天正边界仍由 fixture 固定老样本 #0000（20260920）覆盖，边界在任意墙钟日期下稳定。
FRESH_TS="$(date -d '-2 days' +%Y%m%d)-090000"
FUTURE_TS="$(date -d '+40 days' +%Y%m%d)-090000"
sed -i "/#0002-fresh-skill/ s/20261008-090000/${FRESH_TS}/g" "$tmp/events.md"
printf '%s | %s-01 | agent-experience | #0005-fresh-future | promoted | human | .skill-evolution/candidates/#0005-fresh-future/REVIEW.md\n' "$FUTURE_TS" "$FUTURE_TS" >> "$tmp/events.md"

run_cards() { AE_EVENTS_PATH="$1" node "$CLI" cards --store "$PWD" > "$2" 2>"$2.err"; return $?; }
section() { # $1=输出文件 $2=节标题前缀 → 打印该节正文（至下一节头/EOF）
  awk -v h="$2" '$0 ~ "^" h {on=1; next} /^## /{on=0} on' "$1"
}

# S1 主 fixture：五节标题齐＋两跑确定性
run_cards "$tmp/events.md" "$tmp/out1"; rc1=$?
run_cards "$tmp/events.md" "$tmp/out2"; rc2=$?
[ "$rc1" -eq 0 ] && [ "$rc2" -eq 0 ] || { echo "FAIL: cards rc≠0（rc1=$rc1 rc2=$rc2）"; cat "$tmp/out1.err"; exit 1; }
cmp -s "$tmp/out1" "$tmp/out2" || { echo "FAIL: 两跑 stdout 不逐字节一致（确定性破坏）"; diff "$tmp/out1" "$tmp/out2"; exit 1; }
for h in '## canary 转全量' '## draft 确认' '## 升华提案' '## 欠账' '## 信念证据晋升'; do
  grep -q "^$h" "$tmp/out1" || { echo "FAIL: 缺分节标题 $h"; cat "$tmp/out1"; exit 1; }
done
grep -q '（零命中——本节空）' "$tmp/out1" && { echo "FAIL: 主 fixture 各节均应有卡，却出现空态标记"; cat "$tmp/out1"; exit 1; }

# ② canary 卡（限 canary 节内）
section "$tmp/out1" '## canary 转全量' > "$tmp/sec-canary"
grep -q '#0003-canary-pilot' "$tmp/sec-canary" || { echo "FAIL: canary 节缺 #0003-canary-pilot（promoted|agent # canary＋使用注记应出卡）"; cat "$tmp/out1"; exit 1; }

# ③ 命中 draft 出卡（限 draft 节内）
section "$tmp/out1" '## draft 确认' > "$tmp/sec-draft"
grep -q '20260901-100000-ab12' "$tmp/sec-draft" || { echo "FAIL: draft 节缺 reuses 第 2 列命中样本 ab12"; cat "$tmp/out1"; exit 1; }
grep -q '20260901-120000-ab01' "$tmp/sec-draft" && { echo "FAIL: confirmed 记录 ab01 不应出确认卡"; exit 1; }

# ④ 无命中 draft 不出卡（全输出层面断言）
grep -q '20260902-100000-ab13' "$tmp/out1" && { echo "FAIL: 无 reuses 命中的 ab13 不应出现"; cat "$tmp/out1"; exit 1; }

# ⑤ 信念证据晋升：E3+ belief draft 出卡（限信念节内），且不入 draft 确认节（#0025）
section "$tmp/out1" '## 信念证据晋升' > "$tmp/sec-belief"
grep -q '20260905-100000-ab14' "$tmp/sec-belief" || { echo "FAIL: 信念节缺 E3 belief draft 样本 ab14"; cat "$tmp/out1"; exit 1; }
grep -q '20260905-100000-ab14' "$tmp/sec-draft" && { echo "FAIL: belief ab14 不应入 draft 确认节"; exit 1; }

# 升华提案：pending 出卡、approved 不出卡
section "$tmp/out1" '## 升华提案' > "$tmp/sec-sublime"
grep -q 'sublime-20260915-lexer-fix.md' "$tmp/sec-sublime" || { echo "FAIL: 升华提案节缺 verdict: pending 样本"; cat "$tmp/out1"; exit 1; }
grep -q 'sublime-20260920-doc-clean.md' "$tmp/out1" && { echo "FAIL: approved 提案不应出卡"; exit 1; }

# 欠账：≥14 天无 outcome 出卡；有 outcome 与 <14 天不出卡
section "$tmp/out1" '## 欠账' > "$tmp/sec-debt"
grep -q '#0000-debt-owes' "$tmp/sec-debt" || { echo "FAIL: 欠账节缺 #0000-debt-owes（≥14 天 promoted 无 outcome）"; cat "$tmp/out1"; exit 1; }
grep -q '#0001-old-verified' "$tmp/out1" && { echo "FAIL: 有 outcome_verified 的 #0001 不应出欠账卡"; exit 1; }
grep -q '#0002-fresh-skill' "$tmp/out1" && { echo "FAIL: <14 天的 #0002 不应出欠账卡"; exit 1; }
grep -q '#0005-fresh-future' "$tmp/out1" && { echo "FAIL: 未来日期(+40 天) promoted 的 #0005 不应出欠账卡"; cat "$tmp/out1"; exit 1; }
grep -q '#0004-never-promoted' "$tmp/out1" && { echo "FAIL: 无 promoted 的 #0004 不应出任何卡"; exit 1; }

# S2 QA 失败面：删除 canary 使用注记 → canary 卡消失
grep -v '  # canary 使用' "$tmp/events.md" > "$tmp/events-mut.md"
run_cards "$tmp/events-mut.md" "$tmp/out3" || { echo "FAIL: 变体运行 rc≠0"; exit 1; }
section "$tmp/out3" '## canary 转全量' > "$tmp/sec-canary3"
grep -q '#0003-canary-pilot' "$tmp/sec-canary3" && { echo "FAIL: 删使用注记后 canary 卡应消失"; cat "$tmp/out3"; exit 1; }

# S3 零命中空态：空 store（无 proposals 目录、events 仅头注释）→ 五节全空态 rc0 不 crash
mkdir -p "$tmp/store2/experiences"
printf -- '---\nid: 20260101-090000-zzzz\ncreated_at: 2026-01-01\ntype: tool\nproject: P\nsummary: archived\nstatus: archived\nschema_version: 1\n---\n' > "$tmp/store2/experiences/20260101-090000-zzzz.md"
printf '# date | id | project | harness | outcome | note\n' > "$tmp/store2/reuses.md"
printf '# 仅头注释\n' > "$tmp/events-empty.md"
AE_EVENTS_PATH="$tmp/events-empty.md" node "$CLI" cards --store "$tmp/store2" > "$tmp/out4" 2>/dev/null
rc4=$?
[ "$rc4" -eq 0 ] || { echo "FAIL: 零命中空态 rc≠0（$rc4）"; cat "$tmp/out4"; exit 1; }
n_empty=$(grep -c '（零命中——本节空）' "$tmp/out4")
[ "$n_empty" -eq 5 ] || { echo "FAIL: 五节应各 1 条空态标记，实际 $n_empty"; cat "$tmp/out4"; exit 1; }
for h in '## canary 转全量' '## draft 确认' '## 升华提案' '## 欠账' '## 信念证据晋升'; do
  grep -q "^$h" "$tmp/out4" || { echo "FAIL: 空态输出缺 $h"; cat "$tmp/out4"; exit 1; }
done

echo "PASS: cards 五类卡/确定性/排除边界/空态（含删注记 canary 卡消失）"
