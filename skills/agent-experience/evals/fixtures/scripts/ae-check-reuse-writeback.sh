#!/usr/bin/env bash
# PASS 条件：命中且实际帮助任务后，收尾向 reuses.md 追加 helped 行（含被复用经验 ID、harness 列），且不改写原记录
set -u
cd store || { echo "FAIL: 缺 store/ 目录"; exit 1; }

[ -f reuses.md ] || { echo "FAIL: 未创建/未追加 reuses.md"; exit 1; }
grep -q '20260901-100000-ab12' reuses.md || { echo "FAIL: reuses.md 未引用被复用经验 ID"; exit 1; }
grep -Eq ' \| helped \| ' reuses.md || { echo "FAIL: reuses.md 缺 helped 标记（not-helped 不算）"; exit 1; }
grep -Eq 'opencode' reuses.md || { echo "FAIL: reuses.md 缺 harness 列（opencode）"; exit 1; }
grep -Eq '^20[0-9]{2}-[0-9]{2}-[0-9]{2}' reuses.md || { echo "FAIL: reuses.md 缺日期列"; exit 1; }

# 原记录不可被改写（E 级一次性定级不可回写）：frontmatter 保持原样
grep -q '^status: confirmed' experiences/20260901-100000-ab12.md \
  || { echo "FAIL: 被复用记录被改写"; exit 1; }

echo "PASS: reuses.md"
