// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Check, CircleAlert, CircleDot, Loader, Save } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useLeaveGuard } from '@/components/common/leave-guard'
import { Button } from '@/components/ui/button'
import { useThemePreview } from '@/context/theme-provider'
import { useHfTokenQuery } from '@/hooks/use-has-hf-token'
import { cn } from '@/lib/utils'
import { ApiConfigSection } from './api-config-section'
import { AppearanceSection } from './appearance-section'
import { DeploymentSection } from './deployment-section'
import {
  describeRequestError,
  type LoadState,
  useConfirmedTheme,
  useLoadState,
  useProxyTimeout,
  useSaveSettings,
  useStartupTimeout,
} from './hooks'
import { ProxyConfigSection } from './proxy-config-section'
import { ServiceHealthSection } from './service-health-section'
import {
  changedFields,
  FIELD_NAMES,
  listNames,
  outcomesBeforeSave,
  pendingChanges,
  pickChanges,
  pickDrafts,
  type SaveResults,
  type SavedSettings,
  type SettingsDrafts,
  type SettingsField,
  settleDrafts,
  UNTOUCHED,
  withoutOutcome,
} from './settings-draft'
import type { FieldState } from './settings-section'

const names = (fields: readonly SettingsField[]) =>
  listNames(fields.map((field) => FIELD_NAMES[field]))

/**
 * The line beside Save: what is being saved, what the last save stored and
 * what it could not (each section shows why), or what is still unsaved.
 */
function SaveSummary({
  sending,
  outcomes,
  dirtyFields,
}: {
  sending: readonly SettingsField[]
  outcomes: SaveResults
  dirtyFields: readonly SettingsField[]
}) {
  const failed = dirtyFields.filter((field) => outcomes[field]?.ok === false)
  // A field edited again after it was saved counts as unsaved, not both.
  const saved = (Object.keys(outcomes) as SettingsField[]).filter(
    (field) => outcomes[field]?.ok && !dirtyFields.includes(field),
  )
  const unsaved = dirtyFields.filter((field) => !failed.includes(field))

  let icon = null
  let text = ''
  if (sending.length > 0) {
    icon = <Loader aria-hidden="true" className="h-4 w-4 animate-spin" />
    text = `Saving the ${names(sending)}…`
  } else if (failed.length > 0) {
    icon = <CircleAlert aria-hidden="true" className="h-4 w-4" />
    text = [
      saved.length > 0 && `Saved: ${names(saved)}.`,
      `Not saved: ${names(failed)}. The reason is shown in the section.`,
      unsaved.length > 0 && `Unsaved: ${names(unsaved)}.`,
    ]
      .filter(Boolean)
      .join(' ')
  } else if (unsaved.length > 0) {
    icon = <CircleDot aria-hidden="true" className="h-4 w-4" />
    text = [
      saved.length > 0 && `Saved: ${names(saved)}.`,
      `Unsaved changes: ${names(unsaved)}.`,
    ]
      .filter(Boolean)
      .join(' ')
  } else if (saved.length > 0) {
    icon = <Check aria-hidden="true" className="h-4 w-4" />
    text = 'All changes saved.'
  }

  const tone =
    failed.length > 0
      ? 'text-destructive'
      : sending.length === 0 && unsaved.length > 0
        ? 'text-warning-strong'
        : sending.length === 0 && saved.length > 0
          ? 'text-success-strong'
          : 'text-muted-foreground'

  return (
    <p
      role="status"
      data-testid="settings-save-summary"
      className={cn('flex min-w-0 flex-1 items-start gap-2 text-sm', tone)}
    >
      {icon && <span className="mt-0.5 shrink-0">{icon}</span>}
      <span>{text}</span>
    </p>
  )
}

/**
 * Fields are drafts until Save, which sends one request per changed setting so a refused one never
 * hides what saved and Retry resends only failures. Leaving with unsaved drafts asks first.
 */
export function SettingsForm() {
  const themeQuery = useConfirmedTheme()
  const tokenQuery = useHfTokenQuery()
  const startupQuery = useStartupTimeout()
  const proxyQuery = useProxyTimeout()
  const previewTheme = useThemePreview()
  const { mutate: save, isPending: saving, variables } = useSaveSettings()

  const loads: Record<SettingsField, LoadState> = {
    theme: useLoadState(themeQuery),
    hfToken: useLoadState(tokenQuery),
    startupTimeout: useLoadState(startupQuery),
    proxyTimeout: useLoadState(proxyQuery),
  }
  const ready = (field: SettingsField) => loads[field].status === 'ready'
  // Only a loaded value is ever shown or compared as the saved one.
  const saved: SavedSettings = {
    theme: ready('theme') ? themeQuery.data?.theme : undefined,
    hasToken: ready('hfToken') ? tokenQuery.data?.hasToken : undefined,
    startupTimeout: ready('startupTimeout')
      ? startupQuery.data?.startupTimeout
      : undefined,
    proxyTimeout: ready('proxyTimeout')
      ? proxyQuery.data?.proxyTimeout
      : undefined,
  }

  const [drafts, setDrafts] = useState<SettingsDrafts>(UNTOUCHED)
  const [outcomes, setOutcomes] = useState<SaveResults>({})

  const changes = pendingChanges(drafts, saved)
  const dirtyFields = changedFields(changes)
  const dirty = dirtyFields.length > 0
  const sending = saving && variables ? changedFields(variables) : []

  // The theme being chosen shows at once; leaving the page drops it.
  useEffect(() => {
    previewTheme(drafts.theme)
    return () => previewTheme(null)
  }, [drafts.theme, previewTheme])

  useLeaveGuard(dirty, {
    title: 'Leave without saving your settings?',
    description: saving
      ? 'Your settings are still being saved. If you leave and saving fails, your changes are lost.'
      : `Your ${names(dirtyFields)} ${dirtyFields.length > 1 ? 'changes have' : 'change has'} not been saved and will be lost.`,
    confirmLabel: 'Discard and leave',
    cancelLabel: 'Keep editing',
  })

  const edit = <F extends SettingsField>(
    field: F,
    value: SettingsDrafts[F],
  ) => {
    setDrafts((current) => ({ ...current, [field]: value }))
    // The last result no longer describes what the field holds.
    setOutcomes((current) => withoutOutcome(current, field))
  }

  /** Saves the current change of each of `fields` (all changed ones by default). */
  const submit = (fields: readonly SettingsField[] = dirtyFields) => {
    const subset = pickChanges(changes, fields)
    const fieldsSent = changedFields(subset)
    if (fieldsSent.length === 0 || saving) return
    // What each field held when sent: a draft edited since is kept.
    const submitted = pickDrafts(drafts, fieldsSent)
    setOutcomes((current) => outcomesBeforeSave(current, fieldsSent))
    save(subset, {
      onSuccess: (results) => {
        const savedFields = fieldsSent.filter((field) => results[field]?.ok)
        setDrafts((current) => settleDrafts(current, submitted, savedFields))
        setOutcomes((current) => ({ ...current, ...results }))
      },
      onError: (error) => {
        const reason = {
          ok: false as const,
          error: describeRequestError(error),
        }
        setOutcomes((current) => ({
          ...current,
          ...Object.fromEntries(fieldsSent.map((field) => [field, reason])),
        }))
      },
    })
  }

  const stateOf = (
    field: SettingsField,
    retryLoad: () => unknown,
  ): FieldState => ({
    field,
    name: FIELD_NAMES[field],
    load: loads[field],
    onRetryLoad: () => void retryLoad(),
    dirty: changes[field] !== undefined,
    saving: sending.includes(field),
    saveInProgress: saving,
    outcome: outcomes[field],
    onRetrySave: () => submit([field]),
  })

  // Only failed changes are left: the button resends exactly those.
  const retrying =
    dirty && dirtyFields.every((field) => outcomes[field]?.ok === false)

  return (
    <>
      <AppearanceSection
        theme={
          saved.theme === undefined ? undefined : (drafts.theme ?? saved.theme)
        }
        onThemeChange={(theme) => edit('theme', theme)}
        state={stateOf('theme', themeQuery.refetch)}
      />

      <ApiConfigSection
        hfToken={drafts.hfToken}
        hasToken={saved.hasToken}
        onTokenChange={(token) => edit('hfToken', token)}
        state={stateOf('hfToken', tokenQuery.refetch)}
      />

      <ServiceHealthSection
        startupTimeout={
          drafts.startupTimeout ?? String(saved.startupTimeout ?? '')
        }
        savedStartupTimeout={saved.startupTimeout}
        onTimeoutChange={(value) => edit('startupTimeout', value)}
        state={stateOf('startupTimeout', startupQuery.refetch)}
      />

      <ProxyConfigSection
        proxyTimeout={drafts.proxyTimeout ?? String(saved.proxyTimeout ?? '')}
        savedProxyTimeout={saved.proxyTimeout}
        onTimeoutChange={(value) => edit('proxyTimeout', value)}
        state={stateOf('proxyTimeout', proxyQuery.refetch)}
      />

      <DeploymentSection />

      <div className="flex flex-wrap items-center justify-end gap-3">
        <SaveSummary
          sending={sending}
          outcomes={outcomes}
          dirtyFields={dirtyFields}
        />
        <Button
          className="shadow-primary/15 gap-2 shadow-md"
          onClick={() => submit()}
          disabled={!dirty || saving}
          data-testid="settings-save"
        >
          {saving ? (
            <Loader aria-hidden="true" className="h-4 w-4 animate-spin" />
          ) : (
            <Save aria-hidden="true" className="h-4 w-4" />
          )}
          {saving
            ? 'Saving…'
            : retrying
              ? 'Retry failed changes'
              : 'Save changes'}
        </Button>
      </div>
    </>
  )
}
