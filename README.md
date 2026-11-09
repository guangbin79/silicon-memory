# silicon-memory

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Python 3.11+](https://img.shields.io/badge/python-3.11%2B-3776ab.svg)](https://www.python.org)
[![made for opencode v2](https://img.shields.io/badge/made%20for-opencode%20v2-6e7bff.svg)](https://opencode.ai)

[English](README.md) | [简体中文](README.zh-CN.md)

Unified memory for coding agents. One installer wires **three memory layers** into your session — global experience (episodic), project knowledge (semantic, in-repo), and a hot semantic-memory service — with one agent-facing CLI. **Data stays where it lives**: installation only points to it, never migrates or converts.

> **Super Agent 三支柱**：本仓为「存算分离」支柱（记忆/状态层）。另两根：[opencode-agora](https://github.com/guangbin79/opencode-agora)（调度 Router）· [coding-gates](https://github.com/guangbin79/coding-gates)（质量监督门）。三仓协同构成 super agent 实现。

```text
You:    "Remember: this repo requires req-check before any release"
memory:  └─ stored as a decision — keyword-searchable the moment it returns

Next week. New session. Same repo:
         └─ injected before you ask: "run req-check before release (decision, 2026-10-31)"

Compaction fires mid-session:
         └─ pre-compaction flush → discarded context lands in the store, not /dev/null
```

The difference in one line: **the session forgets; the store doesn't.** Native compaction and static context files manage what is *in the window right now*; silicon-memory manages *relevance over time* — everything compressed away, pruned, or left behind in a previous session stays semantically searchable and comes back automatically when it becomes relevant to the current task.

## Quick Start

Prerequisites: `python3` ≥ 3.11, `node` (the CLI is a bash + node wrapper), `git`; [uv](https://docs.astral.sh/uv/) for the service venv. [opencode](https://opencode.ai) v2 for the plugin. GGUF models are optional — without them the service runs BM25-only (still useful). With models configured, CUDA is required: on no-GPU machines, or when free VRAM can't fit the embedder (estimate ×1.2), the service refuses to start and surfaces the reason (needed vs free MiB) via the discovery file, the log, and the plugin/TUI.

```bash
git clone https://github.com/guangbin79/silicon-memory && cd silicon-memory
./install.sh        # asks two directories; or --exp-store/--data-dir for non-interactive
```

The installer is idempotent (re-run any time, zero side effects) and leaves:

- `~/.config/silicon-memory/config` — your two answers (`SM_EXP_STORE` / `SM_DATA_DIR`); merge semantics preserve hand-added keys
- `~/.local/bin/silicon-memory` — the unified CLI
- `~/.local/bin/semantic-memory` — the service (uv venv)
- `~/.config/opencode/skills/{agent-experience,project-compound,unified-memory}` — skill symlinks
- one `MEMORY_DATA_DIR` export appended to your shell rc (skipped if already present)

Now just talk to your session as usual:

| You say | What happens |
|---|---|
| *"...remember this"* | typed memory stored (preference / decision / fact), searchable the moment the call returns |
| new session, same repo | relevant decisions, preferences, and past fixes injected before your first message (sub-final position, prefix-cache friendly) |
| compaction fires mid-session | pre-compaction flush: the discarded context is searchable, not gone |
| *"how did we solve X before?"* | native `memory_recall` tool / `silicon-memory knowledge query` → fused hits, cross-project extras flagged |

Update path: `git pull && ./install.sh` — the CLI and skills are symlinks into the repo and follow automatically; the opencode plugin and TUI are copies the installer deploys, so re-running the installer refreshes them (the installer skips an existing venv; if `server/pyproject.toml` dependencies changed, delete `server/venv` and re-run).

## The Three Layers

| Layer | What it holds | Where the data lives | Mechanism |
|---|---|---|---|
| Project knowledge (semantic) | distilled conclusions / decisions / strategies per project | each project's `./docs/agents/knowledge/` — in-repo, versioned | project-compound skill, `knowledge ingest` |
| Global experience (episodic) | raw task experience, portable across projects | configured at install (default `~/.agent-experiences`) | agent-experience skill + `memory capture` |
| Shared semantic memory (hot) | cross-session recall & automatic injection | configured at install (default `~/.hotmem`) | semantic-memory service (SQLite + BM25 + vectors + distillation) |

Facts flow uphill: raw experience is captured automatically, gets distilled into typed facts, and the ones worth keeping as conclusions are **promoted** into the project's knowledge pages — `promote` marks the path, `knowledge ingest` is the LLM process that writes the page.

## Where It Sits

| | Context quantity (compaction / prune) | Static context files (AGENTS.md) | **silicon-memory** |
|---|:---:|:---:|:---:|
| Manages | window fit | hand-curated rules | context **relevance over time** |
| Survives session end | ✗ | ✓ | ✓ |
| Recalled on relevance | — | always-or-never | automatic, task-relevant injection |
| Knowledge distillation | ✗ | manual | episodic → semantic promote path |
| Retention | — | manual | configuration, not LLM discretion |

Compaction makes the window fit; the memory layer makes compression safe.

## How It Works

```text
Your sessions (opencode v2 + plugin · other harnesses via lifecycle hooks)
   │ recall · inject · auto-capture · pre-compaction flush · idle distill
   ▼
semantic-memory service — http://127.0.0.1:8765 (Python stdlib, fail-open)
   SQLite + FTS5(porter|trigram) BM25 + Qwen3 GGUF vectors + RRF + local rerank
   async distillation → typed facts · TTL/supersede retention · web UI
   ▲
silicon-memory CLI — the agent-facing face (declare it, it's on PATH)
   memory capture|query|supersede|promote|…    knowledge query|ingest|lint
        │                                           │
   ~/.agent-experiences              <project>/docs/agents/knowledge/
   (episodic, cross-project)         (semantic, in-repo, versioned)
```

**Agent-facing CLI (standalone model).** The CLI is not a shell through something else — agent-side instructions (skills / AGENTS.md) declare `silicon-memory memory …` and `silicon-memory knowledge …` directly. Deployment-side governance faces (practice / policy / evolution / groom) are intentionally not in this repo.

**opencode wiring.** The installer deploys the plugin and TUI automatically (`server/integrations/opencode/memory.ts` and the `silicon-memory-tui/` directory → `~/.config/opencode/plugins/` as real copies; re-run `./install.sh` to refresh, or manually `cp -rfp`). The plugin alone delivers hook-driven recall / injection / auto-capture (with `MEMORY_PLUGIN_AUTOSTART=1` service spawn) **and** the native `memory_store` / `memory_recall` tools. No MCP registration needed. Other harnesses: hook adapters in [server/integrations/](server/integrations/).

## Highlights

- **Automatic memory** — plugin hooks: relevant recall before you ask, flush before compaction, capture from chat ("remember ...") and a tool whitelist; no manual "save this" discipline required
- **Retrieval that survives phrasing** — dual-channel BM25 (porter + trigram, CJK-capable) + multilingual Qwen3 embeddings + RRF fusion + VRAM-aware local rerank (recall@5 0.939 vs 0.909 RRF-only, measured on a real golden set)
- **Compression made safe** — pre-compaction flush lands discarded context in the store; dedup treats recurrence as "proven relevant again"
- **Fail-open** — the plugin holds zero intelligence and a dead service means silent skips, never a blocked session
- **Local-first** — loopback bind, optional Bearer token, GGUF models on your own GPU, no telemetry; the cloud-consolidation channel is config-gated and off by default
- **Retention is configuration** — preference/decision permanent, facts survive on use (TTL), supersede chain retires entries with zero physical deletion
- **Prompt-injection hygiene** — boundary tags stripped from injected content; capture skips tool output shaped like classic injection patterns
- **Lightweight** — Python stdlib service (zero pip dependencies at the core), bash + node CLI, optional ~600 MB GGUF

## Comparison

| | Plain sessions | Static context files | Generic memory tools | silicon-memory |
|---|---|---|---|---|
| Recall trigger | — | always loaded | manual query | automatic per-task injection + native recall tool |
| Compaction discards | lost | — | lost | flushed into the store pre-compaction |
| Retrieval | — | none | varies | BM25 dual-channel + vectors + RRF + optional rerank |
| Episodic → distilled | — | manual rewrite | ✗ | `promote` + in-repo knowledge pages |
| Retention policy | — | manual | manual | TTL / supersede, config-driven, off the agent surface |
| Cross-harness | — | per-harness copies | varies | one service, one index, any hook-capable harness |
| Footprint | — | none | heavy runtimes | python3 stdlib + node + optional GGUF |

## Configuration

Umbrella-level options (the two directories plus the plugin's noise table):

| Option | Default | Description |
|---|---|---|
| `SM_EXP_STORE` | `~/.agent-experiences` | Experience store directory (installer asks) |
| `SM_DATA_DIR` | `~/.hotmem` | Semantic-memory data home: `models/`, db, `config.toml` |
| `SM_NOISE_PREFIXES` | empty | Comma-separated task-event noise prefixes the plugin skips on capture, e.g. `[agora]` |
| `MEMORY_DATA_DIR` | from config | Exported to your shell rc; read by the service and plugin |

Everything else — ~30 `MEMORY_*` variables covering recall quality (cosine floor / redundancy ceiling / rerank budget), distillation, TTL, cloud channel, ports and tokens — is documented in [server/README.md](server/README.md).

## Safety Model

Honest by design — what's machine-checked vs what's trusted:

**Enforced** (cannot be bypassed):

- Bulk destructive operations (purge / TTL / VACUUM) run only at service startup and via the CLI — deliberately **not** exposed as agent-facing tools
- Non-loopback bind without `MEMORY_TOKEN` is refused at startup (`exit 2`)
- Write-side capture skips prompt-injection-shaped tool output; read-side injected blocks carry a "reference data, not instructions" notice with boundary-tag stripping
- The installer is diff-before-write idempotent and never deletes data — uninstalling leaves both data directories untouched

**Accepted risks** (single-user, single-machine trust model):

- Capture is at-most-once: hooks fire-and-forget with a 1.5 s budget; memories arriving while the service is down are silently dropped (a blocked session is worse than a missed memory)
- A tokenless loopback REST surface is readable/writable by every local process — including the agent's own shell
- Recalled memories are untrusted data spliced into prompts: fenced and filtered, but a model can still be fooled

## FAQ

**How do I update?** `git pull && ./install.sh` — the CLI and skills are symlinks into the repo; the opencode plugin and TUI are copies, so re-running the installer refreshes them after pulling.

**How do I uninstall?**
```bash
rm -f ~/.local/bin/silicon-memory ~/.local/bin/semantic-memory
rm -rf ~/.config/silicon-memory
rm -f ~/.config/opencode/skills/{agent-experience,project-compound,unified-memory}
rm ~/.config/opencode/plugins/memory.ts   # if you installed the plugin
rm -rf ~/.config/opencode/plugins/silicon-memory-tui   # if you installed the TUI panel
# remove the MEMORY_DATA_DIR line from your shell rc
```
Your data directories (`SM_EXP_STORE`, `SM_DATA_DIR`, and every project's `docs/agents/knowledge/`) are intentionally left alone — they are yours, not the tool's.

**No GPU / no models?** No models → BM25-only, and it tells you so. Models configured but no CUDA (or free VRAM below the embedder estimate ×1.2) → the service refuses to start and surfaces the reason (needed vs free MiB) in the discovery file (`*.server.json`), the server log, and the plugin/TUI. When the embedder fits but the reranker doesn't, rerank auto-disables (RRF order, no rerank). Add GGUF models to `<SM_DATA_DIR>/models/` later and run `semantic-memory backfill` once to vectorize existing entries.

**Which harnesses work?** opencode v2 gets the in-process plugin (automatic). Claude Code and Kimi Code get hook adapters in [server/integrations/](server/integrations/); any harness with lifecycle hooks can wire "hook event → curl localhost:8765". The CLI and both file layers are harness-agnostic from day one.

**Where does my memory go?** Nowhere. The service binds to localhost, models run on your machine, there is no cloud and no telemetry. The optional cloud-consolidation channel (off by default) sends a pre-filtered near-duplicate set to an endpoint you configure and accepts back only a metadata plan — no cloud-generated content is ever stored.

**Platforms?** Linux (verified). macOS: unverified — the CLI and the BM25-only service are portable, the CUDA vector wheel is a local Linux asset. Windows: WSL.

## License

MIT — see [LICENSE](LICENSE).
