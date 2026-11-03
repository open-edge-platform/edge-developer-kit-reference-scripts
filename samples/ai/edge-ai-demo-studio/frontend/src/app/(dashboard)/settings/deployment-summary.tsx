// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { CirclePause, CirclePlay } from 'lucide-react'
import { TruncatedText } from '@/components/common/truncated-text'
import { Badge } from '@/components/ui/badge'
import { plural } from '@/lib/browser/format'
import type { DeploymentSnapshotConfig } from '@/lib/deployment/deployment-snapshot'
import { getEngineOptionsMap } from '@/services/config-registry'
import { getServiceById } from '@/services/registry'

interface InstanceSummary {
  /** `<type>/<label>`: names are unique per service, so this names one instance. */
  key: string
  label: string
  model?: string
  device?: string
  /** The engine's name, saved only for services that can run on more than one. */
  engine?: string
  /** Saved as `online`: started at every app start. */
  autostart: boolean
}

interface ServiceSummary {
  type: string
  name: string
  instances: InstanceSummary[]
}

export interface DeploymentSummary {
  services: ServiceSummary[]
  instanceCount: number
  autostartCount: number
}

/** The file's `services` map as people read it: instances per service. */
export function summarizeDeployment(
  services: DeploymentSnapshotConfig['services'],
): DeploymentSummary {
  const engineNames = new Map<string, string>(
    getEngineOptionsMap().map((option) => [option.value, option.label]),
  )
  const summary = Object.entries(services).map(([type, instances]) => {
    const name = getServiceById(type)?.name ?? type
    return {
      type,
      name,
      instances: instances.map((instance, i): InstanceSummary => {
        // The primary model; a service with only other model slots shows its first.
        const model =
          instance.models?.default ?? Object.values(instance.models ?? {})[0]
        const label = instance.label ?? name
        return {
          key: `${type}/${instance.label ?? i}`,
          label,
          model: model?.name,
          device: model?.device,
          engine: instance.engine
            ? (engineNames.get(instance.engine) ?? instance.engine)
            : undefined,
          autostart: instance.status === 'online',
        }
      }),
    }
  })
  const all = summary.flatMap((service) => service.instances)
  return {
    services: summary,
    instanceCount: all.length,
    autostartCount: all.filter((instance) => instance.autostart).length,
  }
}

/** Instance by instance: what the file sets up, and what starts on its own. */
export function DeploymentSummaryList({
  summary,
}: {
  summary: DeploymentSummary
}) {
  return (
    <ul className="space-y-3" data-testid="deployment-summary">
      {summary.services.map((service) => (
        <li
          key={service.type}
          className="border-border/70 bg-muted/20 rounded-lg border p-3"
          data-testid="deployment-service"
          data-service={service.type}
        >
          <p className="text-foreground text-sm font-medium">
            {service.name}{' '}
            <span className="text-muted-foreground text-xs font-normal">
              · {plural(service.instances.length, 'instance')}
            </span>
          </p>
          <ul className="mt-2 space-y-2">
            {service.instances.map((instance) => (
              <li
                key={instance.key}
                className="flex flex-wrap items-center gap-x-3 gap-y-1"
                data-testid="deployment-instance"
                data-entry={instance.key}
                data-autostart={instance.autostart}
              >
                <TruncatedText
                  text={instance.label}
                  className="text-foreground max-w-full min-w-0 flex-1 basis-32 text-sm"
                />
                {/* Only the model name may be cut; device and engine always show. */}
                <span className="text-muted-foreground flex max-w-full min-w-0 flex-[2] basis-56 items-center gap-1.5 text-xs">
                  <TruncatedText
                    text={instance.model ?? 'No model'}
                    className="min-w-0 font-mono"
                  />
                  {[instance.device, instance.engine]
                    .filter(Boolean)
                    .map((detail) => (
                      <span key={detail} className="shrink-0">
                        · {detail}
                      </span>
                    ))}
                </span>
                {instance.autostart ? (
                  <Badge
                    tone="success"
                    data-testid="deployment-autostart-entry"
                    data-entry={instance.key}
                  >
                    <CirclePlay aria-hidden="true" />
                    Starts automatically
                  </Badge>
                ) : (
                  <Badge tone="muted">
                    <CirclePause aria-hidden="true" />
                    Stays stopped
                  </Badge>
                )}
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  )
}
