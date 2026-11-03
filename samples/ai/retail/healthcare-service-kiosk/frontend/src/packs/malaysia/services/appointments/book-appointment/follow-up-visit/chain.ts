// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { CONFIRM_SAY, bookingFiled, confirmAsk, fileBooking, freeSlots, slotRound } from "@/app/api/_lib/booking";
import { liveRecord } from "@/app/api/_lib/ledger";
import { ask, done, READY } from "@/app/api/_lib/flows/plan";
import type { ChainSpec } from "@/app/api/_lib/flows/types";
import { department } from "@/hospital/data";
import type { FollowUp } from "@/hospital/records";
import { formatShortDate } from "@/lib/format";
import { followUpDoctor, followUpSlots } from "./followup";

const bookedLine = (booked: NonNullable<FollowUp["booked"]>) =>
  `Your follow-up is already booked with ${booked.doctorName} on ${formatShortDate(booked.date)} at ${booked.time} ` +
  `(reference ${booked.caseId}). To change it, please see the registration counter.`;

// Keep gates and question text in sync with the touch kiosk's steps/application.tsx.
export const chain: ChainSpec = {
  application: async (ctx) => {
    const record = await liveRecord(ctx.documentNumber);
    const followUp = record.followUp;
    if (!followUp) {
      return done("There is no follow-up recommended on your record. To see a specialist, use New Specialist Visit.");
    }
    if (followUp.booked) return done(bookedLine(followUp.booked));
    const doctor = followUpDoctor(record);
    if (!doctor) {
      return done("Your recommended follow-up doctor is not available for booking — please see the counter.");
    }
    if (ctx.data.confirmBooking === "change") {
      delete ctx.data.slot;
      delete ctx.data.confirmBooking;
    }
    const free = await freeSlots(doctor.id, followUpSlots(record, 4));
    const round = slotRound(
      ctx.data,
      doctor,
      free,
      "Which slot works for you?",
      `${doctor.name} recommended a follow-up in ${followUp.inWeeks} weeks in ${department(followUp.department)!.name}.`,
    );
    if (round) return round;
    const [date, time] = ctx.data.slot.split(" ");
    if (ctx.data.confirmBooking !== "yes") {
      return ask(CONFIRM_SAY, [confirmAsk(followUp.doctor, department(followUp.department)!.name, date, time)]);
    }
    ctx.data.department = followUp.department;
    ctx.data.doctorId = doctor.id;
    ctx.data.doctorName = followUp.doctor;
    ctx.data.date = date;
    ctx.data.time = time;
    return READY;
  },
  file: fileBooking,
  filed: bookingFiled,
  duplicate: async (ctx) => {
    const booked = (await liveRecord(ctx.documentNumber)).followUp?.booked;
    return booked ? bookedLine(booked) : "Your follow-up is already booked — see My Requests for the details.";
  },
};
