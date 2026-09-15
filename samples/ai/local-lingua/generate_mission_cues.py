#!/usr/bin/env python3
"""
Generate a single "Mission Cues" PDF reference document covering every demo
language under voice_samples/.

The PDF is a speech-to-action reference: one table of English key phrases
and the precise, human-followable action recommended when that phrase is
heard/translated during a conversation. Each phrase is listed exactly once
(no per-language duplicate PDFs).

Keyword detection uses the app's own default production pipeline (config.yaml):
the configured Whisper model transcribes each sample in its native language, then
the configured NLLB-200 translator turns that into English — the exact same
models/order the live app uses, so detection text quality matches what the demo
actually produces (more genuine hits than Whisper's own lower-quality built-in
translate mode). Matching uses light stemming so plurals/tenses ("cases" vs
"case", "developed" vs "develop") still count. Rows with a real hit are listed
first, with a "Detected In" column naming which language(s) the phrase was found
in. Proper-noun-like terms the curated bank doesn't already cover (e.g. place/
organization names actually mentioned in the audio) are also surfaced as new
rows rather than discarded. Every other bank entry follows, marked Generic.

Re-running this script re-detects against the current downloaded samples and
wipes any previously generated PDF first.

Usage:
    python3 generate_mission_cues.py                # generate the reference PDF
    python3 generate_mission_cues.py --max-samples 5 # cap clips skimmed per language
    python3 generate_mission_cues.py --no-detect     # skip detection, all rows generic

Requires: PyYAML, reportlab, faster-whisper, optimum-intel, transformers (see requirements.txt)
"""

import argparse
import logging
import re
import shutil
import sys
from datetime import datetime
from pathlib import Path

import yaml
from reportlab.lib import colors
from reportlab.lib.pagesizes import LETTER
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.platypus import (
    Paragraph, Spacer, SimpleDocTemplate, Table, TableStyle,
)

logging.getLogger("faster_whisper").setLevel(logging.WARNING)

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

VOICE_SAMPLES_DIR = ROOT / "voice_samples"
CONFIG_PATH = ROOT / "config.yaml"
OUTPUT_DIR = ROOT / "mission-cues"

SAMPLE_EXTS = (".wav", ".mp3", ".ogg", ".webm", ".flac")

# Maps config.yaml's model name to the faster-whisper model size string,
# mirroring src/models/transcriber_faster_whisper.py's own mapping.
_WHISPER_SIZE_MAP = {
    "openai/whisper-tiny": "tiny",
    "openai/whisper-small": "small",
    "openai/whisper-medium": "medium",
    "openai/whisper-large-v3": "large-v3",
}
_STOPWORDS = {
    "the", "and", "for", "are", "was", "were", "this", "that", "with",
    "have", "has", "had", "you", "your", "they", "them", "their", "from",
    "will", "would", "could", "should", "about", "there", "here", "what",
    "when", "where", "which", "who", "whom", "been", "being", "into",
    "not", "but", "can", "did", "get", "got", "one", "two", "also",
    "said", "just", "like", "some", "more", "very", "much", "many",
    "most", "then", "than", "these", "those", "such", "only", "even",
    "our", "out", "now", "all", "any", "its", "his", "her", "him",
}

# Curated bank of English key phrases and the precise action a field
# interpreter/user should take when that phrase comes up in conversation.
# All keywords and actions are English-only, per the app's translation flow
# where every language is ultimately translated to/from English.
MISSION_CUE_BANK = [
    ("medical emergency", "Stop the conversation, alert the on-site medic, and request immediate first aid."),
    ("injured person", "Render first aid if trained, and call for medevac support right away."),
    ("gunfire heard", "Move to nearest cover, alert security detail, and pause all non-essential activity."),
    ("checkpoint ahead", "Slow down, prepare identification documents, and inform the driver."),
    ("roadblock", "Reroute if possible and notify convoy lead of the obstruction."),
    ("water shortage", "Log the request and direct the speaker to the nearest water distribution point."),
    ("food shortage", "Log the request and refer the speaker to the humanitarian aid station."),
    ("shelter needed", "Direct the speaker to the nearest designated shelter and notify camp coordination."),
    ("lost documents", "Escort the speaker to the documentation/registration desk for replacement paperwork."),
    ("missing child", "Immediately notify security and camp management; do not let the speaker leave unattended."),
    ("family separated", "Refer the speaker to the family reunification desk and record identifying details."),
    ("unexploded ordnance", "Do not approach or touch the object; mark the area and notify EOD/explosive ordnance disposal."),
    ("suspicious package", "Evacuate the immediate area and alert security personnel; do not handle the item."),
    ("hostile activity", "Withdraw to a safe distance and report the activity to security immediately."),
    ("curfew violation", "Advise the speaker of curfew hours and direct them to return to designated housing."),
    ("vehicle breakdown", "Request mechanical support and move the vehicle out of the roadway if safe to do so."),
    ("fuel shortage", "Log the request and direct the speaker to the fuel distribution point."),
    ("power outage", "Notify facilities/engineering support and confirm backup generator status."),
    ("generator failure", "Notify engineering support immediately and switch to backup power if available."),
    ("communication down", "Switch to backup communication channel and notify command of the outage."),
    ("signal lost", "Move to higher ground or a known signal point and retry communication."),
    ("weapon found", "Do not touch the item; secure the area and notify security immediately."),
    ("prisoner request", "Refer the matter to the detaining authority; do not make commitments on their behalf."),
    ("border crossing", "Direct the speaker to the official crossing point and required documentation checklist."),
    ("identification required", "Politely request valid identification before proceeding with the request."),
    ("translator needed", "Confirm the speaker's preferred language and request an additional qualified interpreter."),
    ("map coordinates needed", "Record the coordinates precisely and relay them to the operations desk."),
    ("evacuation order", "Direct the speaker to the nearest evacuation assembly point without delay."),
    ("supply request", "Log the requested items and forward the request to the logistics desk."),
    ("language barrier", "Slow the conversation pace and confirm understanding after each exchange."),
    ("child separated from family", "Keep the child in sight, notify security, and begin the reunification process."),
    ("medical supplies needed", "Forward the request to the medical station and note the specific supplies required."),
    ("security threat reported", "Notify security personnel immediately and avoid confronting the situation directly."),
    ("weather warning", "Advise the speaker of the warning and direct them to appropriate shelter."),
    ("vehicle inspection", "Direct the vehicle to the inspection point and request the driver's documents."),
    ("aid distribution", "Direct the speaker to the scheduled distribution time and location."),
    ("health screening", "Direct the speaker to the health screening station before proceeding further."),
    ("emergency contact needed", "Assist the speaker in recording an emergency contact and next steps."),

    # Generic, high-frequency phrases — more likely to genuinely surface in
    # ordinary news/audiobook-style demo audio than the scenario-specific
    # cues above, so they raise the odds of a real (not just filled-in) match.
    ("please help me", "Acknowledge the request calmly and ask what specific assistance is needed."),
    ("thank you very much", "Acknowledge the thanks and confirm whether further assistance is needed."),
    ("i do not understand", "Slow down, rephrase simply, and confirm understanding before continuing."),
    ("please repeat that", "Repeat the previous statement slowly and check for understanding."),
    ("please wait here", "Acknowledge the request and inform the speaker of the expected wait time."),
    ("i am hungry", "Log the request and direct the speaker to the food distribution point."),
    ("i am thirsty", "Log the request and direct the speaker to the nearest water point."),
    ("i am very tired", "Offer a rest area and confirm no urgent needs before the speaker rests."),
    ("i am in pain", "Refer the speaker to the medical station immediately."),
    ("i am afraid", "Reassure the speaker calmly and confirm the immediate area is safe."),
    ("i am cold", "Direct the speaker to warm shelter or provide available blankets."),
    ("i need a phone", "Direct the speaker to the communications desk to request phone access."),
    ("i need money", "Refer the request to the aid/logistics desk; do not provide funds directly."),
    ("what time is it", "Provide the current time and note the request in the conversation log."),
    ("where is the bathroom", "Direct the speaker to the nearest restroom facility."),
    ("i am lost", "Help orient the speaker using the map/coordinates and confirm their destination."),
    ("government official", "Note the reference to officials and refer the topic to the coordination desk."),
    ("police officer", "Note the reference to police involvement and alert security if relevant."),
    ("military forces", "Note the reference to military activity and alert security/command."),
    ("economic crisis", "Log the concern and refer economic assistance requests to the aid desk."),
    ("election results", "Note the political topic and avoid engaging in political commentary."),
    ("protest gathering", "Note the report and alert security of possible crowd activity nearby."),
    ("public health warning", "Advise the speaker of the warning and direct them to the health station."),
    ("natural disaster", "Direct the speaker to the nearest designated shelter and notify coordination."),
    ("war zone", "Avoid the area entirely and report the location to security/command immediately."),

    # News-broadcast vocabulary — the MediaSpeech/OpenSLR demo samples are
    # real news and audiobook recordings, so these current-events phrases are
    # far more likely to genuinely appear than a real mission cue would be.
    ("vaccine rollout", "Note the health topic and refer detailed medical questions to the health desk."),
    ("rising case numbers", "Log the report and relay updated case figures to the health coordination desk."),
    ("death toll", "Log the report and relay the updated death toll to the health coordination desk."),
    ("prime minister meeting", "Note the diplomatic meeting and refer follow-up questions to the coordination desk."),
    ("oil pipeline agreement", "Note the infrastructure topic and refer commercial questions to the coordination desk."),
    ("peace treaty signed", "Note the diplomatic development and refer follow-up questions to the coordination desk."),
    ("political opposition reaction", "Note the political topic and avoid engaging in political commentary."),
    ("ceasefire announced", "Note the development and refer security implications to the coordination desk."),
    ("sanctions imposed", "Note the economic development and refer follow-up questions to the coordination desk."),
    ("trade agreement signed", "Note the economic development and refer commercial questions to the coordination desk."),
    ("refugee crisis reported", "Note the humanitarian topic and refer to the aid/logistics desk."),
    ("human rights concern", "Note the topic and refer to the appropriate oversight/coordination desk."),
    ("diplomatic relations strained", "Note the diplomatic topic and refer follow-up questions to the coordination desk."),
    ("lockdown restrictions", "Advise the speaker of current restrictions and direct them to official guidance."),
    ("ban lifted", "Advise the speaker of the updated rule and direct them to official guidance."),
]

# All significant words already referenced by the curated bank, used to avoid
# re-surfacing the same concept as a "new" auto-detected keyword.
_BANK_SIGNIFICANT_WORDS = {
    w for keyword, _action in MISSION_CUE_BANK
    for w in re.findall(r"[a-z']+", keyword.lower())
    if len(w) >= 3 and w not in _STOPWORDS
}

def load_quick_whisper_model():
    """Load the app's own configured Whisper model (config.yaml) for cue detection.

    Reusing the exact model make-prereq step 5 already downloaded (rather than a
    separate smaller model) means the transcription quality matches the live demo,
    and needs no extra download. Runs task="transcribe" (native language), mirroring
    the app's own pipeline order — translation to English is a separate step.
    Returns None if faster-whisper isn't available or the model can't load, in
    which case callers fall back to marking every row Generic.
    """
    try:
        from faster_whisper import WhisperModel
    except ImportError:
        print("[warn] faster-whisper not installed — skipping audio detection, using random cues.")
        return None

    whisper_cfg = {}
    try:
        with open(CONFIG_PATH) as f:
            whisper_cfg = (yaml.safe_load(f) or {}).get("models", {}).get("whisper", {})
    except (FileNotFoundError, yaml.YAMLError):
        pass

    model_name = whisper_cfg.get("name", "openai/whisper-medium")
    model_size = _WHISPER_SIZE_MAP.get(model_name, whisper_cfg.get("model_size", "medium"))
    compute_type = whisper_cfg.get("compute_type", "int8")
    export_dir = ROOT / whisper_cfg.get("export_dir", "models/whisper-medium")

    try:
        return WhisperModel(model_size, device="cpu", compute_type=compute_type, download_root=str(export_dir))
    except Exception as e:
        print(f"[warn] Could not load Whisper '{model_size}' model ({e}) — skipping audio detection.")
        return None

def load_quick_translator_model():
    """Load the app's own configured NLLB translator (config.yaml) for cue detection.

    Reuses the already-exported model from make-prereq step 5 (no extra download).
    Runs on CPU regardless of config.yaml's configured device, since this is a
    one-off detection pass during setup, not the live app's runtime inference.
    Returns None if the translator can't load (e.g. not yet exported), in which
    case callers fall back to Whisper's own built-in translate task.
    """
    try:
        from src.models.translator import Translator
    except ImportError as e:
        print(f"[warn] Could not import translator module ({e}) — falling back to Whisper's translate task.")
        return None
    try:
        return Translator(device="CPU")
    except Exception as e:
        print(f"[warn] Could not load NLLB translator ({e}) — falling back to Whisper's translate task.")
        return None

def gist_for_language(lang_dir: Path, whisper_model, translator, lang_code: str, max_samples: int) -> str:
    """Return a cased, concatenated English gist of samples in lang_dir.

    Mirrors the app's own default pipeline order: Whisper transcribes each clip
    in its native language (task="transcribe"), then the NLLB translator turns
    that into English — the same models/order the live demo uses, so detection
    text quality matches production instead of Whisper's own lower-quality
    built-in translate mode. Falls back to Whisper's translate task if the NLLB
    translator isn't available. Case is preserved (not lowercased) so proper
    nouns can still be recognized for new-keyword detection.
    max_samples defaults high enough to cover every sample fetch_voice_samples.py
    normally downloads, so detection sees the same audio the demo can play —
    not just an arbitrary subset of it.
    """
    files = sorted(
        f for f in lang_dir.iterdir() if f.suffix.lower() in SAMPLE_EXTS
    )[:max_samples]

    def _transcribe(task: str) -> str:
        texts = []
        for f in files:
            try:
                segments, _info = whisper_model.transcribe(str(f), task=task, beam_size=1, vad_filter=True)
                texts.append(" ".join(seg.text for seg in segments))
            except Exception as e:
                print(f"[warn] Could not transcribe {f.name}: {e}")
        return " ".join(texts).strip()

    if lang_code == "en":
        return _transcribe("transcribe")

    native_text = _transcribe("transcribe")
    if not native_text:
        return ""

    if translator is not None:
        try:
            return translator.translate(native_text, source_lang=lang_code, target_lang="en").strip()
        except Exception as e:
            print(f"[warn] NLLB translation failed for '{lang_code}' ({e}) — falling back to Whisper's translate task.")

    return _transcribe("translate")

def _stem(word: str) -> str:
    """Very small suffix-stripping stemmer — just enough to match plurals and
    common verb inflections (cases/case, developed/develop) without a dependency."""
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

def _stems_match(a: str, b: str) -> bool:
    sa, sb = _stem(a), _stem(b)
    if not sa or not sb:
        return False
    if sa == sb:
        return True
    shorter, longer = (sa, sb) if len(sa) <= len(sb) else (sb, sa)
    # Require a non-trivial common stem before allowing a prefix match, so short
    # fragments (e.g. "co", "in") can't spuriously "match" unrelated long words.
    if len(shorter) < 4:
        return False
    return longer.startswith(shorter)

def detect_cues_in_text(text: str):
    """Return the subset of MISSION_CUE_BANK whose significant words ALL appear in text.

    Matching is stem-based (not exact/substring) so common plural and verb
    inflections still count — e.g. a bank entry for "case numbers" should
    match text containing "cases". Every significant word in the keyword must
    be present (not just one), otherwise a generic word like "contact" would
    falsely flag an unrelated phrase like "emergency contact needed".
    """
    if not text:
        return []
    # Also require len >= 3 on the text side, otherwise trivial fragments like
    # "in"/"he"/"co" (split off e.g. "co-chairman") trivially prefix-match everything.
    text_words = set(w for w in re.findall(r"[a-z']+", text.lower()) if len(w) >= 3)
    hits = []
    for keyword, action in MISSION_CUE_BANK:
        kw_words = [w for w in re.findall(r"[a-z']+", keyword.lower()) if len(w) >= 3 and w not in _STOPWORDS]
        if kw_words and all(any(_stems_match(kw, tw) for tw in text_words) for kw in kw_words):
            hits.append((keyword, action))
    return hits

_NEW_KEYWORD_ACTION = (
    "Newly observed term in this run's sampled audio, not yet part of the curated "
    "bank — note the context and refer any follow-up questions to the coordination desk."
)

def extract_new_keywords(raw_text: str, max_candidates: int = 6) -> list:
    """Find proper-noun-like terms in translated text that the curated bank
    doesn't already reference — real-world entities/topics (place, organization,
    person names) actually present in the audio, worth surfacing instead of
    silently discarding just because they're not in the static bank.

    Only considers capitalized words that are NOT the first word of their
    sentence, since English capitalizes any sentence-initial word regardless
    of whether it's a proper noun.
    """
    if not raw_text:
        return []
    candidates = []
    seen_stems = set()
    for sentence in re.split(r"(?<=[.!?])\s+", raw_text):
        for word in sentence.split()[1:]:
            clean = re.sub(r"[^A-Za-z']", "", word)
            if len(clean) < 4 or not clean[0].isupper():
                continue
            lw = clean.lower()
            if lw in _STOPWORDS:
                continue
            stem = _stem(lw)
            if stem in seen_stems or stem in _BANK_SIGNIFICANT_WORDS:
                continue
            if any(_stems_match(lw, bw) for bw in _BANK_SIGNIFICANT_WORDS):
                continue
            seen_stems.add(stem)
            candidates.append(clean)
            if len(candidates) >= max_candidates:
                return candidates
    return candidates

def load_language_metadata():
    """Return (names, flags) dicts keyed by lowercase language code, from config.yaml."""
    names, flags = {}, {}
    try:
        with open(CONFIG_PATH) as f:
            cfg = yaml.safe_load(f) or {}
        for lang in cfg.get("language", {}).get("supported", []):
            code = str(lang.get("code", "")).lower()
            if code:
                names[code] = lang.get("name", code.upper())
                flags[code] = lang.get("flag", "")
    except (FileNotFoundError, yaml.YAMLError):
        pass
    return names, flags

def discover_sample_dirs():
    """Return {lang_code_lower: dir_path} for non-empty language dirs under voice_samples/."""
    dirs = {}
    if not VOICE_SAMPLES_DIR.is_dir():
        return dirs
    for lang_dir in sorted(VOICE_SAMPLES_DIR.iterdir()):
        if not lang_dir.is_dir():
            continue
        if any(f.suffix.lower() in SAMPLE_EXTS for f in lang_dir.iterdir()):
            dirs[lang_dir.name.lower()] = lang_dir
    return dirs

def render_pdf(cues: list, language_names: list, dest: Path):
    styles = getSampleStyleSheet()
    title_style = ParagraphStyle(
        "MissionTitle", parent=styles["Title"], textColor=colors.HexColor("#0a2a4a"),
    )
    subtitle_style = ParagraphStyle(
        "MissionSubtitle", parent=styles["Normal"], textColor=colors.HexColor("#555555"),
        spaceAfter=14,
    )
    body_style = ParagraphStyle("MissionBody", parent=styles["BodyText"], leading=14)
    header_style = ParagraphStyle(
        "MissionHeader", parent=styles["BodyText"], leading=13,
        textColor=colors.white, fontName="Helvetica-Bold",
    )

    doc = SimpleDocTemplate(
        str(dest), pagesize=LETTER,
        topMargin=0.75 * inch, bottomMargin=0.75 * inch,
        leftMargin=0.75 * inch, rightMargin=0.75 * inch,
        title="Mission Cues Reference",
    )

    elements = [
        Paragraph("Mission Cues Reference", title_style),
        Paragraph(
            f"Demo languages: {', '.join(language_names)} &nbsp;&bull;&nbsp; "
            f"Generated {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",
            subtitle_style,
        ),
        Paragraph(
            "This reference lists English key phrases to listen for during a translated "
            "conversation, and the precise action to take when each is heard. Content is "
            "demo/training material, not a real operational directive. The Detected In "
            "column names the language(s) this run's sampled audio actually contained the "
            "phrase in (source-language audio only); rows marked (new) are proper-noun-like "
            "terms actually heard that aren't yet part of the curated bank; rows marked "
            "Generic fill out the full curated bank for reference.",
            body_style,
        ),
        Spacer(1, 0.2 * inch),
    ]

    table_data = [[
        Paragraph("Key Phrase (English)", header_style),
        Paragraph("Recommended Action", header_style),
        Paragraph("Detected In", header_style),
    ]]
    for keyword, action, detected_langs in cues:
        if not detected_langs:
            status = "Generic"
        elif action == _NEW_KEYWORD_ACTION:
            status = "\u2713 " + ", ".join(detected_langs) + " (new)"
        else:
            status = "\u2713 " + ", ".join(detected_langs)
        table_data.append([
            Paragraph(keyword, body_style),
            Paragraph(action, body_style),
            Paragraph(status, body_style),
        ])

    table = Table(table_data, colWidths=[1.7 * inch, 3.5 * inch, 1.6 * inch], repeatRows=1)
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#0a2a4a")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#eef3f8")]),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#cccccc")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    elements.append(table)

    doc.build(elements)

def select_cues(hits_by_lang: dict, new_keywords_by_lang: dict, names: dict) -> list:
    """Build the full (keyword, action, detected_language_names) list.

    Order: curated bank entries with a real hit (bank order), then auto-detected
    new terms not already in the curated bank (merged across languages so the
    same term found in two languages' audio lists both), then the rest of the
    curated bank with no detections (Generic).
    """
    keyword_langs = {}
    for code, hits in hits_by_lang.items():
        lang_name = names.get(code, code.upper())
        for keyword, _action in hits:
            keyword_langs.setdefault(keyword, []).append(lang_name)

    detected = [(k, a, keyword_langs[k]) for k, a in MISSION_CUE_BANK if k in keyword_langs]
    generic = [(k, a, []) for k, a in MISSION_CUE_BANK if k not in keyword_langs]

    new_terms = {}
    for code, candidates in new_keywords_by_lang.items():
        lang_name = names.get(code, code.upper())
        for word in candidates:
            stem = _stem(word.lower())
            entry = new_terms.setdefault(stem, {"word": word, "langs": []})
            if lang_name not in entry["langs"]:
                entry["langs"].append(lang_name)
    new_rows = [(entry["word"], _NEW_KEYWORD_ACTION, entry["langs"]) for entry in new_terms.values()]

    return detected + new_rows + generic

def main():
    parser = argparse.ArgumentParser(description="Generate a single Mission Cues PDF reference covering all demo languages.")
    parser.add_argument("--max-samples", type=int, default=25,
                         help="Max audio clips per language to skim for detection (default: 25, "
                              "comfortably above what fetch_voice_samples.py normally downloads).")
    parser.add_argument("--no-detect", action="store_true",
                         help="Skip the transcribe+translate detection pass; mark every row Generic.")
    args = parser.parse_args()

    if OUTPUT_DIR.exists():
        shutil.rmtree(OUTPUT_DIR)
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    lang_dirs = discover_sample_dirs()
    if not lang_dirs:
        print("[warn] No voice samples found under voice_samples/ — run fetch_voice_samples.py first.")
        print("       Skipping mission-cues generation.")
        return

    names, _flags = load_language_metadata()

    hits_by_lang = {}
    new_keywords_by_lang = {}
    if not args.no_detect:
        whisper_model = load_quick_whisper_model()
        if whisper_model is not None:
            translator = load_quick_translator_model()
            pipeline_desc = ("the app's Whisper (transcribe) + NLLB (translate) pipeline" if translator is not None
                              else "Whisper's built-in translate task (NLLB unavailable)")
            print(f"[detect] Skimming up to {args.max_samples} sample(s)/language with {pipeline_desc}...")
            for code, lang_dir in lang_dirs.items():
                gist = gist_for_language(lang_dir, whisper_model, translator, code, args.max_samples)
                hits_by_lang[code] = detect_cues_in_text(gist)
                new_keywords_by_lang[code] = extract_new_keywords(gist)

    cues = select_cues(hits_by_lang, new_keywords_by_lang, names)
    language_names = [names.get(code, code.upper()) for code in sorted(lang_dirs)]
    dest = OUTPUT_DIR / "mission-cues.pdf"
    render_pdf(cues, language_names, dest)

    n_detected = sum(1 for k, _a, langs in cues if langs and k in {kw for kw, _ in MISSION_CUE_BANK})
    n_new = sum(1 for _k, a, langs in cues if langs and a == _NEW_KEYWORD_ACTION)
    print(f"[ok] Wrote {len(cues)} mission cues ({n_detected} curated hits, {n_new} newly observed terms, "
          f"across {len(language_names)} language(s)) -> {dest}")

if __name__ == "__main__":
    main()
