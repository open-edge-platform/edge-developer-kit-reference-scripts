// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/**
 * Local Lingua — Simple / Advanced UI Mode
 *
 * "Advanced" is today's full reference-app view (all tabs, telemetry,
 * mission cues panel, sentiment history). "Simple" is a stripped-down
 * conversation-only view meant for handing the app to an end customer,
 * driven entirely by the `data-mode` attribute on <html> plus CSS —
 * mirrors the existing data-theme light/dark toggle.
 *
 * The one piece of real DOM surgery: the reply bar (#userResponseBar) lives
 * inside .section-top-right in the markup, but Simple mode hides that whole
 * column. Reparenting it under the chat column (instead of just hiding the
 * whole right column) keeps the reply control usable in Simple mode instead
 * of losing it along with the panels around it.
 */

import { refitGlanceBubbles, resetGlanceBubbleFonts } from './chat.js';

const MODE_KEY = 'localLingua_uiMode';
const THEME_KEY = 'localLingua_theme';

function syncLightingButtons(theme) {
  document.querySelectorAll('#lightingToggle .lighting-toggle-btn').forEach((btn) => {
    const active = btn.dataset.lighting === theme;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', String(active));
  });
}

function reparentForMode(mode) {
  const responseBar = document.getElementById('userResponseBar');
  const chatColumn = document.querySelector('.section-top-left');
  const rightColumn = document.querySelector('.section-top-right');
  const srcSelect = document.getElementById('srcLang');
  const tgtSelect = document.getElementById('tgtLang');
  const srcSlot = document.getElementById('glanceSrcLangSlot');
  const tgtSlot = document.getElementById('glanceTgtLangSlot');
  // .chat-section:first-of-type/:last-of-type never match here — several
  // other <div> siblings (status bar, verdict, search bar) precede these two
  // in the markup, so the structural pseudo-class picks one of those instead
  // of a .chat-section. Index into the actual .chat-section list instead.
  const chatSections = document.querySelectorAll('.chat-section');
  const srcHeader = chatSections[0] ? chatSections[0].querySelector('.chat-header') : null;
  const tgtHeader = chatSections[1] ? chatSections[1].querySelector('.chat-header') : null;
  if (!responseBar || !chatColumn || !rightColumn) return;

  if (mode === 'simple') {
    if (responseBar.parentElement !== chatColumn) {
      chatColumn.appendChild(responseBar);
    }
    if (srcSelect && srcSlot && srcSelect.parentElement !== srcSlot) srcSlot.appendChild(srcSelect);
    if (tgtSelect && tgtSlot && tgtSelect.parentElement !== tgtSlot) tgtSlot.appendChild(tgtSelect);
  } else {
    if (responseBar.parentElement !== rightColumn) rightColumn.appendChild(responseBar);
    if (srcSelect && srcHeader && srcSelect.parentElement !== srcHeader) srcHeader.appendChild(srcSelect);
    if (tgtSelect && tgtHeader && tgtSelect.parentElement !== tgtHeader) tgtHeader.appendChild(tgtSelect);
  }
}

export function applyMode(mode) {
  document.documentElement.setAttribute('data-mode', mode);
  reparentForMode(mode);

  document.querySelectorAll('#modeToggle .mode-toggle-btn').forEach((btn) => {
    const active = btn.dataset.mode === mode;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', String(active));
  });

  // The Night/Day/Sunlight toggle is hidden outside Simple mode, so its
  // active button can go stale if the Advanced sun/moon toggle changed
  // data-theme in the meantime. Re-sync on every switch into Simple mode.
  if (mode === 'simple') {
    syncLightingButtons(document.documentElement.getAttribute('data-theme') || 'dark');
    // Bubbles created while in Advanced mode never ran the Glance-mode
    // shrink-to-fit pass; re-fit once layout settles after the mode switch.
    requestAnimationFrame(refitGlanceBubbles);
  } else {
    // Clear the inline font-size the Glance shrink-to-fit pass leaves on
    // bubbles — otherwise it outlives the mode switch and overrides
    // Advanced mode's own .chat-bubble font-size rule in style.css.
    resetGlanceBubbleFonts();
  }
}

export function initMode() {
  const toggle = document.getElementById('modeToggle');
  const saved = localStorage.getItem(MODE_KEY) || 'advanced';
  applyMode(saved);

  if (!toggle) return;
  toggle.addEventListener('click', (e) => {
    const btn = e.target.closest('.mode-toggle-btn');
    if (!btn) return;
    const mode = btn.dataset.mode;
    applyMode(mode);
    localStorage[MODE_KEY] = mode;
  });
}

// ============================================================
// Lighting mode — Night / Day / Sunlight (Simple mode only)
// ============================================================
// A separate control from the Advanced-mode dark/light sun/moon toggle in
// index.html, but both read/write the same `data-theme` attribute and
// localStorage key, so switching modes never leaves the app looking
// inconsistent with whichever toggle was used last.

export function applyLighting(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage[THEME_KEY] = theme;
  syncLightingButtons(theme);

  // Keep the Advanced toggle's icon in sync too, in case the user switches
  // modes without touching that toggle again. Sunlight has no icon of its
  // own — it reads as "light" for this purpose (moon shown, click -> dark).
  const sun = document.getElementById('themeIconSun');
  const moon = document.getElementById('themeIconMoon');
  if (sun) sun.style.display = theme === 'dark' ? '' : 'none';
  if (moon) moon.style.display = theme !== 'dark' ? '' : 'none';
}

export function initLighting() {
  const toggle = document.getElementById('lightingToggle');
  const saved = document.documentElement.getAttribute('data-theme') || localStorage.getItem(THEME_KEY) || 'dark';
  syncLightingButtons(saved);

  if (!toggle) return;
  toggle.addEventListener('click', (e) => {
    const btn = e.target.closest('.lighting-toggle-btn');
    if (!btn) return;
    applyLighting(btn.dataset.lighting);
  });
}
