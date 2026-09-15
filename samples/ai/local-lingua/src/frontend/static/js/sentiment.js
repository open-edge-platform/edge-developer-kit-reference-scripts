/**
 * Local Lingua — Sentiment Panel Rendering, Auto-Sentiment, and History
 */

import { fetchSentimentHistory, postSentimentAnalyze } from './api.js';
import { getHotwords } from './mission_cues.js';
import { showToast } from './toast.js';

// ============================================================
// Helpers
// ============================================================

function formatTime(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// ============================================================
// Auto-Sentiment Handler (called after each message)
// ============================================================
// The live sentiment panel and conversation summary were removed — every
// per-message result now lives as a card in Sentiment History. Reload the
// list so the newest analysis appears. summaryData is accepted for call-site
// compatibility but no longer rendered.

export function handleAutoSentiment(sentimentData, _summaryData) {
  if (sentimentData) {
    loadSentimentHistory();
  }
}

// ============================================================
// History Rendering
// ============================================================

let _historySeq = 0;

export async function loadSentimentHistory(query) {
  const mySeq = ++_historySeq;
  try {
    const data = await fetchSentimentHistory(query);
    if (mySeq !== _historySeq) return;
    const container = document.getElementById('sentimentHistory');
    container.textContent = '';

    if (Array.isArray(data) && data.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'sentiment-history-empty';
      empty.textContent = 'No sentiment history yet.';
      container.appendChild(empty);
    } else if (Array.isArray(data)) {
      // The API already returns newest-first (ORDER BY timestamp DESC), so
      // render as-is — newest at the top, matching the Detected Hotwords panel.
      // Do NOT reverse: that is the chat-bubble ordering, where oldest-first is
      // wanted, and it pushed the newest analysis to the bottom of this list.
      data.forEach(item => {
        const div = document.createElement('div');
        const isUser = item.speakerType === 'user';
        div.className = `sentiment-history-item ${isUser ? 'shi-user' : 'shi-local'}`;

        // Meta row: sentiment badge (with %), voice tone (with %), timestamp
        const metaRow = document.createElement('div');
        metaRow.className = 'shi-meta';

        const sentiment = item.highLevelSentiment || 'neutral';
        const confPct = Math.round((item.confidenceScore || 0) * 100);

        const badgeSpan = document.createElement('span');
        badgeSpan.className = `sentiment-badge ${sentiment}`;
        badgeSpan.style.setProperty('--fill-pct', `${confPct}%`);
        const textIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        textIcon.setAttribute('class', 'badge-icon');
        textIcon.setAttribute('width', '10');
        textIcon.setAttribute('height', '10');
        textIcon.setAttribute('viewBox', '0 0 24 24');
        textIcon.setAttribute('fill', 'currentColor');
        const textPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        textPath.setAttribute('d', 'M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z');
        textIcon.appendChild(textPath);
        badgeSpan.insertAdjacentElement('beforeend', textIcon);
        const badgeLabel = document.createElement('span');
        badgeLabel.textContent = ` ${sentiment.charAt(0).toUpperCase() + sentiment.slice(1)} ${confPct}%`;
        badgeSpan.appendChild(badgeLabel);

        const ve = item.voiceEmotion || (item.fusedResult && item.fusedResult.voiceEmotion);
        let toneSpan = null;
        if (ve && ve.emotion) {
          const vePct = Math.min(Math.round((ve.score || 0.5) * 100), 99);
          toneSpan = document.createElement('span');
          toneSpan.className = `voice-tone-inline emotion-${ve.emotion}`;
          toneSpan.style.setProperty('--fill-pct', `${vePct}%`);
          const micIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
          micIcon.setAttribute('class', 'badge-icon');
          micIcon.setAttribute('width', '10');
          micIcon.setAttribute('height', '10');
          micIcon.setAttribute('viewBox', '0 0 24 24');
          micIcon.setAttribute('fill', 'currentColor');
          const micPath1 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
          micPath1.setAttribute('d', 'M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z');
          const micPath2 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
          micPath2.setAttribute('d', 'M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z');
          micIcon.appendChild(micPath1);
          micIcon.appendChild(micPath2);
          toneSpan.insertAdjacentElement('beforeend', micIcon);
          const toneLabel = document.createElement('span');
          toneLabel.textContent = ` ${ve.emotion.charAt(0).toUpperCase() + ve.emotion.slice(1)} ${vePct}%`;
          toneSpan.appendChild(toneLabel);
        }

        const timeSpan = document.createElement('span');
        timeSpan.className = 'shi-time';
        timeSpan.textContent = formatTime(item.timestamp);

        metaRow.appendChild(badgeSpan);
        if (toneSpan) metaRow.appendChild(toneSpan);
        metaRow.appendChild(timeSpan);

        // Full analyzed message text (no truncation) — rendered above the
        // sentiment/tone/time meta row so labels sit below the bubble.
        const textDiv = document.createElement('div');
        textDiv.className = 'shi-message';
        const rawText = (item.keyPhrases || []).join(', ');
        const hotwords = getHotwords().filter(Boolean);
        if (rawText && hotwords.length) {
          // Locate hotword occurrences via plain substring search (no
          // dynamic regex is built from hotword text), preferring longer
          // hotwords when matches overlap.
          const lowerText = rawText.toLowerCase();
          const claimed = new Array(rawText.length).fill(false);
          const matches = [];
          [...hotwords].sort((a, b) => b.length - a.length).forEach(hotword => {
            const lowerHotword = hotword.toLowerCase();
            if (!lowerHotword) return;
            let searchFrom = 0;
            let idx;
            while ((idx = lowerText.indexOf(lowerHotword, searchFrom)) !== -1) {
              const end = idx + lowerHotword.length;
              let overlaps = false;
              for (let i = idx; i < end; i++) {
                if (claimed[i]) { overlaps = true; break; }
              }
              if (!overlaps) {
                matches.push({ start: idx, end });
                claimed.fill(true, idx, end);
              }
              searchFrom = idx + 1;
            }
          });
          matches.sort((a, b) => a.start - b.start);

          let cursor = 0;
          matches.forEach(({ start, end }) => {
            if (start > cursor) {
              const gapSpan = document.createElement('span');
              gapSpan.textContent = rawText.slice(cursor, start);
              textDiv.appendChild(gapSpan);
            }
            const mark = document.createElement('mark');
            mark.className = 'hotword-highlight';
            mark.textContent = rawText.slice(start, end);
            textDiv.appendChild(mark);
            cursor = end;
          });
          if (cursor < rawText.length) {
            const gapSpan = document.createElement('span');
            gapSpan.textContent = rawText.slice(cursor);
            textDiv.appendChild(gapSpan);
          }
        } else {
          textDiv.textContent = rawText;
        }

        if (textDiv.textContent) div.appendChild(textDiv);
        div.appendChild(metaRow);

        // Explains the reading — how much of a long recording/message was
        // actually analysed (voice models and the text chunker both cap cost by
        // sampling evenly across the whole thing rather than reading it all).
        if (item.detailedReport) {
          const detailDiv = document.createElement('div');
          detailDiv.className = 'shi-detail';
          detailDiv.textContent = item.detailedReport;
          div.appendChild(detailDiv);
        }

        container.appendChild(div);
      });
    }
  } catch (e) {
    console.error('Load sentiment history error:', e);
  }
}

// ============================================================
// Panel Reset
// ============================================================

/**
 * Reset sentiment state to its initial empty view. The live panel and summary
 * were removed, so all that remains is clearing the history list — the Clear
 * button reloads it afterwards, but empty it immediately for responsiveness.
 */
export function resetSentimentPanel() {
  const container = document.getElementById('sentimentHistory');
  if (container) {
    container.textContent = '';
    const empty = document.createElement('div');
    empty.className = 'sentiment-history-empty';
    empty.textContent = 'No sentiment history yet.';
    container.appendChild(empty);
  }
}

// ============================================================
// Clear History
// ============================================================
// The single "Clear" button next to the conversation search clears both
// conversation and sentiment history (see handleClearConversation in app.js).


// ============================================================
// Collapse / Expand
// ============================================================

const COLLAPSE_KEY = 'localLingua_sentimentHistoryCollapsed';

function applyHistoryCollapsed(collapsed) {
  const body = document.getElementById('sentimentHistoryBody');
  const btn = document.getElementById('btnToggleSentimentHistory');
  if (!body || !btn) return;

  body.classList.toggle('collapsed', collapsed);
  btn.classList.toggle('collapsed', collapsed);
  btn.setAttribute('aria-expanded', String(!collapsed));
  btn.title = collapsed ? 'Expand sentiment history' : 'Collapse sentiment history';
}

function initHistoryCollapse() {
  const btn = document.getElementById('btnToggleSentimentHistory');
  if (!btn) return;

  applyHistoryCollapsed(localStorage.getItem(COLLAPSE_KEY) === 'true');

  btn.addEventListener('click', () => {
    const body = document.getElementById('sentimentHistoryBody');
    const isCurrentlyCollapsed = body.classList.contains('collapsed');
    const newCollapsed = !isCurrentlyCollapsed;
    applyHistoryCollapsed(newCollapsed);
    localStorage[COLLAPSE_KEY] = String(newCollapsed);
  });
}

// ============================================================
// Search
// ============================================================

function initSentimentSearch() {
  const searchInput = document.getElementById('sentimentSearch');
  if (!searchInput) return;

  let searchTimeout = null;
  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      loadSentimentHistory(searchInput.value.trim() || undefined);
    }, 400);
  });
}

// ============================================================
// Type-Text Sentiment Modal
// ============================================================
// The model actually used is whichever one is currently assigned to the
// Sentiment stage in Settings (classifier or an LLM like tiny-aya-global) —
// this modal just calls the existing /api/sentiment/analyze endpoint and
// doesn't need to know or care which.

function openTextSentimentModal() {
  const overlay = document.getElementById('textSentimentModal');
  const input = document.getElementById('textSentimentInput');
  if (!overlay || !input) return;
  // Prefill with whatever's already typed in the response bar, if anything —
  // the button sits right next to that input, so "analyze this" is the
  // expected behavior rather than always starting from a blank box.
  const responseInput = document.getElementById('userTextInput');
  input.value = (responseInput && responseInput.value.trim()) || '';
  overlay.classList.remove('hidden');
  input.focus();
}

function closeTextSentimentModal() {
  const overlay = document.getElementById('textSentimentModal');
  if (overlay) overlay.classList.add('hidden');
}

async function submitTextSentiment() {
  const input = document.getElementById('textSentimentInput');
  const submitBtn = document.getElementById('textSentimentSubmit');
  const text = (input?.value || '').trim();
  if (!text) {
    showToast('Type some text first.', 'warn');
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = 'Analyzing...';
  try {
    await postSentimentAnalyze(text, 'en');
    closeTextSentimentModal();
    loadSentimentHistory();
  } catch (e) {
    console.error('Text sentiment analyze error:', e);
    showToast('Sentiment analysis failed — see server logs.', 'error');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Analyze';
  }
}

function initTextSentimentModal() {
  const openBtn = document.getElementById('btnAnalyzeTypedText');
  const cancelBtn = document.getElementById('textSentimentCancel');
  const submitBtn = document.getElementById('textSentimentSubmit');
  const overlay = document.getElementById('textSentimentModal');
  if (!openBtn || !cancelBtn || !submitBtn || !overlay) return;

  openBtn.addEventListener('click', openTextSentimentModal);
  cancelBtn.addEventListener('click', closeTextSentimentModal);
  submitBtn.addEventListener('click', submitTextSentiment);
  overlay.addEventListener('click', (ev) => {
    if (ev.target === overlay) closeTextSentimentModal();
  });
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && !overlay.classList.contains('hidden')) closeTextSentimentModal();
  });
}

// ============================================================
// Wire up DOM events
// ============================================================

let _sentimentInitialized = false;

export function initSentiment() {
  if (_sentimentInitialized) return;
  _sentimentInitialized = true;

  initHistoryCollapse();
  initSentimentSearch();
  initTextSentimentModal();
  loadSentimentHistory();
}
