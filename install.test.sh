#!/usr/bin/env bash
# install.sh 沙箱回归：产物齐全＋幂等（双跑零变化）＋模型缺失提示
# 用法: bash install.test.sh <repo根>   （需 uv 在 PATH；全程隔离 HOME）
set -u
R="$(dirname "$(readlink -f "$0")")"
command -v uv >/dev/null || { echo "SKIP: uv 不在 PATH"; exit 0; }
F=$(mktemp -d /tmp/ae-fixture-inst-XXXX)
trap 'rm -rf "$F"' EXIT
mkdir -p "$F/home"
export HOME="$F/home"
export SHELL=/bin/bash
pass=0; fail=0
ck() { if eval "$2"; then pass=$((pass+1)); else fail=$((fail+1)); echo "FAIL[$1]"; fi; }

run() { HOME="$F/home" "$R/install.sh" --exp-store "$F/exp" --data-dir "$F/data"; }
run >/dev/null 2>&1; ck "first-run-rc0" '[ $? -eq 0 ]'
ck "config-exp"    'grep -q "SM_EXP_STORE=$F/exp" "$HOME/.config/silicon-memory/config"'
ck "config-data"   'grep -q "SM_DATA_DIR=$F/data" "$HOME/.config/silicon-memory/config"'
ck "bin-cli"       '[ -x "$HOME/.local/bin/silicon-memory" ] && [ "$(readlink -f "$HOME/.local/bin/silicon-memory")" = "$R/bin/silicon-memory" ]'
ck "bin-server"    '[ -x "$HOME/.local/bin/semantic-memory" ]'
ck "venv-vector"   '"$R/server/venv/bin/python" -c "import numpy" 2>/dev/null'
for s in agent-experience project-compound unified-memory; do
  ck "skill-$s"    '[ "$(readlink -f "$HOME/.config/opencode/skills/'$s'")" = "$R/skills/'$s'" ]'
done
ck "rc-line"       '[ "$(grep -c "MEMORY_DATA_DIR=" "$HOME/.bashrc")" = "1" ]'

# I5 回归：手加键在重跑后保留（config 合并语义）
printf 'SM_NOISE_PREFIXES=[agora]\n' >> "$HOME/.config/silicon-memory/config"
run >/dev/null 2>&1
ck "config-merge" 'grep -q "SM_NOISE_PREFIXES" "$HOME/.config/silicon-memory/config"'

# 幂等：快照受管面，二跑零 diff
before=$(cat "$HOME/.config/silicon-memory/config" "$HOME/.bashrc" 2>/dev/null; ls -l "$HOME/.local/bin" "$HOME/.config/opencode/skills" 2>/dev/null)
run >/dev/null 2>&1
after=$(cat "$HOME/.config/silicon-memory/config" "$HOME/.bashrc" 2>/dev/null; ls -l "$HOME/.local/bin" "$HOME/.config/opencode/skills" 2>/dev/null)
ck "idempotent" '[ "$before" = "$after" ]'

# 模型缺失提示（沙箱 data 无 models）
out=$(HOME="$F/home" "$R/install.sh" --exp-store "$F/exp" --data-dir "$F/data" 2>&1)
ck "model-hint" 'printf "%s" "$out" | grep -q "模型"'

echo "install-smoke: pass=$pass fail=$fail"; [ "$fail" -eq 0 ]
