// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Cpu, Loader, RotateCcw, TriangleAlert } from 'lucide-react'
import { type ReactNode, useEffect, useId } from 'react'
import { useConfigureDraftHost } from '@/hooks/use-configure-draft'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { DeviceOption } from '@/services/types'
import { isDeviceMatch } from '@/services/model-config'

export interface DeviceSelectProps {
  value: string
  onValueChange: (value: string) => void
  options: DeviceOption[]
  isLoading?: boolean
  /** Detecting devices failed; `errorContent` (or a default notice) explains. */
  isError?: boolean
  errorContent?: ReactNode
  onRetry?: () => void
  testId?: string
  /** The select's id (also its draft-issue key); unique by default. */
  id?: string
  /** Overrides the default "Device" label (with its Cpu icon). */
  label?: ReactNode
}

type DeviceState = 'loading' | 'error' | 'empty' | 'unavailable' | 'ok'

/**
 * The device picker shared by every Configure panel. It never renders blank and never picks a
 * replacement for an unavailable saved device. An unresolved device blocks a new-instance draft; a
 * failed detection does not (the device is then used as configured, unverified).
 */
export function DeviceSelect({
  value,
  onValueChange,
  options,
  isLoading,
  isError,
  errorContent,
  onRetry,
  testId = 'cfg-device-select',
  id: idProp,
  label,
}: DeviceSelectProps) {
  // A fixed default id would collide with a second picker on the page.
  const generatedId = useId()
  const id = idProp ?? generatedId
  const selected =
    options.find((o) => o.value.toLowerCase() === value.toLowerCase()) ??
    options.find((o) => isDeviceMatch(o.value, value))
  const state: DeviceState = isLoading
    ? 'loading'
    : isError
      ? 'error'
      : options.length === 0
        ? 'empty'
        : selected
          ? 'ok'
          : 'unavailable'
  const issue =
    state === 'loading'
      ? 'Detecting devices…'
      : state === 'empty'
        ? 'No supported device was found on this system.'
        : state === 'unavailable'
          ? value
            ? `${value} is not available on this system. Choose a device.`
            : 'Choose a device.'
          : null

  const setIssue = useConfigureDraftHost()?.setIssue
  useEffect(() => {
    if (!setIssue) return
    setIssue(
      id,
      issue === null ? null : { message: issue, pending: state === 'loading' },
    )
    return () => setIssue(id, null)
  }, [setIssue, id, issue, state])

  const messageId = `${id}-message`
  // Only these states render the select the label names.
  const picking = state === 'ok' || state === 'unavailable'

  return (
    <div className="space-y-2" data-device-state={state}>
      <Label
        htmlFor={picking ? id : undefined}
        className="text-muted-foreground text-xs"
      >
        {label ?? (
          <>
            <Cpu className="mr-1 inline-block h-3 w-3" />
            Device
          </>
        )}
      </Label>
      {state === 'loading' ? (
        <div
          role="status"
          className="border-input text-muted-foreground flex h-9 items-center gap-2 rounded-md border px-3 text-xs"
          data-testid={`${testId}-loading`}
        >
          <Loader aria-hidden="true" className="h-3.5 w-3.5 animate-spin" />
          Detecting devices…
        </div>
      ) : state === 'error' ? (
        <div className="space-y-2" data-testid={`${testId}-error`}>
          {errorContent ?? (
            <p className="text-destructive flex items-start gap-1.5 text-xs">
              <TriangleAlert
                aria-hidden="true"
                className="mt-0.5 h-3.5 w-3.5 shrink-0"
              />
              <span>
                Devices could not be detected.
                {value && ` ${value} will be used as configured, unverified.`}
              </span>
            </p>
          )}
          {onRetry && (
            <Button type="button" variant="outline" size="xs" onClick={onRetry}>
              <RotateCcw />
              Detect again
            </Button>
          )}
        </div>
      ) : state === 'empty' ? (
        <p
          className="text-destructive flex items-start gap-1.5 text-xs"
          data-testid={`${testId}-empty`}
        >
          <TriangleAlert
            aria-hidden="true"
            className="mt-0.5 h-3.5 w-3.5 shrink-0"
          />
          No supported device was found on this system.
        </p>
      ) : (
        <>
          <Select value={selected?.value ?? ''} onValueChange={onValueChange}>
            <SelectTrigger
              data-testid={testId}
              id={id}
              className="w-full text-xs"
              aria-invalid={state === 'unavailable' || undefined}
              aria-describedby={state === 'unavailable' ? messageId : undefined}
            >
              <SelectValue placeholder="Choose a device" />
            </SelectTrigger>
            <SelectContent>
              {options.map((d) => (
                <SelectItem
                  key={d.value}
                  value={d.value}
                  textValue={d.value}
                  className="text-xs"
                >
                  <span>{d.value}</span>
                  {d.value !== d.label && (
                    <span className="text-muted-foreground font-normal">
                      {d.label}
                    </span>
                  )}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {state === 'unavailable' && (
            <p
              id={messageId}
              className="text-destructive text-xs"
              data-testid={`${testId}-unavailable`}
            >
              {issue}
            </p>
          )}
        </>
      )}
    </div>
  )
}
