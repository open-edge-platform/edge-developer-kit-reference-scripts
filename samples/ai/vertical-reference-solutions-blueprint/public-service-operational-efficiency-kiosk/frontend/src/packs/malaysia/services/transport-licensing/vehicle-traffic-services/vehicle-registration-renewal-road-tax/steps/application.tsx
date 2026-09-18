// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client";

import { useState } from "react";
import { CarFront, SearchX, ShieldAlert } from "lucide-react";
import { Notice } from "@/components/kiosk/notice";
import { RecordCard } from "@/components/kiosk/record-card";
import { StatusBlock } from "@/components/kiosk/status-block";
import { StepActions } from "@/components/kiosk/step-actions";
import { StepCard } from "@/components/kiosk/step-card";
import { useVehicles } from "@/hooks/use-kiosk-api";
import type { VehicleRecord } from "@/lib/api/kiosk";
import { countOf, formatMoney, formatShortDate, hasExpired, kioskCurrency, plural } from "@/lib/format";
import { roadTaxFor } from "@/lib/road-tax";
import { ListHeading, OptionCards, SectionLabel } from "@/services/shared/fields";
import { LookupGate } from "@/services/shared/lookup";
import type { StepProps } from "@/services/shared/step-props";
import { StepShell } from "@/services/shared/step-shell";

function periodsFor(vehicle: VehicleRecord | undefined) {
  return [
    {
      id: "6",
      label: "6 months",
      hint: vehicle ? formatMoney(roadTaxFor(vehicle.engineCc, 6), kioskCurrency()) : "Half the annual rate",
    },
    {
      id: "12",
      label: "12 months",
      hint: vehicle
        ? formatMoney(roadTaxFor(vehicle.engineCc, 12), kioskCurrency())
        : "Based on engine capacity",
    },
  ];
}

export default function VehicleSelectStep({ state, actions }: StepProps) {
  const [plate, setPlate] = useState(state.data.plate ?? "");
  const [period, setPeriod] = useState(state.data.period ?? "12");

  const lookup = useVehicles(state.identity?.documentNumber);
  const vehicles = lookup.data?.vehicles ?? [];
  const selectedPlate = plate || (vehicles.length === 1 ? vehicles[0].plateNumber : "");
  const selectedVehicle = vehicles.find((v) => v.plateNumber === selectedPlate);
  const fines = state.profile?.outstandingFines;

  return (
    <StepShell
      title="Select your vehicle"
      subtitle={`Vehicles registered to ${state.profile?.name ?? "you"} in the JPJ ownership records.`}
      className="max-w-2xl"
    >
      <StepCard>
        <LookupGate
          lookup={lookup}
          icon={CarFront}
          title="Checking the JPJ registry…"
          description="Looking up vehicles registered under your verified identity."
          errorMessage="The vehicle registry could not be reached"
        >
          {vehicles.length === 0 ? (
            <StatusBlock
              icon={SearchX}
              title="No vehicles found"
              description="No vehicles are registered under your name in the JPJ records. Please visit a JPJ counter if you believe this is an error."
            />
          ) : (
            <>
              <ListHeading>{countOf(vehicles.length, "vehicle")} found</ListHeading>
              <div className="flex flex-col gap-4">
                {vehicles.map((vehicle) => {
                  const expired = hasExpired(vehicle.roadTaxExpiry);
                  return (
                    <RecordCard
                      key={vehicle.plateNumber}
                      icon={CarFront}
                      title={vehicle.plateNumber}
                      subtitle={`${vehicle.model} · ${vehicle.year} · ${vehicle.engineCc}cc`}
                      status={{
                        label: `${expired ? "Expired" : "Expires"} ${formatShortDate(vehicle.roadTaxExpiry)}`,
                        tone: expired ? "danger" : "success",
                      }}
                      selected={vehicle.plateNumber === selectedPlate}
                      onSelect={() => setPlate(vehicle.plateNumber)}
                    />
                  );
                })}
              </div>
              <SectionLabel>
                Renewal period{selectedVehicle ? ` — ${selectedVehicle.engineCc}cc rate` : ""}
              </SectionLabel>
              <OptionCards
                options={periodsFor(selectedVehicle)}
                value={period}
                onSelect={setPeriod}
                columns={2}
              />
              {fines && fines.count > 0 && (
                <Notice tone="danger" icon={ShieldAlert} className="mt-5">
                  JPJ records show {fines.count} unpaid {plural(fines.count, "summons", "summonses")}{" "}
                  totalling {formatMoney(fines.total, kioskCurrency())} — your renewal will be held until they
                  are settled at the Traffic Fine Payment service.
                </Notice>
              )}
              <Notice className="mt-5">
                Active motor insurance is verified in real time via eINSURANS, and blacklisted
                outstanding summonses must be settled before renewal. Your e-LKM is issued digitally
                in MyJPJ — no physical disc since Feb 2024.
              </Notice>
              <StepActions
                ready={Boolean(selectedPlate)}
                label={`Renew ${selectedPlate}`}
                idleLabel="Select a vehicle to continue"
                onContinue={() =>
                  actions.stepCompleted("application", { plate: selectedPlate, period })
                }
              />
            </>
          )}
        </LookupGate>
      </StepCard>
    </StepShell>
  );
}
