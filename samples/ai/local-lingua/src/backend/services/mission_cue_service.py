# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

"""Mission Cue detection service — matches translated English text against
loaded hotword/action documents (PDFs in the mission-cues table format).

Matching strategy is pluggable:
  - "stem" (default): fast suffix-stripping stemmer, deterministic
  - "llm" (future): semantic matching via an OpenVINO LLM

PDF parsing modes:
  - "formatted": expects a table with phrase/action columns (fast, no model)
  - "unformatted": uses an LLM (Qwen2.5-1.5B via OpenVINO) to extract pairs from free-form text
"""

import json
import logging
import re
import threading
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

ROOT_DIR = Path(__file__).resolve().parents[3]
MISSION_CUES_DIR = ROOT_DIR / "mission-cues"
UPLOADED_CUES_DIR = ROOT_DIR / "mission-cues" / "uploaded"

_STOPWORDS = frozenset({
    "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
    "have", "has", "had", "do", "does", "did", "will", "would", "could",
    "should", "may", "might", "shall", "can", "to", "of", "in", "for",
    "on", "with", "at", "by", "from", "as", "into", "through", "during",
    "before", "after", "above", "below", "between", "and", "but", "or",
    "nor", "not", "so", "if", "than", "that", "this", "it", "its",
})


def _stem(word: str) -> str:
    w = word[:-2] if word.endswith("'s") else word
    if len(w) > 5 and w.endswith("ies"):
        return w[:-3] + "y"
    if len(w) > 5 and w.endswith("ing"):
        return w[:-3]
    if len(w) > 4 and w.endswith("ed"):
        return w[:-2]
    if len(w) > 4 and w.endswith("es"):
        return w[:-2]
    if len(w) > 3 and w.endswith("s") and not w.endswith("ss"):
        return w[:-1]
    return w


def _stems_match(a: str, b: str, exact: bool = False) -> bool:
    sa, sb = _stem(a), _stem(b)
    if not sa or not sb:
        return False
    if sa == sb:
        return True
    if exact:
        return False
    shorter, longer = (sa, sb) if len(sa) <= len(sb) else (sb, sa)
    if len(shorter) < 4:
        return False
    return longer.startswith(shorter)


# Auto-extracted proper-noun cues (see generate_mission_cues.py's
# extract_new_keywords) carry this action boilerplate. Unlike curated bank
# entries, they're arbitrary names/terms — fuzzy prefix stemming on them is
# prone to coincidental short-stem collisions (e.g. "luis" stems to "lui",
# which also happens to be a common French pronoun), so they require an exact
# stem match instead.
_AUTO_EXTRACTED_MARKER = "Newly observed term in this run's sampled audio"


# Extra words of slack allowed around a multi-word cue phrase's keywords when
# checking proximity (accounts for translation reordering / filler words).
_PROXIMITY_SLACK = 3


def _phrase_match_span(
    kw_words: List[str], text_words: List[str], exact: bool = False
) -> Optional[Tuple[int, int]]:
    """Find the (start, end) index span in text_words that satisfies a cue phrase.

    A single keyword may match anywhere in the text. Multi-word phrases must
    have all of their keywords (stem-matched, any order) within a bounded
    sliding window, so e.g. "please help me" doesn't falsely match a document
    where "please" and "help" appear minutes apart and unrelated. The returned
    span is tight — from the first matched word to the last — not the whole
    window, so callers can show the actual excerpt that triggered the match
    (e.g. "pains", not the bank's canonical "i am in pain").
    """
    if len(kw_words) == 1:
        for idx, tw in enumerate(text_words):
            if _stems_match(kw_words[0], tw, exact=exact):
                return (idx, idx)
        return None

    window_size = len(kw_words) + _PROXIMITY_SLACK
    for start in range(len(text_words) - len(kw_words) + 1):
        window = text_words[start:start + window_size]
        positions = []
        for kw in kw_words:
            pos = next((start + i for i, tw in enumerate(window) if _stems_match(kw, tw, exact=exact)), None)
            if pos is None:
                positions = None
                break
            positions.append(pos)
        if positions is not None:
            return (min(positions), max(positions))
    return None


LLM_MODEL_ID = "OpenVINO/Qwen2.5-1.5B-Instruct-int4-ov"


def _resolve_llm_path(model_id: str) -> str:
    """Prefer a locally exported model dir (offline) over the HF repo name.

    `make prereq` downloads the LLM into models/<export_dir> via
    setup/export_models.py. Falls back to the HF hub id (cache) if not present.
    """
    try:
        import yaml
        cfg_path = ROOT_DIR / "config.yaml"
        with open(cfg_path) as f:
            cfg = yaml.safe_load(f) or {}
        mc = cfg.get("models", {}).get("mission_cue_llm", {})
        candidates = [mc] + list(mc.get("alternatives", []))
        for entry in candidates:
            if entry.get("name") == model_id:
                export_dir = ROOT_DIR / entry.get("export_dir", "")
                if (export_dir / "openvino_model.xml").exists():
                    return str(export_dir)
    except Exception as exc:
        logger.debug("Could not resolve local LLM path for %s: %s", model_id, exc)
    return model_id

_EXTRACT_SYSTEM_PROMPT = (
    "You extract hotword/action pairs from documents. "
    "A hotword is a short phrase (1-4 words) that indicates an important situation. "
    "An action is the recommended response when that hotword is detected in speech. "
    "Output ONLY a JSON array of objects with \"phrase\" and \"action\" keys. No other text."
)

_EXTRACT_USER_PROMPT = (
    "Extract all hotword/action pairs from this document. "
    "Each hotword should be a short phrase (1-4 words) and each action should describe what to do "
    "when that phrase is detected in conversation.\n\nDocument:\n{text}"
)


class _LLMParser:
    """Lazy-loaded LLM for unformatted PDF parsing."""

    def __init__(self):
        self._model = None
        self._tokenizer = None
        self._lock = threading.Lock()
        self._loaded_model_id: Optional[str] = None
        self._device = "CPU"

    def set_model(self, model_id: str, device: str = "CPU") -> None:
        """Switch to a different model (unloads current if different)."""
        if model_id != self._loaded_model_id or device != self._device:
            with self._lock:
                self._model = None
                self._tokenizer = None
                self._loaded_model_id = None
                self._device = device
                # Will be loaded on next use with the new model_id
                self._pending_model_id = model_id

    def _ensure_loaded(self):
        if self._model is not None:
            return
        from optimum.intel import OVModelForCausalLM
        from transformers import AutoTokenizer

        model_id = getattr(self, '_pending_model_id', None) or LLM_MODEL_ID
        load_path = _resolve_llm_path(model_id)
        logger.info("Loading LLM for PDF parsing: %s (from %s) on %s", model_id, load_path, self._device)
        self._tokenizer = AutoTokenizer.from_pretrained(load_path)
        self._model = OVModelForCausalLM.from_pretrained(load_path, device=self._device)
        self._loaded_model_id = model_id
        logger.info("LLM loaded for PDF parsing")

    def extract_cues(self, text: str) -> List[Tuple[str, str]]:
        with self._lock:
            self._ensure_loaded()
            messages = [
                {"role": "system", "content": _EXTRACT_SYSTEM_PROMPT},
                {"role": "user", "content": _EXTRACT_USER_PROMPT.format(text=text[:4000])},
            ]
            prompt = self._tokenizer.apply_chat_template(
                messages, tokenize=False, add_generation_prompt=True
            )
            inputs = self._tokenizer(prompt, return_tensors="pt")
            outputs = self._model.generate(**inputs, max_new_tokens=2048, do_sample=False)
            response = self._tokenizer.decode(
                outputs[0][inputs["input_ids"].shape[1]:], skip_special_tokens=True
            )

        return self._parse_llm_response(response)

    def _parse_llm_response(self, response: str) -> List[Tuple[str, str]]:
        # Extract JSON array from response (may have markdown fences)
        response = response.strip()
        if response.startswith("```"):
            response = re.sub(r"^```(?:json)?\s*", "", response)
            response = re.sub(r"\s*```$", "", response)

        try:
            data = json.loads(response)
        except json.JSONDecodeError:
            # Try to find a JSON array in the response
            match = re.search(r"\[.*\]", response, re.DOTALL)
            if match:
                try:
                    data = json.loads(match.group())
                except json.JSONDecodeError:
                    logger.error("LLM response was not valid JSON: %s", response[:200])
                    return []
            else:
                logger.error("No JSON array found in LLM response: %s", response[:200])
                return []

        cues: List[Tuple[str, str]] = []
        if isinstance(data, list):
            for item in data:
                if isinstance(item, dict):
                    phrase = str(item.get("phrase", "")).strip().lower()
                    action = str(item.get("action", "")).strip()
                    if phrase and action and len(phrase) > 1:
                        cues.append((phrase, action))
        return cues


class MissionCueDocument:
    """A parsed hotword/action document."""

    def __init__(self, doc_id: str, filename: str, source: str, cues: List[Tuple[str, str]]):
        self.doc_id = doc_id
        self.filename = filename
        self.source = source  # "demo" or "uploaded"
        self.cues = cues  # list of (phrase, action)


class MissionCueService:
    """Manages loaded mission cue documents and performs detection."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._documents: Dict[str, MissionCueDocument] = {}
        self._llm_parser = _LLMParser()
        self._load_demo_documents()

    def _load_demo_documents(self) -> None:
        if not MISSION_CUES_DIR.is_dir():
            logger.info("No mission-cues/ directory — demo cues not loaded")
            return
        # Only top-level PDFs in mission-cues/ are demo docs (not uploaded/ subdir)
        for pdf_path in (p for p in MISSION_CUES_DIR.iterdir() if p.suffix.lower() == ".pdf" and p.is_file()):
            try:
                cues = self._parse_pdf(pdf_path)
                if cues:
                    doc_id = f"demo-{pdf_path.stem}"
                    self._documents[doc_id] = MissionCueDocument(
                        doc_id=doc_id,
                        filename=pdf_path.name,
                        source="demo",
                        cues=cues,
                    )
                    logger.info("Loaded demo cue document: %s (%d cues)", pdf_path.name, len(cues))
            except Exception as exc:
                logger.error("Failed to parse demo PDF %s: %s", pdf_path.name, exc)

        # Also load any previously uploaded documents
        if UPLOADED_CUES_DIR.is_dir():
            for pdf_path in UPLOADED_CUES_DIR.glob("*.pdf"):
                try:
                    cues = self._parse_pdf(pdf_path)
                    if cues:
                        doc_id = f"uploaded-{pdf_path.stem}"
                        self._documents[doc_id] = MissionCueDocument(
                            doc_id=doc_id,
                            filename=pdf_path.name,
                            source="uploaded",
                            cues=cues,
                        )
                        logger.info("Loaded uploaded cue document: %s (%d cues)", pdf_path.name, len(cues))
                except Exception as exc:
                    logger.error("Failed to parse uploaded PDF %s: %s", pdf_path.name, exc)

    def _parse_pdf(self, pdf_path: Path) -> List[Tuple[str, str]]:
        """Extract (phrase, action) pairs from a mission cues PDF table.

        Expected PDF format: table with columns like
          Key Phrase | Recommended Action | ...
        """
        try:
            import fitz  # PyMuPDF
        except ImportError:
            logger.warning("PyMuPDF (fitz) not installed — trying text extraction fallback")
            return self._parse_pdf_text_fallback(pdf_path)

        cues: List[Tuple[str, str]] = []
        doc = fitz.open(str(pdf_path))

        for page in doc:
            tables = page.find_tables()
            for table in tables:
                rows = table.extract()
                if not rows:
                    continue
                # Find column indices by header
                header = [str(cell).lower().strip() if cell else "" for cell in rows[0]]
                phrase_col = None
                action_col = None
                for i, h in enumerate(header):
                    if "phrase" in h or "keyword" in h or "cue" in h:
                        phrase_col = i
                    elif "action" in h or "recommendation" in h or "response" in h:
                        action_col = i

                if phrase_col is None or action_col is None:
                    # Try first two columns as fallback
                    if len(header) >= 2:
                        phrase_col, action_col = 0, 1
                    else:
                        continue

                for row in rows[1:]:
                    if len(row) > max(phrase_col, action_col):
                        phrase = str(row[phrase_col]).strip() if row[phrase_col] else ""
                        action = str(row[action_col]).strip() if row[action_col] else ""
                        if phrase and action and len(phrase) > 1:
                            cues.append((phrase.lower(), action))

        doc.close()
        return cues

    def _parse_pdf_with_llm(self, pdf_path: Path) -> List[Tuple[str, str]]:
        """Extract cues from a free-form PDF using an LLM."""
        try:
            import fitz
        except ImportError:
            logger.error("PyMuPDF not available — cannot extract text from PDF")
            return []

        doc = fitz.open(str(pdf_path))
        text = ""
        for page in doc:
            text += page.get_text()
        doc.close()

        if not text.strip():
            return []

        logger.info("Parsing unformatted PDF with LLM (%d chars)...", len(text))
        return self._llm_parser.extract_cues(text)

    def _parse_pdf_text_fallback(self, pdf_path: Path) -> List[Tuple[str, str]]:
        """Fallback text-based parsing when PyMuPDF table extraction is unavailable."""
        try:
            import fitz
            doc = fitz.open(str(pdf_path))
            text = ""
            for page in doc:
                text += page.get_text()
            doc.close()
        except ImportError:
            logger.error("PyMuPDF not available — cannot parse PDF")
            return []

        cues: List[Tuple[str, str]] = []
        lines = text.split("\n")
        for line in lines:
            parts = re.split(r"\s{2,}|\t+|\|", line)
            parts = [p.strip() for p in parts if p.strip()]
            if len(parts) >= 2:
                phrase = parts[0].lower()
                action = parts[1]
                if len(phrase) > 2 and len(action) > 5:
                    cues.append((phrase, action))
        return cues

    def list_documents(self) -> List[Dict[str, Any]]:
        with self._lock:
            return [
                {
                    "docId": doc.doc_id,
                    "filename": doc.filename,
                    "source": doc.source,
                    "cueCount": len(doc.cues),
                }
                for doc in self._documents.values()
            ]

    def upload_document(self, filename: str, pdf_bytes: bytes, parse_mode: str = "formatted") -> Dict[str, Any]:
        """Upload and parse a PDF document.

        parse_mode:
          - "formatted": expects a table with phrase/action columns (fast)
          - "unformatted": uses LLM to extract cues from free-form text
        """
        UPLOADED_CUES_DIR.mkdir(parents=True, exist_ok=True)

        safe_name = re.sub(r"[^\w\-.]", "_", filename)
        save_path = UPLOADED_CUES_DIR / safe_name

        # Avoid overwriting
        if save_path.exists():
            stem = save_path.stem
            suffix = save_path.suffix
            save_path = UPLOADED_CUES_DIR / f"{stem}_{uuid.uuid4().hex[:6]}{suffix}"

        save_path.write_bytes(pdf_bytes)

        if parse_mode == "unformatted":
            cues = self._parse_pdf_with_llm(save_path)
        else:
            cues = self._parse_pdf(save_path)

        if not cues:
            save_path.unlink(missing_ok=True)
            raise ValueError("No hotword/action pairs found in the uploaded PDF")

        doc_id = f"uploaded-{save_path.stem}"
        doc = MissionCueDocument(
            doc_id=doc_id,
            filename=save_path.name,
            source="uploaded",
            cues=cues,
        )

        with self._lock:
            self._documents[doc_id] = doc

        logger.info("Uploaded cue document: %s (%d cues)", save_path.name, len(cues))
        return {
            "docId": doc_id,
            "filename": save_path.name,
            "source": "uploaded",
            "cueCount": len(cues),
        }

    def remove_document(self, doc_id: str) -> bool:
        with self._lock:
            doc = self._documents.pop(doc_id, None)
        if not doc:
            return False

        # Delete file if uploaded
        if doc.source == "uploaded":
            pdf_path = UPLOADED_CUES_DIR / doc.filename
            pdf_path.unlink(missing_ok=True)

        logger.info("Removed cue document: %s", doc.filename)
        return True

    def detect(self, text: str, method: str = "stem") -> List[Dict[str, Any]]:
        """Detect hotwords in translated English text.

        Returns list of matches: [{hotword, action, source, docId, filename}]
        """
        if not text:
            return []

        if method == "stem":
            return self._detect_stem(text)
        # Future: elif method == "llm": return self._detect_llm(text)
        return self._detect_stem(text)

    def _detect_stem(self, text: str) -> List[Dict[str, Any]]:
        # Ordered (not deduped) so multi-word phrases can be checked for
        # proximity — a bag-of-words-anywhere-in-the-document check produces
        # many false positives on long transcripts (e.g. "what time is it"
        # matching just because "what" and "time" each appear somewhere,
        # unrelated to each other, across a multi-minute conversation).
        # raw_words keeps original casing/inflection so we can report the
        # actual excerpt that matched (e.g. "pains"), not just the bank's
        # canonical phrase (e.g. "i am in pain"), which the stemmer matched
        # fuzzily and may never appear verbatim in the conversation.
        raw_words = [w for w in re.findall(r"[A-Za-z']+", text) if len(w) >= 3]
        text_words = [w.lower() for w in raw_words]
        if not text_words:
            return []

        matches: List[Dict[str, Any]] = []
        seen_phrases: set = set()

        with self._lock:
            docs = list(self._documents.values())

        for doc in docs:
            for phrase, action in doc.cues:
                if phrase in seen_phrases:
                    continue
                kw_words = [
                    w for w in re.findall(r"[a-z']+", phrase)
                    if len(w) >= 3 and w not in _STOPWORDS
                ]
                if not kw_words:
                    continue
                is_auto_extracted = action.startswith(_AUTO_EXTRACTED_MARKER)
                span = _phrase_match_span(kw_words, text_words, exact=is_auto_extracted)
                if span is not None:
                    seen_phrases.add(phrase)
                    matched_text = " ".join(raw_words[span[0]:span[1] + 1])
                    matches.append({
                        "hotword": phrase,
                        "matchedText": matched_text,
                        "action": action,
                        "source": doc.source,
                        "docId": doc.doc_id,
                        "filename": doc.filename,
                    })

        return matches

    def get_pdf_path(self, doc_id: str) -> Optional[Path]:
        with self._lock:
            doc = self._documents.get(doc_id)
        if not doc:
            return None
        if doc.source == "demo":
            return MISSION_CUES_DIR / doc.filename
        return UPLOADED_CUES_DIR / doc.filename

    def reload_demo_documents(self) -> None:
        """Re-scan mission-cues/ directory for demo PDFs."""
        with self._lock:
            # Remove existing demo docs
            self._documents = {
                k: v for k, v in self._documents.items() if v.source != "demo"
            }
        self._load_demo_documents()

    def reload_llm(self, model_id: str, device: str = "CPU") -> None:
        """Switch the LLM used for unformatted PDF parsing."""
        self._llm_parser.set_model(model_id, device)
        logger.info("Mission cue LLM will use %s on %s (loaded on next parse)", model_id, device)
