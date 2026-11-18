// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client';

import { usePhysics } from '@mujoco-studio/mujoco';
import {
  GEOM_TYPE_LABELS,
  JOINT_TYPE_LABELS,
  LIGHT_TYPE_LABELS,
  SENSOR_TYPE_LABELS,
  type SceneNode,
} from '@mujoco-studio/types';
import { cn, Panel, PanelBody, PanelHeader } from '@mujoco-studio/ui';
import {
  Activity,
  Box,
  Camera,
  ChevronDown,
  ChevronRight,
  CircleDot,
  Layers,
  Lightbulb,
  Lock,
  Move3d,
} from 'lucide-react';
import { Fragment, useRef, useState } from 'react';

import {
  isSplatBackdropNode,
  isSplatTableNode,
  renameNode,
  reorderSibling,
} from '@/lib/editor/document';
import { useEditorStore } from '@/lib/store/editorStore';

const KIND_ICONS = {
  body: Move3d,
  geom: Box,
  joint: CircleDot,
  light: Lightbulb,
  camera: Camera,
  site: CircleDot,
  sensor: Activity,
} as const;

function detailFor(node: SceneNode): string {
  switch (node.kind) {
    case 'geom':
      return GEOM_TYPE_LABELS[node.geomType] ?? 'geom';
    case 'joint':
      return JOINT_TYPE_LABELS[node.jointType] ?? 'joint';
    case 'body':
      return node.mass > 0 ? `${node.mass.toFixed(3)} kg` : '';
    case 'light':
      return LIGHT_TYPE_LABELS[node.lightType] ?? 'light';
    case 'camera':
      return `${node.fovy.toFixed(0)}°`;
    case 'sensor':
      return SENSOR_TYPE_LABELS[node.sensorType] ?? `sensor ${node.sensorType}`;
    default:
      return '';
  }
}

/** MuJoCo geoms without a name are listed as `geom_<index>` (see the scene loader). */
function isUnnamedGeom(node: SceneNode): boolean {
  return node.kind === 'geom' && node.name === `geom_${node.mjIndex}`;
}

/** A body with this many unnamed geoms lists them under one collapsed row. */
const UNNAMED_PART_GROUP_MIN = 2;

export interface SceneTreeProps {
  onDocumentChange: (xml: string) => void;
}

export function SceneTree({ onDocumentChange }: SceneTreeProps) {
  const { graph } = usePhysics();
  const selectedIds = useEditorStore((s) => s.selectedIds);
  const expanded = useEditorStore((s) => s.expanded);
  const xml = useEditorStore((s) => s.xml);
  const select = useEditorStore((s) => s.select);
  const hover = useEditorStore((s) => s.hover);
  const toggleExpanded = useEditorStore((s) => s.toggleExpanded);
  const setExpanded = useEditorStore((s) => s.setExpanded);
  const [editingId, setEditingId] = useState<string | null>(null);
  const dragId = useRef<string | null>(null);

  const commitRename = (node: SceneNode, name: string) => {
    const nextXml = renameNode(xml, node, name);
    if (nextXml) onDocumentChange(nextXml);
    setEditingId(null);
  };

  // Splat tables belong to the Splat tab, which replaces this tree; they are not listed here.
  const listed = (id: string) => !graph || !isSplatTableNode(graph.nodes[id]);
  const visibleOrder = (graph?.order ?? []).filter(listed);

  const renderNode = (id: string, depth: number) => {
    if (!graph) return null;
    const node = graph.nodes[id];
    const listedChildren = node.childIds.filter(listed);
    // Imported meshes (robot links, scans) often carry many unnamed parts; fold them away.
    const unnamedParts = listedChildren.filter((childId) => isUnnamedGeom(graph.nodes[childId]));
    const grouped = unnamedParts.length >= UNNAMED_PART_GROUP_MIN;
    const childIds = grouped
      ? listedChildren.filter((childId) => !unnamedParts.includes(childId))
      : listedChildren;
    const hasChildren = listedChildren.length > 0;
    const isOpen = expanded[id] ?? true;
    const Icon = KIND_ICONS[node.kind];
    const detail = detailFor(node);
    // The splat backdrop is generated: the Splat panel owns its name, contents, and lifetime.
    const locked = id === graph.rootId || isSplatBackdropNode(node);

    return (
      <Fragment key={id}>
        <div
          className={cn(
            'group flex h-7 cursor-default items-center gap-1.5 rounded pr-2 text-xs',
            selectedIds.includes(id)
              ? 'bg-accent/15 text-accent'
              : 'text-muted-foreground hover:bg-surface-hover',
          )}
          style={{ paddingLeft: depth * 12 + 4 }}
          draggable={!locked}
          onClick={(event) =>
            select(id, {
              additive: event.metaKey || event.ctrlKey,
              range: event.shiftKey ? visibleOrder : undefined,
            })
          }
          onMouseEnter={() => hover(id)}
          onMouseLeave={() => hover(null)}
          onDoubleClick={() => {
            if (!locked) setEditingId(id);
          }}
          onDragStart={(event) => {
            dragId.current = id;
            event.dataTransfer.effectAllowed = 'move';
          }}
          onDragOver={(event) => {
            if (dragId.current && dragId.current !== id) event.preventDefault();
          }}
          onDrop={(event) => {
            event.preventDefault();
            const sourceId = dragId.current;
            dragId.current = null;
            if (!sourceId || sourceId === id || !graph.nodes[sourceId]) return;
            const targetRect = event.currentTarget.getBoundingClientRect();
            const nextXml = reorderSibling(
              xml,
              graph.nodes[sourceId],
              node,
              event.clientY > targetRect.top + targetRect.height / 2,
            );
            if (nextXml) onDocumentChange(nextXml);
          }}
          onDragEnd={() => {
            dragId.current = null;
          }}
        >
          <button
            type="button"
            className="flex size-4 shrink-0 items-center justify-center text-muted"
            onClick={(event) => {
              event.stopPropagation();
              if (hasChildren) toggleExpanded(id);
            }}
            aria-label={hasChildren ? (isOpen ? 'Collapse' : 'Expand') : undefined}
          >
            {hasChildren ? (
              isOpen ? (
                <ChevronDown className="size-3" />
              ) : (
                <ChevronRight className="size-3" />
              )
            ) : null}
          </button>
          <Icon className="size-3 shrink-0 opacity-70" />
          {editingId === id ? (
            <input
              autoFocus
              defaultValue={node.name}
              className="min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none"
              onClick={(event) => event.stopPropagation()}
              onBlur={(event) => commitRename(node, event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') event.currentTarget.blur();
                if (event.key === 'Escape') setEditingId(null);
              }}
              aria-label={`Rename ${node.name}`}
            />
          ) : (
            <span className="truncate">{node.name}</span>
          )}
          {detail && (
            <span className="ml-auto shrink-0 text-[10px] text-muted opacity-70">{detail}</span>
          )}
          {locked && id !== graph.rootId && (
            <Lock
              className={cn('size-3 shrink-0 text-muted opacity-70', !detail && 'ml-auto')}
              aria-label="Managed by the Splat panel"
            />
          )}
        </div>
        {hasChildren && isOpen && childIds.map((childId) => renderNode(childId, depth + 1))}
        {hasChildren && isOpen && grouped && renderPartGroup(id, unnamedParts, depth + 1)}
      </Fragment>
    );
  };

  const renderPartGroup = (bodyId: string, partIds: readonly string[], depth: number) => {
    const groupId = `${bodyId}:unnamed-parts`;
    // Collapsed by default, but never hides a selection (for example a viewport click).
    const isOpen = expanded[groupId] ?? partIds.some((partId) => selectedIds.includes(partId));
    const label = `${partIds.length} unnamed parts`;
    return (
      <Fragment key={groupId}>
        <div
          className="flex h-7 cursor-default items-center gap-1.5 rounded pr-2 text-xs text-muted hover:bg-surface-hover"
          style={{ paddingLeft: depth * 12 + 4 }}
          onClick={() => setExpanded([groupId], !isOpen)}
        >
          <button
            type="button"
            className="flex size-4 shrink-0 items-center justify-center text-muted"
            onClick={(event) => {
              event.stopPropagation();
              setExpanded([groupId], !isOpen);
            }}
            aria-label={`${isOpen ? 'Collapse' : 'Expand'} ${label}`}
            aria-expanded={isOpen}
          >
            {isOpen ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
          </button>
          <Layers className="size-3 shrink-0 opacity-70" />
          <span className="truncate italic">{label}</span>
        </div>
        {isOpen && partIds.map((partId) => renderNode(partId, depth + 1))}
      </Fragment>
    );
  };

  return (
    <Panel
      aria-label="Scene hierarchy"
      className="min-h-0 w-72 flex-1 shrink-0 border-r border-border"
    >
      <PanelHeader title="Hierarchy" />
      <PanelBody className="p-1">
        {graph ? (
          renderNode(graph.rootId, 0)
        ) : (
          <p className="p-3 text-xs text-muted">No scene loaded.</p>
        )}
      </PanelBody>
    </Panel>
  );
}
