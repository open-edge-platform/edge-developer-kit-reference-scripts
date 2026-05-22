// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  FolderOpen,
  LayoutGrid,
  RefreshCw,
  Scissors,
  Tag,
} from 'lucide-react'
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
import { PhaseBanner } from '../phase-banner'
import type { GetiProject } from '../../hooks'

interface StepSegProjectProps {
  projects: GetiProject[]
  selectedProjectId: string
  isLoadingModels: boolean
  isModelsError: boolean
  modelsErrorMessage: string | undefined
  onProjectChange: (id: string) => void
  onBack: () => void
  onContinue: () => void
}

export function StepSegProject({
  projects,
  selectedProjectId,
  isLoadingModels,
  isModelsError,
  modelsErrorMessage,
  onProjectChange,
  onBack,
  onContinue,
}: StepSegProjectProps) {
  const selectedProject = projects.find((p) => p.id === selectedProjectId)

  return (
    <div className="mx-auto max-w-lg space-y-5">
      <PhaseBanner
        phase="seg"
        title="Segmentation Phase — Step 1 of 3"
        subtitle="Select the project containing your segmentation model"
        icon={Scissors}
      />

      {projects.length === 0 ? (
        <EmptyProjects onBack={onBack} />
      ) : (
        <>
          {/* Project selector */}
          <div className="space-y-2">
            <Label className="text-muted-foreground flex items-center gap-1.5 text-xs font-semibold tracking-wider uppercase">
              <LayoutGrid className="h-3 w-3" />
              Segmentation Project
              <Badge variant="secondary" className="ml-1 text-[10px]">
                {projects.length} available
              </Badge>
            </Label>
            <Select value={selectedProjectId} onValueChange={onProjectChange}>
              <SelectTrigger className="bg-background h-11 border-2">
                <SelectValue placeholder="Select a project..." />
              </SelectTrigger>
              <SelectContent>
                {projects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    <div className="flex items-center gap-2.5">
                      <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-100 dark:bg-blue-900/50">
                        <Scissors className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
                      </div>
                      <div className="flex flex-col items-start">
                        <span className="font-medium">{p.name}</span>
                        <span className="text-muted-foreground text-xs">
                          {p.labels.length} label
                          {p.labels.length !== 1 ? 's' : ''}
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

          {/* Labels preview */}
          {selectedProject && selectedProject.labels.length > 0 && (
            <div className="space-y-2 rounded-xl border border-blue-200 bg-blue-50/50 p-4 dark:border-blue-800 dark:bg-blue-950/20">
              <div className="flex items-center justify-between">
                <Label className="flex items-center gap-1.5 text-xs font-semibold tracking-wider text-blue-600 uppercase dark:text-blue-400">
                  <Tag className="h-3 w-3" />
                  Segmentation Labels
                </Label>
                <Badge className="border-0 bg-blue-100 text-[10px] text-blue-700 dark:bg-blue-900 dark:text-blue-300">
                  {selectedProject.labels.length} labels
                </Badge>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {selectedProject.labels.map((label) => (
                  <Badge
                    key={label}
                    className="border border-blue-200 bg-white text-blue-700 dark:border-blue-700 dark:bg-blue-950 dark:text-blue-300"
                  >
                    {label}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {/* Models loading / error */}
          {isLoadingModels && <ModelsLoadingIndicator />}
          {isModelsError && <ModelsErrorAlert message={modelsErrorMessage} />}
        </>
      )}

      <div className="flex gap-2 pt-1">
        <Button variant="outline" className="gap-2" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>
        <Button
          className="flex-1 gap-2 bg-gradient-to-r from-blue-600 to-indigo-600 text-white hover:from-blue-700 hover:to-indigo-700"
          disabled={!selectedProjectId || isLoadingModels || isModelsError}
          onClick={onContinue}
        >
          {isLoadingModels ? (
            <>
              <RefreshCw className="h-4 w-4 animate-spin" />
              Loading models...
            </>
          ) : (
            <>
              Continue to Model Config
              <ArrowRight className="h-4 w-4" />
            </>
          )}
        </Button>
      </div>
    </div>
  )
}

// ── Private sub-components ────────────────────────────────────────────────────

function EmptyProjects({ onBack }: { onBack: () => void }) {
  return (
    <div className="border-muted flex h-48 flex-col items-center justify-center rounded-xl border-2 border-dashed text-center">
      <FolderOpen className="text-muted-foreground/40 mb-2 h-8 w-8" />
      <p className="text-muted-foreground text-sm">No projects loaded</p>
      <Button variant="ghost" size="sm" className="mt-2" onClick={onBack}>
        Go back to connect
      </Button>
    </div>
  )
}

function ModelsLoadingIndicator() {
  return (
    <div className="bg-muted/50 text-muted-foreground flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm">
      <RefreshCw className="h-3.5 w-3.5 animate-spin" />
      Loading available models...
    </div>
  )
}

function ModelsErrorAlert({ message }: { message: string | undefined }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-3 dark:border-red-800 dark:bg-red-950/20">
      <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-500" />
      <p className="text-sm text-red-700 dark:text-red-400">{message}</p>
    </div>
  )
}
