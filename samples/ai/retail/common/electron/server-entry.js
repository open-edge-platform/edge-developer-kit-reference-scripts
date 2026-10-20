// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

// Chromium treats an empty environment value as "unset" when it launches a
// utility process, and the kiosk reads an empty *_BASE_URL as "service off" —
// so main.js names the empty keys here and they are put back before the
// server reads its environment.
for (const key of (process.env.KIOSK_SHELL_EMPTY_ENV || "").split(",")) {
  if (key) process.env[key] = "";
}
delete process.env.KIOSK_SHELL_EMPTY_ENV;
require(process.argv[process.argv.length - 1]);
