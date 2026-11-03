// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/** Shared by chain.ts and the touch steps so both modes register by the same rules and words. */

import { departmentLocation } from "@/hospital/data";
import { displayMrn } from "@/hospital/patient-id";

export const LANGUAGES = ["English", "Malay", "Mandarin", "Tamil"];

/** Where a patient goes whose MyKad read is not right, or who has no MyKad with them. */
export const SEE_THE_COUNTER =
  `No problem — please go to ${departmentLocation("registration") || "the registration counter"}. ` +
  "Staff there will check your MyKad or passport and finish registering you.";

export function alreadyRegistered(mrn: string): string {
  return `You're already registered with us — your record number is ${displayMrn(mrn)}. To check or update your details, use Patient Verification.`;
}

/** Why a registration goes to staff instead of straight to a card. */
export function registrationEscalation(data: Record<string, string>): string | null {
  if (data.duplicateOf) return `Possible duplicate patient — same name and date of birth as ${data.duplicateOf}. Check before issuing a card.`;
  if (data.portraitTaken === "no") return "The kiosk could not take a photo — take the patient's photo before issuing a card.";
  return null;
}
