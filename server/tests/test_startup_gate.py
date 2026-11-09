"""分层严格启动契约测试（任务 9/R2）：门函数独立单测 + main() 接线。"""
import io
import json
import logging
import shutil
import sys
from dataclasses import replace

import pytest

from semantic_memory.config import Config
from semantic_memory.startup_gate import check_gpu_gate, check_startup


def clean_env(monkeypatch, tmp_path):
    """env 清场 + 数据目录隔离（config.toml 落点随 tmp）。"""
    for var in ("MEMORY_MODEL_PATH", "MEMORY_DISTILL_MODEL", "MEMORY_ALLOW_BM25_ONLY"):
        monkeypatch.delenv(var, raising=False)
    monkeypatch.setenv("MEMORY_DATA_DIR", str(tmp_path))
    return tmp_path


def gate(cfg: Config) -> tuple[int, str]:
    err = io.StringIO()
    return check_startup(cfg, err=err), err.getvalue()


# ---------------- 判定序（R2） ----------------

def test_allow_bm25_only_always_passes(tmp_path):
    code, err = gate(Config.from_env())  # 基线：无配置 → 放行（下方复用作对照）
    assert code == 0
    cfg = replace(Config.from_env(), allow_bm25_only=True,
                  model_path=tmp_path / "missing.gguf")  # 缺失也放行
    code, err = gate(cfg)
    assert code == 0 and err == ""


def test_env_configured_present_runs_as_usual(monkeypatch, tmp_path):
    clean_env(monkeypatch, tmp_path)
    model = tmp_path / "embed.gguf"
    model.write_bytes(b"gguf")
    monkeypatch.setenv("MEMORY_MODEL_PATH", str(model))
    code, err = gate(Config.from_env())
    assert code == 0 and err == ""


def test_env_configured_missing_refuses(monkeypatch, tmp_path):
    clean_env(monkeypatch, tmp_path)
    missing = tmp_path / "nope.gguf"
    monkeypatch.setenv("MEMORY_MODEL_PATH", str(missing))
    code, err = gate(Config.from_env())
    assert code == 2
    assert str(missing) in err                          # stderr 指明路径
    assert "semantic-memory setup --profile embed" in err  # 修复提示


def test_distill_configured_missing_refuses(monkeypatch, tmp_path):
    clean_env(monkeypatch, tmp_path)
    missing = tmp_path / "nope-distill.gguf"
    monkeypatch.setenv("MEMORY_DISTILL_MODEL", str(missing))
    code, err = gate(Config.from_env())
    assert code == 2
    assert str(missing) in err
    assert "semantic-memory setup --profile full" in err


def test_all_unconfigured_recruitment_mode(monkeypatch, tmp_path, caplog):
    clean_env(monkeypatch, tmp_path)
    with caplog.at_level(logging.INFO, logger="semantic_memory.startup_gate"):
        code, err = gate(Config.from_env())
    assert code == 0 and err == ""
    assert "招募模式" in caplog.text and "semantic-memory setup" in caplog.text


def test_config_file_counts_as_configured(monkeypatch, tmp_path):
    data_dir = clean_env(monkeypatch, tmp_path)
    (data_dir / "config.toml").write_text(
        f'model_path = "{tmp_path / "gone.gguf"}"\n', encoding="utf-8")
    code, err = gate(Config.from_env())
    assert code == 2 and "gone.gguf" in err              # 文件档已配置缺失同样拒启


def test_allow_bm25_only_via_env(monkeypatch, tmp_path):
    clean_env(monkeypatch, tmp_path)
    monkeypatch.setenv("MEMORY_MODEL_PATH", str(tmp_path / "missing.gguf"))
    monkeypatch.setenv("MEMORY_ALLOW_BM25_ONLY", "1")
    code, err = gate(Config.from_env())
    assert code == 0 and err == ""


def test_empty_env_means_disabled_not_configured(monkeypatch, tmp_path):
    clean_env(monkeypatch, tmp_path)
    monkeypatch.setenv("MEMORY_MODEL_PATH", "")          # 空串=显式禁用（既有语义）
    code, err = gate(Config.from_env())
    assert code == 0                                     # 未配置 → 招募放行


# ---------------- main() 接线：拒启先于端口绑定 ----------------

def test_main_refuses_before_serve(monkeypatch, tmp_path):
    from semantic_memory import server

    bad = replace(server.cfg, model_path=tmp_path / "missing.gguf",
                  distill_model=None, allow_bm25_only=False)
    monkeypatch.setattr(server, "cfg", bad)

    def must_not_bind(*a, **kw):
        raise AssertionError("拒启后不得绑定端口/进入 serve")

    monkeypatch.setattr(server, "serve", must_not_bind)
    monkeypatch.setattr(sys, "argv", ["semantic-memory"])
    with pytest.raises(SystemExit) as exc:
        server.main()
    assert exc.value.code == 2


def test_main_recruitment_reaches_serve(monkeypatch, tmp_path):
    from semantic_memory import server

    ok = replace(server.cfg, model_path=None, distill_model=None,
                 allow_bm25_only=False, maintenance_on_start=False)
    monkeypatch.setattr(server, "cfg", ok)
    monkeypatch.setattr(server, "serve", lambda: None)   # 起服被替换为无操作标记
    monkeypatch.setattr(sys, "argv", ["semantic-memory"])
    server.main()                                        # 不抛 SystemExit 即放行


# ---------------- 绑定安全门（M-1，2026-10-17 用户确认修） ----------------
# README 契约：非回环绑定必须配 MEMORY_TOKEN；此前仅告警不拒启（R2 安全发现）

def test_nonloopback_bind_without_token_refuses(monkeypatch, tmp_path):
    clean_env(monkeypatch, tmp_path)
    cfg = replace(Config.from_env(), host="0.0.0.0", token=None)
    code, err = gate(cfg)
    assert code == 2 and "MEMORY_TOKEN" in err


def test_nonloopback_bind_with_token_passes(monkeypatch, tmp_path):
    clean_env(monkeypatch, tmp_path)
    cfg = replace(Config.from_env(), host="0.0.0.0", token="secret")
    code, err = gate(cfg)
    assert code == 0 and err == ""


@pytest.mark.parametrize("host", ["127.0.0.1", "localhost", "::1", "127.3.2.1"])
def test_loopback_bind_variants_without_token_pass(monkeypatch, tmp_path, host):
    clean_env(monkeypatch, tmp_path)
    cfg = replace(Config.from_env(), host=host, token=None)
    code, err = gate(cfg)
    assert code == 0 and err == ""


def test_bind_gate_not_bypassed_by_allow_bm25_only(monkeypatch, tmp_path):
    """allow_bm25_only 只管模型档，不豁免网络暴露面。"""
    clean_env(monkeypatch, tmp_path)
    cfg = replace(Config.from_env(), host="192.168.1.10", token=None,
                  allow_bm25_only=True)
    code, err = gate(cfg)
    assert code == 2 and "MEMORY_TOKEN" in err


# ---------------- CUDA/显存启动门（2026-11-09 裁定：无 CUDA/装不下 → 拒启＋原因透出） ----------------

def gpu_gate(cfg: Config) -> tuple[int, str, str]:
    """check_gpu_gate 薄封装：捕获 stderr/stdout 与返回码。"""
    err, out = io.StringIO(), io.StringIO()
    return check_gpu_gate(cfg, err=err, out=out), err.getvalue(), out.getvalue()


def embed_cfg(tmp_path, size_mib=700):
    """已配置且存在的嵌入模型（稀疏文件）→ 门进入显存判定。

    discovery_file 显式钉到 tmp：全量套件里 test_eval/test_telemetry 模块导入时
    持久设 MEMORY_DB_PATH，from_env 推导的 discovery 会漂出 tmp（隔离教训）。
    """
    p = tmp_path / "embed.gguf"
    with open(p, "wb") as f:
        f.truncate(size_mib * 2**20)
    return replace(Config.from_env(), model_path=p, distill_model=None,
                   discovery_file=tmp_path / "data" / "memory.db.server.json")


def fake_nvidia_smi(monkeypatch):
    """伪造 nvidia-smi 在场（探测本身由 mock _card_free_mib 承担，禁真卡）。"""
    real = shutil.which
    monkeypatch.setattr(shutil, "which",
                        lambda name: "/usr/bin/nvidia-smi" if name == "nvidia-smi" else real(name))


def test_gpu_gate_no_cuda_refuses_and_writes_discovery(monkeypatch, tmp_path):
    clean_env(monkeypatch, tmp_path)
    monkeypatch.setattr(shutil, "which", lambda name: None)  # 无 nvidia-smi
    code, err, out = gpu_gate(embed_cfg(tmp_path))
    assert code == 2
    assert "无 CUDA" in err and err == out                    # stderr/stdout 同因
    disc = tmp_path / "data" / "memory.db.server.json"
    info = json.loads(disc.read_text(encoding="utf-8"))
    assert info["refused"] is True and "无 CUDA" in info["reason"]


def test_gpu_gate_insufficient_vram_refuses_with_digits(monkeypatch, tmp_path):
    import semantic_memory.embedder as emb
    clean_env(monkeypatch, tmp_path)
    fake_nvidia_smi(monkeypatch)
    monkeypatch.setattr(emb, "_card_free_mib", lambda: 1000)
    code, err, out = gpu_gate(embed_cfg(tmp_path))           # 700MiB → 需 ceil(1960×1.2)=2352
    assert code == 2
    assert "2352" in err and "1000" in err and err == out    # 需多少/剩多少
    info = json.loads((tmp_path / "data" / "memory.db.server.json").read_text(encoding="utf-8"))
    assert info["refused"] is True and "2352" in info["reason"] and "1000" in info["reason"]


def test_gpu_gate_sufficient_vram_passes(monkeypatch, tmp_path):
    import semantic_memory.embedder as emb
    clean_env(monkeypatch, tmp_path)
    fake_nvidia_smi(monkeypatch)
    monkeypatch.setattr(emb, "_card_free_mib", lambda: 2400)  # ≥ 2352
    code, err, out = gpu_gate(embed_cfg(tmp_path))
    assert code == 0 and err == "" and out == ""
    assert not (tmp_path / "data" / "memory.db.server.json").exists()  # 放行不写盘


def test_gpu_gate_device_cpu_exempt(monkeypatch, tmp_path):
    clean_env(monkeypatch, tmp_path)
    monkeypatch.setattr(shutil, "which", lambda name: None)
    code, _, _ = gpu_gate(replace(embed_cfg(tmp_path), device="cpu"))
    assert code == 0


def test_gpu_gate_bm25_only_exempt(monkeypatch, tmp_path):
    clean_env(monkeypatch, tmp_path)
    monkeypatch.setattr(shutil, "which", lambda name: None)  # 无 GPU 也不拦纯 BM25
    code, _, _ = gpu_gate(replace(Config.from_env(), model_path=None, distill_model=None))
    assert code == 0


def test_refusal_does_not_clobber_live_instance(monkeypatch, tmp_path):
    """存活实例的发现文件不得被拒启信息覆盖（插件仍指活服务）。"""
    import semantic_memory.embedder as emb
    import semantic_memory.startup_gate as sg
    clean_env(monkeypatch, tmp_path)
    fake_nvidia_smi(monkeypatch)
    monkeypatch.setattr(emb, "_card_free_mib", lambda: 0)
    monkeypatch.setattr(sg, "_pid_alive", lambda pid: True)
    disc = tmp_path / "data"
    disc.mkdir(parents=True)
    f = disc / "memory.db.server.json"
    f.write_text(json.dumps({"pid": 12345, "url": "http://x:1"}), encoding="utf-8")
    code, _, _ = gpu_gate(embed_cfg(tmp_path))
    assert code == 2
    assert json.loads(f.read_text(encoding="utf-8"))["url"] == "http://x:1"  # 原样保留


def test_refusal_overwrites_stale_discovery(monkeypatch, tmp_path):
    """死 pid 的陈旧发现文件 → 覆写为拒启信息（pid=0 视为不存活）。"""
    import semantic_memory.embedder as emb
    clean_env(monkeypatch, tmp_path)
    fake_nvidia_smi(monkeypatch)
    monkeypatch.setattr(emb, "_card_free_mib", lambda: 0)
    disc = tmp_path / "data"
    disc.mkdir(parents=True)
    f = disc / "memory.db.server.json"
    f.write_text(json.dumps({"pid": 0, "url": "http://stale"}), encoding="utf-8")
    code, _, _ = gpu_gate(embed_cfg(tmp_path))
    assert code == 2
    info = json.loads(f.read_text(encoding="utf-8"))
    assert info["refused"] is True and "url" not in info


def test_main_gpu_gate_refuses_before_serve(monkeypatch, tmp_path):
    from semantic_memory import server

    p = tmp_path / "embed.gguf"
    with open(p, "wb") as f:
        f.truncate(2**20)
    monkeypatch.setattr(shutil, "which", lambda name: None)  # 无 CUDA
    bad = replace(server.cfg, model_path=p, distill_model=None,
                  allow_bm25_only=False, discovery_file=tmp_path / "d.json")
    monkeypatch.setattr(server, "cfg", bad)

    def must_not_bind(*a, **kw):
        raise AssertionError("拒启后不得绑定端口/进入 serve")

    monkeypatch.setattr(server, "serve", must_not_bind)
    monkeypatch.setattr(sys, "argv", ["semantic-memory"])
    with pytest.raises(SystemExit) as exc:
        server.main()
    assert exc.value.code == 2
    assert json.loads((tmp_path / "d.json").read_text(encoding="utf-8"))["refused"] is True
