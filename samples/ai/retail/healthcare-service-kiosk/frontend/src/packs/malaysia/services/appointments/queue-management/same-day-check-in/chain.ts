// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { formatMoney } from "@/lib/format";
import { findCitizenByDocument } from "@/app/api/_lib/citizens";
import { liveRecord } from "@/app/api/_lib/ledger";
import { notify } from "@/app/api/_lib/notify";
import { appointmentsToday, checkInsOf, type CheckIn } from "@/app/api/_lib/patients";
import { nextQueueNumber, ticketStatus } from "@/app/api/_lib/queue";
import { CURRENCY } from "@/app/api/_lib/registry";
import { ask, done, READY } from "@/app/api/_lib/flows/plan";
import type { Ask, ChainSpec } from "@/app/api/_lib/flows/types";
import { department, departmentLocation } from "@/hospital/data";
import { outstandingBalance } from "@/hospital/records";
import { getService } from "@/services";
import { arrivalFor, arrivalNote, PRE_VISIT_QUESTIONS, YES_NO } from "./checkin";

const clinicName = (id: string) => department(id)?.name ?? id;

/** The touch ticket's "Show me the way": in chat the map to the clinic comes up under the reply, while the kiosk offers directions. */
const wayTo = (departmentId: string | undefined) =>
  departmentId && getService("directions") ? { destination: departmentId } : undefined;

const alreadyLine = (checkIn: CheckIn) =>
  `You're already checked in for ${clinicName(checkIn.department)} today — your queue number is still ` +
  `${checkIn.queueNumber}. Take a seat in the waiting area; it will be shown on screen and called out.`;

// Keep gates and question text in sync with the touch kiosk's steps/application.tsx.
export const chain: ChainSpec = {
  application: async (ctx) => {
    const citizen = await findCitizenByDocument(ctx.documentNumber);
    const appointments = citizen ? await appointmentsToday(citizen) : [];
    if (appointments.length === 0) {
      return done("You have no appointment today. To see a doctor, use New Specialist Visit.");
    }
    // One check-in per appointment: a second visit the same day checks in on its own.
    const checkIns = citizen ? await checkInsOf(citizen.id) : [];
    const open = appointments.filter((a) => !checkIns.some((c) => c.appointmentReference === a.reference));
    if (open.length === 0) return done(alreadyLine(checkIns[0]), wayTo(checkIns[0].department));
    const appt =
      open.find((a) => a.reference === ctx.data.appointmentReference) ?? (open.length === 1 ? open[0] : undefined);
    if (!appt) {
      const asked = appointments.find((a) => a.reference === ctx.data.appointmentReference);
      const checkedIn = asked && checkIns.find((c) => c.appointmentReference === asked.reference);
      return ask(checkedIn ? `${alreadyLine(checkedIn)} You have another visit today too.` : undefined, [
        {
          id: "appointmentReference",
          question: "Which appointment are you checking in for?",
          type: "options",
          options: open.map((a) => ({
            value: a.reference,
            label: `${clinicName(a.department)} at ${a.time} with ${a.doctor}`,
          })),
        },
      ]);
    }
    const asks: Ask[] = PRE_VISIT_QUESTIONS.filter((q) => !["yes", "no"].includes(ctx.data[q.id])).map((q) => ({
      id: q.id,
      question: q.question,
      type: "options",
      options: YES_NO,
    }));
    if (asks.length > 0) return ask("Two quick questions for the clinic before you check in.", asks);

    ctx.data.appointmentReference = appt.reference;
    ctx.data.department = appt.department;
    ctx.data.doctor = appt.doctor;
    ctx.data.time = appt.time;
    ctx.data.arrival = arrivalFor(appt.time).arrival;
    const note = arrivalNote(appt.time);
    ctx.notes.push(`Checking you in for ${clinicName(appt.department)} at ${appt.time} with ${appt.doctor}.` + (note ? ` ${note}` : ""));
    return READY;
  },
  file: async ({ caseId, data, documentNumber }) => {
    const citizen = documentNumber ? await findCitizenByDocument(documentNumber) : null;
    const again = citizen
      ? (await checkInsOf(citizen.id)).find((c) => c.appointmentReference === data.appointmentReference)
      : undefined;
    if (again) return { hold: alreadyLine(again) };
    const queueNumber = await nextQueueNumber(data.department);
    // "Notify clinic": the clinic's channel gets the arrival with the pre-visit answers; the board shows it too.
    const flags = [
      data.medsChanged === "yes" ? "medicines or allergies changed" : "",
      data.infection === "yes" ? "fever, cough or rash in the last 3 days" : "",
      data.arrival === "late" ? "arrived late" : "",
    ].filter(Boolean);
    const sent = await notify({
      channel: "clinic",
      to: clinicName(data.department),
      subject: `Arrived: ${queueNumber}`,
      body:
        `${queueNumber} checked in for the ${data.time} appointment with ${data.doctor} (case ${caseId}).` +
        (flags.length ? ` Flags: ${flags.join("; ")}.` : " No flags."),
      serviceId: "checkin",
      caseId,
    });
    return { data: { queueNumber, ...(sent?.delivered ? { clinicNotified: "yes" } : {}) } };
  },
  filed: async ({ status, data, documentNumber }) => {
    if (status === "on_hold" || !data.queueNumber) return "";
    const ticket = await ticketStatus(data.department, data.queueNumber);
    const wait = ticket.called
      ? "You're next — please go straight there."
      : `${ticket.ahead === 0 ? "You're next" : `${ticket.ahead} ${ticket.ahead === 1 ? "person" : "people"} ahead of you`}, about ${ticket.waitMinutes} minutes.`;
    // The kiosk offers Pay now under the ticket; the reply says why.
    const due = documentNumber ? outstandingBalance(await liveRecord(documentNumber)) : 0;
    return (
      `Your queue number is ${data.queueNumber}. ${wait} Go to ${departmentLocation(data.department)} and watch the screen for your number.` +
      (data.clinicNotified ? " The clinic has been told you're here." : "") +
      (due > 0 ? ` You also have ${formatMoney(due, CURRENCY)} to pay — you can settle it here now, while you wait.` : "")
    );
  },
  route: (data) => wayTo(data.department),
};
