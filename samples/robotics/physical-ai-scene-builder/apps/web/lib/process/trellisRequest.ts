// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { Readable } from 'node:stream';

export async function requestTrellis(
  url: string,
  form: FormData,
  signal: AbortSignal,
): Promise<Response> {
  const upload = new Request(url, { method: 'POST', body: form });
  const body = Buffer.from(await upload.arrayBuffer());
  const target = new URL(url);
  if (!['http:', 'https:'].includes(target.protocol)) {
    throw new Error('TRELLIS.2 requires an HTTP or HTTPS URL.');
  }
  const request = target.protocol === 'https:' ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    const outgoing = request(
      target,
      { method: 'POST', headers: Object.fromEntries(upload.headers), signal },
      (incoming) => {
        resolve(
          new Response(Readable.toWeb(incoming) as ReadableStream<Uint8Array>, {
            status: incoming.statusCode ?? 502,
            statusText: incoming.statusMessage,
          }),
        );
      },
    );
    outgoing.once('error', reject);
    outgoing.end(body);
  });
}
