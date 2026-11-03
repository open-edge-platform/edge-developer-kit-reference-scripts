// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import {
  CONFIRM_SAY,
  askedDay,
  bookingFiled,
  clinicNamed,
  confirmAsk,
  fileBooking,
  freeSlots,
  onDay,
  openBookingIn,
  slotRound,
} from "@/app/api/_lib/booking";
import { findCitizenByDocument } from "@/app/api/_lib/citizens";
import { ask, done, READY } from "@/app/api/_lib/flows/plan";
import type { Ask, ChainSpec } from "@/app/api/_lib/flows/types";
import { DOCTORS, SPECIALIST_DEPARTMENTS, department, doctorsCalled, type Doctor } from "@/hospital/data";
import { bookableSlots } from "@/hospital/records";
import { formatShortDate } from "@/lib/format";

/** One open booking per clinic: a second one is a change of appointment, which the counter handles. */
async function alreadyBooked(documentNumber: string, departmentId: string) {
  const citizen = await findCitizenByDocument(documentNumber);
  return citizen ? openBookingIn(citizen.id, departmentId) : null;
}

const bookedLine = (data: Record<string, string>, caseId: string) =>
  `You already have ${department(data.department)?.name ?? data.department} booked with ${data.doctorName} on ` +
  `${formatShortDate(data.date)} at ${data.time} (reference ${caseId}). To change it, please see the registration counter.`;

function doctorAsk(doctors: Doctor[], question: string, withClinic = false): Ask {
  return {
    id: "doctorId",
    question,
    type: "options",
    options: doctors.map((d) => ({
      value: d.id,
      label: `${d.name}${withClinic ? `, ${department(d.department)!.name}` : ""} — ${d.languages.join(", ")} (${d.days.join(", ")})`,
    })),
  };
}

// Keep gates and question text in sync with the touch kiosk's steps/application.tsx.
export const chain: ChainSpec = {
  application: async (ctx) => {
    // A doctor the patient named: one match settles the doctor and their clinic, several are asked
    // about, none is said so. Acted on once, like a requested time (see `slotRound`).
    let unmatched: string | undefined;
    const named = ctx.data.doctor?.trim();
    delete ctx.data.doctor;
    if (named && named !== ctx.data.requestedDoctor) {
      ctx.data.requestedDoctor = named;
      const called = doctorsCalled(named);
      if (called.length === 1) {
        if (called[0].id !== ctx.data.doctorId) {
          delete ctx.data.slot;
          delete ctx.data.confirmBooking;
        }
        ctx.data.doctorId = called[0].id;
        ctx.data.department = called[0].department;
      } else if (called.length > 1) {
        delete ctx.data.doctorId;
        delete ctx.data.department;
        return ask(`More than one of our doctors could be "${named}".`, [
          doctorAsk(called, "Which doctor did you mean?", true),
        ]);
      } else {
        unmatched = `I couldn't find a doctor called "${named}".`;
      }
    }
    // A doctor picked from several named ones brings their clinic with them; a clinic given in words ("cardiologist") is read.
    const picked = DOCTORS.find((d) => d.id === ctx.data.doctorId);
    if (picked && !SPECIALIST_DEPARTMENTS.includes(ctx.data.department)) ctx.data.department = picked.department;
    if (ctx.data.department && !SPECIALIST_DEPARTMENTS.includes(ctx.data.department)) {
      ctx.data.department = clinicNamed(ctx.data.department) ?? ctx.data.department;
    }

    if (!SPECIALIST_DEPARTMENTS.includes(ctx.data.department)) {
      return ask(unmatched, [
        {
          id: "department",
          question: "Which department would you like to see a specialist in?",
          type: "options",
          options: SPECIALIST_DEPARTMENTS.map((id) => ({ value: id, label: department(id)!.name })),
        },
      ]);
    }
    const existing = await alreadyBooked(ctx.documentNumber, ctx.data.department);
    if (existing?.data) return done(bookedLine(existing.data, existing.caseId));

    const doctors = DOCTORS.filter((d) => d.department === ctx.data.department);
    let doctor = doctors.find((d) => d.id === ctx.data.doctorId);
    if (!doctor) {
      // A day asked for and no doctor named ("a cardiologist today"): only the clinic's doctors free that day are
      // offered, and when that is one of them there is no doctor question at all.
      const day = askedDay(ctx.data);
      const open: Doctor[] = [];
      for (const d of day ? doctors : []) {
        if ((await freeSlots(d.id, bookableSlots(d))).some((slot) => slot.date === day)) open.push(d);
      }
      if (open.length !== 1) {
        const none = day && open.length === 0 ? `No ${department(ctx.data.department)!.name} doctor has a free time ${onDay(day)}.` : undefined;
        return ask([unmatched, none].filter(Boolean).join(" ") || undefined, [
          open.length > 1
            ? doctorAsk(open, `Who would you like to see ${onDay(day!)}?`)
            : doctorAsk(doctors, "Which doctor would you like to see?"),
        ]);
      }
      doctor = open[0];
      ctx.data.doctorId = doctor.id;
    }
    if (ctx.data.confirmBooking === "change") {
      delete ctx.data.slot;
      delete ctx.data.confirmBooking;
    }
    const free = await freeSlots(doctor.id, bookableSlots(doctor));
    const round = slotRound(ctx.data, doctor, free, `When would you like to see ${doctor.name}?`, unmatched);
    if (round) return round;
    const [date, time] = ctx.data.slot.split(" ");
    if (ctx.data.confirmBooking !== "yes") {
      return ask(unmatched ?? CONFIRM_SAY, [confirmAsk(doctor.name, department(ctx.data.department)!.name, date, time)]);
    }
    ctx.data.doctorId = doctor.id;
    ctx.data.doctorName = doctor.name;
    ctx.data.date = date;
    ctx.data.time = time;
    return READY;
  },
  file: async (filing) => {
    const existing = filing.documentNumber ? await alreadyBooked(filing.documentNumber, filing.data.department) : null;
    if (existing?.data) return { hold: bookedLine(existing.data, existing.caseId) };
    return fileBooking(filing);
  },
  filed: bookingFiled,
};
