// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/** Shared by chain.ts and the touch step so both modes ask the same pre-visit questions. */

export const PRE_VISIT_QUESTIONS = [
  { id: "medsChanged", question: "Have your medicines or allergies changed since your last visit?" },
  { id: "infection", question: "In the last 3 days, have you had a fever, cough or rash?" },
] as const;

export const YES_NO = [
  { value: "no", label: "No" },
  { value: "yes", label: "Yes" },
];

/** Check-in opens an hour before and stays open; past 30 minutes late the clinic is told. */
export type Arrival = "early" | "on_time" | "late";

export function arrivalFor(time: string, now = new Date()): { arrival: Arrival; minutes: number } {
  const [hours, minutes] = time.split(":").map(Number);
  const slot = new Date(now);
  slot.setHours(hours, minutes, 0, 0);
  const diff = Math.round((slot.getTime() - now.getTime()) / 60_000);
  return { arrival: diff > 60 ? "early" : diff < -30 ? "late" : "on_time", minutes: Math.abs(diff) };
}

export function arrivalNote(time: string, now = new Date()): string | null {
  const { arrival, minutes } = arrivalFor(time, now);
  if (arrival === "early") return `You're ${duration(minutes)} early — take a seat and we'll call you closer to ${time}.`;
  if (arrival === "late") return `You're ${duration(minutes)} past your ${time} appointment — the clinic has been told and will fit you in.`;
  return null;
}

function duration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}
