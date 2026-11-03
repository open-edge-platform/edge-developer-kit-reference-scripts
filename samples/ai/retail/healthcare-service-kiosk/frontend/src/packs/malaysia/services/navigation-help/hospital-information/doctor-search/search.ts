// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { DEPARTMENTS, DOCTORS, SPECIALIST_DEPARTMENTS, department, type Doctor } from "@/hospital/data";
import { addDays, bookableSlots, isoDate } from "@/hospital/records";
import type { ServiceResult } from "@/services/shared/result";

export const SPECIALTY_OPTIONS = SPECIALIST_DEPARTMENTS.map((id) => department(id)).filter(
  (d): d is (typeof DEPARTMENTS)[number] => Boolean(d),
);

/** Every language a doctor consults in — English first, then the rest alphabetically. */
export const LANGUAGE_OPTIONS = [
  "any",
  ...[...new Set(DOCTORS.flatMap((d) => d.languages))].sort((a, b) =>
    a === "English" ? -1 : b === "English" ? 1 : a.localeCompare(b),
  ),
];

export function doctorsFor(departmentId: string, language: string): Doctor[] {
  const all = DOCTORS.filter((d) => d.department === departmentId);
  if (!language || language === "any") return all;
  return all.filter((d) => d.languages.includes(language));
}

/** "Next free: Tue 21 Oct at 09:30, 10:00" — from a doctor's clinic days with the booked slots taken out. */
export function nextFree(days: ClinicDay[], dateLabel: (iso: string) => string): string {
  const day = days.find((d) => d.times.length > 0);
  return day ? `next free ${dateLabel(day.date)} at ${day.times.slice(0, 3).join(", ")}` : "no free slot in the next week";
}

export function doctorSearchResult(
  departmentId: string,
  language: string,
  availability: Record<string, string> = {},
): ServiceResult {
  const dept = department(departmentId);
  const deptName = dept?.name ?? departmentId;
  const matches = doctorsFor(departmentId, language);
  const all = doctorsFor(departmentId, "any");
  const list = matches.length > 0 ? matches : all;
  return {
    title: `${deptName} doctors`,
    intro:
      matches.length > 0 || !language || language === "any"
        ? undefined
        : `No ${deptName} doctor consults in ${language} — here are all ${deptName} doctors instead.`,
    rows: list.map((d) => ({
      label: d.name,
      value: [d.languages.join(", "), d.days.join(", "), availability[d.id]].filter(Boolean).join(" · "),
    })),
    note: "Book with New Specialist Visit under Appointments.",
  };
}

export function doctorsNamed(query: string): Doctor[] {
  const q = query.trim().toLowerCase().replace(/^dr\.?\s*/, "");
  return q ? DOCTORS.filter((d) => d.name.toLowerCase().includes(q)) : [];
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function inClinicToday(doctor: Doctor, today = new Date()): boolean {
  return doctor.days.includes(WEEKDAYS[today.getDay()]);
}

export type ClinicDay = { date: string; times: string[] };

/** The next `count` weekdays from tomorrow, each with the times the doctor can be booked — none when they are not in clinic. */
export function nextClinicDays(doctor: Doctor, from = new Date(), count = 5, taken: ReadonlySet<string> = new Set()): ClinicDay[] {
  const slots = bookableSlots(doctor, from).filter((s) => !taken.has(`${s.date} ${s.time}`));
  const days: ClinicDay[] = [];
  for (let offset = 1; days.length < count; offset++) {
    const day = addDays(from, offset);
    if (day.getDay() === 0 || day.getDay() === 6) continue;
    const date = isoDate(day);
    days.push({ date, times: slots.filter((s) => s.date === date).map((s) => s.time) });
  }
  return days;
}

/** A doctor asked for by name: their clinic, languages and days. */
export function namedDoctorsResult(doctors: Doctor[], availability: Record<string, string> = {}): ServiceResult {
  return {
    title: doctors.length === 1 ? doctors[0].name : "Doctors with that name",
    rows: doctors.map((d) => ({
      label: d.name,
      value: [department(d.department)?.name ?? d.department, d.languages.join(", "), d.days.join(", "), availability[d.id]]
        .filter(Boolean)
        .join(" · "),
    })),
    note: "Book with New Specialist Visit under Appointments.",
  };
}
