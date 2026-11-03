// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Copy, Plus, Sparkles } from 'lucide-react'
import { type ReactNode, useId, useLayoutEffect, useRef, useState } from 'react'
import { useDiscardGuard } from '@/components/common/discard-changes-guard'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import {
  useGetService,
  useServiceInstances,
} from '@/context/service-status-context'
import { ConfigureDraftProvider } from '@/hooks/use-configure-draft'
import type { Service as PayloadService } from '@/payload-types'
import { ConfigurePanelFor } from '@/services/common/configure/service-configure-dispatch'
import type { Service } from '@/services/types'
import { describeDiscard, describeNewInstance } from './new-instance-copy'
import {
  hasSetupRequirements,
  SetupRequirementItems,
} from './new-instance-requirements'
import {
  CopySettingsSection,
  CreationSummary,
  NewInstanceFooter,
} from './new-instance-sections'
import { DraftSummaryProvider } from './new-instance-summary'
import { useNewInstanceForm } from './use-new-instance-form'

interface NewInstanceSheetProps {
  serviceType: string
  /** Custom trigger element; defaults to an "Add instance" button. */
  trigger?: ReactNode
  hideTrigger?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
  /** Duplicate this instance: its settings are the starting point. */
  copyFromInstanceId?: string
  /** Called with the new row once it is created, before the sheet closes. */
  onCreated?: (instance: PayloadService) => void
}

/**
 * Adds a service (its first instance) or another instance of it, every field prefilled so the
 * recommended setup is one click. Closing with edits asks first, except once Create is sent.
 */
export function NewInstanceSheet({
  serviceType,
  trigger,
  hideTrigger = false,
  open: controlledOpen,
  onOpenChange,
  copyFromInstanceId,
  onCreated,
}: NewInstanceSheetProps) {
  const service = useGetService(serviceType)
  const isFirstInstance = useServiceInstances(serviceType).length === 0
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false)
  const open = controlledOpen ?? uncontrolledOpen
  const setOpen = (v: boolean) => {
    setUncontrolledOpen(v)
    onOpenChange?.(v)
  }
  // Reported by the open form; while Create is in flight closing drops nothing.
  const [edited, setEdited] = useState(false)
  const [creating, setCreating] = useState(false)
  const close = () => {
    setEdited(false)
    setCreating(false)
    setOpen(false)
  }
  const { guard, dialog } = useDiscardGuard({
    dirty: edited && !creating,
    description: describeDiscard({
      serviceName: service?.name ?? serviceType,
      isFirstInstance,
    }),
  })
  const changeOpen = (next: boolean) => {
    if (next) setOpen(true)
    else guard(close)
  }

  if (!service) return null

  return (
    <>
      <Sheet open={open} onOpenChange={changeOpen}>
        {!hideTrigger && (
          <SheetTrigger asChild>
            {trigger ?? (
              <Button
                type="button"
                size="sm"
                className="shadow-primary/20 gap-2 shadow-sm"
                data-testid="add-instance-button"
              >
                <Plus aria-hidden="true" className="h-3.5 w-3.5" />
                Add instance
              </Button>
            )}
          </SheetTrigger>
        )}

        <SheetContent
          side="right"
          showCloseButton
          className="flex h-full min-h-0 w-full flex-col gap-0 p-0 sm:max-w-[520px]"
        >
          {/* The content unmounts when the sheet closes, so the form starts
            fresh on every open. */}
          <NewInstanceForm
            key={service.id}
            service={service}
            copyFromInstanceId={copyFromInstanceId}
            onCreated={onCreated}
            onClose={close}
            onDismiss={() => changeOpen(false)}
            onStateChange={(nextEdited, nextCreating) => {
              setEdited(nextEdited)
              setCreating(nextCreating)
            }}
          />
        </SheetContent>
      </Sheet>
      {dialog}
    </>
  )
}

function SectionLabel({
  children,
  htmlFor,
}: {
  children: ReactNode
  htmlFor?: string
}) {
  return (
    <Label htmlFor={htmlFor} className="text-foreground text-sm font-semibold">
      {children}
    </Label>
  )
}

function NewInstanceForm({
  service,
  copyFromInstanceId,
  onCreated,
  onClose,
  onDismiss,
  onStateChange,
}: {
  service: Service
  copyFromInstanceId?: string
  onCreated?: (instance: PayloadService) => void
  /** Closes the sheet at once: the instance was created. */
  onClose: () => void
  /** Cancel: closes the sheet, asking first if anything was entered. */
  onDismiss: () => void
  onStateChange: (edited: boolean, creating: boolean) => void
}) {
  const form = useNewInstanceForm({
    service,
    copyFromInstanceId,
    onCreated,
    onClose,
  })
  const { edited, creating } = form
  // A layout effect, so the sheet knows of an edit before the next key is
  // handled: an Escape pressed right after typing must still ask.
  useLayoutEffect(() => {
    onStateChange(edited, creating)
  }, [onStateChange, edited, creating])
  const formRef = useRef<HTMLDivElement>(null)
  const problemId = useId()
  const words = describeNewInstance({
    serviceName: service.name,
    isFirstInstance: form.isFirstInstance,
    duplicating: form.duplicating,
    sourceLabel: form.copySource?.label,
    autostart: form.autostart,
    hasModel: Boolean(service.defaultModel),
  })

  const reviewSettings = () => {
    form.draft.revealAdvanced()
    requestAnimationFrame(() => {
      const invalid = formRef.current?.querySelector<HTMLElement>(
        '[aria-invalid="true"]',
      )
      invalid?.scrollIntoView({ block: 'center' })
      invalid?.focus()
    })
  }

  return (
    <>
      <SheetHeader className="px-5 pt-5 pb-4">
        <SheetTitle className="text-base">{words.title}</SheetTitle>
        <SheetDescription className="text-xs leading-relaxed">
          {words.description}
        </SheetDescription>
      </SheetHeader>

      <div
        ref={formRef}
        className="min-h-0 flex-1 space-y-6 overflow-y-auto border-t px-5 py-5"
      >
        {hasSetupRequirements(service, form.model) && (
          <section
            aria-labelledby="new-instance-requirements-title"
            className="bg-muted/30 space-y-2 rounded-lg border px-3.5 py-3"
            data-testid="new-instance-requirements"
          >
            <h3
              id="new-instance-requirements-title"
              className="text-foreground text-sm font-semibold"
            >
              Before you start
            </h3>
            <ul className="space-y-2.5">
              <SetupRequirementItems
                service={service}
                model={form.model}
                inSheet
              />
            </ul>
          </section>
        )}

        <div className="space-y-2">
          <SectionLabel htmlFor="new-instance-name">Name</SectionLabel>
          <Input
            id="new-instance-name"
            data-testid="new-instance-name"
            value={form.label}
            onChange={(e) => form.setLabel(e.target.value)}
            onFocus={(e) => e.currentTarget.select()}
            placeholder="e.g. CPU fallback"
            autoFocus
            aria-invalid={Boolean(form.nameError)}
            aria-describedby={
              form.nameError ? 'new-instance-name-error' : undefined
            }
          />
          {form.nameError && (
            <p
              id="new-instance-name-error"
              data-testid="new-instance-name-error"
              className="text-destructive text-xs font-medium"
            >
              {form.nameError}
            </p>
          )}
        </div>

        {/* The first instance's form brings its own headings. */}
        <div className="space-y-3">
          {!form.isFirstInstance && <SectionLabel>Settings</SectionLabel>}

          {!form.isFirstInstance && form.canConfigure && (
            <div
              role="group"
              aria-label="Start from"
              className="grid grid-cols-2 gap-2"
            >
              <Button
                type="button"
                size="sm"
                variant={form.mode === 'copy' ? 'default' : 'outline'}
                aria-pressed={form.mode === 'copy'}
                data-testid="new-instance-settings-copy"
                onClick={() => form.chooseMode('copy')}
              >
                <Copy aria-hidden="true" className="h-3.5 w-3.5" />
                Copy an instance
              </Button>
              <Button
                type="button"
                size="sm"
                variant={form.mode === 'new' ? 'default' : 'outline'}
                aria-pressed={form.mode === 'new'}
                data-testid="new-instance-settings-new"
                onClick={() => form.chooseMode('new')}
              >
                <Sparkles aria-hidden="true" className="h-3.5 w-3.5" />
                Recommended settings
              </Button>
            </div>
          )}

          {!form.drafting && form.copySource && (
            <CopySettingsSection
              instances={form.instances}
              copyFrom={form.copyFrom}
              onCopyFromChange={form.setCopyFrom}
              source={form.copySource}
              deviceInUse={form.deviceInUse}
              device={form.copyDevice}
              canConfigure={form.canConfigure}
            />
          )}

          {!form.canConfigure && form.isFirstInstance && (
            <p className="text-muted-foreground text-xs">
              This service has no settings to choose: it is added with its
              defaults.
            </p>
          )}

          {form.canConfigure && form.formMounted && (
            // The form compares its settings around the user's own pointer
            // and key presses (see `useSettingsEdited`).
            <div
              hidden={!form.drafting}
              data-testid="new-instance-configure-form"
              onPointerDownCapture={form.noteSettingsBaseline}
              onKeyDownCapture={form.noteSettingsBaseline}
              onPointerUpCapture={form.checkSettingsEdited}
              onKeyUpCapture={form.checkSettingsEdited}
              onChangeCapture={form.checkSettingsEdited}
            >
              <ConfigureDraftProvider value={form.draft.host}>
                <DraftSummaryProvider value={form.reportSummary}>
                  <ConfigurePanelFor service={form.draftBase} />
                </DraftSummaryProvider>
              </ConfigureDraftProvider>
            </div>
          )}
        </div>

        <CreationSummary
          verb={words.verb}
          label={form.label}
          rows={form.summaryRows}
          autostart={form.autostart}
          firstStart={form.firstStart}
        />
      </div>

      <NewInstanceFooter
        problem={form.problem}
        problemId={problemId}
        onReview={reviewSettings}
        autostart={form.autostart}
        onAutostartChange={form.setAutostart}
        autostartLabel={words.autostartLabel}
        onCancel={onDismiss}
        canSubmit={form.isValid}
        submitting={form.creating}
        submitLabel={words.submitLabel}
        pendingLabel={words.pendingLabel}
        pendingNote={words.pendingNote}
        onSubmit={form.submit}
      />
    </>
  )
}
