// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { AlertTriangle, Network } from 'lucide-react'
import type { SettingDescriptions } from '@/components/configure/applied-settings'
import { ConfigSection } from '@/components/configure/config-section'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { useDraftState } from '@/hooks/use-draft-state'
import { getServiceMetadata } from '@/lib/instances/service-metadata'
import { WorkerConfigurePanel } from '@/services/common/configure/worker-configure-panel'
import { getWeightForModel } from '@/services/model-config'
import type { ModelWeight, Service } from '@/services/types'
import { frameGenerationAllowed } from '../hooks/use-frame-generation'
import { FrameGenerationLabel } from './frame-generation-switch'

const MODEL_WEIGHT_HINTS: Record<ModelWeight, string> = {
  lightweight: 'Lightweight — fast, runs in real time even on CPU',
  heavy: 'Heavy — clearer, more accurate lips; GPU recommended',
}

/** No fixed batch size: clears `metadata.batchSize` so the worker picks one for the device. */
const AUTO_BATCH_SIZE = 'auto'

const BATCH_SIZES = ['4', '8', '16', '32']

const SETTING_DESCRIPTIONS: SettingDescriptions = {
  'metadata.batchSize': {
    label: 'Batch size',
    format: (size) => `${size} frames`,
    unset: 'Auto',
  },
}

function BatchSizeSection({
  value,
  onChange,
}: {
  value: string
  onChange: (value: string) => void
}) {
  // A size saved elsewhere (deployment.json) is listed too, so the trigger
  // shows what is saved.
  const sizes =
    value === AUTO_BATCH_SIZE || BATCH_SIZES.includes(value)
      ? BATCH_SIZES
      : [...BATCH_SIZES, value]
  const options = [
    { value: AUTO_BATCH_SIZE, label: 'Auto (8 on NPU, 16 otherwise)' },
    ...sizes.map((size) => ({ value: size, label: `${size} frames` })),
  ]
  return (
    <ConfigSection title="Batch size" className="space-y-2">
      <Label
        htmlFor="ls-cfg-batch-size"
        className="text-muted-foreground text-xs"
      >
        Frames per inference
      </Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger
          data-testid="cfg-batch-size-select"
          id="ls-cfg-batch-size"
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
      <p className="text-muted-foreground text-xs">
        A smaller batch starts talking sooner after each request; a larger one
        can infer more frames per second on a fast accelerator.
      </p>
    </ConfigSection>
  )
}

/** The shared worker panel plus batch size, frame generation and ICE servers (instance metadata). */
export function LipsyncConfigurePanel({ service }: { service: Service }) {
  const metadata = getServiceMetadata(service)
  const current = {
    batchSize:
      metadata.batchSize != null ? String(metadata.batchSize) : AUTO_BATCH_SIZE,
    clientIceServerUrl: metadata.clientIceServerUrl ?? '',
    serverIceServerUrl: metadata.serverIceServerUrl ?? '',
    frameGeneration: frameGenerationAllowed(service),
  }
  const { draft, setDraft, reset } = useDraftState(current)
  const changed =
    draft.batchSize !== current.batchSize ||
    draft.clientIceServerUrl !== current.clientIceServerUrl ||
    draft.serverIceServerUrl !== current.serverIceServerUrl ||
    draft.frameGeneration !== current.frameGeneration

  // Heavy models (e.g. MuseTalk's single-step diffusion UNet + VAE) are
  // realtime on a GPU, but only ~1-2 FPS on CPU/NPU.
  const isHeavy = (model: string) =>
    getWeightForModel(service.config, model) === 'heavy'

  return (
    <WorkerConfigurePanel
      service={service}
      listPresetsBy="label"
      settingDescriptions={SETTING_DESCRIPTIONS}
      modelSelectId="ls-cfg-model-select"
      renderModelHint={(option) =>
        option.weight && MODEL_WEIGHT_HINTS[option.weight]
      }
      renderModelNote={({ model }) =>
        isHeavy(model) && (
          <p className="text-muted-foreground text-xs">
            {model} is a heavy model that produces higher-quality lipsync — a
            GPU is recommended for real-time playback.
          </p>
        )
      }
      renderDeviceNote={({ model, device }) =>
        isHeavy(model) &&
        /^(cpu|npu)/i.test(device) && (
          <p className="text-warning flex items-start gap-1 text-xs">
            <AlertTriangle
              aria-hidden="true"
              className="mt-0.5 h-3 w-3 shrink-0"
            />
            <span>
              {model} is a heavy model — it works on {device.toUpperCase()} but
              far below real time. Expect very low FPS and choppy playback.
              Select a GPU for smooth streaming.
            </span>
          </p>
        )
      }
      advanced={
        <>
          <BatchSizeSection
            value={draft.batchSize}
            onChange={(batchSize) => setDraft({ batchSize })}
          />

          <Separator />

          <ConfigSection title="Frame generation">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <FrameGenerationLabel
                  htmlFor="ls-cfg-frame-gen"
                  tooltip="Fills in-between frames with AI interpolation. It only activates when the selected accelerator cannot infer enough frames per second to match the avatar video on its own."
                />
                <Switch
                  id="ls-cfg-frame-gen"
                  checked={draft.frameGeneration}
                  onCheckedChange={(v) => setDraft({ frameGeneration: v })}
                />
              </div>
              <p className="text-muted-foreground text-xs">
                Starts the demo&apos;s frame generation switch on when the Frame
                Generation service is running. Only runs if the accelerator
                cannot process as many frames per second as the avatar video
                requires.
              </p>
            </div>
          </ConfigSection>

          <Separator />

          <ConfigSection title="WebRTC">
            <div className="space-y-2">
              <Label
                htmlFor="ls-cfg-client-ice-server"
                className="text-muted-foreground text-xs"
              >
                <Network aria-hidden="true" className="mr-1 h-3 w-3" />
                Client ICE Server URL
              </Label>
              <Input
                id="ls-cfg-client-ice-server"
                value={draft.clientIceServerUrl}
                onChange={(e) =>
                  setDraft({ clientIceServerUrl: e.target.value })
                }
                placeholder="e.g. 192.168.1.100:19302"
                className="text-xs"
              />
              <p className="text-muted-foreground text-xs">
                ICE server for the browser client. Auto-prefixed with stun: if
                no scheme is provided. Leave empty to use no ICE server.
              </p>
            </div>
            <div className="space-y-2">
              <Label
                htmlFor="ls-cfg-server-ice-server"
                className="text-muted-foreground text-xs"
              >
                <Network aria-hidden="true" className="mr-1 h-3 w-3" />
                Server ICE Server URL
              </Label>
              <Input
                id="ls-cfg-server-ice-server"
                value={draft.serverIceServerUrl}
                onChange={(e) =>
                  setDraft({ serverIceServerUrl: e.target.value })
                }
                placeholder="e.g. 127.0.0.1:5901"
                className="text-xs"
              />
              <p className="text-muted-foreground text-xs">
                ICE server for the lipsync worker. Auto-prefixed with turn: if
                no scheme is provided. Leave empty to use no ICE server.
              </p>
            </div>
          </ConfigSection>
        </>
      }
      statusItems={[
        {
          label: 'Batch size',
          value:
            current.batchSize === AUTO_BATCH_SIZE
              ? 'Auto'
              : `${current.batchSize} frames`,
        },
        {
          label: 'Frame generation',
          value: current.frameGeneration ? 'Auto' : 'Off',
        },
        {
          label: 'Client ICE server',
          value: current.clientIceServerUrl || 'None',
        },
        {
          label: 'Server ICE server',
          value: current.serverIceServerUrl || 'None',
        },
      ]}
      extension={{
        changed,
        reset,
        config: {
          metadata: {
            batchSize:
              draft.batchSize === AUTO_BATCH_SIZE
                ? null
                : Number(draft.batchSize),
            clientIceServerUrl: draft.clientIceServerUrl || null,
            serverIceServerUrl: draft.serverIceServerUrl || null,
            frameGeneration: draft.frameGeneration,
          },
        },
      }}
    />
  )
}
