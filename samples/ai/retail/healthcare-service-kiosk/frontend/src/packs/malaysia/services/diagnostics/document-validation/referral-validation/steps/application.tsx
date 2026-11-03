// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileSearch, Stethoscope, UserRound } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { Notice } from "@/components/kiosk/notice";
import { ReadBackRow } from "@/components/kiosk/read-back";
import { StepActions } from "@/components/kiosk/step-actions";
import { StepCard } from "@/components/kiosk/step-card";
import { readDocument } from "@/lib/api/document-ai";
import { awaitingPatient, displayDay, needsStaff, type FieldCheck } from "@/lib/document-fields";
import { ListHeading, OptionCards, SectionLabel, TextField } from "@/services/shared/fields";
import type { StepProps } from "@/services/shared/step-props";
import { StepShell } from "@/services/shared/step-shell";
import { department } from "@/hospital/data";
import {
  DATE_QUESTION,
  DEPARTMENT_OPTIONS,
  DEPARTMENT_QUESTION,
  EMPTY_REFERRAL,
  REFERRER_LABEL,
  checkFor,
  checkReferral,
  readingFromData,
  referralData,
  typedDate,
  type ReferralField,
  type ReferralRead,
  type ReferralReading,
} from "../referral";
import { REFERRAL_VALID_MONTHS } from "../validate";
import { maskId } from "@/lib/mask";

const TITLE = "Review your referral";

export default function ReferralReviewStep({ service, state, actions }: StepProps) {
  const serviceId = service?.id ?? "";
  const letter = state.documents.referral;
  const documentNumber = state.identity?.documentNumber ?? "";
  const profile = state.identity?.profile;
  const [departmentEdit, setDepartmentEdit] = useState<string | null>(null);
  const [dateEdit, setDateEdit] = useState<string | null>(null);
  const [open, setOpen] = useState({ department: false, date: false });

  const read = useQuery({
    queryKey: ["document-ai", serviceId, "referral", letter?.uploadedAt],
    queryFn: () =>
      readDocument<ReferralRead>({
        serviceId,
        documentId: "referral",
        documentNumber,
        uploadedAt: letter?.uploadedAt ?? "",
      }),
    enabled: Boolean(serviceId && letter && documentNumber),
    retry: false,
    staleTime: Infinity,
  });

  if (read.isFetching && !read.data) {
    return (
      <StepShell title={TITLE} subtitle="Reading the details on your referral letter…" className="max-w-4xl">
        <StepCard className="flex flex-col items-center gap-5 py-16 text-center">
          <Spinner className="size-12 text-primary" />
          <div className="text-xl font-semibold">Reading your letter</div>
        </StepCard>
      </StepShell>
    );
  }

  const base = read.data?.reading ?? (state.data.referralSource ? readingFromData(state.data) : EMPTY_REFERRAL);
  const reading: ReferralReading = {
    ...base,
    ...(departmentEdit !== null ? { department: departmentEdit, departmentCue: "patient" as const } : {}),
    ...(dateEdit !== null ? { referralDate: typedDate(dateEdit) || null, dateFrom: "patient" as const } : {}),
  };
  const patient = { name: profile?.name ?? "", nationalId: profile?.nationalId ?? "" };
  const checks = checkReferral(reading, patient);
  const row = (field: ReferralField) => checkFor(checks, field);
  const date = row("referralDate");
  const dept = row("department");
  const showDate = open.date || dateEdit !== null || date.status === "ask";
  const showDept = open.department || departmentEdit !== null || dept.status !== "ok";
  const staff = checks.filter((c) => c.status === "staff");
  const unread = !read.data;

  return (
    <StepShell
      title={TITLE}
      subtitle={
        unread
          ? "We couldn't read your letter automatically — fill in the clinic and date below."
          : "Here's what we read from your letter. Fix anything marked — staff check the rest."
      }
      className="max-w-4xl"
    >
      <StepCard>
        <ListHeading className="flex items-center gap-2">
          <FileSearch className="size-5" /> From your referral letter
        </ListHeading>
        <ReadBackRow label="Patient" value={reading.patientName} {...status(row("patientName"))} />
        <ReadBackRow
          label="IC number"
          value={reading.patientIc ? maskId(reading.patientIc) : "Not printed"}
          {...status(row("patientIc"))}
        />
        <ReadBackRow label="Referring doctor" value={reading.referringDoctor} {...status(row("referringDoctor"))} />
        <ReadBackRow label="MMC number" value={reading.mmcNumber} {...status(row("mmcNumber"))} />
        <ReadBackRow
          label="Clinic"
          value={[reading.clinicName, REFERRER_LABEL[reading.referrerType]].filter(Boolean).join(" · ")}
          {...status(row("clinicName"))}
        />
        <ReadBackRow
          label="Referral date"
          value={displayDay(reading.referralDate) || reading.referralDate}
          {...status(date)}
          onChange={() => setOpen((o) => ({ ...o, date: true }))}
        >
          {showDate && (
            <TextField
              id="referralDate"
              label={DATE_QUESTION}
              value={dateEdit ?? base.referralDate ?? ""}
              onChange={setDateEdit}
              placeholder="YYYY-MM-DD"
              hint={`Referrals older than ${REFERRAL_VALID_MONTHS} months are checked by staff.`}
            />
          )}
        </ReadBackRow>
        <ReadBackRow
          label="Referred to"
          value={reading.department ? (department(reading.department)?.name ?? "Not listed") : null}
          {...status(dept)}
          onChange={() => setOpen((o) => ({ ...o, department: true }))}
        >
          {showDept && (
            <>
              <SectionLabel className="mt-0">{DEPARTMENT_QUESTION}</SectionLabel>
              <OptionCards
                options={DEPARTMENT_OPTIONS.map((o) => ({ id: o.id, label: o.label, icon: Stethoscope }))}
                value={reading.department}
                onSelect={setDepartmentEdit}
                columns={3}
                prompt={false}
              />
            </>
          )}
        </ReadBackRow>
        {reading.reason && <ReadBackRow label="Reason" value={reading.reason} status="ok" />}

        {staff.length > 0 && (
          <Notice tone="warning" icon={UserRound} className="mt-6">
            A staff member will review this referral before your visit: {staff.map((c) => c.note).join("; ")}.
            You can still continue.
          </Notice>
        )}
        <StepActions
          ready={!awaitingPatient(checks)}
          idleLabel="Answer the marked questions to continue"
          label={needsStaff(checks) ? "Send for staff review" : "Confirm referral"}
          onContinue={() =>
            actions.stepCompleted(
              "application",
              referralData(reading, checks, read.data?.readBy ?? "manual", letter?.uploadedAt ?? ""),
            )
          }
        />
      </StepCard>
    </StepShell>
  );
}

const status = ({ status, note }: FieldCheck) => ({ status, note });
