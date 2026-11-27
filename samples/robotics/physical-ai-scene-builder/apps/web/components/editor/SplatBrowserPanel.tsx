// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client';

import {
  ArrowUpToLine,
  Check,
  ChevronDown,
  Crop,
  Crosshair,
  Eraser,
  EyeOff,
  ScanSearch,
  Sparkles,
  Layers,
  MousePointer2,
  Plus,
  Ruler,
  SlidersHorizontal,
  Table2,
  Upload,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';
import { splatFileProblem } from '@mujoco-studio/types';
import { Button, cn, Panel, PanelBody, PanelHeader } from '@mujoco-studio/ui';

import { useEditorStore } from '@/lib/store/editorStore';
import type { SplatTableStatus, TableOverlap } from '@/lib/editor/scanTable';
import { isSplatUpAxis, SPLAT_UP_AXES, type SplatCalibration } from '@/lib/editor/splatCollision';
import { cleanupActive, DEFAULT_ISOLATION, type SplatCleanup } from '@/lib/editor/splatCleanup';
import type { TableProposal } from '@/lib/mcp/tableDetection';

import { ToggleSwitch } from './ToggleSwitch';

const STATUS_LABEL: Record<string, string> = {
  idle: 'No scan loaded',
  loading: 'Loading scan…',
  ready: 'Scan loaded',
  error: 'Scan failed to load',
};

/** [label, key, valid, expected, hint] */
const CALIBRATION_FIELDS = [
  ['Size', 'scale', (value: number) => value > 0, 'a positive number', 'Scan size multiplier'],
  ['Floor height', 'level', () => true, 'a number', 'Height of the scanned floor in the scene (m)'],
  ['Tilt X', 'tiltX', () => true, 'a number of degrees', 'Leveling rotation (degrees)'],
  ['Tilt Y', 'tiltY', () => true, 'a number of degrees', 'Leveling rotation (degrees)'],
] as const;

type NumericCalibrationKey = (typeof CALIBRATION_FIELDS)[number][1];

/** Result of the panel's Auto level action. */
export interface AutoLevelOutcome {
  ok: boolean;
  message: string;
}

/** Header check on the first 64 KB so a wrong file is rejected before it is loaded or uploaded. */
async function splatFileProblemOf(file: File): Promise<string | null> {
  return splatFileProblem(new Uint8Array(await file.slice(0, 64 * 1024).arrayBuffer()), file.size);
}

/**
 * Calibration inputs edit a local draft and apply on blur or Enter, so typing does not recompile
 * the scene (or push undo history) on every keystroke.
 */
function CalibrationForm({
  calibration,
  onApply,
}: {
  calibration: SplatCalibration;
  onApply: (calibration: SplatCalibration) => string | null;
}) {
  const [draft, setDraft] = useState<Record<NumericCalibrationKey, string>>(() => ({
    scale: String(calibration.scale),
    level: String(calibration.level),
    tiltX: String(calibration.tiltX),
    tiltY: String(calibration.tiltY),
  }));
  const [error, setError] = useState<string | null>(null);

  const apply = () => {
    const next: SplatCalibration = { ...calibration };
    for (const [label, key, valid, expected] of CALIBRATION_FIELDS) {
      const text = draft[key].trim();
      const value = Number(text);
      if (!text || !Number.isFinite(value) || !valid(value)) {
        setError(`${label} must be ${expected}.`);
        return;
      }
      next[key] = value;
    }
    if (CALIBRATION_FIELDS.every(([, key]) => next[key] === calibration[key])) {
      setError(null);
      return;
    }
    setError(onApply(next));
  };

  const field = ([label, key, , , hint]: (typeof CALIBRATION_FIELDS)[number]) => (
    <label key={key} className="text-[10px] text-muted" title={hint}>
      {label}
      <input
        aria-label={label}
        className="mt-1 h-7 w-full border border-border bg-background px-1 text-[11px] text-foreground"
        step="any"
        type="number"
        value={draft[key]}
        onChange={(event) => setDraft({ ...draft, [key]: event.target.value })}
        onBlur={apply}
        onKeyDown={(event) => {
          if (event.key === 'Enter') apply();
        }}
      />
    </label>
  );

  return (
    <>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <label className="col-span-2 text-[10px] text-muted" title="Scan axis that points up">
          Up axis
          <select
            aria-label="Up axis"
            className="mt-1 h-7 w-full border border-border bg-background px-1 text-[11px] text-foreground"
            value={calibration.upAxis}
            onChange={(event) => {
              const upAxis = event.target.value;
              if (isSplatUpAxis(upAxis) && upAxis !== calibration.upAxis) {
                setError(onApply({ ...calibration, upAxis }));
              }
            }}
          >
            {SPLAT_UP_AXES.map((axis) => (
              <option key={axis} value={axis}>
                {axis}
              </option>
            ))}
          </select>
        </label>
        {CALIBRATION_FIELDS.map(field)}
      </div>
      {error && (
        <p className="mt-2 text-[11px] text-danger" role="alert">
          {error}
        </p>
      )}
    </>
  );
}

/** One numbered step of the panel's scan → line up → table flow. */
function Step({
  step,
  icon: Icon,
  title,
  done = false,
  children,
}: {
  step: number;
  icon: LucideIcon;
  title: string;
  done?: boolean;
  children: ReactNode;
}) {
  return (
    <section aria-label={title} className="border border-border bg-surface-raised p-3">
      <h3 className="flex items-center gap-2 text-xs font-medium text-foreground">
        <span
          className={cn(
            'flex size-4 items-center justify-center rounded-full text-[10px]',
            done ? 'bg-success/20 text-success' : 'bg-accent/15 text-accent',
          )}
        >
          {done ? <Check className="size-3" aria-label="Done" /> : step}
        </span>
        <Icon className="size-3.5 text-muted" />
        {title}
      </h3>
      <div className="mt-2">{children}</div>
    </section>
  );
}

/** Faint-Gaussian thresholds offered in the Clean step (0: off). */
const MIN_OPACITY_LEVELS = [0, 0.3, 0.5, 0.7] as const;

/**
 * Step 3: leave parts of the scan out (crop box, faint and isolated Gaussians). The preview,
 * the collision heightfield, and native recordings all use the result.
 */
function CleanStep({
  cleanup,
  removed,
  onChange,
  onFitCrop,
}: {
  cleanup: SplatCleanup;
  removed: number;
  onChange: (cleanup: SplatCleanup) => string | null;
  onFitCrop: () => string | null;
}) {
  const [error, setError] = useState<string | null>(null);
  const update = (next: SplatCleanup) => setError(onChange(next));
  const without = (key: keyof SplatCleanup): SplatCleanup => {
    const next = { ...cleanup };
    delete next[key];
    return next;
  };
  const opacity = cleanup.minOpacity ?? 0;

  return (
    <Step step={3} icon={Eraser} title="Clean" done={cleanupActive(cleanup)}>
      <div className="space-y-2 text-[11px]">
        <div className="flex items-center gap-2" title="Keep only the workspace">
          <Crop className="size-3.5 text-muted" />
          <span className="flex-1 text-foreground">Crop</span>
          <Button
            size="sm"
            variant="outline"
            className="h-6 px-2 text-[11px]"
            aria-label="Fit crop to tables"
            title="Fit to the tables (or the robot) plus a margin"
            onClick={() => setError(onFitCrop())}
          >
            <Table2 />
            Fit
          </Button>
          {cleanup.crop && (
            <Button
              size="icon"
              variant="ghost"
              className="size-6"
              aria-label="Remove crop"
              title="Remove crop"
              onClick={() => update(without('crop'))}
            >
              <X />
            </Button>
          )}
        </div>
        {cleanup.crop && (
          <p className="font-mono text-[10px] text-muted-foreground" aria-label="Crop box">
            {cleanup.crop.min.map((value) => value.toFixed(2)).join(' ')} →{' '}
            {cleanup.crop.max.map((value) => value.toFixed(2)).join(' ')}
          </p>
        )}
        <div className="flex items-center gap-2" title="Hide Gaussians fainter than this">
          <EyeOff className="size-3.5 text-muted" />
          <span className="flex-1 text-foreground">Faint</span>
          <div role="radiogroup" aria-label="Minimum opacity" className="flex border border-border">
            {MIN_OPACITY_LEVELS.map((level) => (
              <button
                key={level}
                type="button"
                role="radio"
                aria-checked={opacity === level}
                className={cn(
                  'px-1.5 py-0.5 text-[10px]',
                  opacity === level
                    ? 'bg-accent text-background'
                    : 'text-muted hover:text-foreground',
                )}
                onClick={() =>
                  update(level ? { ...cleanup, minOpacity: level } : without('minOpacity'))
                }
              >
                {level ? `<${level}` : 'Off'}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2" title="Hide lone floaters">
          <Sparkles className="size-3.5 text-muted" />
          <span className="flex-1 text-foreground">Floaters</span>
          <ToggleSwitch
            checked={Boolean(cleanup.isolation)}
            label="Remove floaters"
            onToggle={() =>
              update(
                cleanup.isolation
                  ? without('isolation')
                  : { ...cleanup, isolation: { ...DEFAULT_ISOLATION } },
              )
            }
          />
        </div>
        {cleanupActive(cleanup) && (
          <p
            className="flex items-center gap-1 text-muted-foreground"
            role="status"
            aria-label="Hidden"
          >
            <EyeOff className="size-3" />−{removed.toLocaleString('en-US')}
          </p>
        )}
        {error && (
          <p className="text-danger" role="alert">
            {error}
          </p>
        )}
      </div>
    </Step>
  );
}

/**
 * Step 4: boxes you place over the scanned tables make them solid (the scan itself never
 * collides), and objects that start inside one are listed with Drop.
 */
function TableStep({
  tables,
  overlaps,
  note,
  onAdd,
  onDetect,
  onAddDetected,
  onMatchHeight,
  onDrop,
  onSelect,
}: {
  tables: readonly SplatTableStatus[];
  overlaps: readonly TableOverlap[];
  note: string | null;
  onAdd: () => string | null;
  onDetect: () => TableProposal[] | string;
  onAddDetected: (proposal: TableProposal) => string | null;
  onMatchHeight: (name: string) => string | null;
  onDrop: (names?: readonly string[]) => void;
  onSelect: (name: string) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [proposals, setProposals] = useState<TableProposal[]>([]);
  const done = tables.length > 0 && overlaps.length === 0;
  const resting = new Set(tables.flatMap((table) => table.resting)).size;
  const where = tables.length === 1 ? 'the table' : 'a table';

  return (
    <Step step={4} icon={Table2} title="Table" done={done}>
      <div className="mt-2 flex gap-2">
        <Button
          className="flex-1"
          size="sm"
          variant={tables.length ? 'outline' : 'primary'}
          title="Find table tops in the scan"
          onClick={() => {
            const found = onDetect();
            if (typeof found === 'string') {
              setProposals([]);
              setError(found);
            } else {
              setProposals(found);
              setError(null);
            }
          }}
        >
          <ScanSearch />
          Detect
        </Button>
        <Button
          className="flex-1"
          size="sm"
          variant="outline"
          title="Add a box in the middle of the scan to move over a scanned table"
          onClick={() => setError(onAdd())}
        >
          <Plus />
          Add table
        </Button>
      </div>
      {proposals.length > 0 && (
        <ul aria-label="Detected tables" className="mt-2 space-y-1">
          {proposals.map((proposal, index) => (
            <li key={index} className="flex items-center gap-2 text-[11px]">
              <Table2 className="size-3.5 text-muted" />
              <span className="flex-1 text-foreground">
                {proposal.size[0].toFixed(2)} × {proposal.size[1].toFixed(2)} m
                <span className="text-muted-foreground"> · {proposal.height.toFixed(2)} m</span>
              </span>
              <Button
                size="icon"
                variant="ghost"
                className="size-6"
                aria-label={`Add detected table ${index + 1}`}
                title="Add this table"
                onClick={() => {
                  const failure = onAddDetected(proposal);
                  setError(failure);
                  if (!failure)
                    setProposals((current) => current.filter((item) => item !== proposal));
                }}
              >
                <Plus />
              </Button>
            </li>
          ))}
        </ul>
      )}
      {tables.length > 0 && (
        <ul aria-label="Tables" className="mt-2 space-y-2">
          {tables.map((table) => (
            <li
              key={table.name}
              aria-label={table.name}
              className="border border-border bg-background p-2 text-[11px]"
            >
              <p className="text-foreground" role="status">
                <span className="font-mono">{table.name}</span>: top at {table.top.toFixed(3)} m
                <span className="block text-muted-foreground">
                  {table.size[0].toFixed(2)} × {table.size[1].toFixed(2)} m
                </span>
              </p>
              <div className="mt-2 flex gap-2">
                <Button
                  className="h-7 flex-1 text-[11px]"
                  size="sm"
                  variant="outline"
                  aria-label={`Select ${table.name}`}
                  title="Select the table to move or resize it"
                  onClick={() => onSelect(table.name)}
                >
                  <MousePointer2 />
                  Select
                </Button>
                <Button
                  className="h-7 flex-1 text-[11px]"
                  size="sm"
                  variant="outline"
                  aria-label={`Match ${table.name} height to scan`}
                  title="Set the top to the scan's surface height measured under the table"
                  onClick={() => setError(onMatchHeight(table.name))}
                >
                  <Ruler />
                  Match height
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {overlaps.length > 0 ? (
        <div className="mt-2 border border-danger/40 bg-danger/10 p-2 text-[11px]" role="alert">
          <p className="text-foreground">
            {overlaps.length === 1
              ? `1 object is inside ${where}:`
              : `${overlaps.length} objects are inside ${where}:`}
          </p>
          <ul className="mt-1 space-y-1">
            {overlaps.map(({ name, table, depth }) => (
              <li key={name} className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate font-mono" title={`Inside ${table}`}>
                  {name}
                </span>
                <span className="text-muted-foreground">{(depth * 1000).toFixed(0)} mm</span>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 px-1.5 text-[11px]"
                  aria-label={`Drop ${name} onto table`}
                  onClick={() => onDrop([name])}
                >
                  <ArrowUpToLine />
                  Drop
                </Button>
              </li>
            ))}
          </ul>
          {overlaps.length > 1 && (
            <Button className="mt-2 w-full" size="sm" variant="outline" onClick={() => onDrop()}>
              <ArrowUpToLine />
              Drop all onto tables
            </Button>
          )}
        </div>
      ) : (
        tables.length > 0 && (
          <p className="mt-2 text-[11px] text-muted-foreground" role="status">
            {resting
              ? `${resting === 1 ? '1 object rests' : `${resting} objects rest`} on ${tables.length === 1 ? 'the table' : 'the tables'}. Nothing is inside ${tables.length === 1 ? 'it' : 'them'}.`
              : `Nothing is inside ${tables.length === 1 ? 'the table' : 'the tables'}.`}
          </p>
        )
      )}
      {note && (
        <p className="mt-2 text-[11px] text-muted-foreground" role="status">
          {note}
        </p>
      )}
      {error && (
        <p className="mt-2 text-[11px] text-danger" role="alert">
          {error}
        </p>
      )}
    </Step>
  );
}

/**
 * Left-panel tab that uses a Gaussian-splat (`.ply` or `.spz`) scan of a real workspace as the
 * scene's visual backdrop: upload it, line it up, then place solid tables over its tables.
 */
export function SplatBrowserPanel({
  onFileSelected,
  onClear,
  onCalibrationChange,
  onAutoLevel,
  orientationNote = null,
  tables,
  overlaps,
  tableNote,
  onAddTable,
  onDetectTables,
  onAddDetectedTable,
  onCleanupChange,
  onFitCrop,
  cleanupRemoved,
  onMatchTableHeight,
  onDropOntoTable,
  onSelectTable,
}: {
  onFileSelected: (file: File) => void;
  onClear: () => void;
  /** Applies a calibration; returns a user-facing error when it could not be applied. */
  onCalibrationChange: (calibration: SplatCalibration) => string | null;
  /** Fits the floor plane and applies the leveled orientation when the fit is good. */
  onAutoLevel: () => AutoLevelOutcome;
  /** How the orientation of a newly uploaded scan was detected, shown under its status. */
  orientationNote?: AutoLevelOutcome | null;
  /** The compiled splat tables. */
  tables: readonly SplatTableStatus[];
  /** Objects that start inside a table, deepest first. */
  overlaps: readonly TableOverlap[];
  /** Outcome of the last Add table or Match height. */
  tableNote: string | null;
  /** Adds a table and selects it; returns a user-facing error. */
  onAddTable: () => string | null;
  /** Table tops found in the scan, or why none were. */
  onDetectTables: () => TableProposal[] | string;
  onAddDetectedTable: (proposal: TableProposal) => string | null;
  /** Applies a splat cleanup; returns a user-facing error. */
  onCleanupChange: (cleanup: SplatCleanup) => string | null;
  /** Crops the scan to the tables (or robot) plus a margin; returns a user-facing error. */
  onFitCrop: () => string | null;
  /** Visible Gaussians the cleanup hides. */
  cleanupRemoved: number;
  /** Sets the named table's top to the scan's surface; returns a user-facing error. */
  onMatchTableHeight: (name: string) => string | null;
  /** Raises the named objects (all when omitted) out of the tables onto their tops. */
  onDropOntoTable: (names?: readonly string[]) => void;
  onSelectTable: (name: string) => void;
}) {
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [autoLevel, setAutoLevel] = useState<AutoLevelOutcome | null>(null);
  const [fineTuneOpen, setFineTuneOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const splatSrc = useEditorStore((s) => s.splatSrc);
  const splatStatus = useEditorStore((s) => s.splatStatus);
  const splatError = useEditorStore((s) => s.splatError);
  const calibration = useEditorStore((s) => s.splatCalibration);
  const levelNote = autoLevel ?? orientationNote;

  return (
    <Panel
      aria-label="Splat backdrop"
      className="min-h-0 w-72 flex-1 shrink-0 border-r border-border"
    >
      <PanelHeader title="Splat" />
      <PanelBody className="space-y-3 p-3">
        <input
          ref={inputRef}
          aria-label="Splat file"
          type="file"
          accept=".ply,.spz"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (!file) return;
            splatFileProblemOf(file).then((problem) => {
              setUploadError(problem);
              if (!problem) onFileSelected(file);
            });
          }}
        />

        <Step
          step={1}
          icon={Layers}
          title="Scan"
          done={Boolean(splatSrc) && splatStatus === 'ready'}
        >
          {splatSrc ? (
            <article className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-xs font-medium text-foreground">
                  {STATUS_LABEL[splatStatus] ?? splatStatus}
                </h2>
                {splatStatus === 'error' && splatError && (
                  <p className="mt-0.5 text-[11px] text-danger">{splatError}</p>
                )}
              </div>
              <Button
                size="icon"
                variant="ghost"
                aria-label="Replace splat"
                title="Replace scan"
                onClick={() => inputRef.current?.click()}
              >
                <Upload />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                aria-label="Remove splat"
                title="Remove scan"
                onClick={onClear}
              >
                <X className="text-danger" />
              </Button>
            </article>
          ) : (
            <button
              type="button"
              aria-label="Upload .ply / .spz"
              title="Gaussian-splat scan of a real environment"
              className="flex w-full flex-col items-center gap-2 border border-dashed border-border px-3 py-8 text-muted transition-colors hover:border-accent hover:text-accent"
              onClick={() => inputRef.current?.click()}
            >
              <Upload className="size-5" />
              <span className="text-xs text-foreground">Upload scan</span>
              <span className="text-[10px]">.ply · .spz</span>
            </button>
          )}
          {uploadError && <p className="mt-2 text-[11px] text-danger">{uploadError}</p>}
        </Step>

        {splatSrc && splatStatus === 'ready' && (
          <>
            <Step step={2} icon={Crosshair} title="Line up" done={Boolean(levelNote?.ok)}>
              <Button
                aria-label="Auto level"
                title="Fit tilt to the scanned floor"
                className="mt-2 w-full"
                size="sm"
                variant="outline"
                onClick={() => setAutoLevel(onAutoLevel())}
              >
                <Crosshair />
                Auto level
              </Button>
              {levelNote && (
                <p
                  className={cn(
                    'mt-2 text-[11px]',
                    levelNote.ok ? 'text-muted-foreground' : 'text-danger',
                  )}
                  role={levelNote.ok ? 'status' : 'alert'}
                >
                  {levelNote.message}
                </p>
              )}
              <button
                type="button"
                aria-expanded={fineTuneOpen}
                aria-label="Fine-tune calibration"
                className="mt-3 flex w-full items-center gap-1.5 text-[11px] text-muted hover:text-foreground"
                onClick={() => setFineTuneOpen((open) => !open)}
              >
                <SlidersHorizontal className="size-3.5" />
                Adjust manually
                <ChevronDown
                  className={cn(
                    'ml-auto size-3.5 transition-transform',
                    fineTuneOpen && 'rotate-180',
                  )}
                />
              </button>
              {/* Stays mounted while collapsed so drafts and field values persist. */}
              <div hidden={!fineTuneOpen}>
                <CalibrationForm
                  key={JSON.stringify(calibration)}
                  calibration={calibration}
                  onApply={(next) => {
                    setAutoLevel(null);
                    return onCalibrationChange(next);
                  }}
                />
              </div>
            </Step>

            <CleanStep
              cleanup={calibration.cleanup}
              removed={cleanupRemoved}
              onChange={onCleanupChange}
              onFitCrop={onFitCrop}
            />

            <TableStep
              tables={tables}
              overlaps={overlaps}
              note={tableNote}
              onAdd={onAddTable}
              onDetect={onDetectTables}
              onAddDetected={onAddDetectedTable}
              onMatchHeight={onMatchTableHeight}
              onDrop={onDropOntoTable}
              onSelect={onSelectTable}
            />
          </>
        )}
      </PanelBody>
    </Panel>
  );
}
