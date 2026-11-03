// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

// Display formatting, in the locales the country pack (or config.yaml's `locale:` block) chose.
import { publicText } from "@/lib/public-config";

const MONEY_LOCALE = () => publicText("NEXT_PUBLIC_KIOSK_MONEY_LOCALE", "en-MY");
const DATE_LOCALE = () => publicText("NEXT_PUBLIC_KIOSK_DATE_LOCALE", "en-MY");
const CLOCK_LOCALE = () => publicText("NEXT_PUBLIC_KIOSK_CLOCK_LOCALE", "en-US");

/** Client-side counterpart of `CURRENCY` in src/app/api/_lib/registry.ts — keep in sync. */
export const kioskCurrency = (): string => publicText("NEXT_PUBLIC_KIOSK_CURRENCY", "MYR");

export function formatMoney(amount: number, currency: string): string {
  return new Intl.NumberFormat(MONEY_LOCALE(), { style: "currency", currency }).format(amount);
}

export function formatTime(date: Date | null): string {
  if (!date) return "";
  return date.toLocaleTimeString(CLOCK_LOCALE(), { hour: "numeric", minute: "2-digit" });
}

export function formatDate(date: Date | null): string {
  if (!date) return "";
  return date.toLocaleDateString(CLOCK_LOCALE(), {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  return `${formatDate(date)} · ${formatTime(date)}`;
}

export function formatShortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(DATE_LOCALE(), {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** A calendar day ("1988-07-23") in full: 23 July 1988. */
export function formatLongDate(iso: string): string {
  return new Date(`${iso}T00:00`).toLocaleDateString(DATE_LOCALE(), { day: "numeric", month: "long", year: "numeric" });
}

/** A calendar day ("2026-10-07") split for a date tile: weekday, day of month, month. */
export function formatDayParts(iso: string): { weekday: string; day: string; month: string } {
  const date = new Date(`${iso}T00:00`);
  const part = (options: Intl.DateTimeFormatOptions) => date.toLocaleDateString(DATE_LOCALE(), options);
  return { weekday: part({ weekday: "short" }), day: part({ day: "numeric" }), month: part({ month: "short" }) };
}

/** Irregular plurals pass the second form: `plural(n, "summons", "summonses")`. English only. */
export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return count === 1 ? singular : pluralForm;
}

export function countOf(count: number, singular: string, pluralForm?: string): string {
  return `${count} ${plural(count, singular, pluralForm)}`;
}
