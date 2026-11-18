// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/** Next.js may use its bind address in request.url; Host retains the browser-facing authority. */
export function requestOrigin(request: Request): string {
  const url = new URL(request.url);
  const protocol = request.headers.get('x-forwarded-proto') ?? url.protocol.slice(0, -1);
  if (protocol !== 'http' && protocol !== 'https') {
    throw new Error('The public request protocol must be HTTP or HTTPS.');
  }
  return new URL(`${protocol}://${request.headers.get('host') ?? url.host}`).origin;
}
