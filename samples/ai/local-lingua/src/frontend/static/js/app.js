// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/**
 * Local Lingua — Main App Logic
 * Initialization, tabs, consent, prerequisites, event wiring.
 */

import { fetchLanguages, fetchConversationHistory, clearConversationHistory, setSessionLanguages, fetchTelemetry, fetchModels, fetchPrerequisites, fetchSentimentHistory, grantMicConsent, grantFileConsent } from './api.js';
import { addLocalMessage, addUserMessage, clearChatUI } from './chat.js';
import { initAudio } from './audio.js';
import { initSentiment, loadSentimentHistory, resetSentimentPanel } from './sentiment.js';
import { initMissionCues, clearMissionCues, getMessageCues } from './mission_cues.js';
import { bumpEpoch } from './session.js';
import { showToast } from './toast.js';
import { initTelemetry } from './telemetry.js';
import { initSettings } from './settings.js';
import { initArchitecture } from './architecture.js';
import { initDemo } from './demo.js';
import { initMode, initLighting } from './mode.js';

// ============================================================
// Theme Toggle
// ============================================================

const THEME_KEY = 'localLingua_theme';

function initTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  const theme = saved || 'dark';
  applyTheme(theme);

  const toggle = document.getElementById('themeToggle');
  if (toggle) {
    toggle.addEventListener('click', () => {
      const current = document.documentElement.getAttribute('data-theme') || 'dark';
      const next = current === 'dark' ? 'light' : 'dark';
      applyTheme(next);
      localStorage[THEME_KEY] = next;
    });
  }
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const sunIcon = document.getElementById('themeIconSun');
  const moonIcon = document.getElementById('themeIconMoon');
  if (sunIcon && moonIcon) {
    sunIcon.style.display = theme === 'dark' ? '' : 'none';
    moonIcon.style.display = theme === 'light' ? '' : 'none';
  }
}

// ============================================================
// Tab Navigation
// ============================================================

function initTabs() {
  const buttons = document.querySelectorAll('.tab-btn');
  const contents = document.querySelectorAll('.tab-content');

  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.tab;

      buttons.forEach(b => b.classList.remove('active'));
      contents.forEach(c => c.classList.remove('active'));

      btn.classList.add('active');
      const tabEl = document.getElementById(`tab-${target}`);
      if (tabEl) tabEl.classList.add('active');
    });
  });
}

// ============================================================
// Consent Flow
// ============================================================

const CONSENT_MIC_KEY = 'localLingua_consentMic';
const CONSENT_FILE_KEY = 'localLingua_consentFile';

/**
 * In-app confirmation dialog, reusing the consent modal shell.
 *
 * Deliberately NOT window.confirm(): browsers offer a "prevent this page from
 * creating additional dialogs" checkbox after repeated prompts, and once ticked
 * confirm() returns false instantly — the click appears to do nothing at all.
 * Native dialogs are also un-themed and poor touch targets on a tablet.
 *
 * Resolves false on Deny, overlay tap, or Escape.
 */
function showModal({ title, message, confirmLabel = 'Allow', denyLabel = 'Deny', danger = false }) {
  return new Promise((resolve) => {
    const overlay = document.getElementById('consentModal');
    const titleEl = document.getElementById('consentTitle');
    const msgEl = document.getElementById('consentMessage');
    const allowBtn = document.getElementById('consentAllow');
    const denyBtn = document.getElementById('consentDeny');

    titleEl.textContent = title;
    msgEl.textContent = message;
    allowBtn.textContent = confirmLabel;
    denyBtn.textContent = denyLabel;
    allowBtn.classList.toggle('btn-modal-danger', !!danger);
    overlay.classList.remove('hidden');

    function cleanup(result) {
      overlay.classList.add('hidden');
      allowBtn.classList.remove('btn-modal-danger');
      allowBtn.removeEventListener('click', onAllow);
      denyBtn.removeEventListener('click', onDeny);
      overlay.removeEventListener('click', onOverlay);
      document.removeEventListener('keydown', onKey);
      resolve(result);
    }

    function onAllow() { cleanup(true); }
    function onDeny() { cleanup(false); }
    function onOverlay(ev) { if (ev.target === overlay) cleanup(false); }
    function onKey(ev) { if (ev.key === 'Escape') cleanup(false); }

    allowBtn.addEventListener('click', onAllow);
    denyBtn.addEventListener('click', onDeny);
    overlay.addEventListener('click', onOverlay);
    document.addEventListener('keydown', onKey);
  });
}

function showConsentModal(title, message) {
  return showModal({ title, message, confirmLabel: 'Allow', denyLabel: 'Deny' });
}

export async function requestMicConsent() {
  if (localStorage.getItem(CONSENT_MIC_KEY) === 'granted') return true;

  const allowed = await showConsentModal(
    'Microphone Access',
    'This app needs access to your microphone to record audio for transcription and translation. Audio is processed locally and never sent to external servers.'
  );

  if (allowed) {
    localStorage[CONSENT_MIC_KEY] = 'granted';
    grantMicConsent().catch(() => {});
  }
  return allowed;
}

export async function requestFileConsent() {
  if (localStorage.getItem(CONSENT_FILE_KEY) === 'granted') return true;

  const allowed = await showConsentModal(
    'File Upload Permission',
    'This app will process your audio files locally for transcription and translation. Files are never uploaded to external servers.'
  );

  if (allowed) {
    localStorage[CONSENT_FILE_KEY] = 'granted';
    grantFileConsent().catch(() => {});
  }
  return allowed;
}

// ============================================================
// Prerequisites Check
// ============================================================

async function checkPrerequisites() {
  try {
    const checks = await fetchPrerequisites();

    setPrereqStatus('docker', checks.docker);
    setPrereqStatus('gpu', checks.gpu);
    setPrereqStatus('npu', checks.npu);
    setPrereqStatus('ffmpeg', checks.ffmpeg);
    setPrereqStatus('models-transcription', checks.models_transcription);
    setPrereqStatus('models-translation', checks.models_translation);
    setPrereqStatus('models-sentiment', checks.models_sentiment);
    setPrereqStatus('models-tts', checks.models_tts);
    setPrereqStatus('models-mission-cue-llm', checks.models_mission_cue_llm);
    setPrereqStatus('network', checks.network);
  } catch (e) {
    console.error('Prerequisites check failed:', e);
  }
}

function setPrereqStatus(key, passed) {
  const el = document.getElementById(`prereq-${key}-status`);
  if (!el) return;
  el.textContent = passed ? '✓' : '✗';
  el.className = `prereq-status ${passed ? 'pass' : 'fail'}`;
}

// ============================================================
// Language Loading
// ============================================================

async function loadLanguages() {
  try {
    const data = await fetchLanguages();
    if (data.supported && data.supported.length > 0) {
      const srcSelect = document.getElementById('srcLang');
      const tgtSelect = document.getElementById('tgtLang');
      srcSelect.textContent = '';
      tgtSelect.textContent = '';

      // Add auto-detect option to source
      const autoOpt = document.createElement('option');
      autoOpt.value = 'auto';
      autoOpt.textContent = 'Auto-detect';
      srcSelect.appendChild(autoOpt);

      data.supported.forEach(lang => {
        const opt1 = document.createElement('option');
        opt1.value = lang.code;
        opt1.textContent = `${lang.flag || ''} ${lang.name}`.trim();
        srcSelect.appendChild(opt1);

        const opt2 = document.createElement('option');
        opt2.value = lang.code;
        opt2.textContent = `${lang.flag || ''} ${lang.name}`.trim();
        tgtSelect.appendChild(opt2);
      });

      // Restore from localStorage or use defaults
      const savedSrc = localStorage.getItem('localLingua_srcLang');
      const savedTgt = localStorage.getItem('localLingua_tgtLang');

      if (savedSrc) {
        srcSelect.value = savedSrc;
      }

      if (savedTgt) {
        tgtSelect.value = savedTgt;
      } else if (data.defaultLanguage) {
        tgtSelect.value = data.defaultLanguage;
      }
    }
  } catch (e) {
    console.error('Load languages error:', e);
  }
}

function initLanguageListeners() {
  const srcSelect = document.getElementById('srcLang');
  const tgtSelect = document.getElementById('tgtLang');

  const onLangChange = () => {
    const src = srcSelect.value;
    const tgt = tgtSelect.value;
    localStorage['localLingua_srcLang'] = src;
    localStorage['localLingua_tgtLang'] = tgt;
    setSessionLanguages(src, tgt).catch(e => console.error('Save languages error:', e));
  };

  srcSelect.addEventListener('change', onLangChange);
  tgtSelect.addEventListener('change', onLangChange);
}

// ============================================================
// Conversation History Loading & Search
// ============================================================

async function loadConversationHistory(query) {
  try {
    // Sentiment history is fetched unfiltered (not scoped to `query`) so every
    // message can be joined by messageId regardless of the conversation search
    // term — it's what lets Simple-mode bubbles show their sentiment dot after
    // a reload, same as a live turn would.
    const [data, sentiments] = await Promise.all([
      fetchConversationHistory(query),
      fetchSentimentHistory().catch(() => []),
    ]);
    clearChatUI();

    const sentimentByMessage = new Map();
    if (Array.isArray(sentiments)) {
      sentiments.forEach(s => { if (s.messageId) sentimentByMessage.set(s.messageId, s); });
    }

    if (Array.isArray(data)) {
      // The API returns newest-first (ORDER BY timestamp DESC), but bubbles
      // must be appended oldest-first so the DOM ends up in chronological
      // order — the last child (newest turn) is what Simple/Glance mode
      // shows, and Advanced mode's scrollback reads top-to-bottom correctly.
      [...data].reverse().forEach(msg => {
        // prefetch: false — this is restoring saved history (startup, search),
        // not a live turn, so don't rerun TTS synthesis for messages nobody
        // has asked to hear again.
        const opts = {
          prefetch: false,
          sentiment: sentimentByMessage.get(msg.messageId) || null,
          missionCues: getMessageCues(msg.messageId),
        };
        if (msg.speakerType === 'local_speaker') {
          addLocalMessage(msg.originalText, msg.translatedText, msg.timestamp, opts);
        } else {
          addUserMessage(msg.originalText, msg.translatedText, msg.timestamp, opts);
        }
      });
    }
  } catch (e) {
    console.error('Load conversation history error:', e);
  }
}

function initConversationControls() {
  const searchInput = document.getElementById('conversationSearch');
  const clearBtn = document.getElementById('btnClearConversation');

  let searchTimeout = null;
  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      loadConversationHistory(searchInput.value.trim() || undefined);
    }, 400);
  });

  clearBtn.addEventListener('click', handleClearConversation);
}

/** Put the Clear button into / out of its "Clearing..." busy state. */
function setClearBusy(btn, busy) {
  if (!btn) return;
  if (busy) {
    btn.dataset.idleLabel = btn.dataset.idleLabel || btn.textContent;
    btn.textContent = '';
    const spinner = document.createElement('span');
    spinner.className = 'btn-spinner';
    btn.appendChild(spinner);
    btn.appendChild(document.createTextNode(' Clearing...'));
    btn.classList.add('is-busy');
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
  } else {
    btn.textContent = btn.dataset.idleLabel || 'Clear';
    btn.classList.remove('is-busy');
    btn.disabled = false;
    btn.removeAttribute('aria-busy');
  }
}

// Guards against a second click landing while the first request is still in
// flight — on a tablet a double-tap would otherwise fire two DELETEs.
let _clearing = false;

async function handleClearConversation(e) {
  e.preventDefault();
  e.stopPropagation();
  if (_clearing) return;

  const confirmed = await showModal({
    title: 'Clear History',
    message: 'This permanently deletes the conversation transcript, every sentiment record and all detected hotwords from this device. It cannot be undone.',
    confirmLabel: 'Clear',
    denyLabel: 'Cancel',
    danger: true,
  });
  if (!confirmed) return;

  const btn = document.getElementById('btnClearConversation');
  _clearing = true;
  setClearBusy(btn, true);
  try {
    await clearConversationHistory();

    // Invalidate anything already in flight. A file being transcribed when Clear
    // ran finishes afterwards; without this its response re-adds the bubble, the
    // sentiment card and the hotwords into the panels we just emptied. Bumped
    // after the delete succeeds so a failed clear does not drop live results.
    bumpEpoch();

    // UI cleanup — even if individual steps fail, continue with the rest
    try { clearChatUI(); } catch (err) { console.error('clearChatUI error:', err); }
    try { resetSentimentPanel(); } catch (err) { console.error('resetSentimentPanel error:', err); }
    try { clearMissionCues(); } catch (err) { console.error('clearMissionCues error:', err); }
    const search = document.getElementById('conversationSearch');
    if (search) search.value = '';
    const sentimentSearch = document.getElementById('sentimentSearch');
    if (sentimentSearch) sentimentSearch.value = '';

    // Re-read both lists from the server rather than trusting the local wipe, so
    // the panels reflect what was actually persisted. The server drops results from
    // requests that spanned the clear, so these come back empty rather than
    // resurrecting a message the user just deleted.
    try { await loadSentimentHistory(); } catch (err) { console.error('loadSentimentHistory error:', err); }
    try { await loadConversationHistory(); } catch (err) { console.error('loadConversationHistory error:', err); }

    showToast('History cleared.', 'success');
  } catch (err) {
    console.error('Clear conversation failed:', err);
    showToast(
      err && err.name === 'AbortError'
        ? 'Clearing timed out — the device may be busy. Nothing was deleted.'
        : 'Could not clear history. Please try again.',
      'error'
    );
  } finally {
    // Always restores the button, so a failure can never leave it dead.
    setClearBusy(btn, false);
    _clearing = false;
  }
}

// ============================================================
// Right-block Split Layout (Sentiment History <-> Mission Cues)
// ============================================================

const SPLIT_KEY = 'localLingua_rightSplit';

function applyRightSplit(mode) {
  const split = document.getElementById('rightSplit');
  if (!split) return;
  const isStacked = mode === 'stacked';
  split.classList.toggle('stacked', isStacked);
  split.classList.toggle('side', !isStacked);

  document.querySelectorAll('#splitToggle .split-toggle-btn').forEach((btn) => {
    const active = btn.dataset.split === (isStacked ? 'stacked' : 'side');
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', String(active));
  });
}

function initRightSplit() {
  const toggle = document.getElementById('splitToggle');
  if (!toggle) return;

  applyRightSplit(localStorage.getItem(SPLIT_KEY) || 'side');

  toggle.addEventListener('click', (e) => {
    const btn = e.target.closest('.split-toggle-btn');
    if (!btn) return;
    const mode = btn.dataset.split;
    applyRightSplit(mode);
    localStorage[SPLIT_KEY] = mode;
  });
}

// ============================================================
// App Initialization
// ============================================================

let _appInitialized = false;

document.addEventListener('DOMContentLoaded', () => {
  if (_appInitialized) return;
  _appInitialized = true;

  initTabs();
  initMode();
  initLighting();
  loadLanguages();
  initLanguageListeners();
  initAudio();
  initDemo();
  initSentiment();
  initMissionCues();
  initRightSplit();
  initTelemetry();
  initSettings();
  initArchitecture();
  initConversationControls();
  loadConversationHistory();
  checkPrerequisites();

  // Wire prerequisites re-check button
  const btnCheck = document.getElementById('btnCheckPrereqs');
  if (btnCheck) {
    btnCheck.addEventListener('click', checkPrerequisites);
  }
});
