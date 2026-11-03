// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { z } from "zod";
import {
  DOCTOR_LINE,
  LAB_GLOSSARY,
  LAB_STATUS,
  labCounts,
  rangeInWords,
  readLab,
  templateExplanation,
  type LabExplanation,
} from "@/hospital/labs";
import { patientRecord, type LabResult } from "@/hospital/records";
import { completeJson, normalizeText, numbersIn, onlyKnownNumbers, withinDeadline, wordCount } from "./llm-json";

const SYSTEM =
  "You rewrite lab result facts in plain words for a patient at a hospital kiosk. You never diagnose, never name " +
  "an illness, never suggest causes, medicines, doses, diets or other advice, and never reassure. Reply with one " +
  "JSON object and nothing else.";

const RephraseSchema = z.object({
  items: z.array(z.object({ test: z.string(), phrase: z.string() })),
  closing: z.string(),
});

const DISEASES = [
  "diabetes", "diabetic", "prediabetes", "pre-diabetes", "anaemia", "anemia", "anaemic", "anemic", "hypoglycaemia",
  "hypoglycemia", "hyperglycaemia", "hyperglycemia", "cholesterolaemia", "cholesterolemia", "hyperlipidaemia",
  "hyperlipidemia", "dyslipidaemia", "dyslipidemia", "heart disease", "heart attack", "stroke", "cancer", "leukaemia",
  "leukemia", "thalassaemia", "thalassemia", "polycythaemia", "polycythemia", "kidney", "liver", "infection",
  "disease", "disorder", "syndrome", "illness",
];

const UNSAFE: RegExp[] = [
  /diagnos/i,
  /\byou (?:definitely |probably |likely |may |might |could )?have\b/i,
  /worry|nothing serious|not serious|good news|perfect|healthy/i,
  /\b(?:medicine|medication|tablet|pill|insulin|statin|supplement|dose|dosage|prescri|treatment)/i,
  /\b(?:you should|you must|you need to|avoid|cut down|eat less|eat more|diet|exercise)\b/i,
];

function facts(results: LabResult[]): string {
  const { total, inRange, outside } = labCounts(results);
  return [
    ...results.map((r) => {
      const glossary = LAB_GLOSSARY[r.test];
      return [
        `- ${r.test}: value ${r.value}; usual range ${rangeInWords(r)}; status "${LAB_STATUS[r.flag]}".`,
        glossary ? ` It measures ${glossary.measures}.` : "",
        glossary && r.flag !== "normal" ? ` Note: ${glossary[r.flag]}` : "",
      ].join("");
    }),
    `- Overall: ${total} tests; ${inRange} within the usual range; ${outside} outside it.`,
  ].join("\n");
}

function prompt(results: LabResult[]): string {
  return [
    "Facts:",
    facts(results),
    "",
    "For each test, write one or two short sentences a 12-year-old could read, using only these facts.",
    'Keep every number and unit exactly as written, and use the exact status words given ("higher than usual",',
    '"lower than usual" or "within the usual range"). Do not add any other number, illness, cause or advice.',
    'Then write "closing": one short sentence saying how many results are within the usual range.',
    "Keep the whole reply under 120 words.",
    'Return exactly: {"items": [{"test": "<test name as given>", "phrase": "..."}], "closing": "..."}',
  ].join("\n");
}

/** The model's rewording, or null unless it covers every test once, keeps each value and status, and adds nothing. */
function checked(reply: z.infer<typeof RephraseSchema>, results: LabResult[], source: string): LabExplanation | null {
  if (reply.items.length !== results.length) return null;
  const phrases = results.map(
    (r) => reply.items.find((item) => normalizeText(item.test) === normalizeText(r.test))?.phrase.trim() ?? "",
  );
  const closing = reply.closing.trim();
  const text = [...phrases, closing].join(" ");
  const words = normalizeText(text);
  const glossary = normalizeText(source);
  // Both bodies are normalizeText output, so a word starts at the beginning or after a space.
  const mentions = (body: string, term: string) => ` ${body}`.includes(` ${normalizeText(term)}`);
  const ok =
    results.every((r, i) => {
      const phrase = phrases[i].toLowerCase();
      return phrase.includes(LAB_STATUS[r.flag]) && numbersIn(phrase).includes(readLab(r).amount);
    }) &&
    onlyKnownNumbers(text, source) &&
    wordCount(text) <= 120 &&
    !UNSAFE.some((pattern) => pattern.test(text)) &&
    !DISEASES.some((d) => mentions(words, d) && !mentions(glossary, d));
  if (!ok) return null;
  return {
    items: results.map((r, i) => ({ test: r.test, text: phrases[i] })),
    closing: [closing, DOCTOR_LINE].filter(Boolean).join(" "),
    aiAssisted: true,
  };
}

/** Results are re-derived from the patient record here; only the record's own facts are ever sent to the model. */
export async function explainLabResults(documentNumber: string): Promise<LabExplanation | null> {
  const labs = patientRecord(documentNumber).labResults;
  if (!labs) return null;
  const { results } = labs;
  const source = facts(results);
  const reply = await withinDeadline(completeJson(SYSTEM, prompt(results), RephraseSchema));
  return (reply && checked(reply, results, source)) ?? templateExplanation(results);
}
