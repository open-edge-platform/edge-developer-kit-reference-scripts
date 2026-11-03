// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, Mail, MessageSquareText, Stethoscope, type LucideIcon } from "lucide-react";
import { Failure, Panel } from "@/components/staff/desk-shell";
import { Badge } from "@/components/ui/badge";
import { apiGet } from "@/lib/api/client";
import { formatDateTime } from "@/lib/format";

type Notice = {
  id: string;
  at: string;
  channel: "sms" | "email" | "clinic";
  to: string;
  subject?: string;
  body: string;
  serviceId?: string;
  caseId?: string;
  delivered: boolean;
  error?: string;
};

const CHANNEL: Record<Notice["channel"], { label: string; icon: LucideIcon }> = {
  sms: { label: "SMS", icon: MessageSquareText },
  email: { label: "Email", icon: Mail },
  clinic: { label: "Clinic", icon: Stethoscope },
};

/** /outbox — what the kiosk sent on patients' behalf; with `notify.driver: outbox` this is the only place it goes. */
export function OutboxDesk({ staffEmail }: { staffEmail: string }) {
  const outbox = useQuery({
    queryKey: ["outbox"],
    queryFn: () => apiGet<{ driver: string; notices: Notice[] }>("/staff/outbox"),
    refetchInterval: 5_000,
  });

  return (
    <div className="mx-auto flex min-h-full w-full max-w-5xl flex-col gap-6 p-6 lg:p-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">Outbox</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Booking confirmations, lab results by email and arrival notes to the clinics, newest first.
            {outbox.data?.driver === "webhook"
              ? " Each one was also posted to the notification webhook."
              : " Nothing here has left this terminal (notify.driver: outbox)."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <span>{staffEmail}</span>
          <Link
            href="/staff"
            className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 font-medium text-foreground transition-colors hover:bg-muted"
          >
            Staff pages
            <ArrowUpRight className="size-3.5" />
          </Link>
        </div>
      </header>

      <Panel title="Sent" note="Kept in memory for the last 200 messages; a restart empties it.">
        {outbox.isError && <Failure error={outbox.error} />}
        {outbox.data?.notices.length === 0 && (
          <p className="py-6 text-center text-sm text-muted-foreground">Nothing sent yet.</p>
        )}
        <ul className="flex flex-col divide-y divide-border">
          {outbox.data?.notices.map((notice) => {
            const { label, icon: Icon } = CHANNEL[notice.channel];
            return (
              <li key={notice.id} className="flex flex-col gap-1.5 py-3">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <Icon className="size-4 text-primary" aria-hidden />
                  <Badge variant="secondary">{label}</Badge>
                  <span className="font-medium">{notice.to}</span>
                  {notice.caseId && <span className="font-mono text-xs text-muted-foreground">{notice.caseId}</span>}
                  <span className="ml-auto text-xs text-muted-foreground">{formatDateTime(notice.at)}</span>
                </div>
                {notice.subject && <span className="text-sm font-semibold">{notice.subject}</span>}
                <p className="text-sm whitespace-pre-line text-muted-foreground">{notice.body}</p>
                {!notice.delivered && (
                  <p className="text-xs text-destructive">Not delivered: {notice.error}</p>
                )}
              </li>
            );
          })}
        </ul>
      </Panel>
    </div>
  );
}
