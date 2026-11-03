// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client";

import { Hand, Moon, Sun, Sunset } from "lucide-react";
import { formatDayParts } from "@/lib/format";
import { ActionHint } from "./action-hint";
import { TapCard } from "./tap-card";

export type Slot = { date: string; time: string };

export function SlotPicker({
  slots,
  date,
  time,
  onDate,
  onTime,
}: {
  slots: Slot[];
  date: string;
  time: string;
  onDate: (date: string) => void;
  onTime: (time: string) => void;
}) {
  const dates = [...new Set(slots.map((s) => s.date))];
  const times = slots.filter((s) => s.date === date).map((s) => s.time);
  const periods = [
    { label: "Morning", icon: Sun, times: times.filter((t) => t < "12:00") },
    { label: "Afternoon", icon: Sunset, times: times.filter((t) => t >= "12:00" && t < "18:00") },
    // Only an always-open clinic (mock.clinics_always_open) has evening times.
    { label: "Evening", icon: Moon, times: times.filter((t) => t >= "18:00") },
  ].filter((p) => p.times.length > 0);

  return (
    <div>
      {!date && <ActionHint icon={Hand}>Choose a day</ActionHint>}
      <div className="flex gap-3 overflow-x-auto pb-2" role="group" aria-label="Day">
        {dates.map((d) => {
          const { weekday, day, month } = formatDayParts(d);
          return (
            <TapCard
              key={d}
              selected={d === date}
              onClick={() => {
                onDate(d);
                onTime("");
              }}
              className="flex min-w-24 shrink-0 flex-col items-center gap-0.5 rounded-2xl px-4 py-4"
            >
              <span className="text-base font-semibold text-muted-foreground">{weekday}</span>
              <span className="font-heading text-3xl leading-tight font-bold tabular-nums">{day}</span>
              <span className="text-base font-semibold">{month}</span>
            </TapCard>
          );
        })}
      </div>

      {date && (
        <div className="mt-6 flex flex-col gap-5">
          {!time && <ActionHint icon={Hand}>Choose a time</ActionHint>}
          {periods.map(({ label, icon: Icon, times: periodTimes }) => (
            <div key={label}>
              <div className="mb-3 flex items-center gap-2 text-base font-semibold text-muted-foreground">
                <Icon className="size-5 text-primary" aria-hidden />
                {label}
              </div>
              <div className="grid grid-cols-3 gap-3 sm:grid-cols-4" role="group" aria-label={`${label} times`}>
                {periodTimes.map((t) => (
                  <TapCard
                    key={t}
                    selected={t === time}
                    onClick={() => onTime(t)}
                    className="flex min-h-16 items-center justify-center rounded-2xl text-xl font-bold tabular-nums"
                  >
                    {t}
                  </TapCard>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function slotLabel(date: string, time: string): string {
  const { weekday, day, month } = formatDayParts(date);
  return `${weekday} ${day} ${month}, ${time}`;
}
