#!/usr/bin/env bash
# silicon-memory CLI 冒烟：子命令映射与 ae.mjs 直跑输出等价
# 用法: bash test-cli.sh [repo根]（缺省＝自 $0 上溯仓根，仓库内任意 cwd 可直跑）
set -u
R="$(readlink -f "${1:-$(dirname "$(readlink -f "$0")")/../../..}")"
BIN="$R/bin/silicon-memory"
F=$(mktemp -d /tmp/ae-fixture-cli-XXXX)
trap 'rm -rf "$F"' EXIT
mkdir -p "$F/store/experiences" "$F/kroot/modules"
cat > "$F/store/experiences/20990101-000000-aaaa.md" <<'MD'
---
id: 20990101-000000-aaaa
created_at: "2099-01-01T00:00:00Z"
type: debug
project: fixture
summary: dma-buf 缓存条目
tags: []
status: confirmed
schema_version: 1
Evidence: E0（fixture 蒸馏）
---
fixture body
MD
cat > "$F/kroot/modules/cache.md" <<'MD'
# Cache

dma-buf 缓存条目
MD
cat > "$F/kroot/knowledge-index.md" <<'MD'
# 知识索引
| 模块 | 一句话 | 详细路径 |
|------|--------|----------|
| cache | 测试 | ./modules/cache.md |
MD
pass=0; fail=0
ck() { if [ "$2" = "$3" ]; then pass=$((pass+1)); else fail=$((fail+1)); echo "FAIL[$1] got<${2:0:120}> want<${3:0:120}>"; fi; }

# 1. memory query 输出等价（query→dedup 别名）
ck query-alias "$("$BIN" memory query dma-buf --store "$F/store" 2>&1)" "$(node "$R/skills/agent-experience/bin/ae.mjs" dedup dma-buf --store "$F/store" 2>&1)"
# 2. knowledge query 输出等价
ck kquery "$(AE_KNOWLEDGE_PATH="$F/kroot" "$BIN" knowledge query dma-buf 2>&1)" "$(AE_KNOWLEDGE_PATH="$F/kroot" node "$R/skills/agent-experience/bin/ae.mjs" knowledge query dma-buf 2>&1)"
# 3. memory lint rc 等价
bash "$R/lint/lint.sh" "$F/store" >/dev/null 2>&1; w1=$?
"$BIN" memory lint "$F/store" >/dev/null 2>&1; w2=$?
ck lint-rc "$w2" "$w1"
# 4. knowledge ingest runbook
"$BIN" knowledge ingest 2>&1 | grep -q 'project-compound' && pass=$((pass+1)) || { fail=$((fail+1)); echo "FAIL[ingest]"; }
# 4b. knowledge cwd 上行解析（无 AE_KNOWLEDGE_PATH 时自用户 cwd 找 docs/agents/knowledge）
mkdir -p "$F/proj/docs/agents/knowledge/modules"
printf '# K\n\n探针条目 probe-token-xyz\n' > "$F/proj/docs/agents/knowledge/modules/k.md"
printf '# 知识索引\n' > "$F/proj/docs/knowledge-index-tmp" 2>/dev/null || true
out=$(cd "$F/proj" && unset AE_KNOWLEDGE_PATH; "$BIN" knowledge query probe-token-xyz 2>&1)
case "$out" in *proj/docs/agents/knowledge*) pass=$((pass+1));; *) fail=$((fail+1)); echo "FAIL[kquery-cwdwalk]";; esac

# 5. 未知命令组 rc=2
"$BIN" bogus >/dev/null 2>&1; ck bogus-rc "$?" "2"
# 6. 无参 usage rc=0
"$BIN" >/dev/null 2>&1; ck usage-rc "$?" "0"
echo "cli-smoke: pass=$pass fail=$fail"; [ "$fail" -eq 0 ]
