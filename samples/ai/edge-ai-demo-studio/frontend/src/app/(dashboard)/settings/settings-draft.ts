// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/** Settings page draft model (no React): which drafts are changes, and how a save settles them. */

import { clampTimeout, type Theme } from '@/lib/settings/app-settings'

/** The settings the page edits, one per section, in page order. */
const SETTINGS_FIELDS = [
  'theme',
  'hfToken',
  'startupTimeout',
  'proxyTimeout',
] as const
export type SettingsField = (typeof SETTINGS_FIELDS)[number]

/** How a field is named in save results ("Not saved: proxy timeout"). */
export const FIELD_NAMES: Record<SettingsField, string> = {
  theme: 'theme',
  hfToken: 'Hugging Face token',
  startupTimeout: 'startup timeout',
  proxyTimeout: 'proxy timeout',
}

/** What each field holds while edited; `null` until touched (the saved value shows). */
export interface SettingsDrafts {
  theme: Theme | null
  /** Typed text; `''` after typing then clearing asks to remove a saved token. */
  hfToken: string | null
  startupTimeout: string | null
  proxyTimeout: string | null
}

export const UNTOUCHED: SettingsDrafts = {
  theme: null,
  hfToken: null,
  startupTimeout: null,
  proxyTimeout: null,
}

/**
 * The saved values the page could load; a field is missing while its
 * request is pending or after it failed — never a default standing in.
 */
export interface SavedSettings {
  theme?: Theme
  hasToken?: boolean
  startupTimeout?: number
  proxyTimeout?: number
}

/** What a save sends: only the settings that changed. */
export interface SettingsChanges {
  theme?: Theme
  startupTimeout?: number
  proxyTimeout?: number
  /** A new token; `''` removes the saved one. */
  hfToken?: string
}

/**
 * The seconds a timeout field's text stands for: whole seconds, at least the
 * minimum; `fallback` (the saved value) when the text is empty or no number.
 */
export function parseTimeoutDraft(raw: string, fallback: number): number {
  const text = raw.trim()
  return clampTimeout(text === '' ? Number.NaN : Number(text), fallback)
}

/**
 * The drafts that differ from their saved value. A field whose saved value
 * is not loaded has no change: there is nothing confirmed to compare it to.
 */
export function pendingChanges(
  drafts: SettingsDrafts,
  saved: SavedSettings,
): SettingsChanges {
  const changes: SettingsChanges = {}
  if (
    drafts.theme !== null &&
    saved.theme !== undefined &&
    drafts.theme !== saved.theme
  ) {
    changes.theme = drafts.theme
  }
  // An empty field removes a saved token; with none saved it changes nothing.
  if (
    drafts.hfToken !== null &&
    saved.hasToken !== undefined &&
    (drafts.hfToken.trim() !== '' || saved.hasToken)
  ) {
    changes.hfToken = drafts.hfToken
  }
  for (const field of ['startupTimeout', 'proxyTimeout'] as const) {
    const draft = drafts[field]
    const savedSeconds = saved[field]
    if (draft === null || savedSeconds === undefined) continue
    const seconds = parseTimeoutDraft(draft, savedSeconds)
    if (seconds !== savedSeconds) changes[field] = seconds
  }
  return changes
}

/** The fields `changes` names, in page order. */
export function changedFields(changes: SettingsChanges): SettingsField[] {
  return SETTINGS_FIELDS.filter((field) => changes[field] !== undefined)
}

export function pickChanges(
  changes: SettingsChanges,
  fields: readonly SettingsField[],
): SettingsChanges {
  const picked: Record<string, unknown> = {}
  for (const field of fields) {
    if (changes[field] !== undefined) picked[field] = changes[field]
  }
  return picked as SettingsChanges
}

/**
 * Drafts after a save: a saved field resets only if its draft still holds what was submitted
 * (edits made meanwhile stay); failed fields keep their draft.
 */
export function settleDrafts(
  current: SettingsDrafts,
  submitted: Partial<SettingsDrafts>,
  savedFields: readonly SettingsField[],
): SettingsDrafts {
  let next = current
  for (const field of savedFields) {
    if (current[field] !== null && current[field] === submitted[field]) {
      next = { ...next, [field]: null }
    }
  }
  return next
}

/** The drafts of `fields` as they are now: what a save submits. */
export function pickDrafts(
  drafts: SettingsDrafts,
  fields: readonly SettingsField[],
): Partial<SettingsDrafts> {
  return Object.fromEntries(fields.map((field) => [field, drafts[field]]))
}

/** How one field's save went: `error` is the reason it was not saved. */
export type SaveOutcome = { ok: true } | { ok: false; error: string }
export type SaveResults = Partial<Record<SettingsField, SaveOutcome>>

/** Results kept when a save of `sending` starts: failures of fields it doesn't resend. */
export function outcomesBeforeSave(
  outcomes: SaveResults,
  sending: readonly SettingsField[],
): SaveResults {
  const kept: SaveResults = {}
  for (const field of SETTINGS_FIELDS) {
    const outcome = outcomes[field]
    if (outcome && !outcome.ok && !sending.includes(field)) {
      kept[field] = outcome
    }
  }
  return kept
}

/** `outcomes` without `field`'s: an edit makes its last result out of date. */
export function withoutOutcome(
  outcomes: SaveResults,
  field: SettingsField,
): SaveResults {
  if (!(field in outcomes)) return outcomes
  const rest = { ...outcomes }
  delete rest[field]
  return rest
}

/** Joins names as prose: "theme", "theme and proxy timeout", "a, b and c". */
export function listNames(names: readonly string[]): string {
  if (names.length <= 1) return names.join('')
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}
