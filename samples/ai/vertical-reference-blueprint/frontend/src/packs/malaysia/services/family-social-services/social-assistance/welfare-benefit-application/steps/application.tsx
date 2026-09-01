// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client";

import { useState } from "react";
import { Accessibility, Baby, BriefcaseBusiness, HeartHandshake, SearchX } from "lucide-react";
import { Notice } from "@/components/kiosk/notice";
import { StatusBlock } from "@/components/kiosk/status-block";
import { StepActions } from "@/components/kiosk/step-actions";
import { StepCard } from "@/components/kiosk/step-card";
import type { CitizenProfile } from "@/lib/api/kiosk";
import { OptionCards, TextField, type Option } from "@/services/shared/fields";
import type { StepProps } from "@/services/shared/step-props";
import { StepShell } from "@/services/shared/step-shell";

const SCHEMES: (Option & { eligible: (p: CitizenProfile) => boolean })[] = [
  {
    id: "bkk",
    label: "BKK · Child Aid",
    hint: "RM250/child ≤6, RM200 ages 7–18 (max RM1,000)",
    icon: Baby,
    eligible: (p) => p.childrenUnder18 > 0,
  },
  {
    id: "bwe",
    label: "BWE · Senior Citizen",
    hint: "RM600/month · age 60+",
    icon: HeartHandshake,
    eligible: (p) => p.age >= 60,
  },
  {
    id: "btb",
    label: "BTB · OKU Unable to Work",
    hint: "RM300/month · OKU card required",
    icon: Accessibility,
    eligible: (p) => p.isOku,
  },
  {
    id: "epoku",
    label: "EPOKU · OKU Worker",
    hint: "RM450/month · income RM100–1,700",
    icon: BriefcaseBusiness,
    eligible: (p) => p.isOku,
  },
];

export default function SchemeStep({ state, actions }: StepProps) {
  const profile = state.profile;
  const schemes = profile ? SCHEMES.filter((s) => s.eligible(profile)) : SCHEMES;
  const registryIncome = profile?.monthlyIncome ?? 0;

  const [scheme, setScheme] = useState(state.data.scheme ?? "");
  const [income, setIncome] = useState(
    state.data.income ?? (registryIncome ? String(registryIncome) : ""),
  );
  const valid =
    scheme.length > 0 && income.trim().length > 0 && schemes.some((s) => s.id === scheme);

  return (
    <StepShell
      title="Choose an aid scheme"
      subtitle={`JKM federal schemes ${profile ? "your registry record qualifies for" : "you are applying for"} — declare your household income.`}
      className="max-w-4xl"
    >
      <StepCard>
        {schemes.length === 0 ? (
          <StatusBlock
            icon={SearchX}
            title="No eligible scheme found"
            description={
              <>
                Based on your registry record (age {profile?.age}, no OKU registration or
                dependent children on file), none of the kiosk&apos;s federal aid schemes apply.
                Visit a JKM office if your circumstances have changed — for example to register
                as OKU or update your dependents.
              </>
            }
          />
        ) : (
          <>
            <OptionCards options={schemes} value={scheme} onSelect={setScheme} columns={2} />
            <div className="mt-6">
              <TextField
                id="income"
                label="Monthly Household Income (RM)"
                value={income}
                onChange={setIncome}
                placeholder="e.g. 2400"
              />
              {registryIncome > 0 && (
                <p className="mt-2 text-sm text-muted-foreground">
                  Registry income on file: RM{registryIncome.toLocaleString()} — your declaration
                  is cross-checked against LHDN records during the JKM investigation.
                </p>
              )}
            </div>
            <Notice className="mt-5">
              Eligibility is means-tested against the Poverty Line Income (PGK 2024: RM2,705
              household average) plus a JKM field investigation. Application is free; expect a
              decision about 30 working days after documents are complete.
            </Notice>
            <StepActions
              ready={valid}
              idleLabel="Select a scheme and enter income"
              onContinue={() =>
                actions.stepCompleted("application", { scheme, income: income.trim() })
              }
            />
          </>
        )}
      </StepCard>
    </StepShell>
  );
}
