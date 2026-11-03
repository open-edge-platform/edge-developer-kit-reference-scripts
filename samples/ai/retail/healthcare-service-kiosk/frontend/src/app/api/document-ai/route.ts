// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { readerFor } from "@/packs/index.server";
import { findCitizenByDocument } from "../_lib/citizens";
import { resolveRequirement } from "../_lib/documents";
import { documentText } from "../_lib/document-text";
import { badRequest, notFound, readJson } from "../_lib/http";

/**
 * POST /api/document-ai {serviceId, documentId, documentNumber, uploadedAt}
 *
 * Fields read off a document the documents check already OCR'd, by the service's own reader.
 * 404 with reason "no_text" when the upload cannot be found or OCR read nothing — the step then
 * falls back to asking the patient.
 */
export async function POST(req: Request) {
  const body = await readJson<{
    serviceId: string;
    documentId: string;
    documentNumber: string;
    uploadedAt: string;
  }>(req);
  const lookup = resolveRequirement(body.serviceId, body.documentId);
  if ("error" in lookup) return badRequest(lookup.error);
  const reader = await readerFor(lookup.service.id, lookup.requirement.id);
  if (!reader) return badRequest("no reader for this document");
  if (typeof body.documentNumber !== "string" || typeof body.uploadedAt !== "string") {
    return badRequest("documentNumber and uploadedAt are required");
  }

  const doc = await documentText({
    serviceId: lookup.service.id,
    documentId: lookup.requirement.id,
    documentNumber: body.documentNumber,
    uploadedAt: body.uploadedAt,
  });
  if (!doc?.text) return notFound("no text could be read from this document", { reason: "no_text" });
  const citizen = await findCitizenByDocument(body.documentNumber);
  const patient = citizen ? { name: citizen.name, nationalId: citizen.citizenId } : null;
  return Response.json(await reader(doc, patient), { headers: { "cache-control": "no-store" } });
}
