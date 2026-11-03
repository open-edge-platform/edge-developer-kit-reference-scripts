// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { getErrorMessage } from '@/lib/errors'
import { plural } from '@/lib/browser/format'
import type { DraftDownload } from './new-instance-summary'

/** The New instance sheet's wording. Pure, so every combination can be tested. */
export function describeNewInstance({
  serviceName,
  isFirstInstance,
  duplicating,
  sourceLabel,
  autostart,
  hasModel = true,
}: {
  serviceName: string
  /** Nothing added yet: this instance adds the service. */
  isFirstInstance: boolean
  duplicating: boolean
  /** The instance being duplicated. */
  sourceLabel?: string
  autostart: boolean
  /** The service runs a model (a vector store, for one, does not). */
  hasModel?: boolean
}) {
  const source = `“${sourceLabel ?? 'instance'}”`
  const own = hasModel ? 'its own model and device' : 'its own settings'
  return {
    title: isFirstInstance
      ? `Add ${serviceName}`
      : duplicating
        ? `Duplicate ${source}`
        : `Add ${serviceName} instance`,
    description: isFirstInstance
      ? `An instance runs this service with ${own}. The recommended setup works for most systems; you can change it later.`
      : duplicating
        ? `Starts with every setting of ${source}. Give it a name of its own.`
        : `Run another ${serviceName} instance alongside the existing ones, with ${own}.`,
    /** "You're adding" / "You're creating", over the summary. */
    verb: isFirstInstance ? 'adding' : 'creating',
    autostartLabel: isFirstInstance
      ? 'Start after adding'
      : 'Start after creating',
    submitLabel: isFirstInstance
      ? autostart
        ? 'Add and start'
        : 'Add service'
      : autostart
        ? 'Create and start'
        : 'Create instance',
    pendingLabel: isFirstInstance ? 'Adding…' : 'Creating…',
    /** The create request cannot be called back, so closing does not stop it. */
    pendingNote: isFirstInstance
      ? `Adding ${serviceName}. Closing this does not cancel it.`
      : `Creating the instance. Closing this does not cancel it.`,
  }
}

/** The discard prompt: nothing exists yet, only what was entered is lost. */
export function describeDiscard({
  serviceName,
  isFirstInstance,
}: {
  serviceName: string
  isFirstInstance: boolean
}): string {
  return isFirstInstance
    ? `${serviceName} has not been added. The name and settings you entered will be lost.`
    : 'The instance has not been created. The name and settings you entered will be lost.'
}

const listFormat = new Intl.ListFormat('en', {
  style: 'long',
  type: 'conjunction',
})

function names(downloads: DraftDownload[]): string {
  return listFormat.format(
    downloads.map((d) => (d.large ? `${d.label} (a large model)` : d.label)),
  )
}

/**
 * What a new instance's first start fetches. Never names a size or claims a download the catalogue
 * could not confirm. `fetches`: there is something to wait for.
 */
export function describeFirstStart({
  downloads,
  note,
}: {
  downloads: DraftDownload[]
  note?: string
}): { text: string; fetches: boolean } {
  const missing = downloads.filter((d) => d.downloaded !== true)
  const onDisk = downloads.filter((d) => d.downloaded === true)
  const one = (list: DraftDownload[]) => list.length === 1
  const parts = note ? [note] : []

  if (missing.length > 0) {
    const unsure = missing.some((d) => d.downloaded === undefined)
    parts.push(
      `The first start downloads ${names(missing)}${
        unsure
          ? one(missing)
            ? ' if it is not on this machine yet'
            : ' if they are not on this machine yet'
          : ''
      }, which can take several minutes.`,
    )
    if (onDisk.length > 0) {
      parts.push(
        `${names(onDisk)} ${one(onDisk) ? 'is' : 'are'} already downloaded.`,
      )
    }
  } else if (onDisk.length > 0) {
    parts.push(
      `${names(onDisk)} ${one(onDisk) ? 'is' : 'are'} already downloaded, so the first start only loads ${one(onDisk) ? 'it' : 'them'}.`,
    )
  } else if (!note) {
    parts.push('There is no model to download.')
  }
  return { text: parts.join(' '), fetches: Boolean(note) || missing.length > 0 }
}

/** The success toast, once the row exists. */
export function describeCreated({
  serviceName,
  isFirstInstance,
  name,
  autostart,
}: {
  serviceName: string
  isFirstInstance: boolean
  name: string
  autostart: boolean
}): { title: string; description: string } {
  // Created is not ready: a started instance still has to load and pass its health check.
  return {
    title: isFirstInstance
      ? `${serviceName} added as “${name}”`
      : `Instance “${name}” created`,
    description: autostart
      ? 'Starting now — its page shows when it is ready.'
      : 'It stays stopped until you start it.',
  }
}

/** What blocks Create, in order: the instance limit, the first settings issue, a failed request. */
export function describeNewInstanceProblem({
  serviceName,
  max,
  atLimit,
  settingsProblem,
  firstIssue,
  isFirstInstance,
  createError,
}: {
  serviceName: string
  max: number
  atLimit: boolean
  settingsProblem: boolean
  firstIssue?: { message?: string; pending?: boolean }
  isFirstInstance: boolean
  createError?: unknown
}): {
  message: string | undefined
  /** Only waiting (devices still being detected), nothing to fix. */
  waiting: boolean
  /** "Review settings" can lead to the field in error. */
  reviewable: boolean
} {
  const waiting = settingsProblem && !atLimit && firstIssue?.pending === true
  const message = atLimit
    ? `${serviceName} already has the maximum of ${plural(max, 'instance')}.`
    : settingsProblem
      ? (firstIssue?.message ?? 'Some settings need attention.')
      : createError !== undefined
        ? `Couldn't ${isFirstInstance ? 'add the service' : 'create the instance'}: ${getErrorMessage(createError, 'the request failed.')}`
        : undefined
  return {
    message,
    waiting,
    reviewable: settingsProblem && !atLimit && !waiting,
  }
}
