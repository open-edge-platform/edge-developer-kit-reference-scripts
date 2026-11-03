# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0
"""Tamil words missing from the phone dictionary, to phones.

In-memory port of Fastspeech2_HS' ``ssn_parser_new`` (a Linux binary plus sed upstream), using the rule
lists from the model download. Unlike upstream, ``vul.py``'s index stops at the last phone (upstream
runs one past it, mangling word-final "u" and "c"), and phones map to the symbols the models were
trained on (``Phonifier.cls_2_chr_map``). 98.9% of 20,000 dictionary words come out as listed.
"""
from __future__ import annotations

import re
from pathlib import Path

# Dependent vowel signs and independent vowels (plus the aytham), as
# tamil_trans_py.py lists them, and the virama.
_DV = set("\u0BBE\u0BBF\u0BC0\u0BC1\u0BC2\u0BC6\u0BC7\u0BC8\u0BCA\u0BCB\u0BCC")
_VOWELS = set("\u0B85\u0B86\u0B87\u0B88\u0B89\u0B8A\u0B8E\u0B8F\u0B90\u0B92\u0B93\u0B94\u0B83")
_VIRAMA = "\u0BCD"

# Phonifier.cls_2_chr_map of text_preprocess_for_inference.py: the symbols the
# models were trained on (get_phone_mapped_text.py writes U+0909, U+0929 and
# U+0931 for eu/nd/rx, which are not in the token lists).
PHONE_TO_SYMBOL = {
    "aa": "A", "ii": "I", "uu": "U", "ee": "E", "oo": "O", "nn": "N", "ae": "ऍ", "ag": "ऽ",
    "au": "औ", "ax": "ऑ", "bh": "B", "ch": "C", "dh": "ध", "dx": "ड", "dxh": "ढ", "dxhq": "T",
    "dxq": "D", "ei": "ऐ", "ai": "ऐ", "eu": "உ", "gh": "घ", "gq": "G", "hq": "H", "jh": "J",
    "kh": "ख", "khq": "K", "kq": "क", "ln": "ൾ", "lw": "ൽ", "lx": "ള", "mq": "M", "nd": "न",
    "ng": "ङ", "nj": "ञ", "nk": "Y", "nw": "ൺ", "nx": "ण", "ou": "औ", "ph": "P", "rq": "R",
    "rqw": "ॠ", "rw": "ർ", "rx": "र", "sh": "श", "sx": "ष", "th": "थ", "tx": "ट", "txh": "ठ",
    "wv": "W", "zh": "Z",
}


class TamilG2P:
    def __init__(self, lists_dir: str | Path, symbol_map: dict[str, str] | None = None):
        d = Path(lists_dir)
        self.tamil_map: dict[str, str] = {}
        for line in (d / "tamil_map").read_text(encoding="utf-8").splitlines():
            if not line or line[0] == "#":
                continue
            parts = line.split()
            if len(parts) == 2 and parts[0] not in self.tamil_map:
                self.tamil_map[parts[0]] = parts[1]
        self.phone_list_text = (d / "phone_list").read_text(encoding="utf-8")
        self.alphabets = self._token_lines(d / "alphabets")
        vuv = [l.split() for l in (d / "vuv_list").read_text(encoding="utf-8").splitlines() if l.split()]
        self.vuv = {row[0]: row for row in vuv}
        self.vuv_first = [row[0] for row in vuv]
        self.nasal = [row[2] for row in vuv if len(row) >= 3]
        self.u_list = self._token_lines(d / "u_list")
        self.vowel_list = self._token_lines(d / "vowel_list")
        self.sv = self._token_lines(d / "sv")
        self.symbol_map = symbol_map or PHONE_TO_SYMBOL
        self._phone_cache: dict[str, bool] = {}

    @staticmethod
    def _token_lines(path: Path) -> list[list[str]]:
        return [line.split() for line in path.read_text(encoding="utf-8").split("\n")]

    @staticmethod
    def _count(lines: list[list[str]], token: str) -> int:
        return sum(1 for tokens in lines if token in tokens)

    def _transliterate(self, word: str) -> str:
        out = []
        for i, ch in enumerate(word):
            nxt = word[i + 1] if i + 1 < len(word) else ""
            if ch in _VOWELS:
                token = ch
                tr = self.tamil_map.get(token)
                if tr is not None:
                    out.append(tr)
            elif nxt == _VIRAMA:
                tr = self.tamil_map.get(ch + nxt)
                if tr is not None:
                    out.append(tr)
            elif ch in _DV:
                tr = self.tamil_map.get(ch)
                if tr is not None:
                    out.append(tr)
            elif nxt not in _DV:
                tr = self.tamil_map.get(ch)
                if tr is not None:
                    out.append(tr if tr == ch else tr + "a")
            else:
                tr = self.tamil_map.get(ch)
                if tr is not None:
                    out.append(tr)
        return "".join(out)

    def _is_phone(self, p: str) -> bool:
        hit = self._phone_cache.get(p)
        if hit is None:
            hit = len(set(re.findall(rf"\b{re.escape(p)}\b", self.phone_list_text))) == 1
            self._phone_cache[p] = hit
        return hit

    def _split_phones(self, trans: str) -> list[str]:
        phones: list[str] = []
        for word in trans.split():
            if word == "SIL":
                phones.append("SIL")
                break
            i = 0
            while i < len(word):
                for n in (6, 5, 4, 3, 2):
                    p = word[i:i + n]
                    if self._is_phone(p):
                        phones.append(p)
                        i += n
                        break
                else:
                    if word[i] not in ",.":
                        phones.append(word[i])
                    i += 1
        return phones

    def _voicing(self, phones: list[str]) -> list[str]:
        # The index stops at the last phone, unlike vul.py (see the module docstring).
        lines = phones
        count = len(lines)

        def at(k: int) -> str:
            return lines[k - 1] if 1 <= k <= count else ""

        out = ["s" if at(1) == "c" else at(1)]
        for start in range(2, count + 1):
            phn, phn_1, phn_2 = at(start), at(start - 1), at(start + 1)
            c0, c1, c2 = start - 1, start + 1, start + 2
            if (phn == "c" and phn_1 == "c") or (phn == "c" and phn_2 == "c") or (phn == "c" and phn_1 == "tx"):
                out.append(phn)
            elif phn == "c" and phn_1 == "nj":
                out.append("j")
            elif phn == "c" and phn_1 != "c":
                out.append("s")
            elif phn == "rx" and phn_2 == "rx":
                out.append("tx")
            else:
                flg = sum(1 for t in self.vuv_first if t == phn)
                phn0, phn1, phn2 = at(c0), at(c1), at(c2)
                if phn == "u":
                    flg_1 = self._count(self.u_list, phn1)
                    if start == count or (flg_1 != 0 and c1 == count) or (phn1 == "k" and phn2 == "k" and c0 != 1):
                        out.append("eu")
                    else:
                        out.append(phn)
                elif phn == "c":
                    if phn0 == "c" or phn1 == "c" or c1 == count:
                        out.append(phn)
                    elif phn0 == "nj":
                        out.append("j")
                    else:
                        out.append("s")
                elif flg == 1:
                    flg1 = self._count(self.vowel_list, phn0)
                    flg2 = self._count(self.vowel_list, phn1)
                    flg3 = sum(1 for t in self.nasal if t == phn0)
                    flg4 = self._count(self.sv, phn0)
                    voiced = self.vuv[phn][1]
                    if phn == "p":
                        if (flg1 == 1 and flg2 == 1) or (flg3 == 1 and phn0 != phn) or phn0 == "n":
                            out.append(voiced)
                        else:
                            out.append(phn)
                    elif (flg1 == 1 and flg2 == 1) or (flg3 == 1 and phn0 != phn) or (flg4 == 1 and flg2 == 1):
                        out.append(voiced)
                    else:
                        out.append(phn)
                else:
                    out.append(phn)
        return [p for p in out if p]

    def phones(self, word: str) -> list[str]:
        if len(word) > 1 and self._count(self.alphabets, word[1]) != 0:
            return []
        return self._voicing(self._split_phones(self._transliterate(word)))

    def __call__(self, word: str) -> str:
        return "".join(self.symbol_map.get(p, p) for p in self.phones(word))
