"""Qwen3-1.7B 非思考蒸馏器：把压缩丢弃的原文消化成 typed 记忆条目。

Qwen3 官方 chat 模板的非思考形态：<|im_start|> system/user/assistant，
助手侧无 <think> 引导；要求模型只输出 JSON 数组
[{content, kind∈fact|decision|preference|artifact, scope∈project|global,
rationale, tags}]——模型只管蒸馏本身（dream 设计 2026-11-26：带邻居取代
裁决收归应用侧机械判定，提示词与输出契约不再含 supersedes；模型若自作
主张输出该字段一律剥离）。解析容错（截取首 [ 至末 ]，兼容 markdown 围栏与
前后闲话），解析失败返回 None（fail-open，调用方原文直存）；
decision/preference 缺 rationale 降级 kind=fact 并 WARN。

加载生命周期与 reranker.py 同规格：懒加载（经 ModelSlot，与 Reranker
分时互斥）、cuda 默认 → 探针补全 → nvidia-smi PID 校验（识别静默 CPU
回退）→ 失败重建 CPU；运行期 GPU 推理失败（如 OOM）重建 CPU 重试一次。
设备策略沿用 MEMORY_DEVICE（cuda 默认/cpu 可选）。MEMORY_DISTILL_MODEL
空 = 蒸馏关闭。
"""
from __future__ import annotations

import json
import logging
import os
from pathlib import Path
from typing import Any, Final

from . import gpu_breaker


from .embedder import _pid_vram_on_gpu, _preload_cuda_libs
from .modelslot import ModelSlot

log = logging.getLogger("semantic_memory.distiller")

DISTILL_N_CTX: Final = 4096   # 6GB 卡显存适配（2026-10-21）：Q4 权重 1.05G＋KV 4096 ≈ 2.1G < 空闲 2.7G；输入截 2000 字符
MAX_NEW_TOKENS: Final = 1024  # 一批 ≤20 条的 JSON 数组输出预算
MAX_BATCH_TEXTS: Final = 5  # 5 条 × ~93 tok ≈ 470 ≪ MAX_NEW_TOKENS=1024；2026-11-16 大组 length 截断死循环事故
# gt-e696（2026-10-23 "4356≥4096" 全局熔断）：MEMORIES 近邻段曾无界拼接在批原文截断点
# 之后，积压批数十条近邻（每条 ≤2000 字符全文）撑爆 n_ctx。预算算术：
# 2000（批原文）＋~450（模板/指令/system，含 2026-10-26 判据门＋负例）≈ 2450 tok < 4096。
# （近邻段已随 2026-11-26 dream 改制移除——预算算术保留为输入上界回归锚。）
MAX_INPUT_CHARS: Final = 2000  # 批原文截断（与 n_ctx 4096 配套，中文 ~1 token/字）
IM_END: Final = "<|im_end|>"
VALID_KINDS: Final = ("fact", "decision", "preference", "artifact")
VALID_SCOPES: Final = ("project", "global")
SYSTEM_PROMPT: Final = (
    "You extract durable memories from raw conversation text. Respond with "
    "ONLY a JSON array - no markdown fences, no commentary. Each element has "
    'keys "content" (concise self-contained memory), "kind" (one of "fact", '
    '"decision", "preference", "artifact"), "scope" ("project" or "global"), '
    '"rationale" (why it matters; REQUIRED when kind is decision or '
    'preference), "tags" (short keywords). Use scope "project" for '
    'project-specific knowledge and "global" for universally applicable '
    "knowledge. Keep only durable knowledge: a bug with its root cause or "
    "fix, a weighed decision with its rationale, or a reusable pitfall. "
    "Never output session meta-instructions addressed to the assistant "
    '(e.g. "ignore the injected memories", "continue the setup task"), '
    "transient bookkeeping (environment setup, todo or status notes), or "
    "harness banners. Output [] when nothing is worth remembering."
)


def format_prompt(
    texts: list[str],
    project: str,
) -> str:
    """Qwen3 非思考 chat 模板；助手侧无 <think> 引导。

    模型只管蒸馏本身（dream 设计 2026-11-26）：不再附带带邻居上下文与
    supersedes 输出契约——取代判定收归 flush 应用侧（cos∈[pair_sim,NEAR_HI)
    自动新取旧，见 lifecycle._band_neighbors）。
    """
    joined = "\n---\n".join(texts)[:MAX_INPUT_CHARS]
    user = f"Project: {project}\n<<<TEXT>>>\n{joined}\n<<<END>>>"
    return (
        "<|im_start|>system\n"
        + SYSTEM_PROMPT
        + IM_END
        + "\n<|im_start|>user\n"
        + user
        + IM_END
        + "\n<|im_start|>assistant\n"
    )


def _normalize(entry: Any) -> dict | None:
    """边界归一化：非字典/空 content 丢弃；越界 kind/scope 收敛到合法词表。"""
    if not isinstance(entry, dict):
        return None
    content = entry.get("content")
    if not isinstance(content, str) or not content.strip():
        return None
    kind = entry.get("kind")
    rationale = entry.get("rationale")
    if kind not in VALID_KINDS:
        kind = "fact"
    if kind in ("decision", "preference") and not (
        isinstance(rationale, str) and rationale.strip()
    ):
        log.warning("decision/preference 条目缺 rationale，降级为 kind=fact")
        kind = "fact"
    scope = entry.get("scope")
    if scope not in VALID_SCOPES:
        scope = "project"
    tags = entry.get("tags")
    out = {
        "content": content,
        "kind": kind,
        "scope": scope,
        "rationale": rationale if isinstance(rationale, str) else "",
        "tags": [t for t in tags if isinstance(t, str)] if isinstance(tags, list) else [],
    }
    # supersedes 契约已移除（dream 设计 2026-11-26）：模型只管蒸馏本身，
    # 自作主张输出的 supersedes 一律剥离——取代判定在 flush 应用侧（机械）。
    return out


def _parse(raw: str) -> list[dict] | None:
    """容错解析：截取首 [ 至末 ]（兼容围栏/闲话）；失败 None。

    抢救（2026-11-16 length 截断事故）：无 ] 或 loads 失败（末对象残缺）时，
    从首个 [ 后 raw_decode 逐个收完整顶层对象；0 个完整对象仍 None。"""
    start, end = raw.find("["), raw.rfind("]")
    if start == -1:
        return None  # 无 '['：纯 prose/空围栏，无抢救面
    if end > start:
        try:
            data = json.loads(raw[start : end + 1])
        except json.JSONDecodeError:
            data = None
        if isinstance(data, list):
            return [e for e in (_normalize(x) for x in data) if e is not None]
    dec, salvaged, i = json.JSONDecoder(), [], start + 1
    while i < len(raw):
        while i < len(raw) and raw[i] in " \t\r\n,":  # 跳过空白与逗号找 '{'
            i += 1
        if i >= len(raw) or raw[i] != "{":
            break
        try:
            obj, i = dec.raw_decode(raw, i)
            salvaged.append(obj)
        except json.JSONDecodeError:
            break  # 首个残缺对象即截断点，抢救结束
    return [e for e in map(_normalize, salvaged) if e is not None] or None


class DistillParseError(Exception):
    """裁判输出无法解析为条目数组——输出抖动而非硬件损坏（禁触发全局熔断）。"""


class _GpuInferenceError(Exception):
    """GPU 推理失败（触发 CPU 重建、整次调用重试一次）。"""


class Distiller:
    """惰性加载。available=False 时调用方跳过蒸馏（原文直存）。"""

    def __init__(
        self,
        model_path: Path | None,
        device: str = "cuda",
        slot: ModelSlot | None = None,
    ):
        self.prefer = device          # 用户意图：cuda|cpu
        self.device: str | None = None  # 实际运行设备：cuda|cpu|None
        self._slot = slot if slot is not None else ModelSlot()
        self._gguf_path = Path(model_path) if model_path else None
        self._force_cpu = False       # 运行期 GPU 推理失败后置位（OOM 重建路径）
        self.available = False
        if self._gguf_path is None:
            log.info("MEMORY_DISTILL_MODEL 未设置，蒸馏关闭（原文直存）")
        elif not self._gguf_path.exists():
            log.warning("蒸馏模型文件不存在: %s，蒸馏关闭", self._gguf_path)
        else:
            self.available = True  # 惰性：首次 distill 才经槽加载

    def is_available(self) -> bool:
        return self.available

    @property
    def configured(self) -> bool:
        """是否配置了裁判模型（路径级；与加载可用性无关——用于区分未配置与暂不可用）。"""
        return self._gguf_path is not None

    # ---------- 加载与回退（镜像 reranker.py 的链路） ----------

    def _new_model(self, use_gpu: bool) -> Any:
        import llama_cpp  # 延迟导入：非蒸馏路径不付 CUDA dlopen 成本

        return llama_cpp.Llama(
            model_path=str(self._gguf_path),
            embedding=False,
            n_gpu_layers=-1 if use_gpu else 0,
            n_ctx=DISTILL_N_CTX,
            verbose=False,
        )

    @staticmethod
    def _probe(model: Any) -> None:
        model.create_completion("device probe", max_tokens=1)

    def _load(self) -> Any:
        """槽加载器：GPU 尝试 → 探针补全 → nvidia-smi PID 校验 → 失败重建 CPU。"""
        if self._force_cpu or self.prefer == "cpu":
            model = self._new_model(False)
            self._probe(model)
            self.device = "cpu"
            return model
        _preload_cuda_libs()
        try:
            model = self._new_model(True)
            self._probe(model)
            vram = _pid_vram_on_gpu(os.getpid())
            if vram is None:
                raise RuntimeError(
                    "CUDA 会话已建立但 nvidia-smi 无此 pid 显存——"
                    "判定为静默 CPU 回退，拒绝声称 GPU"
                )
            self.device = "cuda"
            log.info("蒸馏器运行于 GPU: pid=%s vram=%s", os.getpid(), vram)
            return model
        except Exception as exc:
            log.warning("GPU 初始化失败（%s: %s）——回退 CPU 蒸馏器",
                        type(exc).__name__, exc)
            model = self._new_model(False)
            self._probe(model)
            self.device = "cpu"
            return model

    # ---------- 蒸馏 ----------

    def _generate(
        self, model: Any, texts: list[str], project: str,
    ) -> str:
        try:
            # INFER_LOCK：跨模型 GPU 推理全局互斥（同 gpu_breaker.INFER_LOCK 注释）
            with gpu_breaker.INFER_LOCK:
                resp = model.create_completion(
                    format_prompt(texts, project),
                    max_tokens=MAX_NEW_TOKENS,
                    temperature=0.1,
                    stop=[IM_END],
                )
        except Exception as exc:
            if self.device != "cuda":
                raise
            raise _GpuInferenceError(str(exc)) from exc
        try:
            return resp["choices"][0]["text"]
        except (KeyError, IndexError, TypeError) as exc:
            raise ValueError("completion 响应缺 text") from exc

    def distill(
        self, texts: list[str], project: str,
    ) -> list[dict] | None:
        """一批原文 → typed 条目数组；大组按 MAX_BATCH_TEXTS 分块防输出截断。

        任一块硬件类失败 → 整体 None；任一块解析抖动 → DistillParseError 照抛
        （整组留 pending）；全部块 [] → []。"""
        if not self.available or not texts:
            return None
        merged: list[dict] = []
        for i in range(0, len(texts), MAX_BATCH_TEXTS):
            entries = self._distill_group(
                texts[i : i + MAX_BATCH_TEXTS], project
            )
            if entries is None:
                return None
            merged.extend(entries)
        return merged

    def _distill_group(
        self, texts: list[str], project: str,
    ) -> list[dict] | None:
        """单块蒸馏（≤MAX_BATCH_TEXTS 条）：输出预算内的原子调用单元。

        硬件类失败（加载失败等）→ None（调用方据 configured 熔断）；
        解析抖动（输出无 JSON 数组）→ DistillParseError（调用方 fail-closed
        留 pending，不熔断——2026-10-22 实证一次抖动曾 trip 全局 16h）。
        """
        if not self.available or not texts:
            return None
        for _attempt in range(2):  # 第二轮仅用于 GPU 推理失败后的 CPU 重建重试
            try:
                model = self._slot.acquire("distill", self._load)
            except Exception as exc:
                log.warning("蒸馏模型加载失败（%s: %s）", type(exc).__name__, exc)
                return None
            try:
                entries = _parse(self._generate(model, texts, project))
                if entries is None:
                    raise DistillParseError("输出不含可解析的 JSON 数组")
                return entries
            except _GpuInferenceError as exc:
                # CUDA 熔断：损坏模型禁入 GC（free 即 abort，2026-10-21 实证
                # evict 解引用后的任意 GC 时刻延迟引爆）——墓场保活＋熔断，
                # 第二轮 CPU 重建重试一次（designed 降级链保留）
                gpu_breaker.quarantine(model)
                gpu_breaker.trip(f"distill CUDA error: {exc}")
                self._force_cpu = True
                log.warning("GPU 蒸馏失败（%s）——熔断＋CPU 重建重试", exc)
                self._slot.evict("distill")  # 解引用损坏的 GPU 槽模型（不销毁）
            except DistillParseError:
                raise  # 输出抖动≠硬件损坏：fail-closed 留 pending，禁 trip 全局熔断
            except Exception as exc:
                log.warning("蒸馏失败（%s: %s）——原文转直存", type(exc).__name__, exc)
                return None
            finally:
                self._slot.release()
        return None
