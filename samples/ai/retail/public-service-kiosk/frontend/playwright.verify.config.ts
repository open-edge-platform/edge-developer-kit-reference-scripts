// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

// TEMPORARY config for a touch/chat verification run — delete after use.
// Same as playwright.config.ts, but Chrome's fake camera plays a real
// portrait of citizen 1 (built from that citizen's seeded portrait) so the live
// face check can actually match; the default fake device shows a test
// pattern with no face in it, and every flow stops at the identity step.
import { defineConfig, devices } from "@playwright/test";
import { applyKioskConfig } from "./src/lib/kiosk-config";

applyKioskConfig();

const FAKE_CAMERA = process.env.VERIFY_FAKE_CAMERA!;

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  timeout: 300_000,
  use: { baseURL: "http://localhost:3000", trace: "retain-on-failure" },
  projects: [
    {
      name: "e2e",
      testMatch: /tests\/(e2e|verify)\/.+\.spec\.ts$/,
      timeout: 420_000,
      use: {
        ...devices["Desktop Chrome"],
        baseURL: "http://localhost:3000",
        permissions: ["camera"],
        launchOptions: {
          args: [
            "--use-fake-ui-for-media-stream",
            "--use-fake-device-for-media-stream",
            `--use-file-for-fake-video-capture=${FAKE_CAMERA}`,
          ],
        },
      },
    },
  ],
});
