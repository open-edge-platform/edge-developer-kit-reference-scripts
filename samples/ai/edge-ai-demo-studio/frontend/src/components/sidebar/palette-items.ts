// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import {
  GalleryHorizontalEnd,
  Play,
  Plus,
  Server,
  Settings,
  Square,
  Terminal,
} from 'lucide-react'
import type { ComponentType } from 'react'
import type { AppPage } from '@/components/shell/app-pages'
import {
  CATALOG_HREF,
  getAttentionStatus,
  getServiceMembership,
  MEMBERSHIP_LABEL,
  serviceHref,
  serviceStateLabel,
} from '@/lib/instances/service-presentation'
import { isRunningStatus } from '@/lib/instances/service-status'
import type { ServiceAction } from '@/hooks/use-services'
import type { Service, ServiceStatus } from '@/services/types'
import { isServiceInSidebar } from './service-rail'

export type PaletteItemKind =
  'service' | 'instance' | 'sample' | 'action' | 'page'

/** What choosing an item does. */
export type PaletteAction =
  /** Opens an address; `visit` is the service to note as recently opened. */
  | { type: 'go'; href: string; visit?: string }
  | { type: Exclude<ServiceAction, 'restart'>; serviceId: string }

export interface PaletteItem {
  key: string
  kind: PaletteItemKind
  label: string
  sublabel?: string
  icon: ComponentType<{ className?: string }>
  status?: ServiceStatus
  /** The status in words, where not `STATE_LABEL`'s (a built-in is Available). */
  statusLabel?: string
  notInSidebar?: boolean
  action: PaletteAction
}

export interface PaletteInputs {
  /** The search as typed (trimmed here). */
  query: string
  /** Every service that may be listed (hidden ones already left out). */
  services: readonly Service[]
  /** Service ids opened most recently, newest first. */
  recent: readonly string[]
  /** Ids of the built-in services in use, which the sidebar lists. */
  inUse: readonly string[]
  samples: readonly { id: string; title: string }[]
  pages: readonly AppPage[]
  /** Whether a service has an instance this palette may start or stop. */
  canToggle: (service: Service) => boolean
}

function matches(query: string, ...fields: (string | undefined)[]): boolean {
  if (!query) return true
  const q = query.toLowerCase()
  return fields.some((f) => f?.toLowerCase().includes(q))
}

const ADD_SERVICE: PaletteItem = {
  key: 'action:add-service',
  kind: 'action',
  label: 'Add service',
  sublabel: 'Browse the catalog',
  icon: Plus,
  action: { type: 'go', href: CATALOG_HREF },
}

function serviceItem(service: Service, inUse: readonly string[]): PaletteItem {
  const inRail = isServiceInSidebar(service, inUse)
  const instanceCount = service.instances?.length ?? 0
  const status = getAttentionStatus(service)
  return {
    key: `service:${service.id}`,
    kind: 'service',
    label: service.name,
    sublabel: inRail
      ? [
          service.currentModel,
          instanceCount > 1 ? `${instanceCount} instances` : undefined,
        ]
          .filter(Boolean)
          .join(' · ') || service.description
      : MEMBERSHIP_LABEL[getServiceMembership(service, true)],
    icon: service.icon,
    status,
    statusLabel: serviceStateLabel(service, status),
    notInSidebar: !inRail,
    action: { type: 'go', href: serviceHref(service.id), visit: service.id },
  }
}

/** With nothing typed: recent and added services, then the way to more. */
function suggestions({
  services,
  recent,
  inUse,
}: Pick<PaletteInputs, 'services' | 'recent' | 'inUse'>): PaletteItem[] {
  const byId = (id: string) => services.find((s) => s.id === id)
  const out: PaletteItem[] = []
  for (const id of recent) {
    const service = byId(id)
    if (service) out.push(serviceItem(service, inUse))
  }
  for (const service of services) {
    if (recent.includes(service.id) || !isServiceInSidebar(service, inUse)) {
      continue
    }
    out.push(serviceItem(service, inUse))
  }
  if (out.length === 0) {
    for (const service of services.slice(0, 4)) {
      out.push(serviceItem(service, inUse))
    }
  }
  out.push(ADD_SERVICE, {
    key: 'page:services',
    kind: 'page',
    label: 'All services',
    sublabel: `${services.length} on this machine`,
    icon: Server,
    action: { type: 'go', href: '/services' },
  })
  out.push({
    key: 'page:settings',
    kind: 'page',
    label: 'Settings',
    sublabel: 'ports, model directory, startup timeout',
    icon: Settings,
    action: { type: 'go', href: '/settings' },
  })
  return out
}

/**
 * What the palette lists for a search, in order: services, instances of multi-instance services,
 * start/stop and logs actions, Add service, samples, then pages.
 */
export function buildPaletteItems(inputs: PaletteInputs): PaletteItem[] {
  const { services, samples, pages, canToggle, inUse } = inputs
  const q = inputs.query.trim()
  if (!q) return suggestions(inputs)

  const out: PaletteItem[] = []
  for (const service of services) {
    if (matches(q, service.name, service.id, service.currentModel)) {
      out.push(serviceItem(service, inUse))
    }
  }

  for (const service of services) {
    // A single instance is already reached through its service row.
    if ((service.instances?.length ?? 0) < 2) continue
    for (const instance of service.instances ?? []) {
      if (
        !matches(
          q,
          instance.instanceKey,
          instance.label,
          service.name,
          instance.currentModel,
          instance.currentDevice,
        )
      ) {
        continue
      }
      out.push({
        key: `instance:${instance.instanceKey}`,
        kind: 'instance',
        label: instance.label,
        sublabel:
          instance.statusMessage ??
          [service.name, instance.currentModel, instance.currentDevice]
            .filter(Boolean)
            .join(' · '),
        icon: service.icon,
        status: instance.status,
        action: {
          type: 'go',
          href: serviceHref(service.id, { instanceId: instance.instanceId }),
          visit: service.id,
        },
      })
    }
  }

  for (const service of services) {
    if (!matches(q, service.name, service.id) || !canToggle(service)) continue
    const running = isRunningStatus(getAttentionStatus(service))
    out.push({
      key: `action:toggle:${service.id}`,
      kind: 'action',
      label: `${running ? 'Stop' : 'Start'} ${service.name}`,
      sublabel:
        service.currentModel ??
        service.defaultModel?.name ??
        service.description,
      icon: running ? Square : Play,
      action: { type: running ? 'stop' : 'start', serviceId: service.id },
    })
    out.push({
      key: `action:logs:${service.id}`,
      kind: 'action',
      label: `Open logs for ${service.name}`,
      icon: Terminal,
      action: {
        type: 'go',
        href: serviceHref(service.id, { tab: 'logs' }),
        visit: service.id,
      },
    })
  }

  if (matches(q, ADD_SERVICE.label, 'catalog', 'new service')) {
    out.push(ADD_SERVICE)
  }

  for (const sample of samples) {
    if (!matches(q, sample.title, sample.id)) continue
    out.push({
      key: `sample:${sample.id}`,
      kind: 'sample',
      label: sample.title,
      icon: GalleryHorizontalEnd,
      action: { type: 'go', href: `/samples/${encodeURIComponent(sample.id)}` },
    })
  }

  for (const page of pages) {
    if (!matches(q, page.title, page.label)) continue
    out.push({
      key: `page:${page.href}`,
      kind: 'page',
      label: page.title,
      icon: page.icon,
      action: { type: 'go', href: page.href },
    })
  }

  return out
}
