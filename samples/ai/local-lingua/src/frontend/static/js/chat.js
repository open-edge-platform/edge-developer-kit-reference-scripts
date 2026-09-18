// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/**
 * Local Lingua — Chat Bubble Rendering and Management
 */

import { postTTS, postTTSStream } from './api.js';
import { highlightHotwords } from './mission_cues.js';

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
// Simple/Glance mode: shrink-to-fit bubble text
// ============================================================
// Glance mode shows one bubble per language at a large fixed font (see
// style.css). Long messages don't fit that font at the section's available
// height, so shrink the font step-by-step until the bubble fits (or a
// minimum is reached), then let the section's own overflow-y:auto take over
// as a scroll fallback for whatever still doesn't fit.
const GLANCE_FONT_PRIMARY = { max: 34, min: 16 };
const GLANCE_FONT_SECONDARY = { max: 22, min: 13 };

function fitGlanceBubbleText(bubble, { max, min }) {
  const container = bubble.parentElement;
  if (!container) return;

  bubble.style.fontSize = `${max}px`;
  let fontPx = max;
  while (fontPx > min && bubble.scrollHeight > container.clientHeight) {
    fontPx -= 1;
    bubble.style.fontSize = `${fontPx}px`;
  }
}

function fitGlanceBubbleIfSimpleMode(bubble, isPrimary) {
  if (document.documentElement.getAttribute('data-mode') !== 'simple') return;
  fitGlanceBubbleText(bubble, isPrimary ? GLANCE_FONT_PRIMARY : GLANCE_FONT_SECONDARY);
}

/**
 * Re-fit whichever bubbles are currently visible in Glance/Simple mode.
 * Called on window resize and whenever mode.js switches into Simple mode,
 * since a bubble created while in Advanced mode never ran the shrink-to-fit
 * pass above.
 */
export function refitGlanceBubbles() {
  if (document.documentElement.getAttribute('data-mode') !== 'simple') return;
  const en = document.getElementById('chatEnglish')?.lastElementChild;
  const ne = document.getElementById('chatNonEnglish')?.lastElementChild;
  if (en) fitGlanceBubbleText(en, GLANCE_FONT_PRIMARY);
  if (ne) fitGlanceBubbleText(ne, GLANCE_FONT_SECONDARY);
}

/**
 * Clear the inline font-size the Glance shrink-to-fit pass sets on bubbles.
 * Called whenever mode.js switches into Advanced mode — otherwise a bubble
 * shrunk while in Simple mode keeps its inline style, which overrides
 * Advanced mode's own .chat-bubble font-size rule in style.css.
 */
export function resetGlanceBubbleFonts() {
  document.querySelectorAll('#chatEnglish .chat-bubble, #chatNonEnglish .chat-bubble').forEach((bubble) => {
    bubble.style.fontSize = '';
  });
}

// Re-fit the currently visible bubbles when the window/section is resized,
// since "fits" is relative to available space, not just text length.
window.addEventListener('resize', refitGlanceBubbles);

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
// Inline Sentiment / Mission-Cue markers (Simple mode)
// ============================================================
// Rendered unconditionally — CSS (gated on [data-mode="simple"]) decides
// whether they're visible, so Advanced-mode bubbles stay unchanged and
// history restore doesn't need to know which mode is active.

// Minimal face glyphs, stroke/fill via currentColor so they pick up the same
// per-level color as the pill's text (set by .sentiment-badge.positive/
// negative/neutral). Mouth is the only path that changes between them.
const SENTIMENT_MOUTH_PATH = {
  positive: 'M8,15 Q12,19 16,15',
  neutral: 'M8,16 L16,16',
  negative: 'M8,17 Q12,13 16,17',
};

const SVG_NS = 'http://www.w3.org/2000/svg';

function svgEl(name, attrs) {
  const el = document.createElementNS(SVG_NS, name);
  Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
  return el;
}

function appendSentimentIcon(parent, level, size = 14) {
  const mouth = SENTIMENT_MOUTH_PATH[level] || SENTIMENT_MOUTH_PATH.neutral;
  const svg = svgEl('svg', {
    width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
    stroke: 'currentColor', 'stroke-width': '1.6', 'stroke-linecap': 'round',
  });
  svg.appendChild(svgEl('circle', { cx: '12', cy: '12', r: '9' }));
  svg.appendChild(svgEl('circle', { cx: '9', cy: '10', r: '1', fill: 'currentColor', stroke: 'none' }));
  svg.appendChild(svgEl('circle', { cx: '15', cy: '10', r: '1', fill: 'currentColor', stroke: 'none' }));
  svg.appendChild(svgEl('path', { d: mouth }));
  parent.insertAdjacentElement('beforeend', svg);
}

function appendSentimentMarker(textDiv, sentiment) {
  const level = sentiment.highLevelSentiment || 'neutral';
  const pct = Math.round((sentiment.confidenceScore || 0) * 100);
  const label = level.charAt(0).toUpperCase() + level.slice(1);

  // Reuses the same .sentiment-badge look (colors + confidence underline) as
  // the Sentiment History panel, so the pill reads the same way in both
  // places — just an icon + percentage here instead of a full text label, so
  // it stays compact and leaves room for a larger, more readable message font.
  const badge = document.createElement('div');
  badge.className = `bubble-sentiment-badge sentiment-badge ${level}`;
  badge.style.setProperty('--fill-pct', `${pct}%`);
  appendSentimentIcon(badge, level);
  const pctSpan = document.createElement('span');
  pctSpan.textContent = `${pct}%`;
  badge.appendChild(pctSpan);

  // Full label + first clause of the detailed report goes in the tooltip —
  // detailedReport can run to several clauses (emotions, voice tone, peak
  // callouts), so only the first is short enough to surface at all here.
  const firstClause = (sentiment.detailedReport || '').split(/\.\s|\|/)[0].trim();
  const extra = firstClause && firstClause.length <= 90 ? ` — ${firstClause}` : '';
  badge.title = `${label} · ${pct}%${extra}`;

  textDiv.appendChild(badge);
}

const CUE_ACTION_MAX_CHARS = 60;

// Action text comes from a PDF extraction and can wrap several sentences
// with embedded newlines — collapse whitespace and cap length so it reads
// as a short chip/line rather than a paragraph. Shared by the per-bubble
// cue tag and the Glance-mode cue banner.
function formatCueLine(m) {
  let action = (m.action || '').replace(/\s+/g, ' ').trim();
  if (action.length > CUE_ACTION_MAX_CHARS) {
    action = `${action.slice(0, CUE_ACTION_MAX_CHARS - 1)}…`;
  }
  return `Cue: ${m.hotword}${action ? ` → ${action}` : ''}`;
}

function appendCueTags(textDiv, missionCues) {
  const seen = new Set();
  const unique = missionCues.filter(m => {
    if (seen.has(m.hotword)) return false;
    seen.add(m.hotword);
    return true;
  });

  const MAX_TAGS = 2;
  unique.slice(0, MAX_TAGS).forEach(m => {
    const tag = document.createElement('div');
    tag.className = 'bubble-cue-tag';
    tag.textContent = formatCueLine(m);
    textDiv.appendChild(tag);
  });

  if (unique.length > MAX_TAGS) {
    const more = document.createElement('div');
    more.className = 'bubble-cue-tag';
    more.textContent = `+${unique.length - MAX_TAGS} more cue${unique.length - MAX_TAGS > 1 ? 's' : ''}`;
    textDiv.appendChild(more);
  }
}

// ============================================================
// Glance-mode hero sentiment verdict + mission-cue banner
// ============================================================
// Rendered unconditionally (same pattern as the inline markers above) —
// CSS gated on [data-mode="simple"] decides whether they're shown. Updated
// from addLocalMessage/addUserMessage so every live pipeline result and
// history-restore path (app.js) keeps them in sync with the newest message
// for free.

export function updateGlanceVerdict(sentiment) {
  const el = document.getElementById('glanceVerdict');
  if (!el || !sentiment) return;

  const level = sentiment.highLevelSentiment || 'neutral';
  const confidence = sentiment.confidenceScore || 0;

  el.className = `glance-verdict ${level}`;

  const wordEl = document.getElementById('glanceVerdictWord');
  if (wordEl) wordEl.textContent = level.toUpperCase();

  const shapeEl = document.getElementById('glanceVerdictShape');
  if (shapeEl) {
    shapeEl.replaceChildren();
    appendSentimentIcon(shapeEl, level, 40);
  }

  const filled = Math.max(1, Math.min(5, Math.round(confidence * 5)));
  document.querySelectorAll('#glanceVerdictMeter .glance-bar').forEach((bar, i) => {
    bar.classList.toggle('on', i < filled);
  });

  updateGlanceVerdictBreakdown(sentiment, level, confidence);
}

// Exact same icons as Advanced mode's Sentiment History badges (see
// sentiment.js's loadSentimentHistory) — a document glyph for the text
// sentiment badge, a mic glyph for the voice-tone chip.
function appendTextBadgeIcon(parent) {
  const icon = svgEl('svg', { class: 'badge-icon', width: '12', height: '12', viewBox: '0 0 24 24', fill: 'currentColor' });
  icon.appendChild(svgEl('path', { d: 'M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z' }));
  parent.insertAdjacentElement('beforeend', icon);
}

function appendMicBadgeIcon(parent) {
  const icon = svgEl('svg', { class: 'badge-icon', width: '12', height: '12', viewBox: '0 0 24 24', fill: 'currentColor' });
  icon.appendChild(svgEl('path', { d: 'M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z' }));
  icon.appendChild(svgEl('path', { d: 'M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z' }));
  parent.insertAdjacentElement('beforeend', icon);
}

// Same confidence badge + voice-tone chip shown per-message in Advanced
// mode's Sentiment History (see sentiment.js's loadSentimentHistory) —
// reused here so Glance mode's colors/labels stay identical, not a
// re-styled duplicate. Text badge sits in the left slot, voice-tone badge in
// the right slot, flanking the word/emoji/meter centerpiece; no detailed
// report text in Glance mode.
function updateGlanceVerdictBreakdown(sentiment, level, confidence) {
  const textSlot = document.getElementById('glanceVerdictTextTag');
  const voiceSlot = document.getElementById('glanceVerdictVoiceTag');
  if (!textSlot || !voiceSlot) return;

  const pct = Math.round(confidence * 100);
  const badge = document.createElement('span');
  badge.className = `sentiment-badge ${level}`;
  badge.style.setProperty('--fill-pct', `${pct}%`);
  appendTextBadgeIcon(badge);
  const badgeLabel = document.createElement('span');
  badgeLabel.textContent = `${level.charAt(0).toUpperCase() + level.slice(1)} ${pct}%`;
  badge.appendChild(badgeLabel);
  textSlot.replaceChildren(badge);

  const ve = sentiment.voiceEmotion || (sentiment.fusedResult && sentiment.fusedResult.voiceEmotion);
  if (ve && ve.emotion) {
    const vePct = Math.min(Math.round((ve.score || 0.5) * 100), 99);
    const toneSpan = document.createElement('span');
    toneSpan.className = `voice-tone-inline emotion-${ve.emotion}`;
    toneSpan.style.setProperty('--fill-pct', `${vePct}%`);
    appendMicBadgeIcon(toneSpan);
    const toneLabel = document.createElement('span');
    toneLabel.textContent = `${ve.emotion.charAt(0).toUpperCase() + ve.emotion.slice(1)} ${vePct}%`;
    toneSpan.appendChild(toneLabel);
    voiceSlot.replaceChildren(toneSpan);
  } else {
    voiceSlot.replaceChildren();
  }
}

// Mission-cue matching is independent of sentiment — a positive-sentiment
// message can still contain a hotword worth flagging — so the banner's
// visibility is driven purely by whether missionCues is non-empty. The
// sentiment level only picks its color/urgency styling.
function updateGlanceCueBanner(missionCues, sentiment) {
  const el = document.getElementById('glanceCueBanner');
  if (!el) return;

  if (!missionCues || missionCues.length === 0) {
    el.className = 'glance-cue-banner';
    return;
  }

  const level = (sentiment && sentiment.highLevelSentiment) || 'neutral';
  el.className = `glance-cue-banner visible ${level}`;

  const textEl = document.getElementById('glanceCueText');
  if (textEl) textEl.textContent = formatCueLine(missionCues[0]);
}

// ============================================================
// Bubble Creation
// ============================================================

function populateBubble(div, text, type, time, language, { prefetch = true, sentiment = null, missionCues = null } = {}) {
  div.className = `chat-bubble ${type}`;

  const textDiv = document.createElement('div');
  textDiv.className = 'bubble-text';
  if (missionCues && missionCues.length) {
    highlightHotwords(textDiv, text, missionCues);
  } else {
    textDiv.textContent = text;
  }

  const timeDiv = document.createElement('div');
  timeDiv.className = 'bubble-time';
  timeDiv.textContent = formatTime(time) || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  if (sentiment) appendSentimentMarker(textDiv, sentiment);
  if (missionCues && missionCues.length) appendCueTags(textDiv, missionCues);

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
export function addLocalMessage(originalText, translatedText, timestamp, { prefetch = true, sentiment = null, missionCues = null } = {}) {
  const chatNE = document.getElementById('chatNonEnglish');
  const chatEN = document.getElementById('chatEnglish');
  const srcLang = document.getElementById('srcLang')?.value || 'auto';
  const tgtLang = document.getElementById('tgtLang')?.value || 'en';

  // Sentiment/mission-cue results describe the whole exchange, so both the
  // native and translated bubble for this turn carry them (Simple mode only
  // — see CSS gating in createBubble's rendering).
  if (originalText) {
    const bubble = document.createElement('div');
    populateBubble(bubble, originalText, 'local', timestamp, srcLang, { prefetch, sentiment, missionCues });
    chatNE.appendChild(bubble);
    fitGlanceBubbleIfSimpleMode(bubble, false);
    scrollToBottom(chatNE);
  }
  if (translatedText) {
    const bubble = document.createElement('div');
    populateBubble(bubble, translatedText, 'local', timestamp, tgtLang, { prefetch, sentiment, missionCues });
    chatEN.appendChild(bubble);
    fitGlanceBubbleIfSimpleMode(bubble, true);
    scrollToBottom(chatEN);
    _latestMessageText = translatedText;
  }

  if (sentiment) updateGlanceVerdict(sentiment);
  updateGlanceCueBanner(missionCues, sentiment);
}

/**
 * Add a user message (right-aligned bubbles).
 * originalText goes in English chat, translatedText in Non-English chat.
 */
export function addUserMessage(originalText, translatedText, timestamp, { prefetch = true, sentiment = null, missionCues = null } = {}) {
  const chatEN = document.getElementById('chatEnglish');
  const chatNE = document.getElementById('chatNonEnglish');
  const srcLang = document.getElementById('srcLang')?.value || 'auto';
  const tgtLang = document.getElementById('tgtLang')?.value || 'en';

  if (originalText) {
    const bubble = document.createElement('div');
    populateBubble(bubble, originalText, 'user', timestamp, tgtLang, { prefetch, sentiment, missionCues });
    chatEN.appendChild(bubble);
    fitGlanceBubbleIfSimpleMode(bubble, true);
    scrollToBottom(chatEN);
    _latestMessageText = originalText;
  }
  if (translatedText) {
    const bubble = document.createElement('div');
    populateBubble(bubble, translatedText, 'user', timestamp, srcLang, { prefetch, sentiment, missionCues });
    chatNE.appendChild(bubble);
    fitGlanceBubbleIfSimpleMode(bubble, false);
    scrollToBottom(chatNE);
  }

  if (sentiment) updateGlanceVerdict(sentiment);
  updateGlanceCueBanner(missionCues, sentiment);
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

  const verdictWord = document.getElementById('glanceVerdictWord');
  const verdictShape = document.getElementById('glanceVerdictShape');
  const verdictEl = document.getElementById('glanceVerdict');
  if (verdictEl) verdictEl.className = 'glance-verdict neutral';
  if (verdictWord) verdictWord.textContent = '—';
  if (verdictShape) verdictShape.innerHTML = '';
  document.querySelectorAll('#glanceVerdictMeter .glance-bar').forEach(b => b.classList.remove('on'));

  const textTag = document.getElementById('glanceVerdictTextTag');
  const voiceTag = document.getElementById('glanceVerdictVoiceTag');
  if (textTag) textTag.textContent = '';
  if (voiceTag) voiceTag.textContent = '';

  const banner = document.getElementById('glanceCueBanner');
  if (banner) banner.className = 'glance-cue-banner';
}
