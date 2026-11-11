#!/usr/bin/env node
// 统一记忆根命令控制面：load/settle/maintain/promote/retire 五命令的编排层。
// 三层适配器（hot=热服务 HTTP / experience=ae.mjs / knowledge=ae.mjs lint）可注入——
// 测试用假适配器零接触真实记忆库；生产走 defaultAdapters()。
// 契约：统一报告 {operation,actions,agent_actions,candidates,reports,errors}；
// action.status ∈ done|skipped|findings|candidate|failed；单层失败不阻断他层；
// 任一 failed → rc1；参数错误 → rc2；done/skipped/findings/candidate → rc0。
// 详见 skills/unified-memory/references/lifecycle.md。
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { basename, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const USAGE = `usage: silicon-memory {load|settle|maintain|promote|retire} [options]
  load      --project <path> --session <id> --query <text> [--store <dir>] [--limit <n>]
            跨层装配：知识(3)→经验(3)→热(5，--limit 仅覆盖热层)；命中规范化 hot:/exp:/know: 引用
  settle    --project <path> --session <id>
            触发热层 settle（POST /idle）＋返回 capture-if-signaled / ingest-if-material 指令
  maintain  [--project <path>] [--scope hot,experience,knowledge] [--phase all|groom|judge] [--apply] [--store <dir>]
            缺省 report-only；--phase 仅 experience scope 合法；knowledge lint findings 记 findings 非 failed
  promote   --proposal <path> [--apply] [--experience <id> --to <know ref>]
            dry-run 只做 proposal 校验＋返回 ingest 指令；--apply 需 verdict: approved，调 ae.mjs promote
  retire    --ref hot:<uid>|exp:<id> --by hot:<uid>|exp:<id>
            同层退役（hot→POST /supersede；exp→ae.mjs supersede）；跨层组合 rc2`;

const LAYER_LIMITS = { knowledge: 3, experience: 3, hot: 5 }; // 装配序＝对象序：知识→经验→热
const SCOPES = ["hot", "experience", "knowledge"];
const VALUE_FLAGS = new Set(["project", "session", "query", "limit", "store", "scope", "phase", "proposal", "experience", "to", "ref", "by"]);
const BOOL_FLAGS = new Set(["apply", "json"]);
const AE = fileURLToPath(new URL("../skills/agent-experience/bin/ae.mjs", import.meta.url));

class UsageError extends Error {}

const newReport = (operation) => ({ operation, actions: [], agent_actions: [], candidates: [], reports: [], errors: [] });
const anyFailed = (report) => report.actions.some((a) => a.status === "failed");

function parseArgs(argv) {
  const [op, ...rest] = argv;
  const flags = {};
  for (let i = 0; i < rest.length; i++) {
    const tok = rest[i];
    if (!tok.startsWith("--")) return { op, flags, err: `未知参数: ${tok}` };
    const eq = tok.indexOf("=");
    const key = eq === -1 ? tok.slice(2) : tok.slice(2, eq);
    if (BOOL_FLAGS.has(key)) { flags[key] = true; continue; }
    if (!VALUE_FLAGS.has(key)) return { op, flags, err: `未知选项: --${key}` };
    let val = eq === -1 ? rest[++i] : tok.slice(eq + 1);
    if (val === undefined) return { op, flags, err: `--${key} 缺值` };
    flags[key] = val;
  }
  return { op, flags };
}

// 单点容错：适配器异常 → 返回 {ok:false}，不阻断他层
async function safe(fn) {
  try { return { ok: true, value: await fn() }; }
  catch (err) { return { ok: false, error: String(err?.message ?? err) }; }
}

// know ref：kroot 相对路径去 .md、去 modules/ 前缀（kroot 未知时退 basename）
function knowRef(kroot, file) {
  let rel = kroot ? relative(kroot, file) : basename(file);
  if (rel.endsWith(".md")) rel = rel.slice(0, -3);
  return `know:${rel.startsWith("modules/") ? rel.slice("modules/".length) : rel}`;
}
const expRef = (file) => `exp:${basename(file).replace(/\.md$/, "")}`;

async function pushAction(report, action, fn) {
  const r = await safe(fn);
  if (r.ok) report.actions.push({ status: "done", ...action, ...(r.value ?? {}) });
  else {
    report.actions.push({ status: "failed", ...action, error: r.error });
    report.errors.push(`${action.layer}:${action.op}: ${r.error}`);
  }
  return r;
}

// ---- load ----
async function cmdLoad(flags, adapters, report) {
  let hotLimit = LAYER_LIMITS.hot;
  if (flags.limit !== undefined) {
    hotLimit = Number(flags.limit);
    if (!Number.isInteger(hotLimit) || hotLimit < 0) throw new UsageError(`--limit 须为非负整数: ${flags.limit}`);
  }
  // 温层（经验＋知识）＝一次 ae.mjs knowledge query 跨层调用
  const warm = await safe(() => adapters.experience.query({ query: flags.query, store: flags.store }));
  if (warm.ok) {
    const { knowledge = [], experiences = [], knowledge_root } = warm.value ?? {};
    report.actions.push({ layer: "knowledge", op: "query", status: "done", hits: knowledge.length });
    for (const h of knowledge.slice(0, LAYER_LIMITS.knowledge))
      report.candidates.push({ layer: "knowledge", ref: knowRef(knowledge_root, h.file), title: h.title ?? null });
    report.actions.push({ layer: "experience", op: "query", status: "done", hits: experiences.length });
    for (const h of experiences.slice(0, LAYER_LIMITS.experience))
      report.candidates.push({ layer: "experience", ref: expRef(h.file), title: h.title ?? null, type: h.type ?? null, tags: h.tags ?? null });
  } else {
    // 两温层共享同一后端调用：一并如实标失败（热层照常）
    for (const layer of ["knowledge", "experience"]) {
      report.actions.push({ layer, op: "query", status: "failed", error: warm.error });
      report.errors.push(`${layer}:query: ${warm.error}`);
    }
  }
  const hot = await safe(() => adapters.hot.recall({ query: flags.query, limit: hotLimit, project: flags.project }));
  if (hot.ok) {
    const hits = hot.value ?? [];
    report.actions.push({ layer: "hot", op: "recall", status: "done", hits: hits.length });
    for (const h of hits.slice(0, hotLimit))
      report.candidates.push({ layer: "hot", ref: `hot:${h.uid}`, kind: h.kind ?? null, content: h.content ?? null });
  } else {
    report.actions.push({ layer: "hot", op: "recall", status: "failed", error: hot.error });
    report.errors.push(`hot:recall: ${hot.error}`);
  }
}

// ---- settle ----
async function cmdSettle(flags, adapters, report) {
  await pushAction(report, { layer: "hot", op: "settle" },
    () => adapters.hot.settle({ project: flags.project, session: flags.session }));
  // 不自动调用 LLM、不写经验/知识——只把收尾动作以指令形式交还 agent
  report.agent_actions.push(
    { skill: "agent-experience", action: "capture-if-signaled", hint: "命中三信号（踩 bug/权衡决策/可复用坑位）按 agent-experience 五步 capture" },
    { skill: "project-compound", action: "ingest-if-material", hint: "有 material 才走 ingest 六步；No material 记 log-only，零落盘" },
  );
}

// ---- maintain ----
async function cmdMaintain(flags, adapters, report) {
  const apply = Boolean(flags.apply);
  const scopes = (flags.scope ?? SCOPES.join(",")).split(",").map((s) => s.trim()).filter(Boolean);
  if (!scopes.length || scopes.some((s) => !SCOPES.includes(s)))
    throw new UsageError(`--scope 须为 ${SCOPES.join(",")} 的逗号组合: ${flags.scope}`);
  let phase = flags.phase;
  if (phase !== undefined) {
    if (!["all", "groom", "judge"].includes(phase)) throw new UsageError(`--phase 须为 all|groom|judge: ${phase}`);
    if (!(scopes.length === 1 && scopes[0] === "experience")) throw new UsageError("--phase 仅 experience scope 合法");
  }
  for (const layer of SCOPES) {
    if (!scopes.includes(layer)) continue;
    if (layer === "hot") {
      // noiseSweep 自带 dry_run 语义：report-only 也安全执行
      const sweep = await pushAction(report, { layer: "hot", op: "noiseSweep", dry_run: !apply },
        () => adapters.hot.noiseSweep({ dry_run: !apply }));
      if (sweep.ok) report.reports.push({ layer: "hot", op: "noiseSweep", data: sweep.value });
      // purge/distill 是变更型操作：report-only 一律跳过
      if (apply) {
        const purged = await pushAction(report, { layer: "hot", op: "purge" }, () => adapters.hot.purge());
        if (purged.ok) report.reports.push({ layer: "hot", op: "purge", data: purged.value });
      } else report.actions.push({ layer: "hot", op: "purge", status: "skipped", reason: "report_only" });
      if (typeof adapters.hot.distill !== "function")
        report.actions.push({ layer: "hot", op: "distill", status: "skipped", reason: "unavailable" });
      else if (apply) {
        const d = await pushAction(report, { layer: "hot", op: "distill" }, () => adapters.hot.distill({ apply }));
        if (d.ok && d.value) report.reports.push({ layer: "hot", op: "distill", data: d.value });
      } else report.actions.push({ layer: "hot", op: "distill", status: "skipped", reason: "report_only" });
    } else if (layer === "experience") {
      // SM_EXPERIENCE_RUNNER 未配置（适配器无 groom 面）→ 只报告 skipped，绝不扫描 home
      if (typeof adapters.experience.groom !== "function") {
        report.actions.push({ layer: "experience", op: "groom", status: "skipped", reason: "groom_unavailable" });
      } else {
        const g = await pushAction(report, { layer: "experience", op: "groom" },
          () => adapters.experience.groom({ phase: phase ?? "all", apply, project: flags.project, store: flags.store }));
        if (g.ok && g.value) report.reports.push({ layer: "experience", op: "groom", data: g.value });
      }
    } else {
      // knowledge lint：rc1 有发现 → status=findings（非 failed，不阻断且 rc0）
      const lint = await safe(() => adapters.knowledge.lint({ store: flags.store }));
      if (!lint.ok) {
        report.actions.push({ layer: "knowledge", op: "lint", status: "failed", error: lint.error });
        report.errors.push(`knowledge:lint: ${lint.error}`);
      } else {
        const { rc = 0, out = "" } = lint.value ?? {};
        report.actions.push({ layer: "knowledge", op: "lint", status: rc === 0 ? "done" : "findings", rc });
        if (out) report.reports.push({ layer: "knowledge", op: "lint", text: String(out).trim() });
      }
    }
  }
}

// ---- promote ----
const INGEST_RUNBOOK = `project-compound ingest（agent 过程，无脚本入口）：
  skill:   skills/project-compound/SKILL.md
  全语义:  skills/project-compound/references/operations.md（Step 0-6）
  提案门槛: 3 行结论＋≥2 条逐字证据；promote --apply 只写温层 promoted_to 标记，
  知识页写入归 ingest 过程（本命令不得自动写知识页）`;

function verdictOf(text) {
  const m = text.match(/(?:^|\n)verdict:\s*([A-Za-z0-9_-]+)/);
  return m ? m[1] : null;
}

async function cmdPromote(flags, adapters, report) {
  let text;
  try { text = readFileSync(flags.proposal, "utf8"); }
  catch { throw new UsageError(`--proposal 不可读: ${flags.proposal}`); }
  const verdict = verdictOf(text);
  if (!flags.apply) {
    report.actions.push({ layer: "experience", op: "promote", status: "candidate", proposal: flags.proposal, verdict });
    report.reports.push({ op: "promote", text: INGEST_RUNBOOK });
    report.agent_actions.push({ skill: "project-compound", action: "ingest", hint: "按 runbook 评估提案：有 material 才落知识页" });
    return;
  }
  if (verdict !== "approved") throw new UsageError(`--apply 需提案含 verdict: approved（当前: ${verdict ?? "未声明"}）`);
  if (!flags.experience || !flags.to) throw new UsageError("--apply 需同时给 --experience <id> --to <know ref>");
  await pushAction(report, { layer: "experience", op: "promote", id: flags.experience, to: flags.to },
    () => adapters.experience.promote({ id: flags.experience, to: flags.to }));
  report.agent_actions.push({ skill: "project-compound", action: "ingest", hint: "温层标记已写；知识页按 ingest 过程另行沉淀" });
}

// ---- retire ----
function parseRef(s) {
  const m = /^(hot|exp):(.+)$/.exec(s ?? "");
  return m ? { layer: m[1], id: m[2] } : null;
}

async function cmdRetire(flags, adapters, report) {
  const ref = parseRef(flags.ref);
  const by = parseRef(flags.by);
  if (!ref || !by) throw new UsageError("--ref/--by 须为 hot:<uid> 或 exp:<id> 形态");
  if (ref.layer !== by.layer) throw new UsageError(`跨层组合不支持: ${flags.ref} × ${flags.by}`);
  if (ref.layer === "hot")
    await pushAction(report, { layer: "hot", op: "retire", ref: flags.ref, by: flags.by },
      () => adapters.hot.supersede({ uid: ref.id, by: by.id }));
  else
    await pushAction(report, { layer: "experience", op: "retire", ref: flags.ref, by: flags.by },
      () => adapters.experience.supersede({ id: ref.id, by: by.id }));
}

// ---- 入口 ----
export async function runLifecycle(argv, adapters = defaultAdapters()) {
  const { op, flags, err } = parseArgs(argv);
  const report = newReport(op ?? null);
  if (err) { report.errors.push(err); return { rc: 2, report }; }
  try {
    switch (op) {
      case "load":
        for (const k of ["project", "session", "query"]) if (!flags[k]) throw new UsageError(`load: 缺 --${k}`);
        await cmdLoad(flags, adapters, report);
        break;
      case "settle":
        for (const k of ["project", "session"]) if (!flags[k]) throw new UsageError(`settle: 缺 --${k}`);
        await cmdSettle(flags, adapters, report);
        break;
      case "maintain": await cmdMaintain(flags, adapters, report); break;
      case "promote":
        if (!flags.proposal) throw new UsageError("promote: 缺 --proposal");
        await cmdPromote(flags, adapters, report);
        break;
      case "retire":
        if (!flags.ref || !flags.by) throw new UsageError("retire: 缺 --ref/--by");
        await cmdRetire(flags, adapters, report);
        break;
      default: throw new UsageError(`未知命令: ${op ?? "(空)"}\n${USAGE}`);
    }
  } catch (err) {
    if (err instanceof UsageError) { report.errors.push(err.message); return { rc: 2, report }; }
    throw err;
  }
  return { rc: anyFailed(report) ? 1 : 0, report };
}

// ---- 生产适配器（测试注入假适配器替换） ----
function aeRun(args) {
  const r = spawnSync(process.execPath, [AE, ...args], { encoding: "utf8" });
  if (r.status !== 0)
    throw new Error(`ae.mjs ${args.join(" ")} → rc${r.status}: ${`${r.stdout ?? ""}${r.stderr ?? ""}`.trim().slice(0, 400)}`);
  return r.stdout ?? "";
}

export function defaultAdapters() {
  const base = (process.env.MEMORY_PLUGIN_URL ?? "http://127.0.0.1:8765").replace(/\/$/, "");
  const headers = {
    "content-type": "application/json",
    ...(process.env.MEMORY_PLUGIN_TOKEN ? { authorization: `Bearer ${process.env.MEMORY_PLUGIN_TOKEN}` } : {}),
  };
  const httpPost = async (path, body = {}) => {
    const res = await fetch(`${base}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
    const text = await res.text();
    if (!res.ok) throw new Error(`POST ${path} → ${res.status}: ${text.slice(0, 200)}`);
    return text ? JSON.parse(text) : {};
  };
  const hot = {
    recall: async ({ query, limit, project }) => (await httpPost("/recall", { query, limit, project })).hits ?? [],
    settle: async () => { await httpPost("/idle"); return { flushed: true }; }, // 生产映射：POST /idle 触发队列 flush
    supersede: async ({ uid, by }) => httpPost("/supersede", { uid, by }),
    purge: async () => httpPost("/api/maintenance/purge"),
    noiseSweep: async ({ dry_run }) => httpPost("/api/maintenance/noise_sweep", { dry_run }),
    // 生产暂无 distill 的 HTTP/CLI 面：适配器占位（后续任务接线），报告 skipped 而非 failed
    distill: async () => ({ status: "skipped", reason: "distill_via_cli_deferred" }),
  };
  const experience = {
    query: async ({ query, store }) =>
      JSON.parse(aeRun([...(store ? ["--store", store] : []), "knowledge", "query", query])),
    supersede: async ({ id, by }) => { aeRun(["supersede", id, "--by", by]); return { marked: true }; },
    promote: async ({ id, to }) => { aeRun(["promote", id, "--to", to]); return { marked: true }; },
    // groom 走部署方 runner（治理类私有 CLI）：SM_EXPERIENCE_RUNNER 未配置则无此面 → skipped:groom_unavailable
    ...(process.env.SM_EXPERIENCE_RUNNER ? {
      groom: async ({ phase, apply }) => {
        const [cmd, ...pre] = process.env.SM_EXPERIENCE_RUNNER.split(/\s+/).filter(Boolean);
        const r = spawnSync(cmd, [...pre, "--phase", phase ?? "all", ...(apply ? ["--apply"] : []), "--json"], { encoding: "utf8" });
        if (r.status !== 0) throw new Error(`SM_EXPERIENCE_RUNNER rc${r.status}: ${(r.stderr ?? "").trim().slice(0, 200)}`);
        return { status: "done", report: (r.stdout ?? "").trim() };
      },
    } : {}),
  };
  const knowledge = {
    lint: async () => {
      const r = spawnSync(process.execPath, [AE, "knowledge", "lint"], { encoding: "utf8" });
      return { rc: r.status ?? 1, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
    },
  };
  return { hot, experience, knowledge };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  runLifecycle(process.argv.slice(2)).then(({ rc, report }) => {
    process.stdout.write(JSON.stringify(report) + "\n");
    if (rc === 2 && report.errors.length) process.stderr.write(report.errors.join("\n") + "\n");
    process.exitCode = rc;
  }).catch((err) => {
    process.stderr.write(`lifecycle: ${err?.message ?? err}\n`);
    process.exitCode = 1;
  });
}
