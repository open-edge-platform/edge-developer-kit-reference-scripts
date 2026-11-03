// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client";

import { CalendarClock, MapPin, Stethoscope } from "lucide-react";
import { department } from "@/hospital/data";
import type { Appointment } from "@/lib/api/kiosk";
import { cn } from "@/lib/utils";

/** One of today's visits — the doctor, the time and where — as a card to pick when there are several. */
export function AppointmentCard({
  appointment,
  selected,
  selectable,
  onSelect,
}: {
  appointment: Appointment;
  selected: boolean;
  selectable: boolean;
  onSelect: () => void;
}) {
  const dept = department(appointment.department);
  const initials = appointment.doctor
    .replace(/^Dr\.?\s*/, "")
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("");
  const body = (
    <>
      <div className="flex items-center gap-4">
        <span className="ks-gradient flex size-16 shrink-0 items-center justify-center rounded-2xl text-xl font-bold text-on-accent">
          {initials}
        </span>
        <div className="min-w-0 text-left">
          <div className="text-sm font-bold tracking-[0.14em] text-primary uppercase">Today · {appointment.time}</div>
          <div className="mt-1 font-heading text-2xl font-semibold" data-testid="appointment-clinic">{dept?.name ?? appointment.department}</div>
        </div>
      </div>
      <div className="mt-5 grid gap-3 text-left text-lg">
        <Fact icon={Stethoscope}>{appointment.doctor}</Fact>
        <Fact icon={CalendarClock}>{appointment.time}{appointment.source === "booked" ? " · booked at a kiosk" : ""}</Fact>
        {dept && <Fact icon={MapPin}>{dept.building}, {dept.floor}</Fact>}
      </div>
    </>
  );
  return selectable ? (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        "cursor-pointer rounded-3xl border-2 bg-card p-6 transition active:scale-[0.99]",
        selected ? "border-primary ring-4 ring-primary/15" : "border-border hover:bg-secondary/50",
      )}
    >
      {body}
    </button>
  ) : (
    <div className="rounded-3xl border-2 border-primary/30 bg-card p-6">{body}</div>
  );
}

function Fact({ icon: Icon, children }: { icon: typeof MapPin; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <Icon className="size-5 shrink-0 text-primary" aria-hidden />
      <span className="font-medium">{children}</span>
    </div>
  );
}
