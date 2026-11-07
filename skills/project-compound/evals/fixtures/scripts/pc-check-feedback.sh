#!/usr/bin/env bash
# PASS 条件：feedback.md 存在且含条目 Id 与 outcome；条目本体未被追加 Impact 行（反馈外部化）；log.md 有收尾条目
set -u
fb="docs/agents/knowledge/feedback.md"
[ -f "$fb" ] || { echo "FAIL: 未产出 $fb"; exit 1; }
grep -q "cache/lru-over-redis" "$fb" || { echo "FAIL: feedback.md 未引用条目 Id"; exit 1; }
grep -q "worked" "$fb" || { echo "FAIL: feedback.md 缺 outcome (worked)"; exit 1; }
if grep -q "Impact:" docs/agents/knowledge/modules/cache.md; then
  echo "FAIL: 反馈被写进条目本体（应外部化到 feedback.md）"; exit 1
fi
n=$(grep -c "^## " docs/agents/knowledge/log.md)
[ "$n" -ge 2 ] || { echo "FAIL: log.md 未追加收尾条目（当前 $n 条）"; exit 1; }
echo "PASS: entry feedback externalized to feedback.md"
