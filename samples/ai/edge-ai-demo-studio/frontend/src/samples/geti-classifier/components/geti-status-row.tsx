// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { CheckCircle2, Server, XCircle } from 'lucide-react'
import { TONES } from '@/components/common/tones'
import { cn } from '@/lib/utils'
import type { DeployPhase, GetiConnection, GetiHealth } from '../lib/api'
import { formatModel, hostLabel } from '../lib/format'
import { PHASES } from '../lib/wizard'
import { StatusCard } from './status-card'

interface GetiStatusRowProps {
  health: GetiHealth | undefined
  isHealthLoading: boolean
  /** Both models loaded on a running worker. */
  modelReady: boolean
  connection: GetiConnection | null
}

/** The demo's status row: the pipeline, each model, and the Geti server. */
export function GetiStatusRow({
  health,
  isHealthLoading,
  modelReady,
  connection,
}: GetiStatusRowProps) {
  const bothConfigured =
    health?.cls_configured === true && health.seg_configured === true
  const pipelineTone = isHealthLoading
    ? 'muted'
    : modelReady
      ? 'success'
      : 'destructive'

  return (
    <div className="bg-muted/30 grid grid-cols-2 gap-3 rounded-xl border p-3 md:grid-cols-4">
      <StatusCard
        icon={
          isHealthLoading ? (
            <span className="bg-muted-foreground/50 h-3 w-3 animate-pulse rounded-full" />
          ) : modelReady ? (
            <CheckCircle2 className="h-4 w-4" aria-hidden />
          ) : (
            <XCircle className="h-4 w-4" aria-hidden />
          )
        }
        iconWrapClassName={TONES[pipelineTone].iconBg}
        label="Pipeline"
        value={
          isHealthLoading
            ? 'Loading...'
            : modelReady
              ? 'Ready'
              : !bothConfigured
                ? 'Not Configured'
                : 'Not Loaded'
        }
        valueClassName={TONES[pipelineTone].text}
      />
      <ModelStatus phase="seg" health={health} />
      <ModelStatus phase="cls" health={health} />
      <StatusCard
        icon={
          <Server
            className={cn('h-4 w-4', !connection && 'text-muted-foreground')}
            aria-hidden
          />
        }
        iconWrapClassName={connection ? TONES.info.iconBg : 'bg-muted'}
        label="Geti Server"
        value={connection ? hostLabel(connection.host) : 'Not connected'}
        sub={
          connection && (
            <span className="mt-0.5 flex items-center gap-1">
              <span
                aria-hidden
                className="bg-info h-1.5 w-1.5 animate-pulse rounded-full"
              />
              <span className="text-muted-foreground text-xs">Connected</span>
            </span>
          )
        }
      />
    </div>
  )
}

/** What the health says about one of the two models. */
function modelHealth(health: GetiHealth, phase: DeployPhase) {
  return phase === 'seg'
    ? {
        loaded: health.seg_model_loaded,
        name: health.seg_model_name,
        version: health.seg_model_version,
        project: health.seg_project_name,
      }
    : {
        loaded: health.cls_model_loaded,
        name: health.cls_model_name,
        version: health.cls_model_version,
        project: health.cls_project_name,
      }
}

/** One model's tile: loaded or not, which version, from which project. */
function ModelStatus({
  phase,
  health,
}: {
  phase: DeployPhase
  health: GetiHealth | undefined
}) {
  const style = PHASES[phase]
  const Icon = style.icon
  const model = health && modelHealth(health, phase)
  const loaded = model?.loaded === true

  return (
    <StatusCard
      icon={
        <Icon
          className={cn(
            'h-4 w-4',
            loaded ? style.text : 'text-muted-foreground',
          )}
          aria-hidden
        />
      }
      iconWrapClassName={loaded ? cn('border', style.surface) : 'bg-muted'}
      label={`${style.short} Model`}
      value={
        loaded && model.name
          ? formatModel(model.name, model.version)
          : 'Not loaded'
      }
      sub={
        model?.project && (
          <span className="text-muted-foreground block truncate text-xs">
            {model.project}
          </span>
        )
      }
    />
  )
}
