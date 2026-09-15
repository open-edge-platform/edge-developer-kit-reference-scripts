/**
 * Local Lingua — Mission Cues Panel
 * Manages hotword document loading, PDF upload, and detection display.
 */

const API_BASE = '';

// ---------------------------------------------------------------------------
// API calls
// ---------------------------------------------------------------------------

async function fetchMissionCueDocs() {
  const resp = await fetch(`${API_BASE}/api/mission-cues/documents`);
  if (!resp.ok) return { documents: [] };
  return resp.json();
}

async function uploadMissionCuePdf(file, parseMode) {
  const formData = new FormData();
  formData.append('file', file);
  const url = new URL(`${API_BASE}/api/mission-cues/upload`, window.location.origin);
  url.searchParams.set('parse_mode', parseMode);
  const resp = await fetch(url, {
    method: 'POST',
    body: formData,
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ detail: 'Upload failed' }));
    throw new Error(err.detail || `Upload failed: ${resp.status}`);
  }
  return resp.json();
}

async function removeMissionCueDoc(docId) {
  const url = new URL(`${API_BASE}/api/mission-cues/documents`, window.location.origin);
  url.pathname += `/${encodeURIComponent(docId)}`;
  const resp = await fetch(url, {
    method: 'DELETE',
  });
  return resp.ok;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

// Accumulated detections across the conversation, keyed by hotword for dedup
let _accumulatedMatches = new Map(); // hotword -> {hotword, action, filename, source, docId, count}
const COLLAPSE_KEY = 'localLingua_missionCuesCollapsed';
const DETECTIONS_KEY = 'localLingua_missionCueDetections';

function persistDetections() {
  try {
    const arr = [..._accumulatedMatches.values()].map(m => ({ ...m, isNew: false }));
    localStorage[DETECTIONS_KEY] = JSON.stringify(arr);
  } catch (e) {
    console.error('Failed to persist mission cue detections:', e);
  }
}

function restoreDetections() {
  try {
    const raw = localStorage.getItem(DETECTIONS_KEY);
    if (!raw) return;
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) {
      _accumulatedMatches = new Map(arr.map(m => [m.hotword, { ...m, isNew: false }]));
    }
  } catch (e) {
    console.error('Failed to restore mission cue detections:', e);
  }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function renderDocuments(documents) {
  const container = document.getElementById('missionCuesDocs');
  if (!container) return;
  container.innerHTML = '';

  if (!documents || documents.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'mc-docs-empty';
    empty.textContent = 'No documents loaded. Upload a PDF or run make demo-prereq.';
    container.appendChild(empty);
    return;
  }
  documents.forEach(doc => {
    const chip = document.createElement('div');
    chip.className = 'mc-doc-chip';
    chip.dataset.docId = doc.docId;

    const icon = document.createElement('span');
    icon.className = 'mc-doc-icon';
    icon.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm4 18H6V4h7v5h5v11z"/></svg>';

    const name = document.createElement('span');
    name.className = 'mc-doc-name';
    name.textContent = doc.filename;

    const count = document.createElement('span');
    count.className = 'mc-doc-count';
    count.textContent = `${doc.cueCount} cues`;

    const viewLink = document.createElement('a');
    viewLink.className = 'mc-doc-view';
    viewLink.href = `/api/mission-cues/pdf/${encodeURIComponent(doc.docId)}`;
    viewLink.target = '_blank';
    viewLink.title = 'View PDF';
    viewLink.innerHTML = '<svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M19 19H5V5h7V3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"/></svg>';

    chip.append(icon, name, count, viewLink);

    if (doc.source === 'uploaded') {
      const removeBtn = document.createElement('button');
      removeBtn.className = 'mc-doc-remove';
      removeBtn.dataset.docId = doc.docId;
      removeBtn.title = 'Remove';
      removeBtn.textContent = '×';
      removeBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (await removeMissionCueDoc(doc.docId)) {
          loadDocuments();
        }
      });
      chip.append(removeBtn);
    }

    container.appendChild(chip);
  });
}

function renderDetections() {
  const container = document.getElementById('missionCuesDetections');
  if (!container) return;
  container.innerHTML = '';

  if (_accumulatedMatches.size === 0) {
    const empty = document.createElement('div');
    empty.className = 'mission-cues-empty';
    empty.textContent = 'No hotwords detected yet. Speak or type to begin.';
    container.appendChild(empty);
    return;
  }

  const table = document.createElement('table');
  table.className = 'mc-detection-table';

  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');
  ['Hotword', 'Action', 'Source', '#'].forEach(text => {
    const th = document.createElement('th');
    th.textContent = text;
    headerRow.appendChild(th);
  });
  thead.appendChild(headerRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  // Show most recently triggered first
  const entries = [..._accumulatedMatches.values()].reverse();
  entries.forEach(m => {
    const tr = document.createElement('tr');
    tr.className = 'mc-detection-row';
    if (m.isNew) tr.classList.add('mc-detection-new');

    const tdHotword = document.createElement('td');
    tdHotword.className = 'mc-hotword';
    const badge = document.createElement('span');
    badge.className = 'mc-hotword-badge';
    // Show the excerpt actually detected in the conversation (e.g. "pains"),
    // not the bank's canonical phrase (e.g. "i am in pain") — the stemmer
    // matches fuzzily and the canonical phrase may never appear verbatim.
    badge.textContent = m.matchedTexts ? m.matchedTexts.join(', ') : (m.matchedText || m.hotword);
    tdHotword.appendChild(badge);
    if (m.hotword && m.hotword !== badge.textContent) {
      const bankLabel = document.createElement('span');
      bankLabel.className = 'mc-hotword-bank';
      bankLabel.textContent = `cue: ${m.hotword}`;
      tdHotword.appendChild(bankLabel);
    }

    const tdAction = document.createElement('td');
    tdAction.className = 'mc-action';
    tdAction.textContent = m.action;

    const tdSource = document.createElement('td');
    tdSource.className = 'mc-source';
    tdSource.textContent = m.filename;

    const tdCount = document.createElement('td');
    tdCount.className = 'mc-count';
    tdCount.textContent = m.count > 1 ? `×${m.count}` : '';

    tr.append(tdHotword, tdAction, tdSource, tdCount);
    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  container.appendChild(table);

  // Clear "new" highlight after a short delay
  setTimeout(() => {
    _accumulatedMatches.forEach(m => { m.isNew = false; });
  }, 2000);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

async function loadDocuments() {
  try {
    const data = await fetchMissionCueDocs();
    renderDocuments(data.documents);
  } catch (e) {
    console.error('Failed to load mission cue documents:', e);
  }
}

export function updateMissionCues(matches) {
  if (!matches || matches.length === 0) return;
  matches.forEach(m => {
    const key = m.hotword;
    if (_accumulatedMatches.has(key)) {
      const existing = _accumulatedMatches.get(key);
      existing.count++;
      existing.isNew = true;
      // Track distinct excerpts seen for this cue (e.g. "pains", "painful"),
      // capped so the badge doesn't grow unbounded over a long conversation.
      const texts = new Set(existing.matchedTexts || (existing.matchedText ? [existing.matchedText] : []));
      if (m.matchedText) texts.add(m.matchedText);
      existing.matchedTexts = [...texts].slice(0, 3);
      // Move to end (most recent) by re-inserting
      _accumulatedMatches.delete(key);
      _accumulatedMatches.set(key, existing);
    } else {
      _accumulatedMatches.set(key, { ...m, matchedTexts: m.matchedText ? [m.matchedText] : [], count: 1, isNew: true });
    }
  });
  persistDetections();
  renderDetections();
}

export function getHotwords() {
  return [..._accumulatedMatches.keys()];
}

export function clearMissionCues() {
  _accumulatedMatches = new Map();
  try { localStorage.removeItem(DETECTIONS_KEY); } catch (e) { /* ignore */ }
  renderDetections();
}

export async function initMissionCues() {
  // Collapse toggle — wire up immediately, before any async work
  const btn = document.getElementById('btnToggleMissionCues');
  const body = document.getElementById('missionCuesBody');
  if (btn && body) {
    function setCollapsed(collapsed) {
      body.classList.toggle('collapsed', collapsed);
      btn.classList.toggle('collapsed', collapsed);
      btn.setAttribute('aria-expanded', String(!collapsed));
    }

    btn.addEventListener('click', () => {
      const isCollapsed = body.classList.contains('collapsed');
      setCollapsed(!isCollapsed);
    });
  }

  // Restore any detections accumulated in a previous session
  restoreDetections();
  renderDetections();

  // Load documents (async, non-blocking for UI)
  await loadDocuments();

  // PDF upload
  const fileInput = document.getElementById('cuePdfInput');
  const parseModeSelect = document.getElementById('cueParseModeSelect');
  if (fileInput) {
    fileInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const parseMode = parseModeSelect ? parseModeSelect.value : 'formatted';
      const { showToast } = await import('./toast.js');
      const uploadLabel = document.getElementById('btnUploadCuePdf');
      const llmStatus = document.getElementById('mcLlmStatus');
      const llmStatusText = document.getElementById('mcLlmStatusText');

      if (parseMode === 'formatted') {
        showToast('Formatted mode expects a PDF with a table (Phrase | Action columns). If parsing fails, try "Unformatted (LLM)" mode.', 'warn');
      }

      try {
        if (uploadLabel) uploadLabel.classList.add('mc-uploading');
        if (parseMode === 'unformatted' && llmStatus) {
          llmStatusText.textContent = 'LLM parsing document... (~15s)';
          llmStatus.classList.remove('hidden');
        }
        await uploadMissionCuePdf(file, parseMode);
        await loadDocuments();
        showToast('PDF uploaded and parsed successfully.', 'success');
      } catch (err) {
        showToast(err.message, 'error');
      } finally {
        if (uploadLabel) uploadLabel.classList.remove('mc-uploading');
        if (llmStatus) llmStatus.classList.add('hidden');
        fileInput.value = '';
      }
    });
  }
}
