// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { z } from "zod";
import { readOnce, type DocumentReader, type DocumentText } from "@/app/api/_lib/document-text";
import { completeJson, grounded } from "@/app/api/_lib/llm-json";
import { findDates } from "@/lib/document-fields";
import {
  DOC_DATE_AVOID,
  DOC_TYPES,
  DOC_TYPE_IDS,
  classifyByKeywords,
  needsModel,
  scoreDocument,
  type Classification,
} from "./doctypes";

// SERVER-ONLY: keyword classification, with the model asked only when the keywords are too close to call.

const MAX_TEXT_CHARS = 6_000;

const text = z
  .union([z.string(), z.number()])
  .nullable()
  .transform((value) => (value === null ? null : String(value).trim() || null));

const schema = z.object({
  type: z.enum(DOC_TYPE_IDS),
  confidence: z.coerce.number().min(0).max(1),
  docDate: text,
  issuer: text,
});

const SYSTEM =
  "You sort medical paperwork brought to a Malaysian hospital, in English or Bahasa Malaysia, by its OCR text. " +
  "Reply with one JSON object and nothing else. Copy the issuer exactly as printed; use null when it is not printed.";

function prompt(ocr: string): string {
  return [
    'Return {"type": id, "confidence": number from 0 to 1, "docDate": "YYYY-MM-DD"|null, "issuer": string|null}.',
    "- type: one of these ids:",
    ...DOC_TYPES.map((t) => `  ${t.id} (${t.label})`),
    "- docDate: the date the document was issued or reported, never a date of birth.",
    "- issuer: the hospital, clinic, laboratory or insurer that issued it.",
    "",
    "OCR text:",
    '"""',
    ocr.slice(0, MAX_TEXT_CHARS),
    '"""',
  ].join("\n");
}

export function classifyMedicalDocument(doc: DocumentText): Promise<Classification> {
  return readOnce(doc, "classify", async () => {
    const keywords = classifyByKeywords(doc.text);
    if (!needsModel(scoreDocument(doc.text))) return keywords;
    const model = await completeJson(SYSTEM, prompt(doc.text), schema, { thinking: false });
    if (!model || (model.type === "other" && keywords.type !== "other")) return keywords;
    const dates = new Set(findDates(doc.text).filter((d) => !DOC_DATE_AVOID.test(d.context)).map((d) => d.iso));
    return {
      type: model.type,
      confidence: Math.round(model.confidence * 100) / 100,
      method: "model",
      docDate: model.docDate && dates.has(model.docDate) ? model.docDate : keywords.docDate,
      issuer: grounded(model.issuer, doc.text) ?? keywords.issuer,
    };
  });
}

/** This service's document readers, by requirement id — see src/packs/index.server.ts. */
export const readers: Record<string, DocumentReader> = {
  medical: (doc) => classifyMedicalDocument(doc),
};
