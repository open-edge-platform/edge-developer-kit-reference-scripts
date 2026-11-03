// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Plus, Upload } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'

/** A small icon button with a name and a tooltip saying the same. */
function ToolButton({
  label,
  testId,
  onClick,
  children,
}: {
  label: string
  testId: string
  onClick: () => void
  children: ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          data-testid={testId}
          type="button"
          variant="ghost"
          size="icon"
          aria-label={label}
          className="text-muted-foreground hover:text-foreground h-8 w-8"
          onClick={onClick}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        <p className="text-xs">{label}</p>
      </TooltipContent>
    </Tooltip>
  )
}

/** The Model section's heading actions: Add model and Upload local model. */
export function ModelManagerToolbar({
  onAdd,
  onUpload,
}: {
  onAdd: () => void
  onUpload: () => void
}) {
  return (
    <div className="flex items-center gap-0.5">
      <ToolButton label="Add model" testId="add-model-button" onClick={onAdd}>
        <Plus aria-hidden="true" className="h-3.5 w-3.5" />
      </ToolButton>
      <ToolButton
        label="Upload local model"
        testId="upload-model-button"
        onClick={onUpload}
      >
        <Upload aria-hidden="true" className="h-3.5 w-3.5" />
      </ToolButton>
    </div>
  )
}
