// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client";

import { PatientCard } from "@/components/kiosk/patient-card";
import { PrintButton } from "@/components/kiosk/print-button";
import type { TakeawayProps } from "@/packs/malaysia/steps";

/** No card while the counter still has to check the registration. */
export default function RegistrationTakeaway({ data, name, status }: TakeawayProps) {
  if (!data.mrn || status !== "in_review") return null;
  return (
    <>
      <PatientCard name={name} mrn={data.mrn} />
      <PrintButton code={data.mrn} label="Print my card" />
    </>
  );
}
