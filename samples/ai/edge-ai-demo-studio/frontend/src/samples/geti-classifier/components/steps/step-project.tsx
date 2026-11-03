// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import {
  ArrowLeft,
  ArrowRight,
  FolderOpen,
  LayoutGrid,
  RefreshCw,
  Tag,
} from 'lucide-react'
import { EmptyState } from '@/components/common/empty-state'
import { InlineNotice } from '@/components/common/inline-notice'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { plural } from '@/lib/browser/format'
import { cn } from '@/lib/utils'
import type { PhaseSetup } from '../../hooks/use-phase-setup'
import type { DeployPhase, GetiProject } from '../../lib/api'
import { PHASES, phaseStepTitle } from '../../lib/wizard'
import { PhaseBanner } from '../phase-banner'

interface StepProjectProps {
  phase: DeployPhase
  projects: GetiProject[]
  setup: PhaseSetup
  onBack: () => void
  onContinue: () => void
}

/** Choosing the Geti project that holds the phase's model. */
export function StepProject({
  phase,
  projects,
  setup,
  onBack,
  onContinue,
}: StepProjectProps) {
  const style = PHASES[phase]
  const Icon = style.icon
  const selectId = `geti-${phase}-project`
  const project = setup.project

  return (
    <div className="mx-auto max-w-lg space-y-5">
      <PhaseBanner
        phase={phase}
        title={phaseStepTitle(`${phase}-project`)}
        subtitle={`Select the project containing your ${style.name.toLowerCase()} model`}
      />

      {projects.length === 0 ? (
        <EmptyState
          icon={FolderOpen}
          size="sm"
          description="No projects loaded"
          className="py-12"
        >
          <Button variant="ghost" size="sm" className="mt-2" onClick={onBack}>
            Go back to connect
          </Button>
        </EmptyState>
      ) : (
        <>
          <div className="space-y-2">
            <Label
              htmlFor={selectId}
              className="text-muted-foreground flex items-center gap-1.5 text-xs font-semibold tracking-wider uppercase"
            >
              <LayoutGrid className="h-3 w-3" aria-hidden />
              {style.name} Project
              <Badge variant="secondary" className="ml-1 text-[10px]">
                {projects.length} available
              </Badge>
            </Label>
            <Select
              value={setup.selectedProjectId}
              onValueChange={setup.setProject}
            >
              <SelectTrigger
                id={selectId}
                className="bg-background h-11 w-full border-2"
              >
                <SelectValue placeholder="Select a project..." />
              </SelectTrigger>
              <SelectContent>
                {projects.map((p) => (
                  <SelectItem key={p.id} value={p.id} textValue={p.name}>
                    <div className="flex items-center gap-2.5">
                      <div
                        className={cn(
                          'flex h-7 w-7 items-center justify-center rounded-lg border',
                          style.surface,
                        )}
                      >
                        <Icon
                          className={cn('h-3.5 w-3.5', style.text)}
                          aria-hidden
                        />
                      </div>
                      <div className="flex flex-col items-start">
                        <span className="font-medium">{p.name}</span>
                        <span className="text-muted-foreground text-xs">
                          {plural(p.labels.length, 'label')}
                          {p.score != null
                            ? ` · score ${(p.score * 100).toFixed(1)}%`
                            : ''}
                        </span>
                      </div>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {project && project.labels.length > 0 && (
            <div
              className={cn('space-y-2 rounded-xl border p-4', style.surface)}
            >
              <div className="flex items-center justify-between">
                <p
                  className={cn(
                    'flex items-center gap-1.5 text-xs font-semibold tracking-wider uppercase',
                    style.text,
                  )}
                >
                  <Tag className="h-3 w-3" aria-hidden />
                  {style.name} Labels
                </p>
                <Badge
                  variant="outline"
                  className={cn('text-[10px]', style.chip)}
                >
                  {project.labels.length} labels
                </Badge>
              </div>
              <ul className="flex flex-wrap gap-1.5" aria-label="Labels">
                {project.labels.map((label) => (
                  <li key={label}>
                    <Badge variant="outline" className={style.chip}>
                      {label}
                    </Badge>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {setup.isLoadingModels && (
            <p
              role="status"
              className="bg-muted/50 text-muted-foreground flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm"
            >
              <RefreshCw className="h-3.5 w-3.5 animate-spin" aria-hidden />
              Loading available models...
            </p>
          )}
          {setup.modelsError && (
            <InlineNotice tone="destructive" size="sm">
              {setup.modelsError}
            </InlineNotice>
          )}
        </>
      )}

      <div className="flex gap-2 pt-1">
        <Button variant="outline" className="gap-2" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Back
        </Button>
        <Button
          className="flex-1 gap-2"
          disabled={
            !setup.selectedProjectId ||
            setup.isLoadingModels ||
            setup.modelsError !== null
          }
          onClick={onContinue}
        >
          {setup.isLoadingModels ? (
            <>
              <RefreshCw className="h-4 w-4 animate-spin" aria-hidden />
              Loading models...
            </>
          ) : (
            <>
              Continue to Model Config
              <ArrowRight className="h-4 w-4" aria-hidden />
            </>
          )}
        </Button>
      </div>
    </div>
  )
}
