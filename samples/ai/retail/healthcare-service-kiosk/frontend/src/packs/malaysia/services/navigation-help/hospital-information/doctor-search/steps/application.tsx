// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client";

import { useState } from "react";
import { CalendarDays, Check, Clock, MapPin, Navigation, Printer, Stethoscope } from "lucide-react";
import { CtaButton } from "@/components/kiosk/cta-button";
import { IconTile } from "@/components/kiosk/icon-tile";
import { Notice } from "@/components/kiosk/notice";
import { printingEnabled } from "@/components/kiosk/print-button";
import { SecondaryButton } from "@/components/kiosk/secondary-button";
import { StepCard } from "@/components/kiosk/step-card";
import { TapCard } from "@/components/kiosk/tap-card";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useTakenSlots } from "@/hooks/use-kiosk-api";
import { DOCTORS, department, type Department, type Doctor } from "@/hospital/data";
import { countOf, formatDate, formatDayParts } from "@/lib/format";
import { cn } from "@/lib/utils";
import { getService } from "@/services";
import { ChoiceChips, ListHeading, TextField } from "@/services/shared/fields";
import type { StepProps } from "@/services/shared/step-props";
import {
  LANGUAGE_OPTIONS,
  SPECIALTY_OPTIONS,
  doctorsFor,
  doctorsNamed,
  inClinicToday,
  nextClinicDays,
  type ClinicDay,
} from "../search";

type Picked = { doctor: Doctor; day: ClinicDay };

export default function DoctorSearchStep({ state, actions }: StepProps) {
  const [departmentId, setDepartmentId] = useState(state.data.department ?? "");
  const [language, setLanguage] = useState(state.data.language || "any");
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<Picked | null>(null);

  const book = getService("book");
  const directions = getService("directions");
  const showWay = directions
    ? (destination: string) => actions.startService(directions, { destination, stepFree: "no" }, "result")
    : undefined;

  const query = name.trim();
  const clinic = query ? undefined : department(departmentId);
  const matches = clinic ? doctorsFor(clinic.id, language) : [];
  const fallback = Boolean(clinic) && language !== "any" && matches.length === 0;
  const doctors = query ? doctorsNamed(query) : clinic ? (fallback ? doctorsFor(clinic.id, "any") : matches) : [];

  return (
    <div className="grid w-full max-w-7xl animate-ks-fade items-start gap-7 lg:landscape:grid-cols-[26rem_minmax(0,1fr)]">
      <StepCard className="p-6 sm:p-7">
        <h1 className="font-heading text-3xl font-bold tracking-tight lg:text-4xl">Find a doctor</h1>
        <p className="mt-2 text-lg text-pretty text-muted-foreground">
          Pick a specialty and language, or type a name you already know.
        </p>
        <TextField
          id="doctor-name"
          label="Doctor’s name"
          value={name}
          onChange={setName}
          placeholder="e.g. Lim"
          className="mt-6"
        />

        <ListHeading className="mt-7">Specialty</ListHeading>
        <div className="flex flex-col gap-2.5" role="group" aria-label="Specialty">
          {SPECIALTY_OPTIONS.map((d) => (
            <TapCard
              key={d.id}
              selected={!query && d.id === departmentId}
              onClick={() => {
                setDepartmentId(d.id);
                setName("");
              }}
              className="flex min-h-16 items-center gap-3.5 rounded-2xl px-3 py-2"
            >
              <IconTile icon={Stethoscope} className="size-11 rounded-xl border-0 bg-accent bg-none" iconClassName="size-5" />
              <span className="flex-1 text-lg font-semibold">{d.name}</span>
              <span className="text-sm text-muted-foreground">
                {countOf(DOCTORS.filter((doctor) => doctor.department === d.id).length, "doctor")}
              </span>
            </TapCard>
          ))}
        </div>

        <ListHeading className="mt-7">Preferred language</ListHeading>
        <ChoiceChips
          label="Preferred language"
          options={LANGUAGE_OPTIONS.map((l) => ({ id: l, label: l === "any" ? "Any language" : l }))}
          value={language}
          onSelect={setLanguage}
        />
      </StepCard>

      <section aria-live="polite" aria-labelledby="doctor-results" className="flex min-w-0 flex-col gap-4">
        {query || clinic ? (
          <>
            <div className="flex flex-wrap items-end justify-between gap-4 px-1">
              <div>
                <h2 id="doctor-results" className="font-heading text-3xl font-bold tracking-tight lg:text-4xl">
                  {query ? `${countOf(doctors.length, "doctor")} named “${query}”` : countOf(doctors.length, `${clinic?.name} doctor`)}
                </h2>
                <p className="mt-1.5 text-lg text-muted-foreground">
                  {query
                    ? "Searching every specialty"
                    : language === "any" || fallback
                      ? "Consulting in any language"
                      : `Consulting in ${language}`}
                </p>
              </div>
              {doctors.length > 0 && printingEnabled() && (
                <SecondaryButton onClick={() => window.print()}>
                  <Printer />
                  Print list
                </SecondaryButton>
              )}
            </div>

            {clinic && <ClinicStrip clinic={clinic} onShowWay={showWay} />}
            {fallback && clinic && (
              <Notice tone="warning" className="text-lg">
                No {clinic.name} doctor consults in {language} — here are all {clinic.name} doctors instead.
              </Notice>
            )}

            {doctors.map((doctor) => (
              <DoctorCard
                key={doctor.id}
                doctor={doctor}
                language={language}
                onPick={book ? (day) => setPicked({ doctor, day }) : undefined}
                onShowWay={showWay}
              />
            ))}

            {query && doctors.length === 0 && (
              <p className="rounded-3xl border border-dashed bg-card px-7 py-8 text-lg text-ink">
                No doctor matches that name. Check the spelling, or choose a specialty.
              </p>
            )}
          </>
        ) : (
          <div className="flex flex-col items-center gap-4 rounded-3xl border border-dashed bg-card/60 px-8 py-20 text-center">
            <IconTile icon={Stethoscope} />
            <h2 id="doctor-results" className="font-heading text-2xl font-semibold">
              Choose a specialty to see its doctors
            </h2>
            <p className="max-w-md text-lg text-pretty text-muted-foreground">
              Or type the name of a doctor you already know. You can book a visit straight from their card.
            </p>
          </div>
        )}
      </section>

      {picked && (
        <BookingSheet
          picked={picked}
          onClose={() => setPicked(null)}
          onContinue={(doctor, date, time) => {
            if (!book) return;
            actions.startService(book, {
              department: doctor.department,
              doctorId: doctor.id,
              doctorName: doctor.name,
              date,
              time,
            });
          }}
        />
      )}
    </div>
  );
}

function ClinicStrip({ clinic, onShowWay }: { clinic: Department; onShowWay?: (destination: string) => void }) {
  return (
    <div className="ks-rest flex flex-wrap items-center gap-x-6 gap-y-3 rounded-3xl border bg-card px-6 py-4">
      <div className="min-w-0 flex-1">
        <div className="text-xl font-semibold">{clinic.name} clinic</div>
        <div className="mt-0.5 text-base text-muted-foreground">{clinic.services}</div>
      </div>
      <div className="flex flex-col gap-1 text-base text-ink">
        <span className="inline-flex items-center gap-2">
          <MapPin className="size-4.5 text-primary" aria-hidden />
          {clinic.building}, {clinic.floor}
        </span>
        <span className="inline-flex items-center gap-2">
          <Clock className="size-4.5 text-primary" aria-hidden />
          {clinic.hours}
        </span>
      </div>
      {onShowWay && (
        <SecondaryButton onClick={() => onShowWay(clinic.id)}>
          <Navigation />
          Show me the way
        </SecondaryButton>
      )}
    </div>
  );
}

const initials = (name: string) =>
  name
    .replace(/^Dr\.\s*/, "")
    .split(" ")
    .slice(0, 2)
    .map((part) => part[0])
    .join("");

const dayLabel = (date: string) => {
  const { weekday, day, month } = formatDayParts(date);
  return `${weekday} ${day} ${month}`;
};

function DoctorCard({
  doctor,
  language,
  onPick,
  onShowWay,
}: {
  doctor: Doctor;
  language: string;
  onPick?: (day: ClinicDay) => void;
  onShowWay?: (destination: string) => void;
}) {
  const clinic = department(doctor.department);
  const taken = new Set(useTakenSlots(doctor.id).data?.taken ?? []);
  return (
    <article className="ks-rest flex flex-col gap-4 rounded-3xl border bg-card p-5 sm:p-6" data-testid="doctor-card">
      <div className="flex items-center gap-4">
        <span
          aria-hidden
          className="flex size-16 shrink-0 items-center justify-center rounded-full bg-accent font-heading text-2xl font-semibold text-accent-foreground"
        >
          {initials(doctor.name)}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="font-heading text-2xl font-semibold">{doctor.name}</h3>
          {clinic && (
            <p className="mt-0.5 text-base text-muted-foreground">
              {clinic.name} · {clinic.building}, {clinic.floor}
            </p>
          )}
        </div>
        {inClinicToday(doctor) && (
          <span className="inline-flex shrink-0 items-center gap-2 rounded-full bg-accent px-3.5 py-1.5 text-sm font-semibold text-accent-foreground">
            <span className="size-2 rounded-full bg-primary" aria-hidden />
            In clinic today
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2.5">
        <span className="text-base font-semibold text-ink">Speaks</span>
        {doctor.languages.map((l) => (
          <span
            key={l}
            className={cn(
              "rounded-full px-3 py-1 text-base font-medium",
              l === language ? "bg-primary text-primary-foreground" : "bg-secondary text-ink",
            )}
          >
            {l}
          </span>
        ))}
        {onShowWay && (
          <SecondaryButton className="ml-auto h-12 px-4 text-base" onClick={() => onShowWay(doctor.department)}>
            <Navigation />
            Directions
          </SecondaryButton>
        )}
      </div>

      <div>
        <ListHeading className="text-sm">{onPick ? "Next available · tap a date to book" : "Next available"}</ListHeading>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-5" role="group" aria-label={`${doctor.name}, next available days`}>
          {nextClinicDays(doctor, new Date(), 5, taken).map((day) =>
            day.times.length > 0 && onPick ? (
              <TapCard
                key={day.date}
                onClick={() => onPick(day)}
                className="flex min-h-18 flex-col items-center justify-center gap-0.5 rounded-2xl border-2 border-primary/60 bg-accent px-2 py-2 text-center"
              >
                <span className="text-lg font-bold">{dayLabel(day.date)}</span>
                <span className="text-sm font-medium text-accent-foreground">from {day.times[0]}</span>
              </TapCard>
            ) : (
              <div
                key={day.date}
                className="flex min-h-18 flex-col items-center justify-center gap-0.5 rounded-2xl border border-dashed bg-muted/50 px-2 py-2 text-center text-muted-foreground"
              >
                <span className="text-lg font-semibold">{dayLabel(day.date)}</span>
                <span className="text-sm">{day.times.length > 0 ? `from ${day.times[0]}` : "Not in clinic"}</span>
              </div>
            ),
          )}
        </div>
      </div>
    </article>
  );
}

function BookingSheet({
  picked,
  onClose,
  onContinue,
}: {
  picked: Picked;
  onClose: () => void;
  onContinue: (doctor: Doctor, date: string, time: string) => void;
}) {
  const [time, setTime] = useState("");
  const { doctor, day } = picked;
  const clinic = department(doctor.department);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-w-2xl flex-col gap-6 rounded-[30px] p-8 sm:max-w-2xl sm:p-10">
        <div className="flex items-center gap-4">
          <span
            aria-hidden
            className="flex size-16 shrink-0 items-center justify-center rounded-full bg-accent font-heading text-2xl font-semibold text-accent-foreground"
          >
            {initials(doctor.name)}
          </span>
          <div className="min-w-0">
            <p className="text-sm font-bold tracking-[0.14em] text-primary uppercase">Book a specialist visit</p>
            <DialogTitle className="mt-1 font-heading text-3xl font-semibold tracking-tight">
              {doctor.name}
            </DialogTitle>
            {clinic && (
              <DialogDescription className="mt-0.5 text-base text-muted-foreground">
                {clinic.name} · {clinic.building}, {clinic.floor}
              </DialogDescription>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3 rounded-2xl bg-secondary px-5 py-4 text-xl font-semibold">
          <CalendarDays className="size-6 text-primary" aria-hidden />
          {formatDate(new Date(`${day.date}T00:00`))}
        </div>

        <div>
          <ListHeading className="text-sm">Choose a time</ListHeading>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" role="group" aria-label="Time">
            {day.times.map((t) => (
              <TapCard
                key={t}
                selected={t === time}
                onClick={() => setTime(t)}
                className="flex min-h-16 items-center justify-center gap-2 rounded-2xl text-xl font-bold tabular-nums"
              >
                {t === time && <Check className="size-5 text-primary" strokeWidth={3} aria-hidden />}
                {t}
              </TapCard>
            ))}
          </div>
        </div>

        <p className="text-base text-pretty text-ink">
          Next you’ll confirm the booking — signed-in patients skip the ID check. Your doctor, date and time stay chosen.
        </p>

        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
          <CtaButton disabled={!time} onClick={() => onContinue(doctor, day.date, time)}>
            {time ? `Continue with ${time}` : "Choose a time"}
          </CtaButton>
        </div>
      </DialogContent>
    </Dialog>
  );
}
