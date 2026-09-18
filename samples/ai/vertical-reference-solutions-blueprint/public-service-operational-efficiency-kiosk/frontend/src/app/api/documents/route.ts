// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { analyzeStoredDocument, documentResponse, resolveRequirement } from "../_lib/documents";
import { badRequest } from "../_lib/http";
import { ACCEPTED_DOCUMENT_FORMATS, documentMimeType } from "../_lib/media";
import { storeDocument } from "../_lib/uploads";

const MAX_UPLOAD_BYTES = Number(process.env.KIOSK_UPLOAD_MAX_BYTES ?? 10 * 1024 * 1024);

export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  if (!form) return badRequest("expected multipart form data");
  const documentNumber = form.get("documentNumber");
  const relatedName = form.get("relatedName");
  const file = form.get("file");

  const lookup = resolveRequirement(form.get("serviceId"), form.get("documentId"));
  if ("error" in lookup) return badRequest(lookup.error);
  if (!(file instanceof File) || file.size === 0) {
    return badRequest("no document file uploaded");
  }
  // The scanner posts the PDF it captured here too, so a document is judged
  // by its format rather than by having come from a file picker.
  if (!documentMimeType(file.name)) {
    return badRequest(`only ${ACCEPTED_DOCUMENT_FORMATS} documents are accepted`);
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return badRequest(
      `document is too large — maximum ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB`,
    );
  }

  const stored = await storeDocument(lookup.service.id, lookup.requirement.id, file);
  const analysis = await analyzeStoredDocument(
    lookup,
    stored,
    typeof documentNumber === "string" ? documentNumber : undefined,
    typeof relatedName === "string" ? relatedName : undefined,
  );
  return documentResponse(lookup.requirement, stored, analysis);
}
