// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/** Deterministic readers for OCR text, shared by the touch steps, the chains and the server readers. */

/** How one value read off a document fared: "ask" waits on the patient, "staff" files the case for review. */
export type CheckStatus = "ok" | "warning" | "staff" | "ask";

export type FieldCheck<F extends string = string> = { field: F; status: CheckStatus; note: string };

export const needsStaff = (checks: FieldCheck[]) => checks.some((c) => c.status === "staff");
export const awaitingPatient = (checks: FieldCheck[]) => checks.some((c) => c.status === "ask");

export function parseChecks<F extends string>(json: string | undefined): FieldCheck<F>[] {
  try {
    const parsed = JSON.parse(json ?? "[]");
    return Array.isArray(parsed) ? (parsed as FieldCheck<F>[]) : [];
  } catch {
    return [];
  }
}

/** Lowercase letters and digits only — how a value is looked for in OCR text. */
export function plainText(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export const textLines = (text: string) => text.split(/\r?\n/).map((line) => line.trim());

const pad = (n: number) => String(n).padStart(2, "0");
const isoOf = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

/** The kiosk's local calendar day, YYYY-MM-DD. */
export const localDay = (date: Date = new Date()) => isoOf(date.getFullYear(), date.getMonth() + 1, date.getDate());

function realDay(y: number, m: number, d: number): boolean {
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

/** A YYYY-MM-DD string naming a real calendar day. */
export function isIsoDay(value: string | null | undefined): value is string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? "");
  return Boolean(m) && realDay(Number(m![1]), Number(m![2]), Number(m![3]));
}

export function addMonths(iso: string, months: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y, m - 1 + months, 1);
  const last = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  return isoOf(date.getFullYear(), date.getMonth() + 1, Math.min(d, last));
}

/** "18 Jul 2026" — dates read back to a patient. */
export function displayDay(iso: string | null | undefined): string {
  if (!isIsoDay(iso)) return "";
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, januari: 1,
  feb: 2, february: 2, februari: 2,
  mar: 3, march: 3, mac: 3,
  apr: 4, april: 4,
  may: 5, mei: 5,
  jun: 6, june: 6,
  jul: 7, july: 7, julai: 7,
  aug: 8, august: 8, ogos: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10, okt: 10, oktober: 10,
  nov: 11, november: 11,
  dec: 12, december: 12, dis: 12, disember: 12,
};
const ISO_DATE = /\b(\d{4})-(\d{2})-(\d{2})\b/g;
const NUMERIC_DATE = /\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})\b/g;
// The month alternation is MONTHS' keys, longest first so "sept" is not read as "sep": keep the two in step.
const DAY_MONTH_DATE =
  /\b(\d{1,2})(?:st|nd|rd|th)?[\s.-]*(september|february|februari|november|december|disember|january|januari|october|oktober|august|march|april|julai|june|july|ogos|sept|jan|feb|mar|mac|apr|may|mei|jun|jul|aug|sep|oct|okt|nov|dec|dis)\.?,?[\s.-]*(\d{4})\b/gi;
const MONTH_DAY_DATE =
  /\b(september|february|februari|november|december|disember|january|januari|october|oktober|august|march|april|julai|june|july|ogos|sept|jan|feb|mar|mac|apr|may|mei|jun|jul|aug|sep|oct|okt|nov|dec|dis)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/gi;

function fullYear(year: string): number {
  if (year.length === 4) return Number(year);
  const yy = Number(year);
  return yy <= (new Date().getFullYear() % 100) + 10 ? 2000 + yy : 1900 + yy;
}

export type FoundDate = {
  iso: string;
  index: number;
  /** What precedes the date on its line — or the line above when the date stands alone. */
  context: string;
};

/** Every calendar date printed in the text, in reading order. Numeric dates are day-first, as Malaysian paperwork prints them. */
export function findDates(text: string): FoundDate[] {
  const hits: { index: number; end: number; iso: string }[] = [];
  const add = (match: RegExpMatchArray, y: number, m: number, d: number) => {
    if (m >= 1 && m <= 12 && realDay(y, m, d)) {
      hits.push({ index: match.index!, end: match.index! + match[0].length, iso: isoOf(y, m, d) });
    }
  };
  for (const m of text.matchAll(ISO_DATE)) add(m, Number(m[1]), Number(m[2]), Number(m[3]));
  for (const m of text.matchAll(NUMERIC_DATE)) add(m, fullYear(m[3]), Number(m[2]), Number(m[1]));
  for (const m of text.matchAll(DAY_MONTH_DATE)) add(m, Number(m[3]), MONTHS[m[2].toLowerCase()], Number(m[1]));
  for (const m of text.matchAll(MONTH_DAY_DATE)) add(m, Number(m[3]), MONTHS[m[1].toLowerCase()], Number(m[2]));

  hits.sort((a, b) => a.index - b.index || b.end - a.end);
  const dates: FoundDate[] = [];
  let reached = -1;
  for (const hit of hits) {
    if (hit.index < reached) continue;
    reached = hit.end;
    const lineStart = text.lastIndexOf("\n", hit.index - 1) + 1;
    let context = text.slice(lineStart, hit.index).trim();
    if (!/[a-z]/i.test(context)) {
      const above = text.slice(0, Math.max(lineStart - 1, 0)).split("\n").at(-1) ?? "";
      context = `${context} ${above}`.trim();
    }
    dates.push({ iso: hit.iso, index: hit.index, context });
  }
  return dates;
}

/** The first date whose label matches the earliest `prefer` pattern, skipping dates labelled like `avoid`. */
export function pickDate(text: string, prefer: RegExp[], avoid: RegExp): string | null {
  const dates = findDates(text).filter((d) => !avoid.test(d.context));
  for (const label of prefer) {
    const hit = dates.find((d) => label.test(d.context));
    if (hit) return hit.iso;
  }
  return dates[0]?.iso ?? null;
}

const EXPIRY_LABEL =
  /(exp(?:iry|ires|\.)?(?:\s*date)?|valid\s*(?:thru|through|until|till|to)|good\s*thru|tamat(?:\s*tempoh)?|sah\s*(?:hingga|sehingga|sampai))/i;
const MONTH_YEAR = /(?<![\d/])(0?[1-9]|1[0-2])\s*\/\s*(\d{4}|\d{2})(?![\d/])/;

/** A card's expiry; MM/YY means the card is good to the last day of that month. */
export function readExpiry(text: string): string | null {
  const rows = textLines(text);
  for (let i = 0; i < rows.length; i++) {
    const label = EXPIRY_LABEL.exec(rows[i]);
    if (!label) continue;
    let tail = rows[i].slice(label.index + label[0].length);
    if (!/\d/.test(tail)) tail = rows.slice(i + 1).find(Boolean) ?? "";
    const full = findDates(tail)[0];
    if (full) return full.iso;
    const my = MONTH_YEAR.exec(tail);
    if (my) {
      const year = fullYear(my[2]);
      const month = Number(my[1]);
      return isoOf(year, month, new Date(year, month, 0).getDate());
    }
  }
  return null;
}

const ID_LABEL = /(k\s*\/\s*p|i\s*\/\s*c|\bic\b|nric|mykad|kad\s+pengenalan|identity|passport|pasport)/i;
const LABELLED_ID = /\b(?:[A-Z]{2}\d{10}|\d{6}-\d{2}-\d{4}|\d{12})\b/i;
const BARE_ID = /\b(?:[A-Z]{2}\d{10}|\d{6}-\d{2}-\d{4})\b/i;

/** The identity number printed on a document: a labelled one first, then any number in an ID's shape. */
export function readIdNumber(text: string): string | null {
  for (const row of textLines(text)) {
    const label = ID_LABEL.exec(row);
    if (!label) continue;
    const id = LABELLED_ID.exec(row.slice(label.index));
    if (id) return id[0].toUpperCase();
  }
  return BARE_ID.exec(text)?.[0].toUpperCase() ?? null;
}

export const isIdNumber = (value: string) => /^(?:[A-Z]{2}\d{10}|\d{6}-?\d{2}-?\d{4})$/i.test(value.trim());
export const idKey = (id: string) => id.toUpperCase().replace(/[^A-Z0-9]/g, "");
export const sameId = (a: string, b: string) => idKey(a) === idKey(b);

/** Strips the separators OCR leaves around a printed value and keeps its first column. */
function cell(raw: string): string | null {
  const value = raw.replace(/^[\s:：/|.\-–—]+/, "").split(/\s{2,}|\t/)[0]?.trim();
  return value || null;
}

/** The value printed after a label: the rest of its line, or the next line when the label stands alone. */
export function labelledValue(text: string, label: RegExp): string | null {
  const pattern = new RegExp(label.source, label.flags.includes("g") ? label.flags : `${label.flags}g`);
  const rows = textLines(text);
  for (let i = 0; i < rows.length; i++) {
    const last = [...rows[i].matchAll(pattern)].at(-1);
    if (!last) continue;
    const rest = cell(rows[i].slice(last.index! + last[0].length));
    if (rest) return rest;
    const next = rows.slice(i + 1).find(Boolean);
    if (next) return cell(next);
  }
  return null;
}

const NAME_FILLERS = new Set(["BIN", "BINTI", "BINTE", "BT", "BTE", "AL", "AP", "SO", "DO"]);

/** A name as comparable tokens: uppercase, no punctuation, no BIN/BINTI/A/L/A/P/@ connectors or lone initials. */
export function nameTokens(name: string): string[] {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 1 && !NAME_FILLERS.has(token));
}

function withinOneEdit(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else {
      i++;
      j++;
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

/** One OCR slip is forgiven in a longer name part. */
const sameToken = (a: string, b: string) => a === b || (a.length >= 5 && b.length >= 5 && withinOneEdit(a, b));

export type NameMatch = "match" | "partial" | "mismatch";

/** "match" when one name is the other, or a shortened form of it; "partial" when half the shorter name agrees. */
export function matchNames(read: string | null | undefined, expected: string): NameMatch {
  const a = nameTokens(read ?? "");
  const b = nameTokens(expected);
  if (a.length === 0 || b.length === 0) return "mismatch";
  // OCR runs short names together ("FARAHVU"): the same letters in the same order are the same name.
  if (a.join("") === b.join("")) return "match";
  const common = a.filter((token) => b.some((other) => sameToken(token, other))).length;
  const smaller = Math.min(a.length, b.length);
  if (common === a.length && common === b.length) return "match";
  if (common >= smaller && common >= 2) return "match";
  return common / smaller >= 0.5 ? "partial" : "mismatch";
}

/** The letterhead: the first of the top lines that names an institution. */
export function letterhead(text: string, institution: RegExp): string | null {
  const top = textLines(text).filter(Boolean).slice(0, 4);
  return top.find((line) => institution.test(line))?.slice(0, 120) ?? null;
}
