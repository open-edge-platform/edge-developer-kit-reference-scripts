"""SQLite storage for conversation and sentiment history."""

import json
import logging
import sqlite3
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

# Default database location (relative to project root)
_DEFAULT_DB_PATH = Path(__file__).resolve().parents[3] / "data" / "local_lingua.db"

# FastAPI runs sync route handlers in a threadpool, so concurrent requests (a
# session/languages update alongside a sentiment save, two demo-flow requests
# firing close together, etc.) can call into this module from different
# threads at once. A single sqlite3.Connection is not safe for concurrent use
# across threads even with check_same_thread=False — that flag only disables
# Python's own thread-affinity assertion, it doesn't add locking — and
# concurrent execute()/commit() calls on the same connection surface as
# `sqlite3.InterfaceError: bad parameter or other API misuse`. Serializing all
# access through one lock is the simplest correct fix for a single shared
# connection; use RLock so a function that calls another locked function
# (save_model_assignment -> save_setting) doesn't deadlock on itself.
_db_lock = threading.RLock()


def _get_connection(db_path: Optional[Path] = None) -> sqlite3.Connection:
    path = db_path or _DEFAULT_DB_PATH
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=5000")
    return conn


_conn: Optional[sqlite3.Connection] = None


def init_db(db_path: Optional[Path] = None) -> None:
    """Create tables for conversations and sentiment if they do not exist."""
    global _conn
    with _db_lock:
        _conn = _get_connection(db_path)

        _conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS conversations (
                message_id TEXT PRIMARY KEY,
                conversation_id TEXT NOT NULL,
                timestamp TEXT NOT NULL,
                speaker_type TEXT NOT NULL,
                source_language TEXT NOT NULL,
                target_language TEXT NOT NULL,
                original_text TEXT NOT NULL,
                translated_text TEXT DEFAULT '',
                input_type TEXT NOT NULL,
                audio_path TEXT,
                tts_audio_path TEXT,
                model_transcription TEXT,
                model_translation TEXT,
                model_tts TEXT,
                target_transcription TEXT,
                target_translation TEXT,
                target_tts TEXT
            );

            CREATE TABLE IF NOT EXISTS sentiments (
                sentiment_id TEXT PRIMARY KEY,
                conversation_id TEXT NOT NULL,
                message_id TEXT NOT NULL,
                timestamp TEXT NOT NULL,
                high_level_sentiment TEXT NOT NULL,
                confidence_score REAL NOT NULL,
                detailed_report TEXT DEFAULT '',
                key_phrases TEXT DEFAULT '[]',
                model_used TEXT DEFAULT '',
                runtime_target TEXT DEFAULT 'CPU',
                voice_emotion TEXT DEFAULT NULL,
                speaker_type TEXT DEFAULT 'local_speaker'
            );

            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_conv_timestamp
                ON conversations(timestamp);
            CREATE INDEX IF NOT EXISTS idx_conv_conversation
                ON conversations(conversation_id);
            CREATE INDEX IF NOT EXISTS idx_sent_timestamp
                ON sentiments(timestamp);
            CREATE INDEX IF NOT EXISTS idx_sent_message
                ON sentiments(message_id);
            """
        )
        _conn.commit()

        # Migrate: add new columns if missing (existing DBs)
        cursor = _conn.execute("PRAGMA table_info(sentiments)")
        columns = {row[1] for row in cursor.fetchall()}
        if "voice_emotion" not in columns:
            _conn.execute("ALTER TABLE sentiments ADD COLUMN voice_emotion TEXT DEFAULT NULL")
        if "speaker_type" not in columns:
            _conn.execute("ALTER TABLE sentiments ADD COLUMN speaker_type TEXT DEFAULT 'local_speaker'")
        _conn.commit()

    logger.info("Database initialised at %s", db_path or _DEFAULT_DB_PATH)


def _get_conn() -> sqlite3.Connection:
    if _conn is None:
        init_db()
    return _conn  # type: ignore[return-value]


# ---------------------------------------------------------------------------
# Conversation CRUD
# ---------------------------------------------------------------------------


def save_message(message: Dict[str, Any]) -> Dict[str, Any]:
    """Insert a conversation message and return it with generated IDs."""
    msg_id = message.get("messageId") or str(uuid.uuid4())
    conv_id = message.get("conversationId") or str(uuid.uuid4())
    now = message.get("timestamp") or datetime.now(timezone.utc).isoformat()

    models_used = message.get("modelsUsed", {})
    runtime_targets = message.get("runtimeTargets", {})

    with _db_lock:
        conn = _get_conn()
        conn.execute(
            """
            INSERT INTO conversations (
                message_id, conversation_id, timestamp, speaker_type,
                source_language, target_language, original_text, translated_text,
                input_type, audio_path, tts_audio_path,
                model_transcription, model_translation, model_tts,
                target_transcription, target_translation, target_tts
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                msg_id,
                conv_id,
                now,
                message.get("speakerType", "user"),
                message.get("sourceLanguage", "en"),
                message.get("targetLanguage", "en"),
                message.get("originalText", ""),
                message.get("translatedText", ""),
                message.get("inputType", "text"),
                message.get("audioPath"),
                message.get("ttsAudioPath"),
                models_used.get("transcription", ""),
                models_used.get("translation", ""),
                models_used.get("textToSpeech", ""),
                runtime_targets.get("transcription", "CPU"),
                runtime_targets.get("translation", "CPU"),
                runtime_targets.get("textToSpeech", "CPU"),
            ),
        )
        conn.commit()

    return {
        "messageId": msg_id,
        "conversationId": conv_id,
        "timestamp": now,
        "speakerType": message.get("speakerType", "user"),
        "sourceLanguage": message.get("sourceLanguage", "en"),
        "targetLanguage": message.get("targetLanguage", "en"),
        "originalText": message.get("originalText", ""),
        "translatedText": message.get("translatedText", ""),
        "inputType": message.get("inputType", "text"),
        "audioPath": message.get("audioPath"),
        "ttsAudioPath": message.get("ttsAudioPath"),
        "modelsUsed": models_used,
        "runtimeTargets": runtime_targets,
    }


def get_messages(search: Optional[str] = None) -> List[Dict[str, Any]]:
    """Return conversation messages, optionally filtered by keyword search."""
    with _db_lock:
        conn = _get_conn()
        if search:
            query = """
                SELECT * FROM conversations
                WHERE original_text LIKE ? OR translated_text LIKE ?
                ORDER BY timestamp DESC
            """
            pattern = f"%{search}%"
            rows = conn.execute(query, (pattern, pattern)).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM conversations ORDER BY timestamp DESC"
            ).fetchall()

    return [_row_to_message(r) for r in rows]


def clear_messages() -> int:
    """Delete all conversation messages. Returns count deleted."""
    with _db_lock:
        conn = _get_conn()
        cursor = conn.execute("DELETE FROM conversations")
        conn.commit()
        count = cursor.rowcount
    logger.info("Cleared %d conversation messages", count)
    return count


# ---------------------------------------------------------------------------
# Sentiment CRUD
# ---------------------------------------------------------------------------


def save_sentiment(record: Dict[str, Any]) -> Dict[str, Any]:
    """Insert a sentiment record and return it with generated IDs."""
    sent_id = record.get("sentimentId") or str(uuid.uuid4())
    conv_id = record.get("conversationId") or ""
    msg_id = record.get("messageId") or ""
    now = record.get("timestamp") or datetime.now(timezone.utc).isoformat()

    import json

    key_phrases = json.dumps(record.get("keyPhrases", []))
    voice_emotion = json.dumps(record.get("voiceEmotion")) if record.get("voiceEmotion") else None
    speaker_type = record.get("speakerType", "local_speaker")

    with _db_lock:
        conn = _get_conn()
        conn.execute(
            """
            INSERT INTO sentiments (
                sentiment_id, conversation_id, message_id, timestamp,
                high_level_sentiment, confidence_score, detailed_report,
                key_phrases, model_used, runtime_target, voice_emotion,
                speaker_type
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                sent_id,
                conv_id,
                msg_id,
                now,
                record.get("highLevelSentiment", "neutral"),
                record.get("confidenceScore", 0.0),
                record.get("detailedReport", ""),
                key_phrases,
                record.get("modelUsed", ""),
                record.get("runtimeTarget", "CPU"),
                voice_emotion,
                speaker_type,
            ),
        )
        conn.commit()

    return {
        "sentimentId": sent_id,
        "conversationId": conv_id,
        "messageId": msg_id,
        "timestamp": now,
        "highLevelSentiment": record.get("highLevelSentiment", "neutral"),
        "confidenceScore": record.get("confidenceScore", 0.0),
        "detailedReport": record.get("detailedReport", ""),
        "keyPhrases": record.get("keyPhrases", []),
        "modelUsed": record.get("modelUsed", ""),
        "runtimeTarget": record.get("runtimeTarget", "CPU"),
        "voiceEmotion": record.get("voiceEmotion"),
        "speakerType": speaker_type,
    }


def get_sentiments(search: Optional[str] = None) -> List[Dict[str, Any]]:
    """Return sentiment records, optionally filtered by keyword search."""
    with _db_lock:
        conn = _get_conn()
        if search:
            query = """
                SELECT * FROM sentiments
                WHERE detailed_report LIKE ?
                   OR high_level_sentiment LIKE ?
                   OR key_phrases LIKE ?
                ORDER BY timestamp DESC
            """
            pattern = f"%{search}%"
            rows = conn.execute(query, (pattern, pattern, pattern)).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM sentiments ORDER BY timestamp DESC"
            ).fetchall()

    return [_row_to_sentiment(r) for r in rows]


def clear_sentiments() -> int:
    """Delete all sentiment records. Returns count deleted."""
    with _db_lock:
        conn = _get_conn()
        cursor = conn.execute("DELETE FROM sentiments")
        conn.commit()
        count = cursor.rowcount
    logger.info("Cleared %d sentiment records", count)
    return count


# ---------------------------------------------------------------------------
# Row converters
# ---------------------------------------------------------------------------


def _row_to_message(row: sqlite3.Row) -> Dict[str, Any]:
    return {
        "messageId": row["message_id"],
        "conversationId": row["conversation_id"],
        "timestamp": row["timestamp"],
        "speakerType": row["speaker_type"],
        "sourceLanguage": row["source_language"],
        "targetLanguage": row["target_language"],
        "originalText": row["original_text"],
        "translatedText": row["translated_text"],
        "inputType": row["input_type"],
        "audioPath": row["audio_path"],
        "ttsAudioPath": row["tts_audio_path"],
        "modelsUsed": {
            "transcription": row["model_transcription"] or "",
            "translation": row["model_translation"] or "",
            "textToSpeech": row["model_tts"] or "",
        },
        "runtimeTargets": {
            "transcription": row["target_transcription"] or "CPU",
            "translation": row["target_translation"] or "CPU",
            "textToSpeech": row["target_tts"] or "CPU",
        },
    }


def _row_to_sentiment(row: sqlite3.Row) -> Dict[str, Any]:
    import json

    key_phrases = []
    try:
        key_phrases = json.loads(row["key_phrases"])
    except (json.JSONDecodeError, TypeError):
        pass

    voice_emotion = None
    try:
        raw = row["voice_emotion"]
        if raw:
            voice_emotion = json.loads(raw)
    except (json.JSONDecodeError, TypeError, KeyError):
        pass

    speaker_type = "local_speaker"
    try:
        speaker_type = row["speaker_type"] or "local_speaker"
    except (KeyError, IndexError):
        pass

    return {
        "sentimentId": row["sentiment_id"],
        "conversationId": row["conversation_id"],
        "messageId": row["message_id"],
        "timestamp": row["timestamp"],
        "highLevelSentiment": row["high_level_sentiment"],
        "confidenceScore": row["confidence_score"],
        "detailedReport": row["detailed_report"],
        "keyPhrases": key_phrases,
        "modelUsed": row["model_used"],
        "runtimeTarget": row["runtime_target"],
        "voiceEmotion": voice_emotion,
        "speakerType": speaker_type,
    }


# ---------------------------------------------------------------------------
# Settings CRUD
# ---------------------------------------------------------------------------


def save_setting(key: str, value: str) -> None:
    """Upsert a key-value setting."""
    with _db_lock:
        conn = _get_conn()
        conn.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
            (key, value),
        )
        conn.commit()


def get_setting(key: str, default: Optional[str] = None) -> Optional[str]:
    """Get a setting value by key."""
    with _db_lock:
        conn = _get_conn()
        row = conn.execute(
            "SELECT value FROM settings WHERE key = ?", (key,)
        ).fetchone()
    return row["value"] if row else default


# Per-stage model/target selections are stored as individual settings rows so
# they survive a restart — without this the Settings tab silently reverts to
# the config.yaml defaults on every app launch.
_ASSIGNMENT_PREFIX = "model_assignment."


def save_model_assignment(stage: str, model_id: str, target: str) -> None:
    """Persist a stage's model+target selection."""
    save_setting(
        f"{_ASSIGNMENT_PREFIX}{stage}",
        json.dumps({"modelId": model_id, "target": target}),
    )


def get_model_assignments() -> Dict[str, Dict[str, str]]:
    """Return all persisted stage selections as {stage: {modelId, target}}."""
    with _db_lock:
        conn = _get_conn()
        rows = conn.execute(
            "SELECT key, value FROM settings WHERE key LIKE ?",
            (f"{_ASSIGNMENT_PREFIX}%",),
        ).fetchall()

    assignments: Dict[str, Dict[str, str]] = {}
    for row in rows:
        stage = row["key"][len(_ASSIGNMENT_PREFIX):]
        try:
            assignments[stage] = json.loads(row["value"])
        except (json.JSONDecodeError, TypeError):
            logger.warning("Ignoring malformed saved assignment for stage '%s'", stage)
    return assignments


def clear_model_assignment(stage: str) -> None:
    """Drop a persisted selection so the stage reverts to the config default."""
    with _db_lock:
        conn = _get_conn()
        conn.execute(
            "DELETE FROM settings WHERE key = ?", (f"{_ASSIGNMENT_PREFIX}{stage}",)
        )
        conn.commit()
