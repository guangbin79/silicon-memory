#!/usr/bin/env node
// ae.mjs — agent-experience 确定性步骤 CLI（plan agent-skills-opt todo 6）
// 零第三方依赖：仅 node:{fs,crypto,path,os,child_process}。store 一律只读；validate/score/verify-anchors 目标只读。
// 机器检查面分工：lint.sh 保留跨文件/git 类检查（§9/§12），格式类检查归 validate；lint.sh 转 deprecated，文件保留供人工过渡。
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const DEFAULT_STORE = path.join(os.homedir(), '.dotfiles', '.agent-experiences');
const REQUIRED_KEYS = ['id', 'created_at', 'type', 'project', 'summary', 'tags', 'status', 'schema_version'];
const TYPE_ENUM = ['debug', 'architecture', 'integration', 'tool', 'decision', 'other'];
const EPISTEMIC_ENUM = ['observational', 'interpretive', 'belief']; // 可选键 epistemic 的枚举（belief=结构化信念，holds/falsifies 必填；缺省=未分型）
const ID_RE = /^[0-9]{8}-[0-9]{6}-[0-9a-f]{4}$/;
const KEY_LINE_RE = /^([A-Za-z][A-Za-z0-9_-]*): ?(.*)$/;
// 与盘上 INDEX.md 头注逐字节一致（legacy 规则：无 summary 的记录第 5 列回填 title）
const INDEX_HEADER = [
  '# Experience Index',
  '',
  '> Derived cache. Regenerable from the experience files. Do not hand-edit beyond appending rows. Column 5 is summary (title for legacy rows).',
  '> Rebuild: `grep -h "^id:" experiences/*.md 2>/dev/null | sort`',
  '',
  'id | date | type | project | summary | tags',
  '---|------|------|---------|-------|------',
];

// ---- 解析：flat frontmatter（无嵌套/多行值；键列 0 起）+ 正文首个 H1 作 title ----
function parseFile(text) {
  const lines = text.split('\n');
  const fm = new Map();
  const fmLines = [];
  let bodyStart = lines.length;
  let fmClosed = false;
  if (lines[0] === '---') {
    for (let i = 1; i < lines.length; i++) {
      if (lines[i] === '---') { bodyStart = i + 1; fmClosed = true; break; }
      fmLines.push(lines[i]);
      const m = KEY_LINE_RE.exec(lines[i]);
      if (m) fm.set(m[1], m[2]);
    }
  }
  const h1 = lines.slice(bodyStart).find((l) => /^# .+/.test(l));
  // hasFm＝闭合围栏存在（正文可空）——EOF 恰在闭合 --- 的文件不再误报 NO_FRONTMATTER，与 index 消费口径一致
  return { fm, fmLines, hasFm: fmClosed, title: h1 ? h1.slice(2) : null };
}

const readOk = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } };

const listExperiences = (store) => {
  const dir = path.join(store, 'experiences');
  let names = [];
  try { names = fs.readdirSync(dir).filter((f) => f.endsWith('.md')).sort(); } catch {}
  return names.map((f) => path.join(dir, f));
};

// ---- id：YYYYMMDD-HHMMSS-<4hex>（crypto.randomBytes，同 live Step 2 语义） ----
function mintId() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const ts = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  return `${ts}-${crypto.randomBytes(2).toString('hex')}`;
}

function cmdId() {
  return { rc: 0, out: `${mintId()}\n` };
}

// ---- INDEX 追加一行：排序位插入（保 index --check 恒绿）；无数据行（缺文件/0 字节/仅头）按 fresh 整写 header+行，与 regenerateIndex 逐字节一致 ----
function appendIndexRow(store, row) {
  const idx = path.join(store, 'INDEX.md');
  let data = [];
  let lines = [];
  if (fs.existsSync(idx)) {
    lines = fs.readFileSync(idx, 'utf8').split('\n');
    data = lines.map((l, k) => (/^20/.test(l) ? k : -1)).filter((k) => k >= 0); // 数据行＝id 起始
  }
  if (!data.length) { // 0 字节文件 split 出 ['']，不得产出无头 INDEX
    fs.mkdirSync(store, { recursive: true });
    fs.writeFileSync(idx, [...INDEX_HEADER, row].join('\n') + '\n');
    return;
  }
  let at = data[data.length - 1] + 1;
  for (const k of data) if (lines[k] > row) { at = k; break; }
  lines.splice(at, 0, row);
  const text = lines.join('\n');
  fs.writeFileSync(idx, text.endsWith('\n') ? text : `${text}\n`);
}

// ---- capture --from：草稿落盘（gt-24a8）。id 缺省铸+回填（扫描止于闭合围栏）；ID_RE 前置校验防路径逃逸；
//      重复 id／空 related（lint §5 实例 20261022-162609-0544）／INDEX 列破坏值（created_at・回填 title 含 |）／控制字节拒绝；
//      validate 经临时目录 <id>.md 跑以满足 id=stem 契约，失败清临时、store 零接触；
//      store 写阶段锁文件串行化（并发 capture 防 INDEX 读-改-写丢行，陈旧锁 10s 抢占），任一步失败回滚记录文件——重试安全 ----
function cmdCapture(store, draftPath) {
  const text = readOk(draftPath);
  if (text === null) return { rc: 2, out: `capture: 草稿不可读: ${draftPath}\n` + usage() };
  const { fm, hasFm, title } = parseFile(text);
  if (!hasFm) return { rc: 1, out: 'capture: 草稿缺 frontmatter（--- 围栏），拒绝\n' };
  let id = fm.get('id');
  const minted = id === undefined || id.trim() === '';
  if (minted) id = mintId();
  else if (!ID_RE.test(id)) return { rc: 1, out: `capture: id 格式非法: ${id}\n` };
  const related = fm.get('related');
  if (related !== undefined && related.trim() === '') return { rc: 1, out: 'capture: 空 related 行拒绝（lint §5，实例 20261022-162609-0544）\n' };
  const createdAt = fm.get('created_at') ?? '';
  if (createdAt.includes('|')) return { rc: 1, out: 'capture: created_at 含 | 拒绝（INDEX 列完整性）\n' };
  if (!fm.has('summary') && (title ?? '').includes('|')) return { rc: 1, out: 'capture: 无 summary 时回填 title 含 | 拒绝（INDEX 列完整性）\n' };
  let out = text;
  if (minted) {
    const lines = text.split('\n');
    const open = lines.indexOf('---');
    const close = lines.indexOf('---', open + 1);
    const at = lines.findIndex((l, k) => k > open && k < close && /^id:/.test(l));
    if (at !== -1) lines[at] = `id: ${id}`;
    else lines.splice(open + 1, 0, `id: ${id}`);
    out = lines.join('\n');
  }
  if (/[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(out)) return { rc: 1, out: 'capture: 含控制字节拒绝（lint §5 同源）\n' };
  let tmp;
  try {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ae-capture-'));
  } catch (e) {
    return { rc: 2, out: `capture: 临时目录不可用: ${e.message}\n` };
  }
  try {
    fs.writeFileSync(path.join(tmp, `${id}.md`), out);
    const v = cmdValidate(path.join(tmp, `${id}.md`));
    if (v.rc !== 0) return { rc: 1, out: `capture: validate 未过，store 零接触\n${v.out}` };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  try {
    fs.mkdirSync(store, { recursive: true }); // fresh store 也要能落锁文件（R2-M2：--store 指向普通文件等环境错误干净 rc2）
  } catch (e) {
    return { rc: 2, out: `capture: store 不可用: ${e.message}\n` };
  }
  const lockPath = path.join(store, '.capture.lock');
  const lockToken = crypto.randomBytes(8).toString('hex');
  const deadline = Date.now() + 10_000;
  let lockFd = -1;
  for (;;) {
    try { lockFd = fs.openSync(lockPath, 'wx'); fs.writeFileSync(lockFd, lockToken); break; }
    catch (e) {
      if (e.code !== 'EEXIST') return { rc: 2, out: `capture: 锁不可用: ${e.message}\n` };
      let stale = true;
      try { stale = Date.now() - fs.statSync(lockPath).mtimeMs > 10_000; } catch {} // 锁已消失→重试即得
      if (stale) { try { fs.unlinkSync(lockPath); } catch {} } // 抢占陈旧锁；失败也过下界＋sleep（R2-M1 热旋修复）
      if (Date.now() > deadline) return { rc: 1, out: 'capture: store 锁等待超时，稍后重试\n' };
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    }
  }
  try {
    if (fs.existsSync(path.join(store, 'experiences', `${id}.md`))) return { rc: 1, out: `capture: 重复 id 拒绝: ${id}\n` };
    const target = path.join(store, 'experiences', `${id}.md`);
    const row = [id, createdAt, fm.get('type') ?? '', fm.get('project') ?? '', fm.has('summary') ? fm.get('summary') : (title ?? ''), fm.get('tags') ?? ''].join(' | ');
    const idxPath = path.join(store, 'INDEX.md');
    let idxBackup = null;
    try {
      fs.mkdirSync(path.join(store, 'experiences'), { recursive: true }); // R2-M3：入内层 try，环境错误走干净 rc1
      idxBackup = readOk(idxPath);
      fs.writeFileSync(target, out);
      appendIndexRow(store, row);
    } catch (e) {
      try { fs.unlinkSync(target); } catch {} // 回滚半完成态——重试安全
      if (idxBackup !== null) { try { fs.writeFileSync(idxPath, idxBackup); } catch {} } // INDEX 半写还原（R2-L5）
      return { rc: 1, out: `capture: store 写入失败已回滚: ${e.message}\n` };
    }
    return { rc: 0, out: `${id}\n${target}\n` };
  } finally {
    try {
      let mine = false;
      try { mine = fs.readFileSync(lockPath, 'utf8') === lockToken; } catch {} // 所有权校验：被抢占后不得误删后继锁（R2-M4）
      if (mine) fs.unlinkSync(lockPath);
    } catch {}
    try { fs.closeSync(lockFd); } catch {}
  }
}

// ---- dedup：全文大小写不敏感匹配（保守超集——live Step 1 为大小写敏感 grep -l，取超集方向免漏报）；
//      只报命中不裁决，三分支判断留给 agent。命中底座 storeMdHits＝扫面＋前缀过滤（verifier 允许表）＋匹配＋统一 hit 形状，
//      experienceHits/verifierHits 共用（F2 [3][4] 去重）；排序策略由调用点传入（有意不同：
//      experience=文件名序（listExperiences 已序），verifier=全路径码元序——此处只执行不裁决） ----
function storeMdHits(store, needle, { allTree = false, allowPrefixes = [], sort = (l) => l, skip = null } = {}) {
  const files = [];
  if (allTree) {
    const walk = (dir) => {
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        if (e.name.startsWith('.')) continue;
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith('.md')) files.push(p);
      }
    };
    walk(store);
  } else {
    files.push(...listExperiences(store));
  }
  const hits = [];
  for (const file of sort(files)) {
    const rel = path.relative(store, file);   // 每文件算一次（前缀过滤共用）
    if (allowPrefixes.length && !allowPrefixes.some((pre) => rel.startsWith(pre))) continue;
    const text = readOk(file);
    if (text === null || !text.toLowerCase().includes(needle)) continue;
    const { fm, title } = parseFile(text);
    if (skip && skip(fm)) continue;
    hits.push({
      file,
      title,
      type: fm.get('type') ?? null,
      tags: (fm.get('tags') ?? '').split(',').map((t) => t.trim()).filter(Boolean),
    });
  }
  return hits;
}

function experienceHits(store, needle) {
  // 温层退役滤除（warm-supersede-marking 教条）：带 superseded_by/promoted_to 标记的条目不再作为现行指导命中
  return storeMdHits(store, needle, { skip: (fm) => fm.has('superseded_by') || fm.has('promoted_to') });
}

function cmdDedup(store, word, scope) {
  if (scope === 'verifier') return { rc: 0, out: JSON.stringify({ hits: verifierHits(store, word.toLowerCase()) }) + '\n' };
  return { rc: 0, out: JSON.stringify({ hits: experienceHits(store, word.toLowerCase()) }) + '\n' };
}

// ---- supersede/promote：温层退役标记（warm-supersede-marking 教条：零物理删除，生命周期由 frontmatter 可选键合成）----
// supersede <id> --by <新经验id> → superseded_by（被推翻）；promote <id> --to <语义页引用> → promoted_to（已升华）。
// 标记后 experiences/ 作用域查询默认滤除；INDEX.md 仍全量列示（库存面与查询面分离）。重复标记＝幂等改写指针。
function updateFmMark(file, key, value) {
  const lines = (readOk(file) ?? '').split('\n');
  if (lines[0] !== '---') return { rc: 1, out: `${path.basename(file)}: 无 frontmatter\n` };
  let done = false;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === '---') { lines.splice(i, 0, `${key}: ${value}`); done = true; break; }
    if (lines[i].startsWith(`${key}: `)) { lines[i] = `${key}: ${value}`; done = true; break; }
  }
  if (!done) return { rc: 1, out: `${path.basename(file)}: frontmatter 未闭合\n` };
  fs.writeFileSync(file, lines.join('\n'));
  return { rc: 0, out: `${path.basename(file, '.md')}: ${key}=${value}\n` };
}

function cmdMark(store, id, key, value) {
  const file = path.join(store, 'experiences', `${id}.md`);
  if (!readOk(file)) return { rc: 2, out: `${key}: 经验不存在: ${id}\n` + usage() };
  return updateFmMark(file, key, value);
}

// ---- dedup --scope=verifier：盲视作用域——verifier 角色不得经查重复读到经验正文、知识层与经验派生聚合。
//      允许表（allowlist 反转，唯一前缀，相对 store 根）：practice/＝practice 子系统自有轮次台账/记录/scratch，
//      即契约「仅任务规约/执行证据/协议路径可命中」——INDEX.md/reuses.md/skill-uses.md 等经验派生聚合天然不可见
//      （黑名单枚举会随派生文件增长漏排成 Existence Oracle，allowlist 堵死）。无 flag 路径逐字节不变（仍只扫 <store>/experiences/）。
const VERIFIER_ALLOW_PREFIXES = ['practice/'];   // 段边界：尾随 / 防匹配兄弟目录（practice2/ 等）

function verifierHits(store, needle) {
  return storeMdHits(store, needle, { allTree: true, allowPrefixes: VERIFIER_ALLOW_PREFIXES, sort: (l) => l.sort() }); // 全树过允许表，全路径码元序
}
// ---- validate：frontmatter 契约（references/operations.md Step 3 清单 + templates.md Schema）----   // [ocr-10] 段横幅还原（此前插入吞噬）
// 必填键齐全（archived 豁免 summary）/ 单行平面值 / summary 禁 | 与 ASCII ": "（全角 ： OK）/ tags 与 project 禁 | / type 枚举 / id 格式=文件名 stem
function cmdValidate(file) {
  const findings = [];
  const push = (code, subject, evidence, supportedFixes) => findings.push({ code, subject, evidence, supportedFixes });
  const text = readOk(file);
  if (text === null) {
    push('UNREADABLE_FILE', 'file', file, ['检查路径是否正确']);
  } else {
    const { fm, fmLines, hasFm } = parseFile(text);
    if (!hasFm) push('NO_FRONTMATTER', 'frontmatter', '文件未以 --- 开头并关闭', ['用 --- 包裹平面 key: value 块（每行一键，列 0 起）']);
    for (const l of fmLines) {
      if (l.trim() !== '' && !KEY_LINE_RE.test(l)) {
        push('MULTILINE_VALUE', 'frontmatter', l.trim(), ['frontmatter 须平面单行——每行一个 key: value，嵌套/续行内容移入 body']);
      }
    }
    const archived = fm.get('status') === 'archived'; // archived 豁免 summary（lint.sh §2 语义，存量 archived 记录无 summary）
    for (const k of REQUIRED_KEYS) {
      if (archived && k === 'summary') continue;
      if (!fm.has(k)) push('MISSING_KEY', k, 'frontmatter 无该键', [`在 frontmatter 补一行 \`${k}: <value>\`（flat 单行）`]);
    }
    const id = fm.get('id');
    if (id !== undefined) {
      if (!ID_RE.test(id)) push('ID_FORMAT', 'id', id, ['格式须为 YYYYMMDD-HHMMSS-<4hex>（hex 恰 4 位），重新生成：node bin/ae.mjs id']);
      const stem = path.basename(file).replace(/\.md$/, '');
      if (id !== stem) push('ID_STEM_MISMATCH', 'id', `id=${id} vs 文件名 stem=${stem}`, ['id 必须等于文件名 stem；以 id 重命名文件或修正 id']);
    }
    const summary = fm.get('summary');
    if (summary !== undefined) {
      if (summary.includes('|')) push('SUMMARY_PIPE', 'summary', summary, ['ASCII | 是 INDEX 列分隔符——改写为文字或全角 ｜，或移入 body']);
      if (summary.includes(': ')) push('SUMMARY_ASCII_COLON', 'summary', summary, ['ASCII 冒号+空格破坏 cut 解析——改用全角 ：或去掉冒号后空格']);
    }
    for (const k of ['tags', 'project']) {
      const v = fm.get(k);
      if (v !== undefined && v.includes('|')) push('PIPE_IN_FIELD', k, v, ['ASCII | 是 INDEX 列分隔符——改写为文字或全角 ｜']);
    }
    const type = fm.get('type');
    if (type !== undefined && !TYPE_ENUM.includes(type)) {
      push('TYPE_ENUM', 'type', type, [`type 只能是 ${TYPE_ENUM.join(' | ')} 之一`]);
    }
    const epistemic = fm.get('epistemic');
    if (epistemic !== undefined && !EPISTEMIC_ENUM.includes(epistemic)) {
      push('EPISTEMIC_ENUM', 'epistemic', epistemic, [`epistemic 只能是 ${EPISTEMIC_ENUM.join(' | ')} 之一（可选键，缺省=未分型）`]);
    }
    if (epistemic === 'belief') { // #0025：belief 记录必带 holds/falsifies（非空单行）
      for (const k of ['holds', 'falsifies']) {
        const v = fm.get(k);
        if (v === undefined || v.trim() === '') {
          push('BELIEF_MISSING_FIELD', k, `epistemic: belief 要求 ${k}: 非空单行`, [`在 frontmatter 补一行 \`${k}: <条件>\`（flat 单行）`]);
        }
      }
    }
  }
  const out = findings.length ? findings.map((f) => JSON.stringify(f)).join('\n') + '\n' : '';
  return { rc: findings.length ? 1 : 0, out };
}

// ---- index --check：由 frontmatter 重生成 INDEX.md 与盘上 diff（一致 rc0／漂移 rc1 并打印漂移行）----
function regenerateIndex(store) {
  const rows = [];
  for (const file of listExperiences(store)) {
    const { fm, title } = parseFile(readOk(file));
    const id = fm.get('id');
    if (id === undefined) continue;
    const summary = fm.has('summary') ? fm.get('summary') : (title ?? '');
    rows.push([id, fm.get('created_at') ?? '', fm.get('type') ?? '', fm.get('project') ?? '', summary, fm.get('tags') ?? ''].join(' | '));
  }
  rows.sort();
  return [...INDEX_HEADER, ...rows].join('\n') + '\n';
}

function cmdIndexCheck(store) {
  const regen = regenerateIndex(store);
  const diskRaw = readOk(path.join(store, 'INDEX.md'));
  if (diskRaw === null) return { rc: 1, out: 'INDEX.md not found under store\n' };
  // 行尾空白与文件尾空行视为装饰性差异不判漂移；行序（sorted）漂移仍算
  const canon = (s) => s.split('\n').map((l) => l.replace(/\s+$/, '')).join('\n').replace(/\s+$/, '');
  const diskLines = canon(diskRaw).split('\n');
  const regenLines = canon(regen).split('\n');
  if (diskLines.join('\n') === regenLines.join('\n')) return { rc: 0, out: 'INDEX.md in sync\n' };
  const counts = (arr) => { const m = new Map(); for (const l of arr) m.set(l, (m.get(l) ?? 0) + 1); return m; };
  const diskCounts = counts(diskLines), regenCounts = counts(regenLines);
  const drift = [];
  for (const [l, n] of diskCounts) if ((regenCounts.get(l) ?? 0) < n) drift.push(`- ${l}`);
  for (const [l, n] of regenCounts) if ((diskCounts.get(l) ?? 0) < n) drift.push(`+ ${l}`);
  if (drift.length === 0) { // 集合相同=纯行序漂移，报告首个错位点
    const i = diskLines.findIndex((l, idx) => l !== regenLines[idx]);
    drift.push(`- ${diskLines[i]}`, `+ ${regenLines[i]}`);
  }
  return { rc: 1, out: drift.join('\n') + '\n' };
}

// ---- selfcheck：临时夹具 store 断言 validate/dedup/index 各 happy+failure 路径（含一条 legacy 无 summary 行）----
function cmdSelfcheck() {
  let pass = 0, fail = 0;
  const ok = (cond, name) => { console.log(`${cond ? 'PASS' : 'FAIL'} ${name}`); cond ? pass++ : fail++; };
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'ae-selfcheck-'));
  try {
    const expDir = path.join(fixture, 'experiences');
    fs.mkdirSync(expDir);
    fs.writeFileSync(path.join(expDir, '20260101-090000-aaaa.md'), [
      '---', 'id: 20260101-090000-aaaa', 'created_at: 2026-01-01', 'type: debug', 'project: FixtureProj',
      'summary: DMA-BUF 黑屏根因——desktop-GL-via-EGL 呈现断裂（全角冒号测试：OK）',
      'tags: dmabuf,egl,test', 'status: draft', 'schema_version: 1', '---',
      '# DMA-BUF 呈现断裂修复', '', 'body', '',
    ].join('\n'));
    fs.writeFileSync(path.join(expDir, '20260101-090500-bbbb.md'), [ // legacy：无 summary 行
      '---', 'id: 20260101-090500-bbbb', 'created_at: 2026-01-01', 'type: integration', 'project: LegacyProj',
      'tags: legacy,no-summary', 'status: confirmed', 'schema_version: 1', '---',
      '# sherpa-onnx 符号版本混合对修复', '', 'body', '',
    ].join('\n'));

    // validate happy
    let r = cmdValidate(path.join(expDir, '20260101-090000-aaaa.md'));
    ok(r.rc === 0 && r.out === '', 'validate happy: 干净文件 rc0');

    // validate failure 路径逐个触发（stem 与 id 保持一致以隔离单一发现，除非断言对象本身是 stem）
    const bad = (stem, fields) => {
      const f = path.join(expDir, `${stem}.md`);
      fs.writeFileSync(f, ['---', `id: ${stem}`, 'created_at: 2026-01-02', 'type: debug', 'project: P', ...fields, 'status: draft', 'schema_version: 1', '---', '# T', ''].join('\n'));
      return cmdValidate(f);
    };
    const badNames = [];
    const expect = (stem, fields, code, name) => {
      badNames.push(`${stem}.md`);
      const res = bad(stem, fields);
      ok(res.rc === 1 && res.out.includes(code), `validate failure: ${name}`);
    };
    expect('20260101-100000-c001', [], 'MISSING_KEY', '缺 summary 键 → MISSING_KEY');
    expect('20260101-100001-c002', ['summary: a | b'], 'SUMMARY_PIPE', 'summary 含 | → SUMMARY_PIPE');
    expect('20260101-100002-c003', ['summary: ascii: colon'], 'SUMMARY_ASCII_COLON', 'summary 含 ASCII 冒号空格 → SUMMARY_ASCII_COLON');
    expect('20260101-100003-c004', ['summary: ok', 'type: blog'], 'TYPE_ENUM', 'type 越枚举 → TYPE_ENUM');
    expect('20260101-100004-c005', ['summary: ok', '  nested: continuation'], 'MULTILINE_VALUE', '缩进续行 → MULTILINE_VALUE');
    expect('20260101-100005-c00g', ['summary: ok'], 'ID_FORMAT', 'id 尾缀非 hex → ID_FORMAT');
    {
      const stem = '20260101-100006-c007';
      const f = path.join(expDir, `${stem}.md`);
      fs.writeFileSync(f, ['---', 'id: 20260101-100006-c00x', 'created_at: 2026-01-02', 'type: debug', 'project: P', 'summary: ok', 'status: draft', 'schema_version: 1', '---', '# T', ''].join('\n'));
      badNames.push(`${stem}.md`);
      const res = cmdValidate(f);
      ok(res.rc === 1 && res.out.includes('ID_STEM_MISMATCH'), 'validate failure: id ≠ 文件名 stem → ID_STEM_MISMATCH');
    }
    for (const n of badNames) fs.rmSync(path.join(expDir, n)); // 清坏样本，保留两条正样本

    // dedup happy（大小写不敏感：小写查询命中大写 frontmatter/H1）
    r = cmdDedup(fixture, 'dma-buf');
    const hits = JSON.parse(r.out).hits;
    ok(r.rc === 0 && hits.length === 1 && hits[0].file.endsWith('20260101-090000-aaaa.md')
      && hits[0].title === 'DMA-BUF 呈现断裂修复' && hits[0].type === 'debug' && hits[0].tags.includes('dmabuf'),
      'dedup happy: 小写词命中大写内容，title/type/tags 解析正确');
    // dedup failure
    r = cmdDedup(fixture, 'zzz-no-such-token');
    ok(r.rc === 0 && JSON.parse(r.out).hits.length === 0, 'dedup failure: 无命中 → hits 空数组 rc0');

    // verifier scope（allowlist 反转，ocr-2/4 自检）：派生聚合盲视＋practice/ 台账可命中＋兄弟前缀边界＋坏 scope rc2
    {
      fs.writeFileSync(path.join(fixture, 'INDEX.md'), 'id | date | type | project | summary | tags\n20260101-090000-aaaa | 2026-01-01 | debug | FixtureProj | aggwordonlyinindex | dmabuf\n');
      fs.writeFileSync(path.join(fixture, 'reuses.md'), '# date | id | project | harness | outcome | note\n2026-01-05 | 20260101-090000-aaaa | P | opencode | helped | aggwordonlyinreuses\n');
      fs.mkdirSync(path.join(fixture, 'practice', 'rounds'), { recursive: true });
      fs.writeFileSync(path.join(fixture, 'practice', 'rounds', '20260101-000000-c0ff.md'), 'round ledger: evidenceword\n');
      fs.mkdirSync(path.join(fixture, 'practice2'));
      fs.writeFileSync(path.join(fixture, 'practice2', 'sibling.md'), 'sibling: evidenceword\n');
      fs.mkdirSync(path.join(fixture, 'experiences2'));
      fs.writeFileSync(path.join(fixture, 'experiences2', 'sibling-exp.md'), 'sibling-exp: aggwordonlyinindex\n');
      r = cmdDedup(fixture, 'aggwordonlyinindex', 'verifier');
      ok(r.rc === 0 && JSON.parse(r.out).hits.length === 0, 'verifier scope: INDEX.md/reuses.md 派生聚合盲视 → 0 hits');
      r = cmdDedup(fixture, 'dma-buf', 'verifier');
      ok(JSON.parse(r.out).hits.length === 0, 'verifier scope: experiences/ 经验正文盲视 → 0 hits');
      r = cmdDedup(fixture, 'evidenceword', 'verifier');
      ok(r.rc === 0 && JSON.parse(r.out).hits.length === 1 && JSON.parse(r.out).hits[0].file.includes('/practice/rounds/'), 'verifier scope: practice/rounds 台账可命中');
      ok(!JSON.parse(r.out).hits.some((h) => h.file.includes('practice2') || h.file.includes('experiences2')), 'verifier scope: 兄弟目录 practice2/·experiences2/ 不因前缀混淆命中（段边界）');
      r = main(['--store', fixture, 'dedup', 'w', '--scope=badscope']);
      ok(r.rc === 2, 'verifier scope: 未知 --scope 值 → rc2');
      r = main(['--store', fixture, 'dedup', '--verbose']);
      ok(r.rc === 2, 'dedup: 未知 --flag 拒绝 rc2（不误作关键词，ocr-5）');
      fs.rmSync(path.join(fixture, 'experiences2'), { recursive: true });
      fs.rmSync(path.join(fixture, 'practice2'), { recursive: true });
      fs.rmSync(path.join(fixture, 'practice'), { recursive: true });
      fs.rmSync(path.join(fixture, 'INDEX.md'));
      fs.rmSync(path.join(fixture, 'reuses.md'));
    }
    // index happy（legacy 行第 5 列回填 title）
    const regen = regenerateIndex(fixture);
    fs.writeFileSync(path.join(fixture, 'INDEX.md'), regen);
    const legacyRow = regen.split('\n').find((l) => l.startsWith('20260101-090500-bbbb'));
    ok(legacyRow !== undefined && legacyRow.includes('sherpa-onnx 符号版本混合对修复'), 'index legacy: 无 summary 记录第 5 列回填 title');
    r = cmdIndexCheck(fixture);
    ok(r.rc === 0, 'index happy: 重生成 INDEX 与盘上一致 rc0');
    // index failure（篡改一行 → 漂移行打印）
    fs.writeFileSync(path.join(fixture, 'INDEX.md'), regen.replace('DMA-BUF 黑屏根因', 'TAMPERED'));
    r = cmdIndexCheck(fixture);
    ok(r.rc === 1 && r.out.includes('- ') && r.out.includes('+ ') && r.out.includes('DMA-BUF 黑屏根因'), 'index failure: 行漂移 → rc1 并打印 -/+ 漂移行');

    // validate archived（lint.sh §2 语义：status: archived 豁免 summary，其余键仍必填）
    {
      const stem = '20260101-110000-d001';
      const f = path.join(expDir, `${stem}.md`);
      fs.writeFileSync(f, ['---', `id: ${stem}`, 'created_at: 2026-01-03', 'type: debug', 'project: ArchProj',
        'tags: arch', 'status: archived', 'schema_version: 1', '---', '# Archived record', ''].join('\n'));
      ok(cmdValidate(f).rc === 0, 'validate archived: archived 无 summary → 豁免 rc0');
      fs.writeFileSync(f, ['---', `id: ${stem}`, 'created_at: 2026-01-03', 'type: debug', 'project: ArchProj',
        'status: archived', 'schema_version: 1', '---', '# Archived record', ''].join('\n')); // 再抽掉 tags
      const resArch = cmdValidate(f);
      ok(resArch.rc === 1 && resArch.out.includes('MISSING_KEY') && resArch.out.includes('"subject":"tags"')
        && !resArch.out.includes('"subject":"summary"'), 'validate archived failure: archived 缺 tags → 仍 MISSING_KEY（仅豁免 summary）');
      fs.rmSync(f);
    }
    // validate failure: tags/project 含 | → PIPE_IN_FIELD（INDEX 列分隔符防护，与 SUMMARY_PIPE 同因扩展）
    for (const [stem, fmLine, field] of [['20260101-110001-d002', 'tags: a|b', 'tags'], ['20260101-110002-d003', 'project: P|Q', 'project']]) {
      const f = path.join(expDir, `${stem}.md`);
      fs.writeFileSync(f, ['---', `id: ${stem}`, 'created_at: 2026-01-03', 'type: debug', 'project: P', 'summary: ok', fmLine, 'status: draft', 'schema_version: 1', '---', '# T', ''].join('\n'));
      const res = cmdValidate(f);
      ok(res.rc === 1 && res.out.includes('PIPE_IN_FIELD') && res.out.includes(`"subject":"${field}"`), `validate failure: ${field} 含 | → PIPE_IN_FIELD(${field})`);
      fs.rmSync(f);
    }
    // EOF-at-fence：frontmatter 恰在文件尾闭合（无尾随换行、无正文）——validate 与 index 口径一致
    {
      const stem = '20260101-110003-e00f';
      const f = path.join(expDir, `${stem}.md`);
      fs.writeFileSync(f, ['---', `id: ${stem}`, 'created_at: 2026-01-03', 'type: tool', 'project: EofProj',
        'summary: eof fence', 'tags: eof', 'status: draft', 'schema_version: 1', '---'].join('\n'));
      const res = cmdValidate(f);
      const row = regenerateIndex(fixture).split('\n').find((l) => l.startsWith(stem));
      ok(res.rc === 0 && row !== undefined && row.includes('EofProj'), 'EOF-at-fence: 无正文无尾随换行 → validate rc0 且 index 消费其键（口径一致）');
      fs.rmSync(f);
    }
    // epistemic 可选键：合法值通过、非法值报 EPISTEMIC_ENUM（报错格式仿 TYPE_ENUM）
    {
      const stem = '20260101-120000-f001';
      const f = path.join(expDir, `${stem}.md`);
      fs.writeFileSync(f, ['---', `id: ${stem}`, 'created_at: 2026-01-04', 'type: debug', 'project: P',
        'summary: ok', 'tags: epi', 'epistemic: observational', 'status: confirmed', 'schema_version: 1', '---', '# T', ''].join('\n'));
      ok(cmdValidate(f).rc === 0, 'epistemic happy: 合法值 observational → rc0');
      fs.writeFileSync(f, ['---', `id: ${stem}`, 'created_at: 2026-01-04', 'type: debug', 'project: P',
        'summary: ok', 'tags: epi', 'epistemic: vibes', 'status: draft', 'schema_version: 1', '---', '# T', ''].join('\n'));
      const resEpi = cmdValidate(f);
      ok(resEpi.rc === 1 && resEpi.out.includes('EPISTEMIC_ENUM'), 'epistemic failure: 非法值 → EPISTEMIC_ENUM');
      // #0025：belief 合法值——holds/falsifies 齐 → rc0；缺则 BELIEF_MISSING_FIELD
      fs.writeFileSync(f, ['---', `id: ${stem}`, 'created_at: 2026-01-04', 'type: other', 'project: P',
        'summary: ok', 'tags: epi', 'epistemic: belief', 'status: draft', 'schema_version: 1',
        'holds: 上下文 A 内成立', 'falsifies: 观察到 X', '---', '# T', '', 'Evidence: E0（draft 信念蒸馏）', ''].join('\n'));
      ok(cmdValidate(f).rc === 0, 'belief happy: epistemic: belief＋holds/falsifies 齐 → rc0');
      fs.writeFileSync(f, ['---', `id: ${stem}`, 'created_at: 2026-01-04', 'type: other', 'project: P',
        'summary: ok', 'tags: epi', 'epistemic: belief', 'status: draft', 'schema_version: 1', '---', '# T', ''].join('\n'));
      const resBelief = cmdValidate(f);
      ok(resBelief.rc === 1 && resBelief.out.includes('BELIEF_MISSING_FIELD') && resBelief.out.includes('"subject":"holds"')
        && resBelief.out.includes('"subject":"falsifies"'), 'belief failure: epistemic: belief 缺 holds/falsifies → BELIEF_MISSING_FIELD');
      fs.rmSync(f);
    }

    // cards：fixture store+events 四类卡／排除边界／确定性／无 proposals 目录空态
    {
      fs.writeFileSync(path.join(fixture, 'reuses.md'), [
        '# date | id | project | harness | outcome | note',
        '2026-01-05 | 20260101-090000-aaaa | P | opencode | helped | x',
      ].join('\n') + '\n');
      fs.writeFileSync(path.join(expDir, '20260101-130000-g002.md'),
        ['---', 'id: 20260101-130000-g002', 'created_at: 2026-01-05', 'type: tool', 'project: P',
          'summary: no reuse hit', 'tags: x', 'status: draft', 'schema_version: 1', '---', '# T', ''].join('\n'));
      const propDir = path.join(fixture, 'proposals');
      fs.mkdirSync(propDir);
      fs.writeFileSync(path.join(propDir, 'sublime-20260105-lexer.md'), '# lexer 修复\n\nverdict: pending\n');
      fs.writeFileSync(path.join(propDir, 'sublime-20260106-done.md'), '# 已裁决\n\nverdict: approved\n');
      const evFile = path.join(fixture, 'events.md');
      fs.writeFileSync(evFile, [
        '# fixture events',
        '20200101-090000 | 20200101-090000-01 | agent-experience | #0001-debt | promoted | human | r1.md',
        '20200102-090000 | 20200102-090000-01 | agent-experience | #0002-owed | promoted | human | r2.md',
        '20200103-090000 | 20200103-090000-01 | agent-experience | #0002-owed | outcome_verified | human | o.md',
        '20200104-090000 | 20200104-090000-01 | agent-experience | #0003-cnv | promoted | agent | r3.md  # canary',
        '20200104-100000 | 20200104-100000-01 | agent-experience | #0003-cnv | evidence_note | agent | s1  # canary 使用：评测点名',
      ].join('\n') + '\n');
      const c1 = cmdCards(fixture, evFile);
      const c2 = cmdCards(fixture, evFile);
      ok(c1.rc === 0 && c1.out === c2.out, 'cards happy: 两跑逐字节一致（确定性）');
      ok(['## canary 转全量', '## draft 确认', '## 升华提案', '## 欠账', '## 信念证据晋升'].every((h) => c1.out.includes(h)),
        'cards happy: 五类卡分节标题齐');
      ok(c1.out.includes('#0003-cnv') && c1.out.includes('20260101-090000-aaaa') && c1.out.includes('sublime-20260105-lexer.md'),
        'cards happy: canary 卡／命中 draft 卡／pending 提案卡在场');
      ok(c1.out.includes('#0001-debt') && !c1.out.includes('#0002-owed'),
        'cards happy: 欠账卡在场且有 outcome 者排除');
      ok(!c1.out.includes('20260101-130000-g002') && !c1.out.includes('sublime-20260106-done.md'),
        'cards happy: 无命中 draft 与 approved 提案排除');
      fs.rmSync(propDir, { recursive: true });
      const c3 = cmdCards(fixture, evFile);
      ok(c3.rc === 0 && (c3.out.match(/（零命中——本节空）/g) ?? []).length === 2,
        'cards 无目录: proposals/ 缺失 → sublime＋belief 两节空态 rc0 不 crash（belief 节空态合法）');
      fs.rmSync(path.join(expDir, '20260101-130000-g002.md'));
    }

    // #0025 第 5 类卡：belief＋Evidence E3 → 信念证据晋升卡在场且不入 draft 确认节
    {
      fs.writeFileSync(path.join(expDir, '20260101-140000-h003.md'),
        ['---', 'id: 20260101-140000-h003', 'created_at: 2026-01-05', 'type: other', 'project: P',
          'summary: belief card fixture', 'tags: belief', 'epistemic: belief', 'status: draft', 'schema_version: 1',
          'holds: ctx', 'falsifies: obs-x', '---', '# T', '', 'Evidence: E3（跨项目复用一次）', ''].join('\n'));
      fs.appendFileSync(path.join(fixture, 'reuses.md'), '2026-01-05 | 20260101-140000-h003 | P | opencode | helped | y\n');
      const evFile = path.join(fixture, 'events.md');
      const c4 = cmdCards(fixture, evFile);
      const secOf = (out, header) => {
        const i = out.indexOf(header);
        if (i === -1) return '';
        const rest = out.slice(i + header.length);
        const j = rest.indexOf('\n## ');
        return j === -1 ? rest : rest.slice(0, j);
      };
      const draftSec = secOf(c4.out, CARDS_SECTIONS.draft);
      const beliefSec = secOf(c4.out, CARDS_SECTIONS.belief);
      ok(c4.rc === 0 && beliefSec.includes('20260101-140000-h003') && beliefSec.includes('Evidence: E3'),
        'cards belief: E3 信念 → 信念证据晋升卡在场（id＋E 事件行）');
      ok(!draftSec.includes('20260101-140000-h003') && draftSec.includes('20260101-090000-aaaa'),
        'cards belief: 信念不入 draft 确认节（非信念 draft 照旧在场）');
      fs.rmSync(path.join(expDir, '20260101-140000-h003.md'));
      fs.writeFileSync(path.join(fixture, 'reuses.md'), [
        '# date | id | project | harness | outcome | note',
        '2026-01-05 | 20260101-090000-aaaa | P | opencode | helped | x',
      ].join('\n') + '\n');
    }

    // #0026 score：e-thresholds v0 机械实现（确定性两跑逐字节一致＋stdout-only＋空态）
    {
      fs.writeFileSync(path.join(fixture, 'skill-uses.md'), [
        '# date | skill | task | trigger | sections | anchors | note',
        '2026-01-06 | agent-experience | t1 | tr | SKILL.md | experiences/20260101-090000-aaaa.md | helped：x',
        '2026-01-06 | agent-experience | t2 | tr | SKILL.md | experiences/20260101-090000-aaaa.md | helped：x',
        '2026-01-06 | agent-experience | t3 | tr | SKILL.md | experiences/20260101-090000-aaaa.md | helped：x',
        '2026-01-06 | agent-experience | t4 | tr | SKILL.md | experiences/20260101-090000-aaaa.md | considered-but-not-used：y',
        '2026-01-06 | fire-and-poll | t5 | tr | S.md | experiences/20260101-090000-aaaa.md | helped：x',
        '2026-01-06 | zsh-profile | t6 | tr | S.md | experiences/20260101-090000-aaaa.md | counter：x',
        '2026-01-06 | zsh-profile | t7 | tr | S.md | experiences/20260101-090000-aaaa.md | counter：x',
      ].join('\n') + '\n');
      const digest = () => crypto.createHash('md5')
        .update(readOk(path.join(fixture, 'skill-uses.md'))).update(readOk(path.join(fixture, 'reuses.md'))).digest('hex');
      const before = digest();
      const evFile = path.join(fixture, 'events.md');
      const s1 = cmdScore(fixture, evFile);
      const s2 = cmdScore(fixture, evFile);
      ok(s1.rc === 0 && s1.out === s2.out, 'score 两跑逐字节一致（无时钟/随机/env 维度）');
      ok(s1.out.includes('agent-experience | helped=3 | counter=0 | opportunity=4 | verdict: promote'), 'score formula: helped≥3 → promote');
      ok(s1.out.includes('zsh-profile | helped=0 | counter=2 | opportunity=2 | verdict: revert'), 'score formula: counter≥2 → revert');
      ok(s1.out.includes('fire-and-poll | helped=1 | counter=0 | opportunity=1 | verdict: no-op'), 'score formula: n<3 → no-op');
      ok(s1.out.includes(`events: ${parseEvents(readOk(evFile)).length} rows（${evFile}）`), 'score events: 行数随 events 源打印');
      ok(digest() === before, 'score stdout-only: store 零写入');
      const emptyStore = path.join(fixture, 'empty-store');
      fs.mkdirSync(emptyStore);
      const se = cmdScore(emptyStore, evFile);
      ok(se.rc === 0 && se.out.includes('零数据行'), 'score 空态: 无 skill-uses.md → rc0 空态标记');
      fs.rmSync(emptyStore, { recursive: true });
    }

    // #0026 verify-anchors：sha（git cat-file -e）＋plain path＋foreign skip＋FNV-1a 抽样确定性
    {
      spawnSync('git', ['init', '--quiet', fixture], { stdio: 'ignore' });
      fs.writeFileSync(path.join(fixture, 'target-artifact.md'), 'artifact\n');
      const sha = spawnSync('git', ['hash-object', '-w', '--', path.join(fixture, 'target-artifact.md')],
        { cwd: fixture, encoding: 'utf8' }).stdout.trim();
      const dangling = 'b'.repeat(40);
      fs.writeFileSync(path.join(fixture, 'skill-uses.md'), [
        '# date | skill | task | trigger | sections | anchors | note',
        `2026-01-06 | agent-experience | t1 | tr | S.md | experiences/20260101-090000-aaaa.md;target-artifact.md@${sha} | helped：x`,
        `2026-01-06 | agent-experience | t2 | tr | S.md | gone.md@${dangling};foreign:other#main@${'a'.repeat(40)} | helped：x`,
      ].join('\n') + '\n');
      const v1 = cmdVerifyAnchors(fixture, 1);
      ok(v1.rc === 1 && v1.out.includes(`OK target-artifact.md@${sha}`) && v1.out.includes('OK experiences/20260101-090000-aaaa.md')
        && v1.out.includes(`VIOLATION UNRESOLVABLE_SHA gone.md@${dangling}`) && v1.out.includes('SKIP unverifiable-locally foreign:')
        && v1.out.includes('4 checked, 1 violations, 1 skipped（sample=1）'),
        'verify-anchors: sha 解析 OK＋plain OK＋悬空 sha 违例＋foreign 跳过（violation 即 rc1）');
      const v2 = cmdVerifyAnchors(fixture, 0.5);
      const v3 = cmdVerifyAnchors(fixture, 0.5);
      ok(v2.out === v3.out, 'verify-anchors: 抽样两跑输出一致（FNV-1a 确定性）');
      const nonRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'ae-nonrepo-'));
      fs.writeFileSync(path.join(nonRepo, 'skill-uses.md'), [
        '# date | skill | task | trigger | sections | anchors | note',
        `2026-01-06 | agent-experience | t1 | tr | S.md | plain.md@${sha} | helped：x`,
      ].join('\n') + '\n');
      const v4 = cmdVerifyAnchors(nonRepo, 1);
      ok(v4.rc === 0 && v4.out.includes('SKIP unverifiable-locally plain.md@'), 'verify-anchors: store 非仓 → sha 锚 SKIP（不误报悬空）');
      fs.rmSync(nonRepo, { recursive: true, force: true });
      fs.rmSync(path.join(fixture, 'skill-uses.md'));
      fs.rmSync(path.join(fixture, 'target-artifact.md'));
    }

    // knowledge：跨层 query＋机械 lint（sidecar Phase 3；fixture 自带 knowledge root，不依赖 cwd）
    {
      const kroot = path.join(fixture, 'knowledge');
      fs.mkdirSync(path.join(kroot, 'modules'), { recursive: true });
      fs.writeFileSync(path.join(kroot, 'modules', 'auth.md'), '# Auth\n\nSee also: [cache](cache.md)\n');
      fs.writeFileSync(path.join(kroot, 'modules', 'cache.md'), '# Cache\n\ndma-buf 缓存条目\n');
      const idxText = [
        '# Knowledge Index', '', '## 模块列表', '',
        '| 模块 | 一句话描述 | 详细路径 |', '|------|-----------|----------|',
        '| auth | 登录态 | modules/auth.md |',
        '| cache | 缓存 | modules/cache.md |',
      ].join('\n') + '\n';
      fs.writeFileSync(path.join(kroot, 'knowledge-index.md'), idxText);
      fs.writeFileSync(path.join(kroot, 'log.md'), '# Knowledge Log\n');
      process.env.AE_KNOWLEDGE_PATH = kroot;
      ok(resolveKnowledgePath() === kroot, 'knowledge resolve: AE_KNOWLEDGE_PATH 覆盖优先');
      delete process.env.AE_KNOWLEDGE_PATH;
      let kq = cmdKnowledgeQuery(fixture, kroot, 'dma-buf');
      const parsed = JSON.parse(kq.out);
      ok(kq.rc === 0 && parsed.experiences.length === 1 && parsed.experiences[0].file.endsWith('20260101-090000-aaaa.md')
        && parsed.knowledge.length === 1 && parsed.knowledge[0].file.endsWith(path.join('modules', 'cache.md'))
        && parsed.knowledge[0].title === 'Cache' && parsed.knowledge_root === kroot,
        'knowledge query happy: 跨层双命中（experiences＋knowledge）且 knowledge_root 透明');
      kq = cmdKnowledgeQuery(fixture, null, 'dma-buf');
      const parsedNoRoot = JSON.parse(kq.out);
      ok(kq.rc === 0 && parsedNoRoot.knowledge.length === 0 && parsedNoRoot.knowledge_root === null
        && parsedNoRoot.experiences.length === 1,
        'knowledge query 无root: knowledge 层空＋knowledge_root=null（experiences 层照常）');
      kq = cmdKnowledgeQuery(fixture, kroot, 'zzz-no-such-token');
      const parsedZero = JSON.parse(kq.out);
      ok(kq.rc === 0 && parsedZero.experiences.length === 0 && parsedZero.knowledge.length === 0,
        'knowledge query zero: 双层零命中 → 空数组 rc0');
      let kl = cmdKnowledgeLint(kroot);
      ok(kl.rc === 0 && kl.out.includes('0 findings'), 'knowledge lint clean: 索引双向一致＋链接活 → rc0');
      fs.writeFileSync(path.join(kroot, 'modules', 'ghost.md'), '# Ghost\n'); // Tier 1 缺口：文件在、索引无行
      fs.writeFileSync(path.join(kroot, 'knowledge-index.md'), idxText + '| ghost-row | 无文件 | modules/ghost-row.md |\n');
      fs.writeFileSync(path.join(kroot, 'modules', 'auth.md'), '# Auth\n\nSee also: [gone](nope.md)\n');
      kl = cmdKnowledgeLint(kroot);
      ok(kl.rc === 1 && kl.out.includes('INDEX_GAP') && kl.out.includes('modules/ghost.md')
        && kl.out.includes('DEAD_INDEX_ENTRY') && kl.out.includes('ghost-row')
        && kl.out.includes('BROKEN_LINK') && kl.out.includes('nope.md') && kl.out.includes('3 findings'),
        'knowledge lint findings: 索引缺口＋死索引行＋断链 → rc1 逐项点名');
      fs.rmSync(path.join(kroot, 'modules', 'ghost.md'));
      fs.writeFileSync(path.join(kroot, 'knowledge-index.md'), idxText);
      fs.writeFileSync(path.join(kroot, 'modules', 'auth.md'), '# Auth\n\nSee also: [cache](cache.md)\n');
      fs.rmSync(path.join(kroot, 'log.md'));
      kl = cmdKnowledgeLint(kroot);
      ok(kl.rc === 1 && kl.out.includes('BOOTSTRAP_MISSING') && kl.out.includes('log.md'),
        'knowledge lint bootstrap: log.md 缺失 → BOOTSTRAP_MISSING rc1');
      // 多词中文查询：词元化 OR＋按命中词数降序（回归：整串字面匹配致多词恒空）
      fs.writeFileSync(path.join(kroot, 'modules', 'kw.md'), '# 委托\n\n广场委托协议页\n');
      fs.writeFileSync(path.join(kroot, 'modules', 'kwboth.md'), '# 缓存与委托\n\n缓存委托双词页\n');
      fs.writeFileSync(path.join(expDir, '20260101-090200-kwww.md'), [
        '---', 'id: 20260101-090200-kwww', 'created_at: 2026-01-01', 'type: tool', 'project: FixtureProj',
        'summary: 记忆检索多词修复（缓存）', 'tags: test', 'status: draft', 'schema_version: 1', '---',
        '# 记忆缓存', '', 'body', '',
      ].join('\n'));
      kq = cmdKnowledgeQuery(fixture, kroot, '缓存 委托');
      const parsedMulti = JSON.parse(kq.out);
      ok(parsedMulti.knowledge.length === 4 && parsedMulti.knowledge[0].file.endsWith('kwboth.md')
        && parsedMulti.experiences.length === 1,
        'knowledge query 多词中文: 词元 OR 双层命中且双词页排首位');
      cmdMark(fixture, '20260101-090200-kwww', 'superseded_by', '20260101-090500-bbbb');
      kq = cmdKnowledgeQuery(fixture, kroot, '缓存 委托');
      const parsedWarm = JSON.parse(kq.out);
      ok(parsedWarm.experiences.length === 0 && parsedWarm.knowledge.length === 4,
        'knowledge query 温层不变式: superseded 经单遍路径仍滤除（experiences 契约同 experienceHits）');
      kq = cmdKnowledgeQuery(fixture, kroot, '   ');
      const parsedBlank = JSON.parse(kq.out);
      ok(kq.rc === 0 && parsedBlank.experiences.length === 0 && parsedBlank.knowledge.length === 0,
        'knowledge query 纯空白: 无有效词元 → 双层空 rc0');
    }

    // supersede/promote：标记写入＋幂等＋查询滤除＋标记后 validate 仍过（warm-supersede-marking）
    r = cmdMark(fixture, '20260101-090000-aaaa', 'superseded_by', '20260101-090500-bbbb');
    ok(r.rc === 0, 'supersede: superseded_by 写入 rc0');
    ok(cmdMark(fixture, '20260101-090000-aaaa', 'superseded_by', '20260101-090500-bbbb').rc === 0, 'supersede: 幂等重标 rc0');
    ok(cmdMark(fixture, '20260101-090500-bbbb', 'promoted_to', 'docs/agents/knowledge#dma').rc === 0, 'promote: promoted_to 写入 rc0');
    ok(cmdMark(fixture, 'no-such-id', 'superseded_by', 'x').rc === 2, 'supersede: 不存在 id rc2');
    ok(!experienceHits(fixture, 'dma-buf').some((h) => h.file.endsWith('aaaa.md')), 'query: superseded 条目默认滤除');
    ok(!experienceHits(fixture, 'legacy').some((h) => h.file.endsWith('bbbb.md')), 'query: promoted 条目默认滤除');
    ok(cmdValidate(path.join(expDir, '20260101-090000-aaaa.md')).rc === 0, 'validate: 标记后仍过（新键单行平面）');
    // id
    r = cmdId();
    ok(r.rc === 0 && ID_RE.test(r.out.trim()), 'id: 输出匹配 YYYYMMDD-HHMMSS-<4hex>');
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
  console.log(`selfcheck: ${pass} passed, ${fail} failed`);
  return { rc: fail === 0 ? 0 : 1, out: '' };
}

// ---- cards：被动审呈批卡（stdout-only；只读 experiences status/reuses 第 2 列/proposals sublime-*/events；
//      确定性＝输出无当前时刻维度＋各节固定排序；events 源＝$AE_EVENTS_PATH > <repo-root>/.skill-evolution/events.md，
//      repo-root 由本文件位置向上解析——防 eval 环境静默回退 live events）----
const CARDS_SECTIONS = {
  canary: '## canary 转全量（有使用注记的 canary 候选）',
  draft: '## draft 确认（reuses.md 第 2 列命中）',
  sublime: '## 升华提案（verdict: pending）',
  debt: '## 欠账（promoted ≥14 天无 outcome）',
  belief: '## 信念证据晋升（epistemic: belief 达 Evidence E3+）',
};
const EMPTY_MARK = '  （零命中——本节空）';
const tsToMs = (ts) => {
  const m = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})$/.exec(ts ?? '');
  return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime() : NaN;
};

function resolveEventsPath() {
  if (process.env.AE_EVENTS_PATH) return process.env.AE_EVENTS_PATH;
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 32; i++) {
    const p = path.join(dir, '.skill-evolution', 'events.md');
    try { if (fs.statSync(p).isFile()) return p; } catch {}
    const up = path.dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
  return null;
}

function parseEvents(text) {
  // 七列：ts | event_id | skill | candidate | type | actor | pointer（行尾两空格注释不属于字段值）
  const rows = [];
  for (const raw of text.split('\n')) {
    if (!raw || raw.startsWith('#')) continue;
    const c = raw.split(' | ');
    if (c.length < 7) continue;
    rows.push({ ts: c[0], cand: c[3], type: c[4], actor: c[5], pointer: c.slice(6).join(' | ').replace(/\s{2}#.*$/, ''),
      canary: /  # canary$/.test(raw), canaryUse: /  # canary 使用/.test(raw) });
  }
  return rows;
}

function cmdCards(store, eventsPath) {
  if (eventsPath === null) process.stderr.write('cards: events 源未找到（AE_EVENTS_PATH 未设且向上无 .skill-evolution/events.md）\n');
  else if (readOk(eventsPath) === null) process.stderr.write(`cards: events 文件不可读：${eventsPath}\n`);
  const ev = parseEvents(readOk(eventsPath) ?? '');
  const byCand = new Map();
  for (const e of ev) {
    if (!byCand.has(e.cand)) byCand.set(e.cand, []);
    byCand.get(e.cand).push(e);
  }
  const now = Date.now();
  const canaryCards = [];
  const debtCards = [];
  for (const [cand, es] of byCand) {
    const promos = es.filter((e) => e.type === 'promoted');
    if (!promos.length) continue;
    const last = promos[promos.length - 1]; // append-only 文件：末条即最新
    if (last.actor === 'agent' && last.canary) {
      const notes = es.filter((e) => e.type === 'evidence_note' && e.canaryUse).length;
      if (notes >= 1) canaryCards.push({ id: cand, lines: [
        `- ${cand} | ${last.pointer}`,
        `  证据: events promoted（actor=agent  # canary）＋ canary 使用注记 ×${notes}`,
        '  建议: 人工核对注记后按 REVIEW-TEMPLATE「人工转全量」摘前缀',
      ] });
    }
    const outcomeAfter = es.some((e) => (e.type === 'outcome_verified' || e.type === 'outcome_failed') && e.ts > last.ts);
    const age = now - tsToMs(last.ts);
    if (!outcomeAfter && age >= 14 * 86400e3) debtCards.push({ ts: last.ts, lines: [
      `- ${cand} | promoted ${last.ts} 无 outcome_verified/outcome_failed`,
      `  证据: events promoted 行（actor=${last.actor}）`,
      '  建议: 补 outcome_verified/outcome_failed 事件或说明理由',
    ] });
  }
  canaryCards.sort((a, b) => a.id.localeCompare(b.id));
  debtCards.sort((a, b) => a.ts.localeCompare(b.ts)); // 旧者优先；至多 5 张（防卡牌洪水）
  const debtTop = debtCards.slice(0, 5);

  // draft 确认卡：呈批条件＝其 id 在 reuses.md 第 2 列出现（畸形行不参与，勘误走追加不改写）
  const reuseIds = new Map();
  for (const l of (readOk(path.join(store, 'reuses.md')) ?? '').split('\n')) {
    if (!l || l.startsWith('#')) continue;
    const col = l.split('|')[1];
    if (col === undefined) continue;
    const id = col.trim();
    if (id) reuseIds.set(id, (reuseIds.get(id) ?? 0) + 1);
  }
  const draftCards = [];
  for (const file of listExperiences(store)) {
    const { fm } = parseFile(readOk(file) ?? '');
    if (fm.get('status') !== 'draft') continue;
    if (fm.get('epistemic') === 'belief') continue; // #0025：信念不入 draft 确认卡（走信念证据晋升卡轨道）
    const id = fm.get('id');
    const n = reuseIds.get(id ?? '');
    if (!n) continue;
    draftCards.push({ id, lines: [
      `- ${id} | ${fm.get('summary') ?? ''}`,
      `  证据: reuses.md 第 2 列命中 ×${n}`,
      '  建议: 人工复核复用记录后 draft→confirmed',
    ] });
  }
  draftCards.sort((a, b) => a.id.localeCompare(b.id));

  // 升华提案卡：proposals/sublime-<YYYYMMDD>-<slug>.md 且 verdict: pending（每案一卡；目录缺失=空态不 crash）
  const propDir = path.join(store, 'proposals');
  let names = [];
  try { names = fs.readdirSync(propDir).filter((f) => /^sublime-.+\.md$/.test(f)).sort(); } catch {}
  const sublimeCards = names.flatMap((f) => {
    const text = readOk(path.join(propDir, f)) ?? '';
    if (!/^verdict: pending\s*$/m.test(text)) return [];
    const h1 = (text.split('\n').find((l) => /^# .+/.test(l)) ?? '').slice(2);
    return [{ lines: [
      `- proposals/${f} | ${h1 || '升华提案'}`,
      `  证据: proposals/${f}（verdict: pending）`,
      '  建议: 人工裁决 verdict（approved / rejected）',
    ] }];
  });


  // 信念证据晋升卡（#0025 第 5 类）：epistemic: belief 且 status: draft 且 body Evidence 行达 E3/E4（E3=跨项目复用一次，GROOMING Wave 2 E 分级；已转正信念不再重复出卡）
  const beliefCards = [];
  for (const file of listExperiences(store)) {
    const text = readOk(file) ?? '';
    const { fm } = parseFile(text);
    if (fm.get('epistemic') !== 'belief') continue;
    if (fm.get('status') !== 'draft') continue; // 已人工转正（draft→confirmed）的信念不再重复出晋升卡
    const evLine = text.split('\n').find((l) => /^Evidence: E[34]/.test(l));
    if (!evLine) continue;
    beliefCards.push({ id: fm.get('id') ?? '', lines: [
      `- ${fm.get('id') ?? ''} | ${fm.get('summary') ?? ''}`,
      `  证据: ${evLine.trim()}（E3+＝跨项目复用达成）`,
      '  建议: 人工核对复用证据后转正（draft→confirmed，信念生命周期）',
    ] });
  }
  beliefCards.sort((a, b) => a.id.localeCompare(b.id));
  const sec = (cards) => (cards.length ? cards.flatMap((c) => c.lines) : [EMPTY_MARK]);
  return { rc: 0, out: [
    '# CARDS — 被动审呈批卡',
    '> 只读源：experiences/*.md status＋reuses.md 第 2 列＋proposals/sublime-*＋events（AE_EVENTS_PATH > <repo-root>/.skill-evolution/events.md）；输出确定性，调用方重定向落盘',
    CARDS_SECTIONS.canary, ...sec(canaryCards), '', CARDS_SECTIONS.draft, ...sec(draftCards), '', CARDS_SECTIONS.sublime, ...sec(sublimeCards), '', CARDS_SECTIONS.debt, ...sec(debtTop), '', CARDS_SECTIONS.belief, ...sec(beliefCards),
  ].join('\n') + '\n' };
}

// ---- score：e-thresholds v0 确定性评分（#0026；stdout-only 只读——skill-uses 逐技能证据计数（note 前缀
//      helped/counter/considered-but-not-used）＋reuses 全域 context＋events 行数；无时钟/随机/env 维度，两跑逐字节一致）----
function parseSkillUses(store) {
  // 七列：date | skill | task | trigger | sections | anchors | note（畸形行不参与）
  const rows = [];
  for (const l of (readOk(path.join(store, 'skill-uses.md')) ?? '').split('\n')) {
    if (!l || l.startsWith('#')) continue;
    const c = l.split('|');
    if (c.length < 7 || !c[1].trim()) continue;
    rows.push({ skill: c[1].trim(), anchors: c[5].trim(), note: c.slice(6).join('|').trim() });
  }
  return rows;
}

function cmdScore(store, eventsPath) {
  const rows = parseSkillUses(store);
  const bySkill = new Map();
  for (const r of rows) {
    if (!bySkill.has(r.skill)) bySkill.set(r.skill, { helped: 0, counter: 0, opportunity: 0 });
    const s = bySkill.get(r.skill);
    s.opportunity++; // 机会分母 v0＝该技能 skill-uses 全部数据行（used＋considered 双录）
    if (/^helped/.test(r.note)) s.helped++;
    else if (/^counter/.test(r.note)) s.counter++;
  }
  const lines = ['# ae score — e-thresholds v0（counter≥2 回滚＞helped≥3 转正＞n=helped+counter<3 不动；机会分母＝该技能 skill-uses 全部数据行）'];
  if (!rows.length) lines.push('（零数据行——skill-uses.md 缺失或无有效行）');
  for (const [skill, s] of [...bySkill].sort((a, b) => a[0].localeCompare(b[0]))) {
    const verdict = s.counter >= 2 ? 'revert' : (s.helped >= 3 ? 'promote' : 'no-op');
    lines.push(`${skill} | helped=${s.helped} | counter=${s.counter} | opportunity=${s.opportunity} | verdict: ${verdict}`);
  }
  const rc = { helped: 0, 'not-helped': 0, counter: 0 };
  for (const l of (readOk(path.join(store, 'reuses.md')) ?? '').split('\n')) {
    if (!l || l.startsWith('#')) continue;
    const o = (l.split('|')[4] ?? '').trim();
    if (o in rc) rc[o]++;
  }
  lines.push(`reuses: helped=${rc.helped} not-helped=${rc['not-helped']} counter=${rc.counter}（store 全域 context，不计入上式）`);
  const evOk = eventsPath !== null && readOk(eventsPath) !== null ? eventsPath : null;
  lines.push(`events: ${evOk ? parseEvents(readOk(evOk)).length : 0} rows（${evOk ?? 'events 源未找到'}）`);
  return { rc: 0, out: lines.join('\n') + '\n' };
}

// ---- verify-anchors：skill-uses anchors 抽查（#0026；dotfiles-sha 走 git cat-file -e，foreign-repo sha 标
//      unverifiable-locally，plain path 存在即可解析；FNV-1a 确定性抽样；violation 即 rc1；stdout-only 只读）----
const fnv1a = (s) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
};

function cmdVerifyAnchors(store, rate) {
  const anchors = [];
  for (const r of parseSkillUses(store)) {
    for (let a of r.anchors.split(';')) { a = a.trim(); if (a) anchors.push(a); }
  }
  const lines = [];
  let checked = 0, violations = 0, skipped = 0;
  let inRepo = false;
  try { inRepo = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: store, stdio: ['ignore', 'ignore', 'ignore'] }).status === 0; } catch {}
  // store 非仓或 git 不可用 ⇒ sha 锚无从验证（SKIP unverifiable-locally），不得误报悬空
  for (const a of anchors) {
    if (rate < 1 && (fnv1a(a) % 10000) >= Math.round(rate * 10000)) continue; // FNV-1a 确定性抽样（两跑一致）
    checked++;
    if (a.startsWith('foreign:')) {
      skipped++;
      lines.push(`SKIP unverifiable-locally ${a}`);
      continue;
    }
    const m = /^(.*)@([0-9a-f]{40})$/.exec(a);
    if (m) {
      if (!inRepo) { skipped++; lines.push(`SKIP unverifiable-locally ${a}（store 非仓或 git 不可用）`); continue; }
      let r = null;
      try { r = spawnSync('git', ['cat-file', '-e', m[2]], { cwd: store, stdio: ['ignore', 'ignore', 'ignore'] }); } catch {}
      if (!r || r.error || r.status === null) { skipped++; lines.push(`SKIP unverifiable-locally ${a}（git 不可用或异常中断）`); }
      else if (r.status === 0) lines.push(`OK ${a}`);
      else { violations++; lines.push(`VIOLATION UNRESOLVABLE_SHA ${a}（悬空 sha）`); }
    } else {
      const p = path.isAbsolute(a) ? a : path.join(store, a);
      if (fs.existsSync(p)) lines.push(`OK ${a}`);
      else { violations++; lines.push(`VIOLATION UNRESOLVABLE_PATH ${a}（文件不存在）`); }
    }
  }
  lines.push(`verify-anchors: ${checked} checked, ${violations} violations, ${skipped} skipped（sample=${rate}）`);
  return { rc: violations ? 1 : 0, out: lines.join('\n') + '\n' };
}

// ---- knowledge：unified-memory 跨层只读面（sidecar Phase 3）——experiences 层复用 dedup 命中语义，
//      knowledge 层＝docs/agents/knowledge 的 modules/**/*.md＋knowledge-index.md；root 解析＝
//      $AE_KNOWLEDGE_PATH > 自 cwd 向上找 docs/agents/knowledge（project-compound 的 ./docs 相对语义）。
//      lint 只做机械可判定面（Tier 1 索引双向一致＋bootstrap 在场＋Tier 2 断链），只读报告；
//      Tier 1 auto-fix 与 Tier 2/3 语义判断（矛盾/过期/orphan）归 project-compound Lint 过程 ----
function resolveKnowledgePath() {
  if (process.env.AE_KNOWLEDGE_PATH) return process.env.AE_KNOWLEDGE_PATH;
  let dir = process.cwd();
  for (let i = 0; i < 32; i++) {
    const p = path.join(dir, 'docs', 'agents', 'knowledge');
    try { if (fs.statSync(p).isDirectory()) return p; } catch {}
    const up = path.dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
  return null;
}

const listMdRecursive = (dir) => {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)); } catch { return []; }
  const out = [];
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    if (e.isDirectory()) out.push(...listMdRecursive(path.join(dir, e.name)));
    else if (e.name.endsWith('.md')) out.push(path.join(dir, e.name));
  }
  return out;
};

const listKnowledgePages = (kroot) => [path.join(kroot, 'knowledge-index.md'), ...listMdRecursive(path.join(kroot, 'modules'))];

function cmdKnowledgeQuery(store, kroot, word) {
  // 多词（中文空格分隔）按词元 OR 命中、按命中词数降序——整串字面匹配对多词查询恒空（gt-d039）；
  // dedup 路径（storeMdHits 单 needle 字面语义）不动，查重保守超集契约保持。
  const terms = [...new Set(word.toLowerCase().split(/\s+/).filter(Boolean))];
  const knowledge = [];
  for (const file of (kroot === null ? [] : listKnowledgePages(kroot))) {
    const text = readOk(file);
    if (text === null) continue;
    const lower = text.toLowerCase();
    const score = terms.reduce((n, t) => n + (lower.includes(t) ? 1 : 0), 0);
    if (!score) continue;
    const h1 = text.split('\n').find((l) => /^# .+/.test(l));
    knowledge.push({ file, title: h1 ? h1.slice(2) : null, score });
  }
  knowledge.sort((a, b) => b.score - a.score);   // 稳定排序：同分保持原路径序
  for (const k of knowledge) delete k.score;
  // experiences 层单遍扫描：每文件解析一次、内存内计全部词元（R1-B：逐词元全库重扫 2000 词元实测 16.7s）；
  // 温层滤除与 hit 形状＝experienceHits/storeMdHits 同契约（selfcheck 有 supersede 不变式断言防漂移）
  const merged = new Map();
  for (const file of listExperiences(store)) {
    const text = readOk(file);
    if (text === null) continue;
    const { fm, title } = parseFile(text);
    if (fm.has('superseded_by') || fm.has('promoted_to')) continue;
    const lower = text.toLowerCase();
    const score = terms.reduce((n, t) => n + (lower.includes(t) ? 1 : 0), 0);
    if (!score) continue;
    merged.set(file, {
      hit: { file, title, type: fm.get('type') ?? null, tags: (fm.get('tags') ?? '').split(',').map((t) => t.trim()).filter(Boolean) },
      score,
    });
  }
  const experiences = [...merged.values()].sort((a, b) => b.score - a.score).map((e) => e.hit);   // 单遍文件名序＋稳定排序 ⇒ 跨词元同分＝文件名序（同 knowledge 层路径序）
  return { rc: 0, out: JSON.stringify({ experiences, knowledge, knowledge_root: kroot }) + '\n' };
}

// 索引表数据行第一列＝模块名（live 3 列与模板 4 列格式同构；表头/分隔行过滤）
const parseIndexNames = (text) => {
  const names = [];
  for (const l of (text ?? '').split('\n')) {
    if (!l.startsWith('|')) continue;
    const name = l.split('|')[1]?.trim().replace(/`/g, '') ?? '';
    if (!name || name === '模块' || name === 'Module' || /^-+$/.test(name)) continue;
    names.push(name);
  }
  return names;
};

// Tier 2 断链：模块页内相对 md 链接（围栏代码块跳过；http/mailto/#锚/绝对路径跳过；同目录/kroot/repo 根三候选解析）
const MD_LINK_RE = /\[[^\]]*\]\(([^)\s]+)(?:#[^)\s]*)?\)/g;
function scanBrokenLinks(kroot, pages) {
  let repoRoot = path.resolve(kroot, '..', '..', '..');   // 兜底：规范 <repo>/docs/agents/knowledge 布局
  for (let d = kroot; d !== path.dirname(d); d = path.dirname(d)) {
    if (fs.existsSync(path.join(d, '.git'))) { repoRoot = d; break; }   // kroot 非标准布局（env 重定向等）时按 git 根定位
  }
  const findings = [];
  for (const file of pages) {
    let fenced = false;
    for (const l of (readOk(file) ?? '').split('\n')) {
      if (/^\s*```/.test(l)) { fenced = !fenced; continue; }
      if (fenced) continue;
      for (const m of l.matchAll(MD_LINK_RE)) {
        const t = m[1];
        if (/^(https?:|mailto:|#|\/)/.test(t)) continue;
        const okPath = [path.resolve(path.dirname(file), t), path.resolve(kroot, t), path.resolve(repoRoot, t)]
          .some((p) => fs.existsSync(p));
        if (!okPath) findings.push(`BROKEN_LINK ${path.relative(kroot, file)} → ${t}（Tier 2：修复或移除链接）`);
      }
    }
  }
  return findings;
}

function cmdKnowledgeLint(kroot) {
  const findings = [];
  const indexText = readOk(path.join(kroot, 'knowledge-index.md'));
  if (indexText === null) findings.push('BOOTSTRAP_MISSING knowledge-index.md（Layer 1 目录缺失——见 project-compound SKILL.md Bootstrap）');
  if (readOk(path.join(kroot, 'log.md')) === null) findings.push('BOOTSTRAP_MISSING log.md（append-only 日志缺失——Bootstrap 种子 `# Knowledge Log`）');
  const pages = listMdRecursive(path.join(kroot, 'modules'));
  if (indexText !== null) {
    const names = parseIndexNames(indexText);
    const stems = pages.map((p) => path.basename(p).replace(/\.md$/, ''));
    for (const s of stems) if (!names.includes(s)) findings.push(`INDEX_GAP modules/${s}.md 未列入 knowledge-index（Tier 1：补行 (no summary) 占位）`);
    for (const n of names) if (!stems.includes(n)) findings.push(`DEAD_INDEX_ENTRY 索引行 ${n} 无对应 modules/${n}.md（Tier 1：Description 前缀 [MISSING]，永不删行）`);
  }
  findings.push(...scanBrokenLinks(kroot, pages));
  const out = [...findings, `knowledge lint: ${findings.length} findings（机械面：Tier 1 索引双向＋bootstrap＋Tier 2 断链，只读；auto-fix 与语义判断层归 project-compound Lint 过程）`].join('\n') + '\n';
  return { rc: findings.length ? 1 : 0, out };
}

// ---- dispatch ----
function usage() {
  return [
    'usage: ae.mjs [--store <dir>] <command> [args]',
    '  id                       生成 YYYYMMDD-HHMMSS-<4hex>',
    '  capture                  无参铸 ID（同 id）',
    '  capture --from <draft.md>  草稿落盘：id 缺省铸+回填→validate 过闸→写 experiences/<id>.md→INDEX 追加行',
    '  dedup "<词>"             全文大小写不敏感查重（保守超集），输出 {hits:[...]}，只报命中不裁决',
    '  dedup "<词>" --scope=verifier  盲视作用域：仅命中 <store>/practice/ 前缀（轮次台账等执行证据），经验正文/知识层/派生聚合一律不可见',
    '  supersede <id> --by <新经验id>  温层退役标记：superseded_by（查询默认滤除，不删除）',
    '  promote <id> --to <语义页引用>  升华闭环标记：promoted_to（查询默认滤除，不删除）',
    '  validate <file>          frontmatter 契约检查，逐发现输出 {code,subject,evidence,supportedFixes}（干净 rc0）',
    '  index --check            重生成 INDEX.md 与盘上 diff（一致 rc0／漂移 rc1 并打印漂移行）',
    '  cards                    被动审呈批卡（stdout-only 只读；events = AE_EVENTS_PATH > <repo-root>/.skill-evolution/events.md）',
    '  score                    e-thresholds v0 确定性评分（stdout-only 只读；per-skill helped/counter/机会分母＋reuses 全域＋events 行数；两跑逐字节一致）',
    '  verify-anchors [--sample <0..1>]  skill-uses anchors 抽查（dotfiles-sha＝git cat-file -e；foreign 标 unverifiable-locally；violation 即 rc1）',
    '  knowledge query "<词>"   跨层检索：experiences（store）＋docs/agents/knowledge（modules/*.md＋knowledge-index.md），输出 {experiences,knowledge,knowledge_root}',
    '  knowledge lint           知识库机械检查（Tier 1 索引双向一致＋bootstrap＋Tier 2 断链；root＝AE_KNOWLEDGE_PATH > 自 cwd 向上 docs/agents/knowledge）',
    '  selfcheck                临时夹具 store 自检（含 legacy 无 summary 行）',
    `  默认 store: ${DEFAULT_STORE}（--store 覆盖；评测一律显式传 --store）`,
    '',
  ].join('\n');
}

function main(argv) {
  const args = [...argv];
  let store = DEFAULT_STORE;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--store') { store = args[i + 1]; args.splice(i, 2); i--; }
    else if (args[i]?.startsWith('--store=')) { store = args[i].slice(8); args.splice(i, 1); i--; }
  }
  const [cmd, ...rest] = args;
  switch (cmd) {
    case 'id': return cmdId();
    case 'capture': {
      if (rest.length === 0) return cmdId();
      if (rest[0] === '--from' && rest[1] && !rest[1].startsWith('--')) return cmdCapture(store, rest[1]);
      return { rc: 2, out: 'capture: 用法 capture（无参铸 ID）| capture --from <draft.md>\n' + usage() };
    }
    case 'dedup': {
      if (rest.some((a) => a?.startsWith('--') && a !== '--scope=verifier')) return { rc: 2, out: 'dedup: 仅支持 --scope=verifier\n' + usage() };   // [ocr-5] 未知 --token 拒绝 rc2（不再误作关键词）
      const word = rest.find((a) => !a?.startsWith('--'));
      return cmdDedup(store, word, rest.includes('--scope=verifier') ? 'verifier' : undefined);
    }
    case 'supersede': {
      const by = rest.includes('--by') ? rest[rest.indexOf('--by') + 1] : null;
      if (!rest[0] || rest[0].startsWith('--') || !by) return { rc: 2, out: 'supersede: 用法 supersede <id> --by <新经验id>\n' + usage() };
      return cmdMark(store, rest[0], 'superseded_by', by);
    }
    case 'promote': {
      const to = rest.includes('--to') ? rest[rest.indexOf('--to') + 1] : null;
      if (!rest[0] || rest[0].startsWith('--') || !to) return { rc: 2, out: 'promote: 用法 promote <id> --to <语义页引用>\n' + usage() };
      return cmdMark(store, rest[0], 'promoted_to', to);
    }
    case 'validate':
      if (!rest[0]) return { rc: 2, out: 'validate: 缺文件参数\n' + usage() };
      return cmdValidate(rest[0]);
    case 'index':
      if (rest[0] !== '--check') return { rc: 2, out: 'index: 仅支持 index --check\n' + usage() };
      return cmdIndexCheck(store);
    case 'cards': return cmdCards(store, resolveEventsPath());
    case 'score': return cmdScore(store, resolveEventsPath());
    case 'verify-anchors': {
      let rate = 1;
      const i = rest.indexOf('--sample');
      if (i !== -1) {
        const v = Number(rest[i + 1]);
        if (!Number.isFinite(v) || v < 0 || v > 1) return { rc: 2, out: 'verify-anchors: --sample 须为 0..1 的小数\n' + usage() };
        rate = v;
      }
      return cmdVerifyAnchors(store, rate);
    }
    case 'selfcheck': return cmdSelfcheck();
    case 'knowledge': {
      const [ksub, ...kargs] = rest;
      if (ksub === 'query') {
        if (!kargs[0]) return { rc: 2, out: 'knowledge query: 缺关键词参数\n' + usage() };
        return cmdKnowledgeQuery(store, resolveKnowledgePath(), kargs[0]);
      }
      if (ksub === 'lint') {
        const kroot = resolveKnowledgePath();
        if (kroot === null) return { rc: 1, out: 'knowledge lint: 未找到 docs/agents/knowledge（自 cwd 向上解析；AE_KNOWLEDGE_PATH 可覆盖）\n' };
        return cmdKnowledgeLint(kroot);
      }
      return { rc: 2, out: usage() };
    }
    default: return { rc: 2, out: usage() };
  }
}

const r = main(process.argv.slice(2));
if (r.out) process.stdout.write(r.out);
process.exitCode = r.rc;
