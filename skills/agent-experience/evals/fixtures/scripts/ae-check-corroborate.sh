#!/usr/bin/env bash
# PASS 条件：新建了第二条记录（佐证链），且新记录 related: 链到旧 ID；旧记录 status 未被改写
set -u
cd store || { echo "FAIL: 缺 store/ 目录"; exit 1; }

n=$(ls experiences/*.md 2>/dev/null | wc -l)
[ "$n" -eq 2 ] || { echo "FAIL: 期望 2 个经验文件（佐证链新建），实际 $n 个"; exit 1; }

newf=$(ls experiences/*.md | grep -v "20260902-090000-cd02" | head -1)
[ -n "$newf" ] || { echo "FAIL: 未找到新记录"; exit 1; }

grep -q "^related:.*20260902-090000-cd02" "$newf" || { echo "FAIL: 新记录 related 未链旧 ID: $newf"; exit 1; }
grep -q "^project: embed-proj" "$newf" || { echo "FAIL: 新记录 project 应为 embed-proj"; exit 1; }

old="experiences/20260902-090000-cd02.md"
st=$(grep -m1 "^status:" "$old" | cut -d' ' -f2)
[ "$st" = "confirmed" ] || { echo "FAIL: 旧记录 status 被改写: $st"; exit 1; }

echo "PASS: corroboration chain respected"
