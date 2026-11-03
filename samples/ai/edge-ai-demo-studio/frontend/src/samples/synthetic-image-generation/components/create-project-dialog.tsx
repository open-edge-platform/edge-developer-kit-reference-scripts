// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Loader } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { InlineNotice } from '@/components/common/inline-notice'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useCreateProject } from '../hooks/use-projects'
import { isValidProjectName } from '../lib/api'

interface CreateProjectDialogProps {
  apiBase: string | undefined
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Called with the new project's name once the worker created it. */
  onCreated: (name: string) => void
}

/** Names and creates a project; a failure stays in the dialog to retry. */
export function CreateProjectDialog({
  apiBase,
  open,
  onOpenChange,
  onCreated,
}: CreateProjectDialogProps) {
  const [name, setName] = useState('')
  const create = useCreateProject(apiBase)
  const trimmed = name.trim()
  const invalid = trimmed !== '' && !isValidProjectName(trimmed)

  const clear = () => {
    setName('')
    create.reset()
  }
  const changeOpen = (next: boolean) => {
    if (create.isPending) return
    clear()
    onOpenChange(next)
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!trimmed || invalid) return
    create.mutate(trimmed, {
      onSuccess: (created) => {
        onCreated(created)
        clear()
        onOpenChange(false)
      },
    })
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>New project</DialogTitle>
            <DialogDescription>
              Generated images are saved into a project, and a project downloads
              as one zip.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="synthetic-project-name">Project name</Label>
            <Input
              id="synthetic-project-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. pcb-defects"
              aria-invalid={invalid || undefined}
              aria-describedby="synthetic-project-name-hint"
            />
            <p
              id="synthetic-project-name-hint"
              className={
                invalid
                  ? 'text-destructive text-xs'
                  : 'text-muted-foreground text-xs'
              }
            >
              Letters, numbers, spaces, hyphens and underscores.
            </p>
          </div>
          {create.isError && (
            <InlineNotice tone="destructive" size="sm">
              {create.error.message}
            </InlineNotice>
          )}
          <DialogFooter>
            <DialogClose asChild>
              <Button
                type="button"
                variant="outline"
                disabled={create.isPending}
              >
                Cancel
              </Button>
            </DialogClose>
            <Button
              type="submit"
              disabled={!trimmed || invalid || create.isPending}
              aria-busy={create.isPending || undefined}
            >
              {create.isPending && (
                <Loader className="animate-spin" aria-hidden />
              )}
              Create project
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
