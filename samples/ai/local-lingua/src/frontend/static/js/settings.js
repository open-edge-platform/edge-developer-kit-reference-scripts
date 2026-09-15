// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/**
 * Local Lingua — Model/Device Selection Panel (AI Playground-style)
 *
 * Shows all available models per stage with clear status:
 * - Downloaded & active: green indicator
 * - Downloaded but not selected: neutral indicator
 * - Not downloaded: download button with progress
 *
 * Models are grouped by pipeline stage as expandable cards.
 */

import { fetchModels, selectModel, downloadModel, fetchCurrentAssignments } from './api.js';
import { refreshArchitectureDiagram } from './architecture.js';

const STAGES = ['transcription', 'translation', 'sentiment', 'voice_emotion', 'text_to_speech', 'mission_cue_llm'];

const STAGE_DISPLAY = {
  transcription: { label: 'Speech-to-Text (Transcription)', icon: '🎤' },
  translation: { label: 'Translation', icon: '🌐' },
  sentiment: { label: 'Sentiment Analysis', icon: '💬' },
  voice_emotion: { label: 'Voice Emotion', icon: '🎭' },
  text_to_speech: { label: 'Text-to-Speech', icon: '🔊' },
  mission_cue_llm: { label: 'Mission Cue LLM', icon: '📋' },
};

// ============================================================
// Fetch current assignments from backend
// ============================================================

// ============================================================
// Token prompt for gated models
// ============================================================

function promptForToken(modelName) {
  return new Promise((resolve) => {
    const overlay = document.getElementById('consentModal');
    const titleEl = document.getElementById('consentTitle');
    const msgEl = document.getElementById('consentMessage');
    const allowBtn = document.getElementById('consentAllow');
    const denyBtn = document.getElementById('consentDeny');

    titleEl.textContent = 'HuggingFace Access Token Required';

    msgEl.textContent = '';
    const desc = document.createElement('span');
    desc.textContent = `The model "${modelName}" requires a HuggingFace access token to download.`;
    const tokenInput = document.createElement('input');
    tokenInput.type = 'password';
    tokenInput.id = 'hfTokenInput';
    tokenInput.placeholder = 'hf_...';
    tokenInput.style.cssText = 'width:100%;padding:8px;border-radius:4px;border:1px solid var(--token-input-border);background:var(--token-input-bg);color:var(--text-primary);margin-top:12px;';
    msgEl.appendChild(desc);
    msgEl.appendChild(tokenInput);

    overlay.classList.remove('hidden');

    function cleanup(result) {
      overlay.classList.add('hidden');
      allowBtn.removeEventListener('click', onAllow);
      denyBtn.removeEventListener('click', onDeny);
      msgEl.textContent = '';
      resolve(result);
    }

    function onAllow() {
      const input = document.getElementById('hfTokenInput');
      cleanup(input ? input.value.trim() : null);
    }
    function onDeny() { cleanup(null); }

    allowBtn.addEventListener('click', onAllow);
    denyBtn.addEventListener('click', onDeny);
  });
}

// ============================================================
// Build Settings UI
// ============================================================

let _settingsInitialized = false;

export async function initSettings() {
  if (_settingsInitialized) return;
  _settingsInitialized = true;

  const grid = document.getElementById('settingsGrid');
  grid.textContent = '';

  let models = [];
  let currentAssignments = {};
  try {
    [models, currentAssignments] = await Promise.all([
      fetchModels(),
      fetchCurrentAssignments(),
    ]);
  } catch (e) {
    console.error('Load models error:', e);
  }

  // Deduplicate models by stage+modelId
  const seen = new Set();
  models = (Array.isArray(models) ? models : []).filter(m => {
    const key = `${m.stage}:${m.modelId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  STAGES.forEach(stage => {
    const allStageModels = models.filter(m => m.stage === stage);
    if (allStageModels.length === 0) return;

    const stageInfo = STAGE_DISPLAY[stage] || { label: stage, icon: '' };
    const current = currentAssignments[stage];

    // Stage card container
    const card = document.createElement('div');
    card.className = 'settings-stage-card';

    // Card header with stage name and current device
    const header = document.createElement('div');
    header.className = 'stage-card-header';

    const headerLeft = document.createElement('div');
    headerLeft.className = 'stage-card-title';
    const iconSpan = document.createElement('span');
    iconSpan.className = 'stage-icon';
    iconSpan.textContent = stageInfo.icon;
    headerLeft.appendChild(iconSpan);
    const stageLabel = document.createElement('span');
    stageLabel.textContent = ' ' + stageInfo.label;
    headerLeft.appendChild(stageLabel);

    // Target selector in the header
    const targetSelect = document.createElement('select');
    targetSelect.className = 'target-select';
    targetSelect.id = `target-${stage}`;
    const stageTargets = [...new Set(allStageModels.flatMap(m => m.supportedTargets || []))];
    (['CPU', 'GPU', 'NPU']).filter(t => stageTargets.includes(t)).forEach(t => {
      const opt = document.createElement('option');
      opt.value = t;
      opt.textContent = t;
      targetSelect.appendChild(opt);
    });
    if (current) {
      targetSelect.value = current.actualDevice || current.target || 'CPU';
    } else if (allStageModels.length > 0 && allStageModels[0].recommendedTarget) {
      targetSelect.value = allStageModels[0].recommendedTarget;
    }

    header.appendChild(headerLeft);
    header.appendChild(targetSelect);
    card.appendChild(header);

    // Model list
    const modelList = document.createElement('div');
    modelList.className = 'model-list';

    function renderModelList() {
      modelList.textContent = '';
      const current = currentAssignments[stage];
      const currentTarget = targetSelect.value;
      const compatibleModels = allStageModels.filter(
        m => m.supportedTargets && m.supportedTargets.includes(currentTarget)
      );

      if (compatibleModels.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'model-item-empty';
        empty.textContent = `No models available for ${currentTarget}`;
        modelList.appendChild(empty);
        return;
      }

      compatibleModels.forEach(m => {
        const isActive = current && current.modelId === m.modelId;
        const item = document.createElement('div');
        item.className = `model-item ${isActive ? 'active' : ''} ${!m.enabled ? 'not-downloaded' : ''}`;

        // Status indicator
        const status = document.createElement('div');
        if (m.enabled && isActive) {
          status.className = 'model-status active';
          status.title = 'Active';
        } else if (m.enabled) {
          status.className = 'model-status ready';
          status.title = 'Downloaded';
        } else {
          status.className = 'model-status unavailable';
          status.title = 'Not downloaded';
        }

        // Model info
        const info = document.createElement('div');
        info.className = 'model-info';

        const nameEl = document.createElement('div');
        nameEl.className = 'model-name';
        nameEl.textContent = m.displayName || m.modelId;

        const metaEl = document.createElement('div');
        metaEl.className = 'model-meta';
        const metaParts = [];
        if (m.note) metaParts.push(m.note);
        if (m.preQuantized) metaParts.push('Pre-quantized');
        if (m.supportedTargets) metaParts.push(m.supportedTargets.join(' / '));
        metaEl.textContent = metaParts.join(' · ');

        info.appendChild(nameEl);
        info.appendChild(metaEl);

        // Action button
        const action = document.createElement('div');
        action.className = 'model-action';

        if (!m.enabled) {
          // Download button with progress fill
          const btn = document.createElement('button');
          btn.className = 'btn-download';
          btn.textContent = 'Download';

          // Progress fill bar (inside the button)
          const fill = document.createElement('span');
          fill.className = 'btn-download-fill';
          btn.appendChild(fill);

          btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            let token = null;
            if (m.requiresToken) {
              token = await promptForToken(m.displayName || m.modelId);
              if (!token) return;
            }

            btn.disabled = true;
            btn.classList.add('downloading');
            btn.textContent = '0%';
            btn.appendChild(fill);
            fill.style.width = '0%';
            status.className = 'model-status downloading';

            try {
              await downloadModel(m.modelId, stage, token, ({ percent, message }) => {
                fill.style.width = `${percent}%`;
                btn.textContent = `${percent}%`;
                btn.appendChild(fill);
              });

              m.enabled = true;
              btn.classList.remove('downloading');
              btn.classList.add('complete');
              btn.textContent = 'Done';
              fill.style.width = '100%';
              btn.appendChild(fill);
              status.className = 'model-status ready';
              status.title = 'Downloaded';
              setTimeout(() => renderModelList(), 800);
            } catch (err) {
              btn.classList.remove('downloading');
              btn.classList.add('error');
              btn.textContent = 'Retry';
              fill.style.width = '0%';
              btn.appendChild(fill);
              btn.disabled = false;
              status.className = 'model-status error';
              status.title = `Failed: ${err.message}`;
              setTimeout(() => btn.classList.remove('error'), 2000);
            }
          });
          action.appendChild(btn);
        } else if (!isActive) {
          // Select/activate button
          const btn = document.createElement('button');
          btn.className = 'btn-select-model';
          btn.textContent = 'Use';
          btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            btn.textContent = 'Loading...';
            btn.disabled = true;

            // Use the dropdown target if the model supports it, otherwise pick the best supported one
            let target = targetSelect.value;
            if (m.supportedTargets && !m.supportedTargets.includes(target)) {
              target = m.recommendedTarget || m.supportedTargets[0] || 'CPU';
            }

            try {
              await selectModel(stage, m.modelId, target);
              currentAssignments[stage] = { modelId: m.modelId, target: target, actualDevice: target };
              targetSelect.value = target;
              renderModelList();
              refreshArchitectureDiagram();
            } catch (err) {
              btn.textContent = 'Error';
              btn.disabled = false;
              console.error('Model select error:', err);
            }
          });
          action.appendChild(btn);
        } else {
          const badge = document.createElement('span');
          badge.className = 'badge-active';
          badge.textContent = 'Active';
          action.appendChild(badge);
        }

        item.appendChild(status);
        item.appendChild(info);
        item.appendChild(action);
        modelList.appendChild(item);
      });
    }

    renderModelList();

    targetSelect.addEventListener('change', async () => {
      renderModelList();
      const active = currentAssignments[stage];
      if (active && active.modelId) {
        const model = allStageModels.find(m => m.modelId === active.modelId);
        if (model && model.enabled && model.supportedTargets.includes(targetSelect.value)) {
          try {
            await selectModel(stage, active.modelId, targetSelect.value);
            currentAssignments[stage] = { ...active, target: targetSelect.value, actualDevice: targetSelect.value };
            refreshArchitectureDiagram();
          } catch (e) {
            console.error('Target change error:', e);
          }
        }
      }
    });

    card.appendChild(modelList);
    grid.appendChild(card);
  });
}
