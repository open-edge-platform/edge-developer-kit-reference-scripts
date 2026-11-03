// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { Endpointer, loudnessScorer, type EndpointerOptions } from "./endpointer";
import { FRAME_SAMPLES, openSileroVad, SAMPLE_RATE, type SileroVad } from "./silero-vad";

/**
 * Turns an open microphone into a stream of complete utterances, the way the
 * pmjb kiosk listens: the microphone runs as 16 kHz mono frames of 32 ms,
 * Silero VAD scores each one, and the endpointer (endpointer.ts) cuts the
 * utterances, each handed over as a 16-bit WAV — the format Whisper takes as
 * is. The citizen never taps to start or stop a sentence, though `finishNow`
 * lets them cut one short.
 *
 * A short pause already hands over the utterance so far (`onPause`): when the
 * citizen then stays quiet, the utterance that ends is that same audio
 * (`onUtterance(audio, true)`), so its recognition can start at the pause
 * rather than after the whole closing silence. Speech after the pause
 * (`onResume`) means it was not the utterance after all.
 *
 * Without the model (its files missing, WebAssembly blocked) loudness stands
 * in for it, measured against the room's noise floor.
 */
export type UtteranceHandlers = {
  onSpeechStart: () => void;
  /** Speech ended — by silence, by `finishNow`, or because listening paused. */
  onSpeechEnd: () => void;
  /** A short pause: the utterance so far, to recognize ahead of its end. */
  onPause?: (audio: Blob) => void;
  /** What `onPause` handed over is not the utterance: speech went on, or listening paused. */
  onResume?: () => void;
  /** A complete utterance; `paused` when it is the audio the last `onPause` carried. */
  onUtterance: (audio: Blob, paused: boolean) => void;
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

export type VadOptions = EndpointerOptions & {
  /** Loudness stand-in only: how far above the room's noise floor counts as speech. */
  sensitivity?: number;
};

/** Float samples to frames of FRAME_SAMPLES at 16 kHz, averaged down when the
 *  context could not run at 16 kHz itself. */
const WORKLET = `
class FrameCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / ${SAMPLE_RATE};
    this.phase = 0;
    this.sum = 0;
    this.count = 0;
    this.frame = new Float32Array(${FRAME_SAMPLES});
    this.filled = 0;
  }
  push(value) {
    this.frame[this.filled++] = value;
    if (this.filled === this.frame.length) {
      this.port.postMessage(this.frame, [this.frame.buffer]);
      this.frame = new Float32Array(${FRAME_SAMPLES});
      this.filled = 0;
    }
  }
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (!channel) return true;
    for (let i = 0; i < channel.length; i++) {
      if (this.ratio === 1) {
        this.push(channel[i]);
        continue;
      }
      this.sum += channel[i];
      this.count += 1;
      this.phase += 1;
      while (this.phase >= this.ratio) {
        this.phase -= this.ratio;
        if (this.count > 0) this.last = this.sum / this.count;
        this.push(this.last || 0);
        this.sum = 0;
        this.count = 0;
      }
    }
    return true;
  }
}
registerProcessor("frame-capture", FrameCapture);
`;

/** 16-bit mono WAV of 16 kHz samples. */
export function wavBlob(samples: Float32Array): Blob {
  const view = new DataView(new ArrayBuffer(44 + samples.length * 2));
  const text = (at: number, value: string) => {
    for (let i = 0; i < value.length; i++) view.setUint8(at + i, value.charCodeAt(i));
  };
  text(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([view.buffer], { type: "audio/wav" });
}

/**
 * Opens the microphone and starts listening. Rejects when the microphone is
 * unavailable — the caller turns that into a message for the screen.
 */
export async function openUtteranceRecorder(
  handlers: UtteranceHandlers,
  options: VadOptions = {},
): Promise<UtteranceRecorder> {
  const vad: SileroVad | null = await openSileroVad().catch((error: unknown) => {
    console.warn("Silero VAD unavailable — listening by loudness instead:", error);
    return null;
  });
  const media = await navigator.mediaDevices.getUserMedia({
    // Echo cancellation matters here: in hands-free mode the mic is live
    // while the kiosk reads a reply out of the same enclosure. Pausing is the
    // real defence, this is the belt to its braces.
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
  });
  let audio: AudioContext;
  try {
    audio = new AudioContext({ sampleRate: SAMPLE_RATE, latencyHint: "interactive" });
  } catch {
    audio = new AudioContext({ latencyHint: "interactive" });
  }
  const moduleUrl = URL.createObjectURL(new Blob([WORKLET], { type: "text/javascript" }));
  try {
    await audio.audioWorklet.addModule(moduleUrl);
  } catch (error) {
    for (const track of media.getTracks()) track.stop();
    await audio.close();
    throw error;
  } finally {
    URL.revokeObjectURL(moduleUrl);
  }
  const source = audio.createMediaStreamSource(media);
  const capture = new AudioWorkletNode(audio, "frame-capture");
  // Wired through to the speakers so the graph pulls it; it outputs silence.
  source.connect(capture).connect(audio.destination);
  if (audio.state === "suspended") await audio.resume().catch(() => {});

  const endpointer = new Endpointer(options);
  const loudness = loudnessScorer(options.sensitivity);
  let scoreByModel = vad !== null;
  let closed = false;
  let paused = false;
  /** An onPause handed over, with no onResume or onUtterance since. */
  let pending = false;
  let queue = Promise.resolve();

  const dropPending = () => {
    if (!pending) return;
    pending = false;
    handlers.onResume?.();
  };

  const stopSpeaking = () => {
    if (!endpointer.speaking) return;
    endpointer.reset();
    handlers.onSpeechEnd();
  };

  const score = async (frame: Float32Array): Promise<number> => {
    if (vad && scoreByModel) {
      try {
        return await vad.probability(frame);
      } catch (error) {
        console.warn("Silero VAD failed — listening by loudness instead:", error);
        scoreByModel = false;
      }
    }
    return loudness(frame, endpointer.speaking);
  };

  const hear = async (frame: Float32Array) => {
    if (closed || paused) return;
    const probability = await score(frame);
    if (closed || paused) return;
    for (const event of endpointer.push(frame, probability)) {
      switch (event.type) {
        case "start":
          handlers.onSpeechStart();
          break;
        case "pause":
          pending = true;
          handlers.onPause?.(wavBlob(event.audio));
          break;
        case "resume":
          dropPending();
          break;
        case "end":
          handlers.onSpeechEnd();
          handlers.onUtterance(wavBlob(event.audio), pending);
          pending = false;
          break;
      }
    }
  };

  capture.port.onmessage = (event: MessageEvent<Float32Array>) => {
    const frame = event.data;
    // In order, one at a time: the endpointer and the model's state are sequential.
    queue = queue.then(() => hear(frame)).catch((error: unknown) => console.warn("listening:", error));
  };

  return {
    close: () => {
      if (closed) return;
      closed = true;
      dropPending();
      stopSpeaking();
      capture.port.onmessage = null;
      source.disconnect();
      capture.disconnect();
      audio.close();
      for (const track of media.getTracks()) track.stop();
    },
    setPaused: (next) => {
      if (paused === next || closed) return;
      paused = next;
      // Whatever is half-heard belongs to the interrupted moment.
      dropPending();
      stopSpeaking();
      endpointer.reset();
      vad?.reset();
    },
    // A manual stop keeps the audio: the citizen is saying "I'm done", not
    // "forget it", so the partial utterance is still worth transcribing. It
    // works even when the VAD never heard speech start — someone too quiet to
    // clear it is exactly who reaches for the stop button.
    finishNow: () => {
      if (closed || paused) return;
      const speaking = endpointer.speaking;
      const heard = endpointer.flush();
      dropPending();
      if (speaking) handlers.onSpeechEnd();
      if (heard) handlers.onUtterance(wavBlob(heard), false);
    },
  };
}
