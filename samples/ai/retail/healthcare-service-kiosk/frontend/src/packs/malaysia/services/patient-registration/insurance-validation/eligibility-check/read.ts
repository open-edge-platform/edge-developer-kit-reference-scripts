// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { z } from "zod";
import { readOnce, type DocumentPatient, type DocumentReader, type DocumentText } from "@/app/api/_lib/document-text";
import { completeJson, grounded } from "@/app/api/_lib/llm-json";
import { findDates, isIdNumber, isIsoDay } from "@/lib/document-fields";
import { KNOWN_PAYERS, knownPayer, readCardText, referenceNumber, withPayer, type CardRead } from "./card";

// SERVER-ONLY: the alias table and labels read the card first; the model only fills what they missed.

const MAX_TEXT_CHARS = 4_000;

const text = z
  .union([z.string(), z.number()])
  .nullable()
  .transform((value) => (value === null ? null : String(value).trim() || null));

const schema = z.object({
  payer: z.enum(["other", ...KNOWN_PAYERS.map((p) => p.id)]).nullable(),
  memberId: text,
  policyNo: text,
  holderName: text,
  nricOnCard: text,
  expiry: text,
});

const SYSTEM =
  "You read Malaysian medical insurance and TPA cards from OCR text. Reply with one JSON object and nothing else. " +
  "Copy numbers and names exactly as printed; use null for anything the card does not print — never guess.";

function prompt(ocr: string): string {
  return [
    'Return {"payer": id|null, "memberId": string|null, "policyNo": string|null, "holderName": string|null, ' +
      '"nricOnCard": string|null, "expiry": "YYYY-MM-DD"|null}.',
    "- payer: who issued the card, one of these ids:",
    ...KNOWN_PAYERS.map((p) => `  ${p.id} (${p.name})`),
    "  other (any other insurer or TPA)",
    "- holderName: the insured person printed on the card.",
    "- nricOnCard: their IC (NRIC) number, if printed.",
    "- expiry: the card's expiry; for MM/YY use the last day of that month.",
    "",
    "OCR text:",
    '"""',
    ocr.slice(0, MAX_TEXT_CHARS),
    '"""',
  ].join("\n");
}

/** A month and year printed as MM/YY or MM/YYYY. */
const MONTH_YEAR = /(?<![\d/])0?(\d{1,2})\s*\/\s*(\d{4}|\d{2})(?![\d/])/g;

/** A model's expiry counts only if the card prints that day, or that month as MM/YY. */
function groundedExpiry(iso: string | null, ocr: string): string | null {
  if (!isIsoDay(iso)) return null;
  if (findDates(ocr).some((d) => d.iso === iso)) return iso;
  const [year = "", month = ""] = iso.split("-");
  const printed = [...ocr.matchAll(MONTH_YEAR)].some(
    ([, m, y]) => Number(m) === Number(month) && (y === year || y === year.slice(2)),
  );
  return printed ? iso : null;
}

export function readInsuranceCard(doc: DocumentText, patient: DocumentPatient | null): Promise<CardRead> {
  return readOnce(doc, "insurance-card", async () => {
    const ocr = doc.text;
    const rules = readCardText(ocr, patient?.name ?? null);
    if (!ocr || (rules.payerId && rules.memberId && rules.holderName && rules.expiry)) {
      return { reading: rules, readBy: "rules" };
    }
    const model = await completeJson(SYSTEM, prompt(ocr), schema, { thinking: false });
    if (!model) return { reading: rules, readBy: "rules" };
    const ic = grounded(model.nricOnCard, ocr);
    const filled = {
      ...rules,
      memberId: rules.memberId ?? referenceNumber(grounded(model.memberId, ocr)),
      policyNo: rules.policyNo ?? referenceNumber(grounded(model.policyNo, ocr)),
      holderName: rules.holderName ?? grounded(model.holderName, ocr),
      nricOnCard: rules.nricOnCard ?? (ic && isIdNumber(ic) ? ic.toUpperCase() : null),
      expiry: rules.expiry ?? groundedExpiry(model.expiry, ocr),
    };
    const modelPayer = knownPayer(model.payer);
    return {
      reading: !filled.payerId && modelPayer ? withPayer(filled, modelPayer, "model") : filled,
      readBy: "model",
    };
  });
}

/** This service's document readers, by requirement id — see src/packs/index.server.ts. */
export const readers: Record<string, DocumentReader> = {
  "insurance-card": (doc, patient) => readInsuranceCard(doc, patient),
};
