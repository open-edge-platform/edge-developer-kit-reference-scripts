// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { defineConfig } from "@playwright/test";
import { applyKioskConfig } from "./src/lib/kiosk-config";

/**
 * Kiosk test suite. Every test exercises the REAL AI services (local OCR +
 * LLM gateway) through the app — nothing is mocked. The `ai-gate` project
 * runs first and hard-fails the entire run when the AI services are down,
 * unreachable, or the app is in KIOSK_LLM_MOCK mode; the `api` project
 * depends on it, so no verification test can pass without live AI.
 *
 * Requirements (see frontend/config.yaml):
 *   - llm.mock: false with llm.base_url / ocr.base_url pointing at the
 *     running gateway (Edge AI Demo Studio on :8080)
 *   - mock.identity.citizen: 1 — the documents the specs upload are citizen
 *     1's (`npm run mocks:gen`)
 */
// The tests read the same config.yaml the app does.
applyKioskConfig();

// A server someone else runs — the CI starts it through start.sh.
const KIOSK_BASE = process.env.KIOSK_BASE;
const BASE_URL = KIOSK_BASE ?? "http://127.0.0.1:3001";

export default defineConfig({
  testDir: "./tests",
  // Document analysis is served by a small local model — run tests strictly
  // sequentially so parallel OCR/LLM calls don't starve each other into
  // timeouts.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  // A retried AI verdict is a flaky verdict — surface it instead of hiding it.
  retries: 0,
  reporter: process.env.CI
    ? [["list"], ["html", { open: "never" }], ["junit", { outputFile: "test-results/junit.xml" }], ["github"]]
    : [["list"], ["html", { open: "never" }]],
  // OCR (rasterize + per-page recognition) plus an LLM verdict can take
  // minutes per document on modest hardware.
  timeout: 300_000,
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },

  projects: [
    {
      name: "ai-gate",
      testMatch: /ai-gate\.setup\.ts$/,
    },
    {
      name: "api",
      testMatch: /tests\/api\/.+\.spec\.ts$/,
      dependencies: ["ai-gate"],
    },
  ],

  webServer: KIOSK_BASE
    ? undefined
    : {
        command: "npm run dev",
        url: `${BASE_URL}/api/health`,
        reuseExistingServer: true,
        timeout: 180_000,
      },
});
