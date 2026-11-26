#!/usr/bin/env bash
# ae capture --from 预检闸 selftest — 自含：临时 --store fixture；模式对齐 test-capture-write.sh。
# 用例（dream ag-4b1d5d 收窄谓词＋已处置豁免）：
#   ① 同 project+type 但 tags 无交集且 summary/根因关键词不重叠 → 不拦直接落盘
#   ② tags 交集命中未处置 → rc2 零写（stderr 列候选；INDEX 对拍）
#   ③ 命中但草稿 related: 已链 → 放行
#   ④ --force-new → 放行
#   ⑤ summary 关键词重叠（tags 无交集）→ rc2 零写
#   ⑥ 根因段关键词重叠（debug 型，tags/summary 均不相交）→ rc2 零写
#   ⑦ 未知旗标拒绝 rc2
set -u

BIN=$(cd "$(dirname "$0")" && pwd)
AE="$BIN/ae.mjs"
NODE=$(command -v node || true)
[ -n "$NODE" ] || NODE=$(ls -1 "$HOME"/.nvm/versions/node/*/bin/node 2>/dev/null | tail -1)
[ -n "$NODE" ] || NODE=node
[ -x "$NODE" ] || { echo "ae-capture-gate-selftest: node unavailable, abort"; exit 127; }

FIX=$(mktemp -d)
trap 'rm -rf "$FIX"' EXIT
STORE="$FIX/store"
fails=0
total=0

report() { # <name> <cond：0=pass>
  total=$((total + 1))
  if [ "$2" -eq 0 ]; then
    echo "PASS $1"
  else
    echo "FAIL $1"
    fails=$((fails + 1))
  fi
}

nexp() { ls "$STORE/experiences" 2>/dev/null | wc -l; }

# 底座记录 A：decision 型（tags vendor,alpha；summary 词汇 alpha toolchain）
mkdir -p "$STORE/experiences"
cat > "$STORE/experiences/20260101-000000-aaaa.md" <<'EOF'
---
id: 20260101-000000-aaaa
created_at: 2026-01-01
type: decision
project: gateproj
status: confirmed
schema_version: 3
summary: vendor choice settled on alpha toolchain
tags: vendor,alpha
Evidence: E1 transcript
---

# vendor alpha choice

body
EOF
# 底座记录 D：debug 型（根因段含「字段偏移」；tags/summary 与后续草稿不相交）
cat > "$STORE/experiences/20260101-000000-dddd.md" <<'EOF'
---
id: 20260101-000000-dddd
created_at: 2026-01-01
type: debug
project: gateproj
status: confirmed
schema_version: 3
summary: parser tolerance investigation
tags: parser,tolerance
Evidence: E1 transcript
---

# parser tolerance investigation

## Root Cause
字段偏移导致错位
EOF

# 底座 INDEX（与底座记录对齐——index --check 同步前提）
cat > "$STORE/INDEX.md" <<'EOF'
# Experience Index

> Derived cache. Regenerable from the experience files. Do not hand-edit beyond appending rows. Column 5 is summary (title for legacy rows).
> Rebuild: `grep -h "^id:" experiences/*.md 2>/dev/null | sort`

id | date | type | project | summary | tags
---|------|------|---------|-------|------
20260101-000000-aaaa | 2026-01-01 | decision | gateproj | vendor choice settled on alpha toolchain | vendor,alpha
20260101-000000-dddd | 2026-01-01 | debug | gateproj | parser tolerance investigation | parser,tolerance
EOF

# 草稿①：同 project+type，tags 无交集、summary 词汇不相交 → 不拦
cat > "$FIX/d1-nohit.md" <<'EOF'
---
created_at: 2026-11-26
type: decision
project: gateproj
status: draft
schema_version: 3
summary: release cadence quarterly review
tags: cadence,quarterly
Evidence: E1 transcript
---

# release cadence review

body
EOF

# 草稿②：tags 交集（vendor）命中未处置 → rc2 零写
cat > "$FIX/d2-taghit.md" <<'EOF'
---
created_at: 2026-11-26
type: decision
project: gateproj
status: draft
schema_version: 3
summary: vendor migration plan
tags: vendor,migration
Evidence: E1 transcript
---

# vendor migration plan

body
EOF

# 草稿③：命中但 related: 已链底座 A → 放行
sed 's/^tags: vendor,migration$/tags: vendor,migration\nrelated: 20260101-000000-aaaa/' "$FIX/d2-taghit.md" > "$FIX/d3-related.md"

# 草稿⑤：tags 无交集但 summary 共享关键词 vendor → rc2
cat > "$FIX/d5-keyword.md" <<'EOF'
---
created_at: 2026-11-26
type: decision
project: gateproj
status: draft
schema_version: 3
summary: vendor strategy differs
tags: strategy,beta
Evidence: E1 transcript
---

# vendor strategy differs

body
EOF

# 草稿⑥：debug 型，tags/summary 均不相交，根因段共享「字段偏移」→ rc2
cat > "$FIX/d6-rootcause.md" <<'EOF'
---
created_at: 2026-11-26
type: debug
project: gateproj
status: draft
schema_version: 3
summary: serializer strict mode
tags: serializer,strict
Evidence: E1 transcript
---

# serializer strict mode

## Root Cause
字段偏移复现于新样本
EOF

# ① 无交集不拦：rc0 + 落盘
out=$("$NODE" "$AE" --store "$STORE" capture --from "$FIX/d1-nohit.md" 2>"$FIX/e1")
rc=$?
[ "$rc" -eq 0 ] && [ "$(nexp)" -eq 3 ] && grep -q "release cadence quarterly review" "$STORE/INDEX.md"
report no-overlap-passes $?

# ② tags 交集命中未处置：rc2 + 零写 + stderr 列候选
n1=$(nexp)
idx_sig=$(cksum "$STORE/INDEX.md" | cut -d' ' -f1-2)
err=$("$NODE" "$AE" --store "$STORE" capture --from "$FIX/d2-taghit.md" 2>&1 >/dev/null)
rc=$?
[ "$rc" -eq 2 ] && [ "$(nexp)" -eq "$n1" ] && [ "$(cksum "$STORE/INDEX.md" | cut -d' ' -f1-2)" = "$idx_sig" ]
report tag-hit-blocks-zero-write $?
printf '%s' "$err" | grep -q "20260101-000000-aaaa" && printf '%s' "$err" | grep -q "预检闸"
report tag-hit-lists-candidates-stderr $?

# ③ related: 已链 → 放行
out=$("$NODE" "$AE" --store "$STORE" capture --from "$FIX/d3-related.md" 2>/dev/null)
rc=$?
[ "$rc" -eq 0 ] && [ "$(nexp)" -eq 4 ]
report related-chain-exempted $?

# ④ --force-new → 放行（草稿②本体，未申报）
out=$("$NODE" "$AE" --store "$STORE" capture --from "$FIX/d2-taghit.md" --force-new 2>/dev/null)
rc=$?
[ "$rc" -eq 0 ] && [ "$(nexp)" -eq 5 ]
report force-new-passes $?

# ⑤ summary 关键词重叠（tags 无交集）→ rc2 零写
n1=$(nexp)
idx_sig=$(cksum "$STORE/INDEX.md" | cut -d' ' -f1-2)
"$NODE" "$AE" --store "$STORE" capture --from "$FIX/d5-keyword.md" >/dev/null 2>&1
rc=$?
[ "$rc" -eq 2 ] && [ "$(nexp)" -eq "$n1" ] && [ "$(cksum "$STORE/INDEX.md" | cut -d' ' -f1-2)" = "$idx_sig" ]
report summary-keyword-hit-blocks $?

# ⑥ 根因段关键词重叠 → rc2 零写
n1=$(nexp)
idx_sig=$(cksum "$STORE/INDEX.md" | cut -d' ' -f1-2)
"$NODE" "$AE" --store "$STORE" capture --from "$FIX/d6-rootcause.md" >/dev/null 2>&1
rc=$?
[ "$rc" -eq 2 ] && [ "$(nexp)" -eq "$n1" ] && [ "$(cksum "$STORE/INDEX.md" | cut -d' ' -f1-2)" = "$idx_sig" ]
report root-cause-hit-blocks $?

# ⑦ 未知旗标拒绝 rc2（store 零接触）
n1=$(nexp)
"$NODE" "$AE" --store "$STORE" capture --from "$FIX/d1-nohit.md" --bogus >/dev/null 2>&1
rc=$?
[ "$rc" -eq 2 ] && [ "$(nexp)" -eq "$n1" ]
report unknown-flag-rejected $?

# ⑧ 写入后 index --check rc0（闸放行路径不破坏 INDEX 同步）
"$NODE" "$AE" --store "$STORE" index --check >/dev/null 2>&1
report index-check-in-sync $?

if [ "$fails" -gt 0 ]; then
  echo "ae-capture-gate-selftest: $fails case(s) FAILED"
  exit 1
fi
echo "ae-capture-gate-selftest: all $total cases passed"
