// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client";

import { useQuery } from "@tanstack/react-query";
import { Clock, MonitorSpeaker, Navigation, Stethoscope, Users, type LucideIcon } from "lucide-react";
import type { TicketStatus } from "@/app/api/_lib/queue";
import { PhoneQr } from "@/components/kiosk/phone-qr";
import { SecondaryButton } from "@/components/kiosk/secondary-button";
import { StepCard } from "@/components/kiosk/step-card";
import { department } from "@/hospital/data";
import { apiGet } from "@/lib/api/client";
import { cn } from "@/lib/utils";

function useTicketStatus(departmentId: string, queueNumber: string) {
  return useQuery({
    queryKey: ["ticket", departmentId, queueNumber],
    queryFn: () =>
      apiGet<TicketStatus>(
        `/queue/ticket?department=${encodeURIComponent(departmentId)}&number=${encodeURIComponent(queueNumber)}`,
      ),
    enabled: Boolean(departmentId && queueNumber),
    refetchInterval: 15_000,
    staleTime: 0,
  });
}

export function QueueTicket({
  queueNumber,
  departmentId,
  doctor,
  time,
  onRoute,
}: {
  queueNumber: string;
  departmentId: string;
  doctor?: string;
  time?: string;
  onRoute?: () => void;
}) {
  const dept = department(departmentId);
  const status = useTicketStatus(departmentId, queueNumber);
  const ticket = status.data;
  const place = dept ? `${dept.building}, ${dept.floor}` : "";

  return (
    <StepCard className="overflow-hidden p-0 sm:p-0" data-print>
      <div className="ks-gradient flex items-center justify-between gap-6 px-8 py-6 text-on-accent">
        <div>
          <div className="text-base font-semibold tracking-[0.16em] uppercase opacity-90">Your number</div>
          <div className="font-heading text-7xl leading-none font-bold tracking-tight tabular-nums">{queueNumber}</div>
        </div>
        {dept && (
          <div className="text-right">
            <div className="text-2xl font-semibold">{dept.name}</div>
            <div className="mt-1 text-lg opacity-90">{place}</div>
          </div>
        )}
      </div>
      <div className="px-8 py-5">
        <div
          aria-live="polite"
          className={cn(
            "flex items-center gap-4 rounded-2xl px-5 py-4",
            ticket?.called ? "bg-success/10 text-success" : "bg-accent text-accent-foreground",
          )}
        >
          <Users className="size-7 shrink-0" aria-hidden />
          <div className="min-w-0 flex-1">
            <div className="text-xl font-bold">
              {!ticket
                ? "Checking the queue…"
                : ticket.called
                  ? "It's your turn — please go in now"
                  : ticket.ahead === 0
                    ? "You're next"
                    : `${ticket.ahead} ${ticket.ahead === 1 ? "person" : "people"} ahead of you`}
            </div>
            {ticket && !ticket.called && (
              <div className="text-base opacity-90">About {ticket.waitMinutes} minutes · updates live</div>
            )}
          </div>
          {ticket?.nowServing && (
            <div className="text-right">
              <div className="text-sm font-semibold tracking-[0.12em] uppercase opacity-80">Now serving</div>
              <div className="font-heading text-3xl font-bold tabular-nums">{ticket.nowServing}</div>
            </div>
          )}
        </div>

        {doctor && <TicketRow icon={Stethoscope} label="Doctor">{doctor}</TicketRow>}
        {time && <TicketRow icon={Clock} label="Appointment">{time}</TicketRow>}

        <div className="mt-5 flex flex-col gap-4">
          {onRoute && (
            <SecondaryButton onClick={onRoute} className="h-14 w-full px-6">
              <Navigation className="size-5" />
              Show me the way to {dept?.name ?? "the clinic"}
            </SecondaryButton>
          )}
          <PhoneQr
            title="Keep your number on your phone"
            hint="Scan with your camera — it has your number and where to wait."
            text={[
              `Queue number ${queueNumber}`,
              dept ? `${dept.name} - ${place}` : "",
              time ? `Appointment ${time}` : "",
              "Watch the waiting-area screen for your number.",
            ]
              .filter(Boolean)
              .join("\n")}
          />
        </div>
        <div className="mt-4 flex items-start gap-3 text-base text-muted-foreground">
          <MonitorSpeaker className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
          Take a seat in the waiting area — your number will be shown on screen and called out.
        </div>
      </div>
    </StepCard>
  );
}

function TicketRow({
  icon: Icon,
  label,
  children,
}: {
  icon: LucideIcon;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-b py-4">
      <span className="flex shrink-0 items-center gap-2.5 text-lg text-muted-foreground">
        <Icon className="size-5 text-primary" aria-hidden />
        {label}
      </span>
      <span className="text-right text-lg font-semibold">{children}</span>
    </div>
  );
}
