// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { ModelDeviceBadges } from '@/components/common/model-device-badges'
import { TruncatedText } from '@/components/common/truncated-text'
import { instanceRuntime } from '@/lib/instances/service-presentation'
import type { ServiceInstance } from '@/services/types'

/**
 * A row's address and the model / device / backend it runs. Wraps rather than hides on narrow
 * screens, since these values tell instances apart.
 */
export function InstanceMeta({ instance }: { instance: ServiceInstance }) {
  const { model, device, backend } = instanceRuntime(instance)

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5">
      <TruncatedText
        text={instance.apiBase}
        className="text-muted-foreground max-w-full font-mono text-xs"
        data-testid={`instance-address-${instance.instanceId}`}
      />
      {(model || device || backend) && (
        <span
          aria-hidden="true"
          className="bg-border hidden h-2.5 w-px sm:block"
        />
      )}
      <ModelDeviceBadges
        model={model}
        device={device}
        backend={backend}
        modelMaxWidthClass="max-w-[280px]"
      />
      {instance.instancePort != null && (
        <span className="text-muted-foreground font-mono text-xs">
          :{instance.instancePort}
        </span>
      )}
    </div>
  )
}
