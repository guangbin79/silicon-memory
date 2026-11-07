#!/usr/bin/env bash
# silicon-memory 安装器：两问接线（数据不动），产物幂等可重跑。
# 用法: ./install.sh [--exp-store DIR] [--data-dir DIR]   # 缺参交互询问
# 产物: ~/.config/silicon-memory/config、~/.local/bin/{silicon-memory,semantic-memory}、
#       ~/.config/opencode/skills/{3 skills} 软链、~/.config/agentctl/ext/{memory,knowledge}.sh、
#       shell rc 缺 MEMORY_DATA_DIR export 时补一行
set -euo pipefail
R="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"

EXP=""; DATA=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --exp-store) EXP="$2"; shift 2 ;;
    --data-dir)  DATA="$2"; shift 2 ;;
    *) echo "未知参数: $1（支持 --exp-store/--data-dir）" >&2; exit 2 ;;
  esac
done
ask() { # <提示> <默认>
  local a=""
  if [ -t 0 ]; then read -r -p "$1 [$2]: " a; fi
  echo "${a:-$2}"
}
[ -n "$EXP" ]  || EXP="$(ask '全局经验目录' "$HOME/.agent-experiences")"
[ -n "$DATA" ] || DATA="$(ask '语义记忆目录' "$HOME/.hotmem")"
mkdir -p "$EXP" "$DATA"

# 1. config（agentctl/ae.mjs 与插件共读；写前 diff 保幂等）
CFGDIR="$HOME/.config/silicon-memory"
mkdir -p "$CFGDIR"
CFG_NEW="SM_EXP_STORE=$EXP
SM_DATA_DIR=$DATA"
if [ ! -f "$CFGDIR/config" ] || [ "$(cat "$CFGDIR/config")" != "$CFG_NEW" ]; then
  printf '%s\n' "$CFG_NEW" > "$CFGDIR/config"
fi

# 2. CLI symlink
mkdir -p "$HOME/.local/bin"
ln -sfn "$R/bin/silicon-memory" "$HOME/.local/bin/silicon-memory"

# 3. server venv（uv；零第三方依赖故轻快）＋ symlink
if command -v uv >/dev/null 2>&1; then
  if [ ! -x "$R/server/venv/bin/semantic-memory" ]; then
    (cd "$R/server" && rm -rf venv && uv venv venv && uv pip install --python venv/bin/python -e ".[vector,dev]")
  fi
  [ -x "$R/server/venv/bin/semantic-memory" ] && \
    ln -sfn "$R/server/venv/bin/semantic-memory" "$HOME/.local/bin/semantic-memory"
else
  echo "install: uv 不在 PATH——语义记忆 server 未装（装 uv 后重跑本脚本）" >&2
fi

# 4. skills 软链农场（opencode 约定；其他 harness 见 README 手动接线）
SKDIR="$HOME/.config/opencode/skills"
mkdir -p "$SKDIR"
for s in agent-experience project-compound unified-memory; do
  ln -sfn "$R/skills/$s" "$SKDIR/$s"
done

# 5. agentctl ext 落件（文件即注册；卸载＝删文件，见 docs/ext-contract.md）
EXTDIR="$HOME/.config/agentctl/ext"
mkdir -p "$EXTDIR"
EXT_MEM='# desc: 经验库 memory 族（capture/query/lint/...）——silicon-memory
exec silicon-memory memory "$@"'
EXT_KNW='# desc: 知识库 knowledge 族（query/ingest/lint）——silicon-memory
exec silicon-memory knowledge "$@"'
[ -f "$EXTDIR/memory.sh" ]    || printf '%s\n' "$EXT_MEM" > "$EXTDIR/memory.sh"
[ -f "$EXTDIR/knowledge.sh" ] || printf '%s\n' "$EXT_KNW" > "$EXTDIR/knowledge.sh"
chmod +x "$EXTDIR/memory.sh" "$EXTDIR/knowledge.sh"

# 6. shell rc 补 MEMORY_DATA_DIR export（server/plugin 经 env 读数据目录；已有则零写入）
case "$(basename "${SHELL:-bash}")" in
  zsh)  RC="$HOME/.zshenv" ;;
  bash) RC="$HOME/.bashrc" ;;
  *)    RC="$HOME/.profile" ;;
esac
touch "$RC"
grep -q 'MEMORY_DATA_DIR=' "$RC" || printf '\nexport MEMORY_DATA_DIR="%s"\n' "$DATA" >> "$RC"

# 7. 模型缺失提示（不自动拉大文件）
if [ -z "$(ls "$DATA/models" 2>/dev/null)" ]; then
  echo "install: 语义记忆模型缺失——下载 embedding/distiller GGUF 至 $DATA/models/（清单见 README），server 将以纯 BM25 降级运行"
fi

echo "install: 完成。config=$CFGDIR/config  CLI=$(command -v silicon-memory || echo "$HOME/.local/bin/silicon-memory")"
echo "install: opencode MCP 注册如缺失，见 README『接线』节"
