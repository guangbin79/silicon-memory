#!/usr/bin/env bash
# PASS 条件：同根因经验只保留 1 个文件（更新或跳过均可），不得出现重复文件
set -u
cd store || { echo "FAIL: 缺 store/ 目录"; exit 1; }

n=$(ls experiences/*.md 2>/dev/null | wc -l)
[ "$n" -eq 1 ] || { echo "FAIL: 期望仅 1 个经验文件（去重），实际 $n 个"; exit 1; }

c=$(grep -l 'CMAKE_TOOLCHAIN_MISMATCH' experiences/*.md 2>/dev/null | wc -l)
[ "$c" -eq 1 ] || { echo "FAIL: 根因标记文件数异常: $c"; exit 1; }

echo "PASS: dedup respected"
