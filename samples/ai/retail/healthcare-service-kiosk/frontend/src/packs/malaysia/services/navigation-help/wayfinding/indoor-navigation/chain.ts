// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { ask, done } from "@/app/api/_lib/flows/plan";
import type { ChainSpec } from "@/app/api/_lib/flows/types";
import { asksForAnyWard, DESTINATIONS, findDestination, routeTo } from "@/hospital/wayfinding";
import { hospitalMap } from "@/hospital/wayfinding.server";
import { getService } from "@/services";
import { directionsMessage } from "./directions";

/** "My appointment", "my doctor": only the patient's record says where that is — Way to My Appointment's job. */
const OWN_VISIT = /\bmy\s+(?:appointment|booking|doctor|clinic|visit|consultation)\b/i;

export const chain: ChainSpec = {
  application: (ctx) => {
    const said = ctx.data.destination ?? "";
    const map = hospitalMap();
    const destination = findDestination(map, said);
    if (!destination && OWN_VISIT.test(said) && getService("myappointment")) {
      return done(
        "Where your appointment is depends on your booking, so I'll need to know who you are first. " +
          'Say "take me to my appointment" and I\'ll look it up and show you the way.',
      );
    }
    if (!destination) {
      const anyWard = asksForAnyWard(said);
      return ask(said && !anyWard ? "I couldn't find that place in the hospital." : undefined, [
        {
          id: "destination",
          question: anyWard ? "Which ward are you visiting?" : "Where would you like to go?",
          type: "options",
          options: DESTINATIONS.filter((d) => !anyWard || d.kind === "ward").map((d) => ({ value: d.id, label: d.name })),
        },
      ]);
    }
    const stepFree = ctx.data.stepFree === "yes";
    const route = map ? routeTo(map, destination.id, stepFree) : null;
    const routed = map && route ? { map, route } : null;
    return done(
      directionsMessage(destination, routed),
      routed ? { destination: destination.id, stepFree } : undefined,
    );
  },
};
