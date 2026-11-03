// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { DOCTORS } from "@/hospital/data";
import { parseScannedCode } from "@/hospital/patient-id";
import { isoDate, patientRecord } from "@/hospital/records";
import { cmsFind, cmsFindOne } from "./cms";
import { dateOfBirthIso, type CitizenDoc } from "./citizens";
import { slipSignatureValid } from "./slips";

/** Services whose cases are appointments: a booked slot is taken until the case is closed. */
export const BOOKING_SERVICES = ["book", "followup"] as const;
/** The service whose cases are today's arrivals, with their queue numbers. */
export const CHECK_IN_SERVICE = "checkin";
/** Services that hand out a queue number: clinic check-ins, and verification's registration counter. */
export const QUEUE_SERVICES = [CHECK_IN_SERVICE, "verify"];
const OPEN_STATUSES = "in_review,officer_review";

export type Appointment = {
  /** What the slip's barcode carries: the booking's case id, or the scheduled appointment id. */
  reference: string;
  department: string;
  doctor: string;
  doctorId?: string;
  date: string;
  time: string;
  source: "scheduled" | "booked";
};

type ApplicationDoc = {
  caseId: string;
  serviceId: string;
  citizen?: number | null;
  status: string;
  data?: Record<string, string> | null;
  submittedAt: string;
};

const INDEX_TTL_MS = 60_000;
const INDEX = Symbol.for("kiosk.patients.index");
type Index = { at: number; citizens: CitizenDoc[] };
type Global = { [INDEX]?: Index };

/** The registry is small and the mock records derive from it, so lookups by MRN scan a cached copy. */
async function registry(fresh = false): Promise<CitizenDoc[]> {
  const globals = globalThis as Global;
  const cached = globals[INDEX];
  if (!fresh && cached && Date.now() - cached.at < INDEX_TTL_MS) return cached.citizens;
  const citizens: CitizenDoc[] = [];
  for (let page = 1; ; page++) {
    const res = await cmsFind<CitizenDoc>("citizens", { limit: 200, page });
    citizens.push(...res.docs);
    if (page >= res.totalPages) break;
  }
  globals[INDEX] = { at: Date.now(), citizens };
  return citizens;
}

/** A miss in the cached copy reads the registry afresh: the patient may have been registered since. */
async function findInRegistry(match: (citizen: CitizenDoc) => boolean): Promise<CitizenDoc | null> {
  return (await registry()).find(match) ?? (await registry(true)).find(match) ?? null;
}

export function findCitizenByMrn(mrn: string): Promise<CitizenDoc | null> {
  return findInRegistry((c) => patientRecord(c.citizenId).mrn === mrn);
}

function bookedAppointment(doc: ApplicationDoc): Appointment | null {
  const data = doc.data ?? {};
  if (!data.date || !data.time || !data.department) return null;
  return {
    reference: doc.caseId,
    department: data.department,
    doctor: data.doctorName || DOCTORS.find((d) => d.id === data.doctorId)?.name || "",
    ...(data.doctorId ? { doctorId: data.doctorId } : {}),
    date: data.date,
    time: data.time,
    source: "booked",
  };
}

async function openBookings(where: Record<string, Record<string, string | number>> = {}): Promise<ApplicationDoc[]> {
  const res = await cmsFind<ApplicationDoc>("applications", {
    where: { serviceId: { in: BOOKING_SERVICES.join(",") }, status: { in: OPEN_STATUSES }, ...where },
    limit: 500,
    sort: "-submittedAt",
  });
  return res.docs;
}

/** Today's appointments for a patient: the scheduled one, then anything booked at a kiosk for today. */
export async function appointmentsToday(citizen: CitizenDoc): Promise<Appointment[]> {
  const today = isoDate(new Date());
  const scheduled = patientRecord(citizen.citizenId).appointmentToday;
  const booked = (await openBookings({ citizen: { equals: citizen.id } }))
    .map(bookedAppointment)
    .filter((a): a is Appointment => a !== null && a.date === today)
    .sort((a, b) => a.time.localeCompare(b.time));
  return [
    ...(scheduled ? [{ ...scheduled, reference: scheduled.id, source: "scheduled" as const }] : []),
    ...booked,
  ];
}

/** "date time" keys of a doctor's slots already booked by someone. */
export async function takenSlots(doctorId: string): Promise<Set<string>> {
  const booked = (await openBookings()).map(bookedAppointment).filter(Boolean) as Appointment[];
  return new Set(booked.filter((a) => a.doctorId === doctorId).map((a) => `${a.date} ${a.time}`));
}

async function findAppointment(reference: string): Promise<{ citizen: CitizenDoc; appointment: Appointment } | null> {
  if (reference.startsWith("HCK-")) {
    const doc = await cmsFindOne<ApplicationDoc>("applications", { caseId: { equals: reference } });
    const appointment = doc && BOOKING_SERVICES.includes(doc.serviceId as never) ? bookedAppointment(doc) : null;
    const citizen = doc?.citizen ? await findInRegistry((c) => c.id === doc.citizen) : null;
    return appointment && citizen ? { citizen, appointment } : null;
  }
  const citizen = await findInRegistry((c) => patientRecord(c.citizenId).appointmentToday?.id === reference);
  const scheduled = citizen ? patientRecord(citizen.citizenId).appointmentToday : null;
  return citizen && scheduled ? { citizen, appointment: { ...scheduled, reference, source: "scheduled" } } : null;
}

export type ScanFailure = "unknown_format" | "checksum" | "unregistered" | "forged";

export type ScanResolution =
  | { ok: true; kind: "patientCard"; citizen: CitizenDoc; mrn: string }
  | { ok: true; kind: "appointmentSlip"; citizen: CitizenDoc; mrn: string; appointment: Appointment }
  | { ok: false; reason: ScanFailure };

export async function resolveScan(raw: string): Promise<ScanResolution> {
  const code = parseScannedCode(raw);
  if (code.kind === "invalid") return { ok: false, reason: code.reason };
  if (code.kind === "mrn") {
    const citizen = await findCitizenByMrn(code.mrn);
    return citizen ? { ok: true, kind: "patientCard", citizen, mrn: code.mrn } : { ok: false, reason: "unregistered" };
  }
  if (!slipSignatureValid(code.reference, code.signature)) return { ok: false, reason: "forged" };
  const found = await findAppointment(code.reference);
  if (!found) return { ok: false, reason: "unregistered" };
  return {
    ok: true,
    kind: "appointmentSlip",
    citizen: found.citizen,
    mrn: patientRecord(found.citizen.citizenId).mrn,
    appointment: found.appointment,
  };
}

export const SCAN_FAILURE_MESSAGE: Record<ScanFailure, string> = {
  unknown_format: "That code isn't a patient card or appointment slip from this hospital.",
  checksum: "That MRN doesn't add up — please check the digits and try again.",
  unregistered: "We couldn't find a patient record for that code.",
  forged: "That slip wasn't issued by this hospital — please ask at the registration counter.",
};

export type CheckInDoc = { caseId: string; citizen?: number | null; data?: Record<string, string> | null; submittedAt: string };

/** Today's open queue tickets, oldest first. */
export async function checkInsToday(): Promise<CheckInDoc[]> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const res = await cmsFind<CheckInDoc>("applications", {
    where: {
      serviceId: { in: QUEUE_SERVICES.join(",") },
      status: { in: OPEN_STATUSES },
      submittedAt: { greater_than_equal: today.toISOString() },
    },
    limit: 1000,
    sort: "submittedAt",
  });
  return res.docs;
}

export type CheckIn = { caseId: string; queueNumber: string; department: string; appointmentReference: string; checkedInAt: string };

/** Every check-in filed today, seen or still waiting — what a queue number or a repeat check-in is counted against. */
export async function checkInsFiledToday(where: Record<string, Record<string, string | number>> = {}): Promise<CheckInDoc[]> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const res = await cmsFind<CheckInDoc>("applications", {
    where: {
      serviceId: { in: QUEUE_SERVICES.join(",") },
      status: { not_equals: "on_hold" },
      submittedAt: { greater_than_equal: today.toISOString() },
      ...where,
    },
    limit: 1000,
    sort: "submittedAt",
  });
  return res.docs;
}

/** The patient's check-ins today, one per appointment, earliest first. */
export async function checkInsOf(citizenId: number): Promise<CheckIn[]> {
  return (await checkInsFiledToday({ citizen: { equals: citizenId }, serviceId: { equals: CHECK_IN_SERVICE } }))
    .filter((doc) => doc.data?.queueNumber)
    .map((doc) => ({
      caseId: doc.caseId,
      queueNumber: doc.data!.queueNumber,
      department: doc.data!.department,
      appointmentReference: doc.data!.appointmentReference ?? doc.data!.appointmentId ?? "",
      checkedInAt: doc.submittedAt,
    }));
}

export async function checkedInToday(citizenId: number): Promise<CheckIn | null> {
  return (await checkInsOf(citizenId))[0] ?? null;
}

const nameKey = (name: string) => name.toUpperCase().replace(/[^A-Z]+/g, " ").trim();

/** "Validate duplicate patient": somebody else on the register with the same name and date of birth — one person under two IDs. */
export async function possibleDuplicates(citizen: CitizenDoc): Promise<CitizenDoc[]> {
  const name = nameKey(citizen.name);
  const born = dateOfBirthIso(citizen);
  return (await registry(true)).filter(
    (other) => other.id !== citizen.id && nameKey(other.name) === name && dateOfBirthIso(other) === born,
  );
}
