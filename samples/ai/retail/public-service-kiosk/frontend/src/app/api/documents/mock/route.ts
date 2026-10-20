// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { analyzeStoredDocument, documentResponse, resolveRequirement } from "../../_lib/documents";
import { badRequest, delay, readJson, unavailable } from "../../_lib/http";
import { documentMimeType } from "../../_lib/media";
import { mockDocumentsEnabled, readMockDocument } from "../../_lib/mock-documents";
import { storeDocument } from "../../_lib/uploads";

/**
 * Mock-mode document capture: the kiosk supplies the stand-in document for
 * the requirement itself, then runs it through the same store → OCR → LLM
 * pipeline as a real upload and returns the same payload.
 */
export async function POST(req: Request) {
  if (!mockDocumentsEnabled()) {
    return unavailable("mock documents are disabled — set NEXT_PUBLIC_KIOSK_DOCUMENT_SOURCE=mock");
  }
  const body = await readJson<{
    serviceId: string;
    documentId: string;
    documentNumber?: string;
    relatedName?: string;
  }>(req);
  const lookup = resolveRequirement(body.serviceId, body.documentId);
  if ("error" in lookup) return badRequest(lookup.error);

  const mock = await readMockDocument(lookup.service.id, lookup.requirement.id);
  if (!mock) return unavailable("no mock document is available for this requirement");

  // Stand in for the seconds a real capture would take.
  await delay();
  const file = new File([new Uint8Array(mock.bytes)], mock.fileName, {
    type: documentMimeType(mock.fileName) ?? "application/pdf",
  });
  const stored = await storeDocument(lookup.service.id, lookup.requirement.id, file);
  const analysis = await analyzeStoredDocument(
    lookup,
    stored,
    body.documentNumber,
    body.relatedName,
  );
  return documentResponse(lookup.requirement, stored, analysis);
}
