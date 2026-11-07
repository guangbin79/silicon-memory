#!/usr/bin/env bash
# PASS 条件：种子文件齐全；存在带 Source/Chosen 的模块记录；log 有可解析条目与 Types 行
set -u
wd="docs/agents/knowledge"

[ -f "$wd/knowledge-index.md" ] || { echo "FAIL: 缺 knowledge-index.md"; exit 1; }
[ -f "$wd/log.md" ] || { echo "FAIL: 缺 log.md"; exit 1; }
grep -q '模块列表' "$wd/knowledge-index.md" || { echo "FAIL: index 缺种子表"; exit 1; }
grep -Eq '^\| ?(search|fulltext|全文|检索)' "$wd/knowledge-index.md" \
  || grep -Eq '^\| [a-z-]+ \|' <(tail -n +4 "$wd/knowledge-index.md") \
  || { echo "FAIL: index 模块表无数据行"; exit 1; }

hit=""
for f in "$wd"/modules/*.md; do
  [ -f "$f" ] || continue
  if grep -q '\*\*Source:\*\*' "$f" && grep -q '\*\*Chosen:\*\*' "$f"; then
    hit="$f"; break
  fi
done
[ -n "$hit" ] || { echo "FAIL: modules/ 下无带 Source+Chosen 的决策记录"; exit 1; }
grep -q 'FTS5' "$hit" || { echo "FAIL: 决策记录未提及 FTS5"; exit 1; }

grep -q '^## \[' "$wd/log.md" || { echo "FAIL: log 缺可解析条目（## [ 日期头）"; exit 1; }
grep -q 'Types:' "$wd/log.md" || { echo "FAIL: log 条目缺 Types 行"; exit 1; }

echo "PASS: module=$hit"
