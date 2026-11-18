// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client';

import { usePhysics } from '@mujoco-studio/mujoco';
import { Button, cn } from '@mujoco-studio/ui';
import { Check, Layers2, Maximize2, Move3d, Pencil, RotateCw } from 'lucide-react';

import { isPlaceableSource } from '@/lib/editor/sceneGraph';
import { canScaleNode } from '@/lib/editor/viewportGeometry';
import { useEditorStore } from '@/lib/store/editorStore';

export interface ViewportToolStripProps {
  onBeginEdit: (id?: string) => void;
}

export function ViewportToolStrip({ onBeginEdit }: ViewportToolStripProps) {
  const { graph } = usePhysics();
  const selectedIds = useEditorStore((state) => state.selectedIds);
  const editingId = useEditorStore((state) => state.editingId);
  const transformMode = useEditorStore((state) => state.transformMode);
  const editTool = useEditorStore((state) => state.editTool);
  const selectedNode = graph && selectedIds.length === 1 ? graph.nodes[selectedIds[0]] : null;
  const editingNode = graph && editingId ? graph.nodes[editingId] : null;
  // Scale appears for primitive geoms and whole top-level objects.
  const canScale = canScaleNode(graph, editingNode ?? selectedNode);
  const canPlaceOnObject = Boolean(editingId && isPlaceableSource(graph, editingNode));
  const endEdit = useEditorStore((state) => state.endEdit);
  const setTransformMode = useEditorStore((state) => state.setTransformMode);
  const setEditTool = useEditorStore((state) => state.setEditTool);

  return (
    <div
      className="pointer-events-auto absolute left-1/2 top-4 z-10 flex -translate-x-1/2 items-center gap-1 border border-border-strong bg-surface/95 p-1 shadow-xl"
      role="toolbar"
      aria-label="Build tools"
    >
      <Button
        size="sm"
        variant={editingId ? 'primary' : 'outline'}
        disabled={!editingId && selectedIds.length !== 1}
        onClick={() => (editingId ? endEdit() : onBeginEdit())}
        title={editingId ? 'Finish editing' : 'Edit selected object (Enter)'}
      >
        {editingId ? <Check /> : <Pencil />}
        {editingId ? 'Done' : 'Edit'}
      </Button>
      <div className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
      <ToolToggle
        label="Translate"
        title="Translate (W)"
        active={transformMode === 'translate'}
        onClick={() => setTransformMode('translate')}
        icon={<Move3d />}
        disabled={!editingId}
      />
      <ToolToggle
        label="Rotate"
        title="Rotate (E)"
        active={transformMode === 'rotate'}
        onClick={() => setTransformMode('rotate')}
        icon={<RotateCw />}
        disabled={!editingId}
      />
      {canScale && (
        <ToolToggle
          label="Scale"
          title="Scale (R)"
          active={transformMode === 'scale'}
          onClick={() => setTransformMode('scale')}
          icon={<Maximize2 />}
          disabled={!editingId}
        />
      )}
      <ToolToggle
        label="Place on object"
        showLabel
        active={editTool === 'place-on-object'}
        title="Place the edited object on a clicked object"
        onClick={() =>
          setEditTool(editTool === 'place-on-object' ? 'transform' : 'place-on-object')
        }
        icon={<Layers2 />}
        disabled={!canPlaceOnObject}
      />
    </div>
  );
}

function ToolToggle({
  label,
  title,
  active,
  disabled,
  onClick,
  icon,
  showLabel = false,
}: {
  label: string;
  title?: string;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  showLabel?: boolean;
}) {
  return (
    <Button
      size={showLabel ? 'sm' : 'icon'}
      variant={active ? 'outline' : 'ghost'}
      disabled={disabled}
      aria-pressed={active}
      onClick={onClick}
      title={title ?? label}
      aria-label={label}
      className={cn(active && 'text-accent', showLabel && 'px-2')}
    >
      {icon}
      {showLabel && <span>{label}</span>}
    </Button>
  );
}
