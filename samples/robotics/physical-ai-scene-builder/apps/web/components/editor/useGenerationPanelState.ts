// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { RuntimeFile, Simulation } from '@mujoco-studio/mujoco';
import { usePhysics } from '@mujoco-studio/mujoco';
import {
  type ModelRandomizationRuleV1,
  type TeleoperationProfileV1,
  type TeleoperationRobotRandomizationV1,
  type TeleoperationSourceRandomizationV1,
  type TeleoperationStateSnapshotV1,
} from '@mujoco-studio/types';
import { useNotice } from '@mujoco-studio/ui';
import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';

import {
  defaultExtraObject,
  type ExtraObjectSettings,
  MAX_EXTRA_OBJECTS,
  useGenerationSettings,
} from '@/lib/generation/generationSettings';
import { sourceRandomizationFromSettings } from '@/lib/generation/sourceRandomization';
import {
  type ModelRandomizationPreset,
  modelRandomizationPresetRules,
  parseCustomModelRules,
  sceneBackdropBodyName,
  sceneLightAndCameraNames,
} from '@/lib/generation/modelRandomizationPresets';
import { findSceneGenerationCandidates } from '@/lib/generation/sceneCandidates';
import { requestError } from '@/lib/http/requestError';
import { noticeFromError } from '@/lib/notices';
import { exportSceneArchive } from '@/lib/scenes/sceneArchive';
import {
  BACKDROP_LIVE_RENDER_BUDGET_MS,
  backdropRenderNote,
  readBackdropRenderProgress,
} from '@/lib/teleoperation/backdropRender';
import { backdropNotReady } from '@/lib/editor/backdropProfile';
import { isSessionBusyError } from '@/lib/teleoperation/sessionBusy';
import { generationSessionProfile, teleoperationProfilesMatch } from '@/lib/teleoperation/profile';
import { useTeleoperationRuntime } from '../teleoperation/TeleoperationRuntimeProvider';
import {
  clampSceneCount,
  sceneCountHint,
  fingerprint,
  numberValue,
  preferredSourceBody,
  rangeError,
  responseFilename,
  sourceBodiesFromXml,
  statusTone,
  useInputConventionPreference,
  type RangeFields,
} from './generationPanelUtils';

export interface UseGenerationPanelStateArgs {
  sceneId?: number;
  sceneName: string;
  sceneXml: string;
  runtimeFiles: readonly RuntimeFile[];
  ready: boolean;
  documentDirty: boolean;
  selectedSourceBody?: string;
}

/**
 * A batch (started from `generate_dataset.py --workers` or the REST API) occupies the Generate
 * worker and its collection while running or cancelling.
 */
function isBatchActive(batch: { status: string } | null | undefined): boolean {
  return batch?.status === 'running' || batch?.status === 'cancelling';
}

/**
 * Encapsulates Generate panel session/template matching, scene-randomization state, and the
 * scene-generation, streaming, and control-examples action handlers. Kept separate from
 * GenerationPanel.tsx so that file only has to own layout and composition.
 */
export function useGenerationPanelState({
  sceneId,
  sceneName,
  sceneXml,
  runtimeFiles,
  ready,
  documentDirty,
  selectedSourceBody,
}: UseGenerationPanelStateArgs) {
  const { getSimulation } = usePhysics();
  const {
    appendState,
    deleteState,
    error: runtimeError,
    lastMessageAt,
    prepareSession,
    selectState,
    session,
    snapshot,
    startStream,
    status,
    stopStream,
    streaming,
  } = useTeleoperationRuntime();
  const showNotice = useNotice();
  const [busy, setBusy] = useState(false);
  const [sceneCount, setSceneCount] = useState(1);
  const [generationProgress, setGenerationProgress] = useState<string | null>(null);
  const stopGenerationRef = useRef(false);
  const [startingWorker, setStartingWorker] = useState(false);
  // Success messages sit next to the controls that produced them (the accordion shows one section
  // at a time). Failures of user actions open a notice dialog. Background session preparation
  // reports inline instead, and a failure is remembered for the inputs that caused it so the
  // effect does not retry (and flicker) forever; the user retries explicitly, or by changing the
  // scene, control units, or randomized object.
  const [generationMessage, setGenerationMessage] = useState<string | null>(null);
  const [preparationFailure, setPreparationFailure] = useState<{
    key: string;
    message: string;
    /** Another session is in use; the user can end it and start here. */
    busy?: boolean;
  } | null>(null);
  // Set by "End it and start here": the next preparation may end a session that is in use.
  const replaceBusyRef = useRef(false);
  const [streamingMessage, setStreamingMessage] = useState<string | null>(null);
  const [deleteStateDialogOpen, setDeleteStateDialogOpen] = useState(false);
  const [deleteStateTarget, setDeleteStateTarget] = useState<Pick<
    TeleoperationStateSnapshotV1,
    'stateId' | 'label'
  > | null>(null);
  const sceneKey = String(sceneId ?? 'new');
  // Randomization settings are kept per scene, so leaving Generate or editing the scene keeps them.
  const [settings, updateSettings] = useGenerationSettings(sceneKey);
  const { xRange, yRange, yawRange, robotRange, modelPreset, customModelRulesText } = settings;
  const setXRange = (value: RangeFields) => updateSettings({ xRange: value });
  const setYRange = (value: RangeFields) => updateSettings({ yRange: value });
  const setYawRange = (value: RangeFields) => updateSettings({ yawRange: value });
  const setRobotRange = (value: RangeFields) => updateSettings({ robotRange: value });
  const setModelPreset = (value: ModelRandomizationPreset) =>
    updateSettings({ modelPreset: value });
  const setCustomModelRulesText = (value: string) =>
    updateSettings({ customModelRulesText: value });
  const setExtraObjects = (value: ExtraObjectSettings[]) => updateSettings({ extraObjects: value });
  // Fingerprint of the scene as shown; a session for another fingerprint is for an earlier version.
  const [currentFingerprint, setCurrentFingerprint] = useState<{
    xml: string;
    files: readonly RuntimeFile[];
    value: string;
  } | null>(null);
  const sceneFingerprint =
    currentFingerprint &&
    currentFingerprint.xml === sceneXml &&
    currentFingerprint.files === runtimeFiles
      ? currentFingerprint.value
      : null;
  useEffect(() => {
    let cancelled = false;
    fingerprint(sceneXml, runtimeFiles).then((value) => {
      if (!cancelled) setCurrentFingerprint({ xml: sceneXml, files: runtimeFiles, value });
    });
    return () => {
      cancelled = true;
    };
  }, [runtimeFiles, sceneXml]);
  const [inputConvention, setInputConvention, inputConventionReady] =
    useInputConventionPreference(sceneKey);
  const sessionStartSceneRef = useRef<number | null>(null);

  const sourceBodies = useMemo(() => sourceBodiesFromXml(sceneXml), [sceneXml]);
  const movableSourceBodies = sourceBodies.filter((source) => source.movable);
  const activeSourceBody =
    movableSourceBodies.find((source) => source.body === selectedSourceBody)?.body ??
    preferredSourceBody(movableSourceBodies);
  // Extra objects must still exist, be movable, and not be the main object.
  const extraObjects = settings.extraObjects.filter(
    (object) =>
      object.body !== activeSourceBody &&
      movableSourceBodies.some((source) => source.body === object.body),
  );
  const addableSourceBodies = movableSourceBodies.filter(
    (source) =>
      source.body !== activeSourceBody &&
      !extraObjects.some((object) => object.body === source.body),
  );
  const addExtraObject = (body: string) => {
    if (extraObjects.length >= MAX_EXTRA_OBJECTS) return;
    setExtraObjects([...extraObjects, defaultExtraObject(body)]);
  };
  const updateExtraObject = (body: string, changes: Partial<ExtraObjectSettings>) =>
    setExtraObjects(
      extraObjects.map((object) => (object.body === body ? { ...object, ...changes } : object)),
    );
  const removeExtraObject = (body: string) =>
    setExtraObjects(extraObjects.filter((object) => object.body !== body));
  const preparationKey = `${sceneId ?? ''}|${inputConvention}|${activeSourceBody ?? ''}|${sceneXml}`;
  const currentFailure = preparationFailure?.key === preparationKey ? preparationFailure : null;
  const generationError = currentFailure && !currentFailure.busy ? currentFailure.message : null;
  const busySessionWarning = currentFailure?.busy ? currentFailure.message : null;
  const sceneStates = session?.states ?? [];
  const generatedStateCount = sceneStates.filter((state) => state.index > 0).length;
  const generatedCountHint = sceneCountHint(generatedStateCount);
  const activeState = session?.states.find((state) => state.stateId === session.activeStateId);
  const isRecording =
    session?.recording === 'recording' || snapshot?.header.recording === 'recording';
  // While a batch runs the worker rejects interactive commands, and stopping the stream would
  // restore the selected state underneath the pool, so interactive controls are disabled.
  const batchActive = isBatchActive(session?.batch);
  const xError = rangeError('X', xRange);
  const yError = rangeError('Y', yRange);
  const yawError = rangeError('Yaw', yawRange);
  const robotError = rangeError('Robot joints', robotRange);
  const extraObjectError =
    extraObjects
      .filter((object) => !object.shareZone)
      .flatMap((object) => [
        rangeError(`${object.body} X`, object.xRange),
        rangeError(`${object.body} Y`, object.yRange),
        rangeError(`${object.body} yaw`, object.yawRange),
      ])
      .find((error) => error !== null) ?? null;
  // The profile is derived from the scene during render. A scene the chosen control units cannot
  // map (for example no SO-101 arm with SO-101 normalized units) must not crash the editor, so the
  // reason is reported as a Generate precondition instead.
  let template: ReturnType<Simulation['evaluationProfileTemplate']> | undefined;
  let templateError: string | null = null;
  try {
    template = getSimulation()?.evaluationProfileTemplate('teleoperation', inputConvention);
  } catch (reason) {
    templateError =
      reason instanceof Error ? reason.message : 'This scene cannot be used for generation.';
  }
  if (template && template.action.length === 0) {
    template = undefined;
    templateError = 'This scene has no actuators, so there is no robot to demonstrate with.';
  }
  const sceneTargets = useMemo(() => {
    const candidates = findSceneGenerationCandidates(sceneXml);
    return {
      bodies: candidates.destinationBodies.map((body) => body.body),
      lights: sceneLightAndCameraNames(sceneXml).lights,
      backdrop: sceneBackdropBodyName(sceneXml),
    };
  }, [sceneXml]);
  const customModelRules = useMemo(
    () => (modelPreset === 'custom' ? parseCustomModelRules(customModelRulesText) : null),
    [customModelRulesText, modelPreset],
  );
  const modelRulesError =
    customModelRules && !customModelRules.ok
      ? `Model randomization rules: ${customModelRules.error}`
      : null;
  const randomizationError =
    xError ?? yError ?? yawError ?? robotError ?? extraObjectError ?? modelRulesError;
  const sessionMatchesTemplate = Boolean(
    session &&
    sceneId &&
    template &&
    sceneFingerprint !== null &&
    session.sceneFingerprint === sceneFingerprint &&
    teleoperationProfilesMatch(
      session.profile,
      generationSessionProfile({
        sceneName,
        sceneId,
        sceneFingerprint,
        template,
        runtimeFiles,
        backdropBody: sceneTargets.backdrop,
      }),
    ),
  );
  const canGenerate = Boolean(
    ready &&
    inputConventionReady &&
    sceneId &&
    !documentDirty &&
    !isRecording &&
    !batchActive &&
    !busy &&
    activeSourceBody &&
    template &&
    !randomizationError,
  );
  const canStartStreaming = Boolean(
    ready &&
    inputConventionReady &&
    sceneId &&
    !documentDirty &&
    !busy &&
    !batchActive &&
    session &&
    sessionMatchesTemplate &&
    !streaming &&
    template,
  );
  const canStopStreaming = Boolean(session && !busy && !batchActive && streaming);
  const canResetEnvironment = Boolean(
    session && sessionMatchesTemplate && activeState && !isRecording && !batchActive && !busy,
  );
  const canDownloadControlExamples = Boolean(session && sessionMatchesTemplate && !isRecording);
  const controlExamplesUrl = session
    ? `/api/teleoperation/sessions/${encodeURIComponent(session.sessionId)}/download`
    : '';

  function randomization(): TeleoperationSourceRandomizationV1 {
    return sourceRandomizationFromSettings(
      { ...settings, extraObjects },
      activeSourceBody,
      movableSourceBodies,
    );
  }

  function robotRandomization(): TeleoperationRobotRandomizationV1 | undefined {
    const degrees: [number, number] = [numberValue(robotRange.min), numberValue(robotRange.max)];
    return degrees[0] === 0 && degrees[1] === 0 ? undefined : { enabled: true, degrees };
  }

  function modelRules(): ModelRandomizationRuleV1[] {
    if (modelPreset === 'custom') return customModelRules?.ok ? customModelRules.rules : [];
    return modelRandomizationPresetRules(modelPreset, {
      bodies: sceneTargets.bodies,
      sourceBodies: activeSourceBody ? [activeSourceBody] : [],
      lights: sceneTargets.lights,
      cameras: template?.cameras.map((camera) => camera.camera) ?? [],
      // Only when the backdrop is actually rendered for this session.
      backdrop: runtimeFiles.some((file) => file.kind === 'splat') ? sceneTargets.backdrop : null,
    });
  }

  async function ensureSession(): Promise<void> {
    if (!sceneId || !template) throw new Error('Save and compile the scene before generating.');
    const backdropProblem = backdropNotReady(sceneTargets.backdrop, runtimeFiles);
    if (backdropProblem) throw new Error(backdropProblem);
    const sceneFingerprint = await fingerprint(sceneXml, runtimeFiles);
    const profile: TeleoperationProfileV1 = {
      ...generationSessionProfile({
        sceneName,
        sceneId,
        sceneFingerprint,
        template,
        runtimeFiles,
        backdropBody: sceneTargets.backdrop,
      }),
    };
    if (profile.backdrop) {
      // Interactive recordings render the backdrop live until a frame exceeds one capture frame,
      // then render the rest of that recording when it is saved.
      profile.backdropRenderBudget = { maxFrameTimeMs: BACKDROP_LIVE_RENDER_BUDGET_MS };
    }
    if (session && teleoperationProfilesMatch(session.profile, profile)) return;
    const archive = await exportSceneArchive(sceneXml, `${sceneName}-teleoperation`, runtimeFiles);
    const form = new FormData();
    form.append('sceneBundle', new File([archive], `${sceneName}.mujoco-scene`));
    form.append('profile', JSON.stringify(profile));
    setStartingWorker(true);
    const replaceBusy = replaceBusyRef.current;
    replaceBusyRef.current = false;
    try {
      await prepareSession(form, { replaceBusy });
    } finally {
      setStartingWorker(false);
    }
  }

  const hydrateSession = useEffectEvent(() => {
    if (
      !sceneId ||
      !ready ||
      !inputConventionReady ||
      documentDirty ||
      busy ||
      !template ||
      sceneFingerprint === null ||
      sessionMatchesTemplate ||
      currentFailure ||
      isRecording ||
      batchActive ||
      (!session && sessionStartSceneRef.current === sceneId) ||
      // A scanned room still loading: prepare once it has (runtimeFiles changes), not fail now.
      backdropNotReady(sceneTargets.backdrop, runtimeFiles) !== null
    ) {
      return;
    }
    const key = preparationKey;
    sessionStartSceneRef.current = sceneId;
    // The saved scene changed under a running stream: restart it on the edited scene instead of
    // leaving the native worker running the earlier version.
    const restartStreaming = Boolean(session && streaming);
    setBusy(true);
    (async () => {
      if (restartStreaming) await stopStream();
      await ensureSession();
      if (restartStreaming) {
        await startStream();
        setStreamingMessage('Streaming restarted with the edited scene.');
      }
    })()
      .then(() => setPreparationFailure(null))
      .catch((reason: unknown) => {
        sessionStartSceneRef.current = null;
        setPreparationFailure({
          key,
          message:
            reason instanceof Error ? reason.message : 'Generated scenes could not be loaded.',
          busy: isSessionBusyError(reason),
        });
      })
      .finally(() => setBusy(false));
  });

  function retryPreparation(): void {
    setPreparationFailure(null);
  }

  function replaceBusySession(): void {
    replaceBusyRef.current = true;
    setPreparationFailure(null);
  }

  useEffect(() => {
    hydrateSession();
  }, [
    activeSourceBody,
    batchActive,
    busy,
    documentDirty,
    isRecording,
    sceneFingerprint,
    ready,
    inputConventionReady,
    sceneId,
    session,
    sessionMatchesTemplate,
    streaming,
    template,
    currentFailure,
    runtimeFiles,
  ]);

  async function generateScene(): Promise<void> {
    if (!canGenerate) return;
    const count = clampSceneCount(sceneCount);
    setBusy(true);
    setGenerationMessage(null);
    stopGenerationRef.current = false;
    let generated = 0;
    try {
      const sourceRandomization = randomization();
      await ensureSession();
      setPreparationFailure(null);
      let label = '';
      for (; generated < count && !stopGenerationRef.current; generated++) {
        if (count > 1) setGenerationProgress(`${generated + 1}/${count}`);
        const seed = Number.parseInt(crypto.randomUUID().slice(0, 8), 16);
        const state = await appendState(
          seed,
          sourceRandomization,
          modelRules(),
          robotRandomization(),
        );
        label = state.label;
      }
      setGenerationMessage(
        count === 1
          ? `${label} generated and shown in the viewport.`
          : `${generated} scene${generated === 1 ? '' : 's'} generated${
              generated < count ? ' (stopped)' : ''
            }; ${label} is shown in the viewport.`,
      );
    } catch (reason) {
      if (isSessionBusyError(reason)) {
        setPreparationFailure({ key: preparationKey, message: reason.message, busy: true });
        return;
      }
      if (generated > 0) setGenerationMessage(`${generated} of ${count} scenes generated.`);
      showNotice(
        noticeFromError(
          'Scene not generated',
          reason,
          'The scene could not be generated.',
          'Check the randomization settings and try again.',
        ),
      );
    } finally {
      setGenerationProgress(null);
      setBusy(false);
    }
  }

  function stopGeneratingScenes(): void {
    stopGenerationRef.current = true;
  }

  function beginDeleteState(target: Pick<TeleoperationStateSnapshotV1, 'stateId' | 'label'>): void {
    setDeleteStateTarget(target);
    setDeleteStateDialogOpen(true);
  }

  function cancelDeleteState(): void {
    if (busy) return;
    setDeleteStateDialogOpen(false);
    setDeleteStateTarget(null);
  }

  async function removeGeneratedScene(): Promise<void> {
    const target = deleteStateTarget;
    if (!target || busy) return;
    setBusy(true);
    setGenerationMessage(null);
    try {
      await deleteState(target.stateId);
      setDeleteStateDialogOpen(false);
      setDeleteStateTarget(null);
      setGenerationMessage('Generated scene deleted.');
    } catch (reason) {
      showNotice(
        noticeFromError(
          'Generated scene not deleted',
          reason,
          'The generated scene could not be deleted.',
        ),
      );
    } finally {
      setBusy(false);
    }
  }

  async function runGenerationAction(
    action: () => Promise<unknown>,
    outcome: {
      success: string;
      failureTitle: string;
      setMessage: (message: string | null) => void;
    },
  ): Promise<void> {
    setBusy(true);
    setGenerationMessage(null);
    setStreamingMessage(null);
    try {
      await action();
      outcome.setMessage(outcome.success);
    } catch (reason) {
      showNotice(noticeFromError(outcome.failureTitle, reason, 'The scene action failed.'));
    } finally {
      setBusy(false);
    }
  }

  async function selectGeneratedScene(stateId: string): Promise<void> {
    await runGenerationAction(() => selectState(stateId), {
      success: 'Generated scene shown in the viewport.',
      failureTitle: 'Generated scene not shown',
      setMessage: setGenerationMessage,
    });
  }

  async function resetEnvironment(): Promise<void> {
    await runGenerationAction(() => selectState(activeState?.stateId ?? ''), {
      success: 'Environment reset to its initial state.',
      failureTitle: 'Environment not reset',
      setMessage: setStreamingMessage,
    });
  }

  async function toggleStreaming(): Promise<void> {
    await runGenerationAction(streaming ? stopStream : startStream, {
      success: streaming ? 'Streaming stopped.' : 'Streaming started.',
      failureTitle: streaming ? 'Streaming not stopped' : 'Streaming not started',
      setMessage: setStreamingMessage,
    });
  }

  async function downloadControlExamples(): Promise<void> {
    if (!canDownloadControlExamples || !controlExamplesUrl || busy) return;
    setBusy(true);
    setStreamingMessage(null);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 2 * 60 * 1_000);
    try {
      const response = await fetch(controlExamplesUrl, {
        cache: 'no-store',
        signal: controller.signal,
      });
      if (!response.ok) {
        throw await requestError(response, 'The control examples could not be downloaded.');
      }
      const contentType = response.headers
        .get('content-type')
        ?.split(';', 1)[0]
        .trim()
        .toLowerCase();
      if (contentType !== 'application/zip') {
        throw contentType === 'application/json'
          ? await requestError(response, 'The control examples could not be downloaded.')
          : new Error('The control examples response was not a ZIP archive.');
      }
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = responseFilename(response);
      anchor.style.display = 'none';
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
      setStreamingMessage('Control examples downloaded.');
    } catch (reason) {
      showNotice(
        noticeFromError(
          'Control examples not downloaded',
          controller.signal.aborted
            ? new Error('The control examples download timed out after 2 minutes.')
            : reason,
          'The control examples could not be downloaded.',
          controller.signal.aborted ? 'Check that the server is responsive and retry.' : undefined,
        ),
      );
    } finally {
      window.clearTimeout(timeout);
      setBusy(false);
    }
  }

  const sceneSummary =
    generatedStateCount === 0
      ? 'Original scene'
      : `${generatedStateCount} generated scene${generatedStateCount === 1 ? '' : 's'}`;
  const captureStatusLabel = isRecording
    ? 'Client recording'
    : !session && status === 'error'
      ? 'Stream unavailable'
      : startingWorker || (!session && status === 'starting')
        ? 'Preparing'
        : !session
          ? 'Not ready'
          : !streaming
            ? 'Stopped'
            : status === 'error' || status === 'stale'
              ? 'Stream unavailable'
              : status === 'starting' || status === 'connecting'
                ? 'Connecting'
                : 'Streaming';
  const captureStatusTone =
    status === 'error' || (streaming && status === 'stale')
      ? 'text-danger'
      : isRecording || (streaming && status === 'connected')
        ? 'text-success'
        : statusTone(status);
  const captureSummary = isRecording
    ? `Client recording - ${activeState?.label ?? 'generated scene'}`
    : captureStatusLabel;
  // The stream reports render progress live; the summary covers a stopped stream.
  const streamBackdropProgress = readBackdropRenderProgress(snapshot?.header);
  const backdropNote = backdropRenderNote(
    streamBackdropProgress.backdropRenderStatus
      ? streamBackdropProgress
      : (session?.pendingRecording ?? session ?? {}),
  );
  const episodeCount = session?.episodes.length ?? 0;
  const episodeSummary = `${episodeCount} recorded episode${episodeCount === 1 ? '' : 's'}`;

  return {
    movableSourceBodies,
    activeSourceBody,
    extraObjects,
    addableSourceBodies,
    addExtraObject,
    updateExtraObject,
    removeExtraObject,
    extraObjectError,
    sceneStates,
    session,
    snapshot,
    status,
    streaming,
    runtimeError,
    lastMessageAt,
    isRecording,
    backdropNote,
    activeState,
    xRange,
    inputConvention,
    inputConventionReady,
    setInputConvention,
    setXRange,
    yRange,
    setYRange,
    yawRange,
    robotRange,
    setRobotRange,
    robotError,
    modelPreset,
    setModelPreset,
    customModelRulesText,
    setCustomModelRulesText,
    modelRulesError,
    setYawRange,
    xError,
    yError,
    yawError,
    randomizationError,
    canGenerate,
    canStartStreaming,
    canStopStreaming,
    canResetEnvironment,
    canDownloadControlExamples,
    busy,
    startingWorker,
    generationMessage,
    generationError,
    retryPreparation,
    busySessionWarning,
    replaceBusySession,
    templateError,
    streamingMessage,
    deleteStateDialogOpen,
    deleteStateTarget,
    beginDeleteState,
    cancelDeleteState,
    generateScene,
    sceneCount,
    setSceneCount,
    generationProgress,
    generatedCountHint,
    stopGeneratingScenes,
    removeGeneratedScene,
    selectGeneratedScene,
    resetEnvironment,
    toggleStreaming,
    downloadControlExamples,
    sceneSummary,
    captureStatusLabel,
    captureStatusTone,
    captureSummary,
    episodeSummary,
    batchActive,
  };
}
