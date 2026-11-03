// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import {
  Bell,
  CheckCircle2,
  Loader,
  Plus,
  Send,
  Trash2,
  XCircle,
} from 'lucide-react'
import { type FormEvent, useId, useState } from 'react'
import { InlineNotice } from '@/components/common/inline-notice'
import { TruncatedText } from '@/components/common/truncated-text'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { getErrorMessage } from '@/lib/errors'
import {
  useSubscribeWebhook,
  useTestWebhooks,
  useUnsubscribeWebhook,
} from '../hooks/use-webhooks'
import { useWakeWordSubscribers } from '../hooks/use-wake-word-queries'
import type { Subscriber, WebhookTestResult } from '../lib/api'

const DEFAULT_THRESHOLD = 0.6

interface FormErrors {
  url?: string
  threshold?: string
}

/** What is wrong with the form, field by field (nothing: it can be sent). */
function validate(url: string, threshold: string): FormErrors {
  const errors: FormErrors = {}
  const trimmed = url.trim()
  if (!trimmed) {
    errors.url = 'Enter the address to notify.'
  } else {
    let parsed: URL | null = null
    try {
      parsed = new URL(trimmed)
    } catch {
      parsed = null
    }
    if (!parsed || !['http:', 'https:'].includes(parsed.protocol)) {
      errors.url = 'Enter a full http:// or https:// address.'
    }
  }
  const value = Number(threshold)
  if (threshold.trim() === '' || !Number.isFinite(value)) {
    errors.threshold = 'Enter a score threshold between 0 and 1.'
  } else if (value < 0 || value > 1) {
    errors.threshold = 'The score threshold must be between 0 and 1.'
  }
  return errors
}

const subscriberName = (sub: Pick<Subscriber, 'name' | 'url'>) =>
  sub.name || sub.url

/** The webhooks the worker calls on a detection, folded away: add, list, remove, test. */
export function WebhookSubscribers({
  apiBase,
}: {
  apiBase: string | undefined
}) {
  const subscribersQuery = useWakeWordSubscribers(apiBase)
  const subscribe = useSubscribeWebhook(apiBase)
  const unsubscribe = useUnsubscribeWebhook(apiBase)
  const test = useTestWebhooks(apiBase)
  const subscribers = subscribersQuery.data ?? []
  const formId = useId()

  const [webhookUrl, setWebhookUrl] = useState('')
  const [nameInput, setNameInput] = useState('')
  const [threshold, setThreshold] = useState(String(DEFAULT_THRESHOLD))
  /** Errors show once the form was sent, then follow the input. */
  const [submitted, setSubmitted] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const errors = submitted ? validate(webhookUrl, threshold) : {}
  const listError =
    subscribersQuery.error?.message ?? unsubscribe.error?.message ?? null

  const handleSubscribe = (e: FormEvent) => {
    e.preventDefault()
    setSubmitted(true)
    setNotice(null)
    const problems = validate(webhookUrl, threshold)
    if (problems.url || problems.threshold) return
    const name = nameInput.trim()
    subscribe.mutate(
      {
        url: webhookUrl.trim(),
        name: name || undefined,
        threshold: Number(threshold),
      },
      {
        onSuccess: (result) => {
          const already = result?.message?.toLowerCase().includes('already')
          setNotice(
            already
              ? `${name || webhookUrl.trim()} was already subscribed.`
              : `Subscribed ${name || webhookUrl.trim()}.`,
          )
          setWebhookUrl('')
          setNameInput('')
          setSubmitted(false)
          test.reset()
        },
      },
    )
  }

  return (
    <div className="border-border border-t pt-4">
      <Accordion type="single" collapsible>
        <AccordionItem value="webhooks" className="border-none">
          <AccordionTrigger className="text-foreground py-0 text-xs font-medium">
            <span className="flex items-center gap-2">
              <Bell aria-hidden className="h-3.5 w-3.5" />
              Webhook notifications
              {subscribers.length > 0 && (
                <Badge variant="secondary" className="text-xs">
                  {subscribers.length}
                  <span className="sr-only"> subscribers</span>
                </Badge>
              )}
            </span>
          </AccordionTrigger>
          <AccordionContent>
            <div className="space-y-3 pt-3">
              <p className="text-muted-foreground text-xs">
                Optional: the service POSTs each detection above a subscriber’s
                threshold to its address.
              </p>

              <form
                noValidate
                onSubmit={handleSubscribe}
                className="space-y-2"
                aria-label="Add a webhook subscriber"
              >
                <div className="space-y-1">
                  <Label htmlFor={`${formId}-url`} className="text-xs">
                    Webhook address
                  </Label>
                  <Input
                    id={`${formId}-url`}
                    value={webhookUrl}
                    onChange={(e) => setWebhookUrl(e.target.value)}
                    placeholder="https://example.local/hooks/wake-word"
                    inputMode="url"
                    aria-invalid={errors.url ? true : undefined}
                    aria-describedby={
                      errors.url ? `${formId}-url-error` : undefined
                    }
                    className="bg-muted/30 text-xs"
                  />
                  {errors.url && (
                    <p
                      id={`${formId}-url-error`}
                      className="text-destructive text-xs"
                    >
                      {errors.url}
                    </p>
                  )}
                </div>
                <div className="flex gap-2">
                  <div className="min-w-0 flex-1 space-y-1">
                    <Label htmlFor={`${formId}-name`} className="text-xs">
                      Name (optional)
                    </Label>
                    <Input
                      id={`${formId}-name`}
                      value={nameInput}
                      onChange={(e) => setNameInput(e.target.value)}
                      className="bg-muted/30 text-xs"
                    />
                  </div>
                  <div className="w-24 space-y-1">
                    <Label htmlFor={`${formId}-threshold`} className="text-xs">
                      Threshold
                    </Label>
                    <Input
                      id={`${formId}-threshold`}
                      value={threshold}
                      onChange={(e) => setThreshold(e.target.value)}
                      type="number"
                      min="0"
                      max="1"
                      step="0.05"
                      aria-invalid={errors.threshold ? true : undefined}
                      aria-describedby={
                        errors.threshold
                          ? `${formId}-threshold-error`
                          : undefined
                      }
                      className="bg-muted/30 text-xs"
                    />
                  </div>
                </div>
                {errors.threshold && (
                  <p
                    id={`${formId}-threshold-error`}
                    className="text-destructive text-xs"
                  >
                    {errors.threshold}
                  </p>
                )}
                {subscribe.isError && (
                  <InlineNotice tone="destructive" size="sm">
                    Could not subscribe:{' '}
                    {getErrorMessage(subscribe.error, 'the request failed')}
                  </InlineNotice>
                )}
                {notice && (
                  <p
                    role="status"
                    className="text-success-strong text-xs"
                    data-testid="wwd-webhook-notice"
                  >
                    {notice}
                  </p>
                )}
                <Button
                  type="submit"
                  disabled={subscribe.isPending}
                  size="sm"
                  className="w-full gap-1.5 text-xs"
                >
                  {subscribe.isPending ? (
                    <Loader aria-hidden className="h-3 w-3 animate-spin" />
                  ) : (
                    <Plus aria-hidden className="h-3 w-3" />
                  )}
                  Subscribe
                </Button>
              </form>

              {listError && (
                <InlineNotice tone="destructive" size="sm">
                  {listError}
                </InlineNotice>
              )}

              <div className="max-h-[180px] space-y-1.5 overflow-auto">
                {subscribers.length === 0 ? (
                  <p className="text-muted-foreground py-2 text-center text-xs">
                    No subscribers yet.
                  </p>
                ) : (
                  <ul className="space-y-1.5" aria-label="Subscribers">
                    {subscribers.map((sub) => (
                      <li
                        key={sub.id}
                        className="border-border flex items-center gap-2 rounded-lg border p-2 text-xs"
                      >
                        <div className="min-w-0 flex-1">
                          <TruncatedText
                            text={subscriberName(sub)}
                            className="text-xs font-medium"
                          />
                          {sub.name && sub.name !== sub.url && (
                            <TruncatedText
                              text={sub.url}
                              className="text-muted-foreground text-xs"
                            />
                          )}
                        </div>
                        <Badge
                          variant="secondary"
                          className="shrink-0 text-xs"
                          title="Score threshold"
                        >
                          ≥ {sub.threshold}
                        </Badge>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className="shrink-0"
                          aria-label={`Unsubscribe ${subscriberName(sub)}`}
                          disabled={
                            unsubscribe.isPending &&
                            unsubscribe.variables === sub.url
                          }
                          onClick={() => unsubscribe.mutate(sub.url)}
                        >
                          <Trash2
                            aria-hidden
                            className="text-destructive h-3.5 w-3.5"
                          />
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {subscribers.length > 0 && (
                <div className="space-y-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-full gap-1.5 text-xs"
                    disabled={test.isPending}
                    onClick={() => test.mutate()}
                  >
                    {test.isPending ? (
                      <Loader aria-hidden className="h-3 w-3 animate-spin" />
                    ) : (
                      <Send aria-hidden className="h-3 w-3" />
                    )}
                    {test.isPending ? 'Sending test event…' : 'Send test event'}
                  </Button>
                  <TestOutcome
                    subscribers={subscribers}
                    pending={test.isPending}
                    error={test.error}
                    results={test.data}
                  />
                </div>
              )}
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  )
}

/** How each subscriber took the last test event. */
function TestOutcome({
  subscribers,
  pending,
  error,
  results,
}: {
  subscribers: Subscriber[]
  pending: boolean
  error: Error | null
  results: WebhookTestResult[] | undefined
}) {
  if (pending) return null
  if (error) {
    return (
      <InlineNotice tone="destructive" size="sm">
        The test event was not sent: {getErrorMessage(error, 'request failed')}
      </InlineNotice>
    )
  }
  if (!results) return null
  const delivered = results.filter((r) => r.status === 'success').length
  return (
    <div role="status" className="space-y-1" data-testid="wwd-webhook-test">
      <p className="text-foreground text-xs font-medium">
        Test event delivered to {delivered} of {results.length}.
      </p>
      <ul className="space-y-1">
        {results.map((result) => {
          const sub = subscribers.find((s) => s.url === result.url)
          const ok = result.status === 'success'
          return (
            <li key={result.url} className="flex items-start gap-1.5 text-xs">
              {ok ? (
                <CheckCircle2
                  aria-hidden="true"
                  className="text-success mt-0.5 h-3.5 w-3.5 shrink-0"
                />
              ) : (
                <XCircle
                  aria-hidden="true"
                  className="text-destructive mt-0.5 h-3.5 w-3.5 shrink-0"
                />
              )}
              <span className="min-w-0">
                <span className="font-medium">
                  {sub ? subscriberName(sub) : result.url}
                </span>
                {ok ? ': delivered' : `: failed: ${result.message}`}
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
