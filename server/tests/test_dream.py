"""dream（做梦）接口测试：store 原语 → 配对/预算 → LWW 定向 → 编排 → 配置/CLI → 折叠。

设计：docs/superpowers/specs/2026-11-26-memory-groom-supersede-design.md
计划：docs/superpowers/plans/2026-11-26-memory-dream.md
"""
import json
from datetime import datetime
from types import SimpleNamespace

import pytest

np = pytest.importorskip("numpy")  # 零依赖基座：无 numpy 时整模块跳过

from semantic_memory.db import MemoryStore
from semantic_memory.dream import (
    collect_pairs,
    day_state,
    dream_state_path,
    spend,
)

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
    assert day_state(path) == {"date": TODAY, "pairs": 0}
    assert spend(path, 2) is True
    assert day_state(path)["pairs"] == 2
    path.write_text(json.dumps({"date": "2000-01-01", "pairs": 5}), encoding="utf-8")
    assert day_state(path)["pairs"] == 0  # 自然日翻账

