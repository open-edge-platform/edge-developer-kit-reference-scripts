// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

// Display formatting, in the locales the country pack (or config.yaml's `locale:` block) chose.
const MONEY_LOCALE = process.env.NEXT_PUBLIC_KIOSK_MONEY_LOCALE ?? "en-MY";
const DATE_LOCALE = process.env.NEXT_PUBLIC_KIOSK_DATE_LOCALE ?? "en-MY";
const CLOCK_LOCALE = process.env.NEXT_PUBLIC_KIOSK_CLOCK_LOCALE ?? "en-US";

/** Client-side counterpart of `CURRENCY` in src/app/api/_lib/registry.ts — keep in sync. */
export const kioskCurrency = (): string =>
  process.env.NEXT_PUBLIC_KIOSK_CURRENCY ?? "MYR";

export function formatMoney(amount: number, currency: string): string {
  return new Intl.NumberFormat(MONEY_LOCALE, { style: "currency", currency }).format(amount);
}

export function formatTime(date: Date | null): string {
  if (!date) return "";
  return date.toLocaleTimeString(CLOCK_LOCALE, { hour: "numeric", minute: "2-digit" });
}

export function formatDate(date: Date | null): string {
  if (!date) return "";
  return date.toLocaleDateString(CLOCK_LOCALE, {
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
  return new Date(iso).toLocaleDateString(DATE_LOCALE, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function hasExpired(iso: string): boolean {
  return new Date(iso).getTime() < Date.now();
}

/** Irregular plurals pass the second form: `plural(n, "summons", "summonses")`. English only. */
export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return count === 1 ? singular : pluralForm;
}

export function countOf(count: number, singular: string, pluralForm?: string): string {
  return `${count} ${plural(count, singular, pluralForm)}`;
}
