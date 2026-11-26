"""dream（做梦）接口测试：store 原语 → 配对/预算 → LWW 定向 → 编排 → 配置/CLI → 折叠。

设计：docs/superpowers/specs/2026-11-26-memory-groom-supersede-design.md
计划：docs/superpowers/plans/2026-11-26-memory-dream.md
"""
import pytest

np = pytest.importorskip("numpy")  # 零依赖基座：无 numpy 时整模块跳过

from semantic_memory.db import MemoryStore


@pytest.fixture()
def store(tmp_path):
    s = MemoryStore(tmp_path / "dream.db")
    yield s
    s.close()


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
