/**
 * Local Lingua — Chat Bubble Rendering and Management
 */

import { postTTS, postTTSStream } from './api.js';

// Track the latest message text for sentiment analysis
let _latestMessageText = '';

export function getLatestMessageText() {
  return _latestMessageText;
}

// ============================================================
// Helpers
// ============================================================

function formatTime(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function scrollToBottom(el) {
  el.scrollTop = el.scrollHeight;
}

// ============================================================
// TTS Playback with streaming support for long text
// ============================================================

const STREAM_THRESHOLD = 200;
// Bubbles longer than this (e.g. a full long-audio-file transcript) are not
// eagerly prefetched in the background — synthesizing minutes of speech for
// text the user hasn't asked to hear ties up CPU/GPU/NPU unexpectedly and
// makes the app look "stuck". These are still synthesized on-demand when the
// user presses the speaker button.
const AUTO_PREFETCH_MAX_CHARS = 800;
const _ttsCache = new Map();
const _ttsPending = new Map();
const _TTS_CACHE_MAX = 48;
const PREFETCH_RECENT = 3;

let _recentBubbles = [];

function _cacheEvict() {
  if (_ttsCache.size >= _TTS_CACHE_MAX) {
    const oldest = _ttsCache.keys().next().value;
    _ttsCache.delete(oldest);
  }
}

function _fetchTTSShort(text, language) {
  const key = `${language}:${text}`;
  if (_ttsCache.has(key)) return Promise.resolve(_ttsCache.get(key));
  if (_ttsPending.has(key)) return _ttsPending.get(key);

  const promise = postTTS(text, language).then(data => {
    _ttsPending.delete(key);
    if (data && data.audioBase64) {
      const url = 'data:audio/wav;base64,' + data.audioBase64;
      _cacheEvict();
      _ttsCache.set(key, url);
      return url;
    }
    return null;
  }).catch(e => {
    _ttsPending.delete(key);
    console.warn('TTS fetch failed:', e);
    return null;
  });

  _ttsPending.set(key, promise);
  return promise;
}

function _fetchTTSLong(text, language) {
  const key = `${language}:${text}`;
  if (_ttsCache.has(key)) return Promise.resolve(_ttsCache.get(key));
  if (_ttsPending.has(key)) return _ttsPending.get(key);

  const promise = (async () => {
    const chunks = [];
    try {
      await postTTSStream(text, language, (event) => {
        chunks.push('data:audio/wav;base64,' + event.audioBase64);
      });
    } catch (e) {
      _ttsPending.delete(key);
      console.warn('TTS stream prefetch failed:', e);
      return null;
    }
    _ttsPending.delete(key);
    if (chunks.length > 0) {
      _cacheEvict();
      _ttsCache.set(key, chunks);
      return chunks;
    }
    return null;
  })();

  _ttsPending.set(key, promise);
  return promise;
}

function _fetchTTSAudio(text, language) {
  if (text.length <= STREAM_THRESHOLD) {
    return _fetchTTSShort(text, language);
  }
  return _fetchTTSLong(text, language);
}

function _trackAndPrefetch(text, language) {
  if (!text) return;
  if (text.length > AUTO_PREFETCH_MAX_CHARS) return;
  const lang = language || 'en';
  _recentBubbles.push({ text, language: lang });
  if (_recentBubbles.length > PREFETCH_RECENT) {
    _recentBubbles.shift();
  }
  _fetchTTSAudio(text, lang);
}

let _currentAudio = null;
let _currentBtn = null;
let _playbackAbort = null;

function _stopCurrentPlayback() {
  if (_currentAudio && !_currentAudio.paused) {
    _currentAudio.pause();
    _currentAudio.currentTime = 0;
  }
  if (_playbackAbort) {
    _playbackAbort.aborted = true;
    _playbackAbort = null;
  }
  if (_currentBtn) {
    _currentBtn.classList.remove('playing');
    _currentBtn.title = 'Play aloud';
  }
  _currentAudio = null;
  _currentBtn = null;
}

function _playbackDone(btn) {
  btn.classList.remove('playing');
  btn.title = 'Play aloud';
  _currentAudio = null;
  _currentBtn = null;
  _playbackAbort = null;
}

function _playSingleUrl(url, btn) {
  const audio = new Audio(url);
  _currentAudio = audio;
  audio.onended = () => _playbackDone(btn);
  audio.onerror = () => _playbackDone(btn);
  audio.play().catch(e => {
    console.warn('Audio play blocked:', e);
    _playbackDone(btn);
  });
}

function _playChunkSequence(chunks, btn, abort) {
  let idx = 0;
  function next() {
    if (abort.aborted) return;
    if (idx >= chunks.length) {
      _playbackDone(btn);
      return;
    }
    const audio = new Audio(chunks[idx++]);
    _currentAudio = audio;
    audio.onended = next;
    audio.onerror = next;
    audio.play().catch(e => {
      console.warn('Chunk play blocked:', e);
      _playbackDone(btn);
    });
  }
  next();
}

async function playTTS(text, btn, language) {
  if (_currentBtn === btn) {
    _stopCurrentPlayback();
    return;
  }

  _stopCurrentPlayback();

  btn.classList.add('playing');
  btn.title = 'Stop';
  _currentBtn = btn;

  const lang = language || 'en';
  const abort = { aborted: false };
  _playbackAbort = abort;

  // Show loading state on button while fetching
  btn.classList.add('loading');

  try {
    const cached = await _fetchTTSAudio(text, lang);
    btn.classList.remove('loading');
    if (abort.aborted) return;

    if (!cached) {
      _playbackDone(btn);
      return;
    }

    if (Array.isArray(cached)) {
      _playChunkSequence(cached, btn, abort);
    } else {
      _playSingleUrl(cached, btn);
    }
  } catch (e) {
    btn.classList.remove('loading');
    console.error('TTS playback error:', e);
    _playbackDone(btn);
  }
}

// ============================================================
// Bubble Creation
// ============================================================

function populateBubble(div, text, type, time, language, { prefetch = true } = {}) {
  div.className = `chat-bubble ${type}`;

  const textDiv = document.createElement('div');
  textDiv.className = 'bubble-text';
  textDiv.textContent = text;

  const timeDiv = document.createElement('div');
  timeDiv.className = 'bubble-time';
  timeDiv.textContent = formatTime(time) || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const speakerBtn = document.createElement('button');
  speakerBtn.className = 'btn-speaker';
  speakerBtn.title = 'Play aloud';
  speakerBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>';
  speakerBtn.addEventListener('click', () => playTTS(text, speakerBtn, language));

  textDiv.appendChild(timeDiv);
  div.appendChild(textDiv);
  div.appendChild(speakerBtn);

  // Eagerly prefetch TTS for the most recent bubbles only — but not when
  // restoring history (page load, search), since that reruns synthesis for
  // saved messages the user isn't asking to hear.
  if (prefetch) _trackAndPrefetch(text, language);
}

// ============================================================
// Public API
// ============================================================

/**
 * Add a local speaker message (left-aligned bubbles).
 * originalText goes in Non-English chat, translatedText in English chat.
 */
export function addLocalMessage(originalText, translatedText, timestamp, { prefetch = true } = {}) {
  const chatNE = document.getElementById('chatNonEnglish');
  const chatEN = document.getElementById('chatEnglish');
  const srcLang = document.getElementById('srcLang')?.value || 'auto';
  const tgtLang = document.getElementById('tgtLang')?.value || 'en';

  if (originalText) {
    const bubble = document.createElement('div');
    populateBubble(bubble, originalText, 'local', timestamp, srcLang, { prefetch });
    chatNE.appendChild(bubble);
    scrollToBottom(chatNE);
  }
  if (translatedText) {
    const bubble = document.createElement('div');
    populateBubble(bubble, translatedText, 'local', timestamp, tgtLang, { prefetch });
    chatEN.appendChild(bubble);
    scrollToBottom(chatEN);
    _latestMessageText = translatedText;
  }
}

/**
 * Add a user message (right-aligned bubbles).
 * originalText goes in English chat, translatedText in Non-English chat.
 */
export function addUserMessage(originalText, translatedText, timestamp, { prefetch = true } = {}) {
  const chatEN = document.getElementById('chatEnglish');
  const chatNE = document.getElementById('chatNonEnglish');
  const srcLang = document.getElementById('srcLang')?.value || 'auto';
  const tgtLang = document.getElementById('tgtLang')?.value || 'en';

  if (originalText) {
    const bubble = document.createElement('div');
    populateBubble(bubble, originalText, 'user', timestamp, tgtLang, { prefetch });
    chatEN.appendChild(bubble);
    scrollToBottom(chatEN);
    _latestMessageText = originalText;
  }
  if (translatedText) {
    const bubble = document.createElement('div');
    populateBubble(bubble, translatedText, 'user', timestamp, srcLang, { prefetch });
    chatNE.appendChild(bubble);
    scrollToBottom(chatNE);
  }
}

/**
 * Clear all chat bubbles from both panels.
 */
export function clearChatUI() {
  _stopCurrentPlayback();
  _ttsCache.clear();
  _ttsPending.clear();
  _recentBubbles = [];

  document.getElementById('chatNonEnglish').textContent = '';
  document.getElementById('chatEnglish').textContent = '';
  _latestMessageText = '';
}
