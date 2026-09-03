// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/**
 * Energy-based voice activity detection for the kiosk microphone: watches the
 * RMS level of a live MediaStream and reports when the citizen starts and
 * stops speaking, so nobody has to tap a button to end a sentence.
 *
 * Why not a model: the Edge AI Demo Studio runs Silero VAD inside its
 * wake-word worker, which the kiosk does not deploy, and shipping an ONNX
 * runtime to the browser for end-pointing is a lot of weight for a decision
 * this simple. The tricky part in a public hall is not the classifier, it is
 * the noise floor — a fixed threshold that works in a quiet office fires
 * constantly next to a queue. So the floor is measured continuously and the
 * speech threshold rides on top of it.
 */

/** Tunables; the defaults are for a kiosk in a moderately noisy hall. */
export type VoiceActivityOptions = {
  /** Sustained loudness before a sound counts as speech (guards door slams). */
  onsetMs?: number;
  /** Trailing quiet that ends an utterance — the "are you done?" pause. */
  silenceMs?: number;
  /** Utterances shorter than this are treated as noise and discarded. */
  minSpeechMs?: number;
  /** Hard stop, so a stuck-open mic can't record forever. */
  maxSpeechMs?: number;
  /** How far above the measured noise floor counts as speech. */
  sensitivity?: number;
};

export type VoiceActivityHandlers = {
  onSpeechStart: () => void;
  /** A real utterance ended — worth transcribing. */
  onSpeechEnd: () => void;
  /** A blip too short to be speech ended — discard it. */
  onSpeechAbort: () => void;
};

export const VOICE_ACTIVITY_DEFAULTS = {
  onsetMs: 180,
  silenceMs: 1_200,
  minSpeechMs: 350,
  maxSpeechMs: 30_000,
  sensitivity: 2.5,
} as const;

/**
 * Below this RMS nothing counts as speech, however quiet the room. Without it
 * a silent hall drives the measured floor toward zero and every rustle of
 * paper clears the threshold.
 */
const ABSOLUTE_FLOOR = 0.012;
/** Per-frame pull of the noise floor toward the current level, while quiet. */
const FLOOR_ADAPT = 0.05;

export type VoiceActivityDetector = { stop: () => void };

/**
 * Start watching `stream`. The returned handle must be stopped to release the
 * AudioContext; it does not touch the stream's tracks — whoever opened the
 * microphone still owns it.
 */
export function detectVoiceActivity(
  stream: MediaStream,
  handlers: VoiceActivityHandlers,
  options: VoiceActivityOptions = {},
): VoiceActivityDetector {
  const { onsetMs, silenceMs, minSpeechMs, maxSpeechMs, sensitivity } = {
    ...VOICE_ACTIVITY_DEFAULTS,
    ...options,
  };

  const audio = new AudioContext();
  const analyser = audio.createAnalyser();
  analyser.fftSize = 1_024;
  // Raw frames: the smoothing that flatters a level meter also blurs the
  // onset and the pause we are trying to time.
  analyser.smoothingTimeConstant = 0;
  audio.createMediaStreamSource(stream).connect(analyser);

  const samples = new Float32Array(analyser.fftSize);
  let frame = 0;
  let speaking = false;
  let noiseFloor = ABSOLUTE_FLOOR;
  /** When the level first rose above / fell below the threshold; 0 = neither. */
  let loudSince = 0;
  let quietSince = 0;
  let speechFrom = 0;

  const tick = () => {
    frame = requestAnimationFrame(tick);
    analyser.getFloatTimeDomainData(samples);

    let sum = 0;
    for (const sample of samples) sum += sample * sample;
    const level = Math.sqrt(sum / samples.length);
    const now = performance.now();
    const loud = level > Math.max(noiseFloor * sensitivity, ABSOLUTE_FLOOR);

    if (!speaking) {
      // Track the room only between utterances: adapting while the citizen
      // talks would raise the bar out from under their own voice.
      if (!loud) noiseFloor += (level - noiseFloor) * FLOOR_ADAPT;

      if (!loud) {
        loudSince = 0;
      } else if (!loudSince) {
        loudSince = now;
      } else if (now - loudSince >= onsetMs) {
        speaking = true;
        // Date the utterance from the first loud frame, not from the moment
        // onset was confirmed, so the leading word counts toward minSpeechMs.
        speechFrom = loudSince;
        quietSince = 0;
        handlers.onSpeechStart();
      }
      return;
    }

    if (loud) {
      quietSince = 0;
    } else if (!quietSince) {
      quietSince = now;
    } else if (now - quietSince >= silenceMs) {
      const spokenMs = quietSince - speechFrom;
      speaking = false;
      loudSince = 0;
      if (spokenMs >= minSpeechMs) handlers.onSpeechEnd();
      else handlers.onSpeechAbort();
      return;
    }

    if (now - speechFrom >= maxSpeechMs) {
      speaking = false;
      loudSince = 0;
      quietSince = 0;
      handlers.onSpeechEnd();
    }
  };

  frame = requestAnimationFrame(tick);

  return {
    stop: () => {
      cancelAnimationFrame(frame);
      audio.close();
    },
  };
}
