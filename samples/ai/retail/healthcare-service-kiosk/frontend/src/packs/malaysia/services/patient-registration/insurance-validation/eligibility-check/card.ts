// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { PAYERS, payer } from "@/hospital/data";
import {
  displayDay,
  labelledValue,
  localDay,
  matchNames,
  needsStaff,
  readExpiry,
  readIdNumber,
  sameId,
  textLines,
  type CheckStatus,
  type FieldCheck,
} from "@/lib/document-fields";
import { resultData, type ServiceResult } from "@/services/shared/result";
import { glNote, type GlOutcome } from "./eligibility";

/** What an insurance or TPA medical card says, shared by the chain, the touch step and the server reader. */

export type PayerKind = "insurer" | "tpa";

type KnownPayer = {
  id: string;
  name: string;
  kind: PayerKind;
  /** The hospital panel entry (PAYERS) it bills through; null when it is not on the panel. */
  panelId: string | null;
  aliases: RegExp[];
  /** Hotline digits as printed on the card. */
  hotlines: string[];
};

// Hotlines are from public listings and unverified; a wrong one only fails to match.
export const KNOWN_PAYERS: KnownPayer[] = [
  { id: "aia", name: "AIA Malaysia", kind: "insurer", panelId: "aia", aliases: [/\bAIA\b/i], hotlines: ["1300881899"] },
  {
    id: "greateastern",
    name: "Great Eastern",
    kind: "insurer",
    panelId: "greateastern",
    aliases: [/great\s*eastern/i],
    hotlines: ["1300130088"],
  },
  {
    id: "prubsn",
    name: "Prudential BSN Takaful",
    kind: "insurer",
    panelId: "prudential",
    aliases: [/prudential\s*bsn/i, /\bpru\s*bsn\b/i],
    hotlines: [],
  },
  {
    id: "prudential",
    name: "Prudential Assurance Malaysia",
    kind: "insurer",
    panelId: "prudential",
    aliases: [/\bprudential\b(?!\s*bsn)/i],
    hotlines: [],
  },
  { id: "allianz", name: "Allianz Malaysia", kind: "insurer", panelId: "allianz", aliases: [/\ballianz\b/i], hotlines: ["1300225542"] },
  { id: "etiqa", name: "Etiqa", kind: "insurer", panelId: null, aliases: [/\betiqa\b/i], hotlines: ["1300138888"] },
  { id: "zurich", name: "Zurich Malaysia", kind: "insurer", panelId: null, aliases: [/\bzurich\b/i], hotlines: [] },
  { id: "tokiomarine", name: "Tokio Marine", kind: "insurer", panelId: null, aliases: [/tokio\s*marine/i], hotlines: [] },
  { id: "manulife", name: "Manulife", kind: "insurer", panelId: null, aliases: [/\bmanulife\b/i], hotlines: [] },
  { id: "micare", name: "MiCare", kind: "tpa", panelId: null, aliases: [/\bmi\s*care\b/i], hotlines: [] },
  { id: "pmcare", name: "PMCare", kind: "tpa", panelId: null, aliases: [/\bpm\s*care\b/i], hotlines: [] },
  { id: "mediexpress", name: "MediExpress", kind: "tpa", panelId: null, aliases: [/\bmedi\s*express\b/i], hotlines: [] },
  { id: "healthconnect", name: "Health Connect", kind: "tpa", panelId: null, aliases: [/\bhealth\s*connect\b/i], hotlines: [] },
  {
    id: "aan",
    name: "Asia Assistance Network",
    kind: "tpa",
    panelId: null,
    aliases: [/asia\s*assistance\s*network/i, /\bAAN\b/],
    hotlines: [],
  },
  { id: "emas", name: "eMAS", kind: "tpa", panelId: null, aliases: [/\beMAS\b/, /\bE-MAS\b/i], hotlines: [] },
];

export const knownPayer = (id: string | null | undefined) => KNOWN_PAYERS.find((p) => p.id === id);

/** The payer a card names: a TPA wins over the insurer behind it, since the TPA issues the Guarantee Letter. */
export function detectPayer(text: string): KnownPayer | null {
  const lineDigits = textLines(text).map((line) => line.replace(/\D/g, ""));
  const scored = KNOWN_PAYERS.map((p) => ({
    payer: p,
    score:
      (p.aliases.some((alias) => alias.test(text)) ? 2 : 0) +
      (p.hotlines.some((h) => lineDigits.some((digits) => digits.includes(h))) ? 1 : 0),
  })).filter((s) => s.score > 0);
  const tpa = scored.find((s) => s.payer.kind === "tpa" && s.score >= 2);
  return tpa?.payer ?? scored.sort((a, b) => b.score - a.score)[0]?.payer ?? null;
}

export type CardReading = {
  /** A KNOWN_PAYERS id, or a PAYERS id when the patient chose the insurer. */
  payerId: string | null;
  payerName: string | null;
  payerKind: PayerKind | null;
  panelId: string | null;
  payerFrom: "card" | "model" | "patient" | null;
  memberId: string | null;
  policyNo: string | null;
  holderName: string | null;
  nricOnCard: string | null;
  expiry: string | null;
};

export type CardRead = { reading: CardReading; readBy: "model" | "rules" };

export const EMPTY_CARD: CardReading = {
  payerId: null,
  payerName: null,
  payerKind: null,
  panelId: null,
  payerFrom: null,
  memberId: null,
  policyNo: null,
  holderName: null,
  nricOnCard: null,
  expiry: null,
};

export function withPayer(reading: CardReading, p: KnownPayer, from: CardReading["payerFrom"]): CardReading {
  return { ...reading, payerId: p.id, payerName: p.name, payerKind: p.kind, panelId: p.panelId, payerFrom: from };
}

/** The patient named their insurer because the card did not show it. */
export function withChosenPayer(reading: CardReading, payerId: string): CardReading {
  const chosen = payer(payerId);
  if (!chosen) return reading;
  return {
    ...reading,
    payerId: chosen.id,
    payerName: chosen.name,
    payerKind: "insurer",
    panelId: chosen.id,
    payerFrom: "patient",
  };
}

const MEMBER_LABEL =
  /(member(?:ship)?\s*(?:id|no\.?|number)|no\.?\s*ahli|id\s*ahli|card\s*(?:no\.?|number)|no\.?\s*kad|medical\s*card\s*no\.?)/i;
const POLICY_LABEL = /(policy\s*(?:no\.?|number|#)|no\.?\s*polisi|polisi\s*no\.?|certificate\s*no\.?|no\.?\s*sijil|contract\s*no\.?)/i;
const NAME_LABEL = /(member\s*name|insured\s*name|card\s*holder|cardholder|nama\s*ahli|nama|name)\b/i;
const NOT_A_NAME =
  /(card|kad|medical|perubatan|insurans|insurance|takaful|assurance|berhad|\bbhd\b|\bsdn\b|\blife\b|health|member|valid|expir|tamat|policy|polisi|hospital|panel|front|back|depan|belakang|salinan|copy|plan|pelan|hotline|\bcall\b|www|\btpa\b|group|corporate|customer|property)/i;

/** A printed reference number: one token of letters, digits, dashes or slashes with at least one digit. */
export function referenceNumber(value: string | null): string | null {
  if (!value || !/^[A-Z0-9][A-Z0-9\-/ ]{3,29}$/i.test(value) || !/\d/.test(value)) return null;
  return value.replace(/\s+/g, "").toUpperCase();
}

function nameCandidates(text: string): string[] {
  return textLines(text).filter(
    (line) =>
      /^[A-Za-z][A-Za-z.'’@/ -]{2,60}$/.test(line) &&
      line.split(/\s+/).length >= 2 &&
      line.split(/\s+/).length <= 7 &&
      !NOT_A_NAME.test(line) &&
      !KNOWN_PAYERS.some((p) => p.aliases.some((alias) => alias.test(line))),
  );
}

/** The card holder: a labelled name, else the name-like line that is the patient's, else the first one. */
function holderOf(text: string, patientName: string | null): string | null {
  const labelled = labelledValue(text, NAME_LABEL)?.split(/[(\d]/)[0].trim();
  if (labelled && /[a-z]{2}/i.test(labelled)) return labelled;
  const candidates = nameCandidates(text);
  return (
    (patientName ? candidates.find((c) => matchNames(c, patientName) !== "mismatch") : undefined) ??
    candidates[0] ??
    null
  );
}

/** The rule-based reading: the payer from the alias table, fields from their labels. Works with no model at all. */
export function readCardText(text: string, patientName: string | null): CardReading {
  if (!text.trim()) return EMPTY_CARD;
  const detected = detectPayer(text);
  const reading: CardReading = {
    ...EMPTY_CARD,
    memberId: referenceNumber(labelledValue(text, MEMBER_LABEL)),
    policyNo: referenceNumber(labelledValue(text, POLICY_LABEL)),
    holderName: holderOf(text, patientName),
    nricOnCard: readIdNumber(text),
    expiry: readExpiry(text),
  };
  return detected ? withPayer(reading, detected, "card") : reading;
}

export type CardField = "payer" | "memberId" | "policyNo" | "holderName" | "nricOnCard" | "expiry" | "policy";

/** The policy on the hospital's record, to hold the card against. */
export type PolicyOnFile = { payer: string; expiry: string; remainingLimit: number } | null;

const check = (field: CardField, status: CheckStatus, note: string): FieldCheck<CardField> => ({ field, status, note });

function checkPayer(c: CardReading) {
  if (!c.payerName) return check("payer", "ask", "We couldn't tell who issued the card — choose your insurer");
  if (!c.panelId || !PAYERS.some((p) => p.id === c.panelId)) {
    return check("payer", "staff", `${c.payerName} isn't on this hospital's panel list — the counter will check with them`);
  }
  if (c.payerFrom === "model") return check("payer", "warning", "Recognised by AI — the counter will confirm it");
  if (c.payerFrom === "patient") return check("payer", "warning", "Chosen by you — the counter will confirm it on your card");
  return check("payer", "ok", "On this hospital's panel");
}

function checkHolder(read: string | null, patientName: string) {
  if (!read) return check("holderName", "staff", "No name could be read from the card");
  const match = matchNames(read, patientName);
  if (match === "match") return check("holderName", "ok", "Matches your record");
  if (match === "partial") return check("holderName", "warning", "Close to your registered name");
  return check("holderName", "staff", "Not the name on your record");
}

/** The card against the hospital's records: a lapsed policy or a used-up limit there needs the counter. */
function checkOnFile(c: CardReading, onFile: PolicyOnFile, today: Date) {
  if (!c.panelId) return [];
  if (!onFile || onFile.payer !== c.panelId) {
    return [check("policy", "warning", "Not on our records yet — the counter adds it when it requests the Guarantee Letter")];
  }
  if (onFile.expiry < localDay(today)) return [check("policy", "staff", `The policy on our records lapsed on ${displayDay(onFile.expiry)}`)];
  if (onFile.remainingLimit <= 0) return [check("policy", "staff", "Our records show this year's limit is used up")];
  return [check("policy", "ok", "On our records and active")];
}

export function checkCard(
  c: CardReading,
  patient: { name: string; nationalId: string },
  today: Date = new Date(),
  onFile: PolicyOnFile = null,
): FieldCheck<CardField>[] {
  return [
    ...checkOnFile(c, onFile, today),
    checkPayer(c),
    c.memberId ? check("memberId", "ok", "Read from the card") : check("memberId", "staff", "The member ID couldn't be read"),
    c.policyNo ? check("policyNo", "ok", "Read from the card") : check("policyNo", "warning", "No policy number on the card"),
    checkHolder(c.holderName, patient.name),
    !c.nricOnCard
      ? check("nricOnCard", "ok", "Not printed on the card")
      : sameId(c.nricOnCard, patient.nationalId)
        ? check("nricOnCard", "ok", "Matches your IC")
        : check("nricOnCard", "staff", "Not your IC number"),
    !c.expiry
      ? check("expiry", "warning", "No expiry date on the card")
      : c.expiry < localDay(today)
        ? check("expiry", "staff", `Expired on ${displayDay(c.expiry)}`)
        : check("expiry", "ok", `Valid until ${displayDay(c.expiry)}`),
  ];
}

export const cardOutcome = (checks: FieldCheck<CardField>[]): GlOutcome =>
  needsStaff(checks) ? "needs_desk" : "ready_for_gl";

// Keep these in step with the touch step (steps/application.tsx).
export const CARD_QUESTION = "Do you have your insurance card with you?";
export const CARD_CHOICES = [
  { id: "scan", label: "Yes — scan my card" },
  { id: "manual", label: "No — choose my insurer instead" },
];
export const PAYER_QUESTION = "Which insurance payer would you like to check?";

/** "Display coverage and co-pay": the panel's share, the patient's share and — when the policy is on file — the limit left. */
export function coverageRows(
  panelId: string | null | undefined,
  onFile: PolicyOnFile,
  money: (amount: number) => string,
): { label: string; value: string }[] {
  const panel = panelId ? payer(panelId) : undefined;
  if (!panel) return [];
  const rows = [
    { label: "Coverage", value: `${panel.coveragePercent}% of eligible charges` },
    { label: "Your co-pay", value: `${100 - panel.coveragePercent}% of eligible charges` },
  ];
  if (onFile && onFile.payer === panel.id) rows.push({ label: "Annual limit left", value: money(onFile.remainingLimit) });
  return rows;
}

export function cardResult(
  c: CardReading,
  checks: FieldCheck<CardField>[],
  onFile: PolicyOnFile = null,
  money: (amount: number) => string = String,
): ServiceResult {
  const payerLabel = c.payerName ?? "insurance";
  const outcome = cardOutcome(checks);
  const toCheck = checks.filter((x) => x.status === "staff").map((x) => x.note);
  return {
    title: "Eligibility Check",
    intro:
      outcome === "ready_for_gl"
        ? `Your ${payerLabel} card is ready for a Guarantee Letter request.`
        : `Please see the Billing & Insurance Counter — your ${payerLabel} card needs a staff check.`,
    rows: [
      { label: c.payerKind === "tpa" ? "TPA" : "Insurer", value: c.payerName ?? "—" },
      { label: "Member ID", value: c.memberId ?? "—" },
      { label: "Policy number", value: c.policyNo ?? "—" },
      { label: "Name on card", value: c.holderName ?? "—" },
      { label: "Card valid until", value: c.expiry ? displayDay(c.expiry) : "—" },
      ...coverageRows(c.panelId, onFile, money),
      ...(toCheck.length > 0 ? [{ label: "To check at the counter", value: toCheck.join("; ") }] : []),
    ],
    note: glNote(),
  };
}

/** Flow data for the result step: the values read, every check's verdict and the outcome. */
export function cardData(
  c: CardReading,
  checks: FieldCheck<CardField>[],
  readBy: string,
  onFile: PolicyOnFile = null,
  money: (amount: number) => string = String,
): Record<string, string> {
  return {
    cardChoice: "scan",
    payerId: c.panelId ?? "",
    cardPayer: c.payerName ?? "",
    cardPayerKind: c.payerKind ?? "",
    cardPayerFrom: c.payerFrom ?? "",
    cardMemberId: c.memberId ?? "",
    cardPolicyNo: c.policyNo ?? "",
    cardHolder: c.holderName ?? "",
    cardNric: c.nricOnCard ?? "",
    cardExpiry: c.expiry ?? "",
    cardReadBy: readBy,
    cardChecks: JSON.stringify(checks),
    eligibilityOutcome: cardOutcome(checks),
    ...resultData(cardResult(c, checks, onFile, money)),
  };
}
