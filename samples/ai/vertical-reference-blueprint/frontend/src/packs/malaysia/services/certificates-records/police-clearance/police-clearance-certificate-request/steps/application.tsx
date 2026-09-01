// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client";

import { useState } from "react";
import {
  Briefcase,
  Flag,
  GraduationCap,
  IdCard,
  MoreHorizontal,
  Users,
} from "lucide-react";
import { Notice } from "@/components/kiosk/notice";
import { StepActions } from "@/components/kiosk/step-actions";
import { StepCard } from "@/components/kiosk/step-card";
import { OptionCards, TextField } from "@/services/shared/fields";
import type { StepProps } from "@/services/shared/step-props";
import { StepShell } from "@/services/shared/step-shell";

const PURPOSES = [
  { id: "studies", label: "Further Studies", icon: GraduationCap },
  { id: "working", label: "Working", icon: Briefcase },
  { id: "family", label: "Accompanying Family", icon: Users },
  { id: "pr", label: "Permanent Resident", icon: IdCard },
  { id: "citizenship", label: "Citizenship", icon: Flag },
  { id: "others", label: "Others", icon: MoreHorizontal },
];

export default function PurposeStep({ state, actions }: StepProps) {
  const [purpose, setPurpose] = useState(state.data.purpose ?? "");
  const [country, setCountry] = useState(state.data.country ?? "");
  const valid = purpose.length > 0 && country.trim().length > 0;

  return (
    <StepShell
      title="Purpose of request"
      subtitle="As on the e-Konsular application — the purpose and destination are printed on the certificate."
      className="max-w-4xl"
    >
      <StepCard>
        <OptionCards options={PURPOSES} value={purpose} onSelect={setPurpose} />
        <div className="mt-6">
          <TextField
            id="country"
            label="Destination Country"
            value={country}
            onChange={setCountry}
            placeholder="e.g. Singapore"
          />
        </div>
        {state.profile?.requiresOfficerReview && (
          <Notice tone="warning" className="mt-5">
            An open case is attached to your registry record — your application will be routed
            to a PDRM officer for manual vetting before the certificate can be released.
          </Notice>
        )}
        <Notice className="mt-5">
          PDRM vetting takes about 1–3 months. Once approved, the digital certificate is issued
          for download and is valid for 1 year — some receiving countries require one issued
          within the last 6 months.
        </Notice>
        <StepActions
          ready={valid}
          idleLabel="Select a purpose and destination"
          onContinue={() =>
            actions.stepCompleted("application", { purpose, country: country.trim() })
          }
        />
      </StepCard>
    </StepShell>
  );
}
