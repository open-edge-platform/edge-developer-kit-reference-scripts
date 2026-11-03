// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { useServiceInstances } from '@/context/service-status-context'
import { useSystemInfo } from '@/context/system-info-context'
import { useConfigureDraft } from '@/hooks/use-configure-draft'
import { useCreateInstance } from '@/hooks/use-instances'
import type { ServiceConfigUpdate } from '@/hooks/use-service-config'
import {
  duplicateInstanceLabelMessage,
  findInstanceWithLabel,
  uniqueInstanceLabel,
} from '@/lib/instances/instances'
import {
  instanceLimit,
  instanceRuntime,
} from '@/lib/instances/service-presentation'
import type { Service as PayloadService } from '@/payload-types'
import { hasConfigurePanel } from '@/services/common/configure/service-configure-dispatch'
import { resolveExecutionMode } from '@/services/execution'
import { isRunningStatus, type Service } from '@/services/types'
import {
  describeCreated,
  describeFirstStart,
  describeNewInstanceProblem,
} from './new-instance-copy'
import { useModelDownload } from './new-instance-downloads'
import {
  type DraftSummary,
  type DraftSummaryRow,
  sameDraftSummary,
} from './new-instance-summary'

/** Where the settings of the new instance come from, once others exist. */
export type SettingsMode = 'copy' | 'new'

/**
 * "Recommended settings" drafts from the first instance (for its engine and metadata) minus its
 * model choices, so the form opens on the recommended model and device.
 */
function withRecommendedModel(view: Service): Service {
  return {
    ...view,
    currentModel: undefined,
    currentDevice: undefined,
    currentBackend: undefined,
    currentModelType: undefined,
    currentQuant: undefined,
    currentSource: undefined,
  }
}

/**
 * Whether the user changed the drafted settings. The fields live in the service's own panel, so the
 * config is snapshotted on the first pointer/key press in the form and compared after each change;
 * values a panel fills in by itself before that (a detected device) never count.
 */
function useSettingsEdited(snapshot: () => string) {
  const baseline = useRef<string | null>(null)
  const latest = useRef(snapshot)
  const [edited, setEdited] = useState(false)
  useEffect(() => {
    latest.current = snapshot
  })
  return {
    edited,
    /** Pointer or key down in the form: before anything changes. */
    noteBaseline: () => {
      if (baseline.current === null) baseline.current = latest.current()
    },
    /** Pointer or key up, or an input changed: compare once it applied. */
    check: () => {
      window.setTimeout(() => {
        if (baseline.current !== null) {
          setEdited(latest.current() !== baseline.current)
        }
      }, 0)
    },
  }
}

/** State and rules of the New instance form, through to Create. */
export function useNewInstanceForm({
  service,
  copyFromInstanceId,
  onCreated,
  onClose,
}: {
  service: Service
  copyFromInstanceId?: string
  onCreated?: (instance: PayloadService) => void
  onClose: () => void
}) {
  const serviceType = service.id
  const instances = useServiceInstances(serviceType)
  const { systemInfo } = useSystemInfo()

  // A first instance drafts from the service's defaults; nothing to copy.
  const isFirstInstance = instances.length === 0
  const duplicating = Boolean(copyFromInstanceId) && !isFirstInstance
  const firstInstance = instances[0]
  const [copyFrom, setCopyFrom] = useState<string>(
    copyFromInstanceId ?? firstInstance?.instanceId ?? '',
  )
  const [initialCopyFrom] = useState(copyFrom)
  const copySource =
    instances.find((i) => i.instanceId === copyFrom) ?? firstInstance

  const canConfigure = hasConfigurePanel(service, systemInfo?.os)
  const [mode, setMode] = useState<SettingsMode>('copy')
  const drafting = canConfigure && (isFirstInstance || mode === 'new')
  // Once opened the form stays mounted (hidden while copying), so switching
  // back and forth keeps what was entered.
  const [formMounted, setFormMounted] = useState(isFirstInstance)
  const draftBase =
    isFirstInstance || !firstInstance
      ? service
      : withRecommendedModel(firstInstance)
  // The source's engine, read once on mount; EngineTabs moves it from there.
  const draft = useConfigureDraft(
    resolveExecutionMode(draftBase.execution, draftBase.engine),
  )

  // Stable callback, so a panel's `useDraftSummary` reports settle.
  const [panelSummary, setPanelSummary] = useState<DraftSummary | null>(null)
  const reportSummary = useCallback((next: DraftSummary | null) => {
    setPanelSummary((prev) => (sameDraftSummary(prev, next) ? prev : next))
  }, [])

  const chooseMode = (next: SettingsMode) => {
    setMode(next)
    if (next === 'new') setFormMounted(true)
  }

  // Prefilled with a free name, so the sheet can be confirmed as-is.
  const [label, setLabel] = useState(() =>
    uniqueInstanceLabel(
      duplicating && copySource ? `${copySource.label} copy` : service.name,
      instances.map((i) => i.label),
    ),
  )
  const [initialLabel] = useState(label)
  const [autostart, setAutostart] = useState(true)

  const settings = useSettingsEdited(() =>
    JSON.stringify([draft.engine, draft.collect() ?? null]),
  )
  // Autostart and the Copy / Recommended choice are one click to redo, so they do not count.
  const edited =
    label !== initialLabel || copyFrom !== initialCopyFrom || settings.edited

  const max = instanceLimit(service)
  const atLimit = instances.length >= max
  const nameError = !label.trim()
    ? 'Give the instance a name.'
    : findInstanceWithLabel(label, instances)
      ? duplicateInstanceLabelMessage(label)
      : undefined
  const settingsProblem = drafting && !draft.valid
  const isValid = !nameError && !atLimit && !settingsProblem

  // A copy of an instance running on a GPU shares that GPU's memory with it.
  const copyDevice = copySource?.currentDevice ?? ''
  const deviceInUse =
    !drafting && copyDevice.toLowerCase().startsWith('gpu')
      ? instances.find(
          (i) =>
            isRunningStatus(i.status) &&
            (i.currentDevice ?? '').toLowerCase() === copyDevice.toLowerCase(),
        )
      : undefined

  const {
    mutateAsync: create,
    isPending: creating,
    isError: createFailed,
    error: createError,
  } = useCreateInstance()
  // A second click can land before the re-render that disables the button.
  const submitting = useRef(false)
  // Closing mid-request does not cancel it, so the outcome is then
  // announced with a way to open the new instance.
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const createNow = async (config: ServiceConfigUpdate | undefined) => {
    submitting.current = true
    let doc: PayloadService
    try {
      doc = await create({
        type: serviceType,
        label: label.trim(),
        copyFrom: isFirstInstance
          ? undefined
          : drafting
            ? firstInstance?.dbId
            : copySource?.dbId,
        // "Copy settings" always copies the source's engine too.
        engine: drafting ? draft.engine : undefined,
        // An empty config means the copied settings already match.
        config: config && Object.keys(config).length > 0 ? config : undefined,
        autostart,
      })
    } catch {
      // The footer shows why (and the hook toasts it); every value stays.
      return
    } finally {
      submitting.current = false
    }
    const { title, description } = describeCreated({
      serviceName: service.name,
      isFirstInstance,
      name: doc.label ?? doc.instanceId,
      autostart,
    })
    if (mounted.current) {
      toast.success(title, { description })
      onCreated?.(doc)
      onClose()
      return
    }
    // Closed meanwhile: announce it without navigating the user away.
    toast.success(title, {
      description,
      action: onCreated && { label: 'Open', onClick: () => onCreated(doc) },
    })
  }

  const submit = () => {
    // A second request would race the first for the same name.
    if (!isValid || creating || submitting.current) return
    let config: ServiceConfigUpdate | undefined
    if (drafting) {
      // Undefined if the form is invalid.
      config = draft.collect()
      if (!config) return
    }
    createNow(config)
  }

  const preview = drafting
    ? draft.preview
    : copySource
      ? instanceRuntime(copySource)
      : {
          model: service.defaultModel?.name,
          device: service.defaultModel?.device,
        }

  const downloadSource = drafting ? draftBase : (copySource ?? service)
  const download = useModelDownload({
    service,
    instanceKey: downloadSource.instanceKey ?? service.id,
    engine: drafting
      ? draft.engine
      : resolveExecutionMode(downloadSource.execution, downloadSource.engine),
    model: preview.model,
  })
  const summary = drafting ? panelSummary : null
  // A drafted model or device not chosen yet says so; a setup without one
  // (a service with no model) leaves the row out.
  const unset = drafting ? 'Not chosen yet' : undefined
  const modelValue = preview.model || unset
  const deviceValue = preview.device || unset
  const summaryRows: DraftSummaryRow[] = summary?.rows ?? [
    ...(!drafting && copySource
      ? [{ label: 'Settings', value: `Copied from “${copySource.label}”` }]
      : []),
    ...(modelValue
      ? [{ label: 'Model', value: modelValue, mono: Boolean(preview.model) }]
      : []),
    ...(deviceValue ? [{ label: 'Device', value: deviceValue }] : []),
  ]
  const firstStart = summary
    ? describeFirstStart({
        downloads: summary.downloads,
        note: summary.firstStartNote,
      })
    : download && describeFirstStart({ downloads: [download] })

  const problem = describeNewInstanceProblem({
    serviceName: service.name,
    max,
    atLimit,
    settingsProblem,
    firstIssue: draft.issues[0],
    isFirstInstance,
    createError: createFailed ? createError : undefined,
  })

  return {
    instances,
    isFirstInstance,
    duplicating,
    copyFrom,
    setCopyFrom,
    copySource,
    canConfigure,
    mode,
    chooseMode,
    drafting,
    formMounted,
    draftBase,
    draft,
    reportSummary,
    label,
    setLabel,
    nameError,
    autostart,
    setAutostart,
    deviceInUse,
    copyDevice,
    model: preview.model,
    summaryRows,
    firstStart,
    edited,
    noteSettingsBaseline: settings.noteBaseline,
    checkSettingsEdited: settings.check,
    problem,
    isValid,
    creating,
    submit,
  }
}
