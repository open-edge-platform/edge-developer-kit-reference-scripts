// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { SPECIALIST_DEPARTMENTS, department } from "@/hospital/data";
import {
  displayDay,
  findDates,
  isIsoDay,
  labelledValue,
  letterhead,
  matchNames,
  needsStaff,
  parseChecks,
  pickDate,
  readIdNumber,
  sameId,
  textLines,
  type CheckStatus,
  type FieldCheck,
} from "@/lib/document-fields";
import { REFERRAL_VALID_MONTHS, validateReferral } from "./validate";

/** What a referral letter says, shared by the chain, the touch review and the server reader. */

export type ReferrerType = "government" | "private" | "unknown";

/** "named": the letter is addressed to it; "mentioned"/"inferred": a weaker hint the patient confirms. */
export type DepartmentCue = "named" | "mentioned" | "inferred" | "patient";

export type ReferralReading = {
  patientName: string | null;
  patientIc: string | null;
  referringDoctor: string | null;
  mmcNumber: string | null;
  clinicName: string | null;
  referralDate: string | null;
  dateFrom: "letter" | "patient";
  /** A DEPARTMENTS id, or "other" when the patient says the clinic is not listed. */
  department: string | null;
  departmentCue: DepartmentCue | null;
  reason: string | null;
  referrerType: ReferrerType;
};

export type ReadBy = "model" | "rules" | "manual";

export type ReferralRead = { reading: ReferralReading; readBy: ReadBy };

export type ReferralField =
  | "patientName"
  | "patientIc"
  | "referringDoctor"
  | "mmcNumber"
  | "clinicName"
  | "referralDate"
  | "department";

export type Patient = { name: string; nationalId: string };

export const EMPTY_REFERRAL: ReferralReading = {
  patientName: null,
  patientIc: null,
  referringDoctor: null,
  mmcNumber: null,
  clinicName: null,
  referralDate: null,
  dateFrom: "letter",
  department: null,
  departmentCue: null,
  reason: null,
  referrerType: "unknown",
};

// Keep these questions in step with the touch review (steps/application.tsx).
export const DEPARTMENT_QUESTION = "Which specialist department is the referral for?";
export const DATE_QUESTION = "What date is printed on the referral letter?";
export const NOT_LISTED = "other";

export const DEPARTMENT_OPTIONS = [
  ...SPECIALIST_DEPARTMENTS.map((id) => ({ id, label: department(id)?.name ?? id })),
  { id: NOT_LISTED, label: "Not listed — staff will help" },
];

export const DEPARTMENT_ALIASES: Record<string, RegExp> = {
  cardiology: /\b(cardiology|cardiologist|cardiac|kardiologi|jantung)\b/i,
  orthopaedics: /\b(orthopa?edics?|ortopedik|ortopedi)\b/i,
  paediatrics: /\b(pa?ediatrics?|pa?ediatrik|pa?ediatrician|kanak-kanak)\b/i,
  obgyn: /\b(obstetrics?|obstetrik|gyna?ecology|ginekologi|o\s*&\s*g|obgyn|ob\s*\/\s*gyn|sakit\s+puan)\b/i,
  dermatology: /\b(dermatology|dermatologist|dermatologi|kulit)\b/i,
  radiology: /\b(radiology|radiologi|radiologist)\b/i,
  laboratory: /\b(laboratory|makmal|patologi|pathology)\b/i,
  pharmacy: /\b(pharmacy|farmasi)\b/i,
  emergency: /\b(emergency|kecemasan|a\s*&\s*e)\b/i,
};

const ADDRESSED =
  /(kepada|^to\b|\bto\s*[:/]|dear|jabatan|department|klinik\s+pakar|specialist|pakar|\bunit\b|attn|attention|refer(?:red)?\s+to|rujuk(?:an)?\s+ke|untuk\s+perhatian)/i;

function earliestAlias(row: string, ids: string[]): string | null {
  let best: { id: string; at: number } | null = null;
  for (const id of ids) {
    const hit = DEPARTMENT_ALIASES[id]?.exec(row);
    if (hit && (!best || hit.index < best.at)) best = { id, at: hit.index };
  }
  return best?.id ?? null;
}

/** The department a letter is addressed to, else a specialty it mentions anywhere. */
export function findDepartment(text: string): { id: string; cue: "named" | "mentioned" } | null {
  const all = Object.keys(DEPARTMENT_ALIASES);
  for (const row of textLines(text).filter((line) => ADDRESSED.test(line))) {
    const id = earliestAlias(row, all);
    if (id) return { id, cue: "named" };
  }
  const id = earliestAlias(text, SPECIALIST_DEPARTMENTS);
  return id ? { id, cue: "mentioned" } : null;
}

const INSTITUTION =
  /\b(klinik|clinic|poliklinik|polyclinic|hospital|medical\s+cent(?:re|er)|pusat\s+(?:perubatan|kesihatan|pakar)|specialist\s+cent(?:re|er)|health\s+cent(?:re|er)|dispensary)\b/i;
const GOVERNMENT =
  /(klinik\s+kesihatan|klinik\s+desa|kementerian\s+kesihatan|ministry\s+of\s+health|\bkkm\b|\bmoh\b|jabatan\s+kesihatan|pejabat\s+kesihatan|hospital\s+(?:besar|daerah|umum)|kerajaan|government)/i;
const PRIVATE =
  /(sdn\.?\s*bhd|berhad|poliklinik|polyclinic|medical\s+cent(?:re|er)|specialist\s+(?:cent(?:re|er)|hospital)|pusat\s+pakar|swasta|private|\bklinik\b|\bclinic\b|dispensary)/i;

export function referrerTypeOf(letterheadText: string): ReferrerType {
  if (GOVERNMENT.test(letterheadText)) return "government";
  return PRIVATE.test(letterheadText) ? "private" : "unknown";
}

/** Dates on these lines are never the letter's own date. */
export const DATE_AVOID = /(lahir|birth|dob|admission|masuk|appointment|temujanji|sampel|sample|expiry|tamat)/i;

const PATIENT_LABEL = /(nama\s+pesakit|patient(?:'s)?\s+name|name\s+of\s+patient|\b(?:re|perkara|patient|pesakit)\s*:)/i;
const DOCTOR_LABEL =
  /(doktor\s+(?:yang\s+)?merujuk|referring\s+(?:doctor|physician|practitioner|medical\s+officer)|referred\s+by|dirujuk\s+oleh|nama\s+doktor|doctor'?s\s+name)/i;
const DOCTOR_NAME = /\bD[Rr]\.?\s+[A-Z][A-Za-z'’.@/-]*(?: [A-Z][A-Za-z'’.@/-]*){0,5}/g;
const MMC = /\b(?:MMC|MPM)\s*(?:reg(?:istration)?\.?\s*)?(?:no\.?|number|#)?\s*[:.]?\s*(\d+)/i;
const REASON_LABEL =
  /(sebab\s+rujukan|reason\s+for\s+referral|provisional\s+diagnosis|diagnosis|diagnosa|clinical\s+(?:summary|history|notes)|reason)/i;
const REASON_STOP =
  /(doktor|doctor|\bdr\.?\s|tarikh|\bdate\b|mmc|tandatangan|signature|yang\s+benar|sincerely|thank\s+you|terima\s+kasih|ini\s+adalah|\bcop\b|stamp)/i;

function nameOnly(value: string | null): string | null {
  const name = value?.split(/[(\d]/)[0].replace(/[,;:]+$/, "").trim();
  return name && /[a-z]{2}/i.test(name) ? name : null;
}

function doctorOnly(value: string | null): string | null {
  const name = value?.split(/\(|\bMMC\b|\bMPM\b|,/i)[0].trim();
  return name && /[a-z]{2}/i.test(name) ? name : null;
}

function readReason(text: string): string | null {
  const rows = textLines(text);
  const at = rows.findIndex((row) => REASON_LABEL.test(row));
  if (at === -1) return null;
  const labels = [...rows[at].matchAll(new RegExp(REASON_LABEL.source, "gi"))].at(-1)!;
  const parts = [rows[at].slice(labels.index! + labels[0].length).replace(/^[\s:/.\-–]+/, "")];
  for (const row of rows.slice(at + 1, at + 4)) {
    if (!row || REASON_STOP.test(row)) break;
    parts.push(row);
  }
  const reason = parts.join(" ").replace(/\s+/g, " ").trim();
  return reason ? reason.slice(0, 240) : null;
}

/** The rule-based reading: labelled values, letterhead and keyword cues. Works with no model at all. */
export function readReferralText(text: string): ReferralReading {
  if (!text.trim()) return EMPTY_REFERRAL;
  const doctors = [...text.matchAll(DOCTOR_NAME)].map((m) => m[0].trim());
  const mmc = MMC.exec(text)?.[1] ?? null;
  const head = textLines(text)
    .filter(Boolean)
    .slice(0, 4)
    .filter((line) => !/^(kepada|to)\b/i.test(line));
  const clinicName = letterhead(head.join("\n"), INSTITUTION);
  const found = findDepartment(text);
  return {
    patientName: nameOnly(labelledValue(text, PATIENT_LABEL)),
    patientIc: readIdNumber(text),
    referringDoctor: doctorOnly(labelledValue(text, DOCTOR_LABEL)) ?? doctors.at(-1) ?? null,
    mmcNumber: mmc,
    clinicName,
    referralDate: pickDate(
      text,
      [/(tarikh\s+surat|date\s+of\s+(?:letter|referral)|referral\s+date|tarikh\s+rujukan)/i, /(tarikh|date|dated|bertarikh)/i],
      DATE_AVOID,
    ),
    dateFrom: "letter",
    department: found?.id ?? null,
    departmentCue: found?.cue ?? null,
    reason: readReason(text),
    referrerType: referrerTypeOf(clinicName ?? head.join(" ")),
  };
}

const check = (field: ReferralField, status: CheckStatus, note: string): FieldCheck<ReferralField> => ({
  field,
  status,
  note,
});

function checkName(read: string | null, patient: Patient) {
  if (!read) return check("patientName", "warning", "Couldn't read the patient's name");
  const match = matchNames(read, patient.name);
  if (match === "match") return check("patientName", "ok", "Matches your record");
  if (match === "partial") return check("patientName", "warning", "Close to your registered name");
  return check("patientName", "staff", "Not the name on your record");
}

function checkDate(r: ReferralReading, today: Date) {
  if (!r.referralDate) return check("referralDate", "ask", "We couldn't read the date — please enter it");
  switch (validateReferral(r.referralDate, today)) {
    case "invalid":
      return check("referralDate", "ask", "Enter the date as YYYY-MM-DD");
    case "future":
      return r.dateFrom === "patient"
        ? check("referralDate", "staff", "Dated in the future — staff will check it")
        : check("referralDate", "ask", "This date is in the future — please check it");
    case "stale":
      return check("referralDate", "staff", `Over ${REFERRAL_VALID_MONTHS} months old — staff will confirm it still stands`);
    case "ok":
      return check("referralDate", "ok", `Within ${REFERRAL_VALID_MONTHS} months`);
  }
}

function checkDepartment(r: ReferralReading) {
  if (r.department === NOT_LISTED) return check("department", "staff", "Clinic not listed — staff will route your referral");
  const known = r.department ? department(r.department) : undefined;
  if (!known) return check("department", "ask", "Choose the clinic you're referred to");
  if (!SPECIALIST_DEPARTMENTS.includes(known.id)) {
    return check("department", "ask", `${known.name} isn't a specialist clinic — choose one`);
  }
  if (r.departmentCue === "mentioned" || r.departmentCue === "inferred") {
    return check("department", "warning", "Suggested from your letter — change it if it's wrong");
  }
  return check("department", "ok", r.departmentCue === "patient" ? "Chosen by you" : "Named on the letter");
}

/** Deterministic checks on a reading; the model never has the last word on any of them. */
export function checkReferral(r: ReferralReading, patient: Patient, today: Date = new Date()): FieldCheck<ReferralField>[] {
  return [
    checkName(r.patientName, patient),
    !r.patientIc
      ? check("patientIc", "ok", "Not printed on the letter")
      : sameId(r.patientIc, patient.nationalId)
        ? check("patientIc", "ok", "Matches your IC")
        : check("patientIc", "staff", "Not your IC number"),
    r.referringDoctor
      ? check("referringDoctor", "ok", "Referring doctor named")
      : check("referringDoctor", "staff", "No referring doctor found"),
    !r.mmcNumber
      ? check("mmcNumber", "warning", "No MMC number — private doctors may leave it off; staff will confirm")
      : /^\d{3,6}$/.test(r.mmcNumber)
        ? check("mmcNumber", "ok", "Registration number printed")
        : check("mmcNumber", "warning", "Unusual MMC number — staff will confirm"),
    r.clinicName ? check("clinicName", "ok", "Letterhead found") : check("clinicName", "warning", "Clinic not identified"),
    checkDate(r, today),
    checkDepartment(r),
  ];
}

/** A date as the patient typed it, in any printed form, as YYYY-MM-DD when it can be read. */
export function typedDate(value: string): string {
  const trimmed = value.trim();
  return isIsoDay(trimmed) ? trimmed : (findDates(trimmed)[0]?.iso ?? trimmed);
}

export function checkFor(checks: FieldCheck<ReferralField>[], field: ReferralField): FieldCheck<ReferralField> {
  return checks.find((c) => c.field === field) ?? check(field, "ok", "");
}

/** Flow data for the filed case: the values read, where they came from, and every check's verdict. */
export function referralData(
  r: ReferralReading,
  checks: FieldCheck<ReferralField>[],
  readBy: ReadBy,
  source: string,
): Record<string, string> {
  return {
    referralDepartment: r.department ?? "",
    referralDepartmentCue: r.departmentCue ?? "",
    referralDate: r.referralDate ?? "",
    referralDateFrom: r.dateFrom,
    referralPatientName: r.patientName ?? "",
    referralPatientIc: r.patientIc ?? "",
    referringDoctor: r.referringDoctor ?? "",
    referringMmc: r.mmcNumber ?? "",
    referringClinic: r.clinicName ?? "",
    referrerType: r.referrerType,
    referralReason: r.reason ?? "",
    referralReadBy: readBy,
    referralSource: source,
    referralChecks: JSON.stringify(checks),
    referralReview: needsStaff(checks) ? "staff" : "ok",
  };
}

export function readingFromData(data: Record<string, string>): ReferralReading {
  const text = (key: string) => data[key]?.trim() || null;
  return {
    patientName: text("referralPatientName"),
    patientIc: text("referralPatientIc"),
    referringDoctor: text("referringDoctor"),
    mmcNumber: text("referringMmc"),
    clinicName: text("referringClinic"),
    referralDate: text("referralDate"),
    dateFrom: data.referralDateFrom === "patient" ? "patient" : "letter",
    department: text("referralDepartment"),
    departmentCue: (text("referralDepartmentCue") as DepartmentCue | null) ?? null,
    reason: text("referralReason"),
    referrerType: (text("referrerType") as ReferrerType | null) ?? "unknown",
  };
}

/** Why a filed referral goes to staff, re-derived from its data so a tampered flag cannot clear it. */
export function referralEscalation(data: Record<string, string>): string | null {
  const reasons = new Set(
    parseChecks<ReferralField>(data.referralChecks)
      .filter((c) => c.status === "staff")
      .map((c) => c.note),
  );
  const date = validateReferral(data.referralDate ?? "");
  if (date === "stale") reasons.add(`Over ${REFERRAL_VALID_MONTHS} months old — staff will confirm it still stands`);
  if (date === "future") reasons.add("Dated in the future — staff will check it");
  if (date === "invalid") reasons.add("No readable referral date");
  if (!SPECIALIST_DEPARTMENTS.includes(data.referralDepartment ?? "")) {
    reasons.add("Clinic not listed — staff will route your referral");
  }
  // "Verify physician details": a letter whose doctor can't be checked against the MMC register goes to staff, as its note promises.
  const mmc = data.referringMmc?.trim() ?? "";
  if (!mmc) reasons.add("No MMC number for the referring doctor — staff will confirm their registration");
  else if (!/^\d{3,6}$/.test(mmc)) reasons.add("Unusual MMC number — staff will confirm the referring doctor's registration");
  return reasons.size > 0 ? `Referral needs staff review: ${[...reasons].join("; ")}.` : null;
}

export const REFERRER_LABEL: Record<ReferrerType, string> = {
  government: "Government clinic",
  private: "Private clinic",
  unknown: "",
};

/** One sentence reading the letter back, for the assistant. */
export function readBack(r: ReferralReading): string {
  const doctor = r.referringDoctor ? `${r.referringDoctor}${r.mmcNumber ? ` (MMC ${r.mmcNumber})` : ""}` : null;
  const parts = [
    doctor && `from ${doctor}`,
    r.clinicName && `at ${r.clinicName}`,
    r.referralDate && `dated ${displayDay(r.referralDate)}`,
    r.department && r.departmentCue === "named" && `for ${department(r.department)?.name ?? r.department}`,
  ].filter(Boolean);
  return parts.length > 0
    ? `I read your referral letter: ${parts.join(", ")}.`
    : "I couldn't read the details on your referral letter.";
}
