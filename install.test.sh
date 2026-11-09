#!/usr/bin/env bash
# install.sh 沙箱回归：产物齐全＋幂等（双跑零变化）＋模型缺失提示
# 用法: bash install.test.sh <repo根>   （需 uv 在 PATH；全程隔离 HOME）
set -u
R="$(dirname "$(readlink -f "$0")")"
command -v uv >/dev/null || { echo "SKIP: uv 不在 PATH"; exit 0; }
F=$(mktemp -d /tmp/ae-fixture-inst-XXXX)
trap 'rm -rf "$F"' EXIT
mkdir -p "$F/home/.config/opencode"   # 主夹具模拟 opencode 在用（插件节探测在 skills mkdir 前完成）
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

# 插件/TUI 实体部署（拷贝非软链）
ck "plugin-copy"  '[ -f "$HOME/.config/opencode/plugins/memory.ts" ] && [ ! -L "$HOME/.config/opencode/plugins/memory.ts" ] && cmp -s "$HOME/.config/opencode/plugins/memory.ts" "$R/server/integrations/opencode/memory.ts"'
ck "tui-dir-copy" '[ -d "$HOME/.config/opencode/plugins/silicon-memory-tui" ] && [ ! -L "$HOME/.config/opencode/plugins/silicon-memory-tui" ]'
ck "tui-content"  'diff -r "$HOME/.config/opencode/plugins/silicon-memory-tui" "$R/server/integrations/opencode/silicon-memory-tui" >/dev/null'
ck "rc-line"       '[ "$(grep -c "MEMORY_DATA_DIR=" "$HOME/.bashrc")" = "1" ]'

# I5 回归：手加键在重跑后保留（config 合并语义）
printf 'SM_NOISE_PREFIXES=[agora]\n' >> "$HOME/.config/silicon-memory/config"
run >/dev/null 2>&1
ck "config-merge" 'grep -q "SM_NOISE_PREFIXES" "$HOME/.config/silicon-memory/config"'

# 幂等：快照受管面，二跑零 diff
before=$(cat "$HOME/.config/silicon-memory/config" "$HOME/.bashrc" 2>/dev/null; ls -l "$HOME/.local/bin" "$HOME/.config/opencode/skills" "$HOME/.config/opencode/plugins" 2>/dev/null)
run >/dev/null 2>&1
after=$(cat "$HOME/.config/silicon-memory/config" "$HOME/.bashrc" 2>/dev/null; ls -l "$HOME/.local/bin" "$HOME/.config/opencode/skills" "$HOME/.config/opencode/plugins" 2>/dev/null)
ck "idempotent" '[ "$before" = "$after" ]'

# 悬空软链先清再拷（回归：cp 跟链打到不存在路径必失败）
ln -sfn /nonexistent/memory.ts "$HOME/.config/opencode/plugins/memory.ts"
rm -rf "$HOME/.config/opencode/plugins/silicon-memory-tui"
ln -sfn /nonexistent/tui "$HOME/.config/opencode/plugins/silicon-memory-tui"
run >/dev/null 2>&1
ck "dangling-plugin" '[ ! -L "$HOME/.config/opencode/plugins/memory.ts" ] && cmp -s "$HOME/.config/opencode/plugins/memory.ts" "$R/server/integrations/opencode/memory.ts"'
ck "dangling-tui"    '[ ! -L "$HOME/.config/opencode/plugins/silicon-memory-tui" ] && cmp -s "$HOME/.config/opencode/plugins/silicon-memory-tui/tui.tsx" "$R/server/integrations/opencode/silicon-memory-tui/tui.tsx"'

# 活软链先清再拷（回归：cp 跟链写穿透外置目标、源==目标时 same-file 中止）
printf victim > "$F/victim.ts"
ln -sfn "$F/victim.ts" "$HOME/.config/opencode/plugins/memory.ts"
run >/dev/null 2>&1
ck "live-plugin" '[ ! -L "$HOME/.config/opencode/plugins/memory.ts" ] && cmp -s "$HOME/.config/opencode/plugins/memory.ts" "$R/server/integrations/opencode/memory.ts" && grep -q victim "$F/victim.ts"'

# opencode 未用（目录缺失）→ 插件节整节跳过（探测先于 skills 节 mkdir）
H2="$F/home2"; mkdir -p "$H2"
out2=$(HOME="$H2" SHELL=/bin/bash "$R/install.sh" --exp-store "$F/exp" --data-dir "$F/data" 2>&1)
ck "skip-no-opencode" '[ ! -e "$H2/.config/opencode/plugins" ]'
# EDATA 回退分支（无既有 config→本次 $DATA）钉路径，防回退硬编码回归假绿
ck "fallback-hint-path" 'printf "%s" "$out2" | grep -q "$F/data/models"'

# 模型缺失提示（沙箱 data 无 models）
out=$(HOME="$F/home" "$R/install.sh" --exp-store "$F/exp" --data-dir "$F/data" 2>&1)
ck "model-hint" 'printf "%s" "$out" | grep -q "模型"'
ck "model-hint-path" 'printf "%s" "$out" | grep -q "$F/data/models"'

echo "install-smoke: pass=$pass fail=$fail"; [ "$fail" -eq 0 ]
