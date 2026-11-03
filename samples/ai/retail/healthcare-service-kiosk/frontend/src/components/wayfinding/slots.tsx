// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { MapPin } from "lucide-react";
import type { KioskFlowActions } from "@/hooks/use-kiosk-flow";
import type { SlotFile } from "@/modules/slots";
import type { ServiceDefinition } from "@/services/types";
import { FindYourWay } from "./find-your-way";
import { RouteCard } from "./route-card";

/** The home screen's way into Indoor Navigation: a destination opens straight onto its route. */
function FindYourWayPanel({ service, actions }: { service: ServiceDefinition; actions: KioskFlowActions }) {
  return (
    <FindYourWay
      onRoute={(destination) => actions.startService(service, { destination, stepFree: "no" }, "result")}
      onBrowse={(section) =>
        section
          ? actions.startService(service, { browse: section }, "application")
          : actions.selectService(service)
      }
    />
  );
}

const wayfinding: SlotFile = {
  slots: {
    homePanels: [
      {
        id: "find-your-way",
        service: "directions",
        title: "Find your way",
        detail: "Clinics, wards and facilities",
        icon: MapPin,
        Panel: FindYourWayPanel,
      },
    ],
    routeCards: [RouteCard],
  },
};

export default wayfinding;
