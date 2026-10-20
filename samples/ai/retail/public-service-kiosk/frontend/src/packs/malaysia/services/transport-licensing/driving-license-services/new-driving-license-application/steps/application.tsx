// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client";

import { useState } from "react";
import { Bike, CarFront, CircleCheck, IdCard } from "lucide-react";
import { Notice } from "@/components/kiosk/notice";
import { StatusBlock } from "@/components/kiosk/status-block";
import { StepActions } from "@/components/kiosk/step-actions";
import { StepCard } from "@/components/kiosk/step-card";
import { useLicenses } from "@/hooks/use-kiosk-api";
import type { LicenseClass, LicenseRecord } from "@/lib/api/kiosk";
import { plural } from "@/lib/format";
import { OptionCards, type Option } from "@/services/shared/fields";
import { LookupGate } from "@/services/shared/lookup";
import type { StepProps } from "@/services/shared/step-props";
import { StepShell } from "@/services/shared/step-shell";

const CLASSES: (Option & { id: LicenseClass; minAge: number })[] = [
  { id: "B2", label: "B2 · Motorcycle", hint: "Up to 250cc · age 16+ · PDL RM2", icon: Bike, minAge: 16 },
  { id: "D", label: "D · Car (Manual)", hint: "Up to 3,500 kg · age 17+ · PDL RM60", icon: CarFront, minAge: 17 },
  { id: "DA", label: "DA · Car (Auto)", hint: "Automatic only · age 17+ · PDL RM60", icon: CarFront, minAge: 17 },
];

/** D covers automatics (blocks DA); cancelled licenses don't count as held. */
function availableClasses(age: number, licenses: LicenseRecord[]) {
  const held = new Set(licenses.filter((l) => !l.cancelled).map((l) => l.licenseClass));
  return CLASSES.filter((c) => {
    if (age < c.minAge || held.has(c.id)) return false;
    if (c.id === "DA" && held.has("D")) return false;
    return true;
  }).map((c) =>
    c.id === "D" && held.has("DA") ? { ...c, hint: "Upgrade from DA · age 17+ · PDL RM60" } : c,
  );
}

export default function LicenseClassStep({ state, actions }: StepProps) {
  const [licenseClass, setLicenseClass] = useState(state.data.licenseClass ?? "");

  const lookup = useLicenses(state.identity?.documentNumber);
  const licenses = lookup.data?.licenses ?? [];
  const heldActive = licenses.filter((l) => !l.cancelled);
  const options = availableClasses(state.profile?.age ?? 0, licenses);

  return (
    <StepShell
      title="Choose your license class"
      subtitle="You must have passed the KPP01 theory test (42/50) and the JPJ practical test for this class."
      className="max-w-3xl"
    >
      <StepCard>
        <LookupGate
          lookup={lookup}
          icon={IdCard}
          title="Checking the JPJ registry…"
          description="Checking which license classes are already registered under your identity."
          errorMessage="The license registry could not be reached"
        >
          {heldActive.length > 0 && (
            <Notice tone="success" icon={CircleCheck} className="mb-6">
              JPJ records show you already hold {plural(heldActive.length, "class", "classes")}{" "}
              {heldActive.map((l) => l.licenseClass).join(", ")} — only classes you don&apos;t
              hold are offered below.
            </Notice>
          )}
          {options.length === 0 ? (
            <StatusBlock
              icon={CircleCheck}
              iconClassName="text-success"
              title="Nothing to apply for"
              description="You already hold every license class this kiosk can issue. Use the Driving License Renewal service to extend an existing license."
            />
          ) : (
            <OptionCards options={options} value={licenseClass} onSelect={setLicenseClass} />
          )}
          <Notice className="mt-5">
            Class E (heavy vehicle) requires age 21+ and an existing class D license — apply at a
            JPJ counter. Your license starts as a 2-year Probationary (P) license.
          </Notice>
          {options.length > 0 && (
            <StepActions
              ready={Boolean(licenseClass)}
              idleLabel="Select a class to continue"
              onContinue={() => actions.stepCompleted("application", { licenseClass })}
            />
          )}
        </LookupGate>
      </StepCard>
    </StepShell>
  );
}
