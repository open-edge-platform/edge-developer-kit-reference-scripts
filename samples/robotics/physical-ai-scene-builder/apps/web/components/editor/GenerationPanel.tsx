// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client';

import type { RuntimeFile } from '@mujoco-studio/mujoco';
import { virtualRobotCapabilities } from '@mujoco-studio/payload/robot-capabilities';
import type { EvaluationInputConventionV1 } from '@mujoco-studio/types';
import { Button, cn, DeleteDialog, Panel, PanelBody, PanelHeader } from '@mujoco-studio/ui';
import {
  ChevronRight,
  Crosshair,
  Download,
  LoaderCircle,
  RotateCcw,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';

import { TeleoperationReviewPanel } from '../teleoperation/TeleoperationReviewPanel';
import { AccordionSection as SharedAccordionSection } from './AccordionGroup';
import {
  AccordionSection,
  Feedback,
  RangeTable,
  WorkerStartupNotice,
} from './GenerationPanelControls';
import { ModelRandomizationControls, ModelSampleList } from './ModelRandomizationControls';
import {
  CarryOverNotice,
  EarlierVersionView,
  SceneVersionPicker,
  useSceneVersions,
  versionCounts,
} from './GenerationVersions';
import {
  clampSceneCount,
  MAX_SCENES_PER_GENERATE,
  rangeError,
  saveInputConventionPreference,
} from './generationPanelUtils';
import { MAX_EXTRA_OBJECTS, type RangeFields } from '@/lib/generation/generationSettings';
import {
  yawFromRange,
  zoneColor,
  zoneFromRanges,
  zoneSizeLabel,
} from '@/lib/generation/randomizationZone';
import { ToggleSwitch } from './ToggleSwitch';
import { useGenerationPanelState } from './useGenerationPanelState';
import { SimulationPanel } from './SimulationPanel';
import {
  VirtualCamerasBadge,
  VirtualCamerasPanel,
  VirtualRobotBadge,
  VirtualRobotPanel,
  VirtualSo101Provider,
} from './VirtualSo101Panel';
import { useEditorStore } from '@/lib/store/editorStore';

/** Viewport picking stage in Generate; only the randomized (source) object is picked. */
export type GenerationPickStage = 'source';

interface GenerationPanelProps {
  sceneId?: number;
  sceneName: string;
  sceneXml: string;
  runtimeFiles: readonly RuntimeFile[];
  ready: boolean;
  documentDirty: boolean;
  /** Why the scene's saved home pose is invalid; it blocks saving, so Generate explains it. */
  homePoseError?: string | null;
  selectedSourceBody?: string;
  generationPickStage: GenerationPickStage | null;
  onSourceBodyChange: (body: string | undefined) => void;
  onBeginViewportSelection: (stage: GenerationPickStage) => void;
  onCancelViewportSelection: () => void;
  episodeCameraHost?: HTMLDivElement | null;
  episodeStatsHost?: HTMLDivElement | null;
}

const LABEL_CLASS = 'text-[10px] font-medium uppercase tracking-[0.14em] text-muted';
const SELECT_CLASS =
  'h-7 min-w-0 border border-border bg-background px-2 text-[11px] text-foreground disabled:opacity-60';
const SMALL_BUTTON_CLASS = 'h-7 gap-1 px-2 text-[10px] [&_svg]:size-3.5';

/**
 * Generate: stream the selected scene to a recording client, sample randomized scenes, and review
 * recorded episodes. Laid out like Simulate: a stream switch on top, details in sections below.
 */
export function GenerationPanel({
  sceneId,
  sceneName,
  sceneXml,
  runtimeFiles,
  ready,
  documentDirty,
  homePoseError,
  selectedSourceBody,
  generationPickStage,
  onSourceBodyChange,
  onBeginViewportSelection,
  onCancelViewportSelection,
  episodeCameraHost,
  episodeStatsHost,
}: GenerationPanelProps) {
  const g = useGenerationPanelState({
    sceneId,
    sceneName,
    sceneXml,
    runtimeFiles,
    ready,
    documentDirty,
    selectedSourceBody,
  });
  const session = g.session;
  const currentCollectionId = session?.collectionId ?? null;
  const sceneVersions = useSceneVersions(
    sceneId,
    currentCollectionId,
    `${session?.states.length ?? 0}:${session?.episodes.length ?? 0}`,
  );
  const [viewedVersionId, setViewedVersionId] = useState('');
  const [showExactValues, setShowExactValues] = useState(false);
  const viewedVersion = sceneVersions.earlier.find(
    (version) => version.collectionId === viewedVersionId,
  );
  const mergeableVersions = sceneVersions.earlier.filter((version) => version.mergeable);
  const currentLabel = session
    ? versionCounts({
        generatedCount: g.sceneStates.filter((state) => state.index > 0).length,
        episodeCount: session.episodes.filter(
          (episode) => episode.status === 'recorded' && episode.frameCount > 0,
        ).length,
      })
    : 'not loaded yet';

  const problems = [
    !sceneId && 'Save this scene first.',
    documentDirty && 'Save scene changes first.',
    g.templateError &&
      `${g.templateError} ${
        g.inputConvention === 'so101-normalized'
          ? 'Add an SO-101 arm, or switch Control units to Scene-native (raw).'
          : 'Add an actuated robot and save the scene.'
      }`,
    homePoseError && `${homePoseError} Saving is blocked until then.`,
    g.randomizationError,
  ].filter((problem): problem is string => Boolean(problem));
  const streamPending = g.busy || g.status === 'stopping';
  const sourceSummary = g.activeSourceBody
    ? `${g.activeSourceBody} · ±${Math.max(
        Math.abs(Number(g.xRange.min) || 0),
        Math.abs(Number(g.xRange.max) || 0),
        Math.abs(Number(g.yRange.min) || 0),
        Math.abs(Number(g.yRange.max) || 0),
      )} cm`
    : 'No movable object';

  return (
    <Panel className="w-full border-0">
      <PanelHeader
        title="Generate"
        actions={
          <span
            role="status"
            aria-label="Generate status"
            className={cn('text-[10px] uppercase tracking-[0.12em]', g.captureStatusTone)}
          >
            {g.captureStatusLabel}
          </span>
        }
      />
      <PanelBody className="p-0">
        {g.startingWorker && <WorkerStartupNotice />}
        <SceneVersionPicker
          currentLabel={currentLabel}
          earlier={sceneVersions.earlier}
          value={viewedVersion ? viewedVersion.collectionId : ''}
          onChange={setViewedVersionId}
        />
        {viewedVersion ? (
          <EarlierVersionView
            key={viewedVersion.collectionId}
            collectionId={viewedVersion.collectionId}
            episodeCameraHost={episodeCameraHost}
            episodeStatsHost={episodeStatsHost}
            onBack={() => setViewedVersionId('')}
            onDeleted={() => {
              setViewedVersionId('');
              sceneVersions.reload();
            }}
          />
        ) : (
          <>
            <section aria-label="Stream" className="space-y-3 border-b border-border px-3 py-3">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[11px] font-medium text-foreground">Stream to client</p>
                  <span
                    role="status"
                    aria-label="Stream status"
                    aria-live="polite"
                    className={cn(
                      'flex items-center gap-1 text-[10px] uppercase tracking-[0.12em]',
                      g.captureStatusTone,
                    )}
                  >
                    {streamPending ? (
                      <LoaderCircle className="size-3 animate-spin" />
                    ) : (
                      g.isRecording && (
                        <span className="size-1.5 animate-pulse rounded-full bg-current" />
                      )
                    )}
                    {g.captureStatusLabel}
                  </span>
                </div>
                <ToggleSwitch
                  checked={g.streaming}
                  disabled={g.streaming ? !g.canStopStreaming : !g.canStartStreaming}
                  label="Stream to client"
                  onToggle={() => void g.toggleStreaming()}
                  title="Streams the selected scene to a recording client (teleoperation or a scripted policy)"
                />
              </div>

              <dl className="space-y-1.5 text-[10px]">
                <div className="flex items-center justify-between gap-2">
                  <dt className="text-muted">
                    <label htmlFor="generate-control-units">Units</label>
                  </dt>
                  <dd>
                    <select
                      id="generate-control-units"
                      aria-label="Control units"
                      className={SELECT_CLASS}
                      disabled={
                        !g.inputConventionReady ||
                        g.isRecording ||
                        g.streaming ||
                        g.busy ||
                        g.batchActive
                      }
                      onChange={(event) => {
                        const convention = event.target.value as EvaluationInputConventionV1;
                        g.setInputConvention(convention);
                        saveInputConventionPreference(String(sceneId ?? 'new'), convention);
                      }}
                      value={g.inputConvention}
                    >
                      <option value="so101-normalized">SO-101 normalized</option>
                      <option value="raw">Scene-native (raw)</option>
                    </select>
                  </dd>
                </div>
                {g.isRecording && (
                  <div className="flex items-center justify-between gap-2">
                    <dt className="text-muted">Recording</dt>
                    <dd className="text-foreground">Step {g.snapshot?.header.stepId ?? 0}</dd>
                  </div>
                )}
              </dl>

              <div className="flex gap-1.5">
                <Button
                  aria-label="Reset environment"
                  className={cn(SMALL_BUTTON_CLASS, 'flex-1')}
                  disabled={!g.canResetEnvironment}
                  onClick={() => void g.resetEnvironment()}
                  size="sm"
                  title="Restore the selected scene in the worker"
                  type="button"
                  variant="outline"
                >
                  <RotateCcw />
                  Reset
                </Button>
                <Button
                  aria-label="Download control examples"
                  className={cn(SMALL_BUTTON_CLASS, 'flex-1')}
                  disabled={!g.canDownloadControlExamples || g.busy}
                  onClick={() => void g.downloadControlExamples()}
                  size="sm"
                  title="Download Python client examples and the connection file"
                  type="button"
                  variant="outline"
                >
                  <Download />
                  Client examples
                </Button>
              </div>

              {g.batchActive && (
                <p role="status" className="text-[10px] text-info">
                  Batch generation running; controls return when it ends.
                </p>
              )}
              {g.backdropNote && (
                <p role="status" aria-label="Backdrop rendering" className="text-[10px] text-muted">
                  {g.backdropNote}
                </p>
              )}
              <Feedback error={null} warning={g.runtimeError} message={g.streamingMessage} />
            </section>

            <DriverSection
              sceneXml={sceneXml}
              // Preparing the worker on open is not streaming; only a started stream hands the
              // robot to the external driver.
              streamActive={g.streaming}
              streamConnected={g.streaming && g.status === 'connected'}
            />

            <section aria-label="Scene" className="space-y-2 border-b border-border px-3 py-3">
              <div className="flex items-center justify-between gap-2">
                <h3 className={LABEL_CLASS}>Scene</h3>
                <div className="flex items-center gap-1.5">
                  <input
                    aria-label="Scenes to generate"
                    className="h-7 w-14 rounded border border-border bg-background px-1.5 text-[10px]"
                    disabled={g.busy}
                    max={MAX_SCENES_PER_GENERATE}
                    min={1}
                    onChange={(event) =>
                      g.setSceneCount(clampSceneCount(event.target.valueAsNumber))
                    }
                    title="How many randomized scenes one click samples"
                    type="number"
                    value={g.sceneCount}
                  />
                  {g.generationProgress ? (
                    <Button
                      aria-label="Stop generating scenes"
                      className={SMALL_BUTTON_CLASS}
                      onClick={g.stopGeneratingScenes}
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      <LoaderCircle className="animate-spin" />
                      Stop {g.generationProgress}
                    </Button>
                  ) : (
                    <Button
                      aria-label="Generate scene"
                      className={SMALL_BUTTON_CLASS}
                      disabled={!g.canGenerate}
                      onClick={() => void g.generateScene()}
                      size="sm"
                      title="Sample new randomized scenes"
                      type="button"
                    >
                      {g.busy ? <LoaderCircle className="animate-spin" /> : <Sparkles />}
                      {g.busy ? 'Generating' : 'Generate'}
                    </Button>
                  )}
                </div>
              </div>
              {g.generatedCountHint && (
                <p aria-label="Scene count hint" className="text-[10px] text-muted">
                  {g.generatedCountHint}
                </p>
              )}
              {session?.carryOver && <CarryOverNotice carryOver={session.carryOver} />}
              {g.sceneStates.length > 0 && (
                <>
                  <div className="flex gap-1.5">
                    <select
                      id="generated-scene"
                      aria-label="Generated scene"
                      className={cn(SELECT_CLASS, 'flex-1')}
                      disabled={g.isRecording || g.busy || g.batchActive}
                      value={session?.activeStateId}
                      onChange={(event) => void g.selectGeneratedScene(event.target.value)}
                    >
                      {g.sceneStates.map((state) => (
                        <option key={state.stateId} value={state.stateId}>
                          {state.index === 0 ? `${state.stateId} · Original scene` : state.label}
                          {state.origin ? ' · carried over' : ''}
                        </option>
                      ))}
                    </select>
                    <Button
                      aria-label="Delete generated scene"
                      className="size-7"
                      disabled={
                        g.isRecording ||
                        g.busy ||
                        g.batchActive ||
                        !g.activeState ||
                        g.activeState.index === 0
                      }
                      onClick={() => {
                        if (!g.activeState || g.activeState.index === 0) return;
                        g.beginDeleteState({
                          stateId: g.activeState.stateId,
                          label: g.activeState.label,
                        });
                      }}
                      size="icon"
                      title="Delete generated scene"
                      type="button"
                      variant="outline"
                    >
                      <Trash2 />
                    </Button>
                  </div>
                  <SampleValues state={g.activeState} />
                </>
              )}
              {problems.map((problem) => (
                <p key={problem} className="text-[10px] leading-relaxed text-warning">
                  {problem}
                </p>
              ))}
              {g.generationError && (
                <div className="flex items-start justify-between gap-2" role="alert">
                  <p className="text-[10px] leading-relaxed text-danger">
                    Could not prepare the worker: {g.generationError}
                  </p>
                  <Button
                    className={SMALL_BUTTON_CLASS}
                    disabled={g.busy}
                    onClick={g.retryPreparation}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    <RotateCcw />
                    Retry
                  </Button>
                </div>
              )}
              {g.generationMessage && (
                <p className="text-[10px] text-success">{g.generationMessage}</p>
              )}
            </section>

            <AccordionSection
              title="Randomization"
              summary={g.randomizationError ? 'Invalid range' : sourceSummary}
              summaryTone={g.randomizationError ? 'text-danger' : 'text-muted'}
              sectionId="randomization"
            >
              <div className="space-y-3 px-3 pb-3">
                <div className="flex items-center gap-1.5">
                  <label
                    className="w-12 shrink-0 text-[10px] text-muted"
                    htmlFor="randomized-object"
                  >
                    Object
                  </label>
                  <select
                    id="randomized-object"
                    aria-label="Object to randomize"
                    className={cn(SELECT_CLASS, 'flex-1')}
                    disabled={g.isRecording || g.movableSourceBodies.length === 0}
                    value={g.activeSourceBody}
                    onChange={(event) => onSourceBodyChange(event.target.value || undefined)}
                  >
                    {g.movableSourceBodies.length === 0 && (
                      <option value="">No movable objects</option>
                    )}
                    {g.movableSourceBodies.map((source) => (
                      <option key={source.body} value={source.body}>
                        {source.body}
                      </option>
                    ))}
                  </select>
                  <Button
                    aria-label="Pick object in viewport"
                    className="size-7"
                    disabled={
                      !ready || documentDirty || g.isRecording || g.movableSourceBodies.length === 0
                    }
                    onClick={() => onBeginViewportSelection('source')}
                    size="icon"
                    title="Pick object in viewport"
                    variant={generationPickStage === 'source' ? 'primary' : 'outline'}
                  >
                    <Crosshair />
                  </Button>
                </div>
                {generationPickStage === 'source' && (
                  <div className="flex items-center justify-between gap-2 border border-info/50 bg-info/10 px-2 py-1.5 text-[10px] text-info">
                    <span>Click a movable object in the viewport.</span>
                    <Button size="sm" variant="ghost" onClick={onCancelViewportSelection}>
                      Cancel
                    </Button>
                  </div>
                )}
                <ZoneSummary
                  xRange={g.xRange}
                  yRange={g.yRange}
                  yawRange={g.yawRange}
                  locked={g.isRecording}
                />
                <ExtraObjectList g={g} />
                <button
                  type="button"
                  aria-expanded={showExactValues}
                  className="flex items-center gap-1 text-[10px] text-muted hover:text-foreground"
                  onClick={() => setShowExactValues((open) => !open)}
                >
                  <ChevronRight
                    className={cn('size-3 transition-transform', showExactValues && 'rotate-90')}
                  />
                  Exact values
                </button>
                <RangeTable
                  disabled={g.isRecording}
                  rows={[
                    ...(showExactValues
                      ? [
                          {
                            label: 'X (cm)',
                            range: g.xRange,
                            error: g.xError,
                            onChange: g.setXRange,
                          },
                          {
                            label: 'Y (cm)',
                            range: g.yRange,
                            error: g.yError,
                            onChange: g.setYRange,
                          },
                          {
                            label: 'Yaw (deg)',
                            range: g.yawRange,
                            error: g.yawError,
                            onChange: g.setYawRange,
                          },
                          ...g.extraObjects
                            .filter((object) => !object.shareZone)
                            .flatMap((object) =>
                              (
                                [
                                  ['X (cm)', 'xRange'],
                                  ['Y (cm)', 'yRange'],
                                  ['Yaw (deg)', 'yawRange'],
                                ] as const
                              ).map(([label, key]) => ({
                                label: `${object.body} ${label}`,
                                hint: `${object.body} ${label}`,
                                range: object[key],
                                error: rangeError(`${object.body} ${label}`, object[key]),
                                onChange: (range: RangeFields) =>
                                  g.updateExtraObject(object.body, { [key]: range }),
                              })),
                            ),
                        ]
                      : []),
                    {
                      label: 'Robot joints (deg)',
                      range: g.robotRange,
                      error: g.robotError,
                      onChange: g.setRobotRange,
                      hint: 'Offsets each arm joint (not the gripper) from its authored start pose. 0 to 0 keeps the authored pose.',
                    },
                  ]}
                />
                <ModelRandomizationControls
                  context="Generate"
                  customRules={g.customModelRulesText}
                  disabled={g.isRecording || g.busy}
                  error={g.modelRulesError}
                  onCustomRulesChange={g.setCustomModelRulesText}
                  onPresetChange={g.setModelPreset}
                  preset={g.modelPreset}
                />
              </div>
            </AccordionSection>

            <AccordionSection title="Episodes" summary={g.episodeSummary} sectionId="episodes">
              <div className="px-3 pb-3">
                <TeleoperationReviewPanel
                  cameraPreviewHost={episodeCameraHost}
                  mergeableVersions={mergeableVersions}
                  statsGraphsHost={episodeStatsHost}
                />
              </div>
            </AccordionSection>
          </>
        )}
      </PanelBody>

      <DeleteDialog
        open={g.deleteStateDialogOpen}
        itemName={g.deleteStateTarget?.label ?? 'generated scene'}
        itemType="generated scene"
        busy={g.busy}
        onCancel={g.cancelDeleteState}
        onConfirm={() => void g.removeGeneratedScene()}
      />
    </Panel>
  );
}

type Driver = 'browser' | 'external';

const DRIVER_KEY = 'simulation:driver-external';
const DRIVER_SECTION_IDS = ['virtual-robot', 'virtual-cameras'] as const;

/** Who drives the robot: browser playback, or an external app with the virtual devices. */
function DriverSection({
  sceneXml,
  streamActive,
  streamConnected,
}: {
  sceneXml: string;
  streamActive: boolean;
  streamConnected: boolean;
}) {
  const storedExternal = useEditorStore((state) => state.expanded[DRIVER_KEY] ?? false);
  const setExpanded = useEditorStore((state) => state.setExpanded);
  const driver: Driver = storedExternal || streamActive ? 'external' : 'browser';
  useEffect(() => {
    if (streamActive && !storedExternal) setExpanded([DRIVER_KEY], true);
  }, [streamActive, setExpanded, storedExternal]);
  const virtualRobots = useMemo(
    () => virtualRobotCapabilities(sceneXml).filter((robot) => robot.adapter === 'so101'),
    [sceneXml],
  );

  return (
    <>
      <DriverToggle
        driver={driver}
        onChange={(next) => setExpanded([DRIVER_KEY], next === 'external')}
      />
      {driver === 'browser' ? (
        <SimulationPanel />
      ) : (
        <VirtualSo101Provider streaming={streamConnected} robots={virtualRobots}>
          {virtualRobots.length > 0 && (
            <DriverAccordionSection
              title="Virtual robot"
              sectionId="virtual-robot"
              badge={<VirtualRobotBadge />}
            >
              <VirtualRobotPanel />
            </DriverAccordionSection>
          )}
          <DriverAccordionSection
            title="Virtual cameras"
            sectionId="virtual-cameras"
            badge={<VirtualCamerasBadge />}
          >
            <VirtualCamerasPanel />
          </DriverAccordionSection>
        </VirtualSo101Provider>
      )}
    </>
  );
}

function DriverToggle({ driver, onChange }: { driver: Driver; onChange: (next: Driver) => void }) {
  const options: { value: Driver; label: string; hint: string }[] = [
    { value: 'browser', label: 'Browser', hint: 'Play the scene here with the actuator sliders.' },
    {
      value: 'external',
      label: 'External app',
      hint: 'A Python app, or policy drives a native worker.',
    },
  ];
  const active = options.find((option) => option.value === driver) ?? options[0];
  return (
    <div className="space-y-1.5 border-b border-border px-3 py-3">
      <div className="flex items-center justify-between gap-2">
        <span className={LABEL_CLASS}>Driver</span>
        <div
          role="radiogroup"
          aria-label="Driver"
          className="flex items-center gap-0.5 rounded-md border border-border bg-surface-raised p-0.5"
        >
          {options.map((option) => (
            <Button
              key={option.value}
              role="radio"
              aria-checked={driver === option.value}
              size="sm"
              type="button"
              variant={driver === option.value ? 'outline' : 'ghost'}
              onClick={() => onChange(option.value)}
              className={cn('h-6 px-2 text-[11px]', driver === option.value && 'text-accent')}
            >
              {option.label}
            </Button>
          ))}
        </div>
      </div>
      <p className="text-[10px] leading-relaxed text-muted">{active.hint}</p>
    </div>
  );
}

function DriverAccordionSection({
  title,
  sectionId,
  badge,
  children,
}: {
  title: string;
  sectionId: (typeof DRIVER_SECTION_IDS)[number];
  badge?: ReactNode;
  children: ReactNode;
}) {
  return (
    <SharedAccordionSection
      group="simulation"
      ids={DRIVER_SECTION_IDS}
      sectionId={sectionId}
      title={title}
      aside={badge}
    >
      {children}
    </SharedAccordionSection>
  );
}

/** The sampled object offset, robot pose, and model rules of the selected generated scene. */
function SampleValues({
  state,
}: {
  state: ReturnType<typeof useGenerationPanelState>['activeState'];
}) {
  if (!state) return null;
  const source = state.sourceRandomization;
  const robot = state.robotRandomization;
  return (
    <>
      {source && (
        <dl className="grid grid-cols-3 gap-2 text-[9px] text-muted">
          {(
            [
              ['X', 'cm'],
              ['Y', 'cm'],
              ['Yaw', 'deg'],
            ] as const
          ).map(([label, unit], index) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd className="text-foreground">
                {source.values[index]?.toFixed(2)} {unit}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {(state.objectRandomization?.length ?? 0) > 0 && (
        <dl aria-label="Other object poses" className="space-y-0.5 text-[9px] text-muted">
          {state.objectRandomization?.map((sample) => (
            <div key={sample.target} className="flex justify-between gap-2">
              <dt className="truncate">{sample.target}</dt>
              <dd className="shrink-0 tabular-nums text-foreground">
                {sample.values[0]?.toFixed(2)}, {sample.values[1]?.toFixed(2)} cm ·{' '}
                {sample.values[2]?.toFixed(1)} deg
              </dd>
            </div>
          ))}
        </dl>
      )}
      {robot?.names && (
        <dl aria-label="Robot start pose" className="grid grid-cols-3 gap-2 text-[9px] text-muted">
          {robot.names.map((name, index) => (
            <div key={name} className="min-w-0">
              <dt className="truncate">{name}</dt>
              <dd className="text-foreground">{robot.values[index]?.toFixed(1)} deg</dd>
            </div>
          ))}
        </dl>
      )}
      <ModelSampleList samples={state.modelRandomization ?? []} />
    </>
  );
}

/**
 * Other objects randomized with the main one. Each scatters in the main zone (placed apart, no
 * overlaps) or, with "Main zone" off, gets its own zone in the viewport.
 */
function ExtraObjectList({ g }: { g: ReturnType<typeof useGenerationPanelState> }) {
  const locked = g.isRecording || g.busy;
  return (
    <div aria-label="Other randomized objects" className="space-y-1">
      {g.extraObjects.map((object, index) => {
        const zone = zoneFromRanges(object.xRange, object.yRange);
        return (
          <div
            key={object.body}
            aria-label={`Randomized ${object.body}`}
            className="flex items-center gap-2 border border-border px-2 py-1 text-[10px]"
          >
            <span
              aria-hidden
              className="size-2.5 shrink-0 border"
              style={{ borderColor: zoneColor(index + 1), background: `${zoneColor(index + 1)}55` }}
            />
            <span className="min-w-0 flex-1 truncate text-foreground" title={object.body}>
              {object.body}
              {!object.shareZone && (
                <span className="text-muted"> · {zone ? zoneSizeLabel(zone) : 'incomplete'}</span>
              )}
            </span>
            <span className="text-muted">Main zone</span>
            <ToggleSwitch
              checked={object.shareZone}
              disabled={locked}
              label={`${object.body} shares the main zone`}
              title="On: scatter in the main zone. Off: give it its own zone."
              onToggle={() => g.updateExtraObject(object.body, { shareZone: !object.shareZone })}
            />
            <Button
              aria-label={`Stop randomizing ${object.body}`}
              className="size-6"
              disabled={locked}
              onClick={() => g.removeExtraObject(object.body)}
              size="icon"
              title="Remove"
              variant="ghost"
            >
              <X />
            </Button>
          </div>
        );
      })}
      {g.addableSourceBodies.length > 0 && g.extraObjects.length < MAX_EXTRA_OBJECTS && (
        <select
          aria-label="Add object to randomize"
          className={cn(SELECT_CLASS, 'w-full text-muted')}
          disabled={locked}
          value=""
          onChange={(event) => {
            if (event.target.value) g.addExtraObject(event.target.value);
          }}
        >
          <option value="">+ Randomize another object</option>
          {g.addableSourceBodies.map((source) => (
            <option key={source.body} value={source.body}>
              {source.body}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

/** One line about the start zone drawn in the viewport, with how to edit it. */
function ZoneSummary({
  xRange,
  yRange,
  yawRange,
  locked,
}: {
  xRange: Parameters<typeof zoneFromRanges>[0];
  yRange: Parameters<typeof zoneFromRanges>[1];
  yawRange: Parameters<typeof yawFromRange>[0];
  locked: boolean;
}) {
  const zone = zoneFromRanges(xRange, yRange);
  const yaw = yawFromRange(yawRange);
  const yawText =
    yaw && yaw.maxRad > yaw.minRad ? ` · yaw ${yawRange.min}° to ${yawRange.max}°` : '';
  return (
    <div
      aria-label="Randomization zone"
      className="flex items-center gap-2 border border-info/40 bg-info/5 px-2 py-1.5 text-[10px]"
    >
      <span aria-hidden className="size-2.5 shrink-0 border border-info bg-info/30" />
      <span className="text-foreground">
        {zone ? `Zone ${zoneSizeLabel(zone)}${yawText}` : 'Zone incomplete'}
      </span>
      <span className="ml-auto text-muted">
        {locked ? 'Locked while recording' : 'Drag it in the viewport'}
      </span>
    </div>
  );
}
