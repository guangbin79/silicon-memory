#!/usr/bin/env bash
# PASS 条件：观察类经验捕获即 confirmed（D3 扩展）——frontmatter 含 epistemic: observational、
# status: confirmed、summary 含可复验具体标识符，body 带 Evidence: E<n> 定级行
set -u
cd store || { echo "FAIL: 缺 store/ 目录"; exit 1; }

n=$(ls experiences/*.md 2>/dev/null | wc -l)
[ "$n" -eq 2 ] || { echo "FAIL: 期望 2 个经验文件（新建 1 条观察类），实际 $n 个"; exit 1; }

newf=$(ls experiences/*.md | grep -v "20260901-120000-ab01" | head -1)
[ -n "$newf" ] || { echo "FAIL: 未找到新记录"; exit 1; }

grep -q '^epistemic: observational' "$newf" || { echo "FAIL: 新记录缺 epistemic: observational（$newf）"; exit 1; }
grep -q '^status: confirmed' "$newf" || { echo "FAIL: 观察类应捕获即 confirmed（D3 扩展），实际：$(grep -m1 '^status:' "$newf")"; exit 1; }
grep -Eq '^summary:.*(x86_64-unknown-linux-gnu|cargo|config\.toml)' "$newf" \
  || { echo "FAIL: summary 缺可复验具体标识符：$(grep -m1 '^summary:' "$newf")"; exit 1; }
grep -Eq '^Evidence: E[0-4]' "$newf" || { echo "FAIL: body 缺 Evidence: E<n> 定级行"; exit 1; }

echo "PASS: observational captured as confirmed"
