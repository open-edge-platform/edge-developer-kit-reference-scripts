// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { apiDelete, apiGet, apiPost } from "./client";

export type MockVariant = "good" | "false";

export type MockDocumentFile = {
  file: string;
  /** What it stands in for at a scan step; "code" is a patient card or slip to scan, not to feed. */
  role: "identity" | "referral" | "medical" | "insurance-card" | "code";
  label: string;
  title: string;
  valid: boolean;
  mode?: "holder" | "id";
  /** What is wrong with a tampered document. */
  note?: string;
};

export type MockDocumentSet = { variant: MockVariant; donor: string | null; files: MockDocumentFile[] };

export type MockDocuments = {
  citizen: { name: string; citizenId: string; slug: string; foreign: boolean };
  /** What the barcode scanner can read for this patient: their MRN, and today's slip if they have a visit. */
  codes: { mrn: string | null; slip: { reference: string; date: string; time: string; clinic: string } | null };
  /** The genuine set, then the tampered one when the register has a second patient to borrow from. */
  sets: MockDocumentSet[];
};

export function getMockDocuments(citizen: number): Promise<MockDocuments> {
  return apiGet<MockDocuments>(`/staff/mock-documents?citizen=${citizen}`);
}

/** API path of one PDF, one set's zip (no file), or both sets' zip (no variant). */
export function mockDocumentPath(
  citizen: number,
  opts: { variant?: MockVariant; file?: string; inline?: boolean } = {},
): string {
  const query = new URLSearchParams({ citizen: String(citizen) });
  if (opts.variant) query.set("variant", opts.variant);
  if (opts.file) query.set("file", opts.file);
  if (opts.inline) query.set("inline", "1");
  return `/staff/mock-documents/download?${query}`;
}

/** What the bench may stand in for on this terminal, and the page waiting in the simulated feeder. */
export type MockBench = {
  feed: boolean;
  scan: boolean;
  tap: boolean;
  fed: { fileName: string; label: string; at: string } | null;
};

export type BenchAction =
  | { action: "feed"; variant: MockVariant; file: string }
  | { action: "scan-card" | "scan-slip" | "tap" };

export function getMockBench(): Promise<MockBench> {
  return apiGet<MockBench>("/staff/mock-documents/present");
}

export function presentAtKiosk(citizen: number, what: BenchAction) {
  return apiPost<{ fed?: MockBench["fed"]; tapped?: string; scanned?: string }>("/staff/mock-documents/present", {
    citizen,
    ...what,
  });
}

export function emptyFeeder() {
  return apiDelete<{ fed: null }>("/staff/mock-documents/present");
}
