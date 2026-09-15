"""
NLLB-200 OpenVINO wrapper for bidirectional translation.

Splits long text into sentences before translating to keep input within the
model's effective context window. Uses beam search and repetition penalty
for higher-quality output.
"""

import logging
import re
import time
from pathlib import Path
from typing import List, Optional

import numpy as np
import yaml
from optimum.intel import OVModelForSeq2SeqLM
from transformers import AutoTokenizer, NllbTokenizer

from src.models.base import TranslatorBase, ROOT_DIR

logger = logging.getLogger(__name__)

CONFIG_PATH = ROOT_DIR / "config.yaml"

ISO_TO_NLLB = {
    "en": "eng_Latn",
    "fr": "fra_Latn",
    "de": "deu_Latn",
    "es": "spa_Latn",
    "it": "ita_Latn",
    "pt": "por_Latn",
    "nl": "nld_Latn",
    "ru": "rus_Cyrl",
    "zh": "zho_Hans",
    "ja": "jpn_Jpan",
    "ko": "kor_Hang",
    "ar": "arb_Arab",
    "hi": "hin_Deva",
    "tr": "tur_Latn",
    "pl": "pol_Latn",
}

# Split on sentence boundaries: period/exclamation/question followed by space,
# CJK full-width terminators, the Arabic question mark, Hindi/Devanagari danda (।),
# double danda (॥), or newlines.
_SENTENCE_SPLIT_RE = re.compile(r'(?<=[.!?。！？؟।॥])\s+|\n+')
# CJK text is normally written without a space after the terminator, so the rule
# above never sees the boundary and the whole paragraph stays one "sentence".
_CJK_SPLIT_RE = re.compile(r'(?<=[。！？])')

# Max input tokens per chunk — NLLB generates premature EOS on long inputs.
# 40 tokens per chunk ensures complete translation without truncation.
_MAX_CHUNK_TOKENS = 40

# Upper bound on chunks translated per message. Beyond this, chunks are sampled
# evenly across the whole text rather than all being translated — unlike the
# sentiment/voice-emotion caps, a skipped chunk here is text that never gets
# translated at all, not just a coarser aggregate, so this is set high enough
# to cover a full 10+ minute recording (150 chunks * 40 tokens =~ 6000 tokens,
# well beyond a typical 10-minute transcript) and only kicks in for the
# pathological case — a very long recording queuing an unbounded number of
# sequential beam-search decodes on the same GPU/NPU, which is what runs the
# device out of memory partway through. Override per-model via config.yaml's
# translator.max_chunks if a given deployment needs a different ceiling.
_MAX_CHUNKS = 150


def load_config():
    try:
        with open(CONFIG_PATH) as f:
            return yaml.safe_load(f)
    except FileNotFoundError:
        return {}


def _split_sentences(text: str) -> List[str]:
    """Split text into sentences for chunk-based translation."""
    sentences: List[str] = []
    for part in _SENTENCE_SPLIT_RE.split(text.strip()):
        if not part:
            continue
        sentences.extend(piece for piece in _CJK_SPLIT_RE.split(part) if piece.strip())
    return [s.strip() for s in sentences if s.strip()]


class Translator(TranslatorBase):
    """NLLB-200 bidirectional translation using OpenVINO backend.

    Improvements over naive single-pass translation:
    - Sentence splitting keeps each chunk within the model's effective window
    - Beam search (num_beams=4) improves fluency
    - Repetition penalty prevents output loops
    - Higher max_new_tokens prevents truncation
    """

    def __init__(self, device: str = "CPU", config: dict = None) -> None:
        super().__init__(device=device, config=config)
        self._config = config or load_config()

        model_cfg = self._config.get("models", {}).get("translator", {})
        export_dir = ROOT_DIR / model_cfg.get("export_dir", "models/nllb-200-distilled-1.3B")
        self._max_chunks = int(model_cfg.get("max_chunks", _MAX_CHUNKS))

        logger.info("Loading NLLB translator from %s on %s", export_dir, device)

        try:
            self._tokenizer = AutoTokenizer.from_pretrained(str(export_dir))
        except (AttributeError, ValueError):
            self._tokenizer = NllbTokenizer.from_pretrained(str(export_dir))

        try:
            self._model = OVModelForSeq2SeqLM.from_pretrained(
                str(export_dir), device=device,
                ov_config={"CACHE_DIR": str(ROOT_DIR / "data" / "model_cache")},
            )
        except Exception as e:
            if device != "CPU":
                logger.warning("Failed to load translator on %s (%s), falling back to CPU", device, e)
                device = "CPU"
                self.device = device
                self._model = OVModelForSeq2SeqLM.from_pretrained(
                    str(export_dir), device="CPU",
                    ov_config={"CACHE_DIR": str(ROOT_DIR / "data" / "model_cache")},
                )
            else:
                raise

        self._loaded = True
        logger.info("Translator loaded on %s", self.device)

    def is_loaded(self) -> bool:
        return self._loaded

    def translate(self, text: str, source_lang: str, target_lang: str) -> str:
        if source_lang == target_lang:
            return text

        start = time.perf_counter()

        src_nllb = ISO_TO_NLLB.get(source_lang, "eng_Latn")
        tgt_nllb = ISO_TO_NLLB.get(target_lang, "eng_Latn")

        tgt_lang_id = self._tokenizer.convert_tokens_to_ids(tgt_nllb)

        # Split into sentences and group into chunks that fit the model's window
        sentences = _split_sentences(text)
        if not sentences:
            sentences = [text]

        chunks = self._group_into_chunks(sentences, src_nllb)
        translated_parts = []

        for chunk in chunks:
            # Isolate failures to the offending chunk — letting one bad chunk
            # raise here used to discard every already-translated chunk and
            # fall back to the *entire* original untranslated text (leaking
            # raw source-language text into what downstream stages treat as
            # English, e.g. TTS/sentiment/mission-cue matching).
            try:
                translated = self._translate_chunk(chunk, src_nllb, tgt_lang_id)
            except Exception:
                logger.error("Failed to translate chunk (skipped): '%s'", chunk[:80], exc_info=True)
                continue
            if translated:
                translated_parts.append(translated)

        translated_text = " ".join(translated_parts)

        elapsed = time.perf_counter() - start
        logger.debug(
            "Translation %s->%s took %.3fs (%d chunks): '%s' -> '%s'",
            source_lang, target_lang, elapsed, len(chunks),
            text[:50], translated_text[:50],
        )
        return translated_text

    def _split_oversized(self, sentence: str, src_nllb: str) -> List[str]:
        """Break a sentence longer than the chunk budget on token boundaries.

        Text with no terminator the splitter recognises — an unpunctuated transcript,
        or a script whose punctuation is not covered — arrives as one long "sentence".
        Left whole it sails past the chunk budget and is then silently cut off by the
        tokenizer's truncation, losing everything after the limit.
        """
        self._tokenizer.src_lang = src_nllb
        ids = self._tokenizer.encode(sentence, add_special_tokens=False)
        pieces = []
        for i in range(0, len(ids), _MAX_CHUNK_TOKENS):
            piece = self._tokenizer.decode(
                ids[i : i + _MAX_CHUNK_TOKENS], skip_special_tokens=True
            ).strip()
            if piece:
                pieces.append(piece)
        return pieces or [sentence]

    def _group_into_chunks(self, sentences: List[str], src_nllb: str) -> List[str]:
        """Group sentences into chunks that fit within _MAX_CHUNK_TOKENS."""
        self._tokenizer.src_lang = src_nllb
        chunks = []
        current_chunk = []
        current_tokens = 0

        for sentence in sentences:
            token_count = len(self._tokenizer.encode(sentence, add_special_tokens=False))

            # A single over-long sentence has to be broken up; otherwise the check
            # below cannot fire for it (there is nothing to flush yet) and it goes to
            # the model whole, where truncation drops the tail.
            parts = (
                [(sentence, token_count)]
                if token_count <= _MAX_CHUNK_TOKENS
                else [
                    (piece, len(self._tokenizer.encode(piece, add_special_tokens=False)))
                    for piece in self._split_oversized(sentence, src_nllb)
                ]
            )

            for part, part_tokens in parts:
                if current_tokens + part_tokens > _MAX_CHUNK_TOKENS and current_chunk:
                    chunks.append(" ".join(current_chunk))
                    current_chunk = []
                    current_tokens = 0

                current_chunk.append(part)
                current_tokens += part_tokens

        if current_chunk:
            chunks.append(" ".join(current_chunk))

        if len(chunks) > self._max_chunks:
            idx = np.linspace(0, len(chunks) - 1, self._max_chunks).round().astype(int)
            kept = [chunks[i] for i in sorted(set(idx.tolist()))]
            logger.info(
                "Translation: %d chunks exceeds cap %d — translating %d sampled across the text",
                len(chunks), self._max_chunks, len(kept),
            )
            chunks = kept

        return chunks

    def _translate_chunk(self, text: str, src_nllb: str, tgt_lang_id: int) -> str:
        """Translate a single chunk with beam search and repetition penalty."""
        self._tokenizer.src_lang = src_nllb
        inputs = self._tokenizer(
            text,
            return_tensors="pt",
            padding=True,
            truncation=True,
            max_length=512,
        )

        translated_ids = self._model.generate(
            **inputs,
            forced_bos_token_id=tgt_lang_id,
            max_new_tokens=512,
            num_beams=5,
            repetition_penalty=1.2,
            no_repeat_ngram_size=3,
            length_penalty=1.0,
        )

        translated_text = self._tokenizer.batch_decode(
            translated_ids, skip_special_tokens=True
        )[0].strip()

        return translated_text
