// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Check, ChevronDown, Loader, type LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { shapedStatusDotClass } from '@/components/common/tones'
import { TruncatedText } from '@/components/common/truncated-text'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  instanceRuntime,
  STATE_LABEL,
} from '@/lib/instances/service-presentation'
import { cn } from '@/lib/utils'
import type { ServiceInstance, ServiceStatus } from '@/services/types'

export interface InstanceSwitcherFooterAction {
  label: ReactNode
  icon?: LucideIcon
  onSelect: () => void
  'data-testid'?: string
}

export interface InstanceSwitcherProps {
  /** The instance in use — `undefined` means automatic, when `automatic` is given. */
  selected: ServiceInstance | undefined
  instances: ServiceInstance[]
  onSelect: (instanceId: string) => void
  /**
   * Offers an "Automatic" entry; `resolved` is the instance answering now (the running one, else
   * the first). Without it, `selected` is required.
   */
  automatic?: {
    resolved: ServiceInstance | undefined
    onSelect: () => void
  }
  heading?: ReactNode
  /** Shown under the heading, e.g. what switching away would cut off. */
  headerNote?: ReactNode
  /** Beside an instance's name in the menu, e.g. a busy "Generating" badge. */
  renderBadge?: (instance: ServiceInstance) => ReactNode
  /** A last item after a separator, e.g. "Manage instances…". */
  footerAction?: InstanceSwitcherFooterAction
  /** `labelled`: caption, state dot and name. `name`: the name alone, inside a labelled bar. */
  trigger?: 'labelled' | 'name'
  /** Which edge of the trigger the menu lines up with. */
  align?: 'start' | 'end'
  /** A change is being saved. */
  pending?: boolean
  className?: string
  'data-testid'?: string
}

/** A shaped state dot with the state in words for screen readers. */
function StateDot({ status }: { status: ServiceStatus }) {
  return (
    <>
      <span
        aria-hidden="true"
        className={cn('h-2 w-2 shrink-0', shapedStatusDotClass(status))}
      />
      <span className="sr-only">{STATE_LABEL[status]}:</span>
    </>
  )
}

/** Dropdown that picks one instance of a service; renders nothing with fewer than two instances. */
export function InstanceSwitcher({
  selected,
  instances,
  onSelect,
  automatic,
  heading = 'Use in this sample',
  headerNote,
  renderBadge,
  footerAction,
  trigger = 'labelled',
  align = 'end',
  pending = false,
  className,
  'data-testid': testId = 'instance-switcher',
}: InstanceSwitcherProps) {
  if (instances.length < 2) return null
  if (!selected && !automatic) return null

  const isAutomatic = !selected
  const shown = selected ?? automatic?.resolved
  const FooterIcon = footerAction?.icon
  const selectedName = isAutomatic ? 'Automatic' : selected.label

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={cn('max-w-full min-w-0 gap-2', className)}
          data-testid={testId}
          disabled={pending}
          aria-label={
            trigger === 'name' ? `Instance: ${selectedName}` : undefined
          }
        >
          {trigger === 'labelled' && (
            <>
              <span className="text-muted-foreground text-xs font-medium">
                Instance
              </span>
              {pending ? (
                <Loader
                  aria-hidden="true"
                  className="text-muted-foreground h-3 w-3 animate-spin"
                />
              ) : (
                <StateDot status={shown?.status ?? 'offline'} />
              )}
            </>
          )}
          {/* Cut to fit; the full name shows on hover or focus, and in the menu. */}
          <TruncatedText
            text={selectedName}
            focusable={false}
            className={cn(
              'font-semibold',
              trigger === 'labelled' && 'max-w-[40vw] sm:max-w-[160px]',
            )}
          />
          {trigger === 'labelled' && isAutomatic && shown && (
            <span className="text-muted-foreground max-w-[120px] min-w-0 truncate text-xs font-normal">
              {shown.label}
            </span>
          )}
          <ChevronDown
            aria-hidden="true"
            className="text-muted-foreground h-3.5 w-3.5"
          />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align={align}
        className="min-w-[min(280px,calc(100vw-2rem))]"
      >
        <DropdownMenuLabel
          className={cn(
            'text-muted-foreground',
            typeof heading === 'string' && trigger === 'labelled'
              ? 'text-xs font-semibold'
              : 'text-xs font-normal',
          )}
        >
          {heading}
        </DropdownMenuLabel>
        {headerNote}
        {automatic && (
          <DropdownMenuItem
            onSelect={automatic.onSelect}
            className={cn(isAutomatic && 'bg-primary/[0.07] text-primary')}
          >
            <StateDot status={automatic.resolved?.status ?? 'offline'} />
            <span className="flex-1 font-medium">Automatic</span>
            {automatic.resolved && (
              <span className="text-muted-foreground min-w-0 text-xs break-words">
                {automatic.resolved.label}
              </span>
            )}
            {isAutomatic && (
              <Check aria-hidden="true" className="text-primary h-3.5 w-3.5" />
            )}
          </DropdownMenuItem>
        )}
        {instances.map((instance) => {
          const isSelected = instance.instanceKey === selected?.instanceKey
          const { device } = instanceRuntime(instance)
          return (
            <DropdownMenuItem
              key={instance.instanceKey}
              onSelect={() => onSelect(instance.instanceId)}
              className={cn(isSelected && 'bg-primary/[0.07] text-primary')}
            >
              <StateDot status={instance.status} />
              {/* Wrapped, not cut: the menu is where a long name is read. */}
              <span className="min-w-0 flex-1 font-medium break-words">
                {instance.label}
              </span>
              {renderBadge?.(instance)}
              {device && (
                <span className="text-muted-foreground shrink-0 font-mono text-xs">
                  {device}
                </span>
              )}
              {isSelected && (
                <Check
                  aria-hidden="true"
                  className="text-primary h-3.5 w-3.5"
                />
              )}
            </DropdownMenuItem>
          )
        })}
        {footerAction && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={footerAction.onSelect}
              data-testid={footerAction['data-testid']}
            >
              {FooterIcon && <FooterIcon aria-hidden="true" />}
              {footerAction.label}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
