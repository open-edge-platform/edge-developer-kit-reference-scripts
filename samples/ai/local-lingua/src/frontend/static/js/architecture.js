// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/**
 * Local Lingua — Architecture Diagram (dynamic CPU/GPU/NPU routing)
 *
 * The Architecture tab's SVG has static node positions but its hardware
 * connections, corner badges, and hardware sublabels are redrawn here to
 * reflect the live per-stage model/target assignments from Settings.
 */

import { fetchCurrentAssignments } from './api.js';

// x-center of each AI model node's bottom edge (y=414) — must match the
// node <rect> positions in index.html.
const MODEL_ANCHOR_X = {
  transcription: 162,
  text_to_speech: 307,
  translation: 452,
  mission_cue_llm: 612,
  sentiment: 767,
  voice_emotion: 917,
};

// Fallback label per stage, used only if the currently assigned modelId
// isn't in MODEL_SHORT_NAME_BY_ID below (e.g. a model added to config.yaml
// without updating this map) or assignments haven't loaded yet.
const STAGE_FALLBACK_LABEL = {
  transcription: 'Whisper',
  text_to_speech: 'Kokoro',
  translation: 'NLLB',
  mission_cue_llm: 'Qwen',
  sentiment: 'RoBERTa',
  voice_emotion: 'Wav2Vec2',
};

// Short display label per registry modelId (see model_registry.py's
// _make_model_id — the HF repo name's last path segment), keyed this way
// rather than by stage so the diagram reflects whichever alternative is
// actually selected, not just a fixed per-stage guess.
const MODEL_SHORT_NAME_BY_ID = {
  'whisper-medium': 'Whisper Medium',
  'whisper-large-v3-turbo': 'Whisper Large v3',
  'cohere-transcribe-03-2026': 'Cohere Transcribe',
  'nllb-200-3.3B': 'NLLB-200 3.3B',
  'nllb-200-distilled-1.3B': 'NLLB-200 1.3B',
  'nllb-200-distilled-600M': 'NLLB-200 600M',
  'roberta-base-go_emotions': 'RoBERTa',
  'twitter-roberta-base-sentiment-latest': 'Twitter RoBERTa',
  'tiny-aya-global': 'Tiny Aya',
  'Kokoro-82M-int8-ov': 'Kokoro-82M',
  'Qwen2.5-1.5B-Instruct-int4-ov': 'Qwen2.5-1.5B',
  'Phi-3-mini-4k-instruct-int4-ov': 'Phi-3-mini',
  'speech-emotion-recognition-with-facebook-wav2vec2-large-xlsr-53': 'Wav2Vec2',
  'wav2vec2-large-robust-12-ft-emotion-msp-dim': 'Wav2Vec2 (dim.)',
  'wav2vec2-lg-xlsr-en-speech-emotion-recognition': 'Wav2Vec2 (8-cls)',
};

// Top edge of each hardware box (y=540) — must match the hw <rect> positions.
const HW_BOX = {
  CPU: { x: 166, width: 140, topY: 540 },
  GPU: { x: 470, width: 140, topY: 540 },
  NPU: { x: 749, width: 140, topY: 540 },
};

const HW_SUBLABEL_ID = { CPU: 'arch-hw-cpu-sub', GPU: 'arch-hw-gpu-sub', NPU: 'arch-hw-npu-sub' };
const START_Y = 414;

let _initialized = false;

export function initArchitecture() {
  if (_initialized) return;
  _initialized = true;

  const btn = document.querySelector('.tab-btn[data-tab="architecture"]');
  if (btn) btn.addEventListener('click', refreshArchitectureDiagram);

  // Draw once immediately so the diagram is correct even before the tab is opened.
  refreshArchitectureDiagram();
}

export async function refreshArchitectureDiagram() {
  const svg = document.querySelector('.architecture-svg');
  if (!svg) return;

  let assignments = {};
  try {
    assignments = await fetchCurrentAssignments();
  } catch (e) {
    console.error('Load architecture assignments error:', e);
    return;
  }

  // Resolve each stage's live target device, defaulting to CPU if unknown/unassigned.
  const stageTarget = {};
  const stageLabel = {};
  Object.keys(MODEL_ANCHOR_X).forEach(stage => {
    const a = assignments[stage];
    const target = (a && (a.actualDevice || a.target) || '').toUpperCase();
    stageTarget[stage] = HW_BOX[target] ? target : 'CPU';

    const modelId = a && a.modelId;
    const label = (modelId && MODEL_SHORT_NAME_BY_ID[modelId]) || modelId || STAGE_FALLBACK_LABEL[stage];
    stageLabel[stage] = label;
    const labelEl = document.getElementById(`arch-node-label-${stage}`);
    if (labelEl) labelEl.textContent = label;
  });

  // Group stages by device, sorted left-to-right, so lines fan out evenly
  // across the destination hardware box instead of stacking on one point.
  const byTarget = { CPU: [], GPU: [], NPU: [] };
  Object.keys(stageTarget).forEach(stage => byTarget[stageTarget[stage]].push(stage));
  Object.values(byTarget).forEach(stages => stages.sort((a, b) => MODEL_ANCHOR_X[a] - MODEL_ANCHOR_X[b]));

  Object.entries(byTarget).forEach(([target, stages]) => {
    const box = HW_BOX[target];
    const margin = 15;
    const usable = box.width - margin * 2;

    stages.forEach((stage, i) => {
      const frac = stages.length === 1 ? 0.5 : i / (stages.length - 1);
      updateConnection(stage, box.x + margin + usable * frac, box.topY, target);
      updateBadge(stage, target);
    });

    const sub = document.getElementById(HW_SUBLABEL_ID[target]);
    if (sub) {
      sub.textContent = stages.length ? stages.map(s => stageLabel[s]).join(' \u2022 ') : 'Idle';
    }
  });
}

function updateConnection(stage, targetX, targetY, target) {
  const d = `M${MODEL_ANCHOR_X[stage]},${START_Y} L${targetX},${targetY}`;
  const deviceClass = `arch-connection-hw-${target.toLowerCase()}`;
  const dotClass = `arch-travel-dot-hw-${target.toLowerCase()}`;

  const path = document.getElementById(`arch-hwconn-${stage}`);
  if (path) {
    path.setAttribute('d', d);
    path.setAttribute('class', `arch-connection-hw ${deviceClass}`);
  }

  const motion = document.getElementById(`arch-hwconn-${stage}-motion`);
  if (motion) motion.setAttribute('path', d);

  const dot = document.getElementById(`arch-hwconn-${stage}-dot`);
  if (dot) dot.setAttribute('class', `arch-travel-dot arch-travel-dot-hw ${dotClass}`);
}

function updateBadge(stage, target) {
  const circle = document.getElementById(`arch-badge-${stage}`);
  if (circle) {
    circle.setAttribute('class', `arch-device-badge arch-device-badge-${target.toLowerCase()}`);
    const title = circle.querySelector('title');
    if (title) title.textContent = target;
  }
  const text = document.getElementById(`arch-badge-${stage}-text`);
  if (text) text.textContent = target[0];
}
