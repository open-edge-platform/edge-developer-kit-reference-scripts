// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { apiGet, apiPost, apiPut } from "./client";

// Staff-only calls; they ride the CMS admin session cookie — a 401 means the
// session expired, not a retryable save.

/** Mirrors the route's snapshot (src/app/api/_lib/settings.ts) — keep in sync. */
export type SettingsSnapshot = {
  file: string;
  text: string;
  local: string | null;
  values: Record<string, string>;
  running: Record<string, string>;
  overridden: string[];
  restart: "supervised" | "manual";
};

export function getSettings() {
  return apiGet<SettingsSnapshot>("/staff/settings");
}

export function saveSettings(values: Record<string, string>) {
  return apiPut<SettingsSnapshot>("/staff/settings", { values });
}

export function saveSettingsText(text: string) {
  return apiPut<SettingsSnapshot & { unknown: string[] }>("/staff/settings", { text });
}

export function restartKiosk() {
  return apiPost<{ restarting: boolean }>("/staff/settings/restart", {});
}
