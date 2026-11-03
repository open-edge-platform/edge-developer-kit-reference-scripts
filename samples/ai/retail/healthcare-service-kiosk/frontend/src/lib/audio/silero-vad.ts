// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/**
 * Silero VAD (v6, MIT) in the browser: the probability that a 32 ms frame of
 * 16 kHz audio is speech, in well under a millisecond on one CPU thread
 * through ONNX Runtime Web's WebAssembly build. A model rather than a loudness
 * threshold, because in a hospital hall the noise is loud too: a trolley or a
 * queue's chatter clears any energy bar, and only a model tells it from a
 * voice.
 *
 * The model and the runtime are served from `/vad/` (scripts/vad-assets.mjs
 * copies the runtime out of node_modules and fetches the model there), and
 * the runtime is imported from there when the microphone first opens rather
 * than bundled: it brings its own WebAssembly, which it finds beside itself.
 */

import type * as Ort from "onnxruntime-web";

export const SAMPLE_RATE = 16_000;
/** Samples per Silero frame at 16 kHz: 32 ms. */
export const FRAME_SAMPLES = 512;
/** The end of the previous frame, which the model sees ahead of each one. */
const CONTEXT_SAMPLES = 64;
const ASSETS = "/vad/";

type Model = { ort: typeof Ort; session: Ort.InferenceSession };

let loading: Promise<Model> | null = null;

/** The runtime and the model, loaded once per page; a failed load is tried again next time. */
function loadModel(): Promise<Model> {
  loading = loading ?? (async () => {
    const base = new URL(ASSETS, window.location.href).href;
    const ort = (await import(
      /* webpackIgnore: true */ `${base}ort.wasm.bundle.min.mjs`
    )) as typeof Ort;
    // The .wasm only: a path prefix would make it fetch its glue from there
    // too, instead of using the copy inside the bundle.
    ort.env.wasm.wasmPaths = { wasm: `${base}ort-wasm-simd-threaded.wasm` };
    // Threads need a cross-origin-isolated page; one is plenty for 512 samples.
    ort.env.wasm.numThreads = 1;
    const session = await ort.InferenceSession.create(`${base}silero_vad.onnx`, {
      executionProviders: ["wasm"],
    });
    return { ort, session };
  })();
  loading.catch(() => {
    loading = null;
  });
  return loading;
}

export type SileroVad = {
  /** Speech probability of one frame of FRAME_SAMPLES samples (-1..1). */
  probability: (frame: Float32Array) => Promise<number>;
  /** Forget the audio heard so far (a new utterance follows). */
  reset: () => void;
};

/** One listener's VAD: the model is shared, its recurrent state is not. */
export async function openSileroVad(): Promise<SileroVad> {
  const { ort, session } = await loadModel();
  const [output, stateOut] = session.outputNames;
  const rate = new ort.Tensor("int64", BigInt64Array.from([BigInt(SAMPLE_RATE)]), []);
  let state: Ort.Tensor = new ort.Tensor("float32", new Float32Array(2 * 128), [2, 1, 128]);
  let context = new Float32Array(CONTEXT_SAMPLES);

  return {
    probability: async (frame) => {
      const input = new Float32Array(CONTEXT_SAMPLES + FRAME_SAMPLES);
      input.set(context);
      input.set(frame, CONTEXT_SAMPLES);
      context = input.slice(-CONTEXT_SAMPLES);
      const result = await session.run({
        input: new ort.Tensor("float32", input, [1, input.length]),
        state,
        sr: rate,
      });
      state = result[stateOut] as Ort.Tensor;
      return (result[output].data as Float32Array)[0];
    },
    reset: () => {
      state = new ort.Tensor("float32", new Float32Array(2 * 128), [2, 1, 128]);
      context = new Float32Array(CONTEXT_SAMPLES);
    },
  };
}
