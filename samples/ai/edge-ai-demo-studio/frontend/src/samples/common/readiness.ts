// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { SystemInfo } from '@/hooks/use-system-info'
import { plural } from '@/lib/browser/format'
import { STATE_LABEL } from '@/lib/instances/service-presentation'
import { getServiceById } from '@/services/registry'
import type { Service, ServiceStatus } from '@/services/types'
import { getOSLabel, type OS } from '@/types/common'
import {
  getMissingSampleDevices,
  getSampleSupportedOS,
  isSampleSupportedOnOS,
} from '../registry'
import type { ReadinessStatus, Sample, ServiceDependency } from '../types'
import { getOptionalDeps, getRequiredDeps } from '../types'

/**
 * One readiness model shared by the gallery, detail page and demo header. Every declared dependency
 * counts (no record = `missing`, so an empty list never reads as ready), and a failed lookup never
 * reads as good: `unavailable` (status or bindings could not load; empty bindings must not read as
 * Automatic), `unverified` (an OS/device requirement could not be checked), `stale` (refetch failed).
 */

/** A dependency's status, plus `missing` for a type with no service record. */
export type DependencyStatus = ServiceStatus | 'missing'

export interface SampleDependencyView {
  serviceId: string
  name: string
  role: 'required' | 'optional'
  /** The view the sample resolves the type to: its bound instance, else the type's primary one. */
  service: Service | undefined
  status: DependencyStatus
  /** Key that start/configure/log actions target: the bound instance key, else the type. */
  key: string
  /** Instances the type has; with several, surfaces say which one is in use. */
  instanceCount: number
  impactText?: string
}

export type SampleReadinessState =
  | 'unsupported'
  | 'checking'
  | 'unavailable'
  | 'failed'
  | 'needs-setup'
  | 'starting'
  /** Services are online, but a declared OS/device requirement could not be checked. */
  | 'unverified'
  | 'ready'

/** The one main action a surface offers for the sample. */
export type SampleNextAction =
  'try' | 'set-up' | 'view-requirements' | 'details'

export interface SampleCompatibility {
  supported: boolean
  /** This machine's OS is one the sample runs on (devices aside). */
  osSupported: boolean
  /** The precise reason, when unsupported. */
  reason?: string
  supportedOS: OS[]
  missingDevices: string[]
}

export interface SampleReadinessInputs {
  /** A dependency as this sample sees it: its bound instance, else the type's primary instance. */
  resolve: (type: string) => Service | undefined
  /** The type-level view (carries the instance list). Defaults to `resolve`. */
  typeView?: (type: string) => Service | undefined
  /** The instance key the sample binds a type to, if any. */
  boundKey?: (type: string) => string | undefined
  /** Service status has never loaded. */
  statusLoading: boolean
  /** Service status failed and nothing was ever loaded. */
  statusUnavailable: boolean
  /** The last refresh failed but earlier data is still shown. */
  statusStale?: boolean
  /** The stored instance bindings failed and nothing was ever loaded. */
  bindingsUnavailable: boolean
  /** A bindings refetch failed but the last bindings that loaded are still in use. */
  bindingsStale?: boolean
  systemInfo: SystemInfo | null | undefined
  systemLoading: boolean
  /** The device check failed: `systemInfo` is null and loading has ended. */
  systemUnavailable: boolean
}

export interface SampleReadinessView {
  state: SampleReadinessState
  /** Coarse verdict for the gallery filter and sort; `blocked` whenever the sample cannot launch. */
  readiness: ReadinessStatus
  /** Short readable summary, e.g. "Needs setup · 2 services stopped". */
  label: string
  /** The sentence a setup surface leads with, when there is more to say. */
  detail?: string
  action: SampleNextAction
  required: SampleDependencyView[]
  optional: SampleDependencyView[]
  requiredReady: number
  requiredTotal: number
  optionalReady: number
  optionalTotal: number
  missing: SampleDependencyView[]
  stopped: SampleDependencyView[]
  starting: SampleDependencyView[]
  failed: SampleDependencyView[]
  optionalOffline: SampleDependencyView[]
  allRequiredOnline: boolean
  /** Status is known (neither checking nor unavailable). */
  settled: boolean
  /** Which lookup failed, when the state is `unavailable`. */
  unavailableReason?: 'status' | 'bindings'
  /** A declared OS/device requirement could not be checked; set in any state, not only `unverified`. */
  compatibilityUnknown: boolean
  stale: boolean
  /** What is out of date, when `stale`; service status wins over bindings. */
  staleNote?: string
  canLaunch: boolean
  /** Setup needs the user's attention or is in progress. */
  needsAction: boolean
  /** `undefined` while system information is still loading. */
  compatibility: SampleCompatibility | undefined
}

/** Whether this machine's OS and devices can run the sample, and why not. */
export function describeSampleCompatibility(
  sample: Sample,
  systemInfo: SystemInfo,
): SampleCompatibility {
  const supportedOS = getSampleSupportedOS(sample)
  const osSupported = isSampleSupportedOnOS(sample, systemInfo.os)
  const missingDevices = getMissingSampleDevices(sample, systemInfo.devices)
  let reason: string | undefined
  if (!osSupported) {
    reason = `Not available on ${getOSLabel(systemInfo.os)}`
  } else if (missingDevices.length > 0) {
    reason = `Requires a ${missingDevices
      .map((d) => d.toUpperCase())
      .join(', ')} device that was not detected`
  }
  return {
    supported: osSupported && missingDevices.length === 0,
    osSupported,
    reason,
    supportedOS,
    missingDevices,
  }
}

function toDependencyView(
  dep: ServiceDependency,
  inputs: SampleReadinessInputs,
): SampleDependencyView {
  const service = inputs.resolve(dep.serviceId)
  const typeView = (inputs.typeView ?? inputs.resolve)(dep.serviceId)
  const instanceCount = typeView?.instances?.length ?? 0
  return {
    serviceId: dep.serviceId,
    name: getServiceById(dep.serviceId)?.name ?? service?.name ?? dep.serviceId,
    role: dep.role,
    service,
    status: service ? service.status : 'missing',
    key: inputs.boundKey?.(dep.serviceId) ?? dep.serviceId,
    instanceCount,
    impactText: dep.impactText,
  }
}

const isOnline = (d: SampleDependencyView) => d.status === 'online'

export function computeSampleReadinessView(
  sample: Sample,
  inputs: SampleReadinessInputs,
): SampleReadinessView {
  const required = getRequiredDeps(sample).map((d) =>
    toDependencyView(d, inputs),
  )
  const optional = getOptionalDeps(sample).map((d) =>
    toDependencyView(d, inputs),
  )

  const requiredReady = required.filter(isOnline).length
  const optionalReady = optional.filter(isOnline).length
  const missing = required.filter((d) => d.status === 'missing')
  const failed = required.filter((d) => d.status === 'error')
  const starting = required.filter((d) => d.status === 'starting')
  const stopped = required.filter((d) => d.status === 'offline')
  const optionalOffline = optional.filter((d) => !isOnline(d))
  const allRequiredOnline = requiredReady === required.length

  // A failed device check leaves the verdict unknown, not favourable: a sample that declares an
  // OS or device requirement waits in `unverified` instead of launching.
  const compatibility =
    inputs.systemLoading || !inputs.systemInfo
      ? undefined
      : describeSampleCompatibility(sample, inputs.systemInfo)
  const declaresRequirements = Boolean(
    sample.supportedOS?.length || sample.requiredDevices?.length,
  )
  const compatibilityUnknown = inputs.systemUnavailable && declaresRequirements

  let state: SampleReadinessState
  if (compatibility && !compatibility.supported) state = 'unsupported'
  else if (inputs.statusLoading || inputs.systemLoading) state = 'checking'
  else if (inputs.statusUnavailable || inputs.bindingsUnavailable)
    state = 'unavailable'
  else if (failed.length > 0) state = 'failed'
  else if (missing.length > 0 || stopped.length > 0) state = 'needs-setup'
  else if (starting.length > 0) state = 'starting'
  else if (compatibilityUnknown) state = 'unverified'
  else state = 'ready'

  const unavailableReason =
    state === 'unavailable'
      ? inputs.statusUnavailable
        ? ('status' as const)
        : ('bindings' as const)
      : undefined

  const statusStale = inputs.statusStale ?? false
  const bindingsStale = inputs.bindingsStale ?? false
  const staleNote = statusStale
    ? 'Service status may be out of date'
    : bindingsStale
      ? 'Selected instances may be out of date'
      : undefined

  let label: string
  let detail: string | undefined
  let action: SampleNextAction
  switch (state) {
    case 'unsupported': {
      label = compatibility?.reason ?? 'Not supported on this device'
      const supported = compatibility?.supportedOS.map(getOSLabel) ?? []
      detail =
        compatibility && !compatibility.osSupported
          ? supported.length > 0
            ? `Supported on ${supported.join(', ')}.`
            : undefined
          : sample.requiredDevices?.length
            ? `Required devices: ${sample.requiredDevices
                .map((d) => d.toUpperCase())
                .join(', ')}.`
            : undefined
      action = 'view-requirements'
      break
    }
    case 'checking':
      label = 'Checking services…'
      action = 'details'
      break
    case 'unavailable':
      // The stored bindings decide which instance the sample uses, so a
      // failed bindings load is named for what it is, never as Automatic.
      if (unavailableReason === 'bindings') {
        label = 'Could not load the selected instances'
        detail = 'Retry to load which instances this sample uses.'
      } else {
        label = 'Status unavailable'
        detail = 'Could not check requirements.'
      }
      action = 'details'
      break
    case 'failed':
      label =
        failed.length === 1
          ? `${failed[0].name} could not start`
          : `${failed.length} required services could not start`
      detail = 'Retry the failed service, or check its logs.'
      action = 'set-up'
      break
    case 'needs-setup':
      if (missing.length > 0) {
        label =
          missing.length === 1
            ? `Needs setup · ${missing[0].name} not set up`
            : `Needs setup · ${missing.length} services not set up`
        detail =
          missing.length === 1
            ? `Set up ${missing[0].name} to continue.`
            : `Set up ${missing.map((d) => d.name).join(', ')} to continue.`
      } else {
        label = `Needs setup · ${plural(stopped.length, 'service')} stopped`
        detail = `Start ${plural(stopped.length, 'required service')} to continue.`
      }
      action = 'set-up'
      break
    case 'starting':
      label = `Starting services · ${requiredReady} of ${required.length} running`
      action = 'set-up'
      break
    case 'unverified':
      label = 'Services running · Compatibility not checked'
      detail = 'Retry the device check to launch.'
      action = 'details'
      break
    case 'ready':
      label = 'Ready to try'
      detail =
        optionalOffline.length > 0
          ? `${plural(optionalOffline.length, 'optional service')} unavailable`
          : undefined
      action = 'try'
      break
  }

  return {
    state,
    readiness:
      state === 'ready'
        ? optionalOffline.length > 0
          ? 'partial'
          : 'ready'
        : 'blocked',
    label,
    detail,
    action,
    required,
    optional,
    requiredReady,
    requiredTotal: required.length,
    optionalReady,
    optionalTotal: optional.length,
    missing,
    stopped,
    starting,
    failed,
    optionalOffline,
    allRequiredOnline,
    settled: state !== 'checking' && state !== 'unavailable',
    unavailableReason,
    compatibilityUnknown,
    stale: statusStale || bindingsStale,
    staleNote,
    canLaunch: state === 'ready',
    needsAction:
      state === 'needs-setup' || state === 'failed' || state === 'starting',
    compatibility,
  }
}

/** "1 of 3 required services running" — a count, never a percentage. */
export function requiredSummary(view: SampleReadinessView): string {
  return `${view.requiredReady} of ${plural(view.requiredTotal, 'required service')} running`
}

/** A dependency's status in the services' own words, or "Not set up". */
export function dependencyStatusLabel(status: DependencyStatus): string {
  return status === 'missing' ? 'Not set up' : STATE_LABEL[status]
}
