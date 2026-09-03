// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { analyzeStoredDocument, documentResponse, resolveRequirement } from "../../_lib/documents";
import { badRequest, readJson, unavailable } from "../../_lib/http";
import { documentMimeType } from "../../_lib/media";
import { captureDocument, scannerEnabled } from "../../_lib/scanner";
import { storeDocument } from "../../_lib/uploads";

/**
 * Scanner-mode document capture (NEXT_PUBLIC_KIOSK_DOCUMENT_SOURCE=scanner).
 * Instead of receiving an uploaded file, this route runs the attached scanner
 * (`scanimage`) and feeds the PDF it produces through the same store → OCR →
 * LLM pipeline as an upload, returning the same payload. A document may be
 * several sheets: they arrive as the pages of one PDF.
 */
export async function POST(req: Request) {
  if (!scannerEnabled()) {
    return unavailable("scanner capture is disabled — set NEXT_PUBLIC_KIOSK_DOCUMENT_SOURCE=scanner");
  }
  const body = await readJson<{
    serviceId: string;
    documentId: string;
    documentNumber?: string;
    relatedName?: string;
  }>(req);
  const lookup = resolveRequirement(body.serviceId, body.documentId);
  if ("error" in lookup) return badRequest(lookup.error);

  const scan = await captureDocument(lookup.service.id, lookup.requirement.id).catch(
    (error: Error) => error,
  );
  if (scan instanceof Error) {
    return Response.json(
      { error: `the scan did not complete — ${scan.message}` },
      { status: 408 },
    );
  }

  const file = new File([new Uint8Array(scan.bytes)], scan.fileName, {
    type: documentMimeType(scan.fileName) ?? "application/octet-stream",
  });
  const stored = await storeDocument(lookup.service.id, lookup.requirement.id, file);
  const analysis = await analyzeStoredDocument(
    lookup,
    stored,
    body.documentNumber,
    body.relatedName,
  );
  return documentResponse(lookup.requirement, stored, analysis, scan.simulated);
}
