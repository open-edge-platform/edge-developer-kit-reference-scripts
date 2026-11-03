// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { CheckCircle2, Loader, Settings2 } from 'lucide-react'
import { createContext, type ReactNode, useContext, useState } from 'react'
import { useDiscardGuard } from '@/components/common/discard-changes-guard'
import { useLeaveGuard } from '@/components/common/leave-guard'
import type { SettingDescriptions } from '@/components/configure/applied-settings'
import { CollapsibleSection } from '@/components/configure/collapsible-section'
import { RuntimeStatus } from '@/components/configure/runtime-status'
import type { ConfigurePanelStatus } from '@/components/configure/status-items'
import { useInterruptionGuard } from '@/components/services/instance-lifecycle'
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
import type { ConfigSavePhase } from '@/hooks/use-service-config'
import { isRunningStatus } from '@/lib/instances/service-status'
import type { Service } from '@/types/service'

/** What Save is asked to do: store the settings, and restart to apply them. */
export interface ConfigureSaveRequest {
  restart: boolean
}

/** What the open sheet tells the sections inside it (the engine switch). */
interface ConfigureSheetState {
  /** The sheet's draft differs from what is saved. */
  dirty: boolean
  /** A save (or the restart after it) is in flight. */
  saving: boolean
}

const ConfigureSheetContext = createContext<ConfigureSheetState>({
  dirty: false,
  saving: false,
})

/** The draft state of the Runtime Settings sheet a section is rendered in. */
export function useConfigureSheetState(): ConfigureSheetState {
  return useContext(ConfigureSheetContext)
}

/**
 * Advanced settings fold state, held above the sheet by a multi-engine service: switching engine
 * swaps in a new sheet, which would otherwise fold it again.
 */
export const ConfigureAdvancedFoldContext = createContext<
  [boolean, (open: boolean) => void] | null
>(null)

export interface ConfigureSheetProps {
  service: Service
  statusItems: ConfigurePanelStatus[]
  /** How the panel names its own settings where running ≠ saved. */
  settingDescriptions?: SettingDescriptions
  isDirty: boolean
  isValid: boolean
  onSave: (request: ConfigureSaveRequest) => void
  isSaving?: boolean
  savePhase?: ConfigSavePhase | null
  open: boolean
  onOpenChange: (open: boolean) => void
  engineTabs?: ReactNode
  advanced?: ReactNode
  maintenance?: ReactNode
  children: ReactNode
}

/** What the sheet's footer says about the draft. */
function SaveState({
  isSaving,
  savePhase,
  isValid,
  isDirty,
}: {
  isSaving: boolean
  savePhase: ConfigSavePhase | null
  isValid: boolean
  isDirty: boolean
}) {
  if (isSaving) {
    return (
      <span data-testid="settings-save-state" data-state="saving">
        <Loader
          aria-hidden="true"
          className="mr-1.5 inline h-3.5 w-3.5 animate-spin"
        />
        {savePhase === 'restarting' ? 'Saved. Restarting…' : 'Saving…'}
      </span>
    )
  }
  if (!isValid) {
    return (
      <span
        className="text-destructive"
        data-testid="settings-save-state"
        data-state="invalid"
      >
        Some settings need attention before saving.
      </span>
    )
  }
  if (isDirty) {
    return (
      <span data-testid="settings-save-state" data-state="dirty">
        Unsaved changes
      </span>
    )
  }
  return (
    <span data-testid="settings-save-state" data-state="clean">
      <CheckCircle2
        aria-hidden="true"
        className="text-success mr-1.5 inline h-3.5 w-3.5"
      />
      No unsaved changes
    </span>
  )
}

/**
 * An existing instance's Runtime Settings sheet. `engineTabs` and `maintenance` are not part of the
 * draft: they act as soon as they are confirmed. Every way of closing asks before dropping changes.
 */
export function ConfigureSheet({
  service,
  statusItems,
  settingDescriptions,
  isDirty,
  isValid,
  onSave,
  isSaving = false,
  savePhase = null,
  open,
  onOpenChange,
  engineTabs,
  advanced,
  maintenance,
  children,
}: ConfigureSheetProps) {
  const ownAdvancedFold = useState(false)
  const [advancedOpen, setAdvancedOpen] =
    useContext(ConfigureAdvancedFoldContext) ?? ownAdvancedFold
  const [maintenanceOpen, setMaintenanceOpen] = useState(false)
  const label = service.label ?? service.name
  const running = isRunningStatus(service.status)
  const discardDescription = `Your changes to the runtime settings of ${label} have not been saved and will be lost.`

  const { guard, dialog: discardDialog } = useDiscardGuard({
    dirty: isDirty,
    description: discardDescription,
  })
  const { guard: guardRestart, dialog: interruptionDialog } =
    useInterruptionGuard()
  useLeaveGuard(open && isDirty, {
    title: 'Leave with unsaved settings?',
    description: discardDescription,
    confirmLabel: 'Leave and discard',
  })

  // No closing mid-save: the request carries on regardless, so closing must not look like cancelling.
  const requestOpenChange = (next: boolean) => {
    if (next) onOpenChange(true)
    else if (!isSaving) guard(() => onOpenChange(false))
  }

  const canSave = isDirty && isValid && !isSaving
  const saveAndRestart = () => {
    if (service.instanceKey) {
      guardRestart(
        [{ instanceKey: service.instanceKey, label }],
        'restart',
        () => onSave({ restart: true }),
      )
    } else {
      onSave({ restart: true })
    }
  }

  return (
    <ConfigureSheetContext.Provider
      value={{ dirty: isDirty, saving: isSaving }}
    >
      <Sheet open={open} onOpenChange={requestOpenChange}>
        <SheetTrigger asChild>
          <Button
            data-testid="workload-settings-button"
            type="button"
            variant="outline"
            size="sm"
            className="gap-2"
          >
            <Settings2 aria-hidden="true" className="h-3.5 w-3.5" />
            {/* Icon only on a phone, where the control bar is crowded. */}
            <span className="sr-only sm:not-sr-only">Configure</span>
            {isDirty && (
              <>
                <span
                  aria-hidden="true"
                  className="bg-warning ml-1 h-2 w-2 rounded-full"
                />
                <span className="sr-only">(unsaved changes)</span>
              </>
            )}
          </Button>
        </SheetTrigger>

        <SheetContent
          side="right"
          showCloseButton
          // Focus the sheet, not its first control: that control's tooltip
          // would open with the sheet and swallow the first Escape.
          onOpenAutoFocus={(event) => {
            event.preventDefault()
            if (event.currentTarget instanceof HTMLElement) {
              event.currentTarget.focus()
            }
          }}
          className="flex h-full min-h-0 w-full flex-col p-0 outline-none sm:max-w-[460px]"
        >
          <SheetHeader className="px-5 pt-5 pb-0">
            <SheetTitle className="pr-8 text-base break-words">
              Runtime Settings · {label}
            </SheetTitle>
            <SheetDescription className="text-xs">
              {label !== service.name && `${service.name} instance. `}
              {running
                ? `Changes apply when ${label} restarts: Save for later keeps it running as it is, Save and restart applies them now.`
                : `Saved changes apply the next time ${label} starts.`}
            </SheetDescription>
          </SheetHeader>

          <ScrollArea className="min-h-0 flex-1 px-5">
            <div className="space-y-5 pt-4 pb-5">
              <RuntimeStatus
                service={service}
                statusItems={statusItems}
                settingDescriptions={settingDescriptions}
                isDirty={isDirty}
              />

              <Separator />

              {children}

              {(engineTabs || advanced) && (
                <CollapsibleSection
                  title="Advanced settings"
                  note="Saved with the rest"
                  open={advancedOpen}
                  onOpenChange={setAdvancedOpen}
                  keepMounted
                  testId="configure-advanced"
                >
                  {engineTabs && (
                    <>
                      {engineTabs}
                      {advanced && <Separator />}
                    </>
                  )}
                  {advanced}
                </CollapsibleSection>
              )}

              {maintenance && (
                <CollapsibleSection
                  title="Maintenance"
                  note="Acts immediately"
                  open={maintenanceOpen}
                  onOpenChange={setMaintenanceOpen}
                  testId="configure-maintenance"
                >
                  <p className="text-muted-foreground px-2 text-xs">
                    These actions take effect as soon as you confirm them. Save
                    and Cancel do not apply to them.
                  </p>
                  {maintenance}
                </CollapsibleSection>
              )}
            </div>
          </ScrollArea>

          <SheetFooter className="border-border flex-row flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t px-5 py-3">
            <div className="text-muted-foreground text-xs" role="status">
              <SaveState
                isSaving={isSaving}
                savePhase={savePhase}
                isValid={isValid}
                isDirty={isDirty}
              />
            </div>

            <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={isSaving}
                onClick={() => requestOpenChange(false)}
                data-testid="settings-cancel-button"
              >
                Cancel
              </Button>
              {running ? (
                <>
                  <Button
                    data-testid="settings-save-button"
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!canSave}
                    onClick={() => onSave({ restart: false })}
                  >
                    Save for later
                  </Button>
                  <Button
                    data-testid="settings-save-restart-button"
                    type="button"
                    size="sm"
                    disabled={!canSave}
                    onClick={saveAndRestart}
                  >
                    Save and restart
                  </Button>
                </>
              ) : (
                <Button
                  data-testid="settings-save-button"
                  type="button"
                  size="sm"
                  disabled={!canSave}
                  onClick={() => onSave({ restart: false })}
                >
                  Save
                </Button>
              )}
            </div>
          </SheetFooter>
        </SheetContent>
      </Sheet>
      {discardDialog}
      {interruptionDialog}
    </ConfigureSheetContext.Provider>
  )
}
