// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { ReactNode } from "react";
import { HeartPulse, ScanLine } from "lucide-react";
import { displayMrn } from "@/hospital/patient-id";
import { BarcodeImage } from "./barcode-image";

/** The new patient's card: the Code 128 MRN is what the kiosk scanner and counter scanners read next time. */
export function PatientCard({ name, mrn, note }: { name: string; mrn: string; note?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-4" data-print>
      <div className="ks-glow aspect-[1.586] w-full max-w-md overflow-hidden rounded-3xl border bg-card shadow-xl">
        <div className="ks-gradient flex items-center justify-between px-6 py-4 text-on-accent">
          <div className="flex items-center gap-2.5">
            <HeartPulse className="size-6" aria-hidden />
            <span className="font-heading text-lg font-semibold">Hospital Concierge</span>
          </div>
          <span className="text-xs font-bold tracking-[0.2em] uppercase opacity-90">Patient card</span>
        </div>
        <div className="flex flex-col gap-1 px-6 pt-4">
          <span className="text-xs font-bold tracking-[0.16em] text-muted-foreground uppercase">Name</span>
          <span className="truncate font-heading text-2xl font-semibold uppercase">{name}</span>
          <span className="mt-2 text-xs font-bold tracking-[0.16em] text-muted-foreground uppercase">MRN</span>
          <span className="font-heading text-2xl font-bold tracking-wider tabular-nums">{displayMrn(mrn)}</span>
        </div>
        <div className="mx-6 mt-3 rounded-lg bg-white px-2 py-1.5">
          <BarcodeImage type="code128" text={mrn} alt={`Barcode for ${displayMrn(mrn)}`} className="h-14 w-full object-fill" />
        </div>
      </div>
      <p className="flex max-w-md items-start gap-2.5 text-base text-pretty text-muted-foreground">
        <ScanLine className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
        {note ?? "Next time, scan this card at any kiosk instead of your MyKad. Collect the printed card at the registration counter, or tap Print."}
      </p>
    </div>
  );
}
