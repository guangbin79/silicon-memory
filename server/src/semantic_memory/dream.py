"""dream（做梦）接口：groom 定时调用的记忆自动整理统一面（全机械 LWW，零 LLM）。

哲学：加深重要（反复记忆/touch）、遗忘不重要（TTL 主引擎＋近重 LWW 加速器）；
正确性交给反复记忆——复活重裁自修复（被取代条目再被 touch → 次夜翻回）。
设计：docs/superpowers/specs/2026-11-26-memory-groom-supersede-design.md
"""
from __future__ import annotations

import json
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
    """{"date","pairs":N} 自然日计数；文件缺失/异日/损坏 → 今日零计数。"""
    try:
        data = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {"date": _today(), "pairs": 0}
    if not isinstance(data, dict) or data.get("date") != _today():
        return {"date": _today(), "pairs": 0}
    try:
        pairs = int(data.get("pairs", 0) or 0)
    except (TypeError, ValueError):
        pairs = 0
    return {"date": data["date"], "pairs": max(0, pairs)}


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


def _reported_pairs() -> set[frozenset[str]]:
    """既有 dream 日志已报对（无序 uid 对）——H-tie 平局不重复报的依据。"""
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
            if a and b:
                reported.add(frozenset((a, b)))
    return reported


def _uid_meta(store, uids: list[str]) -> dict[str, tuple[float, str | None]]:
    """uid → (updated_at, project)，含被取代行（复活池需要；all_vectors 不可达）。"""
    if not uids:
        return {}
    marks = ",".join("?" * len(uids))
    rows = store.conn.execute(
        f"SELECT uid, updated_at, project FROM memories WHERE uid IN ({marks})", uids
    ).fetchall()
    return {r["uid"]: (float(r["updated_at"]), r["project"]) for r in rows}


def _bucket_pairs(uids: list[str], vecs: list, domain: str | None,
                  pair_sim: float, meta: dict) -> list[dict]:
    """桶内暴力余弦：cos≥pair_sim 成对；a 恒为 updated_at 旧侧（相等入对留 route 判平局）。"""
    mat = np.stack(vecs).astype(np.float32)
    norms = np.linalg.norm(mat, axis=1)
    normed = mat / np.maximum(norms, 1e-12)[:, None]
    sim = normed @ normed.T
    n = len(uids)
    out: list[dict] = []
    for i, j in zip(*np.triu_indices(n, k=1)):
        if float(sim[i, j]) < pair_sim:
            continue
        u_i, u_j = uids[i], uids[j]
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

    # 平局去重：前夜已报且两侧至今未再被确认 → 跳过
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
