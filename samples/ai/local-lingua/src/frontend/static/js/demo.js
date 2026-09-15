/**
 * Local Lingua — Demo Voice Samples & Scripted Demo Scenarios
 *
 * Two features, both driven by the pre-downloaded voice_samples/ directory:
 *   1. Per-side dropdowns (mic bar) to play a single sample on demand.
 *   2. A "Demo" button in the tab bar that runs a scripted conversation for a
 *      language pair — alternating turns from the local speaker and the tablet
 *      user, using one distinct sample per turn.
 *
 * This module is designed to be easily decoupled: remove initDemo() from
 * app.js and delete this file to fully remove the feature.
 */

import { postLocalFileStream, postUserFileStream, fetchDemoSamples, fetchDemoScenarios, fetchDemoPrereqStatus } from './api.js';
import { addLocalMessage, addUserMessage } from './chat.js';
import { handleAutoSentiment } from './sentiment.js';
import { updateMissionCues } from './mission_cues.js';
import { showToast } from './toast.js';
import { currentEpoch, isStale } from './session.js';

let _demoData = null;
let _scenarios = [];
let _activeDropdown = null;

const LANG_CODE_MAP = {
  ar: 'ar',
  es: 'es',
  fr: 'fr',
  tr: 'tr',
  en: 'en',
};

function getSrcLang() {
  return document.getElementById('srcLang').value;
}

function getTgtLang() {
  return document.getElementById('tgtLang').value;
}

function showIndicator(id, text) {
  const el = document.getElementById(id);
  if (el) {
    if (text) el.textContent = text;
    el.classList.remove('hidden');
  }
}

function hideIndicator(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add('hidden');
}

async function loadDemoSamples() {
  try {
    const data = await fetchDemoSamples();
    return data.available ? data : null;
  } catch {
    return null;
  }
}

async function loadDemoScenarios() {
  try {
    const data = await fetchDemoScenarios();
    return data.available ? data.scenarios : [];
  } catch {
    return [];
  }
}

function normalizeLang(langCode) {
  const normalized = (langCode || '').toLowerCase();
  return LANG_CODE_MAP[normalized] || normalized;
}

function getSamplesForLang(langCode) {
  if (!_demoData) return [];
  return _demoData.languages[normalizeLang(langCode)] || [];
}

function closeDropdown() {
  if (_activeDropdown) {
    _activeDropdown.remove();
    _activeDropdown = null;
  }
  document.removeEventListener('click', onDocumentClick);
}

function onDocumentClick(e) {
  if (_activeDropdown && !_activeDropdown.contains(e.target)) {
    closeDropdown();
  }
}

const LANG_NAMES = {
  ar: 'Arabic', en: 'English', es: 'Spanish', fr: 'French', tr: 'Turkish',
  de: 'German', it: 'Italian', pt: 'Portuguese', nl: 'Dutch', ru: 'Russian',
  zh: 'Chinese', ja: 'Japanese', ko: 'Korean', hi: 'Hindi', pl: 'Polish',
};

/**
 * Position a floating dropdown under `btn`, flipping above when it would
 * overflow the viewport. Shared by the sample and scenario dropdowns.
 * The dropdown element is created here and handed to `populateDropdown` to
 * fill in place, so it never crosses a function boundary as a return value.
 */
function positionDropdown(populateDropdown, btn, align) {
  const rect = btn.getBoundingClientRect();
  const dropdown = document.createElement('div');
  populateDropdown(dropdown);
  document.body.appendChild(dropdown);
  _activeDropdown = dropdown;

  const dropdownWidth = dropdown.offsetWidth || 240;
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  let left = align === 'right'
    ? rect.right - dropdownWidth
    : rect.left + (rect.width / 2) - (dropdownWidth / 2);
  left = Math.max(8, Math.min(left, viewportWidth - dropdownWidth - 8));

  let top = rect.bottom + 6;
  const dropdownHeight = dropdown.offsetHeight || 200;
  if (top + dropdownHeight > viewportHeight - 8) {
    top = Math.max(8, rect.top - dropdownHeight - 6);
  }

  dropdown.style.top = `${top}px`;
  dropdown.style.left = `${left}px`;

  requestAnimationFrame(() => dropdown.classList.add('demo-dropdown-visible'));
  setTimeout(() => document.addEventListener('click', onDocumentClick), 0);
}

function openDropdown(btn, side) {
  closeDropdown();

  const langCode = side === 'local' ? getSrcLang() : getTgtLang();
  const samples = getSamplesForLang(langCode);

  positionDropdown((dropdown) => {
    dropdown.className = 'demo-dropdown';

    if (samples.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'demo-dropdown-empty';
      const icon = document.createElement('span');
      icon.className = 'demo-empty-icon';
      icon.textContent = 'ℹ';
      empty.appendChild(icon);
      const msgSpan = document.createElement('span');
      msgSpan.textContent = langCode === 'auto'
        ? ' Select a specific language first'
        : ` No samples available for ${LANG_NAMES[langCode.toLowerCase()] || langCode.toUpperCase()}`;
      empty.appendChild(msgSpan);
      dropdown.appendChild(empty);
    } else {
      const langName = LANG_NAMES[langCode.toLowerCase()] || langCode.toUpperCase();
      const header = document.createElement('div');
      header.className = 'demo-dropdown-header';
      const hIcon = document.createElement('span');
      hIcon.className = 'demo-header-icon';
      hIcon.textContent = '♫';
      header.appendChild(hIcon);
      const headerLabel = document.createElement('span');
      headerLabel.textContent = ` ${langName} Voice Samples`;
      header.appendChild(headerLabel);
      dropdown.appendChild(header);

      samples.forEach((filename, idx) => {
        const item = document.createElement('button');
        item.className = 'demo-dropdown-item';
        const num = document.createElement('span');
        num.className = 'demo-item-num';
        num.textContent = String(idx + 1);
        const label = document.createElement('span');
        label.className = 'demo-item-label';
        label.textContent = `Sample ${idx + 1}`;
        const play = document.createElement('span');
        play.className = 'demo-item-play';
        play.textContent = '▶';
        item.appendChild(num);
        item.appendChild(label);
        item.appendChild(play);
        item.title = `Play ${langName} sample ${idx + 1}`;
        item.addEventListener('click', (e) => {
          e.stopPropagation();
          closeDropdown();
          playDemoSample(side, langCode, filename);
        });
        dropdown.appendChild(item);
      });
    }
  }, btn, 'center');
}

/**
 * Fetch a sample from the static mount and wrap it as a File for upload.
 */
async function fetchSampleFile(langCode, filename) {
  const code = normalizeLang(langCode);
  const dir = (_demoData?.directories && _demoData.directories[code]) || code.toUpperCase();
  const url = new URL('/voice_samples', window.location.origin);
  url.pathname += `/${encodeURIComponent(dir)}/${encodeURIComponent(filename)}`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Sample not found: ${resp.status}`);
  const blob = await resp.blob();
  return new File([blob], filename, { type: blob.type || 'audio/wav' });
}

function progressReporter(indicatorId) {
  return (progress) => {
    if (progress.stage === 'decoding') {
      showIndicator(indicatorId, 'Decoding audio...');
    } else if (progress.stage === 'transcribing') {
      showIndicator(indicatorId, 'Transcribing...');
    } else if (progress.total_chunks > 1) {
      const pct = Math.round(progress.progress * 100);
      showIndicator(indicatorId, `Transcribing... ${pct}%`);
    }
  };
}

/**
 * Run one sample through the pipeline and render the resulting bubbles.
 * `srcLang`/`tgtLang` are explicit so the scenario runner can drive a language
 * pair without depending on the current dropdown selections.
 */
async function runSample(side, langCode, filename, srcLang, tgtLang, indicatorId) {
  // Stamped before the request starts: if history is cleared while this sample is
  // in flight, the response must not repopulate the panels.
  const epoch = currentEpoch();
  const file = await fetchSampleFile(langCode, filename);
  showIndicator(indicatorId, 'Transcribing...');

  const onProgress = progressReporter(indicatorId);
  const data = side === 'local'
    ? await postLocalFileStream(file, srcLang, tgtLang, onProgress)
    : await postUserFileStream(file, tgtLang, srcLang, onProgress);

  if (!data.originalText && !data.translatedText) return false;
  if (isStale(epoch) || data.discarded) return false;

  if (side === 'local') {
    addLocalMessage(data.originalText, data.translatedText, data.timestamp);
  } else {
    addUserMessage(data.originalText, data.translatedText, data.timestamp);
  }
  handleAutoSentiment(data.sentiment, data.conversationSummary);
  if (data.missionCues) updateMissionCues(data.missionCues);
  return true;
}

async function playDemoSample(side, langCode, filename) {
  const indicatorId = side === 'local' ? 'localProcessing' : 'userProcessing';
  showIndicator(indicatorId, 'Loading sample...');

  try {
    const ok = await runSample(
      side, langCode, filename, getSrcLang(), getTgtLang(), indicatorId
    );
    if (!ok) showToast('Could not transcribe demo sample.', 'warn');
  } catch (e) {
    console.error('Demo sample error:', e);
    showToast('Failed to process demo sample.', 'error');
  } finally {
    hideIndicator(indicatorId);
  }
}

// ============================================================
// Scripted Demo Scenarios
// ============================================================

let _scenarioRunning = false;
let _scenarioCancel = null;

function openScenarioDropdown(btn) {
  closeDropdown();

  positionDropdown((dropdown) => {
    dropdown.className = 'demo-dropdown demo-dropdown-scenarios';

    const header = document.createElement('div');
    header.className = 'demo-dropdown-header';
    const hIcon = document.createElement('span');
    hIcon.className = 'demo-header-icon';
    hIcon.textContent = '▶';
    header.appendChild(hIcon);
    const headerLabel = document.createElement('span');
    headerLabel.textContent = ' Quick Demo Conversations';
    header.appendChild(headerLabel);
    dropdown.appendChild(header);

    if (_scenarioRunning) {
      const stop = document.createElement('button');
      stop.className = 'demo-dropdown-item demo-scenario-stop';
      stop.textContent = '■ Stop running demo';
      stop.addEventListener('click', (e) => {
        e.stopPropagation();
        closeDropdown();
        if (_scenarioCancel) _scenarioCancel.cancelled = true;
      });
      dropdown.appendChild(stop);
      return;
    }

    if (_scenarios.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'demo-dropdown-empty';
      const icon = document.createElement('span');
      icon.className = 'demo-empty-icon';
      icon.textContent = 'ℹ';
      empty.appendChild(icon);
      const emptyLabel = document.createElement('span');
      emptyLabel.textContent = ' No demo scenarios available';
      empty.appendChild(emptyLabel);
      dropdown.appendChild(empty);
      return;
    }

    _scenarios.forEach(scenario => {
      const item = document.createElement('button');
      item.className = 'demo-dropdown-item demo-scenario-item';

      const flags = document.createElement('span');
      flags.className = 'demo-item-num demo-scenario-flags';
      flags.textContent = `${scenario.localLanguageFlag}${scenario.userLanguageFlag}`;

      const label = document.createElement('span');
      label.className = 'demo-item-label';
      label.textContent = `Try ${scenario.label}`;

      const turns = document.createElement('span');
      turns.className = 'demo-scenario-turns';
      turns.textContent = `${scenario.turns * 2} msgs`;

      item.appendChild(flags);
      item.appendChild(label);
      item.appendChild(turns);
      item.title = `Run ${scenario.turns} turns from each speaker`;
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        closeDropdown();
        runScenario(scenario);
      });
      dropdown.appendChild(item);
    });
  }, btn, 'right');
}

function setDemoButtonRunning(running) {
  const btn = document.getElementById('btnDemoScenarios');
  if (!btn) return;
  btn.classList.toggle('running', running);
  const label = btn.querySelector('span');
  if (label) label.textContent = running ? 'Running...' : 'Demo';
  btn.title = running
    ? 'Demo conversation running — click to stop'
    : 'Run a scripted demo conversation';
}

/**
 * Point the language selectors at the scenario's pair and persist the choice,
 * mirroring what a manual change would do, so chat bubbles get the right TTS
 * language and the backend session matches.
 */
function applyScenarioLanguages(scenario) {
  const srcSelect = document.getElementById('srcLang');
  const tgtSelect = document.getElementById('tgtLang');
  if (srcSelect) {
    srcSelect.value = scenario.localLanguage;
    srcSelect.dispatchEvent(new Event('change'));
  }
  if (tgtSelect) {
    tgtSelect.value = scenario.userLanguage;
    tgtSelect.dispatchEvent(new Event('change'));
  }
}

/**
 * Build the alternating turn list: local speaker sample 1, user sample 1,
 * local sample 2, user sample 2, ... Each sample is used at most once.
 */
function buildTurns(scenario) {
  const localSamples = getSamplesForLang(scenario.localLanguage);
  const userSamples = getSamplesForLang(scenario.userLanguage);
  const count = Math.min(localSamples.length, userSamples.length, scenario.turns);

  const turns = [];
  for (let i = 0; i < count; i++) {
    turns.push({ side: 'local', lang: scenario.localLanguage, file: localSamples[i] });
    turns.push({ side: 'user', lang: scenario.userLanguage, file: userSamples[i] });
  }
  return turns;
}

async function runScenario(scenario) {
  if (_scenarioRunning) return;

  const turns = buildTurns(scenario);
  if (turns.length === 0) {
    showToast('No samples available for this demo.', 'warn');
    return;
  }

  _scenarioRunning = true;
  const cancel = { cancelled: false };
  _scenarioCancel = cancel;
  setDemoButtonRunning(true);
  applyScenarioLanguages(scenario);
  showToast(`Demo: ${scenario.label} — ${turns.length} messages`, 'info');

  let completed = 0;
  try {
    for (let i = 0; i < turns.length; i++) {
      if (cancel.cancelled) break;

      const turn = turns[i];
      const indicatorId = turn.side === 'local' ? 'localProcessing' : 'userProcessing';
      const speaker = turn.side === 'local' ? 'Local speaker' : 'Tablet user';
      showIndicator(indicatorId, `Demo ${i + 1}/${turns.length} — ${speaker}...`);

      try {
        const ok = await runSample(
          turn.side,
          turn.lang,
          turn.file,
          scenario.localLanguage,
          scenario.userLanguage,
          indicatorId,
        );
        if (ok) completed++;
      } catch (e) {
        console.error(`Demo turn ${i + 1} failed:`, e);
      } finally {
        hideIndicator(indicatorId);
      }
    }
  } finally {
    _scenarioRunning = false;
    _scenarioCancel = null;
    setDemoButtonRunning(false);
    hideIndicator('localProcessing');
    hideIndicator('userProcessing');
  }

  if (cancel.cancelled) {
    showToast(`Demo stopped after ${completed} message${completed === 1 ? '' : 's'}.`, 'warn');
  } else if (completed === 0) {
    showToast('Demo finished but no speech was transcribed.', 'warn');
  } else {
    showToast(`Demo complete — ${completed} messages exchanged.`, 'success');
  }
}

// ============================================================
// Init
// ============================================================

export async function initDemo() {
  // Both demo artifacts (voice samples + Mission Cues PDF) come from
  // `make demo-prereq` — keep all demo UI hidden until that has been run.
  const status = await fetchDemoPrereqStatus().catch(() => ({ ready: false }));
  if (!status.ready) return;

  const [samples, scenarios] = await Promise.all([
    loadDemoSamples(),
    loadDemoScenarios(),
  ]);

  _demoData = samples;
  _scenarios = scenarios;

  const scenarioBtn = document.getElementById('btnDemoScenarios');
  if (scenarioBtn && _scenarios.length > 0) {
    scenarioBtn.classList.remove('hidden');
    scenarioBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openScenarioDropdown(scenarioBtn);
    });
  }
}
