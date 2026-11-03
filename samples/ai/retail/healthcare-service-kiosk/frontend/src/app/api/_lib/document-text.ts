// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { DocumentRequirement } from "@/services/types";
import type { Ask } from "./flows/types";
import type { DocumentAnalysis, DocumentStatus } from "./llm";
import { extractDocumentText } from "./ocr";
import { findStoredDocument, type StoredDocument } from "./uploads";

/**
 * The OCR text of recently checked documents, so a service can read fields off paperwork the
 * documents check already read without running OCR twice. Keyed by service, requirement and
 * patient, and held in memory only, like the captures awaiting confirmation.
 */

export type DocumentText = {
  /** "" when OCR read nothing or failed. */
  text: string;
  /** The documents check's verdict; null for a copy recovered from the uploads folder. */
  status: DocumentStatus | null;
  typeMatches: boolean;
  uploadedAt: string;
  filePath: string;
  at: number;
  readings: Map<string, Promise<unknown>>;
};

export type DocumentPatient = { name: string; nationalId: string };

/** Reads typed fields off one document — for the touch steps via /api/document-ai, and for the chains. */
export type DocumentReader = (doc: DocumentText, patient: DocumentPatient | null) => Promise<unknown>;

type Entry = Omit<DocumentText, "text"> & {
  /** null until OCR has been attempted (the check skips it when no model is configured). */
  text: string | null;
};

const TTL_MS = 20 * 60_000;
const MAX_KEPT = 24;

type Global = typeof globalThis & { __kioskDocumentText?: Map<string, Entry> };

function store(): Map<string, Entry> {
  const globals = globalThis as Global;
  globals.__kioskDocumentText = globals.__kioskDocumentText ?? new Map();
  const kept = globals.__kioskDocumentText;
  const stale = Date.now() - TTL_MS;
  for (const [key, entry] of kept) if (entry.at < stale) kept.delete(key);
  while (kept.size > MAX_KEPT) kept.delete(kept.keys().next().value!);
  return kept;
}

const keyOf = (serviceId: string, documentId: string, documentNumber: string) =>
  `${serviceId}:${documentId}:${documentNumber.trim().toUpperCase()}`;

export function keepDocumentText(input: {
  serviceId: string;
  documentId: string;
  documentNumber: string;
  stored: StoredDocument;
  text: string | null;
  analysis: DocumentAnalysis;
}): void {
  const kept = store();
  const key = keyOf(input.serviceId, input.documentId, input.documentNumber);
  kept.delete(key);
  kept.set(key, {
    text: input.text,
    status: input.analysis.status,
    typeMatches: input.analysis.typeMatches,
    uploadedAt: input.stored.uploadedAt,
    filePath: input.stored.filePath,
    at: Date.now(),
    readings: new Map(),
  });
}

/**
 * The patient's latest document for a requirement. `uploadedAt` pins one upload, recovered from
 * the uploads folder when this process never saw it (a restart, a resumed draft); `since` ignores
 * anything captured before the flow asked for it.
 */
export async function documentText(query: {
  serviceId: string;
  documentId: string;
  documentNumber: string;
  uploadedAt?: string;
  since?: number;
}): Promise<DocumentText | null> {
  const kept = store();
  const key = keyOf(query.serviceId, query.documentId, query.documentNumber);
  let entry = kept.get(key) ?? null;
  if (query.uploadedAt && entry?.uploadedAt !== query.uploadedAt) {
    const filePath = await findStoredDocument(query.serviceId, query.documentId, query.uploadedAt);
    entry = filePath
      ? {
          text: null,
          status: null,
          typeMatches: true,
          uploadedAt: query.uploadedAt,
          filePath,
          at: Date.now(),
          readings: new Map(),
        }
      : null;
    if (entry) kept.set(key, entry);
  }
  if (!entry || (query.since && entry.at < query.since)) return null;
  if (entry.text === null) {
    const extraction = await extractDocumentText(entry.filePath);
    entry.text = extraction.ok ? extraction.text : "";
  }
  return entry as DocumentText;
}

/** One reading per document and reader, shared by the touch step and the chain. */
export function readOnce<T>(doc: DocumentText, name: string, read: () => Promise<T>): Promise<T> {
  const cached = doc.readings.get(name) as Promise<T> | undefined;
  if (cached) return cached;
  const reading = read();
  doc.readings.set(name, reading);
  reading.catch(() => doc.readings.delete(name));
  return reading;
}

/** A chain's own ask for a requirement's document, worded as the documents phase words it. */
export function documentAsk(requirement: DocumentRequirement, lead?: string): Ask {
  return {
    id: requirement.id,
    type: "document",
    modal: true,
    question: `${lead ? `${lead} ` : ""}Please upload your ${requirement.label} (${requirement.hint}) as a PDF or a photo.`,
  };
}
