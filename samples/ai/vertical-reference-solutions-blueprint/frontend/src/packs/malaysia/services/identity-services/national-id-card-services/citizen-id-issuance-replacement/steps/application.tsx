// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client";

import { useState } from "react";
import { Globe2, IdCard, PenLine, ShieldAlert, Wrench } from "lucide-react";
import { Notice } from "@/components/kiosk/notice";
import { StepActions } from "@/components/kiosk/step-actions";
import { StepCard } from "@/components/kiosk/step-card";
import { formatMoney, kioskCurrency } from "@/lib/format";
import { OptionCards } from "@/services/shared/fields";
import type { StepProps } from "@/services/shared/step-props";
import { StatusStep, StepShell } from "@/services/shared/step-shell";

const CASES = [
  { id: "first", label: "First MyKad (Age 12)", hint: "Free within 30 days of birthday", icon: IdCard },
  { id: "lost", label: "Lost Card", hint: "RM110 / RM310 / RM1,010 by loss count", icon: ShieldAlert },
  { id: "damaged", label: "Damaged Card", hint: "RM10 · free within 12 months of issue", icon: Wrench },
  { id: "update", label: "Change of Particulars", hint: "Form JPN.KP16 · RM20", icon: PenLine },
];

/** Replacement fee tiers by cumulative loss count; capped at the third. */
const LOSS_FEES: Record<number, number> = { 1: 110, 2: 310, 3: 1010 };

export default function RequestTypeStep({ state, actions }: StepProps) {
  const [caseType, setCaseType] = useState(state.data.caseType ?? "");
  const profile = state.profile;

  const priorLosses = profile?.idCardLossCount ?? 0;
  const lossTier = Math.min(priorLosses + 1, 3);
  // First MyKad is only offered around the 12th birthday; adults already hold one.
  const cases = CASES.filter((c) => c.id !== "first" || (profile?.age ?? 99) <= 12);
  const ready = caseType.length > 0;

  if (profile && profile.country !== "Malaysia") {
    return (
      <StatusStep
        title="MyKad services unavailable"
        subtitle="This service is for Malaysian citizens only."
        icon={Globe2}
        heading="Your record shows a foreign passport"
        description="MyKad is issued to Malaysian citizens under the National Registration Regulations. For foreign identity documents, please contact the Immigration Department (JIM) or your embassy."
      />
    );
  }

  return (
    <StepShell
      title="What do you need?"
      subtitle="Choose the type of MyKad request."
      className="max-w-4xl"
    >
      <StepCard>
        <OptionCards options={cases} value={caseType} onSelect={setCaseType} columns={2} />
        {caseType === "lost" && (
          <Notice tone="warning" icon={ShieldAlert} className="mt-6">
            JPN records show {priorLosses} previous lost-card report{priorLosses === 1 ? "" : "s"} —
            this replacement is loss #{priorLosses + 1}, so the fee is{" "}
            {formatMoney(LOSS_FEES[lossTier], kioskCurrency())}
            {priorLosses >= 1 ? " and a police report is required" : ""}.
          </Notice>
        )}
        <Notice className="mt-5">
          A police report is compulsory from the second loss, or for any loss through crime.
          Fee exemptions are available for the poor, OKU and disaster victims with a support
          letter from JKM or the local penghulu.
        </Notice>
        <StepActions
          ready={ready}
          idleLabel="Select an option to continue"
          onContinue={() =>
            actions.stepCompleted("application", {
              caseType,
              lossCount: caseType === "lost" ? String(priorLosses + 1) : "",
              priceKey: caseType === "lost" ? `lost${lossTier}` : caseType,
            })
          }
        />
      </StepCard>
    </StepShell>
  );
}
