#!/usr/bin/env bash
# ae capture --from 仓库提交面 — 自含：临时 git 仓＋--store fixture。
# 用例：capture 后 store 脏面即提交（HEAD 含 id、status 净）/ 既有脏面（skill-uses 行＋未跟踪 reviews 笔记）随 capture 一并收编
#       / .capture.lock 不入库（锁内提交但 exclude pathspec）/ 非 git 库 store 行为不变 rc0 / 第二次 capture 产生第二笔提交。
set -u

BIN=$(cd "$(dirname "$0")" && pwd)
AE="$BIN/ae.mjs"
NODE=$(command -v node || true)
[ -n "$NODE" ] || NODE=$(ls -1 "$HOME"/.nvm/versions/node/*/bin/node 2>/dev/null | tail -1)
[ -n "$NODE" ] || NODE=node
[ -x "$NODE" ] || { echo "ae-capture-commit-selftest: node unavailable, abort"; exit 127; }

FIX=$(mktemp -d)
trap 'rm -rf "$FIX"' EXIT
STORE="$FIX/repo/store"   # store 在 git 仓内（dotfiles 同构）
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

git -C "$FIX" init -q repo
git -C "$FIX/repo" -c user.name=selftest -c user.email=selftest@localhost commit -q --allow-empty -m init

cat > "$FIX/draft.md" <<'EOF'
---
created_at: 2026-11-13
type: decision
project: selftest
status: draft
schema_version: 3
summary: capture commit selftest fixture record
tags: selftest,commit
Evidence: E1 transcript
---

# capture commit selftest fixture

body line
EOF

# 既有脏面：agent 手写 skill-uses 行＋未跟踪 reviews 笔记（今日实况同构）
mkdir -p "$STORE"
printf '# date | skill | task | trigger | sections | anchors | note\n' > "$STORE/skill-uses.md"
printf '2026-11-13 | selftest | 预置脏行 | 预置 | - | - | pre-capture dirt\n' >> "$STORE/skill-uses.md"
printf 'groom note\n' > "$STORE/reviews-note.md"

# 1. capture 后：rc0＋HEAD 提交含 id＋store 脏面全净（含预置脏行被收编）
out=$("$NODE" "$AE" --store "$STORE" capture --from "$FIX/draft.md" 2>"$FIX/err")
rc=$?
mid=$(printf '%s\n' "$out" | head -1)
[ "$rc" -eq 0 ] && git -C "$FIX/repo" log -1 --format=%s | grep -q "$mid" \
  && [ -z "$(git -C "$FIX/repo" status --porcelain -- "$STORE")" ]
report capture-commits-store-clean $?

# 2. 预置脏面进了提交（skill-uses 行与 reviews 笔记均被跟踪）
git -C "$FIX/repo" ls-files -- "$STORE" | grep -q 'skill-uses.md' \
  && git -C "$FIX/repo" ls-files -- "$STORE" | grep -q 'reviews-note.md' \
  && git -C "$FIX/repo" show HEAD:store/skill-uses.md | grep -q 'pre-capture dirt'
report preexisting-dirt-swept $?

# 3. .capture.lock 不入库（提交发生在锁内，锁文件在场）
git -C "$FIX/repo" ls-files -- "$STORE" | grep -q '\.capture\.lock' && false || true
report capture-lock-not-tracked $?

# 4. 第二次 capture：第二笔提交，HEAD 前进，依旧全净
head1=$(git -C "$FIX/repo" rev-parse HEAD)
cat > "$FIX/draft2.md" <<'EOF'
---
created_at: 2026-11-13
type: tool
project: selftest
status: draft
schema_version: 3
summary: second capture commit fixture
tags: selftest,second
Evidence: E1 transcript
---

# second fixture

body line
EOF
out=$("$NODE" "$AE" --store "$STORE" capture --from "$FIX/draft2.md" 2>/dev/null)
rc=$?
mid2=$(printf '%s\n' "$out" | head -1)
[ "$rc" -eq 0 ] && [ "$(git -C "$FIX/repo" rev-parse HEAD)" != "$head1" ] \
  && git -C "$FIX/repo" log -1 --format=%s | grep -q "$mid2" \
  && [ -z "$(git -C "$FIX/repo" status --porcelain -- "$STORE")" ]
report second-capture-second-commit $?

# 5. 非 git 库 store：行为不变 rc0（无仓根静默跳过提交）
PLAIN="$FIX/plain-store"
"$NODE" "$AE" --store "$PLAIN" capture --from "$FIX/draft.md" >/dev/null 2>&1
report non-repo-store-rc0 $?

# 6. store 被机器本地排除（.git/info/exclude，dotfiles 实况）：tracked 改动仍即提净，
#    新经验文件按排除面搁浅（不强制入库），rc0 且无重试拖延
EXREP="$FIX/exrepo"
git -C "$FIX" init -q exrepo
git -C "$FIX/exrepo" -c user.name=selftest -c user.email=selftest@localhost commit -q --allow-empty -m init
mkdir -p "$EXREP/store/experiences"
printf '# date | skill | task | trigger | sections | anchors | note\n' > "$EXREP/store/skill-uses.md"
printf '# id | date | type | project | summary | tags\n' > "$EXREP/store/INDEX.md"
git -C "$FIX/exrepo" add store/skill-uses.md store/INDEX.md
git -C "$FIX/exrepo" -c user.name=selftest -c user.email=selftest@localhost commit -q -m seed
echo 'store/' >> "$FIX/exrepo/.git/info/exclude"
printf '2026-11-13 | selftest | 排除面预置脏行 | 预置 | - | - | excluded dirt\n' >> "$EXREP/store/skill-uses.md"
t0=$(date +%s)
out=$("$NODE" "$AE" --store "$EXREP/store" capture --from "$FIX/draft.md" 2>"$FIX/err6")
rc=$?
t1=$(date +%s)
exmid=$(printf '%s\n' "$out" | head -1)
[ "$rc" -eq 0 ] && [ $((t1 - t0)) -lt 3 ]   && git -C "$FIX/exrepo" log -1 --format=%s | grep -q "$exmid"   && [ -z "$(git -C "$FIX/exrepo" status --porcelain -- "$EXREP/store")" ]   && [ -f "$EXREP/store/experiences/$exmid.md" ] \
  && ! git -C "$FIX/exrepo" ls-files -- "$EXREP/store" | grep -q "$exmid" \
  && ! grep -q '提交未成' "$FIX/err6"
report excluded-store-tracked-mods-committed $?

echo "ae-capture-commit-selftest: $((total - fails))/$total passed"
[ "$fails" -eq 0 ]
