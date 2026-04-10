// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

const label = document.getElementById("progress-label");
const logTicker = document.getElementById("log-ticker");
const logAccordion = document.getElementById("log-accordion");
const logSummary = document.getElementById("log-summary");
const logPanelInner = document.getElementById("log-panel-inner");
const progressBar = document.getElementById("progress-bar");

let tickerTimer = null;

function appendLog(text) {
  const trimmed = text.trim();
  if (!trimmed) return;

  // Cross-fade ticker to latest line
  clearTimeout(tickerTimer);
  logTicker.classList.add("is-fading");
  tickerTimer = setTimeout(() => {
    logTicker.textContent = trimmed;
    logTicker.classList.remove("is-fading");
  }, 200);

  // Append to scrollable history
  const line = document.createElement("span");
  line.className = "log-line";
  line.textContent = trimmed;
  logPanelInner.appendChild(line);

  // Cap history at 200 lines
  while (logPanelInner.children.length > 200) {
    logPanelInner.removeChild(logPanelInner.firstChild);
  }

  // Auto-scroll if near bottom
  const atBottom =
    logPanelInner.scrollHeight - logPanelInner.scrollTop - logPanelInner.clientHeight < 20;
  if (atBottom) {
    logPanelInner.scrollTop = logPanelInner.scrollHeight;
  }
}

logSummary.addEventListener("click", () => {
  const open = logAccordion.classList.toggle("is-open");
  logSummary.setAttribute("aria-expanded", String(open));
  if (open) {
    requestAnimationFrame(() => {
      logPanelInner.scrollTop = logPanelInner.scrollHeight;
    });
  }
});

window.electronAPI.onPipLog((line) => appendLog(line));

window.electronAPI.onPipProgress((step) => {
  label.textContent = step.status;
  progressBar.style.width = step.progress + "%";

  // Update numeric percent display (matches the visual progress bar)
  const percentEl = document.getElementById("progress-percent");
  if (percentEl) {
    const val = Number(step.progress);
    percentEl.textContent = `${Math.round(isNaN(val) ? 0 : val)}%`;
  }
});

window.electronAPI.onPipDone((code) => {
  label.textContent =
    code === 0 ? "Installation complete!" : "Installation failed!";
  progressBar.style.width = "100%";
});
