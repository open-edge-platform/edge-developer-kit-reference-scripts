// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { publicSettingEnvNames } from "@/lib/kiosk-config";

/** Serve browser-visible settings before the client components render. React
 * escapes the JSON as an HTML attribute, so config values stay data even when
 * they contain quotes, markup, or script text. */
export function KioskEnv() {
  const settings: Record<string, string> = {};
  for (const key of publicSettingEnvNames()) {
    const value = process.env[key];
    if (value !== undefined && value !== "") settings[key] = value;
  }

  return <div id="kiosk-env" hidden data-config={JSON.stringify(settings)} />;
}
