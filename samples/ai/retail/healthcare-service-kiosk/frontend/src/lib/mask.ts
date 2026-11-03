// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/** On-screen redaction for a kiosk in a public hall: enough to recognise, not to copy. */

/** Everything but the last 4 characters hidden; dashes and spaces kept for shape. */
export function maskId(id: string | null | undefined): string {
  if (!id) return "—";
  if (id.length <= 4) return id;
  return `${id.slice(0, -4).replace(/[^-\s]/g, "•")}${id.slice(-4)}`;
}

/** Initials only, for a record opened by a scanned code before its holder has confirmed who they are. */
export function maskName(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => `${part[0]}${"•".repeat(Math.min(Math.max(part.length - 1, 1), 4))}`)
    .join(" ");
}
