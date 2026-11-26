"""dream（做梦）接口：groom 定时调用的记忆自动整理统一面（全机械 LWW，零 LLM）。

哲学：加深重要（反复记忆/touch）、遗忘不重要（TTL 主引擎＋近重 LWW 加速器）；
正确性交给反复记忆——复活重裁自修复（被取代条目再被 touch → 次夜翻回）。
设计：docs/superpowers/specs/2026-11-26-memory-groom-supersede-design.md
"""
from __future__ import annotations

import json
import time
from datetime import datetime
from pathlib import Path

from ._compat import np
from .paths import resolve_data_dir

# dream 日志 JSONL schema：每行 {date, a_uid, b_uid, loser, winner, outcome}，
# outcome ∈ {"M","H-tie"}；职责＝平局去重＋事后审计/回滚依据（Task 4 落笔）。


def _today() -> str:
    return datetime.now().strftime("%Y-%m-%d")


def dream_state_path() -> Path:
    """自然日限速记账文件（<data_dir>/dream-state.json）。"""
    return resolve_data_dir() / "dream-state.json"


def dream_log_dir() -> Path:
    return resolve_data_dir() / "logs"


def day_state(path: Path) -> dict:
    """{"date","pairs","last_apply_ts"}：自然日计数＋复活锚（apply 运行时刻，跨日持久）。"""
    fresh = {"date": _today(), "pairs": 0, "last_apply_ts": 0.0}
    try:
        data = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return fresh
    if not isinstance(data, dict):
        return fresh
    try:
        pairs = max(0, int(data.get("pairs", 0) or 0))
    except (TypeError, ValueError):
        pairs = 0
    try:
        anchor = float(data.get("last_apply_ts") or 0)
    except (TypeError, ValueError):
        anchor = 0.0
    same_day = data.get("date") == _today()
    return {"date": _today(), "pairs": pairs if same_day else 0,
            "last_apply_ts": anchor}


def spend(path: Path, n: int) -> bool:
    """记账 n 对（同日累计；report-only 同计费）。返回是否落盘成功。"""
    st = day_state(path)
    st["pairs"] += n
    try:
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        Path(path).write_text(json.dumps(st, ensure_ascii=False), encoding="utf-8")
    except OSError:
        return False
    return True


def _mark_last_apply(path: Path) -> None:
    """apply 运行落复活锚（date/pairs 原样保留）。失败非致命：次夜复活面偏宽，幂等收敛。"""
    st = day_state(path)
    st["last_apply_ts"] = time.time()
    try:
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        Path(path).write_text(json.dumps(st, ensure_ascii=False), encoding="utf-8")
    except OSError:
        pass


def _reported_pairs() -> set[frozenset[str]]:
    """既有 dream 日志已报的平局对（无序 uid 对）——H-tie 不重复报的依据。

    只收 outcome=="H-tie" 行（设计：日志职责＝平局去重＋事后审计）；M 对不进
    去重面——report-only 夜报过的取代对不能挡住后续 apply 夜真正落指针。
    """
    reported: set[frozenset[str]] = set()
    log_dir = dream_log_dir()
    if not log_dir.is_dir():
        return reported
    for path in sorted(log_dir.glob("dream-*.jsonl")):
        try:
            lines = path.read_text(encoding="utf-8").splitlines()
        except OSError:
            continue
        for line in lines:
            try:
                rec = json.loads(line)
            except ValueError:
                continue
            a, b = rec.get("a_uid"), rec.get("b_uid")
            if a and b and rec.get("outcome") == "H-tie":
                reported.add(frozenset((a, b)))
    return reported


def _last_run_ts() -> float | None:
    """最近一次 dream 日志的 mtime（前夜锚；无日志 → None）。"""
    logs = sorted(dream_log_dir().glob("dream-*.jsonl"))
    if not logs:
        return None
    try:
        return logs[-1].stat().st_mtime
    except OSError:
        return None


def _revival_anchor() -> float | None:
    """复活锚＝最近一次 apply 运行时刻（state 持久）＞最老日志 mtime（无 apply 史
    的兜底）。日间 report-only 只追加当日日志与预算，不写 last_apply_ts、不动
    昨日日志 mtime——白天 touch 的复活对必须留给当夜 apply 收敛（评审 I-2：
    用最新日志 mtime 当锚会被日间报告推过 touch 时刻，确定性丢失翻回窗口）。
    """
    st = day_state(dream_state_path())
    if st.get("last_apply_ts"):
        return float(st["last_apply_ts"])
    logs = sorted(dream_log_dir().glob("dream-*.jsonl"))
    if not logs:
        return None
    try:
        return logs[0].stat().st_mtime  # 最老日志＝dream 开始观察的时刻
    except OSError:
        return None


def _entries_meta(store, uids: list[str]) -> dict[str, dict]:
    """uid → {kind, content, superseded_by}（notify 面摘要/解释类/翻回判定）。"""
    if not uids:
        return {}
    marks = ",".join("?" * len(uids))
    rows = store.conn.execute(
        f"SELECT uid, kind, content, superseded_by FROM memories WHERE uid IN ({marks})",
        uids,
    ).fetchall()
    return {r["uid"]: dict(r) for r in rows}


def _brief(content: str, cap: int = 80) -> str:
    flat = " ".join(content.split())
    return flat if len(flat) <= cap else flat[: cap - 1] + "…"


def _uid_meta(store, uids: list[str]) -> dict[str, tuple[float, str | None]]:
    """uid → (updated_at, project)，含被取代行（复活池需要；all_vectors 不可达）。"""
    if not uids:
        return {}
    marks = ",".join("?" * len(uids))
    rows = store.conn.execute(
        f"SELECT uid, updated_at, project FROM memories WHERE uid IN ({marks})", uids
    ).fetchall()
    return {r["uid"]: (float(r["updated_at"]), r["project"]) for r in rows}


def _bucket_pairs(uids: list[str], vecs: list, domain,
                  pair_sim: float, meta: dict) -> list[dict]:
    """桶内暴力余弦：cos≥pair_sim 成对；a 恒为 updated_at 旧侧（相等入对留 route 判平局）。

    同维才可比：向量按维数分组配对（余弦仅同维有定义）——换嵌入模型遗留的
    异维行只失去本夜配对资格，不炸整批（局部降级，终闸 B-2）。
    """
    out: list[dict] = []
    by_dim: dict[int, list[int]] = {}
    for i, v in enumerate(vecs):
        by_dim.setdefault(int(np.shape(v)[0]), []).append(i)
    for members in (by_dim[d] for d in sorted(by_dim)):
        if len(members) < 2:
            continue
        mat = np.stack([vecs[i] for i in members]).astype(np.float32)
        norms = np.linalg.norm(mat, axis=1)
        normed = mat / np.maximum(norms, 1e-12)[:, None]
        sim = normed @ normed.T
        n = len(members)
        for i, j in zip(*np.triu_indices(n, k=1)):
            if float(sim[i, j]) < pair_sim:
                continue
            u_i, u_j = uids[members[i]], uids[members[j]]
            ts_i, ts_j = meta[u_i][0], meta[u_j][0]
            if ts_i <= ts_j:
                a_uid, a_ts, b_uid, b_ts = u_i, ts_i, u_j, ts_j
            else:
                a_uid, a_ts, b_uid, b_ts = u_j, ts_j, u_i, ts_i
            out.append({"a_uid": a_uid, "a_ts": a_ts, "b_uid": b_uid,
                        "b_ts": b_ts, "domain": domain})
    return out


def route(pairs: list[dict], cfg) -> list[dict]:
    """纯 LWW 定向＋平局留人：a_ts<b_ts→M（旧让位新）；a_ts==b_ts→H-tie 零执行。

    零 LLM：无模型注入面、无置信分、无 relation——方向只由时间定。
    """
    actions: list[dict] = []
    for p in pairs:
        if p["a_ts"] == p["b_ts"]:
            actions.append({"pair": p, "tier": "H-tie", "loser": None, "winner": None})
        else:
            actions.append({"pair": p, "tier": "M", "loser": p["a_uid"], "winner": p["b_uid"]})
    return actions


def collect_pairs(store, cfg, last_run_ts: float | None) -> dict:
    """同域近重配对：global 桶＋各活跃 project 桶，复活候选并入其域。

    返回 {"pairs": [Pair...], "truncated": bool}（截断标记供报告面全列）。
    前夜日志已报且两侧 updated_at<=last_run_ts 的对跳过（H-tie 不重复报）；
    max_per_night 自然日限速截断（跨 invocation 记账，report-only 同计费）。
    """
    if np is None:
        return {"pairs": [], "truncated": False}
    reported = _reported_pairs() if last_run_ts is not None else set()

    # 桶＝global＋各活跃 project；复活候选（被取代但最近被再确认）并入同域
    buckets: dict[str | None, list[str]] = {}
    vecs_of: dict[str, "np.ndarray"] = {}
    for project in [None, *store.active_projects()]:
        uids, mat = store.all_vectors(project, "global" if project is None else "all")
        if not uids or mat is None or mat.size == 0:
            continue
        buckets.setdefault(project, []).extend(uids)
        for uid, row in zip(uids, mat):
            vecs_of[uid] = row
    revival: list[str] = []
    if last_run_ts is not None:
        revival = [r["uid"] for r in store.revival_candidates(last_run_ts)]
    if revival:
        for uid, vec in store.vectors_of(revival).items():
            if vec is not None:
                vecs_of[uid] = vec

    all_uids = [u for uids in buckets.values() for u in uids] + [
        u for u in revival if u in vecs_of]
    meta = _uid_meta(store, all_uids)
    if revival:
        for uid in revival:
            if uid in vecs_of:
                buckets.setdefault(meta[uid][1], []).append(uid)

    candidates: list[dict] = []
    for domain, uids in buckets.items():
        uids = sorted(set(uids))
        have = [u for u in uids if u in vecs_of]
        if len(have) < 2:
            continue
        candidates.extend(_bucket_pairs(have, [vecs_of[u] for u in have],
                                        domain, float(cfg.pair_sim), meta))

    # 平局去重：前夜日志已报的 H-tie 对且两侧至今未再被确认 → 跳过（M 对不进
    # 去重面——report-only 报过的取代对不挡后续 apply）
    if last_run_ts is not None and reported:
        candidates = [
            p for p in candidates
            if not (frozenset((p["a_uid"], p["b_uid"])) in reported
                    and p["a_ts"] <= last_run_ts and p["b_ts"] <= last_run_ts)
        ]

    # 遗忘限速：自然日跨 invocation 记账截断
    state = day_state(dream_state_path())
    allowed = max(0, int(cfg.max_per_night) - state["pairs"])
    pairs = candidates[:allowed]
    truncated = len(candidates) > allowed
    if pairs:
        spend(dream_state_path(), len(pairs))
    return {"pairs": pairs, "truncated": truncated}


# ---------------- 读取面 C：/recall 注入前近重折叠（零存储写） ----------------

def fold_near_hits(store, hits: list[dict], fold_sim: float) -> tuple[list[dict], int]:
    """同域（project 相等，None==None）cos≥fold_sim 簇折叠为排序键最大的一条。

    排序键 max(updated_at)（平局比 created_at 再比 uid）；无向量条目原样
    保留；返回 (按原顺序的存活列表, 折叠掉的数量)——直写新重述 ≤1 天共存
    时遮显示面（止血片，不改库）。
    """
    if np is None or not hits:
        return hits, 0
    vecs = store.vectors_of([h["uid"] for h in hits])
    groups: dict = {}
    for idx, h in enumerate(hits):
        groups.setdefault(h.get("project"), []).append(idx)
    drop: set[int] = set()
    for idxs in groups.values():
        have = [i for i in idxs if vecs.get(hits[i]["uid"]) is not None]
        if len(have) < 2:
            continue
        mat = np.stack([vecs[hits[i]["uid"]] for i in have])
        normed = mat / np.maximum(np.linalg.norm(mat, axis=1), 1e-12)[:, None]
        sims = normed @ normed.T
        n = len(have)
        parent = list(range(n))  # 并查集：≥fold_sim 的对同簇

        def find(x: int) -> int:
            while parent[x] != x:
                parent[x] = parent[parent[x]]
                x = parent[x]
            return x

        for a in range(n):
            for b in range(a + 1, n):
                if float(sims[a, b]) >= fold_sim:
                    parent[find(a)] = find(b)
        clusters: dict[int, list[int]] = {}
        for i in range(n):
            clusters.setdefault(find(i), []).append(i)
        for members in clusters.values():
            if len(members) < 2:
                continue

            def _key(i: int) -> tuple:
                h = hits[have[i]]
                return (h.get("updated_at") or 0.0, h.get("created_at") or 0.0, h["uid"])

            keep = max(members, key=_key)
            drop.update(have[i] for i in members if i != keep)
    if not drop:
        return hits, 0
    return [h for i, h in enumerate(hits) if i not in drop], len(drop)


# ---------------- 编排（相位序 supersede→distill→purge→noise；写提交后才进下一相位） ----------------

_STEP_NAMES = {"supersede": "归并", "distill": "蒸馏", "purge": "清账", "noise": "清扫"}


def run_dream(store, cfg, distiller, embedder, apply: bool = False) -> dict:
    """四相位编排。report-only：supersede 全管线 dry-run（写零落）、distill/purge
    skipped、noise dry_run。异常局部降级：相位出错→errors 计数、跳过该批不抛穿。
    每相位写提交后才进下一相位（all_vectors 写后读缓存窗口，禁跨相位事务）。
    """
    from .lifecycle import flush_distill_queue, noise_sweep, run_maintenance

    report: dict = {"status": "ok", "day_state": None, "phases": {}, "errors": []}
    phases = report["phases"]

    # 相位 1：取代（LWW 近重收敛）
    try:
        if not getattr(embedder, "available", False):
            phases["supersede"] = {"skipped": "unavailable"}
        else:
            collected = collect_pairs(store, cfg, _revival_anchor())
            actions = route(collected["pairs"], cfg)
            uids = [u for act in actions
                    for u in (act["pair"]["a_uid"], act["pair"]["b_uid"])]
            meta = _entries_meta(store, uids)
            for act in actions:
                p = act["pair"]
                m_a, m_b = meta.get(p["a_uid"]), meta.get(p["b_uid"])
                act["a_kind"] = m_a["kind"] if m_a else None
                act["b_kind"] = m_b["kind"] if m_b else None
                act["a_brief"] = _brief(m_a["content"]) if m_a else ""
                act["b_brief"] = _brief(m_b["content"]) if m_b else ""
                # 翻回：winner 现被 loser 压着（含人工 retire 指针）→ 本轮翻身
                act["flip"] = bool(act["tier"] == "M" and m_b
                                   and m_b["superseded_by"] == p["a_uid"])
            applied = 0
            if apply:
                for act in actions:
                    if act["tier"] != "M":
                        continue
                    try:
                        store.dream_apply(act["loser"], act["winner"])
                        applied += 1
                    except Exception as exc:  # 单对失败：计错误跳过该对，不抛穿
                        report["errors"].append(
                            {"phase": "supersede", "uid": act["loser"], "error": str(exc)})
            phases["supersede"] = {"actions": actions, "truncated": collected["truncated"],
                                   "applied": applied}
    except Exception as exc:  # 配对/预检出错：跳过该批
        phases["supersede"] = {"error": str(exc)}
        report["errors"].append({"phase": "supersede", "error": str(exc)})

    # 相位 2：蒸馏冲刷（apply-only）
    try:
        if not apply:
            phases["distill"] = {"skipped": "report_only"}
        else:
            phases["distill"] = flush_distill_queue(store, distiller, embedder=embedder,
                                                    pair_sim=cfg.pair_sim)
    except Exception as exc:
        phases["distill"] = {"error": str(exc)}
        report["errors"].append({"phase": "distill", "error": str(exc)})

    # 相位 3：TTL 收账（apply-only；遗忘主引擎）
    try:
        if not apply:
            phases["purge"] = {"skipped": "report_only"}
        else:
            phases["purge"] = run_maintenance(
                store, ttl_artifact_days=cfg.ttl_artifact_days,
                ttl_injection_days=cfg.ttl_injection_days,
                ttl_stale_days=cfg.ttl_stale_days, dry_run=False)
    except Exception as exc:
        phases["purge"] = {"error": str(exc)}
        report["errors"].append({"phase": "purge", "error": str(exc)})

    # 相位 4：噪声清扫（dry_run=not apply）
    try:
        phases["noise"] = noise_sweep(store, dry_run=not apply)
    except Exception as exc:
        phases["noise"] = {"error": str(exc)}
        report["errors"].append({"phase": "noise", "error": str(exc)})

    report["day_state"] = day_state(dream_state_path())
    if apply:
        _mark_last_apply(dream_state_path())  # apply 落复活锚（报告随后反映）
        report["day_state"] = day_state(dream_state_path())
    try:
        write_dream_log(report)
    except OSError as exc:
        report["errors"].append({"phase": "log", "error": str(exc)})
    report["notify"] = _build_notify(report, apply)
    if report["errors"]:
        report["status"] = "degraded"
    return report


def write_dream_log(report: dict) -> Path:
    """按 Task 2 schema 写 JSONL（<data_dir>/logs/dream-YYYYMMDD.jsonl，同日续写）。

    每行 {date, a_uid, b_uid, loser, winner, outcome}——平局去重＋事后审计/回滚依据。
    """
    actions = ((report.get("phases", {}).get("supersede")) or {}).get("actions") or []
    log_dir = dream_log_dir()
    log_dir.mkdir(parents=True, exist_ok=True)
    path = log_dir / f"dream-{datetime.now():%Y%m%d}.jsonl"
    lines = []
    for act in actions:
        p = act["pair"]
        lines.append(json.dumps(
            {"date": _today(), "a_uid": p["a_uid"], "b_uid": p["b_uid"],
             "loser": act["loser"], "winner": act["winner"], "outcome": act["tier"]},
            ensure_ascii=False))
    if lines:
        with path.open("a", encoding="utf-8") as f:
            f.write("\n".join(lines) + "\n")
    return path


def _build_notify(report: dict, apply: bool) -> dict:
    """通知面（邮件就绪，发信归定时器/部署方，本仓零 SMTP）。重要筛选全机械。

    正文一律大白话：不出现 supersede/LWW/updated_at 等术语；uid 截断展示，
    仅处置命令里保留完整参数；report-only 正文加 DRY-RUN（未执行）前缀。
    """
    phases = report.get("phases", {})
    sup = phases.get("supersede") or {}
    actions = sup.get("actions") or []
    m_acts = [a for a in actions if a["tier"] == "M"]
    tie_acts = [a for a in actions if a["tier"] == "H-tie"]
    flip_acts = [a for a in m_acts if a.get("flip")]
    explained = [a for a in m_acts
                 if a.get("a_kind") != "fact" or a.get("b_kind") != "fact"]
    purge = phases.get("purge") or {}
    purged = int(purge.get("total_removed") or 0)
    forgotten = len((phases.get("noise") or {}).get("forgotten") or [])

    counts = {"pairs": len(actions), "m": len(m_acts), "h_tie": len(tie_acts),
              "applied": int(sup.get("applied") or 0), "flips": len(flip_acts),
              "truncated": bool(sup.get("truncated")),
              "purged": purged, "noise_forgotten": forgotten}

    important: list[dict] = []
    for a in tie_acts:
        p = a["pair"]
        important.append({
            "kind": "tie", "a_uid": p["a_uid"], "b_uid": p["b_uid"],
            "a_brief": a.get("a_brief"), "b_brief": a.get("b_brief"),
            "action": f"silicon-memory retire --ref hot:{p['a_uid']} --by hot:{p['b_uid']}"})
    for a in flip_acts:
        p = a["pair"]
        important.append({
            "kind": "flip", "a_uid": p["a_uid"], "b_uid": p["b_uid"],
            "a_brief": a.get("a_brief"), "b_brief": a.get("b_brief"),
            "action": f"silicon-memory retire --ref hot:{p['b_uid']} --by hot:{p['a_uid']}"})
    for a in explained:
        important.append({
            "kind": "explained", "loser_uid": a["loser"], "winner_uid": a["winner"],
            "loser_brief": a.get("a_brief"), "winner_brief": a.get("b_brief")})
    if counts["truncated"]:
        important.append({"kind": "budget", "detail": "达到每夜整理上限，剩余明夜续"})
    for name, ph in phases.items():
        if isinstance(ph, dict):
            detail = ph.get("skipped") or ph.get("error")
            if detail:
                important.append({"kind": "anomaly", "phase": name, "detail": detail})

    subject = (f"做梦报告：归并 {len(m_acts)}、平局 {len(tie_acts)}、"
               f"翻回 {len(flip_acts)}、过期 {purged}、噪声 {forgotten}")
    lines = [
        f"本夜做梦：{len(m_acts)} 对重复/过时的记忆做了归并，"
        f"{len(flip_acts)} 条以前压下的记忆重新被提起，"
        f"{purged} 条久无人用的事实自然过期，清了 {forgotten} 条噪声。",
    ]
    if tie_acts:
        lines.append(f"⚠ {len(tie_acts)} 对拿不定主意的等你定"
                     f"（两条同刻被确认，分不出谁新）：")
        for a in tie_acts:
            p = a["pair"]
            lines.append(f"  - 「{a.get('a_brief', '')}」⇄「{a.get('b_brief', '')}」"
                         f"→ 定夺：silicon-memory retire --ref hot:{p['a_uid']}"
                         f" --by hot:{p['b_uid']}")
    if flip_acts:
        lines.append(f"↺ {len(flip_acts)} 条翻回来了（最近又被反复说起，按时间它最新，"
                     f"已恢复为现行版；不同意就反向 retire）：")
        for a in flip_acts:
            lines.append(f"  - 「{a.get('b_brief', '')}」← 压着它的「{a.get('a_brief', '')}」")
    if explained:
        lines.append(f"● 偏好/决定有 {len(explained)} 处被新说法取代：")
        for a in explained:
            lines.append(f"  - 「{a.get('a_brief', '')}」→「{a.get('b_brief', '')}」")
    if counts["truncated"]:
        lines.append("▲ 本夜达到整理上限，剩余的明夜继续。")
    for name, ph in phases.items():
        if isinstance(ph, dict):
            detail = ph.get("skipped") or ph.get("error")
            if detail:
                lines.append(f"△ {_STEP_NAMES.get(name, name)}：{detail}")
    text = "\n".join(lines)
    if not apply:
        text = "DRY-RUN（未执行）\n" + text
    return {"subject": subject, "text": text, "important": important, "counts": counts}
