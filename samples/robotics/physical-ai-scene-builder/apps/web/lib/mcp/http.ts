// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { isIP } from 'node:net';

import { requestOrigin } from '../http/requestOrigin';

function allowedHost(host: string): boolean {
  if (host === 'localhost' || host === '127.0.0.1' || host === '[::1]') return true;
  const publicUrl = process.env.NEXT_PUBLIC_SERVER_URL;
  if (publicUrl && host === new URL(publicUrl).hostname) return true;

  const bind = process.env.BIND_ADDRESS ?? '127.0.0.1';
  const address = host.replace(/^\[|\]$/g, '');
  if (address === '0.0.0.0' || address === '::') return false;
  if (bind === '0.0.0.0' || bind === '::') {
    // IP literals cannot be DNS-rebound. Arbitrary DNS names stay denied.
    return isIP(address) !== 0;
  }
  return host === bind || address === bind;
}

export function checkMcpOrigin(request: Request, requireOrigin = false): Response | null {
  const url = new URL(requestOrigin(request));
  if (!allowedHost(url.hostname)) {
    return Response.json(
      {
        error:
          'MCP host is not allowed. Enable LAN binding or configure NEXT_PUBLIC_SERVER_URL for a custom domain.',
      },
      { status: 403 },
    );
  }
  const origin = request.headers.get('origin');
  if ((requireOrigin && !origin) || (origin && origin !== url.origin)) {
    return Response.json({ error: 'MCP requests must be same-origin.' }, { status: 403 });
  }
  return null;
}

export function bearerToken(request: Request): string {
  return request.headers.get('authorization')?.replace(/^Bearer /, '') ?? '';
}
