"""distill_model=auto（缺省）：按整卡总显存选 1.7B/4B（2026-11-17）。

策略：>6GiB → Qwen3-4B-Instruct-2507；≤6GiB → Qwen3-1.7B；cpu/探测失败 → 关。
用总显存（卡级稳定属性），不用空闲显存（随瞬时占用翻转）——
与 rerank auto 的「空闲显存启停判据」语义互补。
"""
from pathlib import Path

from semantic_memory.config import (
    Config,
    auto_distill_model_name,
    DISTILL_LARGE_GGUF_NAME,
    DISTILL_SMALL_GGUF_NAME,
)

_ABSENT = object()


def _cfg(monkeypatch, tmp_path, distill_env):
    monkeypatch.setenv("MEMORY_DATA_DIR", str(tmp_path))
    if distill_env is _ABSENT:
        monkeypatch.delenv("MEMORY_DISTILL_MODEL", raising=False)
    else:
        monkeypatch.setenv("MEMORY_DISTILL_MODEL", distill_env)
    return Config.from_env()


# ---- auto 选型纯函数 ----

def test_auto_large_card_picks_4b():
    assert auto_distill_model_name(8192, "cuda") == DISTILL_LARGE_GGUF_NAME


def test_auto_boundary_6gib():
    assert auto_distill_model_name(6144, "cuda") == DISTILL_SMALL_GGUF_NAME
    assert auto_distill_model_name(6145, "cuda") == DISTILL_LARGE_GGUF_NAME


def test_auto_small_card_picks_17b():
    assert auto_distill_model_name(4096, "cuda") == DISTILL_SMALL_GGUF_NAME


def test_auto_cpu_or_probe_failure_off():
    assert auto_distill_model_name(None, "cuda") is None
    assert auto_distill_model_name(8192, "cpu") is None


# ---- 配置三态 ----

def test_unset_defaults_to_auto(monkeypatch, tmp_path):
    cfg = _cfg(monkeypatch, tmp_path, _ABSENT)
    assert cfg.distill_auto is True
    assert cfg.distill_model is None


def test_explicit_auto_word(monkeypatch, tmp_path):
    cfg = _cfg(monkeypatch, tmp_path, " Auto ")
    assert cfg.distill_auto is True
    assert cfg.distill_model is None


def test_empty_disables(monkeypatch, tmp_path):
    cfg = _cfg(monkeypatch, tmp_path, "")
    assert cfg.distill_auto is False
    assert cfg.distill_model is None


def test_explicit_path_wins(monkeypatch, tmp_path):
    cfg = _cfg(monkeypatch, tmp_path, "/tmp/x.gguf")
    assert cfg.distill_auto is False
    assert cfg.distill_model == Path("/tmp/x.gguf")
