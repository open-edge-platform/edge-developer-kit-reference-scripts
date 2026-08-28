// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Film, Info, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  useGetService,
  useServiceStatus,
} from '@/context/service-status-context'

export interface FrameGenerationSwitchProps {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  disabled?: boolean
}

/**
 * Per-request frame generation toggle: its value is sent with each chat /
 * audio lipsync request as `frame_generation` (no service restart). The
 * lipsync worker measures its inference FPS at startup, so it knows how many
 * frames to fill and only interpolates when inference alone cannot reach the
 * avatar frame rate. Interpolation runs in the Frame Generation service, so
 * turning the switch on requires that service to be running.
 */
export function FrameGenerationSwitch({
  checked,
  onCheckedChange,
  disabled,
}: FrameGenerationSwitchProps) {
  const { startService, isActionPending } = useServiceStatus()
  const frameGenService = useGetService('frame-generation')
  const frameGenStatus = frameGenService?.status ?? 'offline'
  const isOnline = frameGenStatus === 'online'
  const isStarting =
    frameGenStatus === 'starting' || isActionPending('frame-generation')

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label
          htmlFor="lipsync-frame-gen"
          className="text-muted-foreground text-xs"
        >
          <Film className="mr-1 inline-block h-3 w-3" />
          Frame generation
          <TooltipProvider delayDuration={250}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className="text-muted-foreground ml-1 inline-block h-3 w-3" />
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-60 text-[11px]">
                Fills in-between frames with AI interpolation, served by the
                Frame Generation service (which is also where its device is
                configured). It only activates when the lipsync accelerator
                cannot infer enough frames per second to match the avatar video
                on its own.
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </Label>
        <TooltipProvider delayDuration={250}>
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
              <TooltipContent side="top" className="max-w-60 text-[11px]">
                Requires the Frame Generation service. Start it to enable this
                option.
              </TooltipContent>
            )}
          </Tooltip>
        </TooltipProvider>
      </div>
      {!isOnline && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="w-full text-xs"
          disabled={isStarting}
          onClick={() => startService('frame-generation')}
        >
          {isStarting ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Film className="mr-1.5 h-3.5 w-3.5" />
          )}
          {isStarting
            ? 'Starting Frame Generation...'
            : 'Start Frame Generation service'}
        </Button>
      )}
    </div>
  )
}
