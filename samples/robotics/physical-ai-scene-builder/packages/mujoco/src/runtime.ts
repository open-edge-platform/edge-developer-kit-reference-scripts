// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { MainModule } from '@mujoco/mujoco';

export type Mujoco = MainModule;

/**
 * The Emscripten glue shipped by `@mujoco/mujoco` contains Node-only `require`
 * calls that break static bundling, so the runtime is served as a static asset
 * and imported at runtime with the bundler explicitly opted out.
 * `scripts/sync-mujoco-runtime.mjs` in the web app copies it into `public/mujoco`.
 */
export interface RuntimeOptions {
  runtimeUrl?: string;
  wasmUrl?: string;
}

const DEFAULT_RUNTIME_URL = '/mujoco/mujoco.js';
const DEFAULT_WASM_URL = '/mujoco/mujoco.wasm';

const cache = new Map<string, Promise<Mujoco>>();

export function loadMujoco(options: RuntimeOptions = {}): Promise<Mujoco> {
  const runtimeUrl = options.runtimeUrl ?? DEFAULT_RUNTIME_URL;
  const wasmUrl = options.wasmUrl ?? DEFAULT_WASM_URL;

  if (typeof window === 'undefined') {
    return Promise.reject(new Error('MuJoCo WASM can only be loaded in the browser'));
  }

  let pending = cache.get(runtimeUrl);
  if (!pending) {
    pending = (async () => {
      const mod = (await import(
        /* webpackIgnore: true */ /* turbopackIgnore: true */ runtimeUrl
      )) as { default: (options?: unknown) => Promise<Mujoco> };
      return mod.default({ locateFile: () => wasmUrl });
    })();
    cache.set(runtimeUrl, pending);
  }
  return pending;
}
