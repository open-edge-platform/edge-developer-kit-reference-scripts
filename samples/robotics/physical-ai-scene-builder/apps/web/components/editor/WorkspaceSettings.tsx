// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client';

import { Button, cn } from '@mujoco-studio/ui';
import { Grid3x3, Move3d, Sun } from 'lucide-react';

import { useEditorStore } from '@/lib/store/editorStore';

function SettingsSection({
  title,
  children,
  showHeader = true,
}: {
  title: string;
  children: React.ReactNode;
  showHeader?: boolean;
}) {
  return (
    <section className={showHeader ? 'border-b border-border px-3 py-3' : 'px-3 py-3'}>
      {showHeader && (
        <h3 className="mb-2 text-[10px] font-medium uppercase tracking-[0.14em] text-muted">
          {title}
        </h3>
      )}
      <div className="space-y-2">{children}</div>
    </section>
  );
}

export function TransformSettings() {
  const editingId = useEditorStore((state) => state.editingId);
  const transformAxis = useEditorStore((state) => state.transformAxis);
  const transformSpace = useEditorStore((state) => state.transformSpace);
  const snap = useEditorStore((state) => state.snap);
  const toggleTransformAxis = useEditorStore((state) => state.toggleTransformAxis);
  const setTransformSpace = useEditorStore((state) => state.setTransformSpace);
  const toggleSnap = useEditorStore((state) => state.toggleSnap);

  return (
    <SettingsSection title="Transform options">
      <div className="flex items-center justify-between gap-3 text-[11px] text-muted">
        <span>Axis lock</span>
        <div className="flex items-center gap-1" role="group" aria-label="Transform axis">
          {(['x', 'y', 'z'] as const).map((axis) => (
            <Button
              key={axis}
              size="sm"
              variant={editingId && transformAxis === axis ? 'outline' : 'ghost'}
              disabled={!editingId}
              aria-pressed={Boolean(editingId && transformAxis === axis)}
              className={cn(
                'h-7 w-8 px-0 font-mono uppercase',
                axis === 'x' && editingId && transformAxis === axis && 'text-danger',
                axis === 'y' && editingId && transformAxis === axis && 'text-[#5ad07a]',
                axis === 'z' && editingId && transformAxis === axis && 'text-info',
              )}
              onClick={() => toggleTransformAxis(axis)}
              title={
                transformAxis === axis
                  ? `Unlock the ${axis.toUpperCase()} axis (${axis.toUpperCase()})`
                  : `Lock dragging to the ${axis.toUpperCase()} axis (${axis.toUpperCase()})`
              }
            >
              {axis}
            </Button>
          ))}
        </div>
      </div>
      <div className="flex items-center justify-between gap-3 text-[11px] text-muted">
        <span>Space</span>
        <Button
          size="sm"
          disabled={!editingId}
          variant={editingId ? 'outline' : 'ghost'}
          onClick={() => setTransformSpace(transformSpace === 'world' ? 'local' : 'world')}
          aria-label="Transform space"
          title="Toggle local or world transform space"
        >
          {transformSpace}
        </Button>
      </div>
      <div className="flex items-center justify-between gap-3 text-[11px] text-muted">
        <span>Increment snap</span>
        <Button
          size="sm"
          disabled={!editingId}
          variant={snap && editingId ? 'outline' : 'ghost'}
          aria-pressed={Boolean(snap && editingId)}
          onClick={toggleSnap}
        >
          {snap ? 'On' : 'Off'}
        </Button>
      </div>
    </SettingsSection>
  );
}

export function ViewportSettings({ showHeader = true }: { showHeader?: boolean }) {
  const helpers = useEditorStore((state) => state.helpers);
  const toggleHelper = useEditorStore((state) => state.toggleHelper);

  return (
    <SettingsSection title="Viewport" showHeader={showHeader}>
      <div className="grid grid-cols-3 gap-1" role="group" aria-label="Viewport helpers">
        <HelperToggle
          label="Grid"
          active={helpers.grid}
          onClick={() => toggleHelper('grid')}
          icon={<Grid3x3 />}
        />
        <HelperToggle
          label="Axes"
          active={helpers.axes}
          onClick={() => toggleHelper('axes')}
          icon={<Move3d />}
        />
        <HelperToggle
          label="Shadows"
          active={helpers.shadows}
          onClick={() => toggleHelper('shadows')}
          icon={<Sun />}
        />
      </div>
    </SettingsSection>
  );
}

function HelperToggle({
  label,
  active,
  onClick,
  icon,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
}) {
  return (
    <Button
      size="sm"
      variant={active ? 'outline' : 'ghost'}
      aria-pressed={active}
      onClick={onClick}
      title={label}
      className={cn('w-full justify-start', active && 'text-accent')}
    >
      {icon}
      {label}
    </Button>
  );
}
