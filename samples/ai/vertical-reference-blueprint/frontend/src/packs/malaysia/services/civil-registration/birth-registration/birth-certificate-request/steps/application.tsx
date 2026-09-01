// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client";

import { useState } from "react";
import { Notice } from "@/components/kiosk/notice";
import { StepActions } from "@/components/kiosk/step-actions";
import { StepCard } from "@/components/kiosk/step-card";
import { OptionCards, SectionLabel, TextField } from "@/services/shared/fields";
import type { StepProps } from "@/services/shared/step-props";
import { StepShell } from "@/services/shared/step-shell";

const TIMING = [
  { id: "normal", label: "Within 60 days", hint: "Free" },
  { id: "late", label: "More than 60 days", hint: "RM50 · extra documents required" },
];

const LATE_AFTER_DAYS = 60;

export default function ChildDetailsStep({ state, actions }: StepProps) {
  const [childName, setChildName] = useState(state.data.childName ?? "");
  const [childDob, setChildDob] = useState(state.data.childDob ?? "");
  const [birthPlace, setBirthPlace] = useState(state.data.birthPlace ?? "");
  const [timing, setTiming] = useState(state.data.timing ?? "normal");
  const valid = [childName, childDob, birthPlace].every((v) => v.trim().length > 0);

  // The manual timing choice is only a fallback for when the date of birth can't be parsed.
  const [now] = useState(() => Date.now());
  const parsedDob = Date.parse(childDob.trim());
  const daysSinceBirth = Number.isNaN(parsedDob)
    ? null
    : Math.floor((now - parsedDob) / 86_400_000);
  const autoTiming =
    daysSinceBirth == null ? null : daysSinceBirth > LATE_AFTER_DAYS ? "late" : "normal";
  const effectiveTiming = autoTiming ?? timing;

  return (
    <StepShell
      title="Child's details"
      subtitle="Enter the details exactly as on the hospital birth confirmation form."
      className="max-w-3xl"
    >
      <StepCard>
        <div className="grid gap-6 md:grid-cols-2">
          <TextField
            id="childName"
            label="Child's Full Name"
            value={childName}
            onChange={setChildName}
            placeholder="Full name"
            className="md:col-span-2"
          />
          <TextField
            id="childDob"
            label="Date of Birth"
            value={childDob}
            onChange={setChildDob}
            placeholder="e.g. 02 Jul 2026"
          />
          <TextField
            id="birthPlace"
            label="Place of Birth"
            value={birthPlace}
            onChange={setBirthPlace}
            placeholder="Hospital or address"
          />
        </div>
        {autoTiming ? (
          <Notice tone={autoTiming === "late" ? "warning" : "success"} className="mt-6">
            {autoTiming === "late"
              ? `This birth was ${daysSinceBirth} days ago — past the 60-day window, so the RM50 late-registration fee and extra documents apply.`
              : "This birth is within the 60-day registration window — registration is free."}
          </Notice>
        ) : (
          <>
            <SectionLabel>When was the child born?</SectionLabel>
            <OptionCards options={TIMING} value={timing} onSelect={setTiming} columns={2} />
          </>
        )}
        <Notice className="mt-5">
          Home births need a doctor&apos;s letter and a police report. Late registrations also
          need NRD.LM12, statutory declarations and the child&apos;s photos. You can apply for
          the child&apos;s MyKid at the same visit.
        </Notice>
        <StepActions
          ready={valid}
          idleLabel="Fill in all fields to continue"
          onContinue={() =>
            actions.stepCompleted("application", {
              childName: childName.trim(),
              childDob: childDob.trim(),
              birthPlace: birthPlace.trim(),
              timing: effectiveTiming,
            })
          }
        />
      </StepCard>
    </StepShell>
  );
}
