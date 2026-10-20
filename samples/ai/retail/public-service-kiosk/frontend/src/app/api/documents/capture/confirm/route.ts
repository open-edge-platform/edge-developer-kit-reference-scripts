// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { takeCapture } from "../../../_lib/captures";
import {
  analyzeStoredDocument,
  documentResponse,
  resolveRequirement,
} from "../../../_lib/documents";
import { badRequest, readJson } from "../../../_lib/http";
import { documentMimeType } from "../../../_lib/media";
import { clearProgress, reporter } from "../../../_lib/progress";
import { storeDocument } from "../../../_lib/uploads";

/**
 * Phase two: the citizen looked at the preview and said that is the document.
 * Only now is it written to the uploads folder and put through the same
 * OCR → LLM check an upload goes through — nothing is filed against a
 * citizen's application until they have seen what is being filed.
 *
 * The capture is taken out of the held set on the way through, so a confirm
 * that arrives twice (a double tap, a retried request) cannot file the same
 * scan against the requirement twice.
 */
export async function POST(req: Request) {
  const body = await readJson<{
    captureId: string;
    documentNumber?: string;
    relatedName?: string;
    traceId?: string;
  }>(req);

  const capture = takeCapture(body.captureId);
  if (!capture) {
    return Response.json(
      {
        error: "that scan is no longer available — please capture the document again",
        reason: "capture_expired",
      },
      { status: 409 },
    );
  }
  const lookup = resolveRequirement(capture.serviceId, capture.documentId);
  if ("error" in lookup) return badRequest(lookup.error);

  const report = reporter(body.traceId);
  try {
    report("storing");
    const file = new File([new Uint8Array(capture.bytes)], capture.fileName, {
      type: documentMimeType(capture.fileName) ?? "application/octet-stream",
    });
    const stored = await storeDocument(lookup.service.id, lookup.requirement.id, file);
    const analysis = await analyzeStoredDocument(
      lookup,
      stored,
      body.documentNumber,
      body.relatedName,
      report,
    );
    return documentResponse(lookup.requirement, stored, analysis, capture.simulated);
  } finally {
    clearProgress(body.traceId);
  }
}
