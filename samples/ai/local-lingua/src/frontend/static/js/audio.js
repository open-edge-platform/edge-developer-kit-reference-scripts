/**
 * Local Lingua — Mic Recording with Voice Activity Detection (VAD)
 * Auto-stops on silence for a smooth assistant-like UX.
 */

import { postLocalMic, postLocalFileStream, postLocalText, postUserMic, postUserFileStream, postUserText } from './api.js';
import { addLocalMessage, addUserMessage } from './chat.js';
import { requestMicConsent, requestFileConsent } from './app.js';
import { handleAutoSentiment } from './sentiment.js';
import { updateMissionCues } from './mission_cues.js';
import { showToast } from './toast.js';
import { currentEpoch, isStale } from './session.js';

// ============================================================
// VAD Configuration
// ============================================================

const VAD_ABSOLUTE_FLOOR = 0.01;       // RMS below this is always silence regardless of calibration
const VAD_SPEECH_MULTIPLIER = 3.0;     // Speech threshold = ambient noise level * this multiplier
const VAD_MIN_SPEECH_THRESHOLD = 0.04; // Minimum speech threshold even in quiet environments
const VAD_CALIBRATION_MS = 500;        // ms to measure ambient noise at start of recording
const VAD_SPEECH_CONFIRM_MS = 250;     // ms of continuous speech needed to confirm voice activity
const VAD_SILENCE_DURATION = 3000;     // ms of silence after speech before auto-stop
const VAD_NO_SPEECH_TIMEOUT = 8000;    // ms to wait for speech before giving up
const VAD_CHECK_INTERVAL = 100;        // ms between VAD checks
const MAX_RECORDING_DURATION = 600000; // 10 min max recording duration
const MAX_FILE_SIZE_MB = 200;          // 200MB max file upload (supports 10+ min audio)

// ============================================================
// Recording State
// ============================================================

let localRecorder = null;
let userRecorder = null;
let localRecording = false;
let userRecording = false;

let localStream = null;
let userStream = null;
let localAnalyser = null;
let userAnalyser = null;
let localVadTimer = null;
let userVadTimer = null;
let localMaxTimer = null;
let userMaxTimer = null;
let localSpeechDetected = false;
let userSpeechDetected = false;

// Persistent mic stream — acquired once, reused across recordings
let _persistentStream = null;
let _persistentAudioCtx = null;

async function _getOrCreateStream() {
  if (_persistentStream && _persistentStream.active) {
    return _persistentStream;
  }
  _persistentStream = await navigator.mediaDevices.getUserMedia({
    audio: { sampleRate: 16000, channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true }
  });
  return _persistentStream;
}

async function _getOrCreateAudioCtx() {
  if (_persistentAudioCtx && _persistentAudioCtx.state !== 'closed') {
    if (_persistentAudioCtx.state === 'suspended') {
      await _persistentAudioCtx.resume();
    }
    return _persistentAudioCtx;
  }
  _persistentAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return _persistentAudioCtx;
}

// ============================================================
// Language Helpers
// ============================================================

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

// ============================================================
// Audio Level Visualization
// ============================================================

function getRMS(analyser) {
  const data = new Float32Array(analyser.fftSize);
  analyser.getFloatTimeDomainData(data);
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    sum += data[i] * data[i];
  }
  return Math.sqrt(sum / data.length);
}

function updateMicLevel(btn, analyser) {
  if (!analyser) return;
  const rms = getRMS(analyser);
  const level = Math.min(rms * 15, 1);
  btn.style.setProperty('--mic-level', level);
}

// ============================================================
// VAD — Voice Activity Detection
// ============================================================

function startVAD(type, analyser, startTime) {
  let silenceStart = null;
  let speechStart = null;
  let speechConfirmed = false;
  let calibrated = false;
  let speechThreshold = VAD_MIN_SPEECH_THRESHOLD;
  const calibrationSamples = [];

  const btnId = type === 'local' ? 'btnLocalMic' : 'btnUserMic';
  const btn = document.getElementById(btnId);

  const interval = setInterval(() => {
    if ((type === 'local' && !localRecording) || (type === 'user' && !userRecording)) {
      clearInterval(interval);
      return;
    }

    updateMicLevel(btn, analyser);

    const rms = getRMS(analyser);
    const elapsed = Date.now() - startTime;

    // Calibration phase: measure ambient noise for the first VAD_CALIBRATION_MS
    if (!calibrated) {
      calibrationSamples.push(rms);
      if (elapsed >= VAD_CALIBRATION_MS) {
        calibrated = true;
        const avgNoise = calibrationSamples.reduce((a, b) => a + b, 0) / calibrationSamples.length;
        speechThreshold = Math.max(VAD_MIN_SPEECH_THRESHOLD, avgNoise * VAD_SPEECH_MULTIPLIER);
      }
      return;
    }

    if (rms >= speechThreshold) {
      // Audio clearly above ambient noise — likely speech
      silenceStart = null;
      if (!speechStart) speechStart = Date.now();

      if (!speechConfirmed && (Date.now() - speechStart) >= VAD_SPEECH_CONFIRM_MS) {
        speechConfirmed = true;
        if (type === 'local') localSpeechDetected = true;
        else userSpeechDetected = true;
      }
    } else {
      // Below speech threshold
      speechStart = null;

      if (speechConfirmed) {
        if (!silenceStart) silenceStart = Date.now();
        if ((Date.now() - silenceStart) >= VAD_SILENCE_DURATION) {
          clearInterval(interval);
          stopRecording(type);
        }
      } else {
        if (elapsed >= VAD_NO_SPEECH_TIMEOUT) {
          clearInterval(interval);
          stopRecording(type);
        }
      }
    }
  }, VAD_CHECK_INTERVAL);

  return interval;
}

// ============================================================
// MediaRecorder — Start/Stop
// ============================================================

let _startingRecording = false;

async function startRecording(type) {
  if (_startingRecording) return;
  if (type === 'local' && localRecording) return;
  if (type === 'user' && userRecording) return;
  _startingRecording = true;

  const allowed = await requestMicConsent();
  if (!allowed) { _startingRecording = false; return; }

  try {
    const stream = await _getOrCreateStream();
    const audioCtx = await _getOrCreateAudioCtx();
    const source = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048;
    source.connect(analyser);

    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : MediaRecorder.isTypeSupported('audio/webm')
        ? 'audio/webm'
        : '';

    const options = mimeType ? { mimeType } : {};
    const mediaRecorder = new MediaRecorder(stream, options);
    const chunks = [];

    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };

    mediaRecorder.onstop = async () => {
      // Don't stop tracks or close context — keep them warm for next recording
      source.disconnect();
      const blob = new Blob(chunks, { type: mediaRecorder.mimeType });

      if (type === 'local') {
        localAnalyser = null;
        await handleLocalAudio(blob);
      } else {
        userAnalyser = null;
        await handleUserAudio(blob);
      }
    };

    mediaRecorder.start(250);

    const btnId = type === 'local' ? 'btnLocalMic' : 'btnUserMic';
    const btn = document.getElementById(btnId);
    btn.classList.add('recording');

    const indicatorId = type === 'local' ? 'localProcessing' : 'userProcessing';
    const indicator = document.getElementById(indicatorId);
    if (indicator) {
      indicator.textContent = 'Listening...';
      indicator.classList.remove('hidden');
    }

    if (type === 'local') {
      localRecorder = mediaRecorder;
      localRecording = true;
      localSpeechDetected = false;
      localStream = stream;
      localAnalyser = analyser;
      localVadTimer = startVAD('local', analyser, Date.now());
      localMaxTimer = setTimeout(() => {
        if (localRecording) {
          showToast('Max recording duration reached (60s)', 'warn');
          stopRecording('local');
        }
      }, MAX_RECORDING_DURATION);
    } else {
      userRecorder = mediaRecorder;
      userRecording = true;
      userSpeechDetected = false;
      userStream = stream;
      userAnalyser = analyser;
      userVadTimer = startVAD('user', analyser, Date.now());
      userMaxTimer = setTimeout(() => {
        if (userRecording) {
          showToast('Max recording duration reached (60s)', 'warn');
          stopRecording('user');
        }
      }, MAX_RECORDING_DURATION);
    }
  } catch (e) {
    console.error('Mic access error:', e);
    _persistentStream = null;
    showToast('Microphone access denied or unavailable.', 'error');
  } finally {
    _startingRecording = false;
  }
}

function stopRecording(type) {
  if (type === 'local' && localRecorder) {
    if (localVadTimer) { clearInterval(localVadTimer); localVadTimer = null; }
    if (localMaxTimer) { clearTimeout(localMaxTimer); localMaxTimer = null; }
    localRecorder.stop();
    localRecorder = null;
    localRecording = false;
    const btn = document.getElementById('btnLocalMic');
    btn.classList.remove('recording');
    btn.style.setProperty('--mic-level', 0);
    const indicator = document.getElementById('localProcessing');
    if (indicator) indicator.textContent = 'Transcribing...';
  } else if (type === 'user' && userRecorder) {
    if (userVadTimer) { clearInterval(userVadTimer); userVadTimer = null; }
    if (userMaxTimer) { clearTimeout(userMaxTimer); userMaxTimer = null; }
    userRecorder.stop();
    userRecorder = null;
    userRecording = false;
    const btn = document.getElementById('btnUserMic');
    btn.classList.remove('recording');
    btn.style.setProperty('--mic-level', 0);
    const indicator = document.getElementById('userProcessing');
    if (indicator) indicator.textContent = 'Transcribing...';
  }
}

// ============================================================
// Audio Sending
// ============================================================

async function handleLocalAudio(blob) {
  // Stamped before the request starts: if history is cleared while this is
  // in flight, the response must not repopulate the panels.
  const epoch = currentEpoch();
  if (!localSpeechDetected) {
    hideIndicator('localProcessing');
    return;
  }
  if (blob.size < 1000) {
    showToast('Recording too short, please try again.', 'warn');
    hideIndicator('localProcessing');
    return;
  }
  showIndicator('localProcessing', 'Transcribing...');
  try {
    const data = await postLocalMic(blob, getSrcLang(), getTgtLang());
    if (!data.originalText && !data.translatedText) {
      showToast('Could not transcribe audio. Try speaking louder or longer.', 'warn');
    } else {
      if (isStale(epoch) || data.discarded) return;
      addLocalMessage(data.originalText, data.translatedText, data.timestamp);
      handleAutoSentiment(data.sentiment, data.conversationSummary);
      if (data.missionCues) updateMissionCues(data.missionCues);
    }
  } catch (e) {
    console.error('Send local audio error:', e);
    showToast('Transcription failed. Check server logs.', 'error');
  } finally {
    if (!localRecording) hideIndicator('localProcessing');
  }
}

async function handleUserAudio(blob) {
  // Stamped before the request starts: if history is cleared while this is
  // in flight, the response must not repopulate the panels.
  const epoch = currentEpoch();
  if (!userSpeechDetected) {
    hideIndicator('userProcessing');
    return;
  }
  if (blob.size < 1000) {
    showToast('Recording too short, please try again.', 'warn');
    hideIndicator('userProcessing');
    return;
  }
  showIndicator('userProcessing', 'Transcribing...');
  try {
    const data = await postUserMic(blob, getTgtLang(), getSrcLang());
    if (!data.originalText && !data.translatedText) {
      showToast('Could not transcribe audio. Try speaking louder or longer.', 'warn');
    } else {
      if (isStale(epoch) || data.discarded) return;
      addUserMessage(data.originalText, data.translatedText, data.timestamp);
      handleAutoSentiment(data.sentiment, data.conversationSummary);
      if (data.missionCues) updateMissionCues(data.missionCues);
    }
  } catch (e) {
    console.error('Send user audio error:', e);
    showToast('Transcription failed. Check server logs.', 'error');
  } finally {
    if (!userRecording) hideIndicator('userProcessing');
  }
}

// ============================================================
// File Upload Handlers
// ============================================================

async function handleLocalFile(file) {
  // Stamped before the request starts: if history is cleared while this is
  // in flight, the response must not repopulate the panels.
  const epoch = currentEpoch();
  const allowed = await requestFileConsent();
  if (!allowed) return;

  if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
    showToast(`File too large (max ${MAX_FILE_SIZE_MB}MB). Use a shorter audio clip.`, 'error');
    return;
  }

  const sizeMB = (file.size / 1024 / 1024).toFixed(1);
  showIndicator('localProcessing', `Uploading (${sizeMB} MB)...`);
  try {
    const data = await postLocalFileStream(file, getSrcLang(), getTgtLang(), (progress) => {
      if (progress.stage === 'decoding') {
        showIndicator('localProcessing', 'Decoding audio...');
      } else if (progress.stage === 'transcribing') {
        const dur = progress.duration_s ? ` (${Math.round(progress.duration_s)}s)` : '';
        showIndicator('localProcessing', `Transcribing${dur}...`);
      } else if (progress.total_chunks > 1) {
        const pct = Math.round(progress.progress * 100);
        showIndicator('localProcessing', `Transcribing... ${pct}% (chunk ${progress.chunk_index + 1}/${progress.total_chunks})`);
      } else if (!progress.is_final) {
        showIndicator('localProcessing', 'Transcribing...');
      }
    });
    if (!data.originalText && !data.translatedText) {
      showToast('Could not transcribe file. Ensure it contains speech.', 'warn');
    } else {
      if (isStale(epoch) || data.discarded) return;
      addLocalMessage(data.originalText, data.translatedText, data.timestamp);
      handleAutoSentiment(data.sentiment, data.conversationSummary);
      if (data.missionCues) updateMissionCues(data.missionCues);
    }
  } catch (e) {
    console.error('Send local file error:', e);
    showToast('File processing failed. Check format (WAV, MP3, WebM).', 'error');
  } finally {
    hideIndicator('localProcessing');
  }
}

async function handleUserFile(file) {
  // Stamped before the request starts: if history is cleared while this is
  // in flight, the response must not repopulate the panels.
  const epoch = currentEpoch();
  const allowed = await requestFileConsent();
  if (!allowed) return;

  if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
    showToast(`File too large (max ${MAX_FILE_SIZE_MB}MB). Use a shorter audio clip.`, 'error');
    return;
  }

  const sizeMB = (file.size / 1024 / 1024).toFixed(1);
  showIndicator('userProcessing', `Uploading (${sizeMB} MB)...`);
  try {
    const data = await postUserFileStream(file, getTgtLang(), getSrcLang(), (progress) => {
      if (progress.stage === 'decoding') {
        showIndicator('userProcessing', 'Decoding audio...');
      } else if (progress.stage === 'transcribing') {
        const dur = progress.duration_s ? ` (${Math.round(progress.duration_s)}s)` : '';
        showIndicator('userProcessing', `Transcribing${dur}...`);
      } else if (progress.total_chunks > 1) {
        const pct = Math.round(progress.progress * 100);
        showIndicator('userProcessing', `Transcribing... ${pct}% (chunk ${progress.chunk_index + 1}/${progress.total_chunks})`);
      } else if (!progress.is_final) {
        showIndicator('userProcessing', 'Transcribing...');
      }
    });
    if (!data.originalText && !data.translatedText) {
      showToast('Could not transcribe file. Ensure it contains speech.', 'warn');
    } else {
      if (isStale(epoch) || data.discarded) return;
      addUserMessage(data.originalText, data.translatedText, data.timestamp);
      handleAutoSentiment(data.sentiment, data.conversationSummary);
      if (data.missionCues) updateMissionCues(data.missionCues);
    }
  } catch (e) {
    console.error('Send user file error:', e);
    showToast('File processing failed. Check format (WAV, MP3, WebM).', 'error');
  } finally {
    hideIndicator('userProcessing');
  }
}

// ============================================================
// Local Text
// ============================================================

async function handleLocalTextSend(text) {
  // Stamped before the request starts: if history is cleared while this is
  // in flight, the response must not repopulate the panels.
  const epoch = currentEpoch();
  showIndicator('localProcessing', 'Translating...');
  try {
    const data = await postLocalText(text, getSrcLang(), getTgtLang());
    if (isStale(epoch) || data.discarded) return;
    addLocalMessage(data.originalText, data.translatedText, data.timestamp);
    handleAutoSentiment(data.sentiment, data.conversationSummary);
  } catch (e) {
    console.error('Send local text error:', e);
    showToast('Translation failed.', 'error');
  } finally {
    hideIndicator('localProcessing');
  }
}

// ============================================================
// User Text
// ============================================================

async function handleUserTextSend(text) {
  // Stamped before the request starts: if history is cleared while this is
  // in flight, the response must not repopulate the panels.
  const epoch = currentEpoch();
  showIndicator('userProcessing', 'Translating...');
  try {
    const data = await postUserText(text, getTgtLang(), getSrcLang());
    if (isStale(epoch) || data.discarded) return;
    addUserMessage(data.originalText, data.translatedText, data.timestamp);
    handleAutoSentiment(data.sentiment, data.conversationSummary);
  } catch (e) {
    console.error('Send user text error:', e);
    showToast('Translation failed.', 'error');
  } finally {
    hideIndicator('userProcessing');
  }
}

// ============================================================
// Wire up DOM events
// ============================================================

let _audioInitialized = false;

export function initAudio() {
  if (_audioInitialized) return;
  _audioInitialized = true;

  // Pre-warm mic stream if consent already granted (eliminates first-click lag)
  if (localStorage.getItem('localLingua_consentMic') === 'granted') {
    _getOrCreateStream().catch(() => {});
  }

  // Local mic — single click to start, auto-stops on silence (or click again to stop early)
  document.getElementById('btnLocalMic').addEventListener('click', () => {
    if (localRecording) {
      stopRecording('local');
    } else {
      startRecording('local');
    }
  });

  // Local file picker
  document.getElementById('btnLocalFile').addEventListener('click', async () => {
    const allowed = await requestFileConsent();
    if (!allowed) return;
    document.getElementById('localFileInput').click();
  });
  document.getElementById('localFileInput').addEventListener('change', (e) => {
    if (e.target.files[0]) {
      handleLocalFile(e.target.files[0]);
      e.target.value = '';
    }
  });

  // User mic — same VAD auto-stop behavior
  document.getElementById('btnUserMic').addEventListener('click', () => {
    if (userRecording) {
      stopRecording('user');
    } else {
      startRecording('user');
    }
  });

  // User file picker
  document.getElementById('btnUserFile').addEventListener('click', async () => {
    const allowed = await requestFileConsent();
    if (!allowed) return;
    document.getElementById('userFileInput').click();
  });
  document.getElementById('userFileInput').addEventListener('change', (e) => {
    if (e.target.files[0]) {
      handleUserFile(e.target.files[0]);
      e.target.value = '';
    }
  });

  // User text send (button + Enter key)
  document.getElementById('btnSend').addEventListener('click', () => {
    const input = document.getElementById('userTextInput');
    const text = input.value.trim();
    if (text) {
      handleUserTextSend(text);
      input.value = '';
    }
  });
  document.getElementById('userTextInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const text = e.target.value.trim();
      if (text) {
        handleUserTextSend(text);
        e.target.value = '';
      }
    }
  });

}
