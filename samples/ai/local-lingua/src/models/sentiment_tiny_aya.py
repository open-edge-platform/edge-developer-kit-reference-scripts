"""
LLM-based sentiment analysis using CohereLabs/tiny-aya-global via raw OpenVINO.

optimum-intel has no OpenVINO export config registered for the `cohere2`
architecture (checked directly against `TasksManager` — not just docs), so
there's no `OVModelForCausalLM.from_pretrained(..., export=True)` path. Instead
this uses the community ONNX export (onnx-community/tiny-aya-global-ONNX),
specifically the plain `model_fp16.onnx` (~6.8GB) — the quantized/q4 variants
use onnxruntime's `GatherBlockQuantized` op for the (huge, 262144-token)
embedding table, which OpenVINO's ONNX frontend can't convert.

The fp16 graph is shrunk to ~2.2GB with NNCF's `compress_weights()` (INT4),
applied directly to the in-memory `ov.Model` — independent of optimum-intel's
export machinery, so the missing `cohere2` TasksManager entry doesn't matter
here. That compressed model can *never* be saved to OpenVINO IR and reloaded,
though: the graph uses onnxruntime's fused `GroupQueryAttention` op, and
OpenVINO's XML serializer writes it as an "extension" opset entry that the
deserializer can't reconstruct on reload ("Cannot create GroupQueryAttention
layer ... unsupported opset: extension") — the same bug hit in
transcriber_cohere_asr.py's decoder. So the ONNX -> patch -> compress pipeline
below runs fresh every time this wrapper loads (~10-15s), and
`OVModelForCausalLM` is constructed directly from the in-memory compressed
model rather than via `from_pretrained()`'s file-based loader, which would hit
the same reload bug.
"""

import json
import logging
import re
import time
from typing import Any, Dict

import yaml

from src.models.base import SentimentBase, ROOT_DIR

logger = logging.getLogger(__name__)

CONFIG_PATH = ROOT_DIR / "config.yaml"

_ONNX_FILENAME = "model_fp16.onnx"
_MAX_NEW_TOKENS = 300

_SENTIMENT_PROMPT_TEMPLATE = """Analyze the sentiment and emotional tone of the text below. Respond with ONLY a single JSON object and nothing else — no markdown, no explanation outside the JSON.

JSON schema:
{{
  "sentiment": "positive" | "neutral" | "negative",
  "confidence": <float 0.0-1.0>,
  "topEmotion": "<single emotion word, e.g. joy, anger, sadness, fear, surprise, disgust, neutral>",
  "topEmotionScore": <float 0.0-1.0>,
  "emotions": {{"<emotion word>": <float 0.0-1.0>, "<another emotion word>": <float 0.0-1.0>}},
  "detailedReport": "<1-2 sentence natural-language analysis of the tone>"
}}

Text to analyze:
\"\"\"{text}\"\"\"
"""

_JSON_OBJECT_RE = re.compile(r"\{.*\}", re.DOTALL)


def _load_config():
    try:
        with open(CONFIG_PATH) as f:
            return yaml.safe_load(f)
    except FileNotFoundError:
        return {}


class TinyAyaSentimentAnalyzer(SentimentBase):
    """Sentiment analysis by prompting CohereLabs/tiny-aya-global for structured JSON.

    Unlike SentimentAnalyzer's fixed-label classifier, this analyzes the whole
    text in one pass (no chunking) and lets the model reason about tone in its
    own words. `analyze()` still returns the exact same dict shape
    (label/score/topEmotion/topEmotionScore/allEmotions/chunkCount/
    analyzedTokens/peak, per SentimentAnalyzer.analyze) plus an extra
    `detailedReport` key, so this slots into the existing `sentiment` stage,
    API route, and history UI unchanged.
    """

    def __init__(self, device: str = "GPU", config: dict = None) -> None:
        super().__init__(device=device, config=config)
        self._config = config or _load_config()
        self._loaded = False

        model_cfg = self._config.get("models", {}).get("sentiment", {})
        export_dir = ROOT_DIR / model_cfg.get("export_dir", "models/tiny-aya-global")
        self._export_dir = export_dir

        ov_device = device.upper()
        self.device = ov_device

        onnx_path = export_dir / _ONNX_FILENAME
        if not onnx_path.exists():
            raise FileNotFoundError(
                f"Tiny Aya artifact missing: {onnx_path}. "
                f"Download the model first (Settings > Sentiment > Download)."
            )

        import openvino as ov
        import nncf
        from optimum.intel import OVModelForCausalLM
        from transformers import AutoTokenizer, AutoConfig, GenerationConfig

        logger.info("Loading Tiny Aya sentiment model on %s (export_dir=%s)", ov_device, export_dir)

        t0 = time.perf_counter()
        core = ov.Core()
        raw_model = core.read_model(str(onnx_path))
        self._patch_null_nodes(raw_model)
        compressed = nncf.compress_weights(
            raw_model, mode=nncf.CompressWeightsMode.INT4_SYM, ratio=1.0, group_size=64,
        )
        logger.debug("Tiny Aya ONNX->INT4 conversion took %.1fs", time.perf_counter() - t0)

        hf_config = AutoConfig.from_pretrained(str(export_dir))
        gen_config = GenerationConfig.from_pretrained(str(export_dir))
        self._tokenizer = AutoTokenizer.from_pretrained(str(export_dir))

        try:
            self._model = OVModelForCausalLM(
                compressed, config=hf_config, generation_config=gen_config, device=ov_device,
            )
        except Exception as e:
            if ov_device != "CPU":
                logger.warning("Failed to load Tiny Aya on %s (%s), falling back to CPU", ov_device, e)
                self.device = "CPU"
                self._model = OVModelForCausalLM(
                    compressed, config=hf_config, generation_config=gen_config, device="CPU",
                )
            else:
                raise

        self._loaded = True
        logger.info("Tiny Aya sentiment model loaded on %s", self.device)

    @staticmethod
    def _patch_null_nodes(model) -> None:
        """Replace unused-optional-input placeholders with concrete constants.

        The ONNX export's fused GroupQueryAttention ops have optional rotary
        cos/sin-cache inputs this model doesn't use (rotary is computed outside
        the op); OpenVINO's ONNX frontend represents each as a `NullNode` with
        `dynamic` element type, which NNCF's graph builder rejects ("NNCF is
        not yet supported OpenVINO data type: dynamic"). They're dead inputs,
        so an empty f16 constant is a safe, semantically equivalent stand-in.
        """
        import openvino as ov
        ops = ov.opset13
        for op in model.get_ops():
            if op.get_type_name() == "NullNode":
                replacement = ops.constant([], dtype=ov.Type.f16)
                op.output(0).replace(replacement.output(0))

    def is_loaded(self) -> bool:
        return self._loaded

    def analyze(self, text: str) -> Dict[str, Any]:
        start = time.perf_counter()
        text = text or ""

        prompt = _SENTIMENT_PROMPT_TEMPLATE.format(text=text)
        messages = [{"role": "user", "content": prompt}]
        chat_prompt = self._tokenizer.apply_chat_template(
            messages, tokenize=False, add_generation_prompt=True,
        )
        inputs = self._tokenizer(chat_prompt, return_tensors="pt")

        output = self._model.generate(**inputs, max_new_tokens=_MAX_NEW_TOKENS, do_sample=False)
        new_tokens = output[0][inputs["input_ids"].shape[1]:]
        raw_response = self._tokenizer.decode(new_tokens, skip_special_tokens=True)

        result = self._parse_response(raw_response, text)

        elapsed = time.perf_counter() - start
        logger.debug(
            "Tiny Aya sentiment [device=%s] took %.3fs: '%s' -> %s (%.2f)",
            self.device, elapsed, text[:50], result["label"], result["score"],
        )
        return result

    def _parse_response(self, raw_response: str, original_text: str) -> Dict[str, Any]:
        analyzed_tokens = len(self._tokenizer.encode(original_text, add_special_tokens=False))

        parsed = None
        try:
            parsed = json.loads(raw_response.strip())
        except (json.JSONDecodeError, ValueError):
            cleaned = raw_response.strip()
            if cleaned.startswith("```"):
                cleaned = cleaned.strip("`")
                cleaned = cleaned[cleaned.find("\n") + 1:] if "\n" in cleaned else cleaned
            match = _JSON_OBJECT_RE.search(cleaned)
            if match:
                try:
                    parsed = json.loads(match.group(0))
                except (json.JSONDecodeError, ValueError):
                    parsed = None

        if not isinstance(parsed, dict):
            logger.warning(
                "Tiny Aya returned non-JSON response, falling back to neutral: %r", raw_response[:200],
            )
            return {
                "label": "NEUTRAL",
                "score": 0.5,
                "topEmotion": "neutral",
                "topEmotionScore": 0.5,
                "allEmotions": {},
                "chunkCount": 1,
                "analyzedTokens": analyzed_tokens,
                "peak": None,
                "detailedReport": raw_response.strip()[:500],
            }

        sentiment = str(parsed.get("sentiment", "neutral")).upper()
        if sentiment not in ("POSITIVE", "NEUTRAL", "NEGATIVE"):
            sentiment = "NEUTRAL"

        try:
            confidence = max(0.0, min(1.0, float(parsed.get("confidence", 0.5))))
        except (TypeError, ValueError):
            confidence = 0.5

        emotions = parsed.get("emotions", {})
        clean_emotions: Dict[str, float] = {}
        if isinstance(emotions, dict):
            for label, score in emotions.items():
                try:
                    clean_emotions[str(label)] = max(0.0, min(1.0, float(score)))
                except (TypeError, ValueError):
                    continue

        top_emotion = str(parsed.get("topEmotion", "") or "").strip()
        try:
            top_emotion_score = max(0.0, min(1.0, float(parsed.get("topEmotionScore", confidence))))
        except (TypeError, ValueError):
            top_emotion_score = confidence

        return {
            "label": sentiment,
            "score": confidence,
            "topEmotion": top_emotion,
            "topEmotionScore": top_emotion_score,
            "allEmotions": clean_emotions,
            "chunkCount": 1,
            "analyzedTokens": analyzed_tokens,
            "peak": None,
            "detailedReport": str(parsed.get("detailedReport", "") or "").strip(),
        }
