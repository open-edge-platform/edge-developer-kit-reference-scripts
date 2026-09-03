// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/**
 * Canonical forms for the identifiers citizens type in. Every registry lookup
 * normalises the same way, so a value that matches in one collection matches
 * in all of them.
 */

/** IC / passport numbers are stored upper-cased and unpadded. */
export function normalizeDocumentNumber(value: string): string {
  return value.trim().toUpperCase();
}

/** Registry plates are stored as "WSY 9742"; accept "wsy9742" and friends. */
export function normalizePlate(value: string): string {
  return normalizeDocumentNumber(value)
    .replace(/\s+/g, "")
    .replace(/^([A-Z]+)(\d+)$/, "$1 $2");
}
