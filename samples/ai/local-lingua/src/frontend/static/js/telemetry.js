// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/**
 * Local Lingua — Hardware Utilization Graphs (Time Series)
 * Displays CPU, GPU, NPU, and system memory metrics from Intel metrics-manager.
 * Includes power draw, frequency, and per-engine GPU utilization.
 */

const MAX_POINTS = 60;

function getGraphColors() {
  const style = getComputedStyle(document.documentElement);
  return {
    cpu: style.getPropertyValue('--graph-cpu').trim() || '#2196f3',
    gpu: style.getPropertyValue('--graph-gpu').trim() || '#4caf50',
    npu: style.getPropertyValue('--graph-npu').trim() || '#ff9800',
    mem: style.getPropertyValue('--graph-mem').trim() || '#ab47bc',
    grid: style.getPropertyValue('--graph-grid').trim() || 'rgba(255,255,255,0.06)',
  };
}

const history = {
  cpu: [],
  gpu: [],
  npu: [],
  mem: [],
};

let _eventSource = null;

function drawGraph(canvasId, data, color) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  const colors = getGraphColors();

  ctx.clearRect(0, 0, w, h);

  // Grid lines
  ctx.strokeStyle = colors.grid;
  ctx.lineWidth = 1;
  for (let i = 1; i < 4; i++) {
    const y = (h / 4) * i;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }

  if (data.length < 2) return;

  // Fill area
  ctx.beginPath();
  ctx.moveTo(0, h);
  for (let i = 0; i < data.length; i++) {
    const x = (i / (MAX_POINTS - 1)) * w;
    const y = h - (data[i] / 100) * h;
    ctx.lineTo(x, y);
  }
  ctx.lineTo(((data.length - 1) / (MAX_POINTS - 1)) * w, h);
  ctx.closePath();
  ctx.fillStyle = color.replace(')', ',0.15)').replace('rgb', 'rgba');
  ctx.fill();

  // Line
  ctx.beginPath();
  for (let i = 0; i < data.length; i++) {
    const x = (i / (MAX_POINTS - 1)) * w;
    const y = h - (data[i] / 100) * h;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.stroke();
}

// ============================================================
// Per-device activity labels (static base + live inference stages)
// ============================================================

const BASE_ACTIVITY_LABEL = 'OS + Userspace';

// Maps a stage label to a modifier class so each stage gets its own colour
const ACTIVITY_CLASS = {
  'Transcription': 'activity-transcription',
  'Translation': 'activity-translation',
  'Sentiment': 'activity-sentiment',
  'Text-to-Speech': 'activity-tts',
  'Voice Emotion': 'activity-emotion',
};

// Last rendered label set per element, so we only touch the DOM on change
// (rebuilding every tick would restart the chip entry animation).
const _lastActivity = {};

function updateActivityLabels(containerId, activity) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const stages = Array.isArray(activity) ? activity : [];
  const signature = stages.join('|');
  if (_lastActivity[containerId] === signature) return;
  _lastActivity[containerId] = signature;

  container.textContent = '';

  const base = document.createElement('span');
  base.className = 'activity-chip activity-chip-base';
  base.textContent = BASE_ACTIVITY_LABEL;
  container.appendChild(base);

  stages.forEach(stage => {
    const chip = document.createElement('span');
    const modifier = ACTIVITY_CLASS[stage] || 'activity-generic';
    chip.className = `activity-chip activity-chip-live ${modifier}`;
    const dot = document.createElement('span');
    dot.className = 'activity-dot';
    chip.appendChild(dot);
    const stageLabel = document.createElement('span');
    stageLabel.textContent = stage;
    chip.appendChild(stageLabel);
    container.appendChild(chip);
  });
}

function formatGB(bytes) {
  return (bytes / 1024 ** 3).toFixed(1);
}

function updateTelemetry(data) {
  const cpu = data.cpu?.utilizationPercent || 0;
  const gpu = data.gpu?.utilizationPercent || 0;
  const npu = data.npu?.utilizationPercent || 0;
  const mem = data.memory?.usedPercent || 0;

  history.cpu.push(cpu);
  history.gpu.push(gpu);
  history.npu.push(npu);
  history.mem.push(mem);

  if (history.cpu.length > MAX_POINTS) history.cpu.shift();
  if (history.gpu.length > MAX_POINTS) history.gpu.shift();
  if (history.npu.length > MAX_POINTS) history.npu.shift();
  if (history.mem.length > MAX_POINTS) history.mem.shift();

  // Update value labels
  const cpuVal = document.getElementById('cpuValue');
  const gpuVal = document.getElementById('gpuValue');
  const npuVal = document.getElementById('npuValue');
  const memVal = document.getElementById('memValue');
  if (cpuVal) cpuVal.textContent = `${Math.round(cpu)}%`;
  if (gpuVal) gpuVal.textContent = `${Math.round(gpu)}%`;
  if (npuVal) npuVal.textContent = `${Math.round(npu)}%`;
  if (memVal) memVal.textContent = `${Math.round(mem)}%`;

  // Update detailed metrics
  const cpuFreq = document.getElementById('cpuFreq');
  const cpuTemp = document.getElementById('cpuTemp');
  const gpuFreq = document.getElementById('gpuFreq');

  if (cpuFreq && data.cpu?.frequency) {
    cpuFreq.textContent = `${data.cpu.frequency.toFixed(1)} GHz`;
  }
  if (cpuTemp && data.cpu?.temperature != null) {
    cpuTemp.textContent = `${Math.round(data.cpu.temperature)}°C`;
  }
  if (gpuFreq) {
    const gf = data.gpu?.frequency;
    gpuFreq.textContent = gf != null ? `${gf.toFixed(2)} GHz` : '';
  }
  const npuTemp = document.getElementById('npuTemp');
  if (npuTemp) {
    const nt = data.npu?.temperature;
    npuTemp.textContent = nt != null ? `${Math.round(nt)}°C` : '';
  }

  // Update CPU usage breakdown
  const cpuUsageEl = document.getElementById('cpuUsage');
  if (cpuUsageEl && data.cpu?.usage) {
    const u = data.cpu.usage;
    const user = Math.round(u.user || 0);
    const system = Math.round(u.system || 0);
    const idle = Math.round(u.idle || 0);
    cpuUsageEl.textContent = `User: ${user}% | System: ${system}% | Idle: ${idle}%`;
  }

  // Update GPU engine breakdown
  const engines = data.gpu?.engines;
  const engineEl = document.getElementById('gpuEngines');
  if (engineEl && engines) {
    const compute = Math.round(engines.compute || engines.ccs || 0);
    const render = Math.round(engines.render || engines.rcs || 0);
    const copy = Math.round(engines.copy || engines.bcs || 0);
    const video = Math.round(engines.video || engines.vcs || 0);
    engineEl.textContent = `Compute: ${compute}% | Render: ${render}% | Video: ${video}% | Copy: ${copy}%`;
  }

  // Update NPU detail
  const npuDetailEl = document.getElementById('npuDetail');
  if (npuDetailEl && data.npu) {
    const bw = data.npu.bandwidth || 0;
    const util = Math.round(data.npu.utilizationPercent || 0);
    npuDetailEl.textContent = `Utilization: ${util}% | Bandwidth: ${bw} | Mem: ${Math.round(data.npu.memoryMB || 0)} MB`;
  }

  // Update memory detail
  const memTotalEl = document.getElementById('memTotal');
  const memDetailEl = document.getElementById('memDetail');
  const total = data.memory?.totalBytes || 0;
  const used = data.memory?.usedBytes || 0;
  if (memTotalEl) {
    memTotalEl.textContent = total ? `${formatGB(total)} GB` : '';
  }
  if (memDetailEl) {
    const avail = data.memory?.availablePercent;
    memDetailEl.textContent = total
      ? `Used: ${formatGB(used)} GB / ${formatGB(total)} GB | Available: ${Math.round(avail ?? (100 - mem))}%`
      : `Used: ${Math.round(mem)}%`;
  }

  // Update per-device activity labels
  updateActivityLabels('cpuActivity', data.cpu?.activity);
  updateActivityLabels('gpuActivity', data.gpu?.activity);
  updateActivityLabels('npuActivity', data.npu?.activity);

  // Draw graphs
  const colors = getGraphColors();
  drawGraph('cpuGraph', history.cpu, colors.cpu);
  drawGraph('gpuGraph', history.gpu, colors.gpu);
  drawGraph('npuGraph', history.npu, colors.npu);
  drawGraph('memGraph', history.mem, colors.mem);
}

let _sseRetryDelay = 3000;
const _SSE_MAX_DELAY = 30000;

function startSSE() {
  if (_eventSource) return;

  _eventSource = new EventSource('/api/telemetry/stream');

  _eventSource.onmessage = (event) => {
    _sseRetryDelay = 3000;
    try {
      const data = JSON.parse(event.data);
      updateTelemetry(data);
    } catch (e) {
      // ignore parse errors
    }
  };

  _eventSource.onerror = () => {
    _eventSource.close();
    _eventSource = null;
    setTimeout(startSSE, _sseRetryDelay);
    _sseRetryDelay = Math.min(_sseRetryDelay * 2, _SSE_MAX_DELAY);
  };
}

let _pollInterval = null;

function startPollingFallback() {
  async function poll() {
    try {
      const resp = await fetch('/api/telemetry/current');
      if (resp.ok) {
        const data = await resp.json();
        updateTelemetry(data);
      }
    } catch (e) {
      // ignore polling errors
    }
  }
  poll();
  _pollInterval = setInterval(poll, 2000);
}

let _telemetryInitialized = false;

export function initTelemetry() {
  if (_telemetryInitialized) return;
  _telemetryInitialized = true;

  // Set canvas sizes based on their container
  ['cpuGraph', 'gpuGraph', 'npuGraph', 'memGraph'].forEach(id => {
    const canvas = document.getElementById(id);
    if (canvas) {
      const rect = canvas.parentElement.getBoundingClientRect();
      canvas.width = Math.max(rect.width - 24, 200);
      canvas.height = 60;
    }
  });

  // Prefer SSE streaming for live updates
  if (typeof EventSource !== 'undefined') {
    startSSE();
  } else {
    startPollingFallback();
  }
}
