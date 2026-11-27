// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client';

import { useState } from 'react';

import { type RuntimeFile, usePhysics } from '@mujoco-studio/mujoco';
import type { PickPlaceTaskV1, PoseRandomizationRuleV1 } from '@mujoco-studio/types';
import { Button, cn, PanelBody, PanelHeader, useNotice } from '@mujoco-studio/ui';
import { LoaderCircle } from 'lucide-react';
import { backdropNotReady } from '@/lib/editor/backdropProfile';
import { generationSessionProfile } from '@/lib/teleoperation/profile';

import {
  fingerprint,
  readInputConventionPreference,
  saveInputConventionPreference,
  statusTone,
} from './generationPanelUtils';
import { ToggleSwitch } from './ToggleSwitch';
import { CopyButton } from './VirtualSo101Panel';
import { useEvaluationRuntime } from '@/components/evaluation/EvaluationRuntimeProvider';
import { RequestError } from '@/lib/http/requestError';
import { noticeFromError } from '@/lib/notices';
import { isSessionBusyError } from '@/lib/teleoperation/sessionBusy';
import { exportSceneArchive } from '@/lib/scenes/sceneArchive';
import { sceneBackdropBodyName } from '@/lib/generation/modelRandomizationPresets';

interface ExternalControlPanelProps {
  sceneId?: number;
  sceneName: string;
  sceneXml: string;
  runtimeFiles: readonly RuntimeFile[];
  showHeader?: boolean;
  /** Optional pick-place check and object randomization sent with the profile at start. */
  taskProfile?: { task?: PickPlaceTaskV1; randomization: PoseRandomizationRuleV1[] };
  /** Why the configured task cannot run; blocks starting until it is fixed. */
  taskProblem?: string | null;
}

const SO101_JOINTS = ['shoulder_pan', 'shoulder_lift', 'elbow_flex', 'wrist_flex', 'wrist_roll'];

function isSo101Joint(name: string): boolean {
  return SO101_JOINTS.some((joint) => name === joint || name.endsWith(`__${joint}`));
}

export function ExternalControlPanel({
  sceneId,
  sceneName,
  sceneXml,
  runtimeFiles,
  showHeader = true,
  taskProfile,
  taskProblem,
}: ExternalControlPanelProps) {
  const { getSimulation } = usePhysics();
  const {
    status,
    streaming,
    session,
    error: runtimeError,
    startStreaming,
    stopStreaming,
  } = useEvaluationRuntime();
  const showNotice = useNotice();
  // Another scene's session is in use: say what starting here ends, and offer to end it.
  const [busyWarning, setBusyWarning] = useState<string | null>(null);
  const connecting = status === 'starting' || status === 'connecting';

  const blockStart = (message: string, hint?: string) =>
    showNotice({ tone: 'warning', title: 'Cannot start streaming', message, hint });

  const start = async (replaceBusy = false) => {
    if (streaming || connecting) return;
    setBusyWarning(null);
    if (taskProblem) {
      blockStart(taskProblem, 'Fix the task below, or turn it off, then start again.');
      return;
    }
    const simulation = getSimulation();
    if (!simulation) {
      blockStart('Wait for the scene to finish loading before starting.');
      return;
    }
    const backdropProblem = backdropNotReady(sceneBackdropBodyName(sceneXml), runtimeFiles);
    if (backdropProblem) {
      blockStart(backdropProblem);
      return;
    }
    // Scenes with an SO-101 arm stream in SO-101 normalized units (what LeRobot apps and the
    // virtual follower expect); any other robot streams in its scene-native units.
    let template: ReturnType<typeof simulation.evaluationProfileTemplate>;
    try {
      template = simulation.evaluationProfileTemplate('runtime-policy', 'raw');
      if (template.state.some((field) => isSo101Joint(field.name))) {
        template = simulation.evaluationProfileTemplate(
          'runtime-policy',
          readInputConventionPreference(String(sceneId ?? 'new')),
        );
      }
    } catch (reason) {
      blockStart(
        reason instanceof Error ? reason.message : 'The scene cannot be controlled externally.',
        'Add an actuated robot from the Robots panel and save the scene, then start again.',
      );
      return;
    }
    if (template.action.length === 0) {
      blockStart(
        'This scene has no actuators, so an external app has nothing to control.',
        'Add an actuated robot from the Robots panel and save the scene, then start again.',
      );
      return;
    }
    try {
      const sceneFingerprint = await fingerprint(sceneXml, runtimeFiles);
      if (!sceneId) {
        blockStart('Save the scene before starting the shared stream.');
        return;
      }
      saveInputConventionPreference(String(sceneId), template.inputConvention);
      const profile = {
        ...generationSessionProfile({
          sceneName,
          sceneId,
          sceneFingerprint,
          template,
          runtimeFiles,
          backdropBody: sceneBackdropBodyName(sceneXml),
        }),
        actionRangePolicy: 'clip' as const,
        randomization: [],
        ...taskProfile,
      };
      const archive = await exportSceneArchive(sceneXml, 'evaluate', runtimeFiles);
      const form = new FormData();
      form.append('sceneBundle', new File([archive], 'scene.mujoco-scene'));
      form.append('profile', JSON.stringify(profile));
      await startStreaming(form, { replaceBusy });
    } catch (reason) {
      if (isSessionBusyError(reason)) {
        setBusyWarning(reason.message);
        return;
      }
      const sceneChanged =
        reason instanceof Error && reason.message.startsWith('The scene changed while');
      showNotice(
        sceneChanged
          ? {
              tone: 'warning',
              title: 'Streaming not started',
              message: reason.message,
              hint: 'Start streaming again once the scene has finished loading.',
            }
          : noticeFromError(
              'Streaming not started',
              reason,
              'Could not start the streaming worker.',
              reason instanceof RequestError && reason.detailsLabel === 'Worker log'
                ? 'The worker log above shows why the native worker stopped. The first start installs Python dependencies with uv; retry once that finishes.'
                : undefined,
            ),
      );
    }
  };

  const stop = async () => {
    try {
      await stopStreaming();
    } catch (reason) {
      showNotice(
        noticeFromError('Streaming not stopped', reason, 'The shared stream could not stop.'),
      );
    }
  };

  const statusLabel = streamingStatusLabel(status, streaming, connecting);
  // Worker start-up errors append log lines; inline we show only the summary (the dialog lists
  // the log). Stream errors raised while running stay here because they have no triggering click.
  const runtimeErrorSummary = runtimeError?.split('\n', 1)[0] ?? null;
  const locked = streaming || connecting;
  const studioUrl = typeof window === 'undefined' ? '' : window.location.origin;

  return (
    <section className={cn('w-full', showHeader && 'border-t border-border')}>
      {showHeader && (
        <PanelHeader
          title="External control"
          actions={
            <span className={cn('text-[10px] uppercase tracking-[0.12em]', statusTone(status))}>
              {statusLabel}
            </span>
          }
        />
      )}
      <PanelBody className={showHeader ? 'p-3' : 'p-0'}>
        <div className={cn('w-full min-w-0 space-y-3', !showHeader && 'px-3 pb-3')}>
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[11px] font-medium text-foreground">Stream to external app</p>
              <span
                role="status"
                aria-label="Control status"
                aria-live="polite"
                className={cn(
                  'flex items-center gap-1 text-[10px] uppercase tracking-[0.12em]',
                  statusTone(status),
                )}
              >
                {connecting && <LoaderCircle className="size-3 animate-spin" />}
                {statusLabel}
              </span>
            </div>
            <ToggleSwitch
              checked={locked}
              label="Stream to external app"
              onToggle={() => void (locked ? stop() : start())}
              title="Runs the scene's physics in a native worker that Python SDK apps connect to"
            />
          </div>
          {session && streaming && (
            <dl className="space-y-1 text-[10px]" aria-label="Connection details">
              <div className="flex items-center justify-between gap-2">
                <dt className="text-muted">Studio URL</dt>
                <dd className="flex min-w-0 items-center gap-1">
                  <code className="truncate text-foreground" title={studioUrl}>
                    {studioUrl}
                  </code>
                  <CopyButton label="Copy Studio URL" value={studioUrl} />
                </dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="text-muted">Units</dt>
                <dd className="text-foreground">{unitsLabel(session.profile)}</dd>
              </div>
            </dl>
          )}
          {busyWarning && !locked && (
            <div className="flex items-start justify-between gap-2" role="alert">
              <p className="text-[10px] leading-relaxed text-warning">{busyWarning}</p>
              <Button
                className="h-6 shrink-0 px-1.5 text-[10px]"
                onClick={() => void start(true)}
                size="sm"
                type="button"
                variant="outline"
              >
                End it and start here
              </Button>
            </div>
          )}
          {runtimeErrorSummary && (
            <p className="text-[11px] leading-relaxed text-danger">{runtimeErrorSummary}</p>
          )}
        </div>
      </PanelBody>
    </section>
  );
}

function streamingStatusLabel(
  status: ReturnType<typeof useEvaluationRuntime>['status'],
  streaming: boolean,
  connecting: boolean,
): string {
  if (connecting) return 'Connecting';
  if (streaming) return status === 'connected' ? 'Connected' : 'Reconnecting';
  return status === 'error' ? 'Stopped with error' : 'Not streaming';
}

function unitsLabel(profile: Record<string, unknown>): string {
  const fields = [profile.state, profile.action].flatMap((value) =>
    Array.isArray(value) ? value : [],
  );
  return fields.some(
    (field) =>
      typeof field === 'object' &&
      field !== null &&
      'unit' in field &&
      field.unit === 'so101-normalized',
  )
    ? 'SO-101 normalized'
    : 'Scene-native';
}
