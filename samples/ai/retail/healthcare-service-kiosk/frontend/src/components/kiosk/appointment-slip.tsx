// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { Clock, MapPin, ScanLine, Stethoscope } from "lucide-react";
import { department } from "@/hospital/data";
import { formatDayParts } from "@/lib/format";
import { BarcodeImage } from "./barcode-image";
import { StepCard } from "./step-card";

/** The booking as the patient carries it: the Code 128 barcode is what the kiosk scanner reads on the day. */
export function AppointmentSlip({
  reference,
  slipCode,
  departmentId,
  doctor,
  date,
  time,
}: {
  reference: string;
  slipCode: string;
  departmentId: string;
  doctor: string;
  date: string;
  time: string;
}) {
  const dept = department(departmentId);
  const day = formatDayParts(date);
  return (
    <StepCard className="overflow-hidden p-0 sm:p-0" data-print>
      <div className="ks-gradient flex items-center gap-6 px-8 py-6 text-on-accent">
        <div className="flex w-24 shrink-0 flex-col items-center rounded-2xl bg-white/15 py-3">
          <span className="text-sm font-bold tracking-[0.14em] uppercase opacity-90">{day.month}</span>
          <span className="font-heading text-5xl leading-none font-bold">{day.day}</span>
          <span className="mt-1 text-sm font-semibold opacity-90">{day.weekday}</span>
        </div>
        <div className="min-w-0">
          <div className="text-base font-semibold tracking-[0.16em] uppercase opacity-90">Appointment slip</div>
          <div className="mt-1 font-heading text-4xl font-bold tabular-nums">{time}</div>
          <div className="mt-1 text-xl font-semibold">{dept?.name ?? departmentId}</div>
        </div>
      </div>
      <div className="flex flex-col gap-6 px-8 py-6">
        <div className="flex flex-col gap-3.5 text-lg">
          <Line icon={Stethoscope}>{doctor}</Line>
          {dept && <Line icon={MapPin}>{dept.building}, {dept.floor}</Line>}
          <Line icon={Clock}>Check in from an hour before</Line>
          <div className="mt-1 text-base text-muted-foreground">
            Reference <span className="font-semibold text-foreground">{reference}</span>
          </div>
        </div>
        <div className="flex flex-col items-center gap-2">
          <div className="w-full rounded-xl border bg-white px-3 py-2">
            <BarcodeImage type="code128" text={slipCode} alt="Appointment slip barcode" className="h-20 w-full object-fill" />
          </div>
          <span className="flex items-center gap-1.5 text-sm font-semibold text-muted-foreground">
            <ScanLine className="size-4" aria-hidden />
            Scan at any kiosk
          </span>
        </div>
      </div>
      <div className="border-t bg-secondary/60 px-8 py-4 text-base text-pretty text-muted-foreground">
        On the day, hold this slip — or a photo of it on your phone — under the kiosk scanner to check in. It only works with your date of birth.
      </div>
    </StepCard>
  );
}

function Line({ icon: Icon, children }: { icon: typeof Clock; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <Icon className="size-5 shrink-0 text-primary" aria-hidden />
      <span className="font-semibold">{children}</span>
    </div>
  );
}
