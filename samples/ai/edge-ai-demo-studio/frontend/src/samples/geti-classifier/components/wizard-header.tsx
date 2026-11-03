// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Activity, ArrowLeft } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { CardDescription, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { useServiceApiBase } from '@/context/service-status-context'
import { cn } from '@/lib/utils'
import { useAutoSync } from '../hooks/use-geti-api'
import { PHASES, type WizardStep } from '../lib/wizard'

/** Settings card header: step title in its phase's colours, connection state, auto-sync, way back. */
export function WizardHeader({
  step,
  connected,
  onBack,
}: {
  step: WizardStep
  connected: boolean
  onBack: () => void
}) {
  const apiBase = useServiceApiBase('geti-classifier')
  const autoSync = useAutoSync(apiBase)
  const phase = PHASES[step.phase]
  const PhaseIcon = phase.icon

  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex items-center gap-3">
        <div
          className={cn(
            'flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl shadow-md transition-all duration-500',
            phase.solid,
          )}
        >
          <PhaseIcon className="h-5 w-5" aria-hidden />
        </div>
        <div>
          <CardTitle className="text-base">{step.title}</CardTitle>
          <CardDescription className="mt-0.5 text-xs">
            {step.subtitle}
          </CardDescription>
        </div>
      </div>

      <div className="flex flex-shrink-0 items-center gap-2">
        <Badge tone={connected ? 'success' : 'muted'} className="py-1">
          <span
            aria-hidden
            className={cn(
              'h-1.5 w-1.5 rounded-full',
              connected ? 'bg-success animate-pulse' : 'bg-muted-foreground/50',
            )}
          />
          {connected ? 'Connected' : 'Not Connected'}
        </Badge>

        <div
          className={cn(
            'flex items-center gap-2 rounded-full border px-2.5 py-1 transition-all',
            autoSync.enabled ? 'border-info/30 bg-info/10' : 'bg-muted/30',
          )}
        >
          <Activity
            className={cn(
              'h-3 w-3',
              autoSync.enabled ? 'text-info' : 'text-muted-foreground',
            )}
            aria-hidden
          />
          <Label htmlFor="geti-auto-sync" className="text-xs font-medium">
            Auto-sync
          </Label>
          <Switch
            id="geti-auto-sync"
            checked={autoSync.enabled}
            onCheckedChange={autoSync.setEnabled}
            disabled={autoSync.isPending || !autoSync.known}
            className="scale-75"
          />
        </div>

        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 rounded-full"
          onClick={onBack}
          aria-label="Back to main"
          title="Back to main"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
        </Button>
      </div>
    </div>
  )
}
