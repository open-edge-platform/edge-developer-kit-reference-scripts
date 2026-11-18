// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/** SHA-256 hex digest for a byte view without first copying its data. */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  // Web Crypto is unavailable on plain HTTP LAN origins, unlike localhost.
  const digest = globalThis.crypto?.subtle
    ? new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>))
    : (await import('@noble/hashes/sha256')).sha256(bytes);
  return [...digest].map((value) => value.toString(16).padStart(2, '0')).join('');
}
