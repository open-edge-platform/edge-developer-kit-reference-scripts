#!/usr/bin/env node
// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/**
 * Run a command with config.yaml's browser-visible settings in its environment:
 * `node scripts/with-kiosk-env.mjs next build`. Turbopack freezes NEXT_PUBLIC_*
 * values at build time from the real environment (next.config.ts's `env` never
 * reaches it), so they must be exported before the build starts. Real
 * environment variables still win — values are only filled in when absent.
 */
import { spawn } from "node:child_process";

const { readKioskConfig } = await import("../src/lib/kiosk-config.ts");

for (const [key, value] of Object.entries(readKioskConfig())) {
  if (key.startsWith("NEXT_PUBLIC_") && process.env[key] === undefined) {
    process.env[key] = value;
  }
}

const [cmd, ...args] = process.argv.slice(2);
if (!cmd) {
  console.error("usage: with-kiosk-env.mjs <command> [args...]");
  process.exit(2);
}

const child = spawn(cmd, args, { stdio: "inherit", shell: process.platform === "win32" });
child.on("exit", (code, signal) => process.exit(signal ? 1 : (code ?? 1)));
child.on("error", (error) => {
  console.error(`with-kiosk-env: could not run ${cmd}: ${error.message}`);
  process.exit(1);
});
