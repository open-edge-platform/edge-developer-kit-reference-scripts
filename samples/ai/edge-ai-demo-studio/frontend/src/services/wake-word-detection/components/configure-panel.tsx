// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Mic } from 'lucide-react'
import { useId, useState } from 'react'
import {
  ConfigSection,
  LabelWithTooltip,
} from '@/components/configure/config-section'
import { useDraftSummary } from '@/components/services/new-instance-summary'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Slider } from '@/components/ui/slider'
import { useConfigureDraftHost } from '@/hooks/use-configure-draft'
import { getServiceMetadata } from '@/lib/instances/service-metadata'
import {
  DownloadedBadge,
  ModelCatalogSummary,
} from '@/services/common/configure/model-catalog-note'
import {
  useWorkerModelCatalog,
  type WorkerModelCatalog,
} from '@/services/common/configure/use-worker-model-catalog'
import { WorkerConfigurePanel } from '@/services/common/configure/worker-configure-panel'
import type { ModelOption, Service } from '@/services/types'
import { getEffectiveModel } from '@/types/service'
import { useWakeWordDevices } from '../hooks/use-wake-word-queries'
import {
  parseModelNames,
  sameModelSet,
  wakeWordLabel,
} from '../lib/model-names'
import { WakeWordCheckboxRow } from './wake-word-checkbox-row'

/** The worker's `--vad-threshold` when `metadata.vadThreshold` is unset. */
const DEFAULT_VAD_THRESHOLD = 0.2

/** How sure voice activity detection must be that someone speaks before a wake word counts. */
function VadThresholdSection({
  value,
  onChange,
}: {
  value: number
  onChange: (value: number) => void
}) {
  return (
    <ConfigSection title="Voice Activity Detection" className="space-y-2">
      <div className="flex items-center justify-between">
        <LabelWithTooltip
          label="VAD threshold"
          tooltip="A detection only counts while the voice activity detector is at least this sure that someone is speaking. 0 turns the check off."
        />
        <span
          className="text-foreground bg-muted/50 rounded px-1.5 py-0.5 font-mono text-xs"
          data-testid="cfg-vad-threshold-value"
        >
          {value.toFixed(2)}
        </span>
      </div>
      <Slider
        data-testid="cfg-vad-threshold"
        aria-label="VAD threshold"
        value={[value]}
        min={0}
        max={1}
        step={0.05}
        onValueChange={([v]) => onChange(Math.round(v * 100) / 100)}
      />
      <p className="text-muted-foreground text-xs">
        Raise it if noise or music sets off detections; lower it if quiet speech
        is missed. Default {DEFAULT_VAD_THRESHOLD}.
      </p>
    </ConfigSection>
  )
}

/** "No fixed device": saved as `audioDevice: null`, so the worker uses the system default. */
const SYSTEM_DEFAULT_DEVICE = 'system'

const deviceValue = (device: number | null) =>
  device != null ? String(device) : SYSTEM_DEFAULT_DEVICE

function WakeWordsSection({
  presets,
  customModels,
  selected,
  onToggle,
  catalog,
}: {
  presets: ModelOption[]
  /** Saved wake words that are no preset, listed after them. */
  customModels: string[]
  selected: string[]
  onToggle: (value: string) => void
  catalog: WorkerModelCatalog
}) {
  return (
    <ConfigSection title="Wake Words">
      <div className="space-y-1">
        {presets.map((m) => (
          <WakeWordCheckboxRow
            key={m.value}
            value={m.value}
            label={m.label}
            hint={m.value}
            checked={selected.includes(m.value)}
            onToggle={() => onToggle(m.value)}
            badge={
              catalog.isDownloaded(m.value) && (
                <DownloadedBadge model={m.value} />
              )
            }
          />
        ))}
        {customModels.map((name) => (
          <WakeWordCheckboxRow
            key={name}
            value={name}
            label={name}
            checked={selected.includes(name)}
            onToggle={() => onToggle(name)}
          />
        ))}
      </div>
      <ModelCatalogSummary catalog={catalog} />
      {selected.length === 0 && (
        <p
          data-testid="cfg-wake-words-error"
          className="text-destructive text-xs"
        >
          Select at least one wake word.
        </p>
      )}
    </ConfigSection>
  )
}

function MicrophoneSection({
  service,
  active,
  value,
  onChange,
  savedDevice,
}: {
  service: Service
  /** The panel is shown: ask the running instance for its microphones. */
  active: boolean
  value: string
  onChange: (value: string) => void
  savedDevice: number | null
}) {
  const id = useId()
  // Only the running instance knows which microphones its host exposes.
  const isOnline = service.status === 'online'
  const { data } = useWakeWordDevices(service.apiBase, {
    enabled: active && isOnline,
  })

  const options = [{ value: SYSTEM_DEFAULT_DEVICE, label: 'System default' }]
  if (isOnline) {
    for (const d of data?.devices ?? []) {
      // Skip the worker's own "System Default" (id -1): SYSTEM_DEFAULT_DEVICE covers it, and the
      // saved `audioDevice` must be null for the default, not -1.
      if (d.id < 0) continue
      options.push({ value: String(d.id), label: d.name })
    }
  }
  // Keep a saved device the live list lacks (offline, unplugged) so the trigger isn't blank.
  if (
    savedDevice != null &&
    !options.some((o) => o.value === String(savedDevice))
  ) {
    options.push({ value: String(savedDevice), label: `Device ${savedDevice}` })
  }

  return (
    <ConfigSection title="Microphone" className="space-y-2">
      <Label htmlFor={id} className="text-muted-foreground text-xs">
        <Mic aria-hidden className="mr-1 inline-block h-3 w-3" />
        Input device
      </Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger
          data-testid="cfg-audio-device-select"
          id={id}
          className="w-full text-xs"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value} className="text-xs">
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p
        data-testid="cfg-audio-device-hint"
        className="text-muted-foreground text-xs"
      >
        Device numbers are PortAudio indices and can change after replugging a
        microphone.
      </p>
      {!isOnline && (
        <p
          data-testid="cfg-audio-device-offline"
          className="text-muted-foreground text-xs"
        >
          Start the instance to list microphones
        </p>
      )}
    </ConfigSection>
  )
}

/**
 * Wake Word Detection runtime settings: the shared worker panel with a wake word multi-select (the
 * worker loads several ONNX models at once) and a microphone picker saved as `metadata.audioDevice`.
 */
export function WakeWordDetectionConfigurePanel({
  service,
}: {
  service: Service
}) {
  const presets = service.config?.availableModels ?? []
  const savedWords = parseModelNames(getEffectiveModel(service).name)
  // Saved wake words that are no preset (a .onnx uploaded through the worker's API): kept as extra
  // rows after the presets so this panel never drops them.
  const customModels = savedWords.filter(
    (name) => !presets.some((m) => m.value === name),
  )
  const metadata = getServiceMetadata(service)
  const savedDevice =
    typeof metadata.audioDevice === 'number' ? metadata.audioDevice : null
  const savedVadThreshold =
    typeof metadata.vadThreshold === 'number'
      ? metadata.vadThreshold
      : DEFAULT_VAD_THRESHOLD

  const [selected, setSelected] = useState<string[]>(savedWords)
  const [audioDevice, setAudioDevice] = useState(deviceValue(savedDevice))
  const [vadThreshold, setVadThreshold] = useState(savedVadThreshold)

  // Preset order, then custom models in saved order, so the saved name never depends on click order.
  const ordered = [
    ...presets.map((m) => m.value).filter((v) => selected.includes(v)),
    ...customModels.filter((name) => selected.includes(name)),
  ]
  const modelName = ordered.join(',')
  const wordsChanged = !sameModelSet(ordered, savedWords)
  const deviceChanged = audioDevice !== deviceValue(savedDevice)
  const vadChanged = vadThreshold !== savedVadThreshold

  // A name for the saved device, as far as the running instance has listed
  // its microphones (the section fetches them while the sheet is open).
  const { data: devices } = useWakeWordDevices(service.apiBase, {
    enabled: false,
  })
  const savedDeviceName =
    savedDevice != null
      ? (devices?.devices.find((d) => d.id === savedDevice)?.name ??
        `Device ${savedDevice}`)
      : 'System default'

  const toggle = (value: string) =>
    setSelected((prev) =>
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value],
    )

  // The New instance summary: the drafted words and microphone, and which
  // preset models are not on disk yet (uploaded ones already are).
  const drafting = useConfigureDraftHost() !== null
  const catalog = useWorkerModelCatalog(service, drafting)
  const catalogKnown = catalog.catalog?.kind === 'worker'
  const draftedDeviceName =
    audioDevice === SYSTEM_DEFAULT_DEVICE
      ? 'System default'
      : (devices?.devices.find((d) => String(d.id) === audioDevice)?.name ??
        `Device ${audioDevice}`)
  useDraftSummary({
    rows: [
      {
        label: 'Wake words',
        value:
          ordered.length > 0
            ? ordered.map(wakeWordLabel).join(', ')
            : 'None selected',
      },
      { label: 'Microphone', value: draftedDeviceName },
      { label: 'Device', value: 'CPU' },
    ],
    downloads: presets
      .filter((m) => ordered.includes(m.value))
      .map((m) => ({
        label: m.label,
        downloaded: catalogKnown ? catalog.isDownloaded(m.value) : undefined,
      })),
  })

  return (
    <WorkerConfigurePanel
      service={service}
      clearModelCache
      statusItems={[
        {
          label: 'Wake words',
          value:
            savedWords.length > 0
              ? savedWords.map(wakeWordLabel).join(', ')
              : '—',
        },
        { label: 'Microphone', value: savedDeviceName },
      ]}
      extension={{
        changed: wordsChanged || deviceChanged || vadChanged,
        valid: ordered.length > 0,
        reset: () => {
          setSelected(savedWords)
          setAudioDevice(deviceValue(savedDevice))
          setVadThreshold(savedVadThreshold)
        },
        // Always sent, so a New instance draft saves this selection rather than the inherited name,
        // and an otherwise unchanged Save never sends an empty `config: {}`.
        config: {
          name: modelName,
          device: 'CPU',
          ...((deviceChanged || vadChanged) && {
            metadata: {
              ...(deviceChanged && {
                audioDevice:
                  audioDevice === SYSTEM_DEFAULT_DEVICE
                    ? null
                    : Number(audioDevice),
              }),
              ...(vadChanged && { vadThreshold }),
            },
          }),
        },
        preview: { model: modelName || undefined, device: 'CPU' },
      }}
      advanced={
        <VadThresholdSection value={vadThreshold} onChange={setVadThreshold} />
      }
      modelSection={({ active, catalog }) => (
        <>
          <WakeWordsSection
            presets={presets}
            customModels={customModels}
            selected={ordered}
            onToggle={toggle}
            catalog={catalog}
          />
          <Separator />
          <MicrophoneSection
            service={service}
            active={active}
            value={audioDevice}
            onChange={setAudioDevice}
            savedDevice={savedDevice}
          />
        </>
      )}
    />
  )
}
