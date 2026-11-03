// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { findCitizenByDocument, type CitizenDoc } from "./citizens";

/**
 * The patient this terminal is serving: whoever last passed the identity
 * check here. Only the simulated peripherals read it, so a stood-in scan is
 * that patient's paperwork rather than whoever the config pins.
 */

const TTL_MS = Number(process.env.KIOSK_VERIFICATION_TTL_MS ?? 15 * 60_000);

const SERVED = Symbol.for("kiosk.servedPatient");
type Global = { [SERVED]?: { documentNumber: string; at: number } };

export function noteServedPatient(documentNumber: string): void {
  (globalThis as Global)[SERVED] = { documentNumber, at: Date.now() };
}

/** Is this the patient who verified here, still within the window? Guards routes that read a record by its number. */
export function isServedPatient(documentNumber: string): boolean {
  const served = (globalThis as Global)[SERVED];
  return Boolean(
    served && Date.now() - served.at <= TTL_MS && served.documentNumber === documentNumber.trim().toUpperCase(),
  );
}

export async function servedPatient(): Promise<CitizenDoc | null> {
  const served = (globalThis as Global)[SERVED];
  if (!served || Date.now() - served.at > TTL_MS) return null;
  return findCitizenByDocument(served.documentNumber);
}
