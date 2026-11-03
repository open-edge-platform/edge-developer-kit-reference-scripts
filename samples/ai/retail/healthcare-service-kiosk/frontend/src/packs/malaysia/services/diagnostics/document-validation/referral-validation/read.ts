// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { z } from "zod";
import { readOnce, type DocumentReader, type DocumentText } from "@/app/api/_lib/document-text";
import { completeJson, grounded } from "@/app/api/_lib/llm-json";
import { DEPARTMENTS } from "@/hospital/data";
import { findDates, isIdNumber } from "@/lib/document-fields";
import {
  DATE_AVOID,
  DEPARTMENT_ALIASES,
  readReferralText,
  type ReferralRead,
  type ReferralReading,
} from "./referral";

// SERVER-ONLY: model extraction for the referral letter; the touch step reaches it via /api/document-ai.

const MAX_TEXT_CHARS = 6_000;

const text = z
  .union([z.string(), z.number()])
  .nullable()
  .transform((value) => (value === null ? null : String(value).trim() || null));

const schema = z.object({
  patientName: text,
  patientIc: text,
  referringDoctor: text,
  mmcNumber: text,
  clinicName: text,
  referralDate: text,
  department: z.enum(["other", ...DEPARTMENTS.map((d) => d.id)]).nullable(),
  reason: text,
  referrerType: z.enum(["government", "private", "unknown"]),
});

const SYSTEM =
  "You read Malaysian medical referral letters, in English or Bahasa Malaysia, from OCR text. " +
  "Reply with one JSON object and nothing else. Copy names, numbers and the clinic exactly as printed. " +
  "Use null for anything the letter does not print — never guess.";

function prompt(ocr: string): string {
  return [
    "Return this JSON object:",
    '{"patientName": string|null, "patientIc": string|null, "referringDoctor": string|null, "mmcNumber": string|null, ' +
      '"clinicName": string|null, "referralDate": "YYYY-MM-DD"|null, "department": id|null, "reason": string|null, ' +
      '"referrerType": "government"|"private"|"unknown"}',
    "- patientIc: the patient's IC (MyKad) number as printed.",
    "- referringDoctor: the doctor who wrote the letter, never the patient.",
    "- mmcNumber: that doctor's MMC registration number, digits only.",
    "- clinicName: the clinic or hospital on the letterhead, not the one the letter is addressed to.",
    "- referralDate: the date the letter was written, never a date of birth.",
    "- department: the specialist department the letter is addressed to, one of these ids:",
    ...DEPARTMENTS.map((d) => `  ${d.id} (${d.name})`),
    "  other (a department not listed)",
    "- referrerType: government for a Klinik Kesihatan or government hospital, private for a private clinic.",
    "",
    "OCR text:",
    '"""',
    ocr.slice(0, MAX_TEXT_CHARS),
    '"""',
  ].join("\n");
}

function department(
  model: string | null,
  rules: ReferralReading,
  ocr: string,
): Pick<ReferralReading, "department" | "departmentCue"> {
  if (rules.departmentCue === "named" || !model || model === "other") {
    return { department: rules.department, departmentCue: rules.departmentCue };
  }
  return { department: model, departmentCue: DEPARTMENT_ALIASES[model]?.test(ocr) ? "mentioned" : "inferred" };
}

/** Model reading kept only where it is grounded in the OCR text; every other field falls back to the rules. */
export function readReferral(doc: DocumentText): Promise<ReferralRead> {
  return readOnce(doc, "referral", async () => {
    const rules = readReferralText(doc.text);
    const model = doc.text ? await completeJson(SYSTEM, prompt(doc.text), schema, { thinking: false }) : null;
    if (!model) return { reading: rules, readBy: "rules" };
    const ocr = doc.text;
    const dates = new Set(findDates(ocr).filter((d) => !DATE_AVOID.test(d.context)).map((d) => d.iso));
    const ic = grounded(model.patientIc, ocr);
    const mmc = model.mmcNumber?.replace(/\D/g, "") || null;
    const reading: ReferralReading = {
      patientName: grounded(model.patientName, ocr) ?? rules.patientName,
      patientIc: ic && isIdNumber(ic) ? ic.toUpperCase() : rules.patientIc,
      referringDoctor: grounded(model.referringDoctor, ocr) ?? rules.referringDoctor,
      mmcNumber: grounded(mmc, ocr) ?? rules.mmcNumber,
      clinicName: grounded(model.clinicName, ocr) ?? rules.clinicName,
      referralDate: model.referralDate && dates.has(model.referralDate) ? model.referralDate : rules.referralDate,
      dateFrom: "letter",
      ...department(model.department, rules, ocr),
      reason: grounded(model.reason, ocr) ?? rules.reason,
      referrerType: rules.referrerType !== "unknown" ? rules.referrerType : model.referrerType,
    };
    return { reading, readBy: "model" };
  });
}

/** This service's document readers, by requirement id — see src/packs/index.server.ts. */
export const readers: Record<string, DocumentReader> = {
  referral: (doc) => readReferral(doc),
};
