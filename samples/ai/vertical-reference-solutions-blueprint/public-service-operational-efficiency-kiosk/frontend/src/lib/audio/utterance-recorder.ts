// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import {
  detectVoiceActivity,
  type VoiceActivityDetector,
  type VoiceActivityOptions,
} from "./voice-activity";

/**
 * Turns an open microphone into a stream of complete utterances: voice
 * activity detection decides where each one starts and ends, and the finished
 * audio comes back ready to transcribe. The citizen never taps to start or
 * stop a sentence — though `finishNow` lets them cut one short.
 *
 * Recording runs continuously rather than starting on the speech onset, so
 * the first syllable is never clipped. To stop that from uploading minutes of
 * an empty hall, the clip is thrown away and restarted every few idle
 * seconds, leaving at most a short lead-in on the audio that is kept.
 */
export type UtteranceHandlers = {
  onSpeechStart: () => void;
  /** Speech ended — by silence, by `finishNow`, or as a discarded blip. */
  onSpeechEnd: () => void;
  /** A complete utterance worth transcribing. */
  onUtterance: (audio: Blob) => void;
};

export type UtteranceRecorder = {
  /** Stop capturing and release the microphone. */
  close: () => void;
  /** Keep the mic open but ignore what it hears — while the kiosk speaks,
   *  so its own voice never becomes the citizen's next turn. */
  setPaused: (paused: boolean) => void;
  /** End the utterance in progress right now and emit it. */
  finishNow: () => void;
};

/** Idle audio discarded past this age, so a kept clip stays small. */
const IDLE_RECYCLE_MS = 4_000;
const RECYCLE_CHECK_MS = 1_000;

type Clip = { recorder: MediaRecorder; chunks: Blob[]; startedAt: number; keep: boolean };

/**
 * Opens the microphone and starts listening. Rejects when the microphone is
 * unavailable — the caller turns that into a message for the screen.
 */
export async function openUtteranceRecorder(
  handlers: UtteranceHandlers,
  options: VoiceActivityOptions = {},
): Promise<UtteranceRecorder> {
  const stream = await navigator.mediaDevices.getUserMedia({
    // Echo cancellation matters here: in hands-free mode the mic is live
    // while the kiosk reads a reply out of the same enclosure. Pausing is the
    // real defence, this is the belt to its braces.
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });

  let clip: Clip | null = null;
  let paused = false;
  let speaking = false;
  let closed = false;
  let detector: VoiceActivityDetector | null = null;

  const startClip = () => {
    if (closed || paused || clip) return;
    const recorder = new MediaRecorder(stream);
    const started: Clip = { recorder, chunks: [], startedAt: Date.now(), keep: false };
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) started.chunks.push(event.data);
    };
    recorder.onstop = () => {
      if (clip === started) clip = null;
      if (started.keep && started.chunks.length > 0) {
        handlers.onUtterance(new Blob(started.chunks, { type: "audio/webm" }));
      }
      // Re-arm for whatever the citizen says next.
      startClip();
    };
    recorder.start();
    clip = started;
  };

  /** Close the current clip; `keep` decides whether it gets transcribed. */
  const endClip = (keep: boolean) => {
    if (!clip || clip.recorder.state === "inactive") return;
    clip.keep = keep;
    clip.recorder.stop();
  };

  const endSpeech = (keep: boolean) => {
    if (!speaking) return;
    speaking = false;
    handlers.onSpeechEnd();
    endClip(keep);
  };

  detector = detectVoiceActivity(
    stream,
    {
      onSpeechStart: () => {
        if (paused || speaking) return;
        speaking = true;
        handlers.onSpeechStart();
      },
      onSpeechEnd: () => endSpeech(true),
      onSpeechAbort: () => endSpeech(false),
    },
    options,
  );

  // Drop stale silence so a kept utterance is not preceded by minutes of it.
  const recycle = setInterval(() => {
    if (speaking || paused || !clip) return;
    if (Date.now() - clip.startedAt >= IDLE_RECYCLE_MS) endClip(false);
  }, RECYCLE_CHECK_MS);

  startClip();

  return {
    close: () => {
      if (closed) return;
      closed = true;
      clearInterval(recycle);
      detector?.stop();
      endClip(false);
      for (const track of stream.getTracks()) track.stop();
    },
    setPaused: (next) => {
      if (paused === next) return;
      paused = next;
      if (paused) {
        // Whatever is half-captured belongs to the interrupted moment.
        speaking = false;
        endClip(false);
      } else {
        startClip();
      }
    },
    // A manual stop keeps the audio: the citizen is saying "I'm done", not
    // "forget it", so the partial utterance is still worth transcribing. It
    // works even when the detector never flagged speech — someone too quiet
    // to clear the threshold is exactly who reaches for the stop button.
    finishNow: () => {
      if (closed || paused) return;
      if (speaking) {
        speaking = false;
        handlers.onSpeechEnd();
      }
      endClip(true);
    },
  };
}
