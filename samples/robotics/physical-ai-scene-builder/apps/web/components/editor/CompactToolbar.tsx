// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client';

import { usePhysics } from '@mujoco-studio/mujoco';
import {
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@mujoco-studio/ui';
import {
  ArrowLeft,
  Camera,
  ChevronDown,
  Copy,
  Crosshair,
  Download,
  FileCode2,
  FilePlus2,
  Lightbulb,
  LoaderCircle,
  Redo2,
  Save,
  Trash2,
  Undo2,
  Upload,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import type { ReactNode } from 'react';

export type WorkspaceMode = 'build' | 'simulate' | 'generate';

const WORKSPACE_LABELS: Record<WorkspaceMode, string> = {
  build: 'build',
  generate: 'generate',
  simulate: 'evaluation',
};

export interface ToolbarProps {
  mcpControls?: ReactNode;
  onBackToScenes?: () => void;
  workspaceMode: WorkspaceMode;
  onWorkspaceModeChange: (mode: WorkspaceMode) => void;
  activeSceneName: string | null;
  onSceneNameChange: (name: string) => void;
  onSave: () => void;
  onSaveAsTemplate: () => void;
  onExport: () => void;
  onImport: () => void;
  onExportXml: () => void;
  onImportXml: () => void;
  onAddCamera: () => void;
  onMountCamera: () => void;
  onAddLight: () => void;
  canMountCamera: boolean;
  canSimulate: boolean;
  canSave: boolean;
  canSaveAsTemplate: boolean;
  saving: boolean;
  archiveBusy: boolean;
  documentDirty: boolean;
  canExportXml: boolean;
  saveError: string | null;
  onUndo: () => void;
  onRedo: () => void;
  canDuplicate: boolean;
  onDuplicate: () => void;
  canDelete: boolean;
  onDelete: () => void;
}

export function CompactToolbar({
  mcpControls,
  onBackToScenes,
  workspaceMode,
  onWorkspaceModeChange,
  activeSceneName,
  onSceneNameChange,
  onSave,
  onSaveAsTemplate,
  onExport,
  onImport,
  onExportXml,
  onImportXml,
  onAddCamera,
  onMountCamera,
  onAddLight,
  canMountCamera,
  canSimulate,
  canSave,
  canSaveAsTemplate,
  saving,
  archiveBusy,
  documentDirty,
  canExportXml,
  saveError,
  onUndo,
  onRedo,
  canDuplicate,
  onDuplicate,
  canDelete,
  onDelete,
}: ToolbarProps) {
  const router = useRouter();
  const { status, stats } = usePhysics();
  const ready = status === 'ready';
  // Authoring tools only apply in Build; Save stays reachable elsewhere while changes are unsaved
  // (Evaluation can clear the saved reset pose).
  const building = workspaceMode === 'build';
  const showSave = building || documentDirty || saving;

  return (
    <header className="flex h-12 w-full min-w-0 max-w-full shrink-0 items-center gap-2 border-b border-border bg-surface px-3">
      {onBackToScenes && (
        <Button
          size="icon"
          variant="ghost"
          onClick={onBackToScenes}
          title="Back to scenes"
          aria-label="Back to scenes"
        >
          <ArrowLeft />
        </Button>
      )}
      <button
        type="button"
        className="group flex shrink-0 items-baseline gap-2 outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
        onClick={() => router.push('/')}
        title="Back to projects"
        aria-label="Physical AI Scene Builder home"
      >
        <span className="text-sm font-semibold tracking-tight group-hover:text-accent">
          Physical AI Scene Builder
        </span>
        <span className="text-[10px] uppercase tracking-[0.2em] text-muted group-hover:text-foreground">
          web
        </span>
      </button>

      <div className="flex min-w-0 shrink-0 items-center gap-1.5 border-l border-border pl-2">
        <input
          aria-label="Scene name"
          value={activeSceneName ?? ''}
          onChange={(event) => onSceneNameChange(event.target.value)}
          className="h-7 w-32 border border-border bg-surface-raised px-2 text-xs text-foreground outline-none focus:border-accent focus:ring-1 focus:ring-accent/50"
        />
        {documentDirty && (
          <span className="text-accent" title="Unsaved changes" aria-label="Unsaved changes">
            *
          </span>
        )}
      </div>

      <div
        className="flex shrink-0 items-center gap-0.5 rounded-md border border-border bg-surface-raised p-0.5"
        aria-label="Workspace mode"
        role="group"
      >
        {(['build', 'generate', 'simulate'] as const).map((mode) => (
          <Button
            key={mode}
            size="sm"
            variant={workspaceMode === mode ? 'outline' : 'ghost'}
            disabled={mode !== 'build' && !canSimulate}
            aria-pressed={workspaceMode === mode}
            onClick={() => onWorkspaceModeChange(mode)}
            title={
              mode !== 'build' && !canSimulate
                ? `Finish editing before ${mode === 'generate' ? 'generating' : 'evaluating'}`
                : undefined
            }
            className={cn(
              'h-6 px-2 text-[11px] capitalize',
              workspaceMode === mode && 'text-accent',
            )}
          >
            {WORKSPACE_LABELS[mode]}
          </Button>
        ))}
      </div>

      {building && (
        <div className="flex shrink-0 items-center gap-1 border-l border-border pl-2">
          <Button
            size="icon"
            variant="ghost"
            disabled={!ready}
            onClick={onUndo}
            title="Undo"
            aria-label="Undo"
          >
            <Undo2 />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            disabled={!ready}
            onClick={onRedo}
            title="Redo"
            aria-label="Redo"
          >
            <Redo2 />
          </Button>
        </div>
      )}

      <div className="flex shrink-0 items-center gap-1">
        {showSave && (
          <Button
            size="sm"
            variant={documentDirty ? 'primary' : 'outline'}
            disabled={!ready || !canSave || saving}
            onClick={onSave}
            title={saveError ?? 'Save scene (Ctrl/Cmd+S)'}
          >
            {saving ? <LoaderCircle className="animate-spin" /> : <Save />}
            {saving ? 'Saving' : 'Save'}
          </Button>
        )}

        {building && (
          <>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="ghost" aria-label="Scene commands">
                  <FilePlus2 />
                  Scene
                  <ChevronDown className="size-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuItem
                  disabled={!ready || !canSaveAsTemplate || saving}
                  onSelect={onSaveAsTemplate}
                >
                  <Copy />
                  Save as template
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="px-2 py-1 text-[10px] font-medium uppercase tracking-[0.14em] text-muted">
                  Import
                </DropdownMenuLabel>
                <DropdownMenuItem disabled={archiveBusy} onSelect={onImport}>
                  <Upload />
                  Scene ZIP
                </DropdownMenuItem>
                <DropdownMenuItem disabled={archiveBusy} onSelect={onImportXml}>
                  <FileCode2 />
                  MJCF XML
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="px-2 py-1 text-[10px] font-medium uppercase tracking-[0.14em] text-muted">
                  Export
                </DropdownMenuLabel>
                <DropdownMenuItem disabled={archiveBusy || !ready} onSelect={onExport}>
                  {archiveBusy ? <LoaderCircle className="animate-spin" /> : <Download />}
                  Scene ZIP
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={archiveBusy || !ready || !canExportXml}
                  onSelect={onExportXml}
                >
                  <FileCode2 />
                  MJCF XML
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="ghost" aria-label="Add to scene">
                  <Crosshair />
                  Add
                  <ChevronDown className="size-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuLabel className="px-2 py-1 text-[10px] font-medium uppercase tracking-[0.14em] text-muted">
                  Scene objects
                </DropdownMenuLabel>
                <DropdownMenuItem disabled={!ready} onSelect={onAddCamera}>
                  <Camera />
                  Camera
                </DropdownMenuItem>
                <DropdownMenuItem disabled={!ready || !canMountCamera} onSelect={onMountCamera}>
                  <Crosshair />
                  Mount camera
                </DropdownMenuItem>
                <DropdownMenuItem disabled={!ready} onSelect={onAddLight}>
                  <Lightbulb />
                  Light
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label="Selection commands"
                  title="Selection commands"
                >
                  <Copy />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel className="px-2 py-1 text-[10px] font-medium uppercase tracking-[0.14em] text-muted">
                  Selection
                </DropdownMenuLabel>
                <DropdownMenuItem disabled={!canDuplicate} onSelect={onDuplicate}>
                  <Copy />
                  Duplicate
                  <DropdownMenuShortcut>Ctrl/Cmd+D</DropdownMenuShortcut>
                </DropdownMenuItem>
                <DropdownMenuItem disabled={!canDelete} onSelect={onDelete}>
                  <Trash2 />
                  Delete
                  <DropdownMenuShortcut>Del</DropdownMenuShortcut>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        )}
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-2 text-[10px] uppercase tracking-[0.14em] text-muted">
        <span>{ready ? `${stats.fps} fps` : status === 'error' ? 'Error' : 'Loading'}</span>
      </div>
      {mcpControls}
    </header>
  );
}
