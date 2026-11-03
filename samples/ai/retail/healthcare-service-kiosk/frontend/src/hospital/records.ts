// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { publicBoolean } from "@/lib/public-config";
import {
  CONSULTATION_FEE,
  DOCTORS,
  LAB_TESTS,
  MEDICATIONS,
  PAYERS,
  SLOT_TIMES,
  SPECIALIST_DEPARTMENTS,
  VISIT_MEDICATIONS,
  department,
  type Doctor,
} from "./data";
import { formatMrn } from "./patient-id";

/**
 * Mock patient records, derived deterministically from the ID document number
 * so the touch UI and the chat chains see the same patient without a database.
 */

export type Appointment = { id: string; department: string; doctor: string; date: string; time: string };
export type Prescription = {
  id: string;
  name: string;
  dosage: string;
  durationDays: number;
  price: number;
  refillsLeft: number;
  /** Null until the first supply is collected: a prescription written at today's visit. */
  lastFilled: string | null;
  /** The doctor who wrote it, for a prescription from a visit the patient checked in for at a kiosk. */
  prescribedBy?: string;
};
export type LabResult = { test: string; value: string; range: string; flag: "normal" | "high" | "low" };
export type Invoice = { id: string; date: string; description: string; amount: number };
export type Policy = { payer: string; memberId: string; policyNumber: string; expiry: string; remainingLimit: number };

export type FollowUp = {
  department: string;
  doctor: string;
  inWeeks: number;
  /** Set once the patient has booked it: the recommendation is then done. */
  booked?: { caseId: string; date: string; time: string; doctorName: string };
};

export type PatientRecord = {
  mrn: string;
  appointmentToday: Appointment | null;
  followUp: FollowUp | null;
  prescriptions: Prescription[];
  labResults: { date: string; results: LabResult[] } | null;
  invoices: Invoice[];
  policy: Policy | null;
};

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The same stream of numbers in [0, 1) for the same text, every time. */
export const seededRandom = (text: string): (() => number) => mulberry32(hash(text));

const pick = <T,>(rand: () => number, items: T[]): T => items[Math.floor(rand() * items.length)];

/** The kiosk's local calendar day, "2026-10-07" — not UTC, which is still yesterday before 8am in Malaysia. */
export function isoDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

export function patientRecord(documentNumber: string, today = new Date()): PatientRecord {
  const seed = hash(documentNumber.replace(/\D/g, "") || documentNumber);
  const rand = mulberry32(seed);
  const specialist = () => {
    const dept = pick(rand, SPECIALIST_DEPARTMENTS);
    const doctor = pick(rand, DOCTORS.filter((d) => d.department === dept));
    return { dept, doctor };
  };

  const todayVisit = specialist();
  const appointmentToday =
    rand() < 0.6
      ? {
          id: `APT-${(seed % 90000) + 10000}`,
          department: todayVisit.dept,
          doctor: todayVisit.doctor.name,
          date: isoDate(today),
          time: pick(rand, SLOT_TIMES),
        }
      : null;

  const follow = specialist();
  const followUp = rand() < 0.7 ? { department: follow.dept, doctor: follow.doctor.name, inWeeks: pick(rand, [2, 4, 6, 12]) } : null;

  const prescriptions = [...MEDICATIONS]
    .sort(() => rand() - 0.5)
    .slice(0, 1 + Math.floor(rand() * 3))
    .map((m, i) => ({
      id: `RX-${(seed % 9000) + 1000}-${i + 1}`,
      name: m.name,
      dosage: m.dosage,
      durationDays: pick(rand, [30, 60, 90]),
      price: m.price,
      refillsLeft: Math.floor(rand() * 3),
      lastFilled: isoDate(addDays(today, -Math.floor(20 + rand() * 60))),
    }));

  const labResults =
    rand() < 0.8
      ? {
          date: isoDate(addDays(today, -Math.floor(3 + rand() * 20))),
          results: [
            { test: "Fasting Blood Sugar", value: `${(4 + rand() * 4).toFixed(1)} mmol/L`, range: "3.9–6.0 mmol/L" },
            { test: "Total Cholesterol", value: `${(3.8 + rand() * 3).toFixed(1)} mmol/L`, range: "< 5.2 mmol/L" },
            { test: "Haemoglobin", value: `${(11 + rand() * 5).toFixed(1)} g/dL`, range: "12.0–16.5 g/dL" },
          ].map((r) => ({ ...r, flag: flagFor(r.value, r.range) })),
        }
      : null;

  const billedTest = pick(rand, LAB_TESTS);
  const invoices =
    rand() < 0.6
      ? [
          { id: `INV-${(seed % 90000) + 10000}`, date: isoDate(addDays(today, -14)), description: "Specialist consultation", amount: CONSULTATION_FEE },
          { id: `INV-${(seed % 90000) + 10001}`, date: isoDate(addDays(today, -14)), description: billedTest.name, amount: billedTest.price },
        ]
      : [];

  const payerPick = pick(rand, PAYERS);
  const policy =
    rand() < 0.7
      ? {
          payer: payerPick.id,
          memberId: `M${seed % 1000000}`,
          policyNumber: `POL-${(seed % 900000) + 100000}`,
          expiry: isoDate(addDays(today, rand() < 0.8 ? 200 : -30)),
          remainingLimit: rand() < 0.9 ? Math.round(5000 + rand() * 45000) : 0,
        }
      : null;

  return {
    mrn: formatMrn(seed),
    appointmentToday,
    followUp,
    prescriptions,
    labResults,
    invoices,
    policy,
  };
}

function flagFor(value: string, range: string): LabResult["flag"] {
  const v = parseFloat(value);
  const upper = range.match(/<\s*([\d.]+)/);
  if (upper) return v >= parseFloat(upper[1]) ? "high" : "normal";
  const [lo, hi] = range.split(/[–-]/).map((x) => parseFloat(x));
  if (v < lo) return "low";
  if (v > hi) return "high";
  return "normal";
}

export function outstandingBalance(record: PatientRecord): number {
  return record.invoices.reduce((sum, inv) => sum + inv.amount, 0);
}

/** Refill total for the chosen prescription ids (comma-separated). */
export function refillAmount(record: PatientRecord, ids: string): number {
  const chosen = new Set(ids.split(",").filter(Boolean));
  return record.prescriptions.filter((p) => chosen.has(p.id)).reduce((sum, p) => sum + p.price, 0);
}

/** Available slots for a doctor over the next `count` consulting days after `from`, `perDay` distinct times each (in time order). */
export function availableSlots(
  doctor: Doctor,
  from = new Date(),
  count = 6,
  perDay = 1,
): { date: string; time: string }[] {
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const rand = mulberry32(hash(doctor.id + isoDate(from)));
  const slots: { date: string; time: string }[] = [];
  let found = 0;
  for (let offset = 1; found < count && offset < 30; offset++) {
    const day = addDays(from, offset);
    if (!doctor.days.includes(days[day.getDay()])) continue;
    found++;
    const times = new Set<string>();
    while (times.size < Math.min(perDay, SLOT_TIMES.length)) {
      times.add(SLOT_TIMES[Math.floor(rand() * SLOT_TIMES.length)]);
    }
    for (const time of SLOT_TIMES.filter((t) => times.has(t))) slots.push({ date: isoDate(day), time });
  }
  return slots;
}

const DAY_CODES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const minuteOfDay = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));

const clock = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

/** `mock.clinics_always_open`: every specialist sees same-day patients at any hour of a day they consult, for a demo outside clinic hours. Read per call. */
export const clinicsAlwaysOpen = () => publicBoolean("NEXT_PUBLIC_KIOSK_CLINICS_ALWAYS_OPEN", false);

const ALL_DAY = Array.from({ length: 48 }, (_, i) => clock(i * 30));

/**
 * What is left of today, on a day the doctor consults: their clinic times still ahead. With
 * clinics always open, every half-hour still ahead instead, so a time asked for can be had.
 */
function sameDaySlots(doctor: Doctor, now: Date): { date: string; time: string }[] {
  if (!doctor.days.includes(DAY_CODES[now.getDay()])) return [];
  const date = isoDate(now);
  const minute = now.getHours() * 60 + now.getMinutes();
  const times = clinicsAlwaysOpen() ? ALL_DAY : SLOT_TIMES;
  return times.filter((time) => minuteOfDay(time) > minute).map((time) => ({ date, time }));
}

/** Today's remaining times, then four a clinic day over the next six — what booking offers, in date and time order. */
export function bookableSlots(doctor: Doctor, from = new Date()): { date: string; time: string }[] {
  return [...sameDaySlots(doctor, from), ...availableSlots(doctor, from, 6, 4)];
}

export function queueNumber(departmentId: string, documentNumber: string): string {
  const prefix = departmentId.slice(0, 1).toUpperCase();
  return `${prefix}${String((hash(documentNumber + isoDate(new Date())) % 900) + 100)}`;
}

/** A clinic visit the patient checked in for at a kiosk: the check-in's case id, its day, clinic and doctor. */
export type Visit = { reference: string; date: string; department: string; doctor: string };

/**
 * What the kiosk has done to a patient's record since the mock HIS derived
 * it — visits checked in for, invoices paid, refills dispensed, a follow-up
 * booked — read back from the filed cases (src/app/api/_lib/ledger.ts). There
 * is no HIS to write to, so the record is the derived one with these applied on top.
 */
export type Ledger = {
  paidInvoices: string[];
  dispensed: Record<string, { count: number; last: string }>;
  followUpBooked: FollowUp["booked"] | null;
  visits: Visit[];
};

export const EMPTY_LEDGER: Ledger = { paidInvoices: [], dispensed: {}, followUpBooked: null, visits: [] };

/** A checked-in visit's consultation, due from check-in so the patient can pay while they wait. */
function visitInvoice(visit: Visit): Invoice {
  const clinic = department(visit.department)?.name ?? visit.department;
  return { id: `INV-${visit.reference}`, date: visit.date, description: `Specialist consultation — ${clinic}`, amount: CONSULTATION_FEE };
}

function visitPrescriptions(visit: Visit): Prescription[] {
  const medication = VISIT_MEDICATIONS[visit.department];
  if (!medication) return [];
  return [{ id: `RX-${visit.reference}`, ...medication, durationDays: 30, refillsLeft: 2, lastFilled: null, prescribedBy: visit.doctor }];
}

export function applyLedger(record: PatientRecord, ledger: Ledger): PatientRecord {
  const paid = new Set(ledger.paidInvoices);
  // A ledger served before visits were recorded has none.
  const visits = ledger.visits ?? [];
  return {
    ...record,
    invoices: [...record.invoices, ...visits.map(visitInvoice)].filter((inv) => !paid.has(inv.id)),
    prescriptions: [...record.prescriptions, ...visits.flatMap(visitPrescriptions)].map((p) => {
      const dispensed = ledger.dispensed[p.id];
      if (!dispensed) return p;
      // A new prescription's first supply is not a refill.
      const refills = p.lastFilled === null ? dispensed.count - 1 : dispensed.count;
      return {
        ...p,
        refillsLeft: Math.max(0, p.refillsLeft - refills),
        lastFilled: p.lastFilled !== null && p.lastFilled > dispensed.last ? p.lastFilled : dispensed.last,
      };
    }),
    followUp: record.followUp && ledger.followUpBooked ? { ...record.followUp, booked: ledger.followUpBooked } : record.followUp,
  };
}

/** A repeat supply is due once three quarters of the last one has been taken. */
const REFILL_DUE_FRACTION = 0.75;

export type RefillCheck = { ok: true } | { ok: false; reason: string; from?: string };

/** Whether a prescription can be refilled today, and why not. A new one's first supply is always ready. */
export function refillCheck(p: Prescription, today = new Date()): RefillCheck {
  if (p.lastFilled === null) return { ok: true };
  if (p.refillsLeft <= 0) return { ok: false, reason: "no refills left — the doctor needs to renew it" };
  const due = addDays(new Date(`${p.lastFilled}T00:00:00`), Math.ceil(p.durationDays * REFILL_DUE_FRACTION));
  if (isoDate(due) > isoDate(today)) {
    return { ok: false, reason: `too early — the last supply runs to ${isoDate(addDays(new Date(`${p.lastFilled}T00:00:00`), p.durationDays))}`, from: isoDate(due) };
  }
  return { ok: true };
}

/** Total of the chosen invoice ids (comma-separated) — what paying them costs. */
export function invoicesAmount(record: PatientRecord, ids: string): number {
  const chosen = new Set(ids.split(",").filter(Boolean));
  return record.invoices.filter((inv) => chosen.has(inv.id)).reduce((sum, inv) => sum + inv.amount, 0);
}
