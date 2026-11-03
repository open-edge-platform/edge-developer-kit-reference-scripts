// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client";

import { useQuery } from "@tanstack/react-query";
import { MapPin, MonitorSpeaker, TriangleAlert } from "lucide-react";
import { KioskBrand } from "@/components/kiosk/kiosk-brand";
import { useClock } from "@/hooks/use-clock";
import { apiGet } from "@/lib/api/client";
import { formatDate, formatTime } from "@/lib/format";

type QueueEntry = { number: string; checkedInAt: string; flags: string[] };
type Clinic = {
  department: string;
  name: string;
  place: string;
  nowServing: string | null;
  waiting: QueueEntry[];
  doctorsIn: number;
  averageMinutes: number;
};

const SHOWN_WAITING = 8;

/** The clinic team sees pre-visit flags as a mark beside the number; the hall sees no more than that. */
export function QueueBoard() {
  const now = useClock();
  const queue = useQuery({
    queryKey: ["queue-board"],
    queryFn: () => apiGet<{ clinics: Clinic[] }>("/queue"),
    refetchInterval: 5_000,
    refetchIntervalInBackground: true,
  });
  const clinics = queue.data?.clinics ?? [];

  return (
    <div className="ks-aurora fixed inset-0 flex flex-col overflow-hidden px-10 py-8 text-foreground">
      <header className="flex items-center justify-between border-b pb-6">
        <KioskBrand />
        <div className="text-right">
          <div className="text-4xl font-semibold tabular-nums">{formatTime(now)}</div>
          <div className="text-base text-muted-foreground">{formatDate(now)}</div>
        </div>
      </header>
      <h1 className="mt-8 font-heading text-5xl font-semibold tracking-tight">Now serving</h1>
      {queue.isError && (
        <p className="mt-6 flex items-center gap-3 text-xl text-destructive">
          <TriangleAlert className="size-6" /> The queue could not be loaded — retrying.
        </p>
      )}
      {clinics.length === 0 && !queue.isPending && (
        <p className="mt-6 text-2xl text-muted-foreground">No one has checked in yet today.</p>
      )}
      <div className="mt-8 grid min-h-0 flex-1 auto-rows-min gap-6 xl:grid-cols-3 lg:grid-cols-2">
        {clinics.map((clinic) => (
          <section key={clinic.department} className="ks-rest overflow-hidden rounded-3xl border bg-card">
            <div className="flex items-center justify-between gap-4 border-b bg-accent/60 px-7 py-5">
              <div>
                <h2 className="text-3xl font-semibold">{clinic.name}</h2>
                <p className="mt-1 flex items-center gap-2 text-lg text-muted-foreground">
                  <MapPin className="size-5 text-primary" /> {clinic.place}
                </p>
              </div>
              <div className="text-right">
                <div className="text-sm font-bold tracking-[0.16em] text-primary uppercase">Now</div>
                <div className="font-heading text-6xl font-bold tabular-nums">{clinic.nowServing ?? "—"}</div>
              </div>
            </div>
            <div className="px-7 py-5">
              <div className="mb-3 flex items-center justify-between text-base font-semibold text-muted-foreground">
                <span>Next · {clinic.waiting.length} waiting</span>
                <span>~{clinic.averageMinutes} min each · {clinic.doctorsIn} {clinic.doctorsIn === 1 ? "doctor" : "doctors"} in</span>
              </div>
              <ol className="grid grid-cols-4 gap-3">
                {clinic.waiting.slice(0, SHOWN_WAITING).map((entry) => (
                  <li
                    key={entry.number}
                    title={entry.flags.join(", ")}
                    className="relative flex h-16 items-center justify-center rounded-2xl border bg-secondary text-2xl font-bold tabular-nums"
                  >
                    {entry.number}
                    {entry.flags.length > 0 && (
                      <span className="absolute top-1.5 right-1.5 size-3 rounded-full bg-warning" aria-label="Has a note for the clinic" />
                    )}
                  </li>
                ))}
              </ol>
            </div>
          </section>
        ))}
      </div>
      <footer className="mt-6 flex items-center gap-3 border-t pt-5 text-xl text-muted-foreground">
        <MonitorSpeaker className="size-6 text-primary" />
        Please wait until your number is shown, then go to your clinic&apos;s counter.
      </footer>
    </div>
  );
}
