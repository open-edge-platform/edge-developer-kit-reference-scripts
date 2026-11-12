// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useMemo, useState } from 'react'
import { ListFilter, Loader2, Send, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useServiceApiBase } from '@/context/service-status-context'
import { SUBJECTS, type Subject } from '@/samples/ai-exam-marking/lib/types'
import {
  useSendResults,
  type SendResultStudentOutcome,
} from '../hooks/use-send-results'

const SUBJECT_OPTIONS = Object.keys(SUBJECTS) as Subject[]

const RESULT_KEY_SEPARATOR = '::'

/** Composite key for one selectable (student, subject) result row. */
function resultKey(
  result: Pick<SendResultStudentOutcome, 'student_id' | 'subject'>,
) {
  return `${result.student_id}${RESULT_KEY_SEPARATOR}${result.subject}`
}

export type RecipientRole = 'teacher' | 'student'
export type DispatchPlatform = 'email' | 'telegram'

export type SendResultConfig = {
  recipientRole: RecipientRole
  subjectFilter: Subject | 'all'
  platform: DispatchPlatform
  // Every matched result is sent to this single email/Telegram ID.
  manualTarget: string
}

export const DEFAULT_SEND_RESULT_CONFIG: SendResultConfig = {
  recipientRole: 'teacher',
  subjectFilter: 'all',
  platform: 'email',
  manualTarget: '',
}

type SendResultSetupProps = {
  value: SendResultConfig
  onChange: (config: SendResultConfig) => void
}

export function SendResultSetup({ value, onChange }: SendResultSetupProps) {
  const agentApiBase = useServiceApiBase('exam-marking-agent')
  const preview = useSendResults(agentApiBase)
  const send = useSendResults(agentApiBase)
  const [previewResults, setPreviewResults] = useState<
    SendResultStudentOutcome[] | null
  >(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [appliedSignature, setAppliedSignature] = useState<string | null>(null)

  const manualTargetMissing =
    value.recipientRole === 'teacher' && !value.manualTarget.trim()

  const currentSignature = useMemo(
    () =>
      JSON.stringify([
        value.recipientRole,
        value.subjectFilter,
        value.platform,
        value.manualTarget,
      ]),
    [value],
  )
  const filtersChanged =
    previewResults !== null && appliedSignature !== currentSignature

  const handleApply = () => {
    preview.mutate(
      { ...value, dryRun: true },
      {
        onSuccess: (data) => {
          const results = data.results ?? []
          setPreviewResults(results)
          setSelectedIds(new Set(results.map((r) => resultKey(r))))
          setAppliedSignature(currentSignature)
        },
      },
    )
  }

  const toggleSelected = (key: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }

  const allSelected =
    !!previewResults?.length && selectedIds.size === previewResults.length

  const toggleSelectAll = () => {
    if (!previewResults) return
    setSelectedIds(
      allSelected
        ? new Set()
        : new Set(previewResults.map((r) => resultKey(r))),
    )
  }

  const handleSend = () => {
    const selections = Array.from(selectedIds).map((key) => {
      const [studentId, subject] = key.split(RESULT_KEY_SEPARATOR)
      return { studentId, subject }
    })
    send.mutate({ ...value, dryRun: false, selections })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Users className="h-4 w-4" />
          Recipient Setup
        </CardTitle>
        <CardDescription>
          Enter teacher email/Telegram address to receive all matching results.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="send-recipient-role">Recipient</Label>
          <Select
            value={value.recipientRole}
            onValueChange={(recipientRole) =>
              onChange({
                ...value,
                recipientRole: recipientRole as RecipientRole,
              })
            }
          >
            <SelectTrigger id="send-recipient-role" className="w-full">
              <SelectValue placeholder="Select a recipient" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="teacher">Teacher</SelectItem>
              <SelectItem value="student">Student</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="send-platform">Platform</Label>
          <Select
            value={value.platform}
            onValueChange={(platform) =>
              onChange({ ...value, platform: platform as DispatchPlatform })
            }
          >
            <SelectTrigger id="send-platform" className="w-full">
              <SelectValue placeholder="Select a platform" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="email">Email</SelectItem>
              <SelectItem value="telegram">Telegram</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {value.recipientRole === 'teacher' && (
          <div className="space-y-1.5">
            <Label htmlFor="send-manual-target">
              {value.platform === 'email'
                ? 'Email address'
                : 'Telegram chat ID'}
            </Label>
            <Input
              id="send-manual-target"
              placeholder={
                value.platform === 'email'
                  ? 'e.g. teacher@example.com'
                  : 'e.g. 123456789'
              }
              value={value.manualTarget}
              onChange={(e) =>
                onChange({ ...value, manualTarget: e.target.value })
              }
            />
          </div>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="send-subject-filter">Subject</Label>
          <Select
            value={value.subjectFilter}
            onValueChange={(subjectFilter) =>
              onChange({
                ...value,
                subjectFilter: subjectFilter as Subject | 'all',
              })
            }
          >
            <SelectTrigger id="send-subject-filter" className="w-full">
              <SelectValue placeholder="Select a subject" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Subjects</SelectItem>
              {SUBJECT_OPTIONS.map((subject) => (
                <SelectItem key={subject} value={subject}>
                  {subject}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Button
          type="button"
          variant="outline"
          className="w-full gap-1.5"
          disabled={preview.isPending || manualTargetMissing}
          onClick={handleApply}
        >
          {preview.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <ListFilter className="h-4 w-4" />
          )}
          {preview.isPending ? 'Applying...' : 'Apply Filters'}
        </Button>

        {manualTargetMissing && (
          <p className="text-muted-foreground text-xs">
            Enter an email address/Telegram chat ID above before applying
            filters.
          </p>
        )}

        {preview.isError && (
          <p className="text-destructive text-xs">
            {preview.error instanceof Error
              ? preview.error.message
              : 'Failed to load matching results.'}
          </p>
        )}

        {previewResults && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label>
                Matching Results ({previewResults.length}
                {filtersChanged ? ' — stale' : ''})
              </Label>
              {previewResults.length > 0 && !filtersChanged && (
                <label className="flex items-center gap-1.5 text-xs">
                  <input
                    type="checkbox"
                    className="accent-primary h-3.5 w-3.5"
                    checked={allSelected}
                    onChange={toggleSelectAll}
                  />
                  Select all
                </label>
              )}
            </div>

            {filtersChanged ? (
              <p className="text-muted-foreground text-xs">
                Filters changed — click &quot;Apply Filters&quot; again to
                refresh the list before sending.
              </p>
            ) : previewResults.length === 0 ? (
              <p className="text-muted-foreground text-xs">
                No students matched these filters.
              </p>
            ) : (
              <ScrollArea className="h-40 rounded border">
                <div className="divide-y">
                  {previewResults.map((result) => {
                    const key = resultKey(result)
                    return (
                      <label
                        key={key}
                        className="hover:bg-muted/50 flex cursor-pointer items-start gap-2 px-2.5 py-1.5 text-xs"
                      >
                        <input
                          type="checkbox"
                          className="accent-primary mt-0.5 h-3.5 w-3.5"
                          checked={selectedIds.has(key)}
                          onChange={() => toggleSelected(key)}
                        />
                        <div className="min-w-0 flex-1">
                          <span className="font-medium">
                            {result.student_name || result.student_id}
                          </span>
                          <p className="text-muted-foreground">
                            subject: {result.subject}
                          </p>
                        </div>
                      </label>
                    )
                  })}
                </div>
              </ScrollArea>
            )}
          </div>
        )}
      </CardContent>
      <CardFooter className="flex flex-col items-stretch gap-2">
        <Button
          className="gap-1.5"
          disabled={
            send.isPending ||
            manualTargetMissing ||
            !previewResults ||
            filtersChanged ||
            selectedIds.size === 0
          }
          onClick={handleSend}
        >
          {send.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
          {send.isPending ? 'Sending...' : `Send Results (${selectedIds.size})`}
        </Button>

        {(send.isError || send.isSuccess) && (
          <div className="bg-muted/30 space-y-2 rounded-md border px-3 py-2">
            <p className="text-xs font-medium">Status:</p>

            {send.isError && (
              <p className="text-destructive text-xs">
                {send.error instanceof Error
                  ? send.error.message
                  : 'Failed to send results.'}
              </p>
            )}

            {send.isSuccess && (
              <>
                <p
                  className={
                    send.data.success
                      ? 'text-xs text-green-600 dark:text-green-400'
                      : 'text-destructive text-xs'
                  }
                >
                  {send.data.summary ||
                    send.data.error ||
                    (send.data.success
                      ? 'Results sent successfully.'
                      : 'Failed to send results.')}
                </p>

                <div className="text-muted-foreground grid grid-cols-3 gap-2 text-xs">
                  <div>
                    <span className="text-foreground font-medium">
                      {send.data.students_processed ?? 0}
                    </span>{' '}
                    processed
                  </div>
                  <div>
                    <span className="font-medium text-green-600 dark:text-green-400">
                      {send.data.total_sent ?? 0}
                    </span>{' '}
                    sent
                  </div>
                  <div>
                    <span className="text-destructive font-medium">
                      {send.data.total_failed ?? 0}
                    </span>{' '}
                    failed
                  </div>
                </div>

                {send.data.results && send.data.results.length > 0 && (
                  <ScrollArea className="h-40 rounded border">
                    <div className="divide-y">
                      {send.data.results.map((result) => (
                        <div
                          key={resultKey(result)}
                          className="px-2.5 py-1.5 text-xs"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-medium">
                              {result.student_name || result.student_id}
                            </span>
                            <span
                              className={
                                result.success
                                  ? 'text-green-600 dark:text-green-400'
                                  : 'text-destructive'
                              }
                            >
                              {result.sent} sent · {result.failed} failed
                            </span>
                          </div>
                          <p className="text-muted-foreground">
                            subject: {result.subject}
                          </p>
                          {result.recipients?.map((recipient, idx) => (
                            <p
                              key={`${resultKey(result)}-${recipient.recipient}-${idx}`}
                              className="text-muted-foreground mt-0.5"
                            >
                              {recipient.recipient}:{' '}
                              {recipient.success
                                ? recipient.to || 'sent'
                                : recipient.error || 'failed'}
                            </p>
                          ))}
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                )}
              </>
            )}
          </div>
        )}
      </CardFooter>
    </Card>
  )
}
