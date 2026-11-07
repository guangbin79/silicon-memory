"""noise_prefixes 泛化缝（决策 11：私有语义→配置项；公开默认空表=惰性）。

1. 默认 ()：[agora] 前缀内容不再命中噪声/弱信号/凭据（公开用户无 agora）
2. 注入 ("[agora]",)：旧行为逐字保留（24 条既有噪声测试经同缝注入）
3. 配置面：env 逗号分隔 / config.toml 列表 → Config.noise_prefixes
"""
import pytest

from semantic_memory import noise
from semantic_memory.config import Config


@pytest.fixture
def agora_prefixes():
    noise.set_noise_prefixes(("[agora]",))
    yield
    noise.set_noise_prefixes(())


def test_default_prefixes_inert():
    noise.set_noise_prefixes(())
    assert noise.is_task_event_noise("[agora] task ag-1 note from ses_y") is False


def test_prefixes_activate_task_echo(agora_prefixes):
    body = "[agora] task ag-1 note from ses_y\npage: /x.md\nenv: prod"
    assert noise.is_task_event_noise(body) is True


def test_prefixes_activate_credential(agora_prefixes):
    cred = "[agora] credential ag-x\ntoken: " + "a" * 64
    assert noise.is_task_event_noise(cred) is True


def test_general_credential_still_live_without_prefixes():
    noise.set_noise_prefixes(())
    assert noise.is_task_event_noise("pypi-AgEI" + "b" * 40) is True


def test_config_parse_env(monkeypatch):
    monkeypatch.setenv("MEMORY_NOISE_PREFIXES", "[agora],<noisifier>")
    cfg = Config.from_env()
    assert cfg.noise_prefixes == ("[agora]", "<noisifier>")


def test_config_parse_toml(monkeypatch, tmp_path):
    monkeypatch.delenv("MEMORY_NOISE_PREFIXES", raising=False)
    (tmp_path / "config.toml").write_text('noise_prefixes = ["[agora]"]\n', encoding="utf-8")
    import semantic_memory.config as c
    cfg_file = c.load_config_file(tmp_path / "config.toml")
    assert cfg_file.get("noise_prefixes") == ["[agora]"]


def test_lifecycle_weak_signals_prefix_driven(agora_prefixes):
    from semantic_memory.lifecycle import _weak_signals
    sigs = _weak_signals("[agora] task ag-1 note\n" + "a" * 40 + " done")
    assert any("前缀" in s for s in sigs)
