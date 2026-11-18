// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client';

import { type RuntimeFile, usePhysics } from '@mujoco-studio/mujoco';
import { Button, cn, Dialog, Panel, PanelBody, PanelHeader } from '@mujoco-studio/ui';
import { Download, FlaskConical, X } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';

import { ExternalControlPanel } from './ExternalControlPanel';
import { ToggleSwitch } from './ToggleSwitch';
import { CopyButton } from './VirtualSo101Panel';
import {
  type EvaluationEpisodeSummary,
  useEvaluationRuntime,
} from '@/components/evaluation/EvaluationRuntimeProvider';
import {
  buildTaskProfile,
  DEFAULT_TASK_JITTER_CM,
  DEFAULT_TASK_MAX_STEPS,
  findTaskCandidates,
  TASK_JITTER_OPTIONS_CM,
  taskProblem,
  taskSummary,
  type SimulateTaskSettings,
  type TaskCandidates,
} from '@/lib/evaluation/simulateTask';
import { useGenerationSettings } from '@/lib/generation/generationSettings';
import { zoneFromRanges, zoneSizeLabel } from '@/lib/generation/randomizationZone';
import { sourceRandomizationFromSettings } from '@/lib/generation/sourceRandomization';

interface EvaluationPanelProps {
  sceneId?: number;
  sceneName: string;
  sceneXml: string;
  runtimeFiles: readonly RuntimeFile[];
  /** A stored reset pose the scene no longer accepts; saving is blocked until it is cleared. */
  homePoseError?: string | null;
  onHomePoseClear?: () => void;
}

/**
 * Evaluation: stream the scene to an external app, and optionally score pick-and-place episodes.
 * External control stays a plain connection; the task is layered on top.
 */
export function EvaluationPanel({
  sceneId,
  sceneName,
  sceneXml,
  runtimeFiles,
  homePoseError,
  onHomePoseClear,
}: EvaluationPanelProps) {
  const { status: physicsStatus } = usePhysics();
  const runtime = useEvaluationRuntime();
  const { status: streamStatus, streaming } = runtime;
  const connecting = streamStatus === 'starting' || streamStatus === 'connecting';
  const externalActive = streaming || connecting;

  const candidates = useMemo(() => findTaskCandidates(sceneXml), [sceneXml]);
  const [task, setTask] = useTaskSettings(sceneId, candidates);
  const problem = taskProblem(task, candidates);
  // Simulate reuses the Generate zones of this scene, with the task object as the main object.
  const [generationSettings] = useGenerationSettings(String(sceneId ?? 'new'));
  const generationSettingsKey = JSON.stringify(generationSettings);
  const generateZones = useMemo(
    () =>
      task.object
        ? sourceRandomizationFromSettings(
            JSON.parse(generationSettingsKey) as typeof generationSettings,
            task.object,
            candidates.objects.map((body) => ({ body: body.name, position: body.position })),
          )
        : undefined,
    [candidates.objects, generationSettingsKey, task.object],
  );
  const taskProfile = useMemo(
    () => buildTaskProfile(task, candidates, generateZones),
    [task, candidates, generateZones],
  );
  const mainZone = zoneFromRanges(generationSettings.xRange, generationSettings.yRange);
  const otherZoneCount = generateZones?.objects?.length ?? 0;
  const zoneLabel = mainZone
    ? `${zoneSizeLabel(mainZone)}${otherZoneCount > 0 ? ` +${otherZoneCount}` : ''}`
    : null;
  const [evaluateOpen, setEvaluateOpen] = useState(false);

  const headerStatus =
    physicsStatus !== 'ready'
      ? physicsStatus
      : connecting
        ? 'Connecting'
        : streaming
          ? streamStatus === 'connected'
            ? runtime.session?.profile.task
              ? 'Evaluating'
              : 'Connected'
            : 'Reconnecting'
          : streamStatus === 'error'
            ? 'Error'
            : 'Not connected';

  return (
    <Panel className="w-full border-0">
      <PanelHeader
        title="Evaluation"
        actions={
          <span
            role="status"
            aria-label="Evaluation status"
            className={cn(
              'text-[10px] uppercase tracking-[0.12em]',
              headerStatus === 'error' || headerStatus === 'Error'
                ? 'text-danger'
                : headerStatus === 'Connected' || headerStatus === 'Evaluating'
                  ? 'text-success'
                  : 'text-muted',
            )}
          >
            {headerStatus}
          </span>
        }
      />
      <PanelBody className="p-0">
        {homePoseError && (
          <div className="flex items-start gap-2 border-b border-border px-3 py-2">
            <p className="flex-1 text-[10px] leading-relaxed text-warning">{homePoseError}</p>
            {onHomePoseClear && (
              <Button
                className="h-6 shrink-0 gap-1 px-1.5 text-[10px] [&_svg]:size-3"
                onClick={onHomePoseClear}
                size="sm"
                type="button"
                variant="outline"
              >
                <X />
                Clear reset pose
              </Button>
            )}
          </div>
        )}

        <div className="border-b border-border pt-3">
          <ExternalControlPanel
            key={String(sceneId ?? 'new')}
            sceneId={sceneId}
            sceneName={sceneName}
            sceneXml={sceneXml}
            runtimeFiles={runtimeFiles}
            showHeader={false}
            taskProfile={taskProfile}
            taskProblem={problem}
          />
        </div>
        <TaskCard
          candidates={candidates}
          settings={task}
          onChange={setTask}
          problem={problem}
          locked={externalActive}
          onEvaluate={() => setEvaluateOpen(true)}
          zoneLabel={zoneLabel}
        />
      </PanelBody>
      <EvaluatePolicyDialog
        open={evaluateOpen}
        onClose={() => setEvaluateOpen(false)}
        taskEnabled={task.enabled}
        streaming={streaming}
      />
    </Panel>
  );
}

function storageKey(sceneId: number | undefined): string {
  return `simulate-task:${sceneId ?? 'new'}`;
}

function readStoredTask(key: string): Partial<SimulateTaskSettings> | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(key);
    const value: unknown = raw ? JSON.parse(raw) : null;
    return typeof value === 'object' && value !== null
      ? (value as Partial<SimulateTaskSettings>)
      : null;
  } catch {
    return null;
  }
}

/** Task settings per scene, kept in local storage and filled with scene defaults. */
function useTaskSettings(
  sceneId: number | undefined,
  candidates: TaskCandidates,
): [SimulateTaskSettings, (next: SimulateTaskSettings) => void] {
  const defaults = useMemo<SimulateTaskSettings>(
    () => ({
      enabled: false,
      object: candidates.defaultObject ?? '',
      target: candidates.defaultTarget ?? '',
      jitterCm: DEFAULT_TASK_JITTER_CM,
      useGenerateZone: true,
      maxSteps: DEFAULT_TASK_MAX_STEPS,
      startAtHome: true,
    }),
    [candidates.defaultObject, candidates.defaultTarget],
  );
  const key = storageKey(sceneId);
  const [entry, setEntry] = useState(() => ({ key, value: readStoredTask(key) }));
  if (entry.key !== key) setEntry({ key, value: readStoredTask(key) });
  const stored = entry.value;
  const settings: SimulateTaskSettings = {
    enabled: typeof stored?.enabled === 'boolean' ? stored.enabled : defaults.enabled,
    object:
      typeof stored?.object === 'string' &&
      candidates.objects.some((body) => body.name === stored.object)
        ? stored.object
        : defaults.object,
    target:
      typeof stored?.target === 'string' &&
      candidates.targets.some((body) => body.name === stored.target)
        ? stored.target
        : defaults.target,
    jitterCm:
      typeof stored?.jitterCm === 'number' &&
      (TASK_JITTER_OPTIONS_CM as readonly number[]).includes(stored.jitterCm)
        ? stored.jitterCm
        : defaults.jitterCm,
    useGenerateZone:
      typeof stored?.useGenerateZone === 'boolean'
        ? stored.useGenerateZone
        : defaults.useGenerateZone,
    maxSteps:
      typeof stored?.maxSteps === 'number' && stored.maxSteps >= 1
        ? stored.maxSteps
        : defaults.maxSteps,
    startAtHome:
      typeof stored?.startAtHome === 'boolean' ? stored.startAtHome : defaults.startAtHome,
  };
  const update = (next: SimulateTaskSettings) => {
    setEntry({ key, value: next });
    try {
      window.localStorage[key] = JSON.stringify(next);
    } catch {
      // Storage may be unavailable (private mode); the settings still apply for this visit.
    }
  };
  return [settings, update];
}

function TaskCard({
  candidates,
  settings,
  onChange,
  problem,
  locked,
  onEvaluate,
  zoneLabel,
}: {
  candidates: TaskCandidates;
  settings: SimulateTaskSettings;
  onChange: (next: SimulateTaskSettings) => void;
  problem: string | null;
  locked: boolean;
  onEvaluate: () => void;
  /** Size of the Generate zone and how many other objects it moves, for the Randomize option. */
  zoneLabel: string | null;
}) {
  const { streaming, session, episode } = useEvaluationRuntime();
  const sessionTask = session?.profile.task as { sourceBody?: string } | undefined;
  const selectClass =
    'h-7 w-full min-w-0 border border-border bg-background px-2 text-[11px] text-foreground disabled:opacity-60';

  return (
    <section aria-label="Task" className="border-b border-border">
      <div className="flex items-center justify-between gap-2 px-3 pt-3">
        <div className="min-w-0">
          <h3 className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted">Task</h3>
          <p className="truncate text-[10px] text-muted-foreground" title={taskSummary(settings)}>
            {settings.enabled ? taskSummary(settings) : 'Optional: score pick-and-place episodes'}
          </p>
        </div>
        <ToggleSwitch
          checked={settings.enabled}
          disabled={locked}
          label="Score episodes"
          onToggle={() => onChange({ ...settings, enabled: !settings.enabled })}
          title={locked ? 'Stop streaming to change the task' : 'Score pick-and-place episodes'}
        />
      </div>

      <div className="space-y-3 px-3 pb-3 pt-2">
        {settings.enabled && (
          <fieldset disabled={locked} className="grid grid-cols-[4.5rem_1fr] items-center gap-2">
            <label className="text-[10px] text-muted" htmlFor="simulate-task-object">
              Pick
            </label>
            <select
              id="simulate-task-object"
              aria-label="Task object"
              className={selectClass}
              value={settings.object}
              onChange={(event) => onChange({ ...settings, object: event.target.value })}
            >
              {candidates.objects.length === 0 && <option value="">No free objects</option>}
              {candidates.objects.map((body) => (
                <option key={body.name} value={body.name}>
                  {body.name}
                </option>
              ))}
            </select>
            <label className="text-[10px] text-muted" htmlFor="simulate-task-target">
              Place in
            </label>
            <select
              id="simulate-task-target"
              aria-label="Task target"
              className={selectClass}
              value={settings.target}
              onChange={(event) => onChange({ ...settings, target: event.target.value })}
            >
              <option value="">Choose…</option>
              {candidates.targets
                .filter((body) => body.name !== settings.object)
                .map((body) => (
                  <option key={body.name} value={body.name}>
                    {body.name}
                  </option>
                ))}
            </select>
            <label className="text-[10px] text-muted" htmlFor="simulate-task-jitter">
              Randomize
            </label>
            <select
              id="simulate-task-jitter"
              aria-label="Start position randomization"
              className={selectClass}
              value={settings.useGenerateZone ? 'zone' : settings.jitterCm}
              onChange={(event) =>
                onChange(
                  event.target.value === 'zone'
                    ? { ...settings, useGenerateZone: true }
                    : { ...settings, useGenerateZone: false, jitterCm: Number(event.target.value) },
                )
              }
            >
              <option value="zone">Generate zones{zoneLabel ? ` (${zoneLabel})` : ''}</option>
              {TASK_JITTER_OPTIONS_CM.map((value) => (
                <option key={value} value={value}>
                  {value === 0 ? 'Off (authored position)' : `±${value} cm per reset`}
                </option>
              ))}
            </select>
            {candidates.so101 && (
              <>
                <label className="text-[10px] text-muted" htmlFor="simulate-task-start">
                  Start pose
                </label>
                <select
                  id="simulate-task-start"
                  aria-label="Start pose"
                  className={selectClass}
                  title="Scripted demonstrations start recording at the home pose; a policy trained on them has only seen that start."
                  value={settings.startAtHome ? 'home' : 'reset'}
                  onChange={(event) =>
                    onChange({ ...settings, startAtHome: event.target.value === 'home' })
                  }
                >
                  <option value="home">Demo home pose</option>
                  <option value="reset">Scene reset pose</option>
                </select>
              </>
            )}
            <label className="text-[10px] text-muted" htmlFor="simulate-task-steps">
              Step limit
            </label>
            <input
              id="simulate-task-steps"
              aria-label="Step limit"
              className={selectClass}
              type="number"
              min={1}
              step={50}
              value={settings.maxSteps}
              onChange={(event) => {
                const value = Math.round(Number(event.target.value));
                if (Number.isFinite(value) && value >= 1)
                  onChange({ ...settings, maxSteps: value });
              }}
            />
          </fieldset>
        )}

        {settings.enabled && problem && (
          <p className="text-[10px] leading-relaxed text-warning">{problem}</p>
        )}
        {streaming && settings.enabled !== Boolean(sessionTask) ? (
          <p className="text-[10px] leading-relaxed text-warning">
            Restart streaming to apply the task.
          </p>
        ) : (
          locked &&
          settings.enabled && (
            <p className="text-[10px] text-muted">Stop streaming to change the task.</p>
          )
        )}

        {streaming && sessionTask && <EpisodeScore episode={episode} />}

        <Button
          className="w-full gap-1 text-[10px] [&_svg]:size-3.5"
          onClick={onEvaluate}
          size="sm"
          type="button"
          variant="outline"
        >
          <FlaskConical />
          Evaluate a policy…
        </Button>
      </div>
    </section>
  );
}

function outcome(episode: EvaluationEpisodeSummary): { label: string; tone: string } {
  const task = episode.task;
  if (!task || (!task.terminated && !task.truncated)) {
    return episode.active
      ? { label: 'Running', tone: 'text-foreground' }
      : { label: 'Stopped', tone: 'text-muted' };
  }
  if (task.success) return { label: 'Success', tone: 'text-success' };
  if (task.truncated) return { label: 'Timed out', tone: 'text-warning' };
  return {
    label: task.reason ? `Failed (${task.reason.replaceAll('_', ' ')})` : 'Failed',
    tone: 'text-danger',
  };
}

function EpisodeScore({ episode }: { episode: EvaluationEpisodeSummary | null }) {
  if (!episode) {
    return (
      <p
        role="status"
        aria-label="Episode score"
        className="text-[10px] leading-relaxed text-muted"
      >
        Waiting for the app to reset an episode.
      </p>
    );
  }
  const result = outcome(episode);
  const rate =
    episode.finished > 0 ? Math.round((100 * episode.succeeded) / episode.finished) : null;
  return (
    <div
      role="status"
      aria-label="Episode score"
      className="space-y-1 border border-border bg-background px-3 py-2 text-[10px]"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-muted">
          Episode {episode.index}
          {episode.seed !== null && ` · seed ${episode.seed}`} · step {episode.step}
        </span>
        <span className={cn('font-medium', result.tone)}>{result.label}</span>
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-muted">Score</span>
        <span className="tabular-nums text-foreground">
          {episode.succeeded}/{episode.finished} succeeded
          {rate !== null && ` (${rate}%)`}
        </span>
      </div>
    </div>
  );
}

type PolicyScript =
  | 'physicalai_evaluate_act'
  | 'physicalai_evaluate_pi05'
  | 'lerobot_evaluate_act'
  | 'lerobot_evaluate_pi05';

const POLICY_SCRIPTS: { value: PolicyScript; label: string; pathFlag: string; path: string }[] = [
  {
    value: 'physicalai_evaluate_act',
    label: 'Physical AI OpenVINO · ACT',
    pathFlag: '--package',
    path: '/path/to/act_openvino',
  },
  {
    value: 'physicalai_evaluate_pi05',
    label: 'Physical AI OpenVINO · Pi0.5',
    pathFlag: '--package',
    path: '/path/to/pi05_openvino',
  },
  {
    value: 'lerobot_evaluate_act',
    label: 'LeRobot · ACT',
    pathFlag: '--checkpoint',
    path: '/path/to/pretrained_model',
  },
  {
    value: 'lerobot_evaluate_pi05',
    label: 'LeRobot · Pi0.5',
    pathFlag: '--checkpoint',
    path: '/path/to/pretrained_model',
  },
];

function EvaluatePolicyDialog({
  open,
  onClose,
  taskEnabled,
  streaming,
}: {
  open: boolean;
  onClose: () => void;
  taskEnabled: boolean;
  streaming: boolean;
}) {
  const [script, setScript] = useState<PolicyScript>('physicalai_evaluate_act');
  const [episodes, setEpisodes] = useState(10);
  const selected = POLICY_SCRIPTS.find((option) => option.value === script) ?? POLICY_SCRIPTS[0];
  const studioUrl = typeof window === 'undefined' ? '' : window.location.origin;
  const command = [
    'uv run --locked python',
    `${selected.value}.py`,
    `${selected.pathFlag} ${selected.path}`,
    ...(selected.value.endsWith('pi05') ? ['--task "pick up the cube"'] : []),
    `--episodes ${episodes}`,
    ...(studioUrl ? [`--studio-url ${studioUrl}`] : []),
  ].join(' ');

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Evaluate a policy"
      description="Your policy runs in its own Python process and drives this scene through External app streaming."
      className="max-w-lg"
    >
      <ol className="space-y-4 px-5 py-4 text-[11px] text-foreground">
        <Step index={1} title="Set the task" done={taskEnabled}>
          Turn on <strong>Task</strong> in Evaluation so every episode is scored. Without it the run
          reports “Not scored”.
        </Step>
        <Step index={2} title="Start streaming" done={streaming}>
          Turn on <strong>Stream to external app</strong>.
        </Step>
        <Step index={3} title="Download the evaluator scripts">
          <a
            href="/api/evaluation/example"
            download
            className="mt-1 inline-flex h-7 items-center gap-1 border border-border px-2 text-[10px] hover:border-accent hover:text-accent [&_svg]:size-3.5"
          >
            <Download />
            evaluation-example.zip
          </a>
          <span className="mt-1 block text-muted">
            A self-contained uv project. Unzip it and run the command below from its folder.
          </span>
        </Step>
        <Step index={4} title="Run your checkpoint">
          <div className="mt-1 grid grid-cols-[1fr_5rem] gap-2">
            <select
              aria-label="Checkpoint type"
              className="h-7 border border-border bg-background px-2 text-[11px]"
              value={script}
              onChange={(event) => setScript(event.target.value as PolicyScript)}
            >
              {POLICY_SCRIPTS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <input
              aria-label="Episodes"
              className="h-7 border border-border bg-background px-2 text-[11px]"
              min={1}
              type="number"
              value={episodes}
              onChange={(event) => {
                const value = Math.round(Number(event.target.value));
                if (Number.isFinite(value) && value >= 1) setEpisodes(value);
              }}
            />
          </div>
          <div className="mt-2 flex items-start gap-1 border border-border bg-background p-2">
            <code aria-label="Evaluate command" className="flex-1 break-all text-[10px]">
              {command}
            </code>
            <CopyButton label="Copy command" value={command} />
          </div>
          <span className="mt-1 block text-muted">
            Replace the path with your checkpoint. Live results appear in the Task card; the run
            record is written to <code>./runs</code>.
          </span>
        </Step>
      </ol>
    </Dialog>
  );
}

function Step({
  index,
  title,
  done,
  children,
}: {
  index: number;
  title: string;
  done?: boolean;
  children: ReactNode;
}) {
  return (
    <li className="flex gap-3">
      <span
        className={cn(
          'flex size-5 shrink-0 items-center justify-center rounded-full border text-[10px]',
          done ? 'border-success text-success' : 'border-border text-muted',
        )}
      >
        {done ? '✓' : index}
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-medium">{title}</p>
        <div className="mt-0.5 text-[10px] leading-relaxed text-muted-foreground">{children}</div>
      </div>
    </li>
  );
}
