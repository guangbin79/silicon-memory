#!/usr/bin/env bash
# ae capture --from selftest — 自含：临时 --store fixture；lint 用 cp-trick（lint.sh 的 cd dirname 语义，零改动）。
# 用例：无参铸 ID 不变 / mint 落盘 rc0+文件+id 回填+INDEX 行逐字+index --check rc0 / provided id 路径
#       + 排序插入后 index --check rc0 / 重复 id 拒绝 / 缺 frontmatter 拒绝 / 空 related 拒绝（lint §5 实例 20261022-162609-0544）/ 写入后 lint 零 findings
#       / created_at 含 | 拒绝（INDEX 列完整性）/ 控制字节拒绝 / 0 字节 INDEX 恢复 / header-only INDEX 恢复。
set -u

BIN=$(cd "$(dirname "$0")" && pwd)
AE="$BIN/ae.mjs"
NODE=$(command -v node || true)
[ -n "$NODE" ] || NODE=$(ls -1 "$HOME"/.nvm/versions/node/*/bin/node 2>/dev/null | tail -1)
[ -n "$NODE" ] || NODE=node
[ -x "$NODE" ] || { echo "ae-capture-write-selftest: node unavailable, abort"; exit 127; }

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

# 夹具：无 id（mint 路径）
cat > "$FIX/draft-noid.md" <<'EOF'
---
created_at: 2026-10-22
type: decision
project: selftest
status: draft
schema_version: 3
summary: capture selftest fixture record
tags: selftest,capture
Evidence: E1 transcript
---

# capture selftest fixture

body line
EOF

# 夹具：provided id（重复 id 用例复用）
cat > "$FIX/draft-withid.md" <<'EOF'
---
id: 20260101-000000-aaaa
created_at: 2026-01-01
type: tool
project: selftest
status: draft
schema_version: 3
summary: provided id fixture record
tags: selftest,provided
Evidence: E1 transcript
---

# provided id fixture

body line
EOF

# 夹具：缺 frontmatter
printf 'no frontmatter here\n' > "$FIX/draft-nofm.md"

# 夹具：空 related 行（lint §5）
sed 's/^tags: selftest,capture$/tags: selftest,capture\nrelated: /' "$FIX/draft-noid.md" > "$FIX/draft-emptyrel.md"

# 1. 无参 capture 行为不变（stdout 铸 YYYYMMDD-HHMMSS-<4hex>；--store 仅保密闭，cmdId 不触盘）
out=$("$NODE" "$AE" --store "$STORE" capture 2>&1)
rc=$?
[ "$rc" -eq 0 ] && echo "$out" | grep -qE '^[0-9]{8}-[0-9]{6}-[0-9a-f]{4}$'
report no-arg-mint-unchanged $?

# 2. mint 路径：rc0 + 落盘 + stdout id/路径 + id 行回填
out=$("$NODE" "$AE" --store "$STORE" capture --from "$FIX/draft-noid.md")
rc=$?
mid=$(printf '%s\n' "$out" | head -1)
fpath=$(printf '%s\n' "$out" | sed -n 2p)
[ "$rc" -eq 0 ] && [ -f "$fpath" ] && [ "$(basename "$fpath")" = "$mid.md" ] \
  && case "$fpath" in "$STORE"/experiences/*.md) true ;; *) false ;; esac \
  && grep -q "^id: $mid\$" "$fpath"
report mint-capture-rc0-backfilled $?

# 2b. 草稿保真：除回填 id 行外与草稿逐字节一致（R1-ocr）
diff <(awk -v id="$mid" '!ins && /^---$/ { print; print "id: " id; ins=1; next } { print }' "$FIX/draft-noid.md") "$fpath" >/dev/null
report mint-capture-draft-fidelity $?

# 3. INDEX 行逐字（summary/tags 逐字取 frontmatter）
row="$mid | 2026-10-22 | decision | selftest | capture selftest fixture record | selftest,capture"
grep -qxF "$row" "$STORE/INDEX.md"
report index-row-verbatim $?

# 4. index --check rc0
"$NODE" "$AE" --store "$STORE" index --check >/dev/null 2>&1
report index-check-in-sync $?

# 5. provided id 落盘到该 id 路径
out=$("$NODE" "$AE" --store "$STORE" capture --from "$FIX/draft-withid.md")
rc=$?
pid=$(printf '%s\n' "$out" | head -1)
[ "$rc" -eq 0 ] && [ "$pid" = "20260101-000000-aaaa" ] \
  && [ -f "$STORE/experiences/20260101-000000-aaaa.md" ]
report provided-id-path $?

# 6. 排序插入旧 id 后 index --check 仍 rc0
"$NODE" "$AE" --store "$STORE" index --check >/dev/null 2>&1
report index-check-after-sorted-insert $?

# 7. 重复 id 拒绝（rc≠0 且 store 零接触——含 INDEX 对拍）
n1=$(nexp)
idx_sig=$(cksum "$STORE/INDEX.md" | cut -d' ' -f1-2)
"$NODE" "$AE" --store "$STORE" capture --from "$FIX/draft-withid.md" >/dev/null 2>&1
rc=$?
[ "$rc" -ne 0 ] && [ "$(nexp)" = "$n1" ] && [ "$(cksum "$STORE/INDEX.md" | cut -d' ' -f1-2)" = "$idx_sig" ]
report duplicate-id-rejected $?

# 7b. 非法/路径逃逸 id 拒绝（ID_RE 前置门，store 零接触）
sed 's/^id: .*/id: ..\/..\/evil/' "$FIX/draft-withid.md" > "$FIX/draft-badid.md"
"$NODE" "$AE" --store "$STORE" capture --from "$FIX/draft-badid.md" >/dev/null 2>&1
rc=$?
[ "$rc" -ne 0 ] && [ "$(nexp)" = "$n1" ]
report invalid-id-rejected $?

# 8. 缺 frontmatter 拒绝
"$NODE" "$AE" --store "$STORE" capture --from "$FIX/draft-nofm.md" >/dev/null 2>&1
rc=$?
[ "$rc" -ne 0 ] && [ "$(nexp)" = "$n1" ]
report missing-frontmatter-rejected $?

# 9. 空 related 行拒绝
"$NODE" "$AE" --store "$STORE" capture --from "$FIX/draft-emptyrel.md" >/dev/null 2>&1
rc=$?
[ "$rc" -ne 0 ] && [ "$(nexp)" = "$n1" ]
report empty-related-rejected $?

# 9b. 草稿不可读拒绝（rc2，store 零接触）
"$NODE" "$AE" --store "$STORE" capture --from "$FIX/no-such-draft.md" >/dev/null 2>&1
rc=$?
[ "$rc" -ne 0 ] && [ "$(nexp)" = "$n1" ]
report unreadable-draft-rejected $?

# 9c. 缺 summary 回填 title（archived 豁免 lint §2；列 5＝body H1，对齐 regenerateIndex；R1-ocr）
sed -e 's/^status: draft$/status: archived/' -e '/^summary: /d' "$FIX/draft-noid.md" > "$FIX/draft-nosum.md"
out=$("$NODE" "$AE" --store "$STORE" capture --from "$FIX/draft-nosum.md")
rc=$?
sid=$(printf '%s\n' "$out" | head -1)
[ "$rc" -eq 0 ] && grep -qF "$sid | 2026-10-22 | decision | selftest | capture selftest fixture | selftest,capture" "$STORE/INDEX.md"
report missing-summary-backfills-title $?

# 10. 写入后 lint 零 findings（lint.sh 升格：store 首参）
LINT="$BIN/../../../lint/lint.sh"
[ -f "$LINT" ] || { echo "test-capture-write: lint.sh not found at $LINT"; exit 1; }
out=$(bash "$LINT" "$STORE" 2>&1)
rc=$?
[ "$rc" -eq 0 ] && printf '%s\n' "$out" | grep -q "lint PASS"
report lint-zero-findings $?

# 11. created_at 含 | 拒绝（INDEX 列完整性，R1-F1）
n1=$(nexp)
sed 's/^created_at: .*/created_at: 2026-01-01 | x | y/' "$FIX/draft-withid.md" > "$FIX/draft-pipe.md"
"$NODE" "$AE" --store "$STORE" capture --from "$FIX/draft-pipe.md" >/dev/null 2>&1
rc=$?
[ "$rc" -ne 0 ] && [ "$(nexp)" = "$n1" ]
report created-at-pipe-rejected $?

# 12. 控制字节拒绝（lint §5 同源，R1-F6）
n1=$(nexp)
esc=$(printf '\x1b')
sed "s/^summary: .*/summary: ${esc}[31mred${esc}[0m record/" "$FIX/draft-noid.md" > "$FIX/draft-ctrl.md"
"$NODE" "$AE" --store "$STORE" capture --from "$FIX/draft-ctrl.md" >/dev/null 2>&1
rc=$?
[ "$rc" -ne 0 ] && [ "$(nexp)" = "$n1" ]
report control-bytes-rejected $?

# 13. 0 字节 INDEX 恢复：无数据行按 fresh 整写 header+行（R1-F4）
S2="$FIX/store2"
mkdir -p "$S2"
: > "$S2/INDEX.md"
sed 's/^id: .*/id: 20260101-000000-bbbb/;s/^created_at: .*/created_at: 2026-01-01/' "$FIX/draft-withid.md" > "$FIX/draft-b.md"
"$NODE" "$AE" --store "$S2" capture --from "$FIX/draft-b.md" >/dev/null 2>&1
rc=$?
[ "$rc" -eq 0 ] && grep -qxF "# Experience Index" "$S2/INDEX.md" \
  && grep -qa "^20260101-000000-bbbb | " "$S2/INDEX.md"
report zero-byte-index-recovered $?
"$NODE" "$AE" --store "$S2" index --check >/dev/null 2>&1
report zero-byte-index-check $?

# 14. header-only INDEX 恢复（R1-F4）
S3="$FIX/store3"
mkdir -p "$S3"
grep -va "^20" "$S2/INDEX.md" > "$S3/INDEX.md"
sed 's/^id: .*/id: 20260101-000000-cccc/' "$FIX/draft-withid.md" > "$FIX/draft-c.md"
"$NODE" "$AE" --store "$S3" capture --from "$FIX/draft-c.md" >/dev/null 2>&1
rc=$?
[ "$rc" -eq 0 ] && grep -qa "^20260101-000000-cccc | " "$S3/INDEX.md"
report header-only-index-recovered $?
"$NODE" "$AE" --store "$S3" index --check >/dev/null 2>&1
report header-only-index-check $?

# 15. 写阶段回滚：INDEX.md 为目录→appendIndexRow 必失败→rc1 且记录文件回滚（R2-L7）
S4="$FIX/store4"
mkdir -p "$S4/experiences" "$S4/INDEX.md"
"$NODE" "$AE" --store "$S4" capture --from "$FIX/draft-b.md" >/dev/null 2>&1
rc=$?
[ "$rc" -ne 0 ] && [ "$(ls "$S4/experiences" | wc -l)" = 0 ]
report write-phase-rollback $?

# 16. archived 缺 summary 且 H1 含 | 拒绝（列 5 回填防线，R2-L8）
n1=$(nexp)
sed -e 's/^status: draft$/status: archived/' -e '/^summary: /d' -e 's/^# .*/# title | piped/' "$FIX/draft-noid.md" > "$FIX/draft-titlepipe.md"
"$NODE" "$AE" --store "$STORE" capture --from "$FIX/draft-titlepipe.md" >/dev/null 2>&1
rc=$?
[ "$rc" -ne 0 ] && [ "$(nexp)" = "$n1" ]
report title-pipe-rejected $?

if [ "$fails" -gt 0 ]; then
  echo "ae-capture-write-selftest: $fails case(s) FAILED"
  exit 1
fi
echo "ae-capture-write-selftest: all $total cases passed"
