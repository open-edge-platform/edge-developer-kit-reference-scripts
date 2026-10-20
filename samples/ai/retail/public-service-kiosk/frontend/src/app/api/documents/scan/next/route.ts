// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { badRequest, param, unavailable } from "../../../_lib/http";
import { captureDocument, scannerEnabled } from "../../../_lib/scanner";

/**
 * Hands-free document capture for the assistant kiosk: runs the scanner for
 * the requirement being asked about and returns the document it produced, so
 * a document ask can be answered without anyone tapping "upload". A citizen
 * who feeds in three sheets gets one three-page PDF back.
 *
 * The bytes come back base64-encoded rather than as a path — the chat then
 * answers the ask over exactly the same `fileBase64` route the file picker
 * uses, and the server never accepts a filesystem path chosen by the client.
 *
 * The requirement is named because a kiosk with no scanner attached stands in
 * the right document for it instead (see ../../_lib/scanner).
 */
export async function GET(req: Request) {
  if (!scannerEnabled()) {
    return unavailable("scanner capture is disabled — set NEXT_PUBLIC_KIOSK_DOCUMENT_SOURCE=scanner");
  }
  const serviceId = param(req, "serviceId");
  const documentId = param(req, "documentId");
  if (!serviceId || !documentId) return badRequest("serviceId and documentId are required");

  const scan = await captureDocument(serviceId, documentId).catch((error: Error) => error);
  if (scan instanceof Error) {
    return Response.json(
      { error: `the scan did not complete — ${scan.message}` },
      { status: 408 },
    );
  }
  return Response.json(
    {
      fileName: scan.fileName,
      fileBase64: scan.bytes.toString("base64"),
      simulated: scan.simulated,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
