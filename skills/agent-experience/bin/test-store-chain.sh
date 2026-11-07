#!/usr/bin/env bash
# store 解析链回归：--store > AE_EXP_STORE > config SM_EXP_STORE > legacy dotfiles 路径 > ~/.agent-experiences
# 用法: bash test-store-chain.sh <ae.mjs 路径>
set -u
AE="$(readlink -f "${1:?usage: test-store-chain.sh <ae.mjs>}")"
F=$(mktemp -d /tmp/ae-fixture-reschain-XXXX)
trap 'rm -rf "$F"' EXIT
mkdir -p "$F/home/.config/silicon-memory" "$F/home/.dotfiles/.agent-experiences" "$F/env-store" "$F/cfg-store"
pass=0; fail=0
expect() { # <name> <expected-substr>
  local out; out=$(HOME="$F/home" node "$AE" 2>&1 | grep '默认 store')
  if [[ "$out" == *"$2"* ]]; then pass=$((pass+1)); else fail=$((fail+1)); echo "FAIL[$1] want<$2> got<$out>"; fi
}
AE_EXP_STORE="$F/env-store" expect env       "$F/env-store"
printf 'SM_EXP_STORE=%s\n' "$F/cfg-store" > "$F/home/.config/silicon-memory/config"
expect cfg       "$F/cfg-store"
rm -f "$F/home/.config/silicon-memory/config"
expect legacy    "$F/home/.dotfiles/.agent-experiences"
rm -rf "$F/home/.dotfiles"
expect default    "$F/home/.agent-experiences"
echo "reschain: pass=$pass fail=$fail"; [ "$fail" -eq 0 ]
