// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { badRequest, delay, param, unavailable } from "../../../_lib/http";
import { mockDocumentsEnabled, readMockDocument } from "../../../_lib/mock-documents";

/**
 * Mock-mode capture for the assistant kiosk: hands back the stand-in document
 * for a requirement so a document ask can be answered with nothing to tap.
 *
 * Returns the bytes base64-encoded, matching the scanner endpoint — the chat
 * then answers over the same `fileBase64` channel the file picker uses, and
 * the flow engine does the real OCR and verification on it.
 */
export async function GET(req: Request) {
  if (!mockDocumentsEnabled()) {
    return unavailable("mock documents are disabled — set NEXT_PUBLIC_KIOSK_DOCUMENT_SOURCE=mock");
  }
  const serviceId = param(req, "serviceId");
  const documentId = param(req, "documentId");
  if (!serviceId || !documentId) return badRequest("serviceId and documentId are required");

  const mock = await readMockDocument(serviceId, documentId);
  if (!mock) return unavailable("no mock document is available for this requirement");

  await delay();
  return Response.json(
    { fileName: mock.fileName, fileBase64: mock.bytes.toString("base64") },
    { headers: { "cache-control": "no-store" } },
  );
}
