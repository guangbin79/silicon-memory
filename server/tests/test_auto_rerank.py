"""rerank_model=auto（缺省）：按启动时空闲显存决定是否常驻重排器。

判据（2026-11-09 重排）：嵌入器预留后，剩余显存 ≥ 重排器预估×1.2 才开；
预估锚点＝权重文件 MiB×2.8（2026-11-07 真机：0.6B Q8 ~700MB → 热态 1944MiB）。
取代旧固定阈值 5312MiB（2026-10-29）——显存不足以运行时仍加载是缺陷①。
"""
import math
from pathlib import Path

from semantic_memory.config import (
    Config,
    auto_rerank_enabled,
    estimate_vram_mib,
    VRAM_MARGIN,
)

_ABSENT = object()


def _cfg(monkeypatch, tmp_path, rerank_env):
    monkeypatch.setenv("MEMORY_DATA_DIR", str(tmp_path))
    if rerank_env is _ABSENT:
        monkeypatch.delenv("MEMORY_RERANK_MODEL", raising=False)
    else:
        monkeypatch.setenv("MEMORY_RERANK_MODEL", rerank_env)
    return Config.from_env()


def _sparse(tmp_path, name, mib):
    """稀疏文件：只占名义大小不占盘（显存预估测试用真 stat 尺寸）。"""
    p = tmp_path / name
    with open(p, "wb") as f:
        f.truncate(mib * 2**20)
    return p


# ---- auto 判定纯函数（嵌入器预留后剩余显存 vs 重排器预估×1.2）----

def test_auto_on_when_remaining_fits_rerank():
    # 剩余 2200-1000=1200 ≥ 需 1200 → 开
    assert auto_rerank_enabled(2200, "cuda", embedder_mib=1000, rerank_mib=1000) is True


def test_auto_boundary_remaining_exactly_need():
    need = math.ceil(1000 * VRAM_MARGIN)  # 1200
    assert auto_rerank_enabled(1000 + need, "cuda", embedder_mib=1000, rerank_mib=1000) is True
    assert auto_rerank_enabled(1000 + need - 1, "cuda", embedder_mib=1000, rerank_mib=1000) is False


def test_auto_off_when_embedder_reservation_eats_free():
    # 嵌入器预留吃掉大头：剩余 300 < 需 ceil(400×1.2)=480
    assert auto_rerank_enabled(1500, "cuda", embedder_mib=1200, rerank_mib=400) is False


def test_auto_off_when_free_unknown():
    # nvidia-smi 缺失/查询失败：宁可降级也不赌 OOM
    assert auto_rerank_enabled(None, "cuda", embedder_mib=0, rerank_mib=0) is False


def test_auto_cpu_has_no_vram_constraint():
    assert auto_rerank_enabled(None, "cpu", embedder_mib=9999, rerank_mib=9999) is True


# ---- 显存预估（权重文件 MiB×2.8 锚点）----

def test_estimate_scales_file_size_by_anchor_ratio(tmp_path):
    p = _sparse(tmp_path, "m.gguf", 700)  # 0.6B Q8 实际尺寸 ≈700MB
    assert estimate_vram_mib(p) == math.ceil(700 * 2.8)  # 1960


def test_estimate_absent_or_missing_is_none(tmp_path):
    assert estimate_vram_mib(None) is None
    assert estimate_vram_mib(tmp_path / "gone.gguf") is None


# ---- rerank_model 三态解析（env 档；文件档同一 opt 通道）----

def test_default_is_auto(monkeypatch, tmp_path):
    cfg = _cfg(monkeypatch, tmp_path, _ABSENT)
    assert cfg.rerank_auto is True
    assert cfg.rerank_model is None


def test_explicit_auto(monkeypatch, tmp_path):
    cfg = _cfg(monkeypatch, tmp_path, "auto")
    assert cfg.rerank_auto is True
    assert cfg.rerank_model is None


def test_empty_string_disables(monkeypatch, tmp_path):
    cfg = _cfg(monkeypatch, tmp_path, "")
    assert cfg.rerank_auto is False
    assert cfg.rerank_model is None


def test_path_forces_on(monkeypatch, tmp_path):
    cfg = _cfg(monkeypatch, tmp_path, "/x/r.gguf")
    assert cfg.rerank_auto is False
    assert cfg.rerank_model == Path("/x/r.gguf")
