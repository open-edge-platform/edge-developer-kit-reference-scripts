// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { TriangleAlert } from 'lucide-react'
import { TruncatedText } from '@/components/common/truncated-text'
import { TONES } from '@/components/common/tones'
import {
  describeUnappliedSettings,
  type SettingDescriptions,
} from '@/components/configure/applied-settings'
import { SectionHeading } from '@/components/configure/config-section'
import type { ConfigurePanelStatus } from '@/components/configure/status-items'
import { Badge } from '@/components/ui/badge'
import { isRunningStatus } from '@/lib/instances/service-status'
import { cn } from '@/lib/utils'
import type { Service } from '@/types/service'

/** What the status block calls the settings it lists. */
function headingFor(service: Service, differs: boolean): string {
  if (differs) return 'Saved settings'
  if (service.status === 'online') return 'Running with these settings'
  if (service.status === 'starting') return 'Starting with these settings'
  return 'Saved settings'
}

/**
 * Top of the Runtime Settings sheet: the saved settings and, while the instance runs older ones,
 * each differing setting as running vs saved (from the server's record of how it was started).
 */
export function RuntimeStatus({
  service,
  statusItems,
  settingDescriptions,
  isDirty,
}: {
  service: Service
  statusItems: ConfigurePanelStatus[]
  settingDescriptions?: SettingDescriptions
  isDirty: boolean
}) {
  const label = service.label ?? service.name
  const unapplied = describeUnappliedSettings(service, settingDescriptions)
  const differs = unapplied.length > 0
  const warning = TONES.warning

  return (
    <section
      aria-label="Current settings"
      className="border-border/70 bg-muted/20 space-y-2.5 rounded-lg border p-3"
      data-testid="configure-status"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <SectionHeading as="p">{headingFor(service, differs)}</SectionHeading>
        {!isRunningStatus(service.status) && (
          <span className="text-muted-foreground text-xs">
            Used the next time it starts
          </span>
        )}
      </div>

      {statusItems.length > 0 && (
        <dl className="space-y-2">
          {statusItems.map((item) => (
            <div
              key={item.label}
              className="flex items-center justify-between gap-3 text-xs"
            >
              <dt className="text-muted-foreground shrink-0">{item.label}</dt>
              <dd className="text-foreground min-w-0 flex-1 text-right font-medium">
                <TruncatedText text={item.value} />
              </dd>
            </div>
          ))}
        </dl>
      )}

      {differs && (
        <div
          role="note"
          className={cn('space-y-2 rounded-md border p-2.5', warning.surface)}
          data-testid="configure-unapplied"
        >
          <p
            className={cn(
              'flex items-start gap-1.5 text-xs font-medium',
              warning.strongText,
            )}
          >
            <TriangleAlert
              aria-hidden="true"
              className="mt-0.5 h-3.5 w-3.5 shrink-0"
            />
            {label} still runs the settings it was started with. Restart it to
            apply the saved ones.
          </p>
          <table className="w-full table-fixed text-left text-xs">
            <thead className="text-muted-foreground">
              <tr>
                <th scope="col" className="w-1/4 pb-1 font-medium">
                  Setting
                </th>
                <th scope="col" className="pb-1 font-medium">
                  Running now
                </th>
                <th scope="col" className="pb-1 font-medium">
                  Saved
                </th>
              </tr>
            </thead>
            <tbody>
              {unapplied.map((d) => (
                <tr key={d.key} data-testid={`unapplied-${d.key}`}>
                  <th scope="row" className="py-0.5 pr-2 font-medium">
                    <TruncatedText text={d.label} />
                  </th>
                  <td className="py-0.5 pr-2">
                    <TruncatedText text={d.running} />
                  </td>
                  <td className="py-0.5 font-medium">
                    <TruncatedText text={d.saved} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {isDirty && <Badge tone="warning">Unsaved changes</Badge>}
    </section>
  )
}
