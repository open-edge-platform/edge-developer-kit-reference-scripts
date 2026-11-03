// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { FRAME_SAMPLES, SAMPLE_RATE } from "./silero-vad";

/**
 * Turns the microphone's frames and their speech probabilities into
 * utterances — the endpointing the pmjb kiosk does on its server:
 *
 * - **start**: `minSpeechMs` of frames at or above `threshold`. The
 *   `preRollMs` heard just before is kept, so the first syllable is not cut.
 * - **pause**: `pauseMs` of frames below `negThreshold` (a lower bar than the
 *   start's, so a soft word mid-sentence does not count as silence). Carries
 *   the utterance so far, which is exactly what `end` will carry if the
 *   citizen stays quiet: recognition can start on it now.
 * - **resume**: speech again after a pause — what the pause carried is not
 *   the utterance after all.
 * - **end**: `silenceMs` of silence, or `maxUtteranceMs` of speech. The
 *   utterance keeps a short tail of the silence after it: Whisper transcribes
 *   the last word better with one.
 */
export type EndpointEvent =
  | { type: "start" }
  | { type: "pause"; audio: Float32Array }
  | { type: "resume" }
  | { type: "end"; audio: Float32Array };

export type EndpointerOptions = {
  /** Speech probability that starts an utterance (0..1). */
  threshold?: number;
  /** Probability below which a frame is silence, once speaking. */
  negThreshold?: number;
  minSpeechMs?: number;
  /** Short silence that makes the utterance so far worth recognizing early. */
  pauseMs?: number;
  /** Silence that ends an utterance — the "are you done?" pause. */
  silenceMs?: number;
  preRollMs?: number;
  /** Hard stop, so a mic stuck on a conversation nearby cannot run forever. */
  maxUtteranceMs?: number;
};

export const ENDPOINTER_DEFAULTS = {
  threshold: 0.5,
  minSpeechMs: 160,
  pauseMs: 240,
  silenceMs: 800,
  preRollMs: 300,
  maxUtteranceMs: 30_000,
} as const;

const FRAME_MS = (FRAME_SAMPLES * 1_000) / SAMPLE_RATE;
/** Trailing silence kept on an utterance: ~160 ms. */
const TAIL_FRAMES = 5;

const frames = (ms: number) => Math.max(1, Math.floor(ms / FRAME_MS));

export class Endpointer {
  private readonly threshold: number;
  private readonly negThreshold: number;
  private readonly minSpeech: number;
  private readonly pauseFrames: number;
  private readonly minSilence: number;
  private readonly preRollFrames: number;
  private readonly maxFrames: number;

  private preRoll: Float32Array[] = [];
  private utterance: Float32Array[] = [];
  private voiced = 0;
  private silent = 0;
  private paused = false;
  speaking = false;

  constructor(options: EndpointerOptions = {}) {
    const settings = { ...ENDPOINTER_DEFAULTS, ...options };
    this.threshold = settings.threshold;
    this.negThreshold = options.negThreshold ?? Math.max(0.01, settings.threshold - 0.15);
    this.minSpeech = frames(settings.minSpeechMs);
    this.pauseFrames = frames(settings.pauseMs);
    this.minSilence = Math.max(this.pauseFrames + 1, frames(settings.silenceMs));
    this.preRollFrames = frames(settings.preRollMs);
    this.maxFrames = frames(settings.maxUtteranceMs);
  }

  reset(): void {
    this.preRoll = [];
    this.utterance = [];
    this.voiced = 0;
    this.silent = 0;
    this.paused = false;
    this.speaking = false;
  }

  /** One frame of FRAME_SAMPLES samples and its speech probability. */
  push(frame: Float32Array, probability: number): EndpointEvent[] {
    if (!this.speaking) {
      this.preRoll.push(frame);
      if (this.preRoll.length > this.preRollFrames) this.preRoll.shift();
      this.voiced = probability >= this.threshold ? this.voiced + 1 : 0;
      if (this.voiced < this.minSpeech) return [];
      this.speaking = true;
      this.silent = 0;
      this.utterance = this.preRoll;
      this.preRoll = [];
      return [{ type: "start" }];
    }

    const events: EndpointEvent[] = [];
    this.utterance.push(frame);
    if (probability < this.negThreshold) {
      this.silent += 1;
    } else {
      if (this.paused) events.push({ type: "resume" });
      this.paused = false;
      this.silent = 0;
    }
    if (!this.paused && this.silent === this.pauseFrames) {
      this.paused = true;
      events.push({ type: "pause", audio: this.heard() });
    }
    if (this.silent >= this.minSilence || this.utterance.length >= this.maxFrames) {
      events.push({ type: "end", audio: this.heard() });
      this.reset();
    }
    return events;
  }

  /** Everything heard so far, for a citizen who said they are done; null when
   *  that is under 100 ms. Starts over. */
  flush(): Float32Array | null {
    const audio = concat(this.speaking ? this.utterance : this.preRoll);
    this.reset();
    return audio.length > SAMPLE_RATE / 10 ? audio : null;
  }

  /** The utterance with at most TAIL_FRAMES of the silence after it. */
  private heard(): Float32Array {
    return concat(this.utterance.slice(0, this.utterance.length - Math.max(0, this.silent - TAIL_FRAMES)));
  }
}

function concat(parts: Float32Array[]): Float32Array {
  const out = new Float32Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/**
 * A stand-in "probability" from loudness alone, for when the model cannot
 * load: 1 when a frame is `sensitivity` times louder than the room's noise
 * floor, else 0. The floor follows the room only between utterances —
 * adapting while the citizen talks would raise the bar out from under their
 * own voice — and never drops below a quiet room's, or every rustle of paper
 * would clear it.
 */
export function loudnessScorer(sensitivity = 2.5): (frame: Float32Array, speaking: boolean) => number {
  const ABSOLUTE_FLOOR = 0.012;
  const FLOOR_ADAPT = 0.05;
  let floor = ABSOLUTE_FLOOR;
  return (frame, speaking) => {
    let sum = 0;
    for (const sample of frame) sum += sample * sample;
    const level = Math.sqrt(sum / frame.length);
    const loud = level > Math.max(floor * sensitivity, ABSOLUTE_FLOOR);
    if (!speaking && !loud) floor += (level - floor) * FLOOR_ADAPT;
    return loud ? 1 : 0;
  };
}
