// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/**
 * Restarting the kiosk from inside it.
 *
 * Settings are read once, at start (src/lib/kiosk-config.ts copies
 * config.yaml into process.env and every module reads it as it loads), so a
 * saved change only takes effect on the next start. The server cannot start
 * itself again; what it can do is exit with a code whoever started it treats
 * as "start me again":
 *
 *   - `next dev` restarts its server on this code by itself (it is Next's
 *     own RESTART_EXIT_CODE);
 *   - every production supervisor of this kit — `npm run start`
 *     (scripts/with-kiosk-env.mjs), the desktop shell (electron/main.js) and
 *     the studio worker (scripts/bundle/worker-start.*) — loops on it and
 *     announces itself with KIOSK_SUPERVISED=1.
 *
 * Anything else (a bare `next start`) gets told to restart by hand.
 */

export const RESTART_EXIT_CODE = 77;

export function restartSupported(): boolean {
  return process.env.KIOSK_SUPERVISED === "1" || process.env.NODE_ENV === "development";
}

/** Exit once the reply has left. */
export function scheduleRestart(): void {
  setTimeout(() => process.exit(RESTART_EXIT_CODE), 500);
}
