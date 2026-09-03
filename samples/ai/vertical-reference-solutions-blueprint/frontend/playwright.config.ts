// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { defineConfig, devices } from "@playwright/test";
import { applyKioskConfig } from "./src/lib/kiosk-config";

/**
 * Kiosk test suite. Every test exercises the REAL AI services (local OCR +
 * LLM gateway) through the app — nothing is mocked. The `ai-gate` project
 * runs first and hard-fails the entire run when the AI services are down,
 * unreachable, or the app is in KIOSK_LLM_MOCK mode; the `api` and `e2e`
 * projects depend on it, so no verification test can pass without live AI.
 *
 * Requirements (see frontend/config.yaml):
 *   - llm.mock: false with llm.base_url / ocr.base_url pointing at the
 *     running gateway (Edge AI Demo Studio on :8080)
 *   - mock.identity.citizen matching documents.mocks_dir (the stand-in
 *     documents are generated in one citizen's name)
 */
// The tests read the same config.yaml the app does.
applyKioskConfig();

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
  reporter: [["list"], ["html", { open: "never" }]],
  // OCR (rasterize + per-page recognition) plus an LLM verdict can take
  // minutes per document on modest hardware.
  timeout: 300_000,
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
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
    {
      name: "e2e",
      testMatch: /tests\/e2e\/.+\.spec\.ts$/,
      dependencies: ["ai-gate"],
      timeout: 420_000,
      use: {
        ...devices["Desktop Chrome"],
        baseURL: "http://localhost:3000",
        // The identity step opens the kiosk camera for the face check. A test
        // browser has no webcam, so Chrome is given a synthetic one and the
        // permission is granted up front — otherwise every flow stops on the
        // "no camera on this kiosk" fallback.
        permissions: ["camera"],
        launchOptions: {
          args: [
            "--use-fake-ui-for-media-stream",
            "--use-fake-device-for-media-stream",
          ],
        },
      },
    },
  ],

  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000/api/health",
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
