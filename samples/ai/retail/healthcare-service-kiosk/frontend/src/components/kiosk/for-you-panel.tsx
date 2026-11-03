// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client";

import {
  Barcode,
  CalendarPlus,
  ChevronRight,
  FlaskConical,
  IdCard,
  Navigation,
  PillBottle,
  ShieldAlert,
  Ticket,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { useAppointmentsToday } from "@/hooks/use-kiosk-api";
import { useLiveRecord } from "@/hooks/use-live-record";
import type { CitizenProfile } from "@/lib/api/kiosk";
import { formatMoney, formatShortDate, kioskCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";
import { department } from "@/hospital/data";
import { isoDate, outstandingBalance, patientRecord } from "@/hospital/records";
import type { ServiceDefinition } from "@/services/types";
import { TapCard } from "./tap-card";

type Task = {
  serviceId: string;
  icon: LucideIcon;
  title: string;
  detail: string;
  tone?: "primary" | "warning";
};

function greeting(now = new Date()): string {
  const hour = now.getHours();
  return hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
}

/** What a signed-in patient most likely came for, from their record — one tap each, no second sign-in. */
export function ForYouPanel({
  documentNumber,
  profile,
  services,
  onSelect,
}: {
  documentNumber: string;
  profile: CitizenProfile;
  services: ServiceDefinition[];
  onSelect: (service: ServiceDefinition) => void;
}) {
  const today = useAppointmentsToday(documentNumber);
  // With the kiosk's own filings applied: a bill paid a minute ago is not still to pay.
  const live = useLiveRecord(documentNumber);
  const record = live ?? patientRecord(documentNumber);
  const currency = kioskCurrency();
  const tasks: Task[] = [];

  const checkedIn = today.data?.checkedIn;
  const next = today.data?.appointments.find((a) => a.reference !== checkedIn?.appointmentReference);
  if (checkedIn) {
    tasks.push({
      serviceId: "checkin",
      icon: Ticket,
      title: `You're number ${checkedIn.queueNumber}`,
      detail: `Checked in at ${department(checkedIn.department)?.name ?? checkedIn.department} — see where you are in the queue`,
      tone: "primary",
    });
  } else if (next) {
    tasks.push({
      serviceId: "checkin",
      icon: Ticket,
      title: `Check in for ${next.time}`,
      detail: `${department(next.department)?.name ?? next.department} with ${next.doctor}`,
      tone: "primary",
    });
  }
  // The visit they're here for, checked in or not: one tap more puts the route to that doctor on screen.
  const visit = today.data?.appointments.find((a) => a.reference === checkedIn?.appointmentReference) ?? next;
  if (visit) {
    const dept = department(visit.department);
    tasks.push({
      serviceId: "myappointment",
      icon: Navigation,
      title: `Way to ${dept?.name ?? visit.department}`,
      detail: dept ? `${visit.doctor} · ${dept.building}, ${dept.floor}` : visit.doctor,
    });
  }
  if (live && record.invoices.length > 0) {
    tasks.push({
      serviceId: "bill",
      icon: Wallet,
      title: `${formatMoney(outstandingBalance(record), currency)} to pay`,
      detail: `${record.invoices.length} unpaid ${record.invoices.length === 1 ? "bill" : "bills"} from ${formatShortDate(record.invoices[0].date)}`,
      tone: "warning",
    });
  }
  if (record.labResults) {
    const outside = record.labResults.results.filter((r) => r.flag !== "normal").length;
    tasks.push({
      serviceId: "labresults",
      icon: FlaskConical,
      title: "Lab results are ready",
      detail: `From ${formatShortDate(record.labResults.date)}${outside ? ` · ${outside} outside the usual range` : ""}`,
    });
  }
  const collect = record.prescriptions.find((p) => p.lastFilled === null);
  const refill = record.prescriptions.find((p): p is typeof p & { lastFilled: string } => p.lastFilled !== null && p.refillsLeft > 0);
  if (collect) {
    tasks.push({
      serviceId: "refill",
      icon: PillBottle,
      title: `Collect ${collect.name}`,
      detail: `Prescribed today${collect.prescribedBy ? ` by ${collect.prescribedBy}` : ""} · ready at the pharmacy`,
      tone: "primary",
    });
  } else if (refill) {
    tasks.push({
      serviceId: "refill",
      icon: PillBottle,
      title: `Refill ${refill.name}`,
      detail: `${refill.refillsLeft} ${refill.refillsLeft === 1 ? "refill" : "refills"} left · last filled ${formatShortDate(refill.lastFilled)}`,
    });
  }
  if (record.followUp) {
    tasks.push({
      serviceId: "followup",
      icon: CalendarPlus,
      title: "Book your follow-up",
      detail: `${record.followUp.doctor} asked to see you in ${record.followUp.inWeeks} weeks`,
    });
  }
  if (record.policy && record.policy.expiry < isoDate(new Date())) {
    tasks.push({
      serviceId: "insurance",
      icon: ShieldAlert,
      title: "Your insurance has expired",
      detail: `Expired ${formatShortDate(record.policy.expiry)} — check another policy`,
      tone: "warning",
    });
  }

  const offered = tasks
    .map((task) => ({ task, service: services.find((s) => s.id === task.serviceId) }))
    .filter((item): item is { task: Task; service: ServiceDefinition } => Boolean(item.service))
    .slice(0, 4);

  return (
    <section className="mb-9 animate-ks-fade" aria-label="For you">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="font-heading text-3xl font-semibold tracking-tight">
          {greeting()}, {profile.name.split(" ")[0]}
        </h2>
        <span className="text-base text-muted-foreground">
          {offered.length > 0 ? "Here's what's waiting for you today." : "Nothing needs your attention — choose a service below."}
        </span>
      </div>
      {offered.length > 0 && (
        <div className="hc-service-grid ks-stagger grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {offered.map(({ task, service }) => (
            <TapCard
              key={task.serviceId}
              onClick={() => onSelect(service)}
              className={cn(
                "group flex min-h-36 flex-col items-start rounded-2xl p-5",
                task.tone === "primary" && "ks-gradient border-transparent text-on-accent",
                task.tone === "warning" && "border-warning/40 bg-warning/5",
              )}
            >
              <div className="mb-3 flex w-full items-center justify-between">
                <span
                  className={cn(
                    "flex size-12 items-center justify-center rounded-xl",
                    task.tone === "primary" ? "bg-white/20" : "bg-accent text-primary",
                  )}
                >
                  <task.icon className="size-6" aria-hidden />
                </span>
                <ChevronRight className="size-6 transition-transform group-hover:translate-x-1" aria-hidden />
              </div>
              <div className="text-xl leading-tight font-semibold">{task.title}</div>
              <p className={cn("mt-1.5 text-base leading-snug", task.tone === "primary" ? "opacity-90" : "text-muted-foreground")}>
                {task.detail}
              </p>
            </TapCard>
          ))}
        </div>
      )}
    </section>
  );
}

/** For a visitor who has not signed in: one tap to make the menu theirs. */
export function SignInBanner({ onSignIn }: { onSignIn: () => void }) {
  return (
    <TapCard
      onClick={onSignIn}
      className="group flex min-h-16 w-full items-center gap-3 rounded-xl border-0 bg-transparent px-3 py-2 text-left shadow-none"
    >
      <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-card text-primary">
        <Barcode className="size-7" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-xl font-semibold">Have an appointment?</div>
        <p className="mt-1 text-base text-muted-foreground">
          Sign in for your appointments, results and bills.
        </p>
      </div>
      <span className="flex min-h-12 shrink-0 items-center gap-2 rounded-xl bg-accent px-4 py-3 text-base font-semibold text-primary">
        <IdCard className="size-5" aria-hidden />
        Sign in
      </span>
    </TapCard>
  );
}
