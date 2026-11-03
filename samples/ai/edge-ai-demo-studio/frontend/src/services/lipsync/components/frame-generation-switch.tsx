// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Film, Loader } from 'lucide-react'
import { ServiceLink } from '@/components/common/service-link'
import { InfoTip } from '@/components/common/info-tip'
import { TruncatedText } from '@/components/common/truncated-text'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  useGetService,
  useServiceActivity,
  useServiceStatus,
} from '@/context/service-status-context'
import { STATE_LABEL } from '@/lib/instances/service-presentation'

export interface FrameGenerationLabelProps {
  htmlFor: string
  tooltip: string
}

/** The info tip sits beside the label, not in it, so clicking it does not flip the switch. */
export function FrameGenerationLabel({
  htmlFor,
  tooltip,
}: FrameGenerationLabelProps) {
  return (
    <div className="flex items-center gap-1">
      <Label htmlFor={htmlFor} className="text-muted-foreground text-xs">
        <Film aria-hidden="true" className="mr-1 h-3 w-3" />
        Frame generation
      </Label>
      <InfoTip
        tooltip={tooltip}
        ariaLabel="About frame generation"
        size="sm"
        side="top"
        contentClassName="max-w-60 text-xs"
      />
    </div>
  )
}

export interface FrameGenerationSwitchProps {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  disabled?: boolean
}

/**
 * Sent with each request as `frame_generation` (no restart). The worker only interpolates when its
 * inference FPS can't reach the avatar frame rate, via the Frame Generation service, which must run.
 */
export function FrameGenerationSwitch({
  checked,
  onCheckedChange,
  disabled,
}: FrameGenerationSwitchProps) {
  const { startService } = useServiceStatus()
  const { isActionPending } = useServiceActivity()
  const frameGenService = useGetService('frame-generation')
  const added = Boolean(frameGenService?.added)
  const frameGenStatus = frameGenService?.status ?? 'offline'
  const isOnline = frameGenStatus === 'online'
  const isStarting =
    frameGenStatus === 'starting' || isActionPending('frame-generation')

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <FrameGenerationLabel
          htmlFor="lipsync-frame-gen"
          tooltip="Fills in-between frames with AI interpolation, served by the Frame Generation service (which is also where its device is configured). It only activates when the lipsync accelerator cannot infer enough frames per second to match the avatar video on its own."
        />
        <Tooltip>
          <TooltipTrigger asChild>
            {/* span wrapper: disabled elements swallow hover events */}
            <span>
              <Switch
                id="lipsync-frame-gen"
                checked={checked}
                onCheckedChange={onCheckedChange}
                // Turning ON needs the service; turning OFF is always allowed.
                disabled={disabled || (!isOnline && !checked)}
              />
            </span>
          </TooltipTrigger>
          {!isOnline && !checked && (
            <TooltipContent side="top" className="max-w-60 text-xs">
              Requires the Frame Generation service. Start it to enable this
              option.
            </TooltipContent>
          )}
        </Tooltip>
      </div>
      <p
        className="text-muted-foreground flex min-w-0 items-baseline gap-1 text-xs"
        data-testid="lipsync-frame-generation-instance"
      >
        {added && frameGenService ? (
          <>
            <span className="shrink-0">Uses</span>
            <TruncatedText
              text={frameGenService.label ?? 'Frame Generation'}
              className="text-foreground max-w-40"
            />
            <span className="shrink-0">· {STATE_LABEL[frameGenStatus]}</span>
          </>
        ) : (
          <span>
            No Frame Generation instance.{' '}
            <ServiceLink
              serviceType="frame-generation"
              className="text-primary underline-offset-2 hover:underline"
            >
              Add one
            </ServiceLink>{' '}
            to turn this on.
          </span>
        )}
      </p>
      {added && !isOnline && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="w-full text-xs"
          disabled={isStarting}
          onClick={() => startService('frame-generation')}
        >
          {isStarting ? (
            <Loader aria-hidden="true" className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Film aria-hidden="true" className="h-3.5 w-3.5" />
          )}
          {isStarting
            ? 'Starting Frame Generation…'
            : `Start ${frameGenService?.label ?? 'Frame Generation'}`}
        </Button>
      )}
    </div>
  )
}
