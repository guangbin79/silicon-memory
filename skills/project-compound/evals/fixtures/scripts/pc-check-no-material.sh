#!/usr/bin/env bash
# PASS 条件：log 有 No material 条目；modules/ 下没有创建任何模块文件
set -u
wd="docs/agents/knowledge"

[ -f "$wd/log.md" ] || { echo "FAIL: 缺 log.md"; exit 1; }
grep -q 'No material' "$wd/log.md" || { echo "FAIL: log 缺 No material 条目"; exit 1; }

n=0
if [ -d "$wd/modules" ]; then
  n=$(ls "$wd"/modules/*.md 2>/dev/null | wc -l)
fi
[ "$n" -eq 0 ] || { echo "FAIL: 琐碎任务不应创建模块文件，发现 $n 个"; exit 1; }

echo "PASS: no-material path clean"
