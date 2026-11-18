// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/// <reference lib="webworker" />
// Reads splat PLY / SPZ bytes off the main thread.
import { readSplatFile } from './plyReader';

self.onmessage = async (event: MessageEvent<Blob>) => {
  let result: ReturnType<typeof readSplatFile> = null;
  try {
    result = readSplatFile(new Uint8Array(await event.data.arrayBuffer()));
  } catch {
    result = null;
  }
  if (result) self.postMessage(result, [result.data.buffer, result.index.buffer]);
  else self.postMessage(null);
};
