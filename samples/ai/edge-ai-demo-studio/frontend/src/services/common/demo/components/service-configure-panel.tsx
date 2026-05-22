// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { CheckCircle2, Loader2, Settings2 } from 'lucide-react'
import type { ReactNode } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'

export interface ConfigurePanelStatus {
  label: string
  value: string
}

export interface ServiceConfigurePanelProps {
  serviceName: string
  statusItems: ConfigurePanelStatus[]
  isDirty: boolean
  isValid: boolean
  onSave: () => void
  isSaving?: boolean
  onCancel?: () => void
  open: boolean
  onOpenChange: (open: boolean) => void
  children: ReactNode
}

export function ServiceConfigurePanel({
  serviceName,
  statusItems,
  isDirty,
  isValid,
  onSave,
  isSaving = false,
  onCancel,
  open,
  onOpenChange,
  children,
}: ServiceConfigurePanelProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetTrigger asChild>
        <Button
          data-testid="workload-settings-button"
          type="button"
          variant="outline"
          size="sm"
          className="gap-2"
        >
          <Settings2 className="h-3.5 w-3.5" />
          Configure
          {isDirty && <span className="bg-warning ml-1 h-2 w-2 rounded-full" />}
        </Button>
      </SheetTrigger>

      <SheetContent
        side="right"
        showCloseButton
        className="flex h-full min-h-0 w-full flex-col p-0 sm:max-w-[460px]"
      >
        <SheetHeader className="px-5 pt-5 pb-0">
          <SheetTitle className="text-base">Runtime Settings</SheetTitle>
          <SheetDescription className="text-xs">
            Configure model, device, and startup parameters for {serviceName}.
          </SheetDescription>
        </SheetHeader>

        <ScrollArea className="min-h-0 flex-1 px-5">
          <div className="space-y-5 pb-5">
            <Separator />

            <div className="border-border/70 bg-muted/20 space-y-2 rounded-lg border p-3">
              {statusItems.map((item) => (
                <div
                  key={item.label}
                  className="flex items-center justify-between gap-3 text-xs"
                >
                  <span className="text-muted-foreground">{item.label}</span>
                  <span className="text-foreground max-w-[200px] truncate font-medium">
                    {item.value}
                  </span>
                </div>
              ))}
              {isDirty && (
                <Badge className="border-warning/20 bg-warning/10 text-warning mt-1">
                  Unsaved changes
                </Badge>
              )}
            </div>

            <Separator />

            {children}
          </div>
        </ScrollArea>

        <SheetFooter className="border-border flex-row items-center justify-between gap-2 border-t px-5 py-3">
          <div className="text-muted-foreground flex items-center gap-1.5 text-xs">
            {isDirty ? (
              'Settings changed. Service restart required.'
            ) : (
              <>
                <CheckCircle2 className="text-success h-3.5 w-3.5" />
                Configuration is in sync.
              </>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                onCancel?.()
                onOpenChange(false)
              }}
            >
              Cancel
            </Button>
            <Button
              data-testid="settings-save-button"
              type="button"
              variant="default"
              size="sm"
              disabled={!isValid || isSaving}
              onClick={onSave}
            >
              {isSaving ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Saving…
                </>
              ) : (
                'Save'
              )}
            </Button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
