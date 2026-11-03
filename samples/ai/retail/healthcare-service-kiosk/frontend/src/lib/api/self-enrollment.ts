// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { CardEnrollment } from "@/app/api/_lib/self-enrollment";
import { apiDelete, apiGet, apiPoll, apiPost } from "./client";
import type { IdentityVerification } from "./kiosk";

// A new patient registering themselves — see src/app/api/_lib/self-enrollment.ts.

export type { CardEnrollment };

/** The record just made, as a passed identity check; `portrait` false when it has no photo yet. */
export type Enrolled = IdentityVerification & { portrait: boolean };

/** Long-poll for a MyKad on the reader; null when none came. Never a stand-in. */
export function watchEnrollmentCard(signal?: AbortSignal) {
  return apiPoll<CardEnrollment>("/enroll/card?watch=1", signal);
}

/** The MyKad on the reader now — or a stand-in one, on a kiosk whose reader is simulated. */
export function readEnrollmentCard() {
  return apiGet<CardEnrollment>("/enroll/card");
}

/** Register the patient the confirmed read describes; `image` is their photo, null with no camera. */
export function enrollPatient(token: string, image: string | null) {
  return apiPost<Enrolled>("/enroll", { token, ...(image ? { image } : {}) });
}

/** The patient said the details are not theirs. */
export function discardEnrollment(token: string) {
  return apiDelete<{ discarded: true }>(`/enroll?token=${encodeURIComponent(token)}`);
}
