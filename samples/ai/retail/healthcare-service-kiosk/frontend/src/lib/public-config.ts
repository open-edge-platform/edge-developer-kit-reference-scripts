// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/**
 * The browser-visible half of config.yaml, read at run time.
 *
 * `process.env.NEXT_PUBLIC_*` is a build-time literal in the client bundle, so
 * reading it there would freeze every browser-side setting into the build.
 * Instead the kiosk layout serves the live values in an escaped HTML attribute
 * (see src/components/kiosk-env.tsx), and browser reads parse that data here.
 * A settings change then needs a restart, never a rebuild.
 *
 * Every read must happen during or after render: module-scope constants are
 * evaluated before the served values exist.
 */

export function publicEnv(key: string): string | undefined {
  let value: string | undefined;
  if (typeof document === "undefined") {
    value = process.env[key];
  } else {
    const data = document.getElementById("kiosk-env")?.getAttribute("data-config");
    value = data ? (JSON.parse(data) as Record<string, string>)[key] : undefined;
  }
  return value === undefined || value === "" ? undefined : value;
}

export const publicText = (key: string, fallback: string): string =>
  publicEnv(key) ?? fallback;

export function publicNumber(key: string, fallback: number): number {
  const value = Number(publicEnv(key));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function publicBoolean(key: string, fallback: boolean): boolean {
  const value = publicEnv(key);
  return value === "true" ? true : value === "false" ? false : fallback;
}
