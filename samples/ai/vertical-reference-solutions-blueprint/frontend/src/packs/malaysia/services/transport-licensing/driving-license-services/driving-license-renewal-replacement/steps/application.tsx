// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client";

import { useState } from "react";
import { Bike, CarFront, IdCard, RefreshCw, SearchX, ShieldAlert } from "lucide-react";
import { Notice } from "@/components/kiosk/notice";
import { RecordCard } from "@/components/kiosk/record-card";
import { StatusBlock } from "@/components/kiosk/status-block";
import { StepActions } from "@/components/kiosk/step-actions";
import { StepCard } from "@/components/kiosk/step-card";
import { useLicenses } from "@/hooks/use-kiosk-api";
import type { LicenseClass, LicenseRecord } from "@/lib/api/kiosk";
import { countOf, formatShortDate, hasExpired } from "@/lib/format";
import { ListHeading, OptionCards, SectionLabel } from "@/services/shared/fields";
import { LookupGate } from "@/services/shared/lookup";
import type { StepProps } from "@/services/shared/step-props";
import { StepShell } from "@/services/shared/step-shell";

const CLASS_LABELS: Record<LicenseClass, string> = {
  B2: "B2 · Motorcycle",
  D: "D · Car (Manual)",
  DA: "DA · Car (Auto)",
};

const REQUEST_TYPES = [
  { id: "renewal", label: "Renewal", hint: "Extend your CDL validity", icon: RefreshCw },
  { id: "replacement", label: "Replacement", hint: "Lost or damaged card · RM20", icon: ShieldAlert },
];

const DURATIONS = [
  { id: "1", label: "1 year", hint: "RM30" },
  { id: "2", label: "2 years", hint: "RM60" },
  { id: "3", label: "3 years", hint: "RM90" },
  { id: "5", label: "5 years", hint: "RM150" },
];

export default function RequestTypeStep({ state, actions }: StepProps) {
  const [licenseClass, setLicenseClass] = useState(state.data.licenseClass ?? "");
  const [requestType, setRequestType] = useState(state.data.requestType ?? "");
  const [duration, setDuration] = useState(state.data.duration ?? "");

  const lookup = useLicenses(state.identity?.documentNumber);
  const licenses = lookup.data?.licenses ?? [];
  const renewable = licenses.filter((license) => !license.cancelled);
  const selectedClass = licenseClass || (renewable.length === 1 ? renewable[0].licenseClass : "");
  const ready =
    Boolean(selectedClass) &&
    (requestType === "replacement" || (requestType === "renewal" && Boolean(duration)));

  return (
    <StepShell
      title="Your driving licenses"
      subtitle={`Licenses registered to ${state.profile?.name ?? "you"} in the JPJ records — you can only renew a class you hold.`}
      className="max-w-3xl"
    >
      <StepCard>
        <LookupGate
          lookup={lookup}
          icon={IdCard}
          title="Checking the JPJ registry…"
          description="Looking up driving licenses registered under your verified identity."
          errorMessage="The license registry could not be reached"
        >
          {licenses.length === 0 ? (
            <StatusBlock
              icon={SearchX}
              title="No license on record"
              description="No driving license is registered under your name in the JPJ records — use the New Driving License Application service instead."
            />
          ) : (
            <>
              <ListHeading>{countOf(licenses.length, "license")} on record</ListHeading>
              <div className="flex flex-col gap-4">
                {licenses.map((license) => (
                  <LicenseCard
                    key={license.licenseNo}
                    license={license}
                    selected={license.licenseClass === selectedClass}
                    onSelect={() => setLicenseClass(license.licenseClass)}
                  />
                ))}
              </div>
              {renewable.length === 0 ? (
                <Notice tone="danger" icon={ShieldAlert} className="mt-6">
                  All licenses on record expired more than 3 years ago and are cancelled under the
                  Road Transport Act — retake KPP02/KPP03 at a driving institute; renewal is not
                  possible at this kiosk.
                </Notice>
              ) : (
                <>
                  <SectionLabel>
                    What do you need for{" "}
                    {selectedClass
                      ? CLASS_LABELS[selectedClass as LicenseClass]
                      : "the selected license"}
                    ?
                  </SectionLabel>
                  <OptionCards
                    options={REQUEST_TYPES}
                    value={requestType}
                    onSelect={setRequestType}
                    columns={2}
                  />
                  {requestType === "renewal" && (
                    <>
                      <SectionLabel>Renewal duration (RM30 per year)</SectionLabel>
                      <OptionCards
                        options={DURATIONS}
                        value={duration}
                        onSelect={setDuration}
                        columns={4}
                      />
                    </>
                  )}
                </>
              )}
              <Notice className="mt-5">
                A license expired for more than 3 years is cancelled under the Road Transport Act —
                you must retake KPP02/KPP03 at a driving institute and cannot renew here.
              </Notice>
              {renewable.length > 0 && (
                <StepActions
                  ready={ready}
                  idleLabel="Select a license and option to continue"
                  onContinue={() =>
                    actions.stepCompleted("application", {
                      licenseClass: selectedClass,
                      requestType,
                      duration: requestType === "renewal" ? duration : "",
                      priceKey: requestType === "replacement" ? "replace" : duration,
                    })
                  }
                />
              )}
            </>
          )}
        </LookupGate>
      </StepCard>
    </StepShell>
  );
}

function LicenseCard({
  license,
  selected,
  onSelect,
}: {
  license: LicenseRecord;
  selected: boolean;
  onSelect: () => void;
}) {
  const expired = hasExpired(license.expiresAt);
  const status = license.cancelled
    ? { label: "Cancelled — expired > 3 years", tone: "danger" as const }
    : {
        label: `${expired ? "Expired" : "Expires"} ${formatShortDate(license.expiresAt)}`,
        tone: expired ? ("warning" as const) : ("success" as const),
      };

  return (
    <RecordCard
      icon={license.licenseClass === "B2" ? Bike : CarFront}
      title={CLASS_LABELS[license.licenseClass]}
      subtitle={`${license.licenseNo} · ${license.licenseType === "PDL" ? "Probationary (P)" : "Competent (CDL)"}`}
      status={status}
      selected={selected}
      onSelect={onSelect}
      unavailable={license.cancelled}
    />
  );
}
