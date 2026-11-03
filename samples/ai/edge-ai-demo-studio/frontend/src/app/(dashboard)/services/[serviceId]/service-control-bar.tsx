// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Layers, Loader, Plus, TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { InstanceSwitcher } from '@/components/common/instance-switcher'
import { ModelDeviceBadges } from '@/components/common/model-device-badges'
import { TruncatedText } from '@/components/common/truncated-text'
import {
  InstanceLifecycleButton,
  InstanceStatusLabel,
} from '@/components/services/instance-lifecycle'
import { NewInstanceSheet } from '@/components/services/new-instance-sheet'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  type InstanceTab,
  instanceRuntime,
  instanceSummary,
} from '@/lib/instances/service-presentation'
import { ServiceConfigureDispatch } from '@/services/common/configure/service-configure-dispatch'
import {
  useSessionBusyInstances,
  useSessionLeaveNotices,
} from '@/services/common/demo/session-store'
import type { ServiceInstance } from '@/services/types'
import { AddInstanceControl } from './add-instance-control'
import { ApiAddress } from './api-address'
import { InstanceManagerSheet } from './instance-manager'
import { InstanceMenu } from './instance-menu'
import { RestartToApply } from './restart-to-apply'

const BAR_CLASS =
  'text-foreground from-primary/10 via-primary/5 to-card flex min-h-11 flex-wrap items-center gap-x-4 gap-y-3 rounded-t-xl bg-gradient-to-r px-3 py-3 sm:px-4'

function Caption() {
  return (
    <span className="text-muted-foreground sr-only text-xs font-semibold tracking-wider uppercase sm:not-sr-only">
      Instance
    </span>
  )
}

/** Reserves the bar's height while status is unknown, and infers no action. */
function LoadingBar() {
  return (
    <div
      className={BAR_CLASS}
      role="status"
      aria-busy="true"
      data-testid="service-control-bar"
    >
      <span className="sr-only">Loading instance…</span>
      <Caption />
      <Skeleton aria-hidden="true" className="h-5 w-36" />
      <Skeleton aria-hidden="true" className="h-4 w-16" />
      <div className="ml-auto flex gap-2" aria-hidden="true">
        <Skeleton className="h-8 w-24 rounded-md" />
        <Skeleton className="h-8 w-28 rounded-md" />
      </div>
    </div>
  )
}

/** Not added: nothing runs yet, so the bar offers what makes it run. */
function NotAddedBar({
  serviceId,
  onAdded,
}: {
  serviceId: string
  onAdded: (instanceId: string) => void
}) {
  return (
    <div className={BAR_CLASS} data-testid="service-control-bar">
      <div
        className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-2"
        data-testid="service-not-added"
      >
        <Badge tone="muted" className="px-2.5">
          Not added
        </Badge>
        <span className="text-muted-foreground text-sm">
          Add the service to run it on this machine.
        </span>
        <NewInstanceSheet
          serviceType={serviceId}
          onCreated={(doc) => onAdded(doc.instanceId)}
          trigger={
            <Button
              size="sm"
              className="ml-auto gap-1.5"
              data-testid="add-service-button"
            >
              <Plus aria-hidden="true" className="h-3.5 w-3.5" />
              Add service
            </Button>
          }
        />
      </div>
    </div>
  )
}

/** Picks the instance shown; its menu ends with Manage instances. */
function InstanceSelect({
  selected,
  instances,
  onSelect,
  onManage,
}: {
  selected: ServiceInstance
  instances: ServiceInstance[]
  onSelect: (instanceId: string) => void
  onManage: () => void
}) {
  const busy = useSessionBusyInstances()
  // Something on the shown instance that switching away would cut off.
  const leaveNotice = useSessionLeaveNotices().get(selected.instanceKey)

  return (
    <InstanceSwitcher
      trigger="name"
      align="start"
      selected={selected}
      instances={instances}
      onSelect={onSelect}
      heading={instanceSummary(instances)}
      headerNote={
        leaveNotice && (
          <p
            role="note"
            className="text-warning flex items-start gap-1.5 px-2 pb-1.5 text-xs"
            data-testid="instance-leave-notice"
          >
            <TriangleAlert
              aria-hidden="true"
              className="mt-0.5 h-3 w-3 shrink-0"
            />
            {leaveNotice}
          </p>
        )
      }
      renderBadge={(instance) =>
        busy.has(instance.instanceKey) && (
          <span className="text-primary flex items-center gap-1 text-xs">
            <Loader aria-hidden="true" className="h-3 w-3 animate-spin" />
            Generating
          </span>
        )
      }
      footerAction={{
        label: 'Manage instances…',
        icon: Layers,
        onSelect: onManage,
        'data-testid': 'manage-instances-switcher-item',
      }}
    />
  )
}

/** The bar above the tabs: the shown instance, its status and its actions. */
export function ServiceControlBar({
  serviceId,
  loading,
  selected,
  instances,
  onSelect,
}: {
  serviceId: string
  loading: boolean
  selected: ServiceInstance | undefined
  instances: ServiceInstance[]
  onSelect: (instanceId: string, tab?: InstanceTab) => void
}) {
  const [managing, setManaging] = useState(false)

  if (loading) return <LoadingBar />
  if (!selected) {
    return (
      <NotAddedBar
        serviceId={serviceId}
        onAdded={(instanceId) => onSelect(instanceId, 'demo')}
      />
    )
  }

  // Deleting the shown instance shows a surviving one; deleting the last
  // leaves the page on its setup overview.
  const onDeleted = (instance: ServiceInstance) => {
    if (instance.instanceKey !== selected.instanceKey) return
    const survivor = instances.find(
      (i) => i.instanceKey !== instance.instanceKey,
    )
    onSelect(survivor?.instanceId ?? '', 'demo')
  }
  // Anything added or duplicated here opens, so the page shows what was just created.
  const openCreated = (instanceId: string) => {
    setManaging(false)
    onSelect(instanceId, 'demo')
  }
  const { model, device } = instanceRuntime(selected)

  return (
    <div className={BAR_CLASS} data-testid="service-control-bar">
      {/* On a narrow screen the actions wrap below this rather than squeezing it. */}
      <div className="flex min-w-0 flex-1 basis-72 flex-col gap-2.5">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          <Caption />
          {instances.length > 1 ? (
            <InstanceSelect
              selected={selected}
              instances={instances}
              onSelect={onSelect}
              onManage={() => setManaging(true)}
            />
          ) : (
            <TruncatedText
              text={selected.label}
              className="text-foreground max-w-[16rem] text-sm font-semibold"
              data-testid="selected-instance-name"
            />
          )}
          <div
            role="group"
            aria-label="Instances"
            className="flex shrink-0 items-center gap-1.5"
          >
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setManaging(true)}
              data-testid="instances-button"
              aria-label={`Manage instances (${instances.length})`}
              className="text-muted-foreground hover:text-foreground"
            >
              <Layers aria-hidden="true" />
              <span className="hidden sm:inline">Instances</span>
              <span className="bg-muted rounded px-1.5 text-xs tabular-nums">
                {instances.length}
              </span>
            </Button>
            <AddInstanceControl
              serviceId={serviceId}
              selected={selected}
              instances={instances}
              onCreated={openCreated}
            />
          </div>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {(model || device) && (
            <div className="contents" data-testid="service-header-badges">
              <ModelDeviceBadges
                model={model}
                device={device}
                appearance="toolbar"
                className="contents"
                modelMaxWidthClass="max-w-full sm:max-w-[28rem]"
              />
            </div>
          )}
          <ApiAddress apiBase={selected.apiBase} />
          <InstanceStatusLabel
            instance={selected}
            testId="workload-status"
            appearance="badge"
          />
          <RestartToApply instance={selected} />
        </div>
      </div>

      <div
        role="group"
        aria-label={`Actions for ${selected.label}`}
        className="ml-auto flex shrink-0 items-center gap-2"
      >
        <ServiceConfigureDispatch serviceId={selected.instanceKey} />
        <InstanceLifecycleButton
          instance={selected}
          testId="selected-instance-toggle"
        />
        <InstanceMenu
          instance={selected}
          siblings={instances}
          onDuplicated={openCreated}
          onDeleted={() => onDeleted(selected)}
          onManage={() => setManaging(true)}
        />
      </div>

      <InstanceManagerSheet
        serviceType={serviceId}
        open={managing}
        onOpenChange={setManaging}
        shownInstanceKey={selected.instanceKey}
        onOpen={onSelect}
        onCreated={openCreated}
        onDeleted={onDeleted}
      />
    </div>
  )
}
