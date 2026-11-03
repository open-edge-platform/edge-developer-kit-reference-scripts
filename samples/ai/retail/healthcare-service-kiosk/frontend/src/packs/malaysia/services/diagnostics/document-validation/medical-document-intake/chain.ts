// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import path from "path";
import { documentAsk, documentText } from "@/app/api/_lib/document-text";
import { findStoredDocument } from "@/app/api/_lib/uploads";
import { ask, READY } from "@/app/api/_lib/flows/plan";
import type { ChainSpec } from "@/app/api/_lib/flows/types";
import { MANUAL_CLASSIFICATION, docType, intakeData, isDocType, typeOptions, typeQuestion } from "./doctypes";
import { classifyMedicalDocument } from "./read";

// Keep gates and question text in sync with the touch kiosk's steps/application.tsx.
export const chain: ChainSpec = {
  application: async (ctx) => {
    const requirement = ctx.service.documents[0];
    // The engine plans this step before its documents phase, so the document is asked for here —
    // and only one captured since asking counts: an earlier intake's paper is not this one.
    const requestedAt = Number(ctx.data.docRequestedAt) || 0;
    const doc = requestedAt
      ? await documentText({
          serviceId: ctx.service.id,
          documentId: requirement.id,
          documentNumber: ctx.documentNumber,
          since: requestedAt,
        })
      : null;
    if (!doc) {
      ctx.data.docRequestedAt = String(Date.now());
      return ask(undefined, [documentAsk(requirement)]);
    }
    if (doc.status !== "accepted") return READY;

    // A confirmation only counts for the document it was asked about.
    if (ctx.data.docSource !== doc.uploadedAt) {
      ctx.data.docSource = doc.uploadedAt;
      delete ctx.data.docType;
    }
    const guess = doc.text ? await classifyMedicalDocument(doc) : MANUAL_CLASSIFICATION;
    if (!isDocType(ctx.data.docType)) {
      return ask(undefined, [
        {
          id: "docType",
          question: typeQuestion(guess.type),
          type: "options",
          options: typeOptions(guess.type),
        },
      ]);
    }
    Object.assign(ctx.data, intakeData(guess, ctx.data.docType, doc.uploadedAt));
    ctx.notes.push(
      `Your ${docType(ctx.data.docType)?.label.toLowerCase() ?? "document"} will be attached to your medical ` +
        "record for your doctor to review.",
    );
    return READY;
  },
  // "Attach to patient record": the case names the stored copy, so the record holds the document, not just its type.
  file: async ({ data }) => {
    const stored = data.docSource ? await findStoredDocument("records", "medical", data.docSource) : null;
    if (!stored || !data.documentReference) return {};
    const reference = JSON.parse(data.documentReference);
    reference.content = [
      {
        attachment: {
          ...reference.content?.[0]?.attachment,
          url: `uploads/${path.basename(stored)}`,
          title: data.docTypeLabel,
        },
      },
    ];
    return { data: { storedAs: path.basename(stored), documentReference: JSON.stringify(reference) } };
  },
};
