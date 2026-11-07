# CLI Retrieval Entry

> Last updated: 2026-11-07

## Overview
- silicon-memory CLI 的检索入口分两层：`memory query` 与 `knowledge query` 语义不同，不可混用
- Key files: ./bin/silicon-memory, ./README.md, ./README.zh-CN.md

## Bug Experience

### README FAQ 把跨层检索入口错指为 memory query（2026-11-07）
- **Id:** cli-retrieval-entry/readme-faq-memory-query-alias
- **Source:** 383c334f58ea4d0635bebe769a7966f05772f3a5
- **Symptom:** 两 README FAQ 表格把「我们之前怎么解决 X 的？」检索问题指向 `silicon-memory memory query`，照文档操作会落到 dedup 查重层，查不到 experiences＋knowledge 融合结果
- **Root cause:** `./bin/silicon-memory` dispatch 表中 `memory query` 是 dedup 查重别名，只报全文命中不裁决；跨层检索真入口是 `knowledge query`（experiences＋knowledge 一次查完）
- **Verbatim evidence（bin/silicon-memory）:**

  ```bash
  # case "$cmd" in memory) → case "$sub"（line 37）：
        query)    exec node "$AE" dedup "$@" ;;
  # case "$cmd" in knowledge) → case "$sub"（line 52）：
        query) exec node "$AE" knowledge query "$@" ;;
  ```

- **Fix:** commit 383c334（fix README retrieval entry: memory query -> knowledge query）把 README.md 与 README.zh-CN.md 两 FAQ 行改为 `silicon-memory knowledge query`
- **Prevention:** 文档写 CLI 子命令前先对照 `./bin/silicon-memory` dispatch 表逐字核实命令名，不凭记忆或别处文档转写
