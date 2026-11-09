#!/usr/bin/env bash
# silicon-memory 安装器：两问接线（数据不动），产物幂等可重跑。
# 用法: ./install.sh [--exp-store DIR] [--data-dir DIR]   # 缺参交互询问
# 产物: ~/.config/silicon-memory/config、~/.local/bin/{silicon-memory,semantic-memory}、
#       ~/.config/opencode/skills/{3 skills} 软链、
#       ~/.config/opencode/plugins/{memory.ts, silicon-memory-tui/} 实体拷贝、
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
[ -f "$CFGDIR/config" ] || : > "$CFGDIR/config"
# 有效数据目录＝既有 config 的 SM_DATA_DIR（本次改写前读；模型缺失提示按它指路，避免交互默认值误导）
# 全新装机无既有 config 时，即将生效的就是本次 $DATA（交互缺省时恰为 ~/.hotmem）
EDATA="$(sed -n 's/^SM_DATA_DIR=//p' "$CFGDIR/config" | tail -1)"
EDATA="${EDATA:-$DATA}"
# 合并语义：刷新两枚规范键，保留手加键（如 SM_NOISE_PREFIXES）——重跑不清户
grep -vE '^SM_(EXP_STORE|DATA_DIR)=' "$CFGDIR/config" > "$CFGDIR/config.new" || true
printf '%s\n%s\n' "SM_EXP_STORE=$EXP" "SM_DATA_DIR=$DATA" >> "$CFGDIR/config.new"
mv "$CFGDIR/config.new" "$CFGDIR/config"

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

# 4b. embed 栈：llama-cpp CUDA 轮子是本地资产（非 PyPI 发布物）；缺 CUDA 库则从旧 venv 抄；都没有→BM25 降级
if [ -x "$R/server/venv/bin/python" ]; then
  WS=$(ls "$HOME"/.local/backups/llama_cpp_python-0.3.35-py3-none-*.whl 2>/dev/null | head -1 || true)
  SP=$(ls -d "$R"/server/venv/lib/python3.*/site-packages 2>/dev/null | head -1)
  OLDLL="$HOME/semantic-memory/venv/lib/python3.12/site-packages/llama_cpp/lib"
  if [ -n "$WS" ] && [ -n "$SP" ]; then
    uv pip install --python "$R/server/venv/bin/python" "$WS" >/dev/null 2>&1 || true
    LL="$SP/llama_cpp/lib"
    for so in libcudart.so.12 libcublas.so.12 libcublasLt.so.12; do
      [ -e "$LL/$so" ] || cp "$OLDLL/$so" "$LL/" 2>/dev/null || true
    done
  else
    echo "install: 本地 llama-cpp CUDA 轮子缺失（~/.local/backups/）——向量通道降级 BM25（补齐见 README）" >&2
  fi
fi

# 4. skills 软链农场（opencode 约定；其他 harness 见 README 手动接线）
# opencode 在用与否须在 skills mkdir 前探测（skills 节会创建 ~/.config/opencode，之后探测恒真）
OC_EXISTED=0; [ -d "$HOME/.config/opencode" ] && OC_EXISTED=1
SKDIR="$HOME/.config/opencode/skills"
mkdir -p "$SKDIR"
for s in agent-experience project-compound unified-memory; do
  ln -sfn "$R/skills/$s" "$SKDIR/$s"
done

# 4c. 插件/TUI 实体部署（拷贝非软链——重跑即刷新；opencode 未用则整节跳过）
if [ "$OC_EXISTED" = 1 ]; then
  PLDIR="$HOME/.config/opencode/plugins"
  mkdir -p "$PLDIR"
  # 先删再拷（rm -r 不跟链不伤外置目标）：清活/悬空软链、文件占位、上游删改残留，刷新即精确镜像
  rm -rf "$PLDIR/memory.ts"
  cp -rfp "$R/server/integrations/opencode/memory.ts" "$PLDIR/memory.ts"
  rm -rf "$PLDIR/silicon-memory-tui"
  cp -rfp "$R/server/integrations/opencode/silicon-memory-tui" "$PLDIR/"
fi

# 5. shell rc 补 MEMORY_DATA_DIR export（server/plugin 经 env 读数据目录；已有则零写入）
case "$(basename "${SHELL:-bash}")" in
  zsh)  RC="$HOME/.zshenv" ;;
  bash) RC="$HOME/.bashrc" ;;
  *)    RC="$HOME/.profile" ;;
esac
touch "$RC"
grep -q 'MEMORY_DATA_DIR=' "$RC" || printf '\nexport MEMORY_DATA_DIR="%s"\n' "$DATA" >> "$RC"

# 7. 模型缺失提示（不自动拉大文件；路径按有效数据目录——改写前 config 的 SM_DATA_DIR，缺省 ~/.hotmem）
if [ -z "$(ls "$EDATA/models" 2>/dev/null)" ]; then
  echo "install: 语义记忆模型缺失——下载 embedding/distiller GGUF 至 $EDATA/models/（清单见 README）；未配模型时 server 以纯 BM25 运行，配置了模型但无 CUDA/显存不足时 server 将拒绝启动（原因见 discovery file）"
fi

echo "install: 完成。config=$CFGDIR/config  CLI=$(command -v silicon-memory || echo "$HOME/.local/bin/silicon-memory")"
echo "install: opencode MCP 注册如缺失，见 README『接线』节"
