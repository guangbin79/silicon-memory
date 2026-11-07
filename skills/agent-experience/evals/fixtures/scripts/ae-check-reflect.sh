#!/usr/bin/env bash
# PASS 条件：产出 reviews/reflect-*.md；报告证据覆盖 ≥2 个复发项目且含提案；experiences/ 文件数不变（只读）
set -u
cd store || { echo "FAIL: 缺 store/ 目录"; exit 1; }

n=$(ls experiences/*.md 2>/dev/null | wc -l)
[ "$n" -eq 5 ] || { echo "FAIL: experiences 应保持 5 条（Reflect 只读），实际 $n"; exit 1; }

rep=$(ls reviews/reflect-*.md 2>/dev/null | head -1)
[ -n "$rep" ] || { echo "FAIL: 未产出 reviews/reflect-*.md"; exit 1; }

projs=$(grep -oE "search-svc|admin-portal|mobile-api" "$rep" | sort -u | wc -l)
[ "$projs" -ge 2 ] || { echo "FAIL: 报告证据未覆盖 ≥2 个复发项目（实际 $projs）"; exit 1; }

grep -qE "提案|ingest" "$rep" || { echo "FAIL: 报告缺升华提案节"; exit 1; }

echo "PASS: reflect pattern report produced (read-only)"
