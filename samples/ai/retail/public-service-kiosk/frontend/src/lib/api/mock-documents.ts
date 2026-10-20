// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { apiGet } from "./client";

export type MockVariant = "good" | "false";

export type MockDocumentFile = {
  file: string;
  label: string;
  title: string;
  valid: boolean;
  mode?: "holder" | "id";
  /** What is wrong with a tampered document. */
  note?: string;
};

export type MockDocumentSet = { variant: MockVariant; donor: string | null; files: MockDocumentFile[] };

export type MockDocuments = {
  citizen: { name: string; citizenId: string; slug: string };
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
