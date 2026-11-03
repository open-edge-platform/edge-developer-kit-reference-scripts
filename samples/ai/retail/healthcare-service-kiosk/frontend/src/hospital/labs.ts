// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { LabResult } from "./records";

type Flag = LabResult["flag"];

/** Plain, non-diagnostic wording per analyte: what it measures, and a neutral line for an out-of-range value. */
export const LAB_GLOSSARY: Record<string, { measures: string; high: string; low: string }> = {
  "Fasting Blood Sugar": {
    measures: "the amount of sugar (glucose) in your blood after not eating for at least 8 hours",
    high: "Blood sugar can be higher than usual for many reasons, so your doctor may want to check it again.",
    low: "Blood sugar can be lower than usual for several reasons, such as a long time without food.",
  },
  "Total Cholesterol": {
    measures: "the total amount of cholesterol, a type of fat, carried in your blood",
    high: "Your doctor will look at this together with your other results and your health history.",
    low: "Your doctor will look at this together with your other results.",
  },
  Haemoglobin: {
    measures: "the protein in your red blood cells that carries oxygen around your body",
    high: "Haemoglobin can be higher than usual for several reasons, so your doctor may want to check it again.",
    low: "Haemoglobin can be lower than usual for several reasons, and some people feel more tired than usual.",
  },
};

export const LAB_STATUS: Record<Flag, string> = {
  normal: "within the usual range",
  high: "higher than usual",
  low: "lower than usual",
};

export const LAB_STATUS_LABEL: Record<Flag, string> = {
  normal: "In range",
  high: "Higher than usual",
  low: "Lower than usual",
};

export const DOCTOR_LINE = "Please discuss these results with your doctor.";

/** A result's number, unit and usual range as numbers; a one-sided range ("< 5.2") has no `low`. */
export type LabReading = { amount: number; unit: string; low?: number; high: number };

export function readLab(result: LabResult): LabReading {
  const amount = parseFloat(result.value);
  const unit = result.value.replace(/^[\d.\s]+/, "").trim();
  const upper = result.range.match(/<\s*([\d.]+)/);
  if (upper) return { amount, unit, high: parseFloat(upper[1]) };
  const [low, high] = result.range.split(/[–-]/).map((part) => parseFloat(part));
  return { amount, unit, low, high };
}

export function rangeInWords(result: LabResult): string {
  const { unit, low, high } = readLab(result);
  const [lowText, highText] = result.range.match(/[\d.]+/g) ?? [];
  if (low === undefined) return `below ${lowText ?? high} ${unit}`.trim();
  return `${lowText} to ${highText} ${unit}`.trim();
}

export function labCounts(results: LabResult[]) {
  const inRange = results.filter((r) => r.flag === "normal").length;
  return { total: results.length, inRange, outside: results.length - inRange };
}

/** "Your fasting blood sugar is 6.8 mmol/L. The usual range is 3.9 to 6.0 mmol/L, so this is higher than usual." */
export function labSentence(result: LabResult): string {
  const note = result.flag === "normal" ? "" : (LAB_GLOSSARY[result.test]?.[result.flag] ?? "");
  return [
    `Your ${result.test.toLowerCase()} is ${result.value}.`,
    `The usual range is ${rangeInWords(result)}, so this is ${LAB_STATUS[result.flag]}.`,
    note,
  ]
    .filter(Boolean)
    .join(" ");
}

export function labOverview(results: LabResult[]): string {
  const { total, inRange } = labCounts(results);
  if (inRange === total) return `All ${total} of your results are within the usual range.`;
  return `${inRange} of your ${total} results ${inRange === 1 ? "is" : "are"} within the usual range.`;
}

export type LabExplanation = {
  items: { test: string; text: string }[];
  /** Ends with DOCTOR_LINE, whoever wrote the rest. */
  closing: string;
  aiAssisted: boolean;
};

export function templateExplanation(results: LabResult[]): LabExplanation {
  return {
    items: results.map((r) => ({ test: r.test, text: labSentence(r) })),
    closing: `${labOverview(results)} ${DOCTOR_LINE}`,
    aiAssisted: false,
  };
}
