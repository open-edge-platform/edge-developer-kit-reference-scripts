// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Check } from 'lucide-react'
import type { ReactNode } from 'react'
import { TruncatedText } from '@/components/common/truncated-text'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { Service } from '@/services/types'
import { useAvatarList } from '../hooks'

function Step({
  index,
  title,
  done,
  status,
  action,
  testId,
}: {
  index: number
  title: string
  done: boolean
  status: ReactNode
  action?: ReactNode
  testId: string
}) {
  return (
    <li className="flex gap-3" data-testid={testId}>
      <span
        aria-hidden="true"
        className={cn(
          'flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold',
          done
            ? 'border-primary bg-primary text-primary-foreground'
            : 'border-border text-muted-foreground',
        )}
      >
        {done ? <Check className="h-3.5 w-3.5" /> : index}
      </span>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <p className="text-foreground text-sm font-medium">
            <span className="sr-only">
              Step {index}
              {done ? ', done' : ''}:{' '}
            </span>
            {title}
          </p>
          {action}
        </div>
        <div className="text-muted-foreground text-xs">{status}</div>
      </div>
    </li>
  )
}

export interface LipsyncStepsProps {
  service: Service
  sessionId: string | null
  isConnecting: boolean
  /** Opens the Avatars tab, where avatars are chosen and made. */
  onChooseAvatar: () => void
}

/** The demo's steps and where each stands, telling the running service apart from this tab's session. */
export function LipsyncSteps({
  service,
  sessionId,
  isConnecting,
  onChooseAvatar,
}: LipsyncStepsProps) {
  const avatars = useAvatarList(service.apiBase)
  const connected = sessionId !== null
  const activeSkin = avatars.data?.items.find(
    (skin) => skin.skin_id === avatars.data?.default_skin,
  )
  const activeName =
    activeSkin?.skin_name || activeSkin?.skin_id || avatars.data?.default_skin
  const instanceName = service.label ?? service.name

  return (
    <section
      aria-labelledby="lipsync-steps-heading"
      className="border-border bg-card space-y-3 rounded-xl border p-4"
    >
      <h3
        id="lipsync-steps-heading"
        className="text-foreground text-sm font-semibold"
      >
        How it works
      </h3>
      <ol className="space-y-3">
        <Step
          index={1}
          title="Connect the avatar stream"
          done={connected}
          testId="lipsync-step-connect"
          status={
            connected
              ? 'Avatar session connected in this tab.'
              : isConnecting
                ? 'Connecting the avatar session…'
                : `${instanceName} is running, but this tab has no avatar session yet. Connect on the avatar stream opens one; Disconnect ends it and leaves the service running.`
          }
        />
        <Step
          index={2}
          title="Choose or create an avatar"
          done={Boolean(activeName)}
          testId="lipsync-step-avatar"
          status={
            avatars.isLoading ? (
              'Loading avatars…'
            ) : activeName ? (
              <span className="flex min-w-0 items-baseline gap-1">
                <span className="shrink-0">Active avatar:</span>
                <TruncatedText
                  text={activeName}
                  className="text-foreground max-w-48"
                />
              </span>
            ) : avatars.isError ? (
              'The avatar list could not be loaded.'
            ) : (
              'No avatar yet: create one from a short video.'
            )
          }
          action={
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              onClick={onChooseAvatar}
            >
              Choose or create
            </Button>
          }
        />
        <Step
          index={3}
          title="Send text or audio"
          done={false}
          testId="lipsync-step-send"
          status={
            connected
              ? 'Chat voices your text with Text to Speech; Audio lip-syncs an uploaded file. Frame generation can smooth either.'
              : 'Available once the avatar stream is connected. Chat also needs Text to Speech running.'
          }
        />
      </ol>
    </section>
  )
}
