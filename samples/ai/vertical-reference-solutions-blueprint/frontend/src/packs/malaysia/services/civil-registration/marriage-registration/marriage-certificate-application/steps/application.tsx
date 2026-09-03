// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client";

import { useState } from "react";
import { Building2, Church, HeartHandshake, MoonStar, PartyPopper } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Notice } from "@/components/kiosk/notice";
import { StepActions } from "@/components/kiosk/step-actions";
import { StepCard } from "@/components/kiosk/step-card";
import { OptionCards, TextField } from "@/services/shared/fields";
import type { StepProps } from "@/services/shared/step-props";
import { StatusStep, StepShell } from "@/services/shared/step-shell";

const VENUES = [
  { id: "office", label: "JPN Office", hint: "Any NRD office · RM30", icon: Building2 },
  { id: "worship", label: "House of Worship", hint: "Appointed registrar · RM30", icon: Church },
  { id: "other", label: "Other Venue", hint: "Home/hotel · KC01E licence +RM500", icon: PartyPopper },
];

export default function CeremonyDetailsStep({ state, actions }: StepProps) {
  const [venueType, setVenueType] = useState(state.data.venueType ?? "");
  const [date, setDate] = useState(state.data.date ?? "");
  const [witness1, setWitness1] = useState(state.data.witness1 ?? "");
  const [witness2, setWitness2] = useState(state.data.witness2 ?? "");
  const valid =
    venueType.length > 0 &&
    [date, witness1, witness2].every((v) => v.trim().length > 0);
  const profile = state.profile;

  if (profile?.religion === "Islam") {
    return (
      <Ineligible
        icon={MoonStar}
        title="This service is for non-Muslim marriages"
        body="Registry records show you are Muslim. Civil marriage under the Law Reform (Marriage and Divorce) Act 1976 applies to non-Muslims only — please apply through your State Islamic Religious Department (Jabatan Agama Islam / Syariah Court)."
      />
    );
  }
  if (profile?.maritalStatus === "married") {
    return (
      <Ineligible
        icon={HeartHandshake}
        title="An existing marriage is on record"
        body="NRD records show you are currently married. A new notice of marriage (JPN.KC02) cannot be filed until the existing marriage is dissolved — please visit a JPN counter with your divorce or death certificate."
      />
    );
  }

  return (
    <StepShell
      title="Ceremony details"
      subtitle="Where do you intend to solemnize the marriage, and who are your two witnesses?"
      className="max-w-3xl"
    >
      <StepCard>
        <OptionCards options={VENUES} value={venueType} onSelect={setVenueType} />
        <div className="mt-6 grid gap-6 md:grid-cols-2">
          <TextField
            id="date"
            label="Intended Date"
            value={date}
            onChange={setDate}
            placeholder="e.g. 12 Sep 2026"
            className="md:col-span-2"
          />
          <TextField
            id="witness1"
            label="Witness 1"
            value={witness1}
            onChange={setWitness1}
            placeholder="Full name"
          />
          <TextField
            id="witness2"
            label="Witness 2"
            value={witness2}
            onChange={setWitness2}
            placeholder="Full name"
          />
        </div>
        {profile && profile.age < 21 && (
          <Notice tone="warning" className="mt-5">
            The registry shows you are {profile.age} — applicants aged 18–20 must attach form
            KC01B (parental consent) with their documents.
          </Notice>
        )}
        <Notice className="mt-5">
          Your notice of marriage is displayed at JPN for 21 days; the ceremony takes place
          after that and within 6 months of this application. Both parties must be 21+ (18–20
          needs form KC01B parental consent). Two credible witnesses are required.
        </Notice>
        <StepActions
          ready={valid}
          idleLabel="Fill in venue, date and witnesses"
          onContinue={() =>
            actions.stepCompleted("application", {
              venueType,
              date: date.trim(),
              witness1: witness1.trim(),
              witness2: witness2.trim(),
            })
          }
        />
      </StepCard>
    </StepShell>
  );
}

function Ineligible({ icon, title, body }: { icon: LucideIcon; title: string; body: string }) {
  return (
    <StatusStep
      title="Marriage registration"
      subtitle="Eligibility is checked against the national registry."
      icon={icon}
      heading={title}
      description={body}
    />
  );
}
