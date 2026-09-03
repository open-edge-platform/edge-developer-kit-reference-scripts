// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { ScannerStatusProfile } from "./types";

/** Fujitsu/PFU fi-800R: a loaded ADF reports 0x81000100 — the chute-empty bit stays set —
 *  so `documentLoaded` tests all three paper signals rather than the empty bit alone. */
const FI_800R: ScannerStatusProfile = {
  id: "fi-800r",
  statusBin: "pfufsgetscstatus",
  bits: {
    chuteEmpty: 0x8000_0000,
    coverOpen: 0x2000_0000,
    adfDocumentLoaded: 0x0100_0100,
    returnPathOccupied: 0x0000_0001,
  },
  documentLoaded(status: number): boolean {
    const { chuteEmpty, adfDocumentLoaded, returnPathOccupied } = this.bits;
    return (
      (status & adfDocumentLoaded) === adfDocumentLoaded ||
      (status & chuteEmpty) === 0 ||
      (status & returnPathOccupied) !== 0
    );
  },
};

/** No paper detection — the scan itself is the check. For SANE's `test:0` and any model
 *  without a status tool. */
const NONE: ScannerStatusProfile = {
  id: "none",
  statusBin: "",
  bits: { chuteEmpty: 0, coverOpen: 0, adfDocumentLoaded: 0, returnPathOccupied: 0 },
  documentLoaded: () => true,
};

const PROFILES: Record<string, ScannerStatusProfile> = {
  "fi-800r": FI_800R,
  none: NONE,
};

/** Unknown profile names fall back to "none" with a warning. */
export function scannerStatusProfile(): ScannerStatusProfile {
  const id = process.env.KIOSK_SCANNER_PROFILE?.trim().toLowerCase() || "fi-800r";
  const profile = PROFILES[id];
  if (!profile) {
    console.warn(`[scanner] unknown status profile "${id}" — paper detection is off`);
    return NONE;
  }
  return profile;
}
