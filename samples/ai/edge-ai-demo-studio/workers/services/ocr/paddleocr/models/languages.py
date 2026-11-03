# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""Recognition-language catalogue for the PP-OCR pipelines.

Detection is script-agnostic, so a language swaps only the recogniser and its dictionary (as
upstream ``PaddleOCR(lang=...)`` does). PP-OCRv5 ONNX exports are preferred, else PP-OCRv3 ``.tar``
releases; PP-OCRv5 Paddle releases use the PIR ``inference.json`` format OpenVINO 2026.2 can't read.
``len(dict) + 2`` must equal each recogniser's class count, or CTC decoding silently yields wrong
characters (re-checked by ``PPOCRModel._check_dictionary``).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

# Upstream asset hosts.
_HF = "https://huggingface.co/PaddlePaddle"
_V3 = "https://paddleocr.bj.bcebos.com/PP-OCRv3"
_V3_DICTS = "https://raw.githubusercontent.com/PaddlePaddle/PaddleOCR/main/ppocr/utils"

#: Sentinel meaning "keep the recogniser the active preset was built with".
DEFAULT_LANG = "default"


@dataclass(frozen=True)
class LanguageSpec:
    key: str
    label: str
    #: Which languages this recogniser actually covers, shown in the UI.
    description: str
    rec_url: str | None = None
    dict_url: str | None = None
    #: Recogniser generation, surfaced so the UI can mark the older ones.
    generation: str = "PP-OCRv5"
    #: Right-to-left script: the recogniser emits each line backwards, so the pipeline reverses it.
    rtl: bool = False

    @property
    def is_default(self) -> bool:
        """True for the sentinel that keeps the preset's own recogniser."""
        return self.rec_url is None


def _v5(
    key: str, label: str, description: str, rtl: bool = False
) -> LanguageSpec:
    """A PP-OCRv5 recogniser from PaddlePaddle's ONNX export.

    The dictionary is inline in the repo's ``inference.yml``, so model and dictionary can't drift.
    """
    repo = f"{_HF}/{key}_PP-OCRv5_mobile_rec_onnx/resolve/main"
    return LanguageSpec(
        key=key,
        label=label,
        description=description,
        rec_url=f"{repo}/inference.onnx",
        dict_url=f"{repo}/inference.yml",
        rtl=rtl,
    )


def _v3(key: str, label: str, description: str, dict_name: str) -> LanguageSpec:
    """A PP-OCRv3 recogniser, for languages with no PP-OCRv5 ONNX export."""
    return LanguageSpec(
        key=key,
        label=label,
        description=description,
        rec_url=f"{_V3}/multilingual/{key}_PP-OCRv3_rec_infer.tar",
        dict_url=f"{_V3_DICTS}/dict/{dict_name}.txt",
        generation="PP-OCRv3",
    )


LANGUAGES: dict[str, LanguageSpec] = {
    DEFAULT_LANG: LanguageSpec(
        key=DEFAULT_LANG,
        label="Model default",
        description=(
            "Whichever recogniser the selected model ships with — Chinese, "
            "English and Japanese for PP-OCRv5; Chinese and English for "
            "PP-OCRv3."
        ),
        generation="",
    ),
    # PP-OCRv5 ONNX (current generation)
    "en": _v5("en", "English", "English and digits."),
    "korean": _v5("korean", "Korean", "Hangul, hanja and English."),
    "latin": _v5(
        "latin",
        "Latin",
        "Latin scripts with diacritics — Indonesian, Malay, French, German, "
        "Spanish, Italian, Portuguese, Dutch, Polish, Turkish and more. Not "
        "Vietnamese: no PP-OCR recogniser covers its tone marks, so use the "
        "PaddleOCR-VL model for that.",
    ),
    "th": _v5("th", "Thai", "Thai script."),
    "el": _v5("el", "Greek", "Greek script."),
    "eslav": _v5(
        "eslav",
        "East Slavic",
        "Russian, Ukrainian and Belarusian — more accurate than the broader "
        "Cyrillic recogniser for these three.",
    ),
    "cyrillic": _v5(
        "cyrillic",
        "Cyrillic",
        "Cyrillic scripts generally — Bulgarian, Serbian, Macedonian, "
        "Kazakh, Mongolian and others.",
    ),
    "arabic": _v5(
        "arabic",
        "Arabic",
        "Arabic script — Arabic, Persian, Urdu, Uyghur.",
        rtl=True,
    ),
    "devanagari": _v5(
        "devanagari",
        "Devanagari",
        "Hindi, Marathi, Nepali, Sanskrit and other Devanagari scripts.",
    ),
    "ta": _v5("ta", "Tamil", "Tamil script."),
    "te": _v5("te", "Telugu", "Telugu script."),
    # PP-OCRv3 (no PP-OCRv5 ONNX export published)
    "ch": LanguageSpec(
        key="ch",
        label="Chinese (Simplified)",
        description="Simplified Chinese and English.",
        rec_url=f"{_V3}/chinese/ch_PP-OCRv3_rec_infer.tar",
        dict_url=f"{_V3_DICTS}/ppocr_keys_v1.txt",
        generation="PP-OCRv3",
    ),
    "chinese_cht": _v3(
        "chinese_cht",
        "Chinese (Traditional)",
        "Traditional Chinese and English.",
        "chinese_cht_dict",
    ),
    "japan": _v3(
        "japan", "Japanese", "Japanese kana, kanji and English.", "japan_dict"
    ),
    "ka": _v3("ka", "Kannada", "Kannada script.", "ka_dict"),
}


def resolve(lang: str | None) -> LanguageSpec:
    """Look up ``lang``, falling back to the default sentinel when unset."""
    key = (lang or DEFAULT_LANG).strip() or DEFAULT_LANG
    spec = LANGUAGES.get(key)
    if spec is None:
        raise ValueError(
            f"Unknown OCR language '{lang}'. Available: {sorted(LANGUAGES)}."
        )
    return spec


def list_specs() -> list[dict[str, Any]]:
    """Serialisable catalogue for the ``GET /languages`` endpoint."""
    return [
        {
            "key": s.key,
            "label": s.label,
            "description": s.description,
            "generation": s.generation,
            "rtl": s.rtl,
            "is_default": s.is_default,
        }
        for s in LANGUAGES.values()
    ]
