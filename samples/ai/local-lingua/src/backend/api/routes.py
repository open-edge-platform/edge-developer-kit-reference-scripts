"""FastAPI router — all REST API endpoints per the plan."""

import asyncio
import json
import logging
import os
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, File, HTTPException, Query, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from src.backend.services.mission_cue_service import MissionCueService
from src.backend.services.model_registry import ModelRegistry
from src.backend.services.pipeline_service import PipelineService
from src.backend.services.telemetry_service import get_current_telemetry, get_telemetry_detailed, is_metrics_manager_connected
from src.backend.storage import database as db

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api")

# ---------------------------------------------------------------------------
# Service singletons — initialised by app.py on startup
# ---------------------------------------------------------------------------
_registry: Optional[ModelRegistry] = None
_pipeline: Optional[PipelineService] = None
_mission_cues: Optional[MissionCueService] = None


def init_services(registry: ModelRegistry, pipeline: PipelineService, mission_cues: Optional[MissionCueService] = None) -> None:
    """Inject service instances (called once at app startup)."""
    global _registry, _pipeline, _mission_cues
    _registry = registry
    _pipeline = pipeline
    _mission_cues = mission_cues


def _get_registry() -> ModelRegistry:
    if _registry is None:
        raise HTTPException(status_code=503, detail="Model registry not ready")
    return _registry


def _get_pipeline() -> PipelineService:
    if _pipeline is None:
        raise HTTPException(status_code=503, detail="Pipeline not ready")
    return _pipeline


# ---------------------------------------------------------------------------
# Request/Response models
# ---------------------------------------------------------------------------


class SessionLanguagesRequest(BaseModel):
    sourceLanguage: str
    targetLanguage: str


class ModelSelectRequest(BaseModel):
    stage: str
    modelId: str
    target: str


class LocalTextRequest(BaseModel):
    text: str
    sourceLanguage: str = "fr"
    targetLanguage: str = "en"


class UserTextRequest(BaseModel):
    text: str
    sourceLanguage: str = "en"
    targetLanguage: str = "en"


class SentimentAnalyzeRequest(BaseModel):
    messageId: Optional[str] = None
    text: str
    language: str = "en"


class TTSRequest(BaseModel):
    text: str
    language: str = "en"


class ModelDownloadRequest(BaseModel):
    modelId: str
    stage: str
    token: Optional[str] = None


class ConsentRequest(BaseModel):
    type: str  # "mic" or "file"
    granted: bool


# ---------------------------------------------------------------------------
# Language Configuration
# ---------------------------------------------------------------------------


@router.get("/languages")
def get_languages() -> Dict[str, Any]:
    """List supported languages from config."""
    import yaml
    from pathlib import Path

    config_path = Path(__file__).resolve().parents[3] / "config.yaml"
    config = {}
    try:
        with open(config_path) as f:
            config = yaml.safe_load(f) or {}
        languages = config.get("language", {}).get("supported", [])
    except FileNotFoundError:
        languages = [{"code": "en", "name": "English", "flag": ""}]

    return {
        "defaultLanguage": config.get("language", {}).get("default", "en"),
        "supported": languages,
    }


@router.post("/session/languages")
def set_session_languages(req: SessionLanguagesRequest) -> Dict[str, Any]:
    """Set the session source and target languages (persisted to settings)."""
    db.save_setting("source_language", req.sourceLanguage)
    db.save_setting("target_language", req.targetLanguage)
    return {
        "status": "ok",
        "sourceLanguage": req.sourceLanguage,
        "targetLanguage": req.targetLanguage,
    }


# ---------------------------------------------------------------------------
# Model Registry
# ---------------------------------------------------------------------------


@router.get("/models")
def list_models(
    stage: Optional[str] = Query(None, description="Filter by pipeline stage"),
    target: Optional[str] = Query(None, description="Filter by device target"),
) -> List[Dict[str, Any]]:
    """List all models (downloaded + available for download), optionally filtered."""
    registry = _get_registry()
    results = registry.get_all_models()
    if stage:
        results = [m for m in results if m["stage"] == stage]
    if target:
        results = [m for m in results if target in m.get("supportedTargets", [])]
    return results


@router.get("/models/current")
def get_current_assignments() -> Dict[str, Any]:
    """Return the current model+target assignment for every pipeline stage.

    Used by the frontend to reflect actual runtime state on load.
    """
    registry = _get_registry()
    pipeline = _get_pipeline()
    stages = ["transcription", "translation", "sentiment", "text_to_speech", "voice_emotion", "mission_cue_llm"]
    assignments = {}
    for stage in stages:
        assignment = registry.get_current_assignment(stage)
        if assignment:
            # Include actual device the model is running on (may differ from
            # requested if fallback occurred)
            actual_device = None
            if stage == "transcription" and pipeline._transcriber:
                actual_device = pipeline._transcriber.device
            elif stage == "translation" and pipeline._translator:
                actual_device = pipeline._translator.device
            elif stage == "sentiment" and pipeline._sentiment_analyzer:
                actual_device = pipeline._sentiment_analyzer.device
            elif stage == "text_to_speech" and pipeline._tts:
                actual_device = pipeline._tts.device
            elif stage == "voice_emotion" and pipeline._voice_emotion_analyzer:
                actual_device = pipeline._voice_emotion_analyzer.device
            assignments[stage] = {
                **assignment,
                "actualDevice": actual_device or assignment.get("target", "CPU"),
            }
    return {"status": "ok", "assignments": assignments}


@router.post("/models/select")
async def select_model(req: ModelSelectRequest) -> Dict[str, Any]:
    """Select a model for a pipeline stage with a given target device.

    This triggers a full model reload on the requested device (CPU/GPU/NPU).
    The OpenVINO model is recompiled for the new device target.
    """
    registry = _get_registry()
    pipeline = _get_pipeline()

    prev_assignment = registry.get_current_assignment(req.stage)

    try:
        assignment = registry.select_model(req.stage, req.modelId, req.target)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    try:
        if req.stage == "mission_cue_llm":
            # Mission cue LLM is managed by the mission cue service, not the pipeline
            svc = _get_mission_cues()
            model_info = registry.get_model(req.modelId)
            model_name = model_info["displayName"] if model_info else req.modelId
            await asyncio.to_thread(svc.reload_llm, model_name, req.target)
        else:
            await asyncio.to_thread(pipeline.reload_stage, req.stage, req.target)
        logger.info(
            "Stage '%s' reloaded on device '%s' (model: %s)",
            req.stage, req.target, req.modelId,
        )
    except Exception as exc:
        logger.error(
            "Model reload for stage '%s' on '%s' failed: %s",
            req.stage, req.target, exc,
        )
        if prev_assignment:
            registry.select_model(
                req.stage,
                prev_assignment["modelId"],
                prev_assignment["target"],
                source=prev_assignment.get("source", "config"),
            )
        raise HTTPException(
            status_code=500,
            detail=f"Device switch failed: {exc}",
        )

    # Persist only once the reload has actually succeeded — saving earlier
    # would make a broken selection survive restarts and fail on every boot.
    db.save_model_assignment(req.stage, req.modelId, req.target)

    return {"status": "ok", "assignment": assignment}


@router.post("/models/download")
async def download_model(req: ModelDownloadRequest) -> Any:
    """Download and export a model from HuggingFace with SSE progress streaming.

    Returns a Server-Sent Events stream with progress updates:
      data: {"type": "progress", "percent": 45, "message": "Downloading..."}
      data: {"type": "complete", "model": "...", "stage": "..."}
      data: {"type": "error", "detail": "..."}

    If the model requires authentication, pass the token in the request.
    Tokens are used for this request only and never stored.
    """
    registry = _get_registry()
    model = registry.get_model(req.modelId)
    if model is None:
        raise HTTPException(status_code=404, detail=f"Model '{req.modelId}' not found")
    if model["stage"] != req.stage:
        raise HTTPException(status_code=400, detail=f"Model '{req.modelId}' does not belong to stage '{req.stage}'")

    from src.backend.services.model_download_service import download_and_export_model_streaming

    import queue
    progress_queue: queue.Queue = queue.Queue()

    async def event_generator():
        import threading

        def run_download():
            try:
                download_and_export_model_streaming(
                    model_id=req.modelId,
                    stage=req.stage,
                    token=req.token,
                    progress_callback=lambda pct, msg: progress_queue.put(("progress", pct, msg)),
                )
                progress_queue.put(("complete", 100, ""))
            except Exception as exc:
                progress_queue.put(("error", 0, str(exc)))

        thread = threading.Thread(target=run_download, daemon=True)
        thread.start()

        while True:
            try:
                item = await asyncio.to_thread(progress_queue.get, timeout=120)
            except Exception:
                yield f"data: {json.dumps({'type': 'error', 'detail': 'Download timed out'})}\n\n"
                break

            event_type, percent, message = item

            if event_type == "progress":
                yield f"data: {json.dumps({'type': 'progress', 'percent': percent, 'message': message})}\n\n"
            elif event_type == "complete":
                yield f"data: {json.dumps({'type': 'complete', 'model': req.modelId, 'stage': req.stage})}\n\n"
                break
            elif event_type == "error":
                yield f"data: {json.dumps({'type': 'error', 'detail': message})}\n\n"
                break

    return StreamingResponse(event_generator(), media_type="text/event-stream")


# ---------------------------------------------------------------------------
# Consent Management
# ---------------------------------------------------------------------------


_consent_state: Dict[str, bool] = {}


@router.get("/consent/status")
def get_consent_status() -> Dict[str, Any]:
    """Return current consent state for mic and file upload."""
    return {
        "mic": _consent_state.get("mic", False),
        "file": _consent_state.get("file", False),
    }


@router.post("/consent/mic")
def grant_mic_consent() -> Dict[str, Any]:
    """Record that the user has granted microphone consent."""
    _consent_state["mic"] = True
    return {"status": "ok", "type": "mic", "granted": True}


@router.post("/consent/file")
def grant_file_consent() -> Dict[str, Any]:
    """Record that the user has granted file upload consent."""
    _consent_state["file"] = True
    return {"status": "ok", "type": "file", "granted": True}


# ---------------------------------------------------------------------------
# Local Speaker Input
# ---------------------------------------------------------------------------


def _attach_mission_cues(result: Dict[str, Any]) -> Dict[str, Any]:
    """Run mission cue detection on the English text in a pipeline result.

    Mirrors the sentiment pipeline's logic: if source is English use
    originalText, if target is English use translatedText, otherwise
    translate to English via the pipeline's translator.
    """
    if _mission_cues is None:
        return result
    src_lang = result.get("sourceLanguage", "")
    tgt_lang = result.get("targetLanguage", "")
    if src_lang == "en":
        english_text = result.get("originalText") or ""
    elif tgt_lang == "en":
        english_text = result.get("translatedText") or ""
    else:
        # Neither side is English — translate to English like sentiment does
        raw_text = result.get("originalText") or result.get("translatedText") or ""
        if raw_text and _pipeline is not None:
            english_text = _pipeline._ensure_english_for_sentiment(raw_text, src_lang or tgt_lang)
        else:
            english_text = raw_text
    if english_text:
        matches = _mission_cues.detect(english_text)
        if matches:
            result["missionCues"] = matches
    return result


@router.post("/input/local/mic")
async def input_local_mic(
    file: UploadFile = File(...),
    source_language: str = Query("auto", description="Source language code"),
    target_language: str = Query("en", description="Target language code"),
) -> Dict[str, Any]:
    """Accept local speaker microphone audio."""
    pipeline = _get_pipeline()
    audio_bytes = await file.read()
    if not audio_bytes:
        raise HTTPException(status_code=400, detail="Empty audio file")

    result = await asyncio.to_thread(
        pipeline.process_local_input,
        audio_bytes=audio_bytes,
        source_language=source_language,
        target_language=target_language,
    )
    return _attach_mission_cues(result)


@router.post("/input/local/file")
async def input_local_file(
    file: UploadFile = File(...),
    source_language: str = Query("auto", description="Source language code"),
    target_language: str = Query("en", description="Target language code"),
) -> Dict[str, Any]:
    """Accept local speaker file upload."""
    pipeline = _get_pipeline()
    audio_bytes = await file.read()
    if not audio_bytes:
        raise HTTPException(status_code=400, detail="Empty file")

    result = await asyncio.to_thread(
        pipeline.process_local_input,
        audio_bytes=audio_bytes,
        source_language=source_language,
        target_language=target_language,
    )
    result["inputType"] = "file"
    return _attach_mission_cues(result)


@router.post("/input/local/text")
async def input_local_text(req: LocalTextRequest) -> Dict[str, Any]:
    """Accept local speaker text input (typed in local language)."""
    pipeline = _get_pipeline()
    result = await asyncio.to_thread(
        pipeline.process_local_text_input,
        text=req.text,
        source_language=req.sourceLanguage,
        target_language=req.targetLanguage,
    )
    return _attach_mission_cues(result)


# ---------------------------------------------------------------------------
# User Input
# ---------------------------------------------------------------------------


@router.post("/input/user/mic")
async def input_user_mic(
    file: UploadFile = File(...),
    source_language: str = Query("en", description="Source language code"),
    target_language: str = Query("en", description="Target language code"),
) -> Dict[str, Any]:
    """Accept user microphone audio."""
    pipeline = _get_pipeline()
    audio_bytes = await file.read()
    if not audio_bytes:
        raise HTTPException(status_code=400, detail="Empty audio file")

    result = await asyncio.to_thread(
        pipeline.process_user_input,
        text_or_audio=audio_bytes,
        input_type="mic",
        source_language=source_language,
        target_language=target_language,
    )
    return _attach_mission_cues(result)


@router.post("/input/user/text")
async def input_user_text(req: UserTextRequest) -> Dict[str, Any]:
    """Accept user text input."""
    pipeline = _get_pipeline()
    result = await asyncio.to_thread(
        pipeline.process_user_input,
        text_or_audio=req.text,
        input_type="text",
        source_language=req.sourceLanguage,
        target_language=req.targetLanguage,
    )
    return _attach_mission_cues(result)


@router.post("/input/user/file")
async def input_user_file(
    file: UploadFile = File(...),
    source_language: str = Query("en", description="Source language code"),
    target_language: str = Query("en", description="Target language code"),
) -> Dict[str, Any]:
    """Accept user file upload."""
    pipeline = _get_pipeline()
    audio_bytes = await file.read()
    if not audio_bytes:
        raise HTTPException(status_code=400, detail="Empty file")

    result = await asyncio.to_thread(
        pipeline.process_user_input,
        text_or_audio=audio_bytes,
        input_type="file",
        source_language=source_language,
        target_language=target_language,
    )
    return _attach_mission_cues(result)


# ---------------------------------------------------------------------------
# Streaming File Upload (SSE for long audio — chunked transcription)
# ---------------------------------------------------------------------------


@router.post("/input/local/file/stream")
async def input_local_file_stream(
    file: UploadFile = File(...),
    source_language: str = Query("auto", description="Source language code"),
    target_language: str = Query("en", description="Target language code"),
):
    """Stream transcription of a long audio file via SSE.

    Returns Server-Sent Events with progressive transcription results.
    Each event contains chunk progress and cumulative text.
    Final event includes the full translated message.
    """
    pipeline = _get_pipeline()
    audio_bytes = await file.read()
    if not audio_bytes:
        raise HTTPException(status_code=400, detail="Empty file")

    async def event_stream():
        from src.backend.services.chunked_transcription import transcribe_chunks_streaming

        full_text = ""
        decoded_pcm = None
        try:
            async for chunk_result in transcribe_chunks_streaming(
                audio_bytes, source_language, pipeline
            ):
                full_text = chunk_result.get("cumulative_text", "")
                if "pcm" in chunk_result:
                    decoded_pcm = chunk_result.pop("pcm")

                event_data = {
                    "type": "transcription_progress",
                    "chunk_index": chunk_result["chunk_index"],
                    "total_chunks": chunk_result["total_chunks"],
                    "text": chunk_result.get("text", ""),
                    "cumulative_text": full_text,
                    "progress": chunk_result["progress"],
                    "is_final": chunk_result["is_final"],
                }
                if "stage" in chunk_result:
                    event_data["stage"] = chunk_result["stage"]
                if "duration_s" in chunk_result:
                    event_data["duration_s"] = chunk_result["duration_s"]
                yield f"data: {json.dumps(event_data)}\n\n"

            # After all chunks, run translation + voice emotion + store message
            if full_text.strip():
                result = await asyncio.to_thread(
                    pipeline.process_local_audio_analyzed,
                    text=full_text,
                    audio_bytes=audio_bytes,
                    source_language=source_language,
                    target_language=target_language,
                    audio_pcm=decoded_pcm,
                )
                result["inputType"] = "file"
                _attach_mission_cues(result)
                event_data = {
                    "type": "complete",
                    "message": result,
                }
                yield f"data: {json.dumps(event_data)}\n\n"
            else:
                yield f"data: {json.dumps({'type': 'error', 'detail': 'No speech detected in audio'})}\n\n"

        except Exception as exc:
            logger.error("Streaming transcription failed: %s", exc, exc_info=True)
            yield f"data: {json.dumps({'type': 'error', 'detail': str(exc)})}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@router.post("/input/user/file/stream")
async def input_user_file_stream(
    file: UploadFile = File(...),
    source_language: str = Query("en", description="Source language code"),
    target_language: str = Query("en", description="Target language code"),
):
    """Stream transcription of a long user audio file via SSE."""
    pipeline = _get_pipeline()
    audio_bytes = await file.read()
    if not audio_bytes:
        raise HTTPException(status_code=400, detail="Empty file")

    async def event_stream():
        from src.backend.services.chunked_transcription import transcribe_chunks_streaming

        full_text = ""
        decoded_pcm = None
        try:
            async for chunk_result in transcribe_chunks_streaming(
                audio_bytes, source_language, pipeline
            ):
                full_text = chunk_result.get("cumulative_text", "")
                if "pcm" in chunk_result:
                    decoded_pcm = chunk_result.pop("pcm")

                event_data = {
                    "type": "transcription_progress",
                    "chunk_index": chunk_result["chunk_index"],
                    "total_chunks": chunk_result["total_chunks"],
                    "text": chunk_result.get("text", ""),
                    "cumulative_text": full_text,
                    "progress": chunk_result["progress"],
                    "is_final": chunk_result["is_final"],
                }
                if "stage" in chunk_result:
                    event_data["stage"] = chunk_result["stage"]
                if "duration_s" in chunk_result:
                    event_data["duration_s"] = chunk_result["duration_s"]
                yield f"data: {json.dumps(event_data)}\n\n"

            # After all chunks, run translation + voice emotion + store
            if full_text.strip():
                result = await asyncio.to_thread(
                    pipeline.process_user_audio_analyzed,
                    text=full_text,
                    audio_bytes=audio_bytes,
                    input_type="file",
                    source_language=source_language,
                    target_language=target_language,
                    audio_pcm=decoded_pcm,
                )
                _attach_mission_cues(result)
                event_data = {
                    "type": "complete",
                    "message": result,
                }
                yield f"data: {json.dumps(event_data)}\n\n"
            else:
                yield f"data: {json.dumps({'type': 'error', 'detail': 'No speech detected in audio'})}\n\n"

        except Exception as exc:
            logger.error("Streaming transcription failed: %s", exc, exc_info=True)
            yield f"data: {json.dumps({'type': 'error', 'detail': str(exc)})}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")


# ---------------------------------------------------------------------------
# Conversation History
# ---------------------------------------------------------------------------


@router.get("/conversation/history")
def get_conversation_history(
    q: Optional[str] = Query(None, description="Search keyword"),
) -> List[Dict[str, Any]]:
    """Get conversation history, optionally filtered by search query."""
    return db.get_messages(search=q)


@router.delete("/conversation/history")
def clear_conversation_history() -> Dict[str, Any]:
    """Clear all conversation history and associated sentiments."""
    count = db.clear_messages()
    sentiment_count = db.clear_sentiments()
    pipeline = _get_pipeline()
    pipeline.reset_conversation_state()
    _tts_cache.clear()
    return {"status": "ok", "deletedCount": count, "sentimentsDeleted": sentiment_count}


# ---------------------------------------------------------------------------
# Sentiment Analysis
# ---------------------------------------------------------------------------


@router.get("/sentiment/summary")
def get_sentiment_summary() -> Dict[str, Any]:
    """Return the current rolling conversation sentiment summary."""
    pipeline = _get_pipeline()
    return pipeline.get_conversation_summary()


@router.post("/sentiment/analyze")
async def analyze_sentiment(req: SentimentAnalyzeRequest) -> Dict[str, Any]:
    """Run sentiment analysis on a message using real OpenVINO inference."""
    registry = _get_registry()
    pipeline = _get_pipeline()
    sentiment_assignment = registry.get_current_assignment("sentiment")

    # Sentiment model is English-only — translate if input is non-English
    text_for_analysis = req.text
    if req.language and req.language != "en":
        text_for_analysis = await asyncio.to_thread(
            pipeline._ensure_english_for_sentiment, req.text, req.language
        )

    # Run real inference via the pipeline service
    result = await asyncio.to_thread(pipeline._analyze_sentiment, text_for_analysis)

    # Map model output labels to plan's high-level sentiment values
    label = result.get("label", "NEUTRAL").upper()
    score = result.get("score", 0.5)

    if label == "POSITIVE":
        sentiment = "positive"
    elif label == "NEGATIVE":
        sentiment = "negative"
    else:
        sentiment = "neutral"

    # Build detailed report from Go Emotions data
    top_emotion = result.get("topEmotion", "")
    all_emotions = result.get("allEmotions", {})
    report_parts = [f"Overall: {sentiment} ({score:.0%})"]
    if top_emotion:
        report_parts.append(f"Primary emotion: {top_emotion} ({result.get('topEmotionScore', 0):.0%})")
    if all_emotions:
        top3 = sorted(all_emotions.items(), key=lambda x: x[1], reverse=True)[:3]
        report_parts.append("Top: " + ", ".join(f"{e} ({s:.0%})" for e, s in top3 if s > 0.05))

    record = {
        "sentimentId": str(uuid.uuid4()),
        "conversationId": "",
        "messageId": req.messageId or "",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "highLevelSentiment": sentiment,
        "confidenceScore": score,
        # LLM-based analyzers (e.g. TinyAyaSentimentAnalyzer) write their own
        # narrative into detailedReport; the classifier never sets that key,
        # so it falls back to the templated summary below unchanged.
        "detailedReport": result.get("detailedReport") or ". ".join(report_parts) + ".",
        "keyPhrases": [req.text] if req.text else [],
        "modelUsed": (
            sentiment_assignment["modelId"] if sentiment_assignment else ""
        ),
        "runtimeTarget": (
            sentiment_assignment["target"] if sentiment_assignment else "CPU"
        ),
    }

    saved = db.save_sentiment(record)
    return saved


@router.get("/sentiment/history")
def get_sentiment_history(
    q: Optional[str] = Query(None, description="Search keyword"),
) -> List[Dict[str, Any]]:
    """Get sentiment analysis history, optionally filtered by search query."""
    return db.get_sentiments(search=q)


@router.delete("/sentiment/history")
def clear_sentiment_history() -> Dict[str, Any]:
    """Clear all sentiment history and reset the rolling conversation summary."""
    count = db.clear_sentiments()
    pipeline = _get_pipeline()
    pipeline.reset_sentiment_state()
    return {"status": "ok", "deletedCount": count}


# ---------------------------------------------------------------------------
# Text-to-Speech
# ---------------------------------------------------------------------------


_tts_cache: Dict[str, Dict[str, Any]] = {}
_TTS_CACHE_MAX = 64


@router.post("/tts")
async def generate_tts(req: TTSRequest) -> Dict[str, Any]:
    """Generate TTS audio for given text and language."""
    if not req.text.strip():
        raise HTTPException(status_code=400, detail="Text cannot be empty")

    import base64

    text = req.text.strip()
    cache_key = f"{req.language}:{text}"
    if cache_key in _tts_cache:
        return {
            "status": "ok",
            "text": text,
            "language": req.language,
            "audioFormat": "wav",
            "sampleRate": _tts_cache[cache_key]["sampleRate"],
            "audioBase64": _tts_cache[cache_key]["audio"],
        }

    pipeline = _get_pipeline()
    wav_bytes = await asyncio.to_thread(pipeline.synthesize_speech, text, req.language)

    if not wav_bytes:
        raise HTTPException(status_code=503, detail="TTS model not available")

    audio_b64 = base64.b64encode(wav_bytes).decode("ascii")
    tts_model = pipeline._tts
    sample_rate = tts_model.get_sample_rate() if tts_model else 16000

    if len(_tts_cache) >= _TTS_CACHE_MAX:
        _tts_cache.pop(next(iter(_tts_cache)))
    _tts_cache[cache_key] = {"audio": audio_b64, "sampleRate": sample_rate}

    return {
        "status": "ok",
        "text": text,
        "language": req.language,
        "audioFormat": "wav",
        "sampleRate": sample_rate,
        "audioBase64": audio_b64,
    }


@router.post("/tts/stream")
async def stream_tts(req: TTSRequest):
    """Stream TTS audio chunk-by-chunk via SSE for long text."""
    if not req.text.strip():
        raise HTTPException(status_code=400, detail="Text cannot be empty")

    import base64
    from concurrent.futures import ThreadPoolExecutor
    import queue

    text = req.text.strip()
    pipeline = _get_pipeline()

    async def event_generator():
        q: queue.Queue = queue.Queue()

        def _produce():
            try:
                for idx, total, wav_bytes in pipeline.synthesize_speech_streaming(text, req.language):
                    q.put((idx, total, wav_bytes))
                q.put(None)
            except Exception as e:
                q.put(e)

        loop = asyncio.get_event_loop()
        loop.run_in_executor(None, _produce)

        try:
            while True:
                item = await asyncio.to_thread(q.get)
                if item is None:
                    break
                if isinstance(item, Exception):
                    yield f"data: {json.dumps({'type': 'error', 'detail': str(item)})}\n\n"
                    return
                idx, total, wav_bytes = item
                audio_b64 = base64.b64encode(wav_bytes).decode("ascii")
                event = json.dumps({
                    "type": "tts_chunk",
                    "chunkIndex": idx,
                    "totalChunks": total,
                    "audioBase64": audio_b64,
                })
                yield f"data: {event}\n\n"

            yield f"data: {json.dumps({'type': 'done'})}\n\n"
        except Exception as e:
            logger.error("TTS stream error: %s", e)
            yield f"data: {json.dumps({'type': 'error', 'detail': str(e)})}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")


# ---------------------------------------------------------------------------
# Hardware Telemetry
# ---------------------------------------------------------------------------


@router.get("/telemetry/current")
def get_telemetry() -> Dict[str, Any]:
    """Get current CPU/GPU/NPU utilization with detailed metrics."""
    return get_telemetry_detailed()


@router.get("/telemetry/stream")
async def telemetry_stream():
    """SSE stream of hardware telemetry (1-second intervals).

    Streams detailed metrics from Intel metrics-manager (power, frequency,
    per-engine GPU usage) when available, falls back to basic local readings.
    """

    async def event_generator():
        while True:
            data = get_telemetry_detailed()
            yield f"data: {json.dumps(data)}\n\n"
            await asyncio.sleep(1)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
    )


@router.get("/telemetry/status")
def get_telemetry_status() -> Dict[str, Any]:
    """Check if metrics-manager is connected."""
    return {
        "metricsManagerConnected": is_metrics_manager_connected(),
        "metricsManagerUrl": os.environ.get("METRICS_MANAGER_URL", "http://metrics-manager:9090"),
    }



# ---------------------------------------------------------------------------
# Prerequisites
# ---------------------------------------------------------------------------


@router.get("/prerequisites")
def get_prerequisites() -> Dict[str, Any]:
    """Check system prerequisites and return status."""
    import shutil
    from pathlib import Path

    checks = {}

    # Docker — when running inside a container, check for /.dockerenv or cgroup
    # instead of checking if docker CLI is available (it won't be in the container)
    try:
        import os
        docker_available = (
            Path("/.dockerenv").exists()
            or Path("/proc/1/cgroup").exists()
            and "docker" in Path("/proc/1/cgroup").read_text()
        )
        checks["docker"] = docker_available
    except Exception:
        checks["docker"] = False

    # FFmpeg
    checks["ffmpeg"] = shutil.which("ffmpeg") is not None

    # GPU driver — check if GPU is in OpenVINO available devices
    try:
        import openvino as ov
        core = ov.Core()
        devices = core.available_devices
        logger.debug(f"OpenVINO available devices: {devices}")
        # OpenVINO may report "GPU" or "GPU.0", "GPU.1", etc. (tiles)
        gpu_available = any(d.startswith("GPU") for d in devices)
        npu_available = "NPU" in devices
        logger.debug(f"GPU check: {gpu_available}, NPU check: {npu_available}")
        checks["gpu"] = gpu_available
        checks["npu"] = npu_available
    except Exception as e:
        logger.error(f"Failed to check OpenVINO devices: {e}", exc_info=True)
        checks["gpu"] = False
        checks["npu"] = False

    # Model files — read paths from config
    root = Path(__file__).resolve().parents[3]
    config_path = root / "config.yaml"
    try:
        import yaml
        with open(config_path) as f:
            cfg = yaml.safe_load(f)
        models_cfg = cfg.get("models", {})
        whisper_cfg = models_cfg.get("whisper", {})
        whisper_dir = root / whisper_cfg.get("export_dir", "models/whisper-small")
        whisper_cache = root / "data" / "whisper_cache"
        checks["models_transcription"] = whisper_dir.exists() or whisper_cache.exists()
        checks["models_translation"] = (root / models_cfg.get("translator", {}).get("export_dir", "models/nllb-200-distilled-600M")).exists()
        checks["models_sentiment"] = (root / models_cfg.get("sentiment", {}).get("export_dir", "models/distilbert-sst2")).exists()
        checks["models_tts"] = (root / models_cfg.get("tts", {}).get("export_dir", "models/speecht5-tts")).exists()
        checks["models_voice_emotion"] = (root / models_cfg.get("voice_emotion", {}).get("export_dir", "models/wav2vec2-speech-emotion")).exists()
        # Mission Cue LLM — prefer local export dir, fall back to HF cache
        mc_llm_cfg = models_cfg.get("mission_cue_llm", {})
        mc_llm_dir = root / mc_llm_cfg.get("export_dir", "models/qwen2.5-1.5b-instruct-int4-ov")
        if (mc_llm_dir / "openvino_model.xml").exists():
            checks["models_mission_cue_llm"] = True
        else:
            try:
                from huggingface_hub import try_to_load_from_cache
                cached = try_to_load_from_cache(mc_llm_cfg.get("name", "OpenVINO/Qwen2.5-1.5B-Instruct-int4-ov"), "openvino_model.xml")
                checks["models_mission_cue_llm"] = cached is not None
            except Exception:
                checks["models_mission_cue_llm"] = False
    except Exception:
        checks["models_transcription"] = False
        checks["models_translation"] = False
        checks["models_sentiment"] = False
        checks["models_tts"] = False
        checks["models_voice_emotion"] = False
        checks["models_mission_cue_llm"] = False

    # Network (can we reach HuggingFace — for initial model download)
    import urllib.request
    network_available = False
    try:
        # URL is a hardcoded https literal, not user input.
        req = urllib.request.Request("https://huggingface.co", method="HEAD")
        with urllib.request.urlopen(req, timeout=5) as response:  # nosec B310
            network_available = response.status == 200
    except Exception:
        pass

    # If network is unavailable but all models are present, mark as True
    # (network only needed for initial download)
    all_models_present = (
        checks.get("models_transcription", False)
        and checks.get("models_translation", False)
        and checks.get("models_sentiment", False)
        and checks.get("models_tts", False)
    )
    checks["network"] = network_available or all_models_present

    return checks



# ---------------------------------------------------------------------------
# Health Check
# ---------------------------------------------------------------------------


@router.get("/health")
def health_check() -> Dict[str, Any]:
    """Health check endpoint for production deployment."""
    return {"status": "ok", "service": "local-lingua"}


# ---------------------------------------------------------------------------
# Demo Samples (optional — only active when voice_samples/ exists)
# ---------------------------------------------------------------------------


@router.get("/demo-samples")
def list_demo_samples() -> Dict[str, Any]:
    """List available demo voice samples grouped by language code."""
    from pathlib import Path

    samples_dir = Path(__file__).resolve().parents[3] / "voice_samples"
    if not samples_dir.is_dir():
        return {"available": False, "languages": {}}

    languages: Dict[str, List[str]] = {}
    # Language code -> on-disk directory name, so the client builds sample URLs
    # from the real path instead of guessing its casing.
    directories: Dict[str, str] = {}
    for lang_dir in sorted(samples_dir.iterdir()):
        if not lang_dir.is_dir():
            continue
        files = sorted(
            f.name for f in lang_dir.iterdir()
            if f.suffix.lower() in (".wav", ".mp3", ".ogg", ".webm", ".flac")
        )
        if files:
            languages[lang_dir.name.lower()] = files
            directories[lang_dir.name.lower()] = lang_dir.name

    return {
        "available": bool(languages),
        "languages": languages,
        "directories": directories,
    }


@router.get("/demo-scenarios")
def list_demo_scenarios() -> Dict[str, Any]:
    """List runnable demo scenarios — one per local-language / user-language pair.

    A scenario is only offered when both sides have voice samples on disk, since
    the automation alternates real audio from each speaker. Turns are capped at
    the number of samples available on the thinner side so no sample repeats.
    """
    from pathlib import Path

    import yaml

    root = Path(__file__).resolve().parents[3]
    samples_dir = root / "voice_samples"
    if not samples_dir.is_dir():
        return {"available": False, "scenarios": []}

    # Collect sample counts per language directory
    counts: Dict[str, int] = {}
    for lang_dir in sorted(samples_dir.iterdir()):
        if not lang_dir.is_dir():
            continue
        n = sum(
            1 for f in lang_dir.iterdir()
            if f.suffix.lower() in (".wav", ".mp3", ".ogg", ".webm", ".flac")
        )
        if n:
            counts[lang_dir.name.lower()] = n

    if not counts:
        return {"available": False, "scenarios": []}

    # Language display names come from config so the UI stays consistent
    names: Dict[str, str] = {}
    flags: Dict[str, str] = {}
    try:
        with open(root / "config.yaml") as f:
            cfg = yaml.safe_load(f) or {}
        for lang in cfg.get("language", {}).get("supported", []):
            code = str(lang.get("code", "")).lower()
            if code:
                names[code] = lang.get("name", code.upper())
                flags[code] = lang.get("flag", "")
    except (FileNotFoundError, yaml.YAMLError):
        pass

    default_user_lang = "en"
    scenarios: List[Dict[str, Any]] = []

    for local_code in sorted(counts):
        for user_code in sorted(counts):
            if local_code == user_code:
                continue
            # Keep the list demo-sized: pair every language against the default
            # user language in both directions.
            if default_user_lang not in (local_code, user_code):
                continue
            turns = min(counts[local_code], counts[user_code])
            local_name = names.get(local_code, local_code.upper())
            user_name = names.get(user_code, user_code.upper())
            scenarios.append({
                "scenarioId": f"{local_code}-{user_code}",
                "localLanguage": local_code,
                "userLanguage": user_code,
                "localLanguageName": local_name,
                "userLanguageName": user_name,
                "localLanguageFlag": flags.get(local_code, ""),
                "userLanguageFlag": flags.get(user_code, ""),
                "label": f"{local_name} to {user_name}",
                "turns": turns,
            })

    return {"available": bool(scenarios), "scenarios": scenarios}


@router.get("/demo-prereq-status")
def demo_prereq_status() -> Dict[str, Any]:
    """Whether `make demo-prereq` has been run (voice samples + Mission Cues PDF).

    The frontend uses this to decide whether demo UI (sample pickers, scripted
    Demo button) should be revealed at all — both artifacts must exist since
    `make demo-prereq` generates them together.
    """
    from pathlib import Path

    root = Path(__file__).resolve().parents[3]

    samples_dir = root / "voice_samples"
    voice_samples_ready = samples_dir.is_dir() and any(
        f.suffix.lower() in (".wav", ".mp3", ".ogg", ".webm", ".flac")
        for lang_dir in samples_dir.iterdir() if lang_dir.is_dir()
        for f in lang_dir.iterdir()
    )

    mission_cues_ready = any((root / "mission-cues").glob("*.pdf")) if (root / "mission-cues").is_dir() else False

    return {
        "ready": voice_samples_ready and mission_cues_ready,
        "voiceSamples": voice_samples_ready,
        "missionCues": mission_cues_ready,
    }


# ---------------------------------------------------------------------------
# Mission Cues
# ---------------------------------------------------------------------------


def _get_mission_cues() -> MissionCueService:
    if _mission_cues is None:
        raise HTTPException(status_code=503, detail="Mission cue service not ready")
    return _mission_cues


@router.get("/mission-cues/documents")
def list_mission_cue_documents() -> Dict[str, Any]:
    """List all loaded mission cue documents (demo + uploaded)."""
    svc = _get_mission_cues()
    return {"documents": svc.list_documents()}


@router.post("/mission-cues/upload")
async def upload_mission_cue_document(
    file: UploadFile = File(...),
    parse_mode: str = Query("formatted", description="Parse mode: 'formatted' (table PDF) or 'unformatted' (free-form, uses LLM)"),
) -> Dict[str, Any]:
    """Upload a mission cues PDF document.

    parse_mode:
      - "formatted": PDF contains a table with phrase/action columns (fast)
      - "unformatted": free-form PDF, uses LLM to extract hotword/action pairs (slower, ~10s)
    """
    svc = _get_mission_cues()

    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are accepted")

    if parse_mode not in ("formatted", "unformatted"):
        raise HTTPException(status_code=400, detail="parse_mode must be 'formatted' or 'unformatted'")

    pdf_bytes = await file.read()
    if not pdf_bytes:
        raise HTTPException(status_code=400, detail="Empty file")

    try:
        doc_info = await asyncio.to_thread(svc.upload_document, file.filename, pdf_bytes, parse_mode)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    return {"status": "ok", "document": doc_info}


@router.delete("/mission-cues/documents/{doc_id}")
def remove_mission_cue_document(doc_id: str) -> Dict[str, Any]:
    """Remove a mission cue document."""
    svc = _get_mission_cues()
    if not svc.remove_document(doc_id):
        raise HTTPException(status_code=404, detail="Document not found")
    return {"status": "ok", "removed": doc_id}


@router.post("/mission-cues/detect")
def detect_mission_cues(body: Dict[str, Any]) -> Dict[str, Any]:
    """Detect hotwords in translated English text against loaded documents."""
    svc = _get_mission_cues()
    text = body.get("text", "")
    method = body.get("method", "stem")
    matches = svc.detect(text, method=method)
    return {"matches": matches, "method": method, "text": text}


@router.get("/mission-cues/pdf/{doc_id}")
def serve_mission_cue_pdf(doc_id: str):
    """Serve a mission cue PDF for viewing/download."""
    from fastapi.responses import FileResponse

    svc = _get_mission_cues()
    pdf_path = svc.get_pdf_path(doc_id)
    if not pdf_path or not pdf_path.exists():
        raise HTTPException(status_code=404, detail="PDF not found")
    return FileResponse(str(pdf_path), media_type="application/pdf", filename=pdf_path.name)
