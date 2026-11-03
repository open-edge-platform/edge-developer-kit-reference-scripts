# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0
"""Tamil text to Fastspeech2_HS input: upstream's Tamil ``TTSDurAlignPreprocessor`` without ESPnet.

Words become phones from ``phone_dict/tamil`` (ASCII words from ``phone_dict/english``, dropped if
absent), else from tamil_g2p; each phrase is written ``$<phones>.``, phrases joined by spaces.
"""
from __future__ import annotations

import re
from pathlib import Path

from num_to_words import num_to_word

from tamil_g2p import TamilG2P

_CLEANING_RULES = [
    (" +", " "), ("^ +", ""), (" +$", ""), ("#", ""),
    ("[.,;।!](\r\n)*", "# "), ("[.,;।!](\n)*", "# "),
    ("(\r\n)+", "# "), ("(\n)+", "# "), ("(\r)+", "# "),
    ("""[?;:)(!|&’‘,।\\."]""", ""), ("[/']", ""), ("[-–]", " "),
]
_POST_RULES = [(" +", " "), ("^ +", ""), (" +$", ""), ("#$", ""), ("# +$", "")]


def _load_dict(path: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        parts = line.split(" ")
        if len(parts) == 2 and parts[0] and parts[1]:
            out.setdefault(parts[0], parts[1])
    return out


class TamilFrontend:
    def __init__(self, root: str | Path):
        root = Path(root)
        self.tamil = _load_dict(root / "phone_dict" / "tamil")
        english = root / "phone_dict" / "english"
        self.english = _load_dict(english) if english.is_file() else {}
        self.g2p = TamilG2P(root / "ssn_parser_new" / "lists")
        self._oov: dict[str, str] = {}

    @staticmethod
    def _numbers(text: str) -> str:
        # numberToTextConverter: longest numbers first, decimals as "<int> புள்ளி <digits>".
        matches = re.findall(r"\d+\.\d+|\d+", text)
        for m in sorted(set(matches), key=lambda x: float(x), reverse=True):
            if "." in m:
                whole, frac = m.split(".")
                words = num_to_word(int(whole), "ta").replace(",", "") + " புள்ளி " + " ".join(num_to_word(int(c), "ta") for c in frac)
            else:
                words = num_to_word(int(m), "ta").replace(",", "")
            text = text.replace(m, f" {words} ")
        return text

    def _word(self, word: str) -> str:
        if word.isascii():
            return self.english.get(word.lower(), self.english.get(word, ""))
        phones = self.tamil.get(word)
        if phones is None:
            phones = self._oov.get(word)
            if phones is None:
                phones = self._oov[word] = self.g2p(word)
        return phones

    def phrases(self, text: str) -> list[str]:
        text = self._numbers(text)
        for pattern, repl in _CLEANING_RULES:
            text = re.sub(pattern, repl, text)
        for pattern, repl in _POST_RULES:
            text = re.sub(pattern, repl, text)
        return [p.strip() for p in text.split("#") if p.strip()]

    def __call__(self, text: str) -> str:
        out = []
        for phrase in self.phrases(text):
            phones = "".join(self._word(w) for w in phrase.split(" ") if w)
            if phones:
                out.append("$" + phones + ".")
        return " ".join(out)
