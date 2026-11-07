#!/usr/bin/env bash
# silicon-memory memory lint —— 原 .agent-experiences/lint.sh 升格（v7 2026-11-07）：store 以首参传入，store 内副本原地不动
# agent-experiences lint — 固化维护周期的机械检查（>200 条立项，2026-09-18；v2 2026-09-23：+related 重复/悬空、tags 空格、reuses 卫生、新捕获 Evidence；v3 2026-09-26：+tag 词表漂移 WARN；v4 2026-10-10：+§12 approved 提案批准认证析取；v5 2026-10-11：+§12 L0 第④部分 当前内容哈希对拍 trailer；v6 2026-10-12：+§13 practice/ 目录豁免＋政策卡属主校验）
# 用法: bash lint.sh   （在 ~/.agent-experiences/ 下执行；exit 0 = 全过，非 0 = 有 findings）
set -u
cd "${1:?usage: lint.sh <store>}"
FAIL=0
note() { echo "[FAIL] $*"; FAIL=$((FAIL+1)); }

# --- 1. 文件名/ID 格式与一致性 ---
for f in experiences/*.md; do
  base=$(basename "$f" .md)
  [[ "$base" =~ ^[0-9]{8}-[0-9]{6}-[0-9a-f]{4}$ ]] || note "ID 格式非法: $base"
  id=$(grep -m1 "^id:" "$f" | cut -d' ' -f2)
  [ "$id" = "$base" ] || note "id 与文件名不一致: $base (id=$id)"
done

# --- 2. 必需字段（archived 豁免 summary）---
for f in experiences/*.md; do
  st=$(grep -m1 "^status:" "$f" | cut -d' ' -f2)
  for k in id created_at type project tags status schema_version; do
    grep -q "^$k:" "$f" || note "$f 缺 $k"
  done
  if [ "$st" != "archived" ]; then
    grep -q "^summary:" "$f" || note "$(basename "$f") 缺 summary (status=$st)"
  fi
done

# --- 3. 枚举与日期格式 ---
for f in experiences/*.md; do
  grep -qE "^type: (debug|architecture|integration|tool|decision|other)$" "$f" || note "$(basename "$f") type 非法"
  grep -qE "^status: (draft|confirmed|archived|rejected)$" "$f" || note "$(basename "$f") status 非法"
  grep -qE "^created_at: [0-9]{4}-[0-9]{2}-[0-9]{2}$" "$f" || note "$(basename "$f") created_at 格式非法"
done

# --- 4. summary 行格式（ASCII 冒号+空格 / 竖线 / 控制字节）---
trim() { local s="$1"; s="${s#"${s%%[! ]*}"}"; s="${s%"${s##*[! ]}"}"; printf '%s' "$s"; }
while IFS= read -r line; do
  f="${line%%:*}"; f="${f#experiences/}"; f="${f%.md}"
  body="${line#*summary: }"
  case "$body" in *" | "*) note "$f summary 含竖线";; esac
  printf '%s' "$body" | grep -qaP '[\x00-\x08\x0B\x0C\x0E-\x1F]' && note "$f summary 含控制字节"
  case "$body" in *": "*) note "$f summary 含 ASCII 冒号+空格";; esac
done < <(grep -H "^summary:" experiences/*.md)

# --- 5. 全文控制字节 / 空 related 行 ---
for f in experiences/*.md; do
  grep -qaP '[\x00-\x08\x0B\x0C\x0E-\x1F]' "$f" && note "$(basename "$f") 含控制字节"
  grep -qE "^related: ?$" "$f" && note "$(basename "$f") 空 related 行"
done

# --- 6. INDEX 双向一致 + 列同步 ---
idx_n=$(grep -ac "^20" INDEX.md); file_n=$(ls experiences/*.md | wc -l)
[ "$idx_n" = "$file_n" ] || note "INDEX 行数 $idx_n != 文件数 $file_n"
for id in $(grep -a "^20" INDEX.md | cut -d' ' -f1); do
  [ -f "experiences/$id.md" ] || note "INDEX 有行但缺文件: $id"
done
for f in experiences/*.md; do
  id=$(basename "$f" .md)
  grep -qa "^$id " INDEX.md || note "文件存在但 INDEX 缺行: $id"
done
# tags / summary 列逐行同步（对拍 frontmatter）
while IFS='|' read -r rid _ _ _ rsum rtags; do
  rid=$(trim "$rid"); rtags=$(trim "$rtags"); rsum=$(trim "$rsum")
  f="experiences/$rid.md"; [ -f "$f" ] || continue
  fmt=$(grep "^tags:" "$f" | cut -d' ' -f2-)
  [ "$fmt" = "$rtags" ] || note "$rid INDEX tags 列不同步"
  fsum=$(grep -m1 "^summary:" "$f" | cut -d' ' -f2- -s)
  [ -z "$fsum" ] && fsum=$(grep -m1 "^# " "$f" | sed 's/^# //')
  [ "$fsum" = "$rsum" ] || note "$rid INDEX 第5列与 frontmatter 不同步"
done < <(grep -a "^20" INDEX.md)

# --- 7. related 行内重复 ID（机械修法：去重保一次）---
for f in experiences/*.md; do
  rel=$(grep -m1 "^related:" "$f" | cut -d' ' -f2-)
  [ -z "$rel" ] && continue
  dups=$(echo "$rel" | tr ',' '\n' | sed 's/^ *//;s/ *$//' | sort | uniq -d | tr '\n' ' ')
  [ -n "$dups" ] && note "$(basename "$f") related 行内重复 ID: $dups"
done

# --- 8. tags 逗号后空格（机械修法：去空格并同步 INDEX 第 6 列）---
for f in experiences/*.md; do
  tg=$(grep -m1 "^tags:" "$f" | cut -d' ' -f2-)
  case "$tg" in *", "*) note "$(basename "$f") tags 逗号后有空格";; esac
done

# --- 9. related / reuses.md 悬空引用（只报不修，待人工）+ reuses 第 1 列日期门（WARN 只报不计 FAIL，仿 §11 tag-drift 先例）---
for f in experiences/*.md; do
  rel=$(grep -m1 "^related:" "$f" | cut -d' ' -f2-)
  [ -z "$rel" ] && continue
  for rid in $(echo "$rel" | tr ',' ' '); do
    [ -f "experiences/$rid.md" ] || note "$(basename "$f") related 引用不存在: $rid"
  done
done
if [ -f reuses.md ]; then
  while IFS= read -r line; do
    case "$line" in ""|"#"*) continue ;; esac
    d=$(printf '%s' "$line" | awk -F'|' '{gsub(/^ +| +$/,"",$1); print $1}')
    printf '%s' "$d" | grep -qE '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' || echo "[WARN] reuses.md 第 1 列非日期: ${line:0:50}"
    n=$(printf '%s' "$line" | awk -F'|' '{print NF}')
    [ "$n" = "6" ] || note "reuses.md 列数非 6: ${line:0:50}"
    rid=$(printf '%s' "$line" | awk -F'|' '{gsub(/^ +| +$/,"",$2); print $2}')
    if [ -n "$rid" ] && [ ! -f "experiences/$rid.md" ]; then
      note "reuses.md 引用不存在: $rid"
    fi
  done < reuses.md
fi

# --- 10. 新捕获 Evidence 行（规则 2026-09-22 生效；临界存量豁免：捕获早于规则入库当日）---
EVID_EXEMPT="20260922-091340-c0db 20260922-102517-6465"
for f in experiences/*.md; do
  base=$(basename "$f" .md)
  case " $EVID_EXEMPT " in *" $base "*) continue ;; esac
  ca=$(grep -m1 "^created_at:" "$f" | cut -d' ' -f2)
  [[ "$ca" < "2026-09-22" ]] && continue
  grep -q "^Evidence: E[0-4]" "$f" || note "$base 缺 Evidence 行 (created_at=$ca)"
done

# --- 11. tag 词表漂移（WARN 只报不计 FAIL，夜间 Wave 3 统一消化）---
grep -h "^tags:" experiences/*.md 2>/dev/null | cut -d' ' -f2- | tr ',' '\n' \
  | sed 's/^ *//;s/ *$//' | grep -v '^$' | sort -u \
  | awk '{n=tolower($0); gsub(/[-_]/,"",n); print n "\t" $0}' | sort \
  | awk -F'\t' '{c[$1]=c[$1]" "$2; k[$1]++} END{for(t in k) if(k[t]>1) print "[WARN] tag 词表漂移（normal-form 碰撞）:" c[t]}'

# --- 12. approved 提案批准认证（v3.1 析取：L1′ root 四条件 OR L0 四部分验证；属主丢失历史对拍 WARN 只报不计 FAIL）---
shopt -s nullglob
for f in proposals/*.md; do
  [ -f "$f" ] || continue
  rp="$(git rev-parse --show-prefix 2>/dev/null)$f"  # git <rev>:<path> 需仓根相对路径
  root_ok=0
  if [ ! -L "$f" ] && [ -f "$f" ] && [ "$(stat -c %U "$f" 2>/dev/null)" = root ] \
     && grep -q "^verdict: approved" "$f"; then
    root_ok=1
  fi
  l0_ok=0
  if [ "$root_ok" = 0 ]; then
    for ac in $(git log --grep="Approved-Object" --format=%H -- "$f" 2>/dev/null); do
      n=""
      if git cat-file -e "$ac^" 2>/dev/null; then
        # ① diff 恰只动 verdict 行（含 Approved-Object 行增改），动其他行即篡改
        n=$(git diff "$ac^" "$ac" -- "$f" 2>/dev/null \
            | grep -E "^[+-]" | grep -vE "^(\\+\\+\\+|---)" | grep -cvE "^[+-](verdict|Approved-Object):")
      fi
      th=$(git log -1 --format=%B "$ac" 2>/dev/null | grep -m1 "^Approved-Object:" | cut -d" " -f2)
      bh=$(git rev-parse "$ac:$rp" 2>/dev/null)
      # ② trailer == 批准 commit 处 blob 哈希；③ 祖先门在此（Wave 0 基线时刻门由 groom 执行门承担，lint 无 run 基线）
      # ④ 当前工作区文件全文哈希 == trailer（hash-vs-current 绑定：批准后正文再改动即篡改）
      if [ "$n" = 0 ] && [ -n "$th" ] && [ "$th" = "$bh" ] \
         && [ "$(git hash-object "$f")" = "$th" ] \
         && git merge-base --is-ancestor "$ac" HEAD 2>/dev/null; then
        l0_ok=1; break
      fi
    done
  fi
  if [ "$root_ok" = 0 ] && [ "$l0_ok" = 0 ] && grep -q "^verdict: approved" "$f"; then
    note "approved 提案批准认证不过（非 root 属主且无合法 L0 批准 commit）: $f"
  fi
  if [ "$(stat -c %U "$f" 2>/dev/null)" != root ] \
     && git show "HEAD:$rp" 2>/dev/null | grep -q "^verdict: approved"; then
    echo "[WARN] 属主丢失对拍: HEAD 记录 approved 而工作区 user-owned: $f"
  fi
done
shopt -u nullglob

# --- 13. practice/ 目录豁免 ＋ 政策卡属主校验（v6）---
# (i) practice/ 轮次台账不属经验 schema：上方各节仅 glob experiences/*.md 与 policies/*.card，永不触及 practice/——
#     零断言零占位循环 [ocr-6]；目录缺席/内容任意 odd 均不产生 findings。
# (ii) 政策卡属主校验：policies/*.card 须经 sudo chown root:root 冻结签署，属主非 root → FAIL
for f in policies/*.card; do
  [ -f "$f" ] || continue   # nullglob 已关：目录缺席/空 glob 时字面量不过 stat（沿 §12 先例）
  [ ! -L "$f" ] || { note "政策卡为符号链接（stat 跟链可借 root 属主文件过门，链可事后改指）: $f"; continue; }   # [ocr-3] 沿 §12 先例：stat -c %U 跟随符号链接，须先拒链
  owner=$(stat -c %U "$f" 2>/dev/null)
  [ "$owner" = root ] || note "政策卡属主非 root（须 sudo chown root:root 冻结签署）: $f (owner=${owner:-unknown})"
done

# --- 结果 ---
total=$(ls experiences/*.md | wc -l)
if [ "$FAIL" -eq 0 ]; then
  echo "lint PASS: $total 条全检通过"
else
  echo "lint FAIL: $FAIL 项 findings（共 $total 条）"
fi
exit $((FAIL > 0 ? 1 : 0))
