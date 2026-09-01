// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

// Applies config.yaml before the server accepts requests — next.config.ts's
// side effect is not guaranteed to reach the serving process under `next start`.
// Server-side KIOSK_* only; NEXT_PUBLIC_* is baked into the bundles at build time.
export async function register() {
  // kiosk-config reads the filesystem; keep it out of the edge bundle.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { applyKioskConfig } = await import("./lib/kiosk-config");
    applyKioskConfig();
  }
}
