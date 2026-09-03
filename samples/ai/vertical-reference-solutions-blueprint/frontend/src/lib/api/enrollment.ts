// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { apiGet, apiUpload } from "./client";

// Staff-only calls; they ride the CMS admin session cookie — a 401 means the
// session expired, not a retryable save.

/** Mirrors the route's own summary — keep in sync. */
export type CitizenSummary = {
  id: number;
  citizenKey: number;
  citizenId: string;
  name: string;
  country: string;
  nfcUid: string | null;
  /** Filename of their enrolled portrait, or null when they have none. */
  portrait: string | null;
};

export type EnrollmentDraft = {
  name: string;
  citizenId: string;
  /** One of the active country pack's `countries` (src/lib/countries). */
  country: string;
  addressLine: string;
  city: string;
  postcode: string;
  age: string;
  phone: string;
  email: string;
  race: string;
  religion: string;
  maritalStatus: string;
  monthlyIncome: string;
  childrenUnder18: string;
  isOku: boolean;
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
 *  when no reader answers, so a simulated serial can never be bound. */
export function readCard(timeoutMs: number, signal?: AbortSignal) {
  return apiGet<CardRead>(`/identity/card?timeout=${timeoutMs}`, signal);
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
  for (const [key, value] of Object.entries(draft)) {
    form.set(key, typeof value === "boolean" ? String(value) : value);
  }
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
