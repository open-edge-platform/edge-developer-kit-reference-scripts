// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { department, DOCTORS } from "@/hospital/data";
import { checkInsFiledToday, checkInsToday, type CheckInDoc } from "./patients";

/** Minutes a consultation takes on average, until real call/done times exist to learn it from. */
const AVERAGE_VISIT_MIN = Number(process.env.KIOSK_QUEUE_VISIT_MIN ?? 12);

/** One ticket series per clinic, reset daily by keying on the date. */
const PREFIX: Record<string, string> = {
  registration: "R",
  cardiology: "C",
  orthopaedics: "O",
  paediatrics: "P",
  obgyn: "G",
  dermatology: "D",
};

export const queuePrefix = (departmentId: string) =>
  PREFIX[departmentId] ?? departmentId.slice(0, 1).toUpperCase();

export type QueueEntry = {
  number: string;
  checkedInAt: string;
  /** Pre-visit answers the clinic should see before calling the patient. */
  flags: string[];
};

export type QueueSnapshot = {
  department: string;
  name: string;
  place: string;
  nowServing: string | null;
  waiting: QueueEntry[];
  doctorsIn: number;
  averageMinutes: number;
};

type Issued = { day: string; last: Map<string, number>; chain: Promise<unknown> };
const ISSUED = Symbol.for("kiosk.queue.issued");
type Global = { [ISSUED]?: Issued };

/**
 * The next number in a clinic's series today. Counted from every check-in
 * filed today — a patient already seen keeps their number taken — and handed
 * out one at a time, with the last one issued remembered, so two kiosks
 * filing at the same moment, or a case filed a moment later, never share one.
 */
export function nextQueueNumber(departmentId: string): Promise<string> {
  const globals = globalThis as Global;
  const day = new Date().toDateString();
  if (globals[ISSUED]?.day !== day) globals[ISSUED] = { day, last: new Map(), chain: Promise.resolve() };
  const issued = globals[ISSUED];
  const next = issued.chain.then(async () => {
    const filed = (await checkInsFiledToday()).filter((doc) => doc.data?.department === departmentId);
    const highest = Math.max(0, ...filed.map((doc) => Number(doc.data?.queueNumber?.replace(/\D/g, "")) || 0));
    const number = Math.max(highest, issued.last.get(departmentId) ?? 0) + 1;
    issued.last.set(departmentId, number);
    return `${queuePrefix(departmentId)}${String(number).padStart(3, "0")}`;
  });
  issued.chain = next.catch(() => undefined);
  return next;
}

function doctorsInToday(departmentId: string): number {
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][new Date().getDay()];
  return Math.max(1, DOCTORS.filter((d) => d.department === departmentId && d.days.includes(day)).length);
}

function flagsOf(data: Record<string, string>): string[] {
  const flags: string[] = [];
  if (data.medsChanged === "yes") flags.push("Medicines or allergies changed");
  if (data.infection === "yes") flags.push("Fever, cough or rash");
  if (data.arrival === "late") flags.push("Arrived late");
  return flags;
}

/**
 * There is no clinic console to call patients yet, so the queue moves on a clock: each doctor
 * in today sees one patient every AVERAGE_VISIT_MIN from the first check-in. Ticket, board and
 * kiosk all read this one model, so they always agree.
 */
export async function queueSnapshots(now = new Date()): Promise<QueueSnapshot[]> {
  const byClinic = new Map<string, CheckInDoc[]>();
  for (const doc of await checkInsToday()) {
    const clinic = doc.data?.department;
    if (!clinic || !doc.data?.queueNumber) continue;
    byClinic.set(clinic, [...(byClinic.get(clinic) ?? []), doc]);
  }
  return [...byClinic.entries()].map(([clinic, docs]) => {
    const doctorsIn = doctorsInToday(clinic);
    const elapsedMin = (now.getTime() - Date.parse(docs[0].submittedAt)) / 60_000;
    const served = Math.min(docs.length - 1, Math.floor(elapsedMin / AVERAGE_VISIT_MIN) * doctorsIn);
    const dept = department(clinic);
    return {
      department: clinic,
      name: dept?.name ?? clinic,
      place: dept ? `${dept.building}, ${dept.floor}` : "",
      nowServing: docs[served]?.data?.queueNumber ?? null,
      waiting: docs.slice(served + 1).map((doc) => {
        const data = doc.data ?? {};
        return { number: data.queueNumber, checkedInAt: doc.submittedAt, flags: flagsOf(data) };
      }),
      doctorsIn,
      averageMinutes: AVERAGE_VISIT_MIN,
    };
  });
}

export type TicketStatus = { nowServing: string | null; ahead: number; waitMinutes: number; called: boolean };

export async function ticketStatus(departmentId: string, queueNumber: string): Promise<TicketStatus> {
  const clinic = (await queueSnapshots()).find((snapshot) => snapshot.department === departmentId);
  if (!clinic) return { nowServing: null, ahead: 0, waitMinutes: 0, called: false };
  const position = clinic.waiting.findIndex((entry) => entry.number === queueNumber);
  const called = clinic.nowServing === queueNumber || position < 0;
  const ahead = Math.max(position, 0);
  return {
    nowServing: clinic.nowServing,
    ahead,
    waitMinutes: called ? 0 : Math.ceil((ahead + 1) / clinic.doctorsIn) * clinic.averageMinutes,
    called,
  };
}
