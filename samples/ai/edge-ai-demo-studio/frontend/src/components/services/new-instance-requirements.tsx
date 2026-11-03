// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import {
  CheckCircle2,
  CircleHelp,
  ExternalLink,
  Info,
  KeyRound,
  Loader,
} from 'lucide-react'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { useServiceStatus } from '@/context/service-status-context'
import { type HfTokenState, useHfTokenState } from '@/hooks/use-has-hf-token'
import { serviceHref } from '@/lib/instances/service-presentation'
import { cn } from '@/lib/utils'
import { HREF_CHARS, safeHref } from '@/lib/validation'
import type { Service } from '@/services/types'
import { isModelSource } from '@/types/common'
import { findModelOption } from './new-instance-downloads'

/** Shown by icon and title together, never by colour alone. */
type RequirementStatus = 'missing' | 'unverified' | 'met' | 'checking' | 'info'

const STATUS_ICON: Record<RequirementStatus, ReactNode> = {
  missing: <KeyRound className="text-warning h-4 w-4" />,
  unverified: <CircleHelp className="text-info h-4 w-4" />,
  met: <CheckCircle2 className="text-success h-4 w-4" />,
  checking: <Loader className="text-muted-foreground h-4 w-4 animate-spin" />,
  info: <Info className="text-info h-4 w-4" />,
}

/** One line of "Before you start": a status icon, a title and what to do. */
export function RequirementItem({
  status,
  title,
  children,
  compact,
  'data-testid': testId,
}: {
  status: RequirementStatus
  /** Says the status in words ("Hugging Face token missing"). */
  title?: string
  children: ReactNode
  compact?: boolean
  'data-testid'?: string
}) {
  return (
    <li
      className={cn(
        'flex items-start gap-2.5 leading-relaxed',
        compact ? 'text-xs' : 'text-sm',
      )}
      data-testid={testId}
      data-state={status}
    >
      <span aria-hidden="true" className="mt-0.5 shrink-0">
        {STATUS_ICON[status]}
      </span>
      <div className="min-w-0 space-y-0.5">
        {title && <p className="text-foreground font-medium">{title}</p>}
        <div className={cn(title && 'text-muted-foreground')}>{children}</div>
      </div>
    </li>
  )
}

const linkClass = 'text-primary font-medium underline underline-offset-2'

/**
 * A link out of the setup. In the New instance sheet it opens a new tab, so the unsaved form stays
 * as it was; the token check refreshes when the window regains focus.
 */
function SetupLink({
  newTab,
  children,
  ...to
}: ({ href: string } | { serviceType: string }) & {
  newTab: boolean
  children: ReactNode
}) {
  let href = ''
  for (const ch of safeHref(
    'serviceType' in to ? serviceHref(to.serviceType) : to.href,
  )) {
    let ok = ''
    for (const allowed of HREF_CHARS)
      if (allowed === ch) {
        ok = allowed
        break
      }
    if (!ok) {
      href = '/'
      break
    }
    href += ok
  }
  if (!newTab) {
    return (
      <Link href={href} className={linkClass}>
        {children}
      </Link>
    )
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(linkClass, 'inline-flex items-center gap-0.5')}
    >
      {children}
      <ExternalLink aria-hidden="true" className="h-3 w-3" />
      <span className="sr-only">(opens in a new tab)</span>
    </a>
  )
}

function LicenceLink({ model }: { model: string }) {
  return (
    <a
      href={`https://huggingface.co/${model}`}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(linkClass, 'inline-flex items-center gap-0.5')}
    >
      its Hugging Face page
      <ExternalLink aria-hidden="true" className="h-3 w-3" />
      <span className="sr-only">(opens in a new tab)</span>
    </a>
  )
}

const TOKEN_STATUS: Record<HfTokenState, RequirementStatus> = {
  missing: 'missing',
  set: 'unverified',
  checking: 'checking',
  unknown: 'unverified',
}

const TOKEN_TITLE: Record<HfTokenState, string> = {
  missing: 'Hugging Face token missing',
  set: 'Hugging Face access not verified yet',
  checking: 'Checking for a Hugging Face token…',
  unknown: 'Could not check for a Hugging Face token',
}

/** The licence gate of a model on Hugging Face, by token state. */
function GatedModelRequirement({
  service,
  model,
  label,
  inSheet,
}: {
  service: Service
  model: string
  label: string
  inSheet: boolean
}) {
  const token = useHfTokenState()
  const settings = (
    <SetupLink href="/settings#hf-token" newTab={inSheet}>
      Settings
    </SetupLink>
  )
  // A registry that does not gate the model, chosen under Advanced settings
  // (only the sheet has them).
  const gatedOn = findModelOption(service, model)?.gated ?? []
  const ungatedSource = inSheet
    ? service.config?.availableModelSources?.find(
        (s) => isModelSource(s.value) && !gatedOn.includes(s.value),
      )
    : undefined

  return (
    <RequirementItem
      status={TOKEN_STATUS[token]}
      title={TOKEN_TITLE[token]}
      compact={inSheet}
      data-testid="setup-requirement-hf-token"
    >
      {token === 'set' ? (
        <>
          A token is set, but whether its account may download {label} is only
          known when the first start downloads it. Accept the model&apos;s
          licence on <LicenceLink model={model} /> with that account first. If
          access is refused, the start fails and its logs say why.
        </>
      ) : (
        <>
          {label} is gated on Hugging Face: downloading it needs an access token
          from an account that has accepted its licence on{' '}
          <LicenceLink model={model} />.{' '}
          {token === 'missing' ? 'Add the token in ' : 'Check it in '}
          {settings}
          {inSheet ? ' — this form stays as it is.' : '.'}
          {ungatedSource &&
            ` Downloading it from ${ungatedSource.label} instead (Advanced settings) needs no token.`}
        </>
      )}
    </RequirementItem>
  )
}

/**
 * What a service needs before it is useful: Hugging Face access for a gated model, and the services
 * it works with. Renders list items only; the caller owns the list.
 */
export function SetupRequirementItems({
  service,
  model,
  inSheet = false,
}: {
  service: Service
  model: string | undefined
  /** In the New instance sheet: links open a new tab, denser type. */
  inSheet?: boolean
}) {
  const { services } = useServiceStatus()
  const option = findModelOption(service, model)
  const gated = Boolean(model && option?.gated?.includes('huggingface'))
  const prerequisites = (service.prerequisiteServices ?? [])
    .map((id) => services.find((s) => s.id === id))
    .filter((s): s is Service => Boolean(s))

  return (
    <>
      {gated && model && (
        <GatedModelRequirement
          service={service}
          model={model}
          label={option?.label ?? model}
          inSheet={inSheet}
        />
      )}
      {prerequisites.map((p) => {
        const added = (p.instances?.length ?? 0) > 0
        const link = (
          <SetupLink serviceType={p.id} newTab={inSheet}>
            {p.name}
          </SetupLink>
        )
        return (
          <RequirementItem
            key={p.id}
            status={added ? 'met' : 'info'}
            compact={inSheet}
            data-testid={`setup-requirement-${p.id}`}
          >
            {added ? (
              <>Works with your {link} instance while it is running.</>
            ) : (
              <>
                Works with {link}, which is not added yet. Add it too before
                using {service.name}.
              </>
            )}
          </RequirementItem>
        )
      })}
    </>
  )
}

/** Whether {@link SetupRequirementItems} would list anything. */
export function hasSetupRequirements(
  service: Service,
  model: string | undefined,
): boolean {
  return (
    Boolean(findModelOption(service, model)?.gated?.includes('huggingface')) ||
    (service.prerequisiteServices?.length ?? 0) > 0
  )
}
