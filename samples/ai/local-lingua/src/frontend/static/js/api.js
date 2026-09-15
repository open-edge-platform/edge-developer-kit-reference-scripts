// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/**
 * Local Lingua — Backend API Client
 * All fetch calls to /api/* endpoints.
 */

const API_BASE = '';  // Same origin

async function _json(resp) {
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ detail: `HTTP ${resp.status}` }));
    throw new Error(err.detail || `API error: ${resp.status}`);
  }
  return resp.json();
}

// ============================================================
// Language Configuration
// ============================================================

export async function fetchLanguages() {
  const resp = await fetch(`${API_BASE}/api/languages`);
  return _json(resp);
}

export async function setSessionLanguages(sourceLanguage, targetLanguage) {
  const resp = await fetch(`${API_BASE}/api/session/languages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sourceLanguage, targetLanguage })
  });
  return _json(resp);
}

// ============================================================
// Model Registry
// ============================================================

export async function fetchModels() {
  const resp = await fetch(`${API_BASE}/api/models`);
  return _json(resp);
}

export async function fetchCurrentAssignments() {
  const resp = await fetch(`${API_BASE}/api/models/current`);
  const data = await _json(resp);
  return data.assignments || {};
}

export async function selectModel(stage, modelId, target) {
  const resp = await fetch(`${API_BASE}/api/models/select`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ stage, modelId, target })
  });
  return _json(resp);
}

/**
 * Download a model with SSE progress streaming.
 * @param {string} modelId
 * @param {string} stage
 * @param {string|null} token
 * @param {function|null} onProgress - Called with {percent, message}
 * @returns {Promise<void>} Resolves on success, rejects with error message
 */
export async function downloadModel(modelId, stage, token, onProgress) {
  const body = { modelId, stage };
  if (token) body.token = token;

  const resp = await fetch(`${API_BASE}/api/models/download`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ detail: 'Download failed' }));
    throw new Error(err.detail || `Download failed: ${resp.status}`);
  }

  // SSE streaming response
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const jsonStr = line.slice(6).trim();
      if (!jsonStr) continue;

      try {
        const event = JSON.parse(jsonStr);
        if (event.type === 'progress' && onProgress) {
          onProgress({ percent: event.percent, message: event.message });
        } else if (event.type === 'complete') {
          if (onProgress) onProgress({ percent: 100, message: 'Complete' });
          return;
        } else if (event.type === 'error') {
          throw new Error(event.detail || 'Download failed');
        }
      } catch (e) {
        if (e.message && !e.message.includes('JSON')) throw e;
      }
    }
  }
}

// ============================================================
// Consent Management
// ============================================================

export async function fetchConsentStatus() {
  const resp = await fetch(`${API_BASE}/api/consent/status`);
  return _json(resp);
}

export async function grantMicConsent() {
  const resp = await fetch(`${API_BASE}/api/consent/mic`, { method: 'POST' });
  return _json(resp);
}

export async function grantFileConsent() {
  const resp = await fetch(`${API_BASE}/api/consent/file`, { method: 'POST' });
  return _json(resp);
}

// ============================================================
// Local Speaker Input
// ============================================================

export async function postLocalMic(blob, sourceLanguage, targetLanguage) {
  const formData = new FormData();
  formData.append('file', blob, 'recording.webm');
  const url = new URL(`${API_BASE}/api/input/local/mic`, window.location.origin);
  url.searchParams.set('source_language', sourceLanguage);
  url.searchParams.set('target_language', targetLanguage);
  const resp = await fetch(url, { method: 'POST', body: formData });
  if (!resp.ok) throw new Error(`API error: ${resp.status}`);
  return resp.json();
}

export async function postLocalText(text, sourceLanguage, targetLanguage) {
  const resp = await fetch(`${API_BASE}/api/input/local/text`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, sourceLanguage, targetLanguage })
  });
  if (!resp.ok) throw new Error(`API error: ${resp.status}`);
  return resp.json();
}

export async function postLocalFile(file, sourceLanguage, targetLanguage) {
  const formData = new FormData();
  formData.append('file', file);
  const url = new URL(`${API_BASE}/api/input/local/file`, window.location.origin);
  url.searchParams.set('source_language', sourceLanguage);
  url.searchParams.set('target_language', targetLanguage);
  const resp = await fetch(url, { method: 'POST', body: formData });
  if (!resp.ok) throw new Error(`API error: ${resp.status}`);
  return resp.json();
}

/**
 * Stream transcription of a long local audio file via SSE.
 * @param {File} file - Audio file
 * @param {string} sourceLanguage
 * @param {string} targetLanguage
 * @param {function} onProgress - Called with {chunk_index, total_chunks, text, cumulative_text, progress}
 * @returns {Promise<object>} Final complete message
 */
export async function postLocalFileStream(file, sourceLanguage, targetLanguage, onProgress) {
  const formData = new FormData();
  formData.append('file', file);
  const url = new URL(`${API_BASE}/api/input/local/file/stream`, window.location.origin);
  url.searchParams.set('source_language', sourceLanguage);
  url.searchParams.set('target_language', targetLanguage);
  const resp = await fetch(url, { method: 'POST', body: formData });
  if (!resp.ok) throw new Error(`API error: ${resp.status}`);
  return _readSSEStream(resp, onProgress);
}

// ============================================================
// User Input
// ============================================================

export async function postUserMic(blob, sourceLanguage, targetLanguage) {
  const formData = new FormData();
  formData.append('file', blob, 'recording.webm');
  const url = new URL(`${API_BASE}/api/input/user/mic`, window.location.origin);
  url.searchParams.set('source_language', sourceLanguage);
  url.searchParams.set('target_language', targetLanguage);
  const resp = await fetch(url, { method: 'POST', body: formData });
  if (!resp.ok) throw new Error(`API error: ${resp.status}`);
  return resp.json();
}

export async function postUserText(text, sourceLanguage, targetLanguage) {
  const resp = await fetch(`${API_BASE}/api/input/user/text`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, sourceLanguage, targetLanguage })
  });
  if (!resp.ok) throw new Error(`API error: ${resp.status}`);
  return resp.json();
}

export async function postUserFile(file, sourceLanguage, targetLanguage) {
  const formData = new FormData();
  formData.append('file', file);
  const url = new URL(`${API_BASE}/api/input/user/file`, window.location.origin);
  url.searchParams.set('source_language', sourceLanguage);
  url.searchParams.set('target_language', targetLanguage);
  const resp = await fetch(url, { method: 'POST', body: formData });
  if (!resp.ok) throw new Error(`API error: ${resp.status}`);
  return resp.json();
}

/**
 * Stream transcription of a long user audio file via SSE.
 */
export async function postUserFileStream(file, sourceLanguage, targetLanguage, onProgress) {
  const formData = new FormData();
  formData.append('file', file);
  const url = new URL(`${API_BASE}/api/input/user/file/stream`, window.location.origin);
  url.searchParams.set('source_language', sourceLanguage);
  url.searchParams.set('target_language', targetLanguage);
  const resp = await fetch(url, { method: 'POST', body: formData });
  if (!resp.ok) throw new Error(`API error: ${resp.status}`);
  return _readSSEStream(resp, onProgress);
}

// ============================================================
// Conversation History
// ============================================================

export async function fetchConversationHistory(query) {
  const url = new URL(`${API_BASE}/api/conversation/history`, window.location.origin);
  if (query) url.searchParams.set('q', query);
  const resp = await fetch(url);
  return _json(resp);
}

/**
 * Clear conversation history (the endpoint also clears sentiments).
 *
 * Bounded by a timeout: the request can queue behind in-flight inference on a
 * busy device, and without an abort the caller would wait forever with no way
 * to tell the user anything. Throws AbortError on timeout.
 */
export async function clearConversationHistory(timeoutMs = 20000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(`${API_BASE}/api/conversation/history`, {
      method: 'DELETE',
      signal: controller.signal,
    });
    return await _json(resp);
  } finally {
    clearTimeout(timer);
  }
}

// ============================================================
// Sentiment Analysis
// ============================================================

export async function postSentimentAnalyze(text, language) {
  const resp = await fetch(`${API_BASE}/api/sentiment/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, language })
  });
  if (!resp.ok) throw new Error(`API error: ${resp.status}`);
  return resp.json();
}

export async function fetchSentimentHistory(query) {
  const url = new URL(`${API_BASE}/api/sentiment/history`, window.location.origin);
  if (query) url.searchParams.set('q', query);
  const resp = await fetch(url);
  return _json(resp);
}

export async function clearSentimentHistory() {
  const resp = await fetch(`${API_BASE}/api/sentiment/history`, { method: 'DELETE' });
  return _json(resp);
}

// ============================================================
// Text-to-Speech
// ============================================================

export async function postTTS(text, language) {
  const resp = await fetch(`${API_BASE}/api/tts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, language })
  });
  return _json(resp);
}

/**
 * Stream TTS audio chunk-by-chunk via SSE.
 * @param {string} text - Text to synthesize
 * @param {string} language - Target language
 * @param {function} onChunk - Called with {chunkIndex, totalChunks, audioBase64}
 * @returns {Promise<void>} Resolves when streaming is complete
 */
export async function postTTSStream(text, language, onChunk) {
  const resp = await fetch(`${API_BASE}/api/tts/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, language })
  });
  if (!resp.ok) throw new Error(`TTS stream error: ${resp.status}`);

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const jsonStr = line.slice(6);
      if (!jsonStr) continue;

      try {
        const event = JSON.parse(jsonStr);
        if (event.type === 'tts_chunk' && onChunk) {
          onChunk(event);
        } else if (event.type === 'error') {
          throw new Error(event.detail || 'TTS streaming failed');
        }
      } catch (e) {
        if (e.message && !e.message.includes('JSON')) throw e;
      }
    }
  }
}

// ============================================================
// Telemetry
// ============================================================

export async function fetchTelemetry() {
  const resp = await fetch(`${API_BASE}/api/telemetry/current`);
  return _json(resp);
}

// ============================================================
// Demo Samples & Scenarios
// ============================================================

export async function fetchDemoSamples() {
  const resp = await fetch(`${API_BASE}/api/demo-samples`);
  return _json(resp);
}

export async function fetchDemoScenarios() {
  const resp = await fetch(`${API_BASE}/api/demo-scenarios`);
  return _json(resp);
}

export async function fetchDemoPrereqStatus() {
  const resp = await fetch(`${API_BASE}/api/demo-prereq-status`);
  return _json(resp);
}

// ============================================================
// Prerequisites
// ============================================================

export async function fetchPrerequisites() {
  const resp = await fetch(`${API_BASE}/api/prerequisites`);
  return _json(resp);
}

// ============================================================
// SSE Stream Reader (for chunked transcription)
// ============================================================

async function _readSSEStream(resp, onProgress) {
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finalMessage = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const jsonStr = line.slice(6);
      if (!jsonStr) continue;

      try {
        const event = JSON.parse(jsonStr);

        if (event.type === 'transcription_progress' && onProgress) {
          onProgress(event);
        } else if (event.type === 'complete') {
          finalMessage = event.message;
        } else if (event.type === 'error') {
          throw new Error(event.detail || 'Streaming transcription failed');
        }
      } catch (e) {
        if (e.message && !e.message.includes('JSON')) throw e;
      }
    }
  }

  if (!finalMessage) {
    throw new Error('Stream ended without a complete message');
  }
  return finalMessage;
}
