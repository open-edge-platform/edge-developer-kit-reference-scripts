#!/usr/bin/env node
// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/**
 * What the browser's voice activity detection loads (src/lib/audio/silero-vad.ts),
 * put in public/vad/ (gitignored) so the kiosk serves it itself and needs no
 * network once set up: ONNX Runtime Web's WebAssembly build, copied from
 * node_modules, and the Silero VAD model, downloaded once at a pinned release
 * and checked against its hash. scripts/with-kiosk-env.mjs runs this before
 * every `npm run dev|build|start`; on its own: `node scripts/vad-assets.mjs`.
 *
 * Never fatal: without these files the microphone still works, cutting
 * utterances by loudness instead.
 */
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FRONTEND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TARGET = path.join(FRONTEND, "public", "vad");
const RUNTIME = path.join(FRONTEND, "node_modules", "onnxruntime-web", "dist");
// The bundle carries the WebAssembly glue; the .wasm itself is fetched beside it.
const RUNTIME_FILES = ["ort.wasm.bundle.min.mjs", "ort-wasm-simd-threaded.wasm"];
// Silero VAD v6.2 (MIT), the model the pmjb kiosk runs.
const MODEL = {
  file: "silero_vad.onnx",
  url: "https://github.com/snakers4/silero-vad/raw/v6.2.3/src/silero_vad/data/silero_vad.onnx",
  sha256: "1a153a22f4509e292a94e67d6f9b85e8deb25b4988682b7e174c65279d8788e3",
};

const sha256 = (data) => createHash("sha256").update(data).digest("hex");
const warn = (message) => console.warn(`vad-assets: ${message} — the microphone falls back to loudness`);

export async function ensureVadAssets() {
  mkdirSync(TARGET, { recursive: true });
  for (const name of RUNTIME_FILES) {
    const from = path.join(RUNTIME, name);
    const to = path.join(TARGET, name);
    if (!existsSync(from)) {
      warn(`${path.relative(FRONTEND, from)} is missing (run npm install)`);
      continue;
    }
    if (!existsSync(to) || statSync(to).mtimeMs < statSync(from).mtimeMs) copyFileSync(from, to);
  }

  const model = path.join(TARGET, MODEL.file);
  if (existsSync(model) && sha256(readFileSync(model)) === MODEL.sha256) return;
  try {
    const res = await fetch(MODEL.url, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = Buffer.from(await res.arrayBuffer());
    if (sha256(data) !== MODEL.sha256) throw new Error("its hash does not match the pinned release");
    writeFileSync(model, data);
    console.log(`vad-assets: downloaded ${MODEL.file} into ${path.relative(FRONTEND, TARGET)}`);
  } catch (error) {
    warn(`could not download ${MODEL.url} (${error.message})`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await ensureVadAssets();
}
