"""Pipeline orchestration service — processes input through the AI pipeline.

All models are loaded in-process (monolith mode). Each AI stage runs via
OpenVINO or CTranslate2 directly within this process.
"""

import concurrent.futures
import io
import logging
import os
# Only invoked below with hardcoded argv lists, never shell=True.
import subprocess  # nosec B404
import tempfile
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional

import numpy as np

from src.backend.services.activity_service import track_inference
from src.backend.services.model_registry import ModelRegistry
from src.backend.storage import database as db

logger = logging.getLogger(__name__)

ROOT_DIR = Path(__file__).resolve().parents[3]

# Consecutive translation failures before assuming the device itself (not the
# input text) is the problem and recompiling on CPU. A GPU/NPU plugin that
# hits an out-of-memory error mid-generation can leave its allocator unusable
# for every later call, so retrying on the same device forever just repeats
# the failure — recompiling clears that state, and CPU is the one target that
# will not hit the same memory ceiling.
_TRANSLATION_FAILURE_THRESHOLD = 2


def _audio_bytes_to_float32_16khz(audio_bytes: bytes) -> np.ndarray:
    """Decode any audio format (WAV, MP3, WebM, OGG, etc.) to 16kHz mono float32.

    Uses ffmpeg subprocess to handle format conversion, then reads the
    resulting raw PCM. Falls back to scipy wavfile for pure WAV input.
    """

    # Try scipy wavfile first for WAV files (fast path, no subprocess)
    if audio_bytes[:4] == b'RIFF':
        try:
            from scipy.io import wavfile

            buf = io.BytesIO(audio_bytes)
            sample_rate, data = wavfile.read(buf)

            if data.dtype == np.int16:
                data = data.astype(np.float32) / 32768.0
            elif data.dtype == np.int32:
                data = data.astype(np.float32) / 2147483648.0
            elif data.dtype == np.uint8:
                data = (data.astype(np.float32) - 128.0) / 128.0
            elif data.dtype != np.float32:
                data = data.astype(np.float32)

            if data.ndim > 1:
                data = data.mean(axis=1)

            if sample_rate != 16000:
                from scipy.signal import resample

                num_samples = int(len(data) * 16000 / sample_rate)
                data = resample(data, num_samples).astype(np.float32)
                logger.debug("Resampled WAV from %d Hz to 16000 Hz", sample_rate)

            return data
        except Exception:
            logger.debug("scipy wavfile failed, falling through to ffmpeg")

    # Use ffmpeg for all other formats (MP3, WebM, OGG, FLAC, etc.)
    with tempfile.NamedTemporaryFile(suffix=".audio", delete=False) as tmp_in:
        tmp_in.write(audio_bytes)
        tmp_in_path = tmp_in.name

    try:
        result = subprocess.run(
            [
                "ffmpeg", "-y",
                "-protocol_whitelist", "file,pipe",
                "-i", tmp_in_path,
                "-ar", "16000",
                "-ac", "1",
                "-f", "f32le",
                "-acodec", "pcm_f32le",
                "pipe:1",
            ],
            capture_output=True,
            timeout=300,
        )

        if result.returncode != 0:
            logger.error("ffmpeg stderr: %s", result.stderr.decode(errors="replace")[:500])
            raise RuntimeError("Audio decoding failed — unsupported format or corrupted file")

        data = np.frombuffer(result.stdout, dtype=np.float32)

        if len(data) == 0:
            raise RuntimeError("ffmpeg produced empty output")

        logger.debug(
            "ffmpeg decoded %d bytes -> %d samples at 16kHz",
            len(audio_bytes),
            len(data),
        )
        return data

    finally:
        os.unlink(tmp_in_path)


class PipelineService:
    """Orchestrates the transcription/translation/sentiment pipeline.

    Uses the model registry to determine which models and targets are
    currently assigned, then routes input through the appropriate stages.

    Model loading is handled by src.models.loader — adding a new model
    only requires a config entry + a registered class in loader.py.

    Concurrency model:
    - Per-stage threading.Lock prevents concurrent OV infer requests
    - asyncio.to_thread() in routes.py offloads blocking work off the event loop
    - No nested lock acquisition → deadlock-free
    """

    def __init__(self, registry: ModelRegistry, config: dict | None = None) -> None:
        import threading

        self._registry = registry
        self._config = config
        self._stages: Dict[str, Any] = {}
        self._lang_detector = None

        # Per-stage locks: prevent concurrent inference on the same OV model
        self._stage_locks = {
            "transcription": threading.Lock(),
            "translation": threading.Lock(),
            "sentiment": threading.Lock(),
            "text_to_speech": threading.Lock(),
            "voice_emotion": threading.Lock(),
        }

        # Conversation sentiment summary (rolling aggregate)
        self._summary_lock = threading.Lock()

        # Bumped every time history is cleared. A request captures this when it
        # starts; if it no longer matches by the time the request has something to
        # persist, the user cleared history mid-flight and the result is dropped
        # rather than written back into a transcript they just emptied.
        self._clear_generation = 0
        # Separate counter for sentiment history specifically: clearing only the
        # Sentiment History panel (DELETE /api/sentiment/history) must not discard
        # an in-flight request's conversation message, only its sentiment result —
        # so it is gated on its own generation rather than sharing _clear_generation.
        # A full conversation clear bumps both.
        self._sentiment_generation = 0
        self._conversation_summary = {
            "averageScore": 0.5,
            "overallSentiment": "neutral",
            "messageCount": 0,
            "distribution": {"positive": 0, "negative": 0, "neutral": 0},
        }

        # Track last detected local speaker language for user reply targeting
        self._last_detected_language: Optional[str] = None

        # Consecutive translation failures in a row — see _maybe_recover_translation.
        self._translation_failure_streak = 0

        self._load_models()
        logger.info("Pipeline running in monolith mode — models loaded in-process")

    @property
    def _transcriber(self):
        return self._stages.get("transcription")

    @property
    def _translator(self):
        return self._stages.get("translation")

    @property
    def _sentiment_analyzer(self):
        return self._stages.get("sentiment")

    @property
    def _tts(self):
        return self._stages.get("text_to_speech")

    @property
    def _voice_emotion_analyzer(self):
        return self._stages.get("voice_emotion")

    def _stage_device(self, stage: str) -> str:
        """Return the device a stage's model actually runs on (may differ from
        the requested target when a fallback occurred)."""
        model = self._stages.get(stage)
        return getattr(model, "device", None) or "CPU"

    def _load_models(self) -> None:
        """Load all models using the config-driven loader."""
        from src.models.loader import load_model

        # Language detector (pure Python, no device)
        try:
            from src.models.lang_detect import LanguageDetector
            self._lang_detector = LanguageDetector(config=self._config)
            logger.info("LanguageDetector loaded")
        except Exception as exc:
            logger.error("Failed to load LanguageDetector: %s", exc)

        # Load each pipeline stage via the loader factory
        for stage in ["transcription", "translation", "sentiment", "text_to_speech", "voice_emotion"]:
            assignment = self._registry.get_current_assignment(stage)
            device = assignment["target"] if assignment else "CPU"
            model_id = assignment["modelId"] if assignment else None

            try:
                model = load_model(stage, device=device, config=self._config, model_id=model_id)
            except Exception as exc:
                # A persisted target that no longer works (driver gone, model
                # re-exported with a different shape) would otherwise disable
                # the stage on every boot. Retry once on CPU and record it.
                if device.upper() == "CPU":
                    logger.error("Failed to load %s on CPU: %s", stage, exc)
                    continue

                logger.error(
                    "Failed to load %s on %s (%s) — retrying on CPU", stage, device, exc
                )
                try:
                    model = load_model(
                        stage, device="CPU", config=self._config, model_id=model_id
                    )
                except Exception as cpu_exc:
                    logger.error("Failed to load %s on CPU as well: %s", stage, cpu_exc)
                    continue
                self._registry.downgrade_target(stage, "CPU", str(exc))

            if not model:
                logger.warning("%s: no model loaded", stage)
                continue

            self._stages[stage] = model
            logger.info("%s loaded on %s (model: %s)", stage, model.device, model_id)

            # Some wrappers fall back to CPU internally; keep the registry (and
            # therefore the Settings tab) showing the device actually in use.
            if model.device and model.device.upper() != device.upper():
                self._registry.downgrade_target(
                    stage, model.device, "model wrapper fell back during load"
                )

    def reload_stage(self, stage: str, target: str) -> None:
        """Hot-reload a model for a given pipeline stage on a new target device.

        Reads the current model assignment from the registry so that if the user
        selected an alternative model, the correct weights are loaded.
        """
        from src.models.loader import load_model

        effective_stage = "transcription" if stage == "audio_to_text" else stage
        lock = self._stage_locks.get(effective_stage)
        if not lock:
            raise ValueError(f"Unknown stage: {effective_stage}")

        assignment = self._registry.get_current_assignment(effective_stage)
        model_id = assignment["modelId"] if assignment else None

        with lock:
            try:
                model = load_model(
                    effective_stage, device=target, config=self._config, model_id=model_id
                )
                if model:
                    self._stages[effective_stage] = model
                    logger.info("%s reloaded on %s (model: %s)", effective_stage, target, model_id)
                else:
                    raise RuntimeError(f"Loader returned None for {effective_stage}")
            except Exception as exc:
                logger.error("Failed to reload %s on %s: %s", effective_stage, target, exc)
                raise

    def get_conversation_summary(self) -> Dict[str, Any]:
        """Return the current conversation sentiment summary."""
        with self._summary_lock:
            return dict(self._conversation_summary)

    def reset_conversation_summary(self) -> None:
        """Reset the conversation summary (called when history is cleared)."""
        with self._summary_lock:
            self._conversation_summary = {
                "averageScore": 0.5,
                "overallSentiment": "neutral",
                "messageCount": 0,
                "distribution": {"positive": 0, "negative": 0, "neutral": 0},
            }

    def reset_conversation_state(self) -> None:
        """Reset all per-conversation state (called when conversation is cleared)."""
        self.reset_conversation_summary()
        self._last_detected_language = None
        with self._summary_lock:
            self._clear_generation += 1
            self._sentiment_generation += 1

    def reset_sentiment_state(self) -> None:
        """Reset sentiment-only state (called when just the Sentiment History is cleared).

        Leaves the conversation transcript and _last_detected_language alone — a
        request already in flight still gets its message saved, only its sentiment
        result and the rolling summary are discarded.
        """
        self.reset_conversation_summary()
        with self._summary_lock:
            self._sentiment_generation += 1

    def current_generation(self) -> int:
        """Clear generation to stamp a request with when it starts."""
        with self._summary_lock:
            return self._clear_generation

    def current_sentiment_generation(self) -> int:
        """Sentiment-clear generation to stamp a request with when it starts."""
        with self._summary_lock:
            return self._sentiment_generation

    def _is_current(self, generation: int) -> bool:
        with self._summary_lock:
            return generation == self._clear_generation

    def _is_sentiment_current(self, generation: int) -> bool:
        with self._summary_lock:
            return generation == self._sentiment_generation

    def _persist_message(self, message: Dict[str, Any], generation: int) -> Dict[str, Any]:
        """Save the message unless history was cleared while this request ran.

        Returns the message either way so the caller can still build a response; a
        dropped one is flagged so the frontend knows not to render it.
        """
        if not self._is_current(generation):
            logger.info(
                "Discarding %s message — history was cleared while it was processing",
                message.get("speakerType", "unknown"),
            )
            return {**message, "discarded": True}
        return db.save_message(message)

    def _persist_sentiment(self, record: Dict[str, Any], generation: int) -> bool:
        """Save the sentiment record unless sentiment history was cleared while this ran."""
        if not self._is_sentiment_current(generation):
            logger.debug("Discarding sentiment record — sentiment history was cleared mid-request")
            return False
        db.save_sentiment(record)
        return True

    def _update_conversation_summary(
        self, sentiment_label: str, score: float, generation: Optional[int] = None
    ) -> Dict[str, Any]:
        """Update rolling conversation summary with a new sentiment result.

        A request whose result was discarded must not be counted, or the summary
        would report messages that are not in the transcript.
        """
        if generation is not None and not self._is_sentiment_current(generation):
            return self.get_conversation_summary()

        with self._summary_lock:
            alpha = 0.3
            self._conversation_summary["messageCount"] += 1
            self._conversation_summary["distribution"][sentiment_label] += 1

            # Map to numeric scale: positive=high, negative=low
            if sentiment_label == "positive":
                numeric = score
            elif sentiment_label == "negative":
                numeric = 1.0 - score
            else:
                numeric = 0.5

            prev = self._conversation_summary["averageScore"]
            new_avg = alpha * numeric + (1 - alpha) * prev
            self._conversation_summary["averageScore"] = new_avg

            if new_avg > 0.6:
                self._conversation_summary["overallSentiment"] = "positive"
            elif new_avg < 0.4:
                self._conversation_summary["overallSentiment"] = "negative"
            else:
                self._conversation_summary["overallSentiment"] = "neutral"

            return dict(self._conversation_summary)

    def process_local_input(
        self,
        audio_bytes: bytes,
        source_language: str,
        target_language: str,
    ) -> Dict[str, Any]:
        """Process local/native speaker audio input.

        Pipeline: audio -> transcription -> translation -> store message

        Parameters
        ----------
        audio_bytes : bytes
            Raw audio file bytes (WAV/PCM expected, 16kHz mono).
        source_language : str
            Language code of the local speaker (e.g. "fr").
        target_language : str
            Language code to translate into (e.g. "en").

        Returns
        -------
        Conversation message dict matching the plan's schema.
        """
        start = time.perf_counter()
        # Stamp the request so a clear that lands mid-flight discards its result.
        generation = self.current_generation()
        sentiment_generation = self.current_sentiment_generation()

        # Get current model assignments
        transcription_assignment = self._registry.get_current_assignment(
            "transcription"
        )
        translation_assignment = self._registry.get_current_assignment(
            "translation"
        )
        tts_assignment = self._registry.get_current_assignment("text_to_speech")

        # Use last detected language as Whisper hint for better accuracy on short audio
        transcribe_hint = source_language
        if transcribe_hint == "auto":
            transcribe_hint = self._last_detected_language or "auto"

        transcribed_text, whisper_detected_lang = self._transcribe_with_language(
            audio_bytes, transcribe_hint
        )
        transcription_latency = time.perf_counter() - start
        logger.debug(
            "Transcription latency: %.3f s", transcription_latency
        )

        # Resolve source language — prefer Whisper's acoustic detection over langdetect
        if source_language == "auto" and transcribed_text:
            if whisper_detected_lang:
                source_language = whisper_detected_lang
                self._last_detected_language = whisper_detected_lang
                logger.info("Whisper detected source language: %s", whisper_detected_lang)
            else:
                detected = self._detect_language(transcribed_text)
                if detected:
                    source_language = detected
                    self._last_detected_language = detected
                    logger.info("langdetect fallback detected language: %s", detected)

        # Run translation and voice emotion analysis in parallel.
        # Voice emotion runs on NPU while translation runs on GPU — no contention.
        audio_float32 = _audio_bytes_to_float32_16khz(audio_bytes)
        voice_emotion_result = {}

        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
            translate_future = executor.submit(
                self._translate, transcribed_text, source_language, target_language
            )
            voice_future = executor.submit(self._analyze_voice_emotion, audio_float32)

            translated_text = translate_future.result()
            voice_emotion_result = voice_future.result()

        translation_latency = time.perf_counter() - (start + transcription_latency)
        logger.debug("Translation latency: %.3f s", translation_latency)

        # Build conversation message
        message = {
            "messageId": str(uuid.uuid4()),
            "conversationId": str(uuid.uuid4()),
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "speakerType": "local_speaker",
            "sourceLanguage": source_language,
            "targetLanguage": target_language,
            "originalText": transcribed_text,
            "translatedText": translated_text,
            "inputType": "mic",
            "audioPath": None,
            "ttsAudioPath": None,
            "modelsUsed": {
                "transcription": (
                    transcription_assignment["modelId"]
                    if transcription_assignment
                    else ""
                ),
                "translation": (
                    translation_assignment["modelId"]
                    if translation_assignment
                    else ""
                ),
                "textToSpeech": (
                    tts_assignment["modelId"] if tts_assignment else ""
                ),
            },
            "runtimeTargets": {
                "transcription": (
                    transcription_assignment["target"]
                    if transcription_assignment
                    else "CPU"
                ),
                "translation": (
                    translation_assignment["target"]
                    if translation_assignment
                    else "CPU"
                ),
                "textToSpeech": (
                    tts_assignment["target"] if tts_assignment else "CPU"
                ),
            },
        }

        # Persist to database
        saved = self._persist_message(message, generation)

        # Text sentiment — model is English-only, ensure English input
        if target_language == "en":
            text_for_sentiment = translated_text or transcribed_text
        elif source_language == "en":
            text_for_sentiment = transcribed_text
        else:
            text_for_sentiment = self._ensure_english_for_sentiment(
                transcribed_text or translated_text, source_language
            )
        sentiment_result = self._analyze_sentiment(text_for_sentiment)
        sentiment_label = self._map_sentiment_label(sentiment_result)
        sentiment_score = sentiment_result.get("score", 0.5)

        # Fuse text sentiment with voice emotion
        fused_result = self._fuse_sentiment(sentiment_result, voice_emotion_result)

        sentiment_record = {
            "sentimentId": str(uuid.uuid4()),
            "conversationId": saved.get("conversationId", ""),
            "messageId": saved.get("messageId", ""),
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "highLevelSentiment": fused_result["fusedSentiment"],
            "confidenceScore": fused_result["fusedScore"],
            "detailedReport": self._format_detailed_report(sentiment_result, voice_emotion_result),
            "keyPhrases": [text_for_sentiment] if text_for_sentiment else [],
            "modelUsed": (
                self._registry.get_current_assignment("sentiment") or {}
            ).get("modelId", ""),
            "runtimeTarget": (
                self._registry.get_current_assignment("sentiment") or {}
            ).get("target", "CPU"),
            "voiceEmotion": voice_emotion_result if voice_emotion_result.get("emotion") else None,
            "fusedResult": fused_result,
            "speakerType": "local_speaker",
        }
        self._persist_sentiment(sentiment_record, sentiment_generation)
        summary = self._update_conversation_summary(
            fused_result["fusedSentiment"], fused_result["fusedScore"], sentiment_generation
        )

        saved["sentiment"] = sentiment_record
        saved["conversationSummary"] = summary

        total_latency = time.perf_counter() - start
        logger.debug("Total local input pipeline: %.3f s", total_latency)
        return saved

    def process_local_text_input(
        self,
        text: str,
        source_language: str,
        target_language: str,
    ) -> Dict[str, Any]:
        """Process local speaker text input (typed, no audio).

        Pipeline: text -> translation -> store message
        """
        start = time.perf_counter()
        # Stamp the request so a clear that lands mid-flight discards its result.
        generation = self.current_generation()
        sentiment_generation = self.current_sentiment_generation()

        # Resolve source language if auto
        if source_language == "auto" and text:
            detected = self._detect_language(text)
            if detected:
                source_language = detected
                self._last_detected_language = detected

        translation_assignment = self._registry.get_current_assignment("translation")
        tts_assignment = self._registry.get_current_assignment("text_to_speech")

        translate_start = time.perf_counter()
        translated_text = self._translate(text, source_language, target_language)
        translation_latency = time.perf_counter() - translate_start
        logger.debug("Translation latency: %.3f s", translation_latency)

        message = {
            "messageId": str(uuid.uuid4()),
            "conversationId": str(uuid.uuid4()),
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "speakerType": "local_speaker",
            "sourceLanguage": source_language,
            "targetLanguage": target_language,
            "originalText": text,
            "translatedText": translated_text,
            "inputType": "text",
            "audioPath": None,
            "ttsAudioPath": None,
            "modelsUsed": {
                "transcription": "",
                "translation": (
                    translation_assignment["modelId"]
                    if translation_assignment
                    else ""
                ),
                "textToSpeech": (
                    tts_assignment["modelId"] if tts_assignment else ""
                ),
            },
            "runtimeTargets": {
                "transcription": "CPU",
                "translation": (
                    translation_assignment["target"]
                    if translation_assignment
                    else "CPU"
                ),
                "textToSpeech": (
                    tts_assignment["target"] if tts_assignment else "CPU"
                ),
            },
        }

        saved = self._persist_message(message, generation)

        # Sentiment runs on English text only (model is English-only)
        if target_language == "en":
            text_for_sentiment = translated_text or text
        elif source_language == "en":
            text_for_sentiment = text
        else:
            text_for_sentiment = self._ensure_english_for_sentiment(
                text, source_language
            )
        sentiment_result = self._analyze_sentiment(text_for_sentiment)
        sentiment_label = self._map_sentiment_label(sentiment_result)
        sentiment_score = sentiment_result.get("score", 0.5)

        fused_result = self._fuse_sentiment(sentiment_result, {})

        sentiment_record = {
            "sentimentId": str(uuid.uuid4()),
            "conversationId": saved.get("conversationId", ""),
            "messageId": saved.get("messageId", ""),
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "highLevelSentiment": sentiment_label,
            "confidenceScore": sentiment_score,
            "detailedReport": self._format_detailed_report(sentiment_result, {}),
            "keyPhrases": [text_for_sentiment] if text_for_sentiment else [],
            "modelUsed": (
                self._registry.get_current_assignment("sentiment") or {}
            ).get("modelId", ""),
            "runtimeTarget": (
                self._registry.get_current_assignment("sentiment") or {}
            ).get("target", "CPU"),
            "voiceEmotion": None,
            "fusedResult": fused_result,
            "speakerType": "local_speaker",
        }
        self._persist_sentiment(sentiment_record, sentiment_generation)
        summary = self._update_conversation_summary(sentiment_label, sentiment_score, sentiment_generation)

        saved["sentiment"] = sentiment_record
        saved["conversationSummary"] = summary

        total_latency = time.perf_counter() - start
        logger.debug("Total local text pipeline: %.3f s", total_latency)
        return saved

    def process_local_audio_analyzed(
        self,
        text: str,
        audio_bytes: bytes,
        source_language: str,
        target_language: str,
        audio_pcm: "np.ndarray | None" = None,
    ) -> Dict[str, Any]:
        """Process pre-transcribed local audio: translation + voice emotion in parallel.

        Used by the streaming endpoint where chunked transcription already completed.
        Skips re-transcription, runs voice emotion on the original audio alongside
        translation for zero added latency.
        """
        start = time.perf_counter()
        # Stamp the request so a clear that lands mid-flight discards its result.
        generation = self.current_generation()
        sentiment_generation = self.current_sentiment_generation()

        translation_assignment = self._registry.get_current_assignment("translation")
        tts_assignment = self._registry.get_current_assignment("text_to_speech")

        # Resolve source language
        if source_language == "auto" and text:
            detected = self._detect_language(text)
            if detected:
                source_language = detected
                self._last_detected_language = detected

        # Translation + voice emotion in parallel (NPU + GPU, no contention)
        audio_float32 = audio_pcm if audio_pcm is not None else _audio_bytes_to_float32_16khz(audio_bytes)
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
            translate_future = executor.submit(
                self._translate, text, source_language, target_language
            )
            voice_future = executor.submit(self._analyze_voice_emotion, audio_float32)
            translated_text = translate_future.result()
            voice_emotion_result = voice_future.result()

        message = {
            "messageId": str(uuid.uuid4()),
            "conversationId": str(uuid.uuid4()),
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "speakerType": "local_speaker",
            "sourceLanguage": source_language,
            "targetLanguage": target_language,
            "originalText": text,
            "translatedText": translated_text,
            "inputType": "file",
            "audioPath": None,
            "ttsAudioPath": None,
            "modelsUsed": {
                "transcription": "",
                "translation": (
                    translation_assignment["modelId"] if translation_assignment else ""
                ),
                "textToSpeech": (
                    tts_assignment["modelId"] if tts_assignment else ""
                ),
            },
            "runtimeTargets": {
                "transcription": "CPU",
                "translation": (
                    translation_assignment["target"] if translation_assignment else "CPU"
                ),
                "textToSpeech": (
                    tts_assignment["target"] if tts_assignment else "CPU"
                ),
            },
        }

        saved = self._persist_message(message, generation)

        # Text sentiment — model is English-only, ensure English input
        if target_language == "en":
            text_for_sentiment = translated_text or text
        elif source_language == "en":
            text_for_sentiment = text
        else:
            text_for_sentiment = self._ensure_english_for_sentiment(
                text, source_language
            )
        sentiment_result = self._analyze_sentiment(text_for_sentiment)
        sentiment_label = self._map_sentiment_label(sentiment_result)
        sentiment_score = sentiment_result.get("score", 0.5)

        fused_result = self._fuse_sentiment(sentiment_result, voice_emotion_result)

        sentiment_record = {
            "sentimentId": str(uuid.uuid4()),
            "conversationId": saved.get("conversationId", ""),
            "messageId": saved.get("messageId", ""),
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "highLevelSentiment": fused_result["fusedSentiment"],
            "confidenceScore": fused_result["fusedScore"],
            "detailedReport": self._format_detailed_report(sentiment_result, voice_emotion_result),
            "keyPhrases": [text_for_sentiment] if text_for_sentiment else [],
            "modelUsed": (
                self._registry.get_current_assignment("sentiment") or {}
            ).get("modelId", ""),
            "runtimeTarget": (
                self._registry.get_current_assignment("sentiment") or {}
            ).get("target", "CPU"),
            "voiceEmotion": voice_emotion_result if voice_emotion_result.get("emotion") else None,
            "fusedResult": fused_result,
            "speakerType": "local_speaker",
        }
        self._persist_sentiment(sentiment_record, sentiment_generation)
        summary = self._update_conversation_summary(
            fused_result["fusedSentiment"], fused_result["fusedScore"], sentiment_generation
        )

        saved["sentiment"] = sentiment_record
        saved["conversationSummary"] = summary

        total_latency = time.perf_counter() - start
        logger.debug("Total local audio-analyzed pipeline: %.3f s", total_latency)
        return saved

    def process_user_audio_analyzed(
        self,
        text: str,
        audio_bytes: bytes,
        input_type: str,
        source_language: str,
        target_language: str,
        audio_pcm: "np.ndarray | None" = None,
    ) -> Dict[str, Any]:
        """Process pre-transcribed user audio: translation + voice emotion in parallel."""
        start = time.perf_counter()
        # Stamp the request so a clear that lands mid-flight discards its result.
        generation = self.current_generation()
        sentiment_generation = self.current_sentiment_generation()

        if target_language == "auto":
            target_language = self._last_detected_language
        if not target_language:
            target_language = "en"

        translation_assignment = self._registry.get_current_assignment("translation")
        tts_assignment = self._registry.get_current_assignment("text_to_speech")

        audio_float32 = audio_pcm if audio_pcm is not None else _audio_bytes_to_float32_16khz(audio_bytes)
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
            translate_future = executor.submit(
                self._translate, text, source_language, target_language
            )
            voice_future = executor.submit(self._analyze_voice_emotion, audio_float32)
            translated_text = translate_future.result()
            voice_emotion_result = voice_future.result()

        message = {
            "messageId": str(uuid.uuid4()),
            "conversationId": str(uuid.uuid4()),
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "speakerType": "user",
            "sourceLanguage": source_language,
            "targetLanguage": target_language,
            "originalText": text,
            "translatedText": translated_text,
            "inputType": input_type,
            "audioPath": None,
            "ttsAudioPath": None,
            "modelsUsed": {
                "transcription": "",
                "translation": (
                    translation_assignment["modelId"] if translation_assignment else ""
                ),
                "textToSpeech": (
                    tts_assignment["modelId"] if tts_assignment else ""
                ),
            },
            "runtimeTargets": {
                "transcription": "CPU",
                "translation": (
                    translation_assignment["target"] if translation_assignment else "CPU"
                ),
                "textToSpeech": (
                    tts_assignment["target"] if tts_assignment else "CPU"
                ),
            },
        }

        saved = self._persist_message(message, generation)

        # Sentiment — model is English-only, ensure English input
        if source_language == "en":
            text_for_sentiment = text
        elif target_language == "en":
            text_for_sentiment = translated_text
        else:
            text_for_sentiment = self._ensure_english_for_sentiment(
                text, source_language
            )
        sentiment_result = self._analyze_sentiment(text_for_sentiment)
        sentiment_label = self._map_sentiment_label(sentiment_result)
        sentiment_score = sentiment_result.get("score", 0.5)

        fused_result = self._fuse_sentiment(sentiment_result, voice_emotion_result)

        sentiment_record = {
            "sentimentId": str(uuid.uuid4()),
            "conversationId": saved.get("conversationId", ""),
            "messageId": saved.get("messageId", ""),
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "highLevelSentiment": fused_result["fusedSentiment"],
            "confidenceScore": fused_result["fusedScore"],
            "detailedReport": self._format_detailed_report(sentiment_result, voice_emotion_result),
            "keyPhrases": [text_for_sentiment] if text_for_sentiment else [],
            "modelUsed": (
                self._registry.get_current_assignment("sentiment") or {}
            ).get("modelId", ""),
            "runtimeTarget": (
                self._registry.get_current_assignment("sentiment") or {}
            ).get("target", "CPU"),
            "voiceEmotion": voice_emotion_result if voice_emotion_result.get("emotion") else None,
            "fusedResult": fused_result,
            "speakerType": "user",
        }
        self._persist_sentiment(sentiment_record, sentiment_generation)
        summary = self._update_conversation_summary(
            fused_result["fusedSentiment"], fused_result["fusedScore"], sentiment_generation
        )

        saved["sentiment"] = sentiment_record
        saved["conversationSummary"] = summary

        total_latency = time.perf_counter() - start
        logger.debug("Total user audio-analyzed pipeline: %.3f s", total_latency)
        return saved

    def process_user_input(
        self,
        text_or_audio: Any,
        input_type: str,
        source_language: str,
        target_language: str,
    ) -> Dict[str, Any]:
        """Process user input (text, mic audio, or file).

        Pipeline: input -> (transcription if audio) -> translation -> store

        Parameters
        ----------
        text_or_audio : str or bytes
            Text string if input_type is "text", audio bytes otherwise.
        input_type : str
            One of "text", "mic", or "file".
        source_language : str
            Language of the user input (e.g. "en").
        target_language : str
            Language to translate into (e.g. "fr").

        Returns
        -------
        Conversation message dict matching the plan's schema.
        """
        start = time.perf_counter()
        # Stamp the request so a clear that lands mid-flight discards its result.
        generation = self.current_generation()
        sentiment_generation = self.current_sentiment_generation()

        # Resolve target language if 'auto' — use last detected local speaker language
        if target_language == "auto":
            target_language = self._last_detected_language
            logger.info("User input target resolved to last detected: %s", target_language)
        if not target_language:
            target_language = "en"

        transcription_assignment = self._registry.get_current_assignment(
            "transcription"
        )
        translation_assignment = self._registry.get_current_assignment(
            "translation"
        )
        tts_assignment = self._registry.get_current_assignment("text_to_speech")

        # Transcribe if audio input — use Whisper's language detection
        audio_float32 = None
        if input_type in ("mic", "file") and isinstance(text_or_audio, bytes):
            audio_float32 = _audio_bytes_to_float32_16khz(text_or_audio)
            original_text, whisper_lang = self._transcribe_with_language(
                text_or_audio, source_language
            )
            if source_language == "auto" and whisper_lang:
                source_language = whisper_lang
                logger.info("Whisper detected user source language: %s", whisper_lang)
        else:
            original_text = str(text_or_audio)

        # Run translation and voice emotion in parallel (if audio was provided)
        voice_emotion_result = {}
        if audio_float32 is not None:
            with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
                translate_future = executor.submit(
                    self._translate, original_text, source_language, target_language
                )
                voice_future = executor.submit(self._analyze_voice_emotion, audio_float32)
                translated_text = translate_future.result()
                voice_emotion_result = voice_future.result()
        else:
            translated_text = self._translate(original_text, source_language, target_language)

        message = {
            "messageId": str(uuid.uuid4()),
            "conversationId": str(uuid.uuid4()),
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "speakerType": "user",
            "sourceLanguage": source_language,
            "targetLanguage": target_language,
            "originalText": original_text,
            "translatedText": translated_text,
            "inputType": input_type,
            "audioPath": None,
            "ttsAudioPath": None,
            "modelsUsed": {
                "transcription": (
                    transcription_assignment["modelId"]
                    if transcription_assignment
                    else ""
                ),
                "translation": (
                    translation_assignment["modelId"]
                    if translation_assignment
                    else ""
                ),
                "textToSpeech": (
                    tts_assignment["modelId"] if tts_assignment else ""
                ),
            },
            "runtimeTargets": {
                "transcription": (
                    transcription_assignment["target"]
                    if transcription_assignment
                    else "CPU"
                ),
                "translation": (
                    translation_assignment["target"]
                    if translation_assignment
                    else "CPU"
                ),
                "textToSpeech": (
                    tts_assignment["target"] if tts_assignment else "CPU"
                ),
            },
        }

        saved = self._persist_message(message, generation)

        # Text sentiment — model is English-only, ensure English input
        if source_language == "en":
            text_for_sentiment = original_text
        elif target_language == "en":
            text_for_sentiment = translated_text
        else:
            text_for_sentiment = self._ensure_english_for_sentiment(
                original_text, source_language
            )
        sentiment_result = self._analyze_sentiment(text_for_sentiment)
        sentiment_label = self._map_sentiment_label(sentiment_result)
        sentiment_score = sentiment_result.get("score", 0.5)

        # Fuse with voice emotion if audio was provided
        fused_result = self._fuse_sentiment(sentiment_result, voice_emotion_result)

        sentiment_record = {
            "sentimentId": str(uuid.uuid4()),
            "conversationId": saved.get("conversationId", ""),
            "messageId": saved.get("messageId", ""),
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "highLevelSentiment": fused_result["fusedSentiment"],
            "confidenceScore": fused_result["fusedScore"],
            "detailedReport": self._format_detailed_report(sentiment_result, voice_emotion_result),
            "keyPhrases": [text_for_sentiment] if text_for_sentiment else [],
            "modelUsed": (
                self._registry.get_current_assignment("sentiment") or {}
            ).get("modelId", ""),
            "runtimeTarget": (
                self._registry.get_current_assignment("sentiment") or {}
            ).get("target", "CPU"),
            "voiceEmotion": voice_emotion_result if voice_emotion_result.get("emotion") else None,
            "fusedResult": fused_result,
            "speakerType": "user",
        }
        self._persist_sentiment(sentiment_record, sentiment_generation)
        summary = self._update_conversation_summary(
            fused_result["fusedSentiment"], fused_result["fusedScore"], sentiment_generation
        )

        saved["sentiment"] = sentiment_record
        saved["conversationSummary"] = summary

        total_latency = time.perf_counter() - start
        logger.debug("Total user input pipeline: %.3f s", total_latency)
        return saved

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _map_sentiment_label(result: Dict[str, Any]) -> str:
        """Map model output label to plan's high-level sentiment."""
        label = result.get("label", "NEUTRAL").upper()
        if label == "POSITIVE":
            return "positive"
        elif label == "NEGATIVE":
            return "negative"
        return "neutral"

    @staticmethod
    def _format_detailed_report(sentiment_result: Dict[str, Any], voice_result: Dict[str, Any]) -> str:
        """Build a rich detailed report from Go Emotions + dimensional voice data."""
        parts = []

        # Top text emotion
        top_emotion = sentiment_result.get("topEmotion")
        top_score = sentiment_result.get("topEmotionScore", 0)
        if top_emotion:
            parts.append(f"Primary emotion: {top_emotion} ({top_score:.0%})")

        # Top 3 emotions from text
        all_emotions = sentiment_result.get("allEmotions", {})
        if all_emotions:
            sorted_emo = sorted(all_emotions.items(), key=lambda x: x[1], reverse=True)[:3]
            top3 = ", ".join(f"{e} ({s:.0%})" for e, s in sorted_emo if s > 0.05)
            if top3:
                parts.append(f"Detected emotions: {top3}")

        # A short outburst inside a long message is flattened by averaging, so
        # call it out explicitly when one chunk is much more polarised.
        peak = sentiment_result.get("peak")
        if peak and peak.get("score", 0) > 0.6 and peak.get("label") != sentiment_result.get("label"):
            parts.append(
                f"Strongest passage is {peak['label'].lower()} ({peak['score']:.0%}): "
                f"\"{peak['excerpt']}\""
            )

        # Voice dimensions
        dims = voice_result.get("dimensions")
        if dims:
            parts.append(
                f"Voice tone: arousal={dims.get('arousal', 0):.2f}, "
                f"valence={dims.get('valence', 0):.2f}, "
                f"dominance={dims.get('dominance', 0):.2f}"
            )
        elif voice_result.get("emotion"):
            parts.append(f"Voice: {voice_result['emotion']} ({voice_result.get('score', 0):.0%})")

        # How much of the recording the voice reading actually covers
        analyzed = voice_result.get("analyzedDurationS")
        total = voice_result.get("totalDurationS")
        windows = voice_result.get("windowCount")
        if analyzed and total and windows:
            parts.append(
                f"Voice analysed across {windows} window(s), "
                f"{analyzed:.0f}s speech of {total:.0f}s recording"
            )

        # Same for text: say so when the message needed more than one pass.
        chunks = sentiment_result.get("chunkCount", 0)
        if chunks > 1:
            parts.append(
                f"Text analysed across {chunks} chunks "
                f"({sentiment_result.get('analyzedTokens', 0)} tokens)"
            )

        return ". ".join(parts) + "." if parts else "Analysis complete."

    # ------------------------------------------------------------------
    # Real inference methods using OpenVINO model wrappers
    # ------------------------------------------------------------------

    def _detect_language(self, text: str) -> Optional[str]:
        """Detect language of text using the language detector."""
        if self._lang_detector is None:
            return None
        detected = self._lang_detector.detect_language(text)
        if detected and detected != "unknown":
            return detected
        return None

    def _transcribe(self, audio_bytes: bytes, language: str) -> str:
        """Transcribe audio bytes. Returns text only (for backward compat)."""
        text, _ = self._transcribe_with_language(audio_bytes, language)
        return text

    def _transcribe_with_language(self, audio_bytes: bytes, language: str) -> tuple:
        """Transcribe audio bytes and return (text, detected_language_code).

        Uses Whisper's acoustic language detection which is far more reliable
        than text-based langdetect on short phrases.
        """
        if self._transcriber is None:
            return "[Transcription unavailable — model not loaded]", None

        try:
            if len(audio_bytes) < 1000:
                logger.warning("Audio too small (%d bytes), skipping", len(audio_bytes))
                return "", None

            # Check audio energy — reject silence before expensive transcription
            try:
                audio_check = _audio_bytes_to_float32_16khz(audio_bytes)
                rms = float(np.sqrt(np.mean(audio_check ** 2)))
                if rms < 0.01:
                    logger.info("Audio is silence (RMS=%.4f), skipping transcription", rms)
                    return "", None
            except Exception:
                pass  # If conversion fails, let transcriber handle it

            # Detect file extension from magic bytes for proper ffmpeg handling
            if audio_bytes[:4] == b'RIFF':
                suffix = ".wav"
            elif audio_bytes[:4] == b'\x1aE\xdf\xa3':
                suffix = ".webm"
            elif audio_bytes[:3] == b'ID3' or audio_bytes[:2] == b'\xff\xfb':
                suffix = ".mp3"
            elif audio_bytes[:4] == b'OggS':
                suffix = ".ogg"
            elif audio_bytes[:4] == b'fLaC':
                suffix = ".flac"
            else:
                suffix = ".audio"

            lang_hint = language if language and language != "auto" else None

            with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
                tmp.write(audio_bytes)
                tmp_path = tmp.name

            try:
                logger.info(
                    "Transcribing: %d bytes (%s), lang_hint=%s",
                    len(audio_bytes), suffix, lang_hint,
                )

                detected_lang = None
                with self._stage_locks["transcription"], track_inference(
                    "transcription", self._stage_device("transcription")
                ):
                    if hasattr(self._transcriber, 'transcribe_file_with_language'):
                        transcription, detected_lang = self._transcriber.transcribe_file_with_language(
                            tmp_path, language=lang_hint
                        )
                    elif hasattr(self._transcriber, 'transcribe_file'):
                        transcription = self._transcriber.transcribe_file(
                            tmp_path, language=lang_hint
                        )
                    elif hasattr(self._transcriber, 'transcribe_with_language'):
                        audio_array = _audio_bytes_to_float32_16khz(audio_bytes)
                        transcription, detected_lang = self._transcriber.transcribe_with_language(
                            audio_array, language=lang_hint
                        )
                    else:
                        audio_array = _audio_bytes_to_float32_16khz(audio_bytes)
                        transcription = self._transcriber.transcribe(
                            audio_array, language=lang_hint
                        )
                return transcription, detected_lang
            finally:
                os.unlink(tmp_path)

        except Exception as exc:
            logger.error("Transcription failed: %s", exc, exc_info=True)
            return "[Transcription error — see server logs]", None

    def _translate(self, text: str, source_lang: str, target_lang: str) -> str:
        """Translate text using the translation model."""
        if not text or not text.strip():
            return text
        if source_lang == target_lang:
            return text

        if self._translator is None:
            return f"[Translation unavailable — model not loaded]: {text}"

        try:
            with self._stage_locks["translation"], track_inference(
                "translation", self._stage_device("translation")
            ):
                translated = self._translator.translate(
                    text, source_lang=source_lang, target_lang=target_lang
                )
            self._translation_failure_streak = 0
            return translated

        except Exception as exc:
            logger.error("Translation failed: %s", exc, exc_info=True)
            self._translation_failure_streak += 1
            self._maybe_recover_translation()
            return f"[Translation error — see server logs]: {text}"

    def _maybe_recover_translation(self) -> None:
        """Recompile the translation model on CPU after repeated back-to-back failures.

        The stage lock is not held here — _translate's `with` block has already
        released it by the time an exception reaches this method, so reload_stage
        (which re-acquires it) does not deadlock.
        """
        if self._translation_failure_streak < _TRANSLATION_FAILURE_THRESHOLD:
            return
        self._translation_failure_streak = 0

        current_device = self._stage_device("translation")
        logger.warning(
            "Translation failed %d times in a row on %s — reloading on CPU to recover",
            _TRANSLATION_FAILURE_THRESHOLD, current_device,
        )
        try:
            self.reload_stage("translation", "CPU")
            if current_device.upper() != "CPU":
                self._registry.downgrade_target(
                    "translation", "CPU", "repeated inference failures — possible device OOM"
                )
        except Exception as exc:
            logger.error("Translation recovery reload failed: %s", exc, exc_info=True)

    def _ensure_english_for_sentiment(self, text: str, source_lang: str) -> str:
        """Translate text to English if needed for the English-only sentiment model."""
        if not text or not text.strip():
            return text
        if source_lang == "en":
            return text
        return self._translate(text, source_lang, "en")

    def _analyze_sentiment(self, text: str) -> Dict[str, Any]:
        """Run sentiment analysis using the OpenVINO model."""
        if self._sentiment_analyzer is None:
            return {"label": "NEUTRAL", "score": 0.5}

        try:
            with self._stage_locks["sentiment"], track_inference(
                "sentiment", self._stage_device("sentiment")
            ):
                result = self._sentiment_analyzer.analyze(text)
            return result

        except Exception as exc:
            logger.error("Sentiment analysis failed: %s", exc, exc_info=True)
            return {"label": "NEUTRAL", "score": 0.5}

    def _analyze_voice_emotion(self, audio: np.ndarray) -> Dict[str, Any]:
        """Run voice emotion analysis on raw 16kHz audio."""
        # An unavailable or failed analyzer must report "no reading" rather than
        # a synthetic neutral — a fabricated 0.5 would be fused in as if it were
        # a real measurement.
        if self._voice_emotion_analyzer is None:
            return {"emotion": None, "score": 0.0, "all_emotions": {}}

        try:
            with self._stage_locks["voice_emotion"], track_inference(
                "voice_emotion", self._stage_device("voice_emotion")
            ):
                result = self._voice_emotion_analyzer.analyze_audio(audio)
            return result

        except Exception as exc:
            logger.error("Voice emotion analysis failed: %s", exc, exc_info=True)
            return {"emotion": None, "score": 0.0, "all_emotions": {}}

    def _fuse_sentiment(
        self, text_result: Dict[str, Any], voice_result: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Fuse text sentiment and voice emotion into a combined result.

        Text contributes polarity from Go Emotions aggregation.
        Voice contributes dimensional (arousal/valence/dominance) or categorical signal.
        Valence from dimensional voice directly maps to sentiment polarity.
        """
        text_label = self._map_sentiment_label(text_result)
        text_score = text_result.get("score", 0.5)
        voice_emotion = voice_result.get("emotion", "neutral")
        voice_score = voice_result.get("score", 0.5)

        if not voice_result.get("emotion") or (voice_emotion == "neutral" and voice_score < 0.3):
            return {
                "fusedSentiment": text_label,
                "fusedScore": text_score,
                "textSentiment": {
                    "label": text_label,
                    "score": text_score,
                    "chunkCount": text_result.get("chunkCount"),
                    "analyzedTokens": text_result.get("analyzedTokens"),
                },
                "voiceEmotion": None,
                "allEmotions": text_result.get("allEmotions", {}),
                "topEmotion": text_result.get("topEmotion"),
                "dimensions": None,
            }

        # Use dimensional data for more accurate polarity if available
        dims = voice_result.get("dimensions")
        if dims:
            calibration = (
                self._config.get("models", {}).get("voice_emotion", {}).get("calibration") or {}
            )
            band = calibration.get("valence_band") or [0.367, 0.681]
            neg_below, pos_above = float(band[0]), float(band[1])
            centre = (neg_below + pos_above) / 2.0
            valence = dims.get("valence", centre)
            # The band is the range valence occupies on ordinary calm speech, measured
            # on voice_samples/. Judging against 0.5 instead marked 37% of known-neutral
            # speech as positive and 12% as negative. Scores ramp up from the band edge
            # so a borderline reading contributes almost nothing and cannot on its own
            # flip the text sentiment.
            if valence > pos_above:
                voice_polarity = "positive"
                voice_polarity_score = min(1.0, (valence - pos_above) / max(1e-6, 1.0 - pos_above))
            elif valence < neg_below:
                voice_polarity = "negative"
                voice_polarity_score = min(1.0, (neg_below - valence) / max(1e-6, neg_below))
            else:
                voice_polarity = "neutral"
                half_width = max((pos_above - neg_below) / 2.0, 1e-6)
                voice_polarity_score = max(0.0, 1.0 - abs(valence - centre) / half_width)

            # Weight by the share of windows that agreed, so a verdict resting on a
            # minority of the recording counts for less than a consistent one.
            voice_polarity_score *= voice_result.get("agreement", 1.0)
        else:
            _EMOTION_TO_POLARITY = {
                "angry": "negative", "disgust": "negative", "fearful": "negative",
                "sad": "negative", "happy": "positive", "surprised": "positive",
                "calm": "neutral", "neutral": "neutral",
            }
            voice_polarity = _EMOTION_TO_POLARITY.get(voice_emotion, "neutral")
            voice_polarity_score = voice_score

        # Weighted fusion: text 60%, voice 40%
        polarity_scores = {"positive": 0.0, "neutral": 0.0, "negative": 0.0}
        polarity_scores[text_label] += 0.6 * text_score
        polarity_scores[voice_polarity] += 0.4 * voice_polarity_score

        fused_label = max(polarity_scores, key=polarity_scores.get)
        fused_score = min(polarity_scores[fused_label], 1.0)

        return {
            "fusedSentiment": fused_label,
            "fusedScore": round(fused_score, 4),
            "textSentiment": {
                "label": text_label,
                "score": text_score,
                "chunkCount": text_result.get("chunkCount"),
                "analyzedTokens": text_result.get("analyzedTokens"),
            },
            "voiceEmotion": {
                "emotion": voice_emotion,
                "score": voice_score,
                "windowCount": voice_result.get("windowCount"),
                "analyzedDurationS": voice_result.get("analyzedDurationS"),
                "totalDurationS": voice_result.get("totalDurationS"),
            },
            "allEmotions": voice_result.get("all_emotions", {}),
            "topEmotion": text_result.get("topEmotion"),
            "dimensions": dims,
        }

    def synthesize_speech(self, text: str, language: str = "en") -> bytes:
        """Synthesize speech from text using the TTS OpenVINO model.

        Returns PCM 16-bit WAV bytes (browser-compatible).
        """
        if self._tts is None:
            return b""

        try:
            with self._stage_locks["text_to_speech"], track_inference(
                "text_to_speech", self._stage_device("text_to_speech")
            ):
                waveform = self._tts.synthesize(text, language=language)

            if waveform is None or len(waveform) == 0:
                logger.warning("TTS returned empty waveform for: %r", text[:50])
                return b""

            # Convert float32 waveform to int16 PCM for browser compatibility
            if waveform.dtype == np.float32:
                nan_count = np.isnan(waveform).sum()
                if nan_count > 0:
                    logger.warning(
                        "TTS waveform has %d/%d NaN values, replacing with silence",
                        nan_count, len(waveform),
                    )
                waveform = np.nan_to_num(waveform, nan=0.0, posinf=1.0, neginf=-1.0)
                waveform = np.clip(waveform, -1.0, 1.0)
                waveform = (waveform * 32767).astype(np.int16)

            # If waveform is entirely silent (all NaN was replaced), return empty
            if np.max(np.abs(waveform)) == 0:
                logger.warning("TTS produced silent waveform for: %r", text[:50])
                return b""

            sample_rate = getattr(self._tts, 'get_sample_rate', lambda: 16000)()
            from scipy.io import wavfile
            buf = io.BytesIO()
            wavfile.write(buf, sample_rate, waveform)
            return buf.getvalue()

        except Exception as exc:
            logger.error("TTS synthesis failed: %s", exc, exc_info=True)
            return b""

    def synthesize_speech_streaming(self, text: str, language: str = "en"):
        """Generator yielding (chunk_index, total_chunks, wav_bytes) for streaming TTS."""
        if self._tts is None:
            return

        if not hasattr(self._tts, 'synthesize_streaming'):
            wav_bytes = self.synthesize_speech(text, language)
            if wav_bytes:
                yield (0, 1, wav_bytes)
            return

        sample_rate = getattr(self._tts, 'get_sample_rate', lambda: 16000)()

        try:
            with self._stage_locks["text_to_speech"], track_inference(
                "text_to_speech", self._stage_device("text_to_speech")
            ):
                for idx, total, waveform in self._tts.synthesize_streaming(text, language=language):
                    if waveform is None or len(waveform) == 0:
                        continue

                    if waveform.dtype == np.float32:
                        waveform = np.nan_to_num(waveform, nan=0.0, posinf=1.0, neginf=-1.0)
                        waveform = np.clip(waveform, -1.0, 1.0)
                        waveform = (waveform * 32767).astype(np.int16)

                    if np.max(np.abs(waveform)) == 0:
                        continue

                    from scipy.io import wavfile
                    buf = io.BytesIO()
                    wavfile.write(buf, sample_rate, waveform)
                    yield (idx, total, buf.getvalue())

        except Exception as exc:
            logger.error("TTS streaming synthesis failed: %s", exc, exc_info=True)
