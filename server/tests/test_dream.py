"""dream（做梦）接口测试：store 原语 → 配对/预算 → LWW 定向 → 编排 → 配置/CLI → 折叠。

设计：docs/superpowers/specs/2026-11-26-memory-groom-supersede-design.md
计划：docs/superpowers/plans/2026-11-26-memory-dream.md
"""
import inspect
import json
import os
import subprocess
import sys
import time
from datetime import datetime, timedelta
from pathlib import Path
from types import SimpleNamespace

import pytest

np = pytest.importorskip("numpy")  # 零依赖基座：无 numpy 时整模块跳过

from semantic_memory.db import MemoryStore
from semantic_memory.dream import (
    collect_pairs,
    day_state,
    dream_log_dir,
    dream_state_path,
    fold_near_hits,
    route,
    run_dream,
    spend,
)
from semantic_memory.lifecycle import enqueue_raw, flush_distill_queue

TODAY = datetime.now().strftime("%Y-%m-%d")
_E = [np.eye(4, dtype=np.float32)[i] for i in range(4)]  # 四个正交方向


@pytest.fixture()
def store(tmp_path):
    s = MemoryStore(tmp_path / "dream.db")
    yield s
    s.close()


@pytest.fixture()
def isolated_data_dir(tmp_path, monkeypatch):
    """dream 状态/日志目录钉到 tmp_path（day-state 与前夜日志的读写面）。"""
    monkeypatch.setenv("MEMORY_DATA_DIR", str(tmp_path))
    return tmp_path


def _cfg(pair_sim=0.92, max_per_night=200):
    return SimpleNamespace(pair_sim=pair_sim, max_per_night=max_per_night)


def _touch(store, uid, ts):
    with store.conn:
        store.conn.execute("UPDATE memories SET updated_at=? WHERE uid=?", (ts, uid))


def _row(store, uid):
    return store.conn.execute(
        "SELECT uid, superseded_by, superseded_at, updated_at, deleted FROM memories WHERE uid=?",
        (uid,),
    ).fetchone()


def _set_pointer(store, uid, by, ts=1.0):
    """测试辅助：直接落一条 superseded_by 指针（模拟含人工来源的 retire 效果）。"""
    with store.conn:
        store.conn.execute(
            "UPDATE memories SET superseded_by=?, superseded_at=? WHERE uid=?",
            (by, ts, uid),
        )


# ---------- Task 1: store 原语 ----------


def test_dream_apply_reverses_pointer(store):
    # 前向指针（含人工来源）：b 已被 a 取代（retire b --by a 的效果）
    a = store.store("旧说法", kind="fact")
    b = store.store("新说法", kind="fact")
    _set_pointer(store, b, a)

    # LWW 翻转：a=loser、b=winner——实例指针全机械，人工 retire 不豁免
    assert store.dream_apply(a, b) is True
    assert _row(store, a)["superseded_by"] == b
    assert _row(store, b)["superseded_by"] is None

    # 幂等：同向重复 apply 零变更 → False
    assert store.dream_apply(a, b) is False


def test_dream_apply_plain_forward(store):
    # 常规前向：a(旧) → b(新)，无既有指针；M 动作上限＝指针，零物理删除
    a = store.store("旧", kind="fact")
    b = store.store("新", kind="fact")
    assert store.dream_apply(a, b) is True
    assert _row(store, a)["superseded_by"] == b
    assert _row(store, a)["superseded_at"] is not None
    assert _row(store, b)["superseded_by"] is None
    assert _row(store, a)["deleted"] == 0


def test_revival_candidates_only_recently_touched(store):
    sup_new = store.store("被取代且最近被再确认")
    sup_old = store.store("被取代且久未被提")
    active = store.store("未被取代")
    sup_dead = store.store("被取代但已删除")
    with store.conn:
        store.conn.execute(
            "UPDATE memories SET superseded_by='x', updated_at=200 WHERE uid=?", (sup_new,))
        store.conn.execute(
            "UPDATE memories SET superseded_by='x', updated_at=50 WHERE uid=?", (sup_old,))
        store.conn.execute("UPDATE memories SET updated_at=300 WHERE uid=?", (active,))
        store.conn.execute(
            "UPDATE memories SET superseded_by='x', updated_at=200, deleted=1 WHERE uid=?",
            (sup_dead,))
    rows = store.revival_candidates(100.0)
    assert [r["uid"] for r in rows] == [sup_new]
    assert rows[0]["updated_at"] == 200


def test_vectors_of(store):
    dim = 4
    vec = np.zeros(dim, dtype=np.float32)
    vec[0] = 1.0
    have = store.store("有向量", embedding=vec)
    lack = store.store("无向量")
    vecs = store.vectors_of([have, lack, "no-such-uid"])
    assert vecs[have] is not None and abs(float(vecs[have][0]) - 1.0) < 1e-6
    assert vecs[lack] is None
    assert vecs["no-such-uid"] is None


def test_active_projects(store):
    store.store("p1 活跃", project="p1")
    gone = store.store("p2 旧版", project="p2")
    dead = store.store("p3 将被删除", project="p3")
    new = store.store("p2 新版", project="p2")
    _set_pointer(store, gone, new)
    store.forget(dead)
    assert store.active_projects() == ["p1", "p2"]


# ---------- Task 2: 同域配对＋遗忘限速＋日志 schema ----------


def test_collect_pairs_global_bucket_lww_labels(store, isolated_data_dir):
    old = store.store("旧的全局说法", embedding=_E[0])
    new = store.store("新的全局说法", embedding=_E[0])
    _touch(store, old, 100)
    _touch(store, new, 200)

    out = collect_pairs(store, _cfg(), None)
    assert out["truncated"] is False
    assert len(out["pairs"]) == 1
    p = out["pairs"][0]
    assert (p["a_uid"], p["b_uid"]) == (old, new)  # a 恒为旧侧（LWW 方向）
    assert (p["a_ts"], p["b_ts"]) == (100, 200)
    assert p["domain"] is None


def test_collect_pairs_project_global_buckets_dont_cross(store, isolated_data_dir):
    g1 = store.store("全局旧", embedding=_E[0])
    g2 = store.store("全局新", embedding=_E[0])
    p1 = store.store("项目旧", project="p1", embedding=_E[0])
    p2 = store.store("项目新", project="p1", embedding=_E[0])
    for uid, ts in ((g1, 100), (g2, 200), (p1, 150), (p2, 250)):
        _touch(store, uid, ts)

    pairs = collect_pairs(store, _cfg(), None)["pairs"]
    assert len(pairs) == 2  # 全域 1 对＋p1 域 1 对，跨域不成对
    assert {p["domain"] for p in pairs} == {None, "p1"}
    for p in pairs:
        assert {p["a_uid"], p["b_uid"]} in ({g1, g2}, {p1, p2})


def test_collect_pairs_budget_truncates_and_spends(store, isolated_data_dir):
    pairs_data = [(_E[1], 110, 111), (_E[2], 120, 121), (_E[3], 130, 131)]
    for vec, ts_old, ts_new in pairs_data:
        a = store.store("旧A", embedding=vec)
        b = store.store("新B", embedding=vec)
        _touch(store, a, ts_old)
        _touch(store, b, ts_new)

    out = collect_pairs(store, _cfg(max_per_night=2), None)
    assert len(out["pairs"]) == 2
    assert out["truncated"] is True
    assert day_state(dream_state_path())["pairs"] == 2  # 跨 invocation 计账


def test_collect_pairs_skips_previously_reported_stale(store, isolated_data_dir):
    old = store.store("旧的说法", embedding=_E[0])
    new = store.store("新的说法", embedding=_E[0])
    _touch(store, old, 100)
    _touch(store, new, 200)
    log_dir = isolated_data_dir / "logs"
    log_dir.mkdir(parents=True)
    line = json.dumps({"date": TODAY, "a_uid": old, "b_uid": new,
                       "loser": None, "winner": None, "outcome": "H-tie"})
    (log_dir / f"dream-{datetime.now():%Y%m%d}.jsonl").write_text(
        line + "\n", encoding="utf-8")

    # 前夜已报且两侧 updated_at<=last_run_ts → 跳过（H-tie 不重复报）
    out = collect_pairs(store, _cfg(), 300)
    assert out["pairs"] == []

    # 一侧被再确认（touch 刷 updated_at>last_run_ts）→ 重新入对且方向翻转
    _touch(store, old, 400)
    out = collect_pairs(store, _cfg(), 300)
    assert len(out["pairs"]) == 1
    p = out["pairs"][0]
    assert (p["a_uid"], p["b_uid"]) == (new, old)  # 新侧成 a（旧），旧条翻身成 b


def test_collect_pairs_revival_candidates_enter_pool(store, isolated_data_dir):
    y = store.store("现行版", embedding=_E[0])
    x = store.store("被取代旧版", embedding=_E[0])
    _set_pointer(store, x, y)  # x 已被 y 取代（不在活跃向量面）
    _touch(store, y, 100)
    _touch(store, x, 300)  # 被取代条目再被 touch → 复活候选

    out = collect_pairs(store, _cfg(), 200)
    assert len(out["pairs"]) == 1
    p = out["pairs"][0]
    assert (p["a_uid"], p["b_uid"]) == (y, x)  # y 现 ts 旧为 a；x 复活成 b（新侧）


def test_day_state_natural_day_rollover(tmp_path):
    path = tmp_path / "dream-state.json"
    assert day_state(path) == {"date": TODAY, "pairs": 0, "last_apply_ts": 0.0}
    assert spend(path, 2) is True
    assert day_state(path)["pairs"] == 2
    path.write_text(json.dumps({"date": "2000-01-01", "pairs": 5}), encoding="utf-8")
    assert day_state(path)["pairs"] == 0  # 自然日翻账
    # 复活锚（last_apply_ts）跨日持久，不随日翻账清零
    path.write_text(json.dumps({"date": "2000-01-01", "pairs": 5,
                                "last_apply_ts": 123.5}), encoding="utf-8")
    st = day_state(path)
    assert st == {"date": TODAY, "pairs": 0, "last_apply_ts": 123.5}


# ---------- Task 3: LWW 定向＋平局路由（无裁决） ----------


def _pair(a, b, a_ts, b_ts, domain=None):
    return {"a_uid": a, "a_ts": a_ts, "b_uid": b, "b_ts": b_ts, "domain": domain}


def test_route_recantment_pair_direction_by_time(store, isolated_data_dir):
    # "偏好X/不再偏好X"：翻供不区分——方向永远由时间定，新者存活，无模型参与
    old = store.store("偏好X", embedding=_E[0])
    new = store.store("不再偏好X", embedding=_E[0])
    _touch(store, old, 100)
    _touch(store, new, 200)
    actions = route(collect_pairs(store, _cfg(), None)["pairs"], _cfg())
    assert len(actions) == 1
    assert actions[0]["tier"] == "M"
    assert actions[0]["loser"] == old and actions[0]["winner"] == new
    assert actions[0]["pair"]["a_uid"] == old


def test_route_tie_keeps_both_for_human():
    actions = route([_pair("x", "y", 100, 100)], _cfg())
    assert len(actions) == 1
    assert actions[0]["tier"] == "H-tie"
    assert actions[0]["loser"] is None and actions[0]["winner"] is None


def test_route_has_no_llm_surface():
    sig = inspect.signature(route)
    assert list(sig.parameters) == ["pairs", "cfg"]  # 无模型注入面＝零 LLM 的证明


# ---------- Task 4: 执行＋报告＋相位编排 ----------


class _FakeEmbedder:
    device = "cpu"

    def __init__(self, available=True):
        self.available = available


def _rcfg(pair_sim=0.92, max_per_night=200):
    # ttl_* = 0：purge 相位照跑但各清理步骤关闭（隔离 supersede 断言）
    return SimpleNamespace(pair_sim=pair_sim, max_per_night=max_per_night,
                           ttl_artifact_days=0, ttl_injection_days=0, ttl_stale_days=0)


def test_run_dream_report_only_zero_writes(store, isolated_data_dir, monkeypatch):
    a = store.store("旧说法甲", embedding=_E[0])
    b = store.store("新说法甲", embedding=_E[0])
    _touch(store, a, 100)
    _touch(store, b, 200)
    calls = []
    monkeypatch.setattr(store, "dream_apply",
                        lambda loser, winner: calls.append((loser, winner)) or True)

    report = run_dream(store, _rcfg(), None, _FakeEmbedder(True), apply=False)

    assert calls == []  # dream_apply 零调用（写零落）
    assert report["phases"]["distill"] == {"skipped": "report_only"}
    assert report["phases"]["purge"] == {"skipped": "report_only"}
    assert report["phases"]["noise"]["dry_run"] is True
    sup = report["phases"]["supersede"]
    assert sup["applied"] == 0 and len(sup["actions"]) == 1
    assert report["status"] == "ok"
    assert report["notify"]["text"].startswith("DRY-RUN（未执行）")


def test_run_dream_apply_marks_and_logs(store, isolated_data_dir):
    a = store.store("旧说法甲", embedding=_E[0])
    b = store.store("新说法甲", embedding=_E[0])
    _touch(store, a, 100)
    _touch(store, b, 200)
    x = store.store("平局X", embedding=_E[1])
    y = store.store("平局Y", embedding=_E[1])
    _touch(store, x, 150)
    _touch(store, y, 150)

    report = run_dream(store, _rcfg(), None, _FakeEmbedder(True), apply=True)

    sup = report["phases"]["supersede"]
    assert sup["applied"] == 1
    assert _row(store, a)["superseded_by"] == b  # M 对落指针
    assert _row(store, x)["superseded_by"] is None
    assert _row(store, y)["superseded_by"] is None  # H-tie 不执行
    log_path = dream_log_dir() / f"dream-{datetime.now():%Y%m%d}.jsonl"
    lines = [json.loads(l) for l in log_path.read_text(encoding="utf-8").splitlines()]
    assert len(lines) == 2  # 日志含全量对
    m_line = next(l for l in lines if l["outcome"] == "M")
    assert (m_line["loser"], m_line["winner"]) == (a, b)
    assert m_line["date"] == TODAY
    tie_line = next(l for l in lines if l["outcome"] == "H-tie")
    assert tie_line["loser"] is None and tie_line["winner"] is None
    assert report["day_state"]["pairs"] == 2
    assert not report["notify"]["text"].startswith("DRY-RUN")


def test_run_dream_no_embedder_skips_supersede_only(store, isolated_data_dir):
    a = store.store("旧说法甲", embedding=_E[0])
    b = store.store("新说法甲", embedding=_E[0])
    _touch(store, a, 100)
    _touch(store, b, 200)

    report = run_dream(store, _rcfg(), None, _FakeEmbedder(False), apply=True)

    assert report["phases"]["supersede"] == {"skipped": "unavailable"}
    assert _row(store, a)["superseded_by"] is None
    assert "total_removed" in report["phases"]["purge"]  # purge 照跑
    assert "scanned" in report["phases"]["noise"]  # noise 照跑
    assert "typed" in report["phases"]["distill"]  # distill 照跑


def test_run_dream_pairing_error_degrades(store, isolated_data_dir):
    class BrokenStore:
        def __init__(self, inner):
            self._inner = inner

        def __getattr__(self, name):
            return getattr(self._inner, name)

        def all_vectors(self, *args, **kwargs):
            raise RuntimeError("boom")

    report = run_dream(BrokenStore(store), _rcfg(), None, _FakeEmbedder(True), apply=False)

    assert report["errors"]  # errors 非空
    assert "error" in report["phases"]["supersede"]
    assert report["status"] == "degraded"
    assert "scanned" in report["phases"]["noise"]  # 不抛穿 run_dream，后续相位照跑


def test_run_dream_report_only_does_not_block_later_apply(store, isolated_data_dir):
    a = store.store("旧说法甲", embedding=_E[0])
    b = store.store("新说法甲", embedding=_E[0])
    _touch(store, a, 100)
    _touch(store, b, 200)

    run_dream(store, _rcfg(), None, _FakeEmbedder(True), apply=False)  # 前夜 report-only 已报
    log = max(dream_log_dir().glob("dream-*.jsonl"))
    old = time.time() - 3600
    os.utime(log, (old, old))  # 拨回前夜

    run_dream(store, _rcfg(), None, _FakeEmbedder(True), apply=True)
    assert _row(store, a)["superseded_by"] == b  # M 对不被前夜 report-only 报告挡住


def test_report_only_run_does_not_advance_revival_anchor(store, isolated_data_dir):
    """评审 I-2：日间 report-only 不得推走复活锚——白天 touch 的翻回对须留给当夜 apply。

    锚＝state.last_apply_ts（apply 运行时落）＞最老日志 mtime（无 apply 史兜底）；
    日间报告只追加当日日志，不动昨日日志的 mtime，也不写 last_apply_ts。
    """
    log_dir = isolated_data_dir / "logs"
    log_dir.mkdir(parents=True)
    yesterday = datetime.now() - timedelta(days=1)
    old_log = log_dir / f"dream-{yesterday:%Y%m%d}.jsonl"
    old_log.write_text("", encoding="utf-8")
    old_ts = time.time() - 86400
    os.utime(old_log, (old_ts, old_ts))  # 昨日 dream 日志（复活锚兜底源）
    y = store.store("现行版", embedding=_E[0])
    x = store.store("旧版翻回", embedding=_E[0])
    _set_pointer(store, x, y)
    _touch(store, y, 100)
    _touch(store, x, time.time() - 60)  # 白天再确认（touch）

    r1 = run_dream(store, _rcfg(), None, _FakeEmbedder(True), apply=False)  # 日间诊断
    assert len(r1["phases"]["supersede"]["actions"]) == 1  # 看见复活对（报告）

    run_dream(store, _rcfg(), None, _FakeEmbedder(True), apply=True)  # 当夜 apply
    assert _row(store, x)["superseded_by"] is None  # 翻回：x 恢复现行
    assert _row(store, y)["superseded_by"] == x  # y 让位
    assert day_state(dream_state_path())["last_apply_ts"] > 0  # apply 落锚


def test_notify_mechanical_filters(store, isolated_data_dir):
    log_dir = isolated_data_dir / "logs"
    log_dir.mkdir(parents=True)
    log = log_dir / f"dream-{datetime.now():%Y%m%d}.jsonl"
    log.write_text("", encoding="utf-8")
    old = time.time() - 3600
    os.utime(log, (old, old))  # 前夜跑过 → last_run_ts 存在 → 复活池可达
    # 解释类取代对（preference）
    p_old = store.store("偏好旧说法", kind="preference", embedding=_E[0])
    p_new = store.store("偏好新说法", kind="preference", embedding=_E[0])
    _touch(store, p_old, 100)
    _touch(store, p_new, 200)
    # fact 取代对（只计数）
    f_old = store.store("事实旧说法", embedding=_E[1])
    f_new = store.store("事实新说法", embedding=_E[1])
    _touch(store, f_old, 100)
    _touch(store, f_new, 200)
    # 平局对
    x = store.store("平局X", embedding=_E[2])
    y = store.store("平局Y", embedding=_E[2])
    _touch(store, x, 150)
    _touch(store, y, 150)
    # 翻回对：被压下的旧版再被提起 → 翻身（updated_at 需晚于真实时间的前夜锚）
    y2 = store.store("现行版", embedding=_E[3])
    x2 = store.store("旧版翻回", embedding=_E[3])
    _set_pointer(store, x2, y2)
    _touch(store, y2, 100)
    _touch(store, x2, time.time() - 60)  # 复活候选（updated_at > last_run_ts）

    report = run_dream(store, _rcfg(), None, _FakeEmbedder(True), apply=False)
    n = report["notify"]
    c = n["counts"]
    assert (c["pairs"], c["m"], c["h_tie"], c["flips"], c["applied"]) == (4, 3, 1, 1, 0)
    kinds = [e["kind"] for e in n["important"]]
    assert kinds.count("tie") == 1
    assert kinds.count("flip") == 1
    assert kinds.count("explained") == 1  # fact 对仅计数不入 important
    assert kinds.count("anomaly") == 2  # report-only：distill/purge skipped 全列
    assert "budget" not in kinds
    text = n["text"]
    for term in ("supersede", "LWW", "updated_at"):
        assert term not in text
    assert text.startswith("DRY-RUN（未执行）")
    tie_act = next(a for a in report["phases"]["supersede"]["actions"]
                   if a["tier"] == "H-tie")
    assert {tie_act["pair"]["a_uid"], tie_act["pair"]["b_uid"]} == {x, y}
    tie_entry = next(e for e in n["important"] if e["kind"] == "tie")
    # 处置命令须与 mjs retire 契约一致（--ref/--by hot: 形态，贴进终端即可运行）
    assert tie_entry["action"] == (f"silicon-memory retire --ref hot:{tie_act['pair']['a_uid']}"
                                   f" --by hot:{tie_act['pair']['b_uid']}")
    flip_entry = next(e for e in n["important"] if e["kind"] == "flip")
    assert flip_entry["action"] == (f"silicon-memory retire --ref hot:{x2}"
                                    f" --by hot:{y2}")
    # 解释类附旧/新摘要
    explained_entry = next(e for e in n["important"] if e["kind"] == "explained")
    assert "偏好旧说法" in explained_entry["loser_brief"]
    assert "偏好新说法" in explained_entry["winner_brief"]


# ---------- Task 5: 配置＋server CLI ----------


def test_config_dream_keys(monkeypatch):
    from semantic_memory.config import Config
    for k in ("MEMORY_DREAM_PAIR_SIM", "MEMORY_DREAM_MAX_PER_NIGHT", "MEMORY_FOLD_SIM"):
        monkeypatch.delenv(k, raising=False)
    cfg = Config.from_env()
    assert cfg.pair_sim == 0.92
    assert cfg.max_per_night == 200
    assert cfg.fold_sim == 0.95
    monkeypatch.setenv("MEMORY_DREAM_PAIR_SIM", "0.95")
    assert Config.from_env().pair_sim == 0.95


def test_cli_dream_whitelist():
    from semantic_memory.server import _KNOWN_COMMANDS
    assert "dream" in _KNOWN_COMMANDS


def test_cli_dream_smoke_and_rc2(tmp_path):
    db = tmp_path / "cli.db"
    s = MemoryStore(db)
    s.close()
    env = {**os.environ, "MEMORY_DB_PATH": str(db), "MEMORY_MODEL_PATH": "",
           "PYTHONPATH": str(Path(__file__).resolve().parents[1] / "src")}
    proc = subprocess.run([sys.executable, "-m", "semantic_memory", "dream"],
                          capture_output=True, text=True, env=env, timeout=120)
    assert proc.returncode == 0, proc.stderr
    report = json.loads(proc.stdout)
    assert report["phases"]["supersede"] == {"skipped": "unavailable"}
    assert report["phases"]["noise"]["dry_run"] is True
    assert "notify" in report
    proc2 = subprocess.run([sys.executable, "-m", "semantic_memory", "bogus-cmd"],
                           capture_output=True, text=True, env=env, timeout=120)
    assert proc2.returncode == 2


# ---------- Task 6: 蒸馏带自动新取旧（取消提问） ----------


class _DictEmbedder:
    available = True
    device = "cpu"

    def __init__(self, mapping):
        self._m = mapping

    def embed_batch(self, texts):
        return np.stack([self._m[t] for t in texts])


class _EntriesDistiller:
    """可编程假蒸馏器：返回预设 typed 条目（模型只管蒸馏本身，无 supersedes 契约）。"""

    def __init__(self, entries):
        self._entries = entries
        self.calls = []

    def is_available(self):
        return True

    def distill(self, texts, project):
        self.calls.append((list(texts), project))
        return self._entries


def test_flush_band_auto_supersedes(store):
    v_old = np.array([1.0, 0.0], dtype=np.float32)
    v_new = np.array([0.95, 0.31224990], dtype=np.float32)  # cos=0.95 ∈ [pair_sim, NEAR_HI)
    v_entry = np.array([0.0, 1.0], dtype=np.float32)
    old = store.store("旧版说法", project="p1", embedding=v_old)
    enqueue_raw(store, "新版说法原文", "chat", "p1", "s1")
    emb = _DictEmbedder({"新版说法原文": v_new, "蒸馏后的新条": v_entry})
    fake = _EntriesDistiller([
        {"content": "蒸馏后的新条", "kind": "fact", "scope": "project", "tags": []},
    ])

    report = flush_distill_queue(store, fake, embedder=emb, pair_sim=0.92)

    assert report["typed"] == 1 and report["stored_raw"] == 0
    new_row = store.conn.execute(
        "SELECT uid, superseded_by FROM memories WHERE content='蒸馏后的新条'"
    ).fetchone()
    old_row = store.conn.execute(
        "SELECT superseded_by FROM memories WHERE uid=?", (old,)).fetchone()
    assert new_row["superseded_by"] is None
    assert old_row["superseded_by"] == new_row["uid"]  # 自动新取旧，模型输出无需 supersedes 字段


def test_flush_band_below_pair_sim_untouched(store):
    v_old = np.array([1.0, 0.0], dtype=np.float32)
    v_new = np.array([0.8, 0.6], dtype=np.float32)  # cos=0.80 < pair_sim
    v_entry = np.array([0.0, 1.0], dtype=np.float32)
    old = store.store("旧版说法", project="p1", embedding=v_old)
    enqueue_raw(store, "新版说法原文", "chat", "p1", "s1")
    emb = _DictEmbedder({"新版说法原文": v_new, "蒸馏后的新条": v_entry})
    fake = _EntriesDistiller([
        {"content": "蒸馏后的新条", "kind": "fact", "scope": "project", "tags": []},
    ])

    report = flush_distill_queue(store, fake, embedder=emb, pair_sim=0.92)

    assert report["typed"] == 1 and report["stored_raw"] == 0
    new_row = store.conn.execute(
        "SELECT uid, superseded_by FROM memories WHERE content='蒸馏后的新条'"
    ).fetchone()
    old_row = store.conn.execute(
        "SELECT superseded_by FROM memories WHERE uid=?", (old,)).fetchone()
    assert new_row["uid"] is not None
    assert old_row["superseded_by"] is None  # <pair_sim 带邻居不动（dream 存量面/TTL 兜）


# ---------- Task 7: /recall 近重折叠（读取面止血，零存储写） ----------


def test_fold_near_hits_same_domain_keeps_newest(store):
    uid_old = store.store("旧说法", project="p1", embedding=_E[0])
    uid_new = store.store("新说法", project="p1", embedding=_E[0])
    hits = [
        {"uid": uid_old, "project": "p1", "updated_at": 100.0, "created_at": 50.0},
        {"uid": uid_new, "project": "p1", "updated_at": 200.0, "created_at": 150.0},
    ]
    out, folded = fold_near_hits(store, hits, 0.95)
    assert folded == 1
    assert [h["uid"] for h in out] == [uid_new]  # 同域近重仅新者返回


def test_fold_near_hits_tie_prefers_created_then_uid(store):
    a = store.store("平A", project="p1", embedding=_E[0])
    b = store.store("平B", project="p1", embedding=_E[0])
    hits = [
        {"uid": a, "project": "p1", "updated_at": 100.0, "created_at": 50.0},
        {"uid": b, "project": "p1", "updated_at": 100.0, "created_at": 60.0},
    ]
    out, folded = fold_near_hits(store, hits, 0.95)
    assert folded == 1 and out[0]["uid"] == b  # 平局比 created_at


def test_fold_near_hits_below_threshold_both_survive(store):
    v_half = np.array([0.5, 0.8660254, 0.0, 0.0], dtype=np.float32)  # cos=0.5 < 0.95
    a = store.store("半相似A", project="p1", embedding=_E[0])
    b = store.store("半相似B", project="p1", embedding=v_half)
    hits = [
        {"uid": a, "project": "p1", "updated_at": 100.0, "created_at": 50.0},
        {"uid": b, "project": "p1", "updated_at": 200.0, "created_at": 150.0},
    ]
    out, folded = fold_near_hits(store, hits, 0.95)
    assert folded == 0 and len(out) == 2  # 阈下双双存活（折叠不误伤）


def test_fold_near_hits_cross_domain_no_fold(store):
    a = store.store("域A条目", project="pa", embedding=_E[0])
    b = store.store("域B条目", project="pb", embedding=_E[0])
    hits = [
        {"uid": a, "project": "pa", "updated_at": 100.0, "created_at": 50.0},
        {"uid": b, "project": "pb", "updated_at": 200.0, "created_at": 150.0},
    ]
    out, folded = fold_near_hits(store, hits, 0.95)
    assert folded == 0 and len(out) == 2  # 跨域不折


def test_fold_near_hits_global_domain_folds(store):
    # 同为全局域（project None==None）也折叠
    a = store.store("全局旧", embedding=_E[0])
    b = store.store("全局新", embedding=_E[0])
    hits = [
        {"uid": a, "project": None, "updated_at": 100.0, "created_at": 50.0},
        {"uid": b, "project": None, "updated_at": 200.0, "created_at": 150.0},
    ]
    out, folded = fold_near_hits(store, hits, 0.95)
    assert folded == 1 and out[0]["uid"] == b


def test_fold_near_hits_no_vector_survives(store):
    plain = store.store("无向量条目", project="p1")
    vecd = store.store("有向量条目", project="p1", embedding=_E[0])
    hits = [
        {"uid": plain, "project": "p1", "updated_at": 100.0, "created_at": 50.0},
        {"uid": vecd, "project": "p1", "updated_at": 200.0, "created_at": 150.0},
    ]
    out, folded = fold_near_hits(store, hits, 0.95)
    assert folded == 0 and len(out) == 2  # 无向量条目原样保留


def test_rest_recall_response_folded_additive(monkeypatch):
    from semantic_memory import server as server_mod
    monkeypatch.setattr(server_mod, "_recall_hits", lambda **kw: ([], 3))
    monkeypatch.setattr(server_mod, "cfg", SimpleNamespace(recall_limit_default=5,
                                                           recall_min_rerank=0),
                        raising=False)  # 不触发核心单例（保持 test_rest 的 env 独占）
    out = server_mod.rest_recall({"query": "任意查询", "limit": 5})
    assert out == {"hits": [], "folded": 3}


