// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client";

import { useEffect, useRef, useState } from "react";
import { BedDouble, MapPin, MonitorDot } from "lucide-react";
import { StepActions } from "@/components/kiosk/step-actions";
import { StepCard } from "@/components/kiosk/step-card";
import { FACILITY_ICONS } from "@/components/wayfinding/find-your-way";
import { StepFreeToggle } from "@/components/wayfinding/route-view";
import { WARDS, type WardGroup } from "@/hospital/data";
import { DESTINATIONS, destination as findById, wardDetail } from "@/hospital/wayfinding";
import { ListHeading, OptionCards } from "@/services/shared/fields";
import { resultData } from "@/services/shared/result";
import type { StepProps } from "@/services/shared/step-props";
import { StepShell } from "@/services/shared/step-shell";
import { directionsResult } from "../directions";

const options = (kind: "department" | "facility") =>
  DESTINATIONS.filter((d) => d.kind === kind).map((d) => ({
    id: d.id,
    label: d.name,
    hint: d.hint,
    icon: FACILITY_ICONS[d.id] ?? MapPin,
  }));

const wardOptions = (group: WardGroup) =>
  WARDS.filter((w) => w.group === group).map((w) => ({
    id: w.id,
    label: w.name,
    hint: wardDetail(w),
    icon: group === "intensive" ? MonitorDot : BedDouble,
  }));

export default function DestinationStep({ state, actions }: StepProps) {
  const [destination, setDestination] = useState(state.data.destination ?? "");
  const [stepFree, setStepFree] = useState(state.data.stepFree === "yes");
  const chosen = findById(destination);
  const wards = useRef<HTMLDivElement>(null);
  const browseWards = state.data.browse === "wards";
  useEffect(() => {
    if (browseWards) wards.current?.scrollIntoView({ block: "start" });
  }, [browseWards]);

  return (
    <StepShell title="Where would you like to go?" subtitle="Choose a clinic, ward or facility." className="max-w-6xl">
      <StepCard className="overflow-visible">
        <ListHeading>Clinics and departments</ListHeading>
        <OptionCards
          options={options("department")}
          value={destination}
          onSelect={setDestination}
          columns={4}
          prompt={browseWards ? false : undefined}
        />
        <ListHeading className="mt-8">Facilities</ListHeading>
        <OptionCards options={options("facility")} value={destination} onSelect={setDestination} columns={4} prompt={false} />
        <div ref={wards} className="scroll-mt-6">
          <ListHeading className="mt-8">Wards</ListHeading>
        </div>
        <OptionCards
          options={wardOptions("numbered")}
          value={destination}
          onSelect={setDestination}
          columns={4}
          prompt={browseWards ? "Tap the ward you are visiting" : false}
        />
        <ListHeading className="mt-8">Intensive care</ListHeading>
        <OptionCards options={wardOptions("intensive")} value={destination} onSelect={setDestination} columns={4} prompt={false} />
        <ListHeading className="mt-8">Other wards</ListHeading>
        <OptionCards options={wardOptions("other")} value={destination} onSelect={setDestination} columns={4} prompt={false} />
        <div className="sticky bottom-0 z-10 -mx-5 -mb-5 mt-8 flex flex-wrap items-center justify-between gap-4 rounded-b-3xl border-t bg-card/95 px-5 py-4 backdrop-blur sm:-mx-9 sm:-mb-9 sm:px-9">
          <StepFreeToggle value={stepFree} onChange={setStepFree} />
          <StepActions
            className="mt-0"
            ready={Boolean(chosen)}
            idleLabel="Select a destination"
            label="Show directions"
            onContinue={() => {
              const picked = findById(destination);
              if (!picked) return;
              actions.stepCompleted("application", {
                destination,
                stepFree: stepFree ? "yes" : "no",
                ...resultData(directionsResult(picked)),
              });
            }}
          />
        </div>
      </StepCard>
    </StepShell>
  );
}
