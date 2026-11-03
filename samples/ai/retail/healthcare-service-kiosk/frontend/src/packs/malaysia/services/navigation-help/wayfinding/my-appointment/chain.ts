// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { findCitizenByDocument } from "@/app/api/_lib/citizens";
import { ask, done } from "@/app/api/_lib/flows/plan";
import type { ChainSpec } from "@/app/api/_lib/flows/types";
import { appointmentsToday, checkInsOf } from "@/app/api/_lib/patients";
import { department, departmentLocation } from "@/hospital/data";
import { destination, routeTo } from "@/hospital/wayfinding";
import { hospitalMap } from "@/hospital/wayfinding.server";
import { directionsMessage } from "../indoor-navigation/directions";
import { NO_APPOINTMENT } from "./visit";

const clinicName = (id: string) => department(id)?.name ?? id;

// Keep gates and wording in sync with the touch kiosk's steps/application.tsx.
export const chain: ChainSpec = {
  application: async (ctx) => {
    const citizen = await findCitizenByDocument(ctx.documentNumber);
    const appointments = citizen ? await appointmentsToday(citizen) : [];
    if (appointments.length === 0) return done(NO_APPOINTMENT);
    const appt =
      appointments.find((a) => a.reference === ctx.data.appointmentReference) ??
      (appointments.length === 1 ? appointments[0] : undefined);
    if (!appt) {
      return ask("You have more than one appointment today.", [
        {
          id: "appointmentReference",
          question: "Which appointment would you like directions to?",
          type: "options",
          options: appointments.map((a) => ({
            value: a.reference,
            label: `${clinicName(a.department)} at ${a.time} with ${a.doctor}`,
          })),
        },
      ]);
    }

    const checkIns = citizen ? await checkInsOf(citizen.id) : [];
    const checkedIn = checkIns.find((c) => c.appointmentReference === appt.reference);
    const visit =
      `Your ${appt.time} appointment is with ${appt.doctor} at ${clinicName(appt.department)}. ` +
      (checkedIn
        ? `You're checked in — your queue number is ${checkedIn.queueNumber}.`
        : "You haven't checked in yet — check in here first so the clinic knows you've arrived.");
    const place = destination(appt.department);
    const stepFree = ctx.data.stepFree === "yes";
    const map = hospitalMap();
    const route = map && place ? routeTo(map, place.id, stepFree) : null;
    const routed = map && route ? { map, route } : null;
    return done(
      [visit, place ? directionsMessage(place, routed) : departmentLocation(appt.department)].join("\n\n"),
      routed ? { destination: appt.department, stepFree } : undefined,
    );
  },
};
