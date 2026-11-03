// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client";

import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api/client";
import { applyLedger, EMPTY_LEDGER, patientRecord, type Ledger, type PatientRecord } from "@/hospital/records";

/** The patient's record with what the kiosk already did applied (a paid bill, a refill); null until known. */
export function useLiveRecord(documentNumber: string): PatientRecord | null {
  const ledger = useQuery({
    queryKey: ["ledger", documentNumber],
    queryFn: () => apiGet<Ledger>(`/ledger?documentNumber=${encodeURIComponent(documentNumber)}`),
    enabled: Boolean(documentNumber),
    staleTime: 0,
    retry: false,
  });
  if (!documentNumber || ledger.isPending) return null;
  return applyLedger(patientRecord(documentNumber), ledger.data ?? EMPTY_LEDGER);
}
