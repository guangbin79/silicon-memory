// lifecycle 控制面单测（node:test，零第三方依赖）：全部经 runLifecycle(argv, fakeAdapters)
// 驱动——不接触真实热服务/经验库/知识库。契约见 skills/unified-memory/references/lifecycle.md。
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runLifecycle, defaultAdapters, lintOutcome } from "./lifecycle.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const K = "/fake/knowledge"; // 假知识根：know ref 归一化用（相对路径去 .md、去 modules/ 前缀）

// 假适配器工厂：calls 记录每次调用（layer→[{op, arg}]），behavior 可按 op 覆写
function fakes(behavior = {}) {
  const calls = { hot: [], experience: [], knowledge: [] };
  const wrap = (layer, op, impl) => async (arg) => {
    calls[layer].push({ op, arg });
    return impl(arg);
  };
  const hot = {
    recall: wrap("hot", "recall", behavior.recall ?? (() => [
      { uid: "u1", kind: "preference", content: "热记忆甲" },
      { uid: "u2", kind: "fact", content: "热记忆乙" },
      { uid: "u3", kind: "fact", content: "热记忆丙" },
      { uid: "u4", kind: "fact", content: "热记忆丁" },
      { uid: "u5", kind: "fact", content: "热记忆戊" },
      { uid: "u6", kind: "fact", content: "热记忆己" },
      { uid: "u7", kind: "fact", content: "热记忆庚" },
    ])),
    settle: wrap("hot", "settle", behavior.settle ?? (() => ({ flushed: true }))),
    supersede: wrap("hot", "supersede", behavior.hotSupersede ?? (() => ({ ok: true }))),
    purge: wrap("hot", "purge", behavior.purge ?? (() => ({ purged: 3 }))),
    noiseSweep: wrap("hot", "noiseSweep", behavior.noiseSweep ?? (({ dry_run }) => ({ dry_run, candidates: 2 }))),
    ...(behavior.distill ? { distill: wrap("hot", "distill", behavior.distill) } : {}),
  };
  const experience = {
    query: wrap("experience", "query", behavior.query ?? (() => ({
      knowledge_root: K,
      knowledge: [
        { file: `${K}/knowledge-index.md`, title: "知识索引" },
        { file: `${K}/modules/principles.md`, title: "原则" },
        { file: `${K}/modules/sub/review.md`, title: "评审" },
        { file: `${K}/modules/extra1.md`, title: "多余1" },
        { file: `${K}/modules/extra2.md`, title: "多余2" },
      ],
      experiences: [
        { file: "/fake/store/experiences/20260101-090000-aaaa.md", title: "经验甲", type: "bug", tags: ["x"] },
        { file: "/fake/store/experiences/20260101-090100-bbbb.md", title: "经验乙", type: "decision", tags: [] },
        { file: "/fake/store/experiences/20260101-090200-cccc.md", title: "经验丙", type: "fact", tags: [] },
        { file: "/fake/store/experiences/20260101-090300-dddd.md", title: "经验丁", type: "fact", tags: [] },
      ],
    }))),
    supersede: wrap("experience", "supersede", behavior.expSupersede ?? (() => ({ marked: true }))),
    promote: wrap("experience", "promote", behavior.promote ?? (() => ({ marked: true }))),
    ...(behavior.groom ? { groom: wrap("experience", "groom", behavior.groom) } : {}),
  };
  const knowledge = {
    lint: wrap("knowledge", "lint", behavior.lint ?? (() => ({ rc: 1, out: "INDEX_GAP modules/x.md\nknowledge lint: 1 findings" }))),
  };
  return { calls, adapters: { hot, experience, knowledge } };
}

test("load：固定装配序 know→exp→hot＋各层默认限额（3/3/5），ref 归一化", async () => {
  const { calls, adapters } = fakes();
  const { rc, report } = await runLifecycle(
    ["load", "--project", "/repo", "--session", "s1", "--query", "部署 分支", "--json"],
    adapters,
  );
  assert.equal(rc, 0);
  assert.equal(report.operation, "load");
  const layers = report.candidates.map((c) => c.layer);
  assert.deepEqual(layers, ["knowledge", "knowledge", "knowledge", "experience", "experience", "experience", "hot", "hot", "hot", "hot", "hot"]);
  // know ref：modules 相对路径去 .md；kroot 直下页保留名字
  assert.deepEqual(
    report.candidates.filter((c) => c.layer === "knowledge").map((c) => c.ref),
    ["know:knowledge-index", "know:principles", "know:sub/review"],
  );
  assert.deepEqual(
    report.candidates.filter((c) => c.layer === "experience").map((c) => c.ref),
    ["exp:20260101-090000-aaaa", "exp:20260101-090100-bbbb", "exp:20260101-090200-cccc"],
  );
  assert.deepEqual(
    report.candidates.filter((c) => c.layer === "hot").map((c) => c.ref),
    ["hot:u1", "hot:u2", "hot:u3", "hot:u4", "hot:u5"],
  );
  assert.ok(report.candidates.find((c) => c.ref === "hot:u1").content.includes("热记忆甲"));
  // hot.recall 收到默认 limit 5 与 project
  assert.deepEqual(calls.hot.find((c) => c.op === "recall").arg, { query: "部署 分支", limit: 5, project: "/repo" });
});

test("load --limit 2 只覆盖热层限额", async () => {
  const { calls, adapters } = fakes();
  const { rc, report } = await runLifecycle(
    ["load", "--project", "/repo", "--session", "s1", "--query", "q", "--limit", "2"],
    adapters,
  );
  assert.equal(rc, 0);
  assert.equal(calls.hot[0].arg.limit, 2);
  assert.equal(report.candidates.filter((c) => c.layer === "hot").length, 2);
  assert.equal(report.candidates.filter((c) => c.layer === "knowledge").length, 3, "知识层限额不受 --limit 影响");
});

test("load：缺必填参数 rc2", async () => {
  for (const argv of [
    ["load", "--project", "/repo", "--session", "s1"],
    ["load", "--query", "q"],
    ["load", "--project", "/repo", "--query", "q"],
    ["load", "--project", "/repo", "--session", "s1", "--query", "q", "--limit", ""],
    ["load", "--project", "/repo", "--session", "s1", "--query", "q", "--limit", "0x10"],
  ]) {
    const { rc } = await runLifecycle(argv, fakes().adapters);
    assert.equal(rc, 2, `${argv.join(" ")} 应 rc2`);
  }
});

test("load：热层失败不阻断温层，任何 failed → rc1", async () => {
  const { adapters } = fakes({ recall: () => { throw new Error("service down"); } });
  const { rc, report } = await runLifecycle(
    ["load", "--project", "/repo", "--session", "s1", "--query", "q"],
    adapters,
  );
  assert.equal(rc, 1);
  assert.ok(report.candidates.some((c) => c.layer === "knowledge"), "热层失败时知识层候选仍应装配");
  assert.equal(report.actions.find((a) => a.layer === "hot").status, "failed");
  assert.ok(report.errors.length >= 1);
});

test("load：经验/知识查询失败 → 两温层标 failed，热层照常，rc1", async () => {
  const { adapters } = fakes({ query: () => { throw new Error("ae.mjs boom"); } });
  const { rc, report } = await runLifecycle(
    ["load", "--project", "/repo", "--session", "s1", "--query", "q"],
    adapters,
  );
  assert.equal(rc, 1);
  assert.ok(report.candidates.some((c) => c.layer === "hot"), "温层失败时热层候选仍应装配");
  assert.ok(report.actions.filter((a) => a.op === "query").every((a) => a.status === "failed"));
});

test("settle：调 hot.settle＋返回两条 agent_actions，零 LLM 零写入", async () => {
  const { calls, adapters } = fakes();
  const { rc, report } = await runLifecycle(["settle", "--project", "/repo", "--session", "s9", "--json"], adapters);
  assert.equal(rc, 0);
  assert.deepEqual(calls.hot[0], { op: "settle", arg: { project: "/repo", session: "s9" } });
  assert.deepEqual(
    report.agent_actions.map((a) => `${a.skill}:${a.action}`).sort(),
    ["agent-experience:capture-if-signaled", "project-compound:ingest-if-material"],
  );
  assert.equal(report.actions[0].status, "done");
});

test("settle：热层失败 → rc1", async () => {
  const { adapters } = fakes({ settle: () => { throw new Error("unreachable"); } });
  const { rc, report } = await runLifecycle(["settle", "--project", "/repo", "--session", "s9"], adapters);
  assert.equal(rc, 1);
  assert.equal(report.actions[0].status, "failed");
});

test("maintain：缺省 report-only——lint findings 记 findings 非 failed，purge/distill skipped，groom 缺席记 skipped:groom_unavailable", async () => {
  const { calls, adapters } = fakes();
  const { rc, report } = await runLifecycle(["maintain", "--json"], adapters);
  assert.equal(rc, 0, "findings/done/skipped 均 rc0");
  const byKey = Object.fromEntries(report.actions.map((a) => [`${a.layer}:${a.op}`, a]));
  assert.equal(byKey["knowledge:lint"].status, "findings");
  assert.equal(byKey["hot:purge"].status, "skipped");
  assert.equal(byKey["hot:purge"].reason, "report_only");
  assert.equal(byKey["hot:distill"].status, "skipped");
  assert.equal(byKey["experience:groom"].status, "skipped");
  assert.equal(byKey["experience:groom"].reason, "groom_unavailable");
  assert.equal(calls.hot.filter((c) => c.op === "noiseSweep")[0].arg.dry_run, true, "report-only 下 noiseSweep 走 dry_run");
  assert.equal(calls.hot.filter((c) => c.op === "purge").length, 0, "report-only 不调 purge");
  assert.ok(report.reports.some((r) => String(r.text ?? r).includes("INDEX_GAP")), "lint 发现须进 reports");
});

test("maintain --apply：purge/noiseSweep(dry_run=false)/groom(apply=true) 实调，distill 适配器缺席仍 skipped", async () => {
  const { calls, adapters } = fakes({
    groom: ({ phase, apply }) => ({ status: "done", phase, apply }),
  });
  const { rc, report } = await runLifecycle(["maintain", "--apply"], adapters);
  assert.equal(rc, 0);
  assert.equal(calls.hot.filter((c) => c.op === "purge").length, 1);
  assert.equal(calls.hot.filter((c) => c.op === "noiseSweep")[0].arg.dry_run, false);
  assert.deepEqual(
    calls.experience.find((c) => c.op === "groom").arg,
    { phase: "all", apply: true, project: undefined, store: undefined },
  );
  assert.equal(report.actions.find((a) => a.op === "groom").status, "done");
});

test("maintain --phase 仅 experience scope 合法：scope 非 experience → rc2；experience → 透传 phase", async () => {
  const a1 = fakes();
  const r1 = await runLifecycle(["maintain", "--phase", "groom"], a1.adapters);
  assert.equal(r1.rc, 2, "--phase 配全 scope 应 rc2");
  const a2 = fakes({ groom: ({ phase }) => ({ status: "done", phase }) });
  const r2 = await runLifecycle(["maintain", "--scope", "experience", "--phase", "judge"], a2.adapters);
  assert.equal(r2.rc, 0);
  assert.equal(a2.calls.experience[0].arg.phase, "judge");
  assert.equal(r2.report.actions.length, 1, "scope=experience 只有一个 groom 动作");
  const r3 = await runLifecycle(["maintain", "--scope", "experience", "--phase", "bogus"], fakes().adapters);
  assert.equal(r3.rc, 2, "非法 phase 值 rc2");
});

test("maintain：scope 过滤与非法 scope 值", async () => {
  const { adapters } = fakes();
  const { rc, report } = await runLifecycle(["maintain", "--scope", "hot"], adapters);
  assert.equal(rc, 0);
  assert.ok(report.actions.every((a) => a.layer === "hot"), "scope=hot 只应含热层动作");
  const bad = await runLifecycle(["maintain", "--scope", "hot,bogus"], adapters);
  assert.equal(bad.rc, 2);
});

test("maintain：单层失败不阻断他层且 rc1；lint 干净记 done", async () => {
  const { adapters } = fakes({ lint: () => { throw new Error("lint boom"); } });
  const { rc, report } = await runLifecycle(["maintain"], adapters);
  assert.equal(rc, 1);
  assert.equal(report.actions.find((a) => a.op === "lint").status, "failed");
  assert.ok(report.actions.some((a) => a.layer === "hot"), "知识层失败不阻断热层");
  const clean = fakes({ lint: () => ({ rc: 0, out: "knowledge lint: 0 findings" }) });
  const r2 = await runLifecycle(["maintain"], clean.adapters);
  assert.equal(r2.rc, 0);
  assert.equal(r2.report.actions.find((a) => a.op === "lint").status, "done");
});

test("promote dry-run：只做 proposal 校验＋返回 ingest 指令，status=candidate 不写任何层", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sm-lc-"));
  const p = join(dir, "proposal.md");
  writeFileSync(p, "---\nverdict: approved\n---\n# 提案\n三行结论＋两条证据\n");
  const { calls, adapters } = fakes();
  const { rc, report } = await runLifecycle(["promote", "--proposal", p, "--json"], adapters);
  assert.equal(rc, 0);
  assert.equal(report.actions[0].status, "candidate");
  assert.equal(report.actions[0].verdict, "approved");
  assert.ok(JSON.stringify(report.agent_actions).includes("project-compound"), "dry-run 须带 project-compound ingest 指令");
  assert.ok(JSON.stringify(report.reports).includes("ingest"), "ingest runbook 须进 reports");
  assert.equal(calls.experience.length, 0, "dry-run 零调用经验层");
  // 未批准提案：可校验但 verdict 如实回显，仍 candidate（apply 阶段才拒）
  writeFileSync(p, "verdict: rejected\n");
  const r2 = await runLifecycle(["promote", "--proposal", p], adapters);
  assert.equal(r2.rc, 0);
  assert.equal(r2.report.actions[0].verdict, "rejected");
});

test("promote --apply：verdict 非 approved rc2；approved＋--experience/--to → 调 ae promote 记 done", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sm-lc-"));
  const p = join(dir, "proposal.md");
  writeFileSync(p, "verdict: pending\n");
  const { calls, adapters } = fakes();
  const rRej = await runLifecycle(["promote", "--proposal", p, "--apply", "--experience", "e1", "--to", "know:principles"], adapters);
  assert.equal(rRej.rc, 2, "verdict 非 approved 时 --apply 拒绝");
  writeFileSync(p, "---\nverdict: approved\n---\n");
  const rMiss = await runLifecycle(["promote", "--proposal", p, "--apply"], adapters);
  assert.equal(rMiss.rc, 2, "--apply 缺 --experience/--to rc2");
  const { rc, report } = await runLifecycle(
    ["promote", "--proposal", p, "--apply", "--experience", "20260101-090000-aaaa", "--to", "know:principles"],
    adapters,
  );
  assert.equal(rc, 0);
  assert.deepEqual(calls.experience.find((c) => c.op === "promote").arg, { id: "20260101-090000-aaaa", to: "know:principles" });
  assert.equal(report.actions[0].status, "done");
  const rNoFile = await runLifecycle(["promote", "--proposal", "/nonexistent/x.md"], adapters);
  assert.equal(rNoFile.rc, 2);
});

test("retire：同层各走各适配器；跨层组合 rc2；失败 rc1", async () => {
  const { calls, adapters } = fakes();
  const r1 = await runLifecycle(["retire", "--ref", "hot:u1", "--by", "hot:u2"], adapters);
  assert.equal(r1.rc, 0);
  assert.deepEqual(calls.hot[0], { op: "supersede", arg: { uid: "u1", by: "u2" } });
  assert.equal(r1.report.actions[0].layer, "hot");
  const r2 = await runLifecycle(["retire", "--ref", "exp:e1", "--by", "exp:e2"], adapters);
  assert.equal(r2.rc, 0);
  assert.deepEqual(calls.experience.find((c) => c.op === "supersede").arg, { id: "e1", by: "e2" });
  const rX = await runLifecycle(["retire", "--ref", "hot:u1", "--by", "exp:e2"], adapters);
  assert.equal(rX.rc, 2, "跨层组合 rc2");
  const rBad = await runLifecycle(["retire", "--ref", "git:u1", "--by", "git:u2"], adapters);
  assert.equal(rBad.rc, 2, "未知层前缀 rc2");
  const rMiss = await runLifecycle(["retire", "--ref", "hot:u1"], adapters);
  assert.equal(rMiss.rc, 2);
  const fail = fakes({ hotSupersede: () => { throw new Error("409"); } });
  const rFail = await runLifecycle(["retire", "--ref", "hot:u1", "--by", "hot:u2"], fail.adapters);
  assert.equal(rFail.rc, 1);
  assert.equal(rFail.report.actions[0].status, "failed");
});

test("load：适配器载荷形状不设防（null 列表/缺 file/非数组 hits）→ 不抛 TypeError、报告完整、他层照常（B1）", async () => {
  const badWarm = fakes({ query: () => ({ knowledge: null }) });
  const r1 = await runLifecycle(["load", "--project", "/repo", "--session", "s1", "--query", "q"], badWarm.adapters);
  assert.equal(r1.rc, 0, "null 载荷按空结果降级，不判层失败");
  assert.ok(r1.report.candidates.some((c) => c.layer === "hot"), "温层空形状不阻断热层");
  assert.deepEqual(r1.report.actions.filter((a) => a.op === "query").map((a) => a.status), ["done", "done"]);

  const badHot = fakes({ recall: () => ({ hits: null }) });
  const r2 = await runLifecycle(["load", "--project", "/repo", "--session", "s1", "--query", "q"], badHot.adapters);
  assert.equal(r2.rc, 0, "热层非数组载荷按空结果降级");
  assert.equal(r2.report.actions.find((a) => a.layer === "hot").hits, 0);
  assert.ok(r2.report.candidates.some((c) => c.layer === "knowledge"), "热层坏形状不阻断温层");

  const badFile = fakes({ query: () => ({ knowledge: [{ title: "无 file 字段" }], experiences: [] }) });
  const r3 = await runLifecycle(["load", "--project", "/repo", "--session", "s1", "--query", "q"], badFile.adapters);
  assert.equal(r3.rc, 0, "缺 file 字段的命中只作废自身，不判层失败");
  assert.equal(r3.report.candidates.filter((c) => c.layer === "knowledge").length, 0);
});

test("promote verdict：全文末次声明胜出——示例块 approved 压不过有效 rejected（B2）", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sm-lc-"));
  const p = join(dir, "proposal.md");
  const { adapters } = fakes();
  writeFileSync(p, "提案模板示例：\nverdict: approved\n---\n正文有效裁决：\nverdict: rejected\n");
  const r1 = await runLifecycle(["promote", "--proposal", p, "--apply", "--experience", "e1", "--to", "know:x"], adapters);
  assert.equal(r1.rc, 2, "末次声明 rejected 时示例块 approved 不得放行");
  assert.equal(r1.report.actions.length, 0, "rc2 前置拒绝不应产生 action");
  // 修订历史：pending → approved（末次胜出）应放行
  writeFileSync(p, "verdict: pending\n结论一\nverdict: approved\n");
  const r2 = await runLifecycle(["promote", "--proposal", p, "--apply", "--experience", "e1", "--to", "know:x"], adapters);
  assert.equal(r2.rc, 0, "末次 approved 应放行（修订历史语义）");
  assert.equal(r2.report.actions[0].status, "done");
  // dry-run 回显同样取末次
  writeFileSync(p, "verdict: approved\nverdict: rejected\n");
  const r3 = await runLifecycle(["promote", "--proposal", p], adapters);
  assert.equal(r3.report.actions[0].verdict, "rejected");
});

test("lintOutcome：spawn 失败/输出非 lint 签名 → 抛错（failed/rc1 可达），正常输出透传（B3）", async () => {
  assert.throws(() => lintOutcome({ error: new Error("ENOENT") }), /spawn 失败/);
  assert.throws(
    () => lintOutcome({ status: 1, stdout: "node:internal/modules/cjs/loader:1568 Cannot find module" }),
    /后端输出异常/,
    "ae.mjs 缺失的 node 崩溃输出不得折叠成 findings",
  );
  const ok = lintOutcome({ status: 1, stdout: "INDEX_GAP modules/x.md\nknowledge lint: 1 findings（…）\n" });
  assert.equal(ok.rc, 1);
  assert.ok(ok.out.includes("INDEX_GAP"));
});

test("bin/silicon-memory 根 dispatch 已接线五命令（bash 面不 exec 真适配器，静态断言）", () => {
  const sh = readFileSync(join(HERE, "silicon-memory"), "utf8");
  assert.ok(sh.includes("load|settle|maintain|promote|retire"), "dispatch case 缺失");
  assert.ok(sh.includes("lifecycle.mjs"), "lifecycle.mjs 入口缺失");
  assert.ok(sh.includes("memory)"), "旧 memory 子命令须保持兼容");
  assert.ok(sh.includes("knowledge)"), "旧 knowledge 子命令须保持兼容");
});

test("生产 hot 适配器：无 MEMORY_TOKEN 服务的 /api/maintenance/* 403 bulk-disabled 降级 skipped，其余 403 照抛", async () => {
  const realFetch = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url, init) => {
    seen.push(String(url));
    const body403 = JSON.stringify({ error: "bulk maintenance disabled without MEMORY_TOKEN; use the CLI" });
    if (String(url).includes("/api/maintenance/")) return new Response(body403, { status: 403, headers: { "content-type": "application/json" } });
    if (String(url).includes("/idle")) return new Response(JSON.stringify({ error: "host not allowed" }), { status: 403, headers: { "content-type": "application/json" } });
    return new Response(JSON.stringify({ hits: [] }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const prevUrl = process.env.MEMORY_PLUGIN_URL;
  process.env.MEMORY_PLUGIN_URL = "http://127.0.0.1:9";
  try {
    const hot = defaultAdapters().hot;
    assert.deepEqual(await hot.noiseSweep({ dry_run: true }), { status: "skipped", reason: "bulk_disabled_without_token" });
    assert.deepEqual(await hot.purge(), { status: "skipped", reason: "bulk_disabled_without_token" });
    // recall 不在维护面：正常返回，不触降级
    assert.deepEqual(await hot.recall({ query: "q", limit: 1, project: "/r" }), []);
    await assert.rejects(
      hot.settle(),
      /POST \/idle → 403/,
      "非 bulk-disabled 的 403 不应被降级吞掉",
    );
  } finally {
    globalThis.fetch = realFetch;
    if (prevUrl === undefined) delete process.env.MEMORY_PLUGIN_URL; else process.env.MEMORY_PLUGIN_URL = prevUrl;
  }
});
