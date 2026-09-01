// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { SimulatePolicy } from "./types";

/** Read per call, never frozen at import: these are loaded from the Payload config as well
 *  as from the routes, and a cached value leaves the two halves disagreeing. */

export type NfcDriverId = "pcsc" | "mock";
export type ScannerDriverId = "sane" | "mock";

export function nfcDriverId(): NfcDriverId {
  return process.env.KIOSK_NFC_DRIVER?.trim().toLowerCase() === "mock" ? "mock" : "pcsc";
}

export function scannerDriverId(): ScannerDriverId {
  return process.env.KIOSK_SCANNER_DRIVER?.trim().toLowerCase() === "mock" ? "mock" : "sane";
}

const asPolicy = (value: string | undefined): SimulatePolicy =>
  value === "always" || value === "never" ? value : "auto";

export function nfcSimulatePolicy(): SimulatePolicy {
  if (nfcDriverId() === "mock") return "always";
  return asPolicy(process.env.KIOSK_NFC_SIMULATE);
}

export function scannerSimulatePolicy(): SimulatePolicy {
  if (scannerDriverId() === "mock") return "always";
  return asPolicy(process.env.KIOSK_SCANNER_SIMULATE);
}
