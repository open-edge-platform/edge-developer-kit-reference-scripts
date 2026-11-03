// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client";

import { useState } from "react";
import { IdCard, UserCheck } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { LoadFailed } from "@/components/kiosk/status-block";
import { StepActions } from "@/components/kiosk/step-actions";
import { StepCard } from "@/components/kiosk/step-card";
import { usePriorCase } from "@/hooks/use-kiosk-api";
import { displayMrn } from "@/hospital/patient-id";
import { patientRecord } from "@/hospital/records";
import { ChoiceChips, SectionLabel, TextField } from "@/services/shared/fields";
import type { StepProps } from "@/services/shared/step-props";
import { StatusStep, StepShell } from "@/services/shared/step-shell";
import { alreadyRegistered, LANGUAGES } from "../registered";

/** What the new record still needs once the MyKad was read and the photo taken (the enroll step). */
export default function DetailsStep({ service, state, actions }: StepProps) {
  const profile = state.profile!;
  const documentNumber = state.identity!.documentNumber;
  const record = patientRecord(documentNumber);
  const prior = usePriorCase(service!.id, documentNumber);

  const [phone, setPhone] = useState(state.data.phone || profile.phone);
  const [language, setLanguage] = useState(state.data.language ?? "");
  const [emergencyName, setEmergencyName] = useState(state.data.emergencyName ?? "");
  const [emergencyPhone, setEmergencyPhone] = useState(state.data.emergencyPhone ?? "");

  const ready = Boolean(phone.trim() && language && emergencyName.trim() && emergencyPhone.trim());

  if (prior.isPending) {
    return (
      <StepShell title="A few more details" subtitle="Checking your patient record…" className="max-w-3xl">
        <StepCard className="flex justify-center py-16">
          <Spinner className="size-12 text-primary" />
        </StepCard>
      </StepShell>
    );
  }
  if (prior.isError) {
    return <LoadFailed message="Could not check your patient record" onRetry={() => prior.refetch()} />;
  }
  if (prior.data.prior) {
    return (
      <StatusStep
        title="Create Patient Record"
        icon={UserCheck}
        heading="Welcome back"
        description={alreadyRegistered(record.mrn)}
      />
    );
  }

  return (
    <StepShell title="A few more details" subtitle={`Welcome, ${profile.name.split(" ")[0]} — your record is created.`} className="max-w-3xl">
      <StepCard>
        <div className="flex items-center justify-between gap-4 border-b pb-4 text-lg">
          <span className="flex items-center gap-2 font-semibold">
            <IdCard className="size-5 text-primary" />
            Your new MRN
          </span>
          <span className="font-bold text-primary">{displayMrn(record.mrn)}</span>
        </div>

        <SectionLabel>Your mobile number</SectionLabel>
        <TextField id="phone" label="Phone number" value={phone} onChange={setPhone} placeholder="012-3456789" />

        <SectionLabel>Preferred language</SectionLabel>
        <ChoiceChips
          label="Preferred language"
          options={LANGUAGES.map((l) => ({ id: l, label: l }))}
          value={language}
          onSelect={setLanguage}
          prompt="Choose the language you're most comfortable with"
        />

        <SectionLabel>Emergency contact</SectionLabel>
        <div className="grid gap-5 md:grid-cols-2">
          <TextField id="emergencyName" label="Full name" value={emergencyName} onChange={setEmergencyName} placeholder="Full name" />
          <TextField id="emergencyPhone" label="Phone number" value={emergencyPhone} onChange={setEmergencyPhone} placeholder="012-3456789" />
        </div>

        <StepActions
          ready={ready}
          idleLabel="Fill in the details above to continue"
          onContinue={() =>
            actions.stepCompleted("application", { phone, language, emergencyName, emergencyPhone, mrn: record.mrn })
          }
        />
      </StepCard>
    </StepShell>
  );
}
