// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import {
  ChevronDown,
  Download,
  Folder,
  Image as ImageIcon,
  Loader,
  Plus,
  Trash2,
} from 'lucide-react'
import { useState } from 'react'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { useDeleteProject, useExportProject } from '../hooks/use-projects'
import { GenerationType } from '../lib/api'

export type GalleryFilter = GenerationType | 'all'

const FILTERS: { value: GalleryFilter; label: string }[] = [
  { value: 'all', label: 'All assets' },
  { value: GenerationType.GOOD_DATASET, label: 'Good dataset' },
  { value: GenerationType.MISSING_COMPONENTS, label: 'Missing components' },
  { value: GenerationType.CUSTOM, label: 'Custom' },
]

interface ProjectHeaderProps {
  apiBase: string | undefined
  currentProject: string
  projects: string[]
  onProjectChange: (project: string) => void
  filter: GalleryFilter
  onFilterChange: (filter: GalleryFilter) => void
  onCreateProject: () => void
}

/** The gallery's heading: project switcher, project actions and type filter. */
export function ProjectHeader({
  apiBase,
  currentProject,
  projects,
  onProjectChange,
  filter,
  onFilterChange,
  onCreateProject,
}: ProjectHeaderProps) {
  const exportProject = useExportProject(apiBase)
  const { mutateAsync: deleteProject } = useDeleteProject(apiBase)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  return (
    <div className="mb-6 flex flex-col gap-4">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <ImageIcon className="text-primary h-5 w-5" aria-hidden />
            <h2 className="text-lg font-semibold">Generated Dataset Assets</h2>
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="sm"
                aria-label={`Project: ${currentProject}`}
                className="group h-auto gap-2 px-3 py-1.5 text-xs"
              >
                <Folder className="h-3 w-3" aria-hidden />
                {currentProject}
                <ChevronDown
                  className="h-3 w-3 transition-transform group-data-[state=open]:rotate-180"
                  aria-hidden
                />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-48">
              {projects.map((p) => (
                <DropdownMenuItem
                  key={p}
                  onSelect={() => onProjectChange(p)}
                  className="text-xs"
                >
                  {p}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={onCreateProject}
            className="h-auto gap-2 px-3 py-1.5 text-xs font-bold"
          >
            <Plus className="h-3 w-3" aria-hidden />
            New Project
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => exportProject.mutate(currentProject)}
            disabled={exportProject.isPending}
            aria-busy={exportProject.isPending || undefined}
            className="h-auto gap-2 px-3 py-1.5 text-xs font-bold"
          >
            {exportProject.isPending ? (
              <Loader className="h-3 w-3 animate-spin" aria-hidden />
            ) : (
              <Download className="h-3 w-3" aria-hidden />
            )}
            {exportProject.isPending ? 'Exporting...' : 'Download'}
          </Button>
          <Button
            size="sm"
            variant="destructive"
            onClick={() => setConfirmingDelete(true)}
            disabled={projects.length <= 1}
            title={
              projects.length <= 1
                ? 'The only project cannot be deleted'
                : undefined
            }
            className="h-auto gap-2 px-3 py-1.5 text-xs font-bold"
          >
            <Trash2 className="h-3 w-3" aria-hidden />
            Delete
          </Button>
        </div>
      </div>

      <div
        role="group"
        aria-label="Show assets of type"
        className="bg-muted border-border flex w-fit gap-1 overflow-x-auto rounded-lg border p-1 whitespace-nowrap"
      >
        {FILTERS.map(({ value, label }) => (
          <button
            key={value}
            type="button"
            aria-pressed={filter === value}
            onClick={() => onFilterChange(value)}
            className={cn(
              'rounded-md px-4 py-1.5 text-xs font-semibold transition-all',
              filter === value
                ? 'bg-background text-foreground border-border border shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <ConfirmDialog
        open={confirmingDelete}
        onOpenChange={setConfirmingDelete}
        variant="destructive"
        title={`Delete project “${currentProject}”?`}
        description="Its generated images are deleted with it. This cannot be undone."
        confirmLabel="Delete project"
        pendingLabel="Deleting…"
        onConfirm={() => deleteProject(currentProject)}
      />
    </div>
  )
}
