// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client';

import { readSplatFile, unpackSplatPoints, type PackedSplatPoints } from './plyReader';
import type { SplatPoint } from './splatCollision';

/**
 * Full-precision visible splats of a PLY or SPZ, parsed in a Web Worker (falling back to the main thread
 * where workers are unavailable). Resolves null when the file cannot be read or worker fails.
 */
export async function readSplatPoints(source: Blob): Promise<SplatPoint[] | null> {
  if (typeof Worker === 'undefined') {
    const packed = readSplatFile(new Uint8Array(await source.arrayBuffer()));
    return packed ? unpackSplatPoints(packed) : null;
  }
  const packed = await new Promise<PackedSplatPoints | null>((resolve) => {
    const worker = new Worker(new URL('./plyReader.worker.ts', import.meta.url), {
      type: 'module',
    });
    const finish = (value: PackedSplatPoints | null) => {
      worker.terminate();
      resolve(value);
    };
    worker.onmessage = (event: MessageEvent<PackedSplatPoints | null>) => finish(event.data);
    worker.onerror = () => finish(null);
    worker.onmessageerror = () => finish(null);
    worker.postMessage(source);
  });
  return packed ? unpackSplatPoints(packed) : null;
}
