// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { apiGet, apiUpload } from "./client";

// Staff-only calls; they ride the CMS admin session cookie — a 401 means the
// session expired, not a retryable save.

export type { CitizenSummary } from "@/app/api/_lib/enrollment";
import type { CitizenSummary } from "@/app/api/_lib/enrollment";

export type EnrollmentDraft = {
  name: string;
  citizenId: string;
  /** One of the active country pack's `countries` (src/lib/countries). */
  country: string;
  /** "1988-03-05", as a date input gives it. */
  dateOfBirth: string;
  sex: "" | "female" | "male";
  phone: string;
  email: string;
  addressLine: string;
  city: string;
  postcode: string;
  allergies: string;
  emergencyName: string;
  emergencyRelationship: string;
  emergencyPhone: string;
  notes: string;
};

export type CardRead = {
  card: {
    uid: string;
    atr: string;
    reader: string;
    /** True when the value is the card's ATR — a card MODEL, not a card. */
    fromAtr: boolean;
  };
  boundTo: { citizenKey: number; citizenId: string; name: string } | null;
  readers: string[];
};

/** The bench route, not the identity step — it never stands a citizen in
 *  when no reader answers, so a simulated serial can never be bound.
 *  `handoff`: the card it sees is the one the chat's next identity read gets. */
export function readCard(timeoutMs: number, signal?: AbortSignal, { handoff = false } = {}) {
  return apiGet<CardRead>(`/identity/card?timeout=${timeoutMs}${handoff ? "&handoff=1" : ""}`, signal);
}

export function searchCitizens(q: string) {
  return apiGet<{ citizens: CitizenSummary[] }>(
    `/staff/citizens?q=${encodeURIComponent(q)}`,
  );
}

function enrollmentForm(
  draft: EnrollmentDraft,
  nfcUid: string,
  portrait: Blob | null,
): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries(draft)) form.set(key, value);
  form.set("nfcUid", nfcUid);
  if (portrait) form.set("portrait", portrait, "portrait.jpg");
  return form;
}

export function enrollCitizen(draft: EnrollmentDraft, nfcUid: string, portrait: Blob | null) {
  return apiUpload<{ citizen: CitizenSummary }>(
    "/staff/citizens",
    enrollmentForm(draft, nfcUid, portrait),
  );
}

/** `nfcUid`: "" unbinds the card, absent means "portrait only". */
export function updateEnrollment(
  id: number,
  changes: { nfcUid?: string; portrait?: Blob | null },
) {
  const form = new FormData();
  if (changes.nfcUid !== undefined) form.set("nfcUid", changes.nfcUid);
  if (changes.portrait) form.set("portrait", changes.portrait, "portrait.jpg");
  return apiUpload<{ citizen: CitizenSummary }>(`/staff/citizens/${id}`, form, "PATCH");
}
