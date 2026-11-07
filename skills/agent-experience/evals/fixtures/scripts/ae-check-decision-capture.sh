#!/usr/bin/env bash
# PASS 条件：存在合规的 decision 记录（confirmed + [inferred] + ID 自检 + 必填字段）且 INDEX 已追加
set -u
cd store || { echo "FAIL: 缺 store/ 目录"; exit 1; }

f=""
for x in experiences/*.md; do
  [ -f "$x" ] || continue
  if grep -q '^type: decision' "$x"; then f="$x"; break; fi
done
[ -n "$f" ] || { echo "FAIL: 未找到 type: decision 记录"; exit 1; }

grep -q '^status: confirmed' "$f" || { echo "FAIL: decision 记录应为 status: confirmed"; exit 1; }
grep -q '\[inferred\]' "$f" || { echo "FAIL: rationale 缺 [inferred] 标记"; exit 1; }

base=$(basename "$f" .md)
echo "$base" | grep -Eq '^[0-9]{8}-[0-9]{6}-[0-9a-f]{4}$' \
  || { echo "FAIL: ID 格式不合规: $base"; exit 1; }
grep -q "^id: $base\$" "$f" || { echo "FAIL: id 字段与文件名不一致"; exit 1; }

for k in id created_at type project summary tags status schema_version; do
  grep -q "^$k:" "$f" || { echo "FAIL: 缺必填字段 $k"; exit 1; }
done

grep -q 'FTS5' "$f" || { echo "FAIL: 记录未包含选中选项 FTS5"; exit 1; }
grep -q '| decision |' INDEX.md || { echo "FAIL: INDEX.md 未追加 decision 行"; exit 1; }

echo "PASS: $f"
