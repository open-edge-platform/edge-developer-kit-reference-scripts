// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { department, DOCTORS, SLOT_TIMES, SPECIALIST_DEPARTMENTS } from "@/hospital/data";
import {
  applyLedger,
  bookableSlots,
  clinicsAlwaysOpen,
  isoDate,
  outstandingBalance,
  patientRecord,
  type Invoice,
} from "@/hospital/records";
import { formatMoney } from "@/lib/format";
import { getService } from "@/services";
import { fileApplication } from "./applications";
import { openBookingIn } from "./booking";
import { cmsFind, cmsUpdate } from "./cms";
import { dateOfBirthIso, type CitizenDoc } from "./citizens";
import { ledgerOf } from "./ledger";
import { appointmentsToday, CHECK_IN_SERVICE, checkInsOf, takenSlots } from "./patients";
import { CURRENCY } from "./registry";

/**
 * The staff "Demo visit" on /mock-documents: one patient made ready to walk a
 * visit at the kiosk — an appointment today, not checked in yet, a bill still
 * to pay — and made ready again after every run.
 *
 * A run is undone by holding its cases, not deleting them. A held check-in
 * leaves the queue and a held bill payment leaves the ledger (both read
 * on_hold as "changed nothing"), so the bill the record derives is due again
 * while the payment stays on file. Checking in bills the visit's consultation
 * and sends its prescription to the pharmacy (src/hospital/records.ts), so
 * every patient has something to pay and collect once checked in.
 */

export type DemoVisit = {
  /** "1988-07-23": what the kiosk asks for after a patient card, a slip or a typed MRN. */
  dateOfBirth: string;
  appointments: {
    reference: string;
    clinic: string;
    doctor: string;
    time: string;
    source: "scheduled" | "booked";
    /** Set once checked in for this visit. */
    queueNumber: string | null;
  }[];
  /** Invoices still unpaid, a checked-in visit's consultation among them. */
  due: Invoice[];
};

type CaseDoc = { id: number; caseId: string };

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const minutesOf = (time: string) => {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
};

export async function demoVisitOf(citizen: CitizenDoc): Promise<DemoVisit> {
  const [appointments, checkIns, ledger] = await Promise.all([
    appointmentsToday(citizen),
    checkInsOf(citizen.id),
    ledgerOf(citizen),
  ]);
  const record = patientRecord(citizen.citizenId);
  return {
    dateOfBirth: dateOfBirthIso(citizen),
    appointments: appointments.map((a) => ({
      reference: a.reference,
      clinic: department(a.department)?.name ?? a.department,
      doctor: a.doctor,
      time: a.time,
      source: a.source,
      queueNumber: checkIns.find((c) => c.appointmentReference === a.reference)?.queueNumber ?? null,
    })),
    due: applyLedger(record, ledger).invoices,
  };
}

/** Clears the patient's last run and books today's visit if they have none. Returns what it did, one line each. */
export async function prepareDemoVisit(citizen: CitizenDoc, staffEmail: string): Promise<string[]> {
  const done: string[] = [];
  const statusReason = `Cleared by ${staffEmail} for another demo run`;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const checkIns = await cmsFind<CaseDoc & { data?: Record<string, string> | null }>("applications", {
    where: {
      citizen: { equals: citizen.id },
      serviceId: { equals: CHECK_IN_SERVICE },
      status: { not_equals: "on_hold" },
      submittedAt: { greater_than_equal: today.toISOString() },
    },
    limit: 50,
  });
  for (const doc of checkIns.docs) {
    await cmsUpdate("applications", doc.id, { status: "on_hold", statusReason });
    done.push(`Took ${doc.data?.queueNumber ?? doc.caseId} out of today's queue.`);
  }

  const before = applyLedger(patientRecord(citizen.citizenId), await ledgerOf(citizen));
  const bills = await cmsFind<CaseDoc>("applications", {
    where: { citizen: { equals: citizen.id }, serviceId: { equals: "bill" }, status: { not_equals: "on_hold" } },
    limit: 100,
  });
  for (const doc of bills.docs) await cmsUpdate("applications", doc.id, { status: "on_hold", statusReason });
  if (bills.docs.length > 0) {
    const due = outstandingBalance(patientRecord(citizen.citizenId)) - outstandingBalance(before);
    done.push(
      `Undid ${bills.docs.length === 1 ? "a bill payment" : `${bills.docs.length} bill payments`}: ` +
        `${formatMoney(due, CURRENCY)} is due again.`,
    );
  }

  if ((await appointmentsToday(citizen)).length === 0) done.push(...(await bookToday(citizen, staffEmail)));
  if (done.length === 0) done.push("Already ready: nothing to clear, and today's visit is booked.");
  return done;
}

/** Today's slot closest to now with a free doctor, filed the way New Specialist Visit files one. */
async function bookToday(citizen: CitizenDoc, staffEmail: string): Promise<string[]> {
  const service = getService("book");
  if (!service) throw new Error("New Specialist Visit is not on this kiosk, so there is no way to book a visit");
  const now = new Date();
  const date = isoDate(now);
  const alwaysOpen = clinicsAlwaysOpen();
  const working = DOCTORS.filter((d) => d.days.includes(DAY_NAMES[now.getDay()]));
  const doctors = (working.length > 0 ? working : DOCTORS).filter((d) => SPECIALIST_DEPARTMENTS.includes(d.department));

  // Up to half an hour gone still checks in on time; past the last slot, the latest one (checked in late).
  const sinceMidnight = now.getHours() * 60 + now.getMinutes();
  const order = [
    ...SLOT_TIMES.filter((t) => minutesOf(t) >= sinceMidnight - 30),
    ...SLOT_TIMES.filter((t) => minutesOf(t) < sinceMidnight - 30).reverse(),
  ];

  // One open booking per clinic, as at the kiosk.
  const held = new Set<string>();
  for (const id of new Set(doctors.map((d) => d.department))) {
    if (await openBookingIn(citizen.id, id)) held.add(id);
  }
  let best: { doctor: (typeof DOCTORS)[number]; time: string; rank: number } | null = null;
  for (const doctor of doctors.filter((d) => !held.has(d.department))) {
    const taken = await takenSlots(doctor.id);
    // Always-open clinics book the next half-hours, as the kiosk offers them; on a day nobody consults, clinic times as usual.
    const times =
      alwaysOpen && working.length > 0 ? bookableSlots(doctor, now).filter((s) => s.date === date).map((s) => s.time) : order;
    const rank = times.findIndex((time) => !taken.has(`${date} ${time}`));
    if (rank >= 0 && (!best || rank < best.rank)) best = { doctor, time: times[rank], rank };
  }
  if (!best) {
    throw new Error(
      held.size > 0
        ? "every clinic with a free slot today already has an open booking for this patient — the kiosk allows one per clinic"
        : "every doctor's slots today are taken",
    );
  }

  const filed = await fileApplication(service, {
    documentNumber: citizen.citizenId,
    data: {
      department: best.doctor.department,
      doctorId: best.doctor.id,
      doctorName: best.doctor.name,
      date,
      time: best.time,
      bookedBy: staffEmail,
    },
  });
  if (filed.status === "on_hold") throw new Error(filed.statusReason ?? "the booking was held");
  const clinic = department(best.doctor.department)?.name ?? best.doctor.department;
  return [
    `Booked ${clinic} at ${best.time} today with ${best.doctor.name} (${filed.caseId}).`,
    ...(working.length === 0 ? ["No clinic runs today, so the visit is booked with a doctor who is off."] : []),
  ];
}
