// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import net from 'node:net'

/**
 * True when `port` can be bound on 127.0.0.1 now (probing 0.0.0.0 raises the Windows firewall
 * prompt). Dependency-free so engine start handlers can import it without the registries.
 */
export async function canBind(port: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const srv = net.createServer()
    srv.once('error', () => resolve(false))
    srv.listen(port, '127.0.0.1', () => {
      srv.close(() => resolve(true))
    })
  })
}
