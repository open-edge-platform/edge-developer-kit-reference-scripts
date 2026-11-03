// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client";

import { PatientCard } from "@/components/kiosk/patient-card";
import { displayMrn } from "@/hospital/patient-id";
import type { StepProps } from "@/services/shared/step-props";
import { Receipt } from "@/services/shared/steps/receipt";

/** A new patient walks away with their patient card — unless the counter still has to check the registration, when the case card says why. */
export default function RegistrationReceipt(props: StepProps) {
  const { data, profile, application } = props.state;
  const takeaway =
    data.mrn && application?.status === "in_review"
      ? {
          title: "Welcome — you're registered",
          detail: `Your record number is ${displayMrn(data.mrn)}. Use your patient card to sign in next time.`,
          artifact: <PatientCard name={profile?.name ?? ""} mrn={data.mrn} />,
          printCode: data.mrn,
        }
      : null;
  return <Receipt {...props} takeaway={takeaway} />;
}
