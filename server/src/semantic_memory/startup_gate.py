"""分层严格启动契约（任务 9 / R2；CUDA/显存门 2026-11-09 追加）。

"已配置" = env 或 config.toml 任一（Config.from_env 已合并两档）。判定序：
① 非回环绑定且未配 token → 拒启 exit 2（M-1：README 契约 enforced——裸暴露读写/遗忘面；
   不受 allow_bm25_only 豁免：那只管模型档，不豁免网络面）；
② allow_bm25_only=true → 恒放行；
③ 嵌入已配置但文件缺失 → 拒启 exit 2（stderr 指明路径 + setup 修复提示）；
④ 蒸馏已配置但缺失 → 同拒；
⑤ 全未配置 → 招募模式放行 + INFO install_hint（BM25-only 合法）。

CUDA/显存门（check_gpu_gate，2026-11-09 产品裁定）：已配置嵌入器且 device=cuda 时，
无 CUDA 或空闲显存 < 嵌入器预估×1.2 → 拒启 exit 2；原因（需多少/剩多少）写入
discovery file 的 refused/reason 字段＋stdout/log 同因——插件/TUI 据此透出
「热记忆未启动：<原因>」。device=cpu 或未配置嵌入器（纯 BM25）无显存需求，恒放行。

拒启必须先于端口绑定（serve 前调用）；分层门禁热路径校验——只查文件在在与
nvidia-smi 探测，不加载模型（加载惰性且昂贵）。rerank 不入门：默认路径缺失=
优雅关闭是既有语义。check_startup/check_gpu_gate 均可独立单测。
"""
from __future__ import annotations

import ipaddress
import json
import logging
import shutil
import sys
import time

from .config import (Config, VRAM_MARGIN, estimate_vram_mib,
                     vram_need_mib)
from .paths import _pid_alive

log = logging.getLogger(__name__)

RECRUIT_HINT = (
    "招募模式：未配置任何模型，纯 BM25 运行（合法）。"
    "一键满配：semantic-memory setup"
)


def _is_loopback_bind(host: str) -> bool:
    """绑定地址是否回环：localhost / 127.0.0.0/8 / ::1；其余（含 0.0.0.0、
    hostname、LAN IP）按非回环处理——与 README "required when non-loopback" 同语义。
    """
    if host == "localhost":
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False  # 非 IP 字面量（hostname）按非回环从严


def check_startup(cfg: Config, *, err=sys.stderr) -> int:
    """启动门：返回 0=放行 / 2=拒启（exit 2 语义，消息已写入 err）。"""
    if cfg.token is None and not _is_loopback_bind(cfg.host):
        print(
            f"semantic-memory: 非回环绑定 {cfg.host} 且未设置 MEMORY_TOKEN——"
            f"REST 面将无鉴权暴露（读/写/单条遗忘）\n"
            f"修复：设置 MEMORY_TOKEN（或 config.toml token=），或改绑回环地址",
            file=err,
        )
        return 2
    if cfg.allow_bm25_only:
        return 0
    if cfg.model_path is not None and not cfg.model_path.is_file():
        print(
            f"semantic-memory: 配置的嵌入模型不存在: {cfg.model_path}\n"
            f"修复：semantic-memory setup --profile embed（或修正 MEMORY_MODEL_PATH/config.toml）",
            file=err,
        )
        return 2
    if cfg.distill_model is not None and not cfg.distill_model.is_file():
        print(
            f"semantic-memory: 配置的蒸馏模型不存在: {cfg.distill_model}\n"
            f"修复：semantic-memory setup --profile full（或修正 MEMORY_DISTILL_MODEL/config.toml）",
            file=err,
        )
        return 2
    if cfg.model_path is None and cfg.distill_model is None:
        log.info(RECRUIT_HINT)
    return 0


def check_gpu_gate(cfg: Config, *, err=sys.stderr, out=sys.stdout) -> int:
    """CUDA/显存启动门：返回 0=放行 / 2=拒启（原因已透出三面，见模块 docstring）。"""
    if cfg.device == "cpu" or cfg.model_path is None:
        return 0  # 无嵌入器（纯 BM25）或显式 CPU：无显存需求
    need_mib = vram_need_mib(estimate_vram_mib(cfg.model_path))
    if shutil.which("nvidia-smi") is None:
        return _refuse_startup(
            cfg, f"无 CUDA（未检测到 nvidia-smi/GPU）：嵌入模型需 ≥{need_mib}MiB 显存",
            err=err, out=out)
    from .embedder import _card_free_mib  # 惰性：探测面与 numpy/llama 依赖链解耦
    free_mib = _card_free_mib()
    if free_mib is None:
        return _refuse_startup(
            cfg, f"GPU 显存探测失败（nvidia-smi 异常）：嵌入模型需 ≥{need_mib}MiB 显存",
            err=err, out=out)
    if free_mib < need_mib:
        return _refuse_startup(
            cfg, f"空闲显存不足：嵌入模型需 ≥{need_mib}MiB（文件预估×{VRAM_MARGIN}），"
                 f"当前空闲 {free_mib}MiB",
            err=err, out=out)
    return 0


def _refuse_startup(cfg: Config, reason: str, *, err=sys.stderr, out=sys.stdout) -> int:
    """拒启三面透出：stderr＋stdout＋log 同因；discovery file 写 refused/reason。

    存活实例的发现文件不覆盖（二次 spawn 撞活服务时插件仍指活地址）。
    """
    msg = f"semantic-memory: 拒绝启动：{reason}"
    print(msg, file=err)
    print(msg, file=out, flush=True)  # agent 自举读 stdout，人工看终端
    log.error("%s", msg)
    f = cfg.discovery_file
    if f is not None and not _live_owner(f):
        try:
            f.parent.mkdir(parents=True, exist_ok=True)
            f.write_text(json.dumps(
                {"refused": True, "reason": reason, "checked_at": time.time()},
                ensure_ascii=False, indent=2), encoding="utf-8")
        except OSError as exc:
            log.warning("拒启原因写入 discovery file 失败（%s）: %s", f, exc)
    return 2


def _live_owner(f) -> bool:
    """发现文件里的 pid 存活 → 视为有活实例在场。"""
    try:
        pid = int(json.loads(f.read_text(encoding="utf-8"))["pid"])
    except (OSError, ValueError, KeyError, TypeError):
        return False
    return _pid_alive(pid)
