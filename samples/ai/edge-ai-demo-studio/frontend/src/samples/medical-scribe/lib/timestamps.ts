// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

const DISPLAY_FORMAT: Intl.DateTimeFormatOptions = {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: true,
}

const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T/

/** Now, as stored on a session: ISO 8601, so it sorts and reads in any locale. */
export function timestampNow(): string {
  return new Date().toISOString()
}

/**
 * A stored timestamp in day-first 12-hour local form ("06/10/2026, 11:42:05 pm"). Non-ISO values
 * (older sessions stored display text) are shown as they are.
 */
export function formatTimestamp(value: string | null | undefined): string {
  if (!value) return ''
  if (!ISO_DATE_TIME.test(value)) return value
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('en-GB', DISPLAY_FORMAT).toLowerCase()
}
