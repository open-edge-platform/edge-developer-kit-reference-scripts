// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/** Virtual device processes reach this server over loopback, whatever host name the browser used. */
export function loopbackOrigin(request: Request): string {
  const url = new URL(request.url);
  const port = process.env.PORT?.trim() || url.port || (url.protocol === 'https:' ? '443' : '80');
  return `${url.protocol}//127.0.0.1:${port}`;
}
