// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client';

import { usePhysics } from '@mujoco-studio/mujoco';
import {
  JOINT_TYPE_LABELS,
  LIGHT_TYPE_LABELS,
  LightType,
  SENSOR_TYPE_LABELS,
  type CameraNode,
  type SceneGraph,
  type SceneNode,
} from '@mujoco-studio/types';
import { Button, Panel, PanelBody, PanelHeader } from '@mujoco-studio/ui';
import { ArrowUpToLine, Camera } from 'lucide-react';
import { useState } from 'react';

import {
  getCameraClipping,
  getNodeAttributes,
  isSplatBackdropNode,
  renameNode,
  restitutionFromSolref,
  setGeomHiddenInCameras,
  setLightType,
  setNodeAttribute,
  setRestitution,
  setCameraClipping,
  type LightInsertionType,
} from '@/lib/editor/document';
import { CAMERA_HIDDEN_GEOM_GROUP, isVisibleGeom } from '@/lib/editor/sceneGraph';
import { useEditorStore } from '@/lib/store/editorStore';

export interface InspectorPanelProps {
  onDocumentChange: (xml: string) => void;
  onBackdropRotation?: (value: string) => void;
  onPreviewCamera?: (node: CameraNode) => void;
  previewCameraId?: string | null;
  showHeader?: boolean;
  /** Objects that start inside a splat table, with how far each must rise to rest on it. */
  tableOverlaps?: readonly { name: string; depth: number }[];
  onDropOntoTable?: (name: string) => void;
}

function AttributeField({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: string;
  onCommit: (value: string) => void;
}) {
  const [draftState, setDraftState] = useState({ source: value, value });
  const draft = draftState.source === value ? draftState.value : value;

  return (
    <label className="grid grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-2 text-[11px] text-muted">
      <span>{label}</span>
      <input
        value={draft}
        className="h-7 min-w-0 rounded border border-border bg-surface-raised px-2 font-mono text-[11px] text-foreground outline-none focus:border-accent"
        onChange={(event) => setDraftState({ source: value, value: event.currentTarget.value })}
        onBlur={(event) => {
          const nextValue = event.currentTarget.value.trim();
          setDraftState({ source: value, value: nextValue });
          onCommit(nextValue);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
          if (event.key === 'Escape') {
            event.preventDefault();
            setDraftState({ source: value, value });
          }
        }}
      />
    </label>
  );
}

function SelectField({
  label,
  value,
  options,
  onCommit,
}: {
  label: string;
  value: string;
  options: readonly { value: string; label: string }[];
  onCommit: (value: string) => void;
}) {
  return (
    <label className="grid grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-2 text-[11px] text-muted">
      <span>{label}</span>
      <select
        key={`${label}:${value}`}
        defaultValue={value}
        className="h-7 min-w-0 rounded border border-border bg-surface-raised px-2 text-[11px] text-foreground outline-none focus:border-accent"
        onChange={(event) => onCommit(event.currentTarget.value)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function lightTypeValue(value: number): LightInsertionType {
  if (value === LightType.Point) return 'point';
  if (value === LightType.Spot) return 'spot';
  return 'directional';
}

type OrientationAttribute = 'euler' | 'quat' | 'axisangle' | 'xyaxes' | 'zaxis';

function orientationAttributeFor(
  node: SceneNode,
  attributes: Record<string, string>,
): OrientationAttribute {
  if (node.kind !== 'camera') return 'euler';
  return (
    (['quat', 'euler', 'axisangle', 'xyaxes', 'zaxis'] as const).find(
      (attribute) => attributes[attribute],
    ) ?? 'quat'
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-b border-border px-3 py-3">
      <h3 className="mb-2 text-[10px] font-medium uppercase tracking-[0.14em] text-muted">
        {title}
      </h3>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function Inspector({
  node,
  graph,
  onDocumentChange,
  onBackdropRotation,
  onPreviewCamera,
  previewCameraId,
  tableOverlap,
  onDropOntoTable,
}: {
  node: SceneNode;
  graph: SceneGraph;
  onDocumentChange: (xml: string) => void;
  onBackdropRotation?: (value: string) => void;
  onPreviewCamera?: (node: CameraNode) => void;
  previewCameraId?: string | null;
  tableOverlap?: { name: string; depth: number } | null;
  onDropOntoTable?: (name: string) => void;
}) {
  const xml = useEditorStore((state) => state.xml);
  const attributes = getNodeAttributes(xml, node);
  const orientationAttribute =
    node.kind === 'body' && isSplatBackdropNode(node) && attributes.quat
      ? 'quat'
      : orientationAttributeFor(node, attributes);
  const parent = node.parentId ? graph.nodes[node.parentId] : null;
  const clipping = getCameraClipping(xml);
  const setAttribute = (attribute: Parameters<typeof setNodeAttribute>[2], value: string) => {
    if (!value) return;
    const nextXml = setNodeAttribute(xml, node, attribute, value);
    if (nextXml) onDocumentChange(nextXml);
  };
  const setName = (name: string) => {
    const nextXml = renameNode(xml, node, name);
    if (nextXml) onDocumentChange(nextXml);
  };
  const setRestitutionValue = (value: string) => {
    const nextXml = setRestitution(xml, node, value);
    if (nextXml) onDocumentChange(nextXml);
  };
  const setClippingValue = (attribute: 'near' | 'far', value: string) => {
    const nextXml = setCameraClipping(xml, attribute, value);
    if (nextXml) onDocumentChange(nextXml);
  };
  const setLightTypeValue = (value: string) => {
    if (node.kind !== 'light') return;
    const nextXml = setLightType(xml, node, value as LightInsertionType);
    if (nextXml) onDocumentChange(nextXml);
  };

  return (
    <>
      <Section title="Metadata">
        <AttributeField label="Name" value={node.name} onCommit={setName} />
        <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-2 text-[11px] text-muted">
          <span>Type</span>
          <span className="text-muted-foreground">{node.kind}</span>
        </div>
        <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-2 text-[11px] text-muted">
          <span>ID</span>
          <span className="truncate font-mono text-muted-foreground">{node.id}</span>
        </div>
      </Section>
      {tableOverlap && onDropOntoTable && (
        <div role="alert" className="border border-danger/40 bg-danger/10 p-3 text-[11px]">
          <p className="text-foreground">
            {(tableOverlap.depth * 1000).toFixed(0)} mm inside the table. The robot can&apos;t pick
            it up from there.
          </p>
          <Button
            size="sm"
            variant="outline"
            className="mt-2 h-7 w-full text-[11px]"
            onClick={() => onDropOntoTable(tableOverlap.name)}
          >
            <ArrowUpToLine />
            Drop onto table
          </Button>
        </div>
      )}
      {node.kind !== 'joint' && (
        <Section title="Transform">
          <AttributeField
            label="Position"
            value={attributes.pos ?? '0 0 0'}
            onCommit={(value) => setAttribute('pos', value)}
          />
          <AttributeField
            label={
              node.kind === 'light'
                ? 'Direction'
                : node.kind === 'camera'
                  ? orientationAttribute
                  : 'Rotation'
            }
            value={
              node.kind === 'light'
                ? (attributes.dir ?? '0 0 -1')
                : node.kind === 'camera'
                  ? (attributes[orientationAttribute] ?? '1 0 0 0')
                  : (attributes[orientationAttribute] ?? '0 0 0')
            }
            onCommit={(value) =>
              node.kind === 'body' && isSplatBackdropNode(node) && onBackdropRotation
                ? onBackdropRotation(value)
                : setAttribute(node.kind === 'light' ? 'dir' : orientationAttribute, value)
            }
          />
          {node.kind === 'geom' && (
            <AttributeField
              label="Size"
              value={attributes.size ?? node.size.join(' ')}
              onCommit={(value) => setAttribute('size', value)}
            />
          )}
        </Section>
      )}
      {node.kind === 'camera' && (
        <Section title="Camera">
          <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-2 text-[11px] text-muted">
            <span>Mount</span>
            <span className="truncate text-muted-foreground">
              {parent?.kind === 'body' && parent.mjIndex === 0
                ? 'World'
                : (parent?.name ?? 'World')}
            </span>
          </div>
          {onPreviewCamera && (
            <Button
              size="sm"
              variant={previewCameraId === node.id ? 'primary' : 'outline'}
              className="w-full"
              onClick={() => onPreviewCamera(node)}
            >
              <Camera />
              {previewCameraId === node.id ? 'Exit camera preview' : 'Preview camera'}
            </Button>
          )}
          <AttributeField
            label="FOV"
            value={attributes.fovy ?? String(node.fovy)}
            onCommit={(value) => setAttribute('fovy', value)}
          />
          <AttributeField
            label="Resolution"
            value={attributes.resolution ?? '224 224'}
            onCommit={(value) => setAttribute('resolution', value)}
          />
          <AttributeField
            label="Near (m)"
            value={String(clipping.near)}
            onCommit={(value) => setClippingValue('near', value)}
          />
          <AttributeField
            label="Far (m)"
            value={String(clipping.far)}
            onCommit={(value) => setClippingValue('far', value)}
          />
          <p className="text-[10px] text-muted">
            Clipping distances are in meters and apply to all scene cameras.
          </p>
        </Section>
      )}
      {node.kind === 'light' && (
        <Section title="Lighting">
          <SelectField
            label="Type"
            value={lightTypeValue(node.lightType)}
            options={[
              { value: 'directional', label: LIGHT_TYPE_LABELS[LightType.Directional] },
              { value: 'point', label: LIGHT_TYPE_LABELS[LightType.Point] },
              { value: 'spot', label: LIGHT_TYPE_LABELS[LightType.Spot] },
            ]}
            onCommit={setLightTypeValue}
          />
          <AttributeField
            label="Diffuse"
            value={attributes.diffuse ?? '1 1 1'}
            onCommit={(value) => setAttribute('diffuse', value)}
          />
          <AttributeField
            label="Ambient"
            value={attributes.ambient ?? '0 0 0'}
            onCommit={(value) => setAttribute('ambient', value)}
          />
          <AttributeField
            label="Specular"
            value={attributes.specular ?? '0 0 0'}
            onCommit={(value) => setAttribute('specular', value)}
          />
          <AttributeField
            label="Attenuation"
            value={attributes.attenuation ?? '1 0 0'}
            onCommit={(value) => setAttribute('attenuation', value)}
          />
          <AttributeField
            label="Cutoff"
            value={attributes.cutoff ?? '180'}
            onCommit={(value) => setAttribute('cutoff', value)}
          />
          <AttributeField
            label="Exponent"
            value={attributes.exponent ?? '0'}
            onCommit={(value) => setAttribute('exponent', value)}
          />
          <AttributeField
            label="Shadows"
            value={attributes.castshadow ?? 'false'}
            onCommit={(value) => setAttribute('castshadow', value)}
          />
        </Section>
      )}
      {node.kind === 'joint' && (
        <>
          <Section title="Joint">
            <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-2 text-[11px] text-muted">
              <span>Type</span>
              <span className="text-muted-foreground">
                {JOINT_TYPE_LABELS[node.jointType] ?? 'joint'}
              </span>
            </div>
            <AttributeField
              label="Position"
              value={attributes.pos ?? '0 0 0'}
              onCommit={(value) => setAttribute('pos', value)}
            />
            <AttributeField
              label="Axis"
              value={attributes.axis ?? node.axis.join(' ')}
              onCommit={(value) => setAttribute('axis', value)}
            />
            <AttributeField
              label="Range"
              value={attributes.range ?? node.range.join(' ')}
              onCommit={(value) => setAttribute('range', value)}
            />
            <AttributeField
              label="Limited"
              value={attributes.limited ?? String(node.limited)}
              onCommit={(value) => setAttribute('limited', value)}
            />
          </Section>
          <Section title="Physics">
            <AttributeField
              label="Damping"
              value={attributes.damping ?? '0'}
              onCommit={(value) => setAttribute('damping', value)}
            />
            <AttributeField
              label="Friction loss"
              value={attributes.frictionloss ?? '0'}
              onCommit={(value) => setAttribute('frictionloss', value)}
            />
          </Section>
        </>
      )}
      {node.kind === 'sensor' && (
        <Section title="Sensor">
          <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-2 text-[11px] text-muted">
            <span>Type</span>
            <span className="text-muted-foreground">
              {SENSOR_TYPE_LABELS[node.sensorType] ?? `sensor ${node.sensorType}`}
            </span>
          </div>
          <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-2 text-[11px] text-muted">
            <span>Dimension</span>
            <span className="font-mono text-muted-foreground">{node.dimension}</span>
          </div>
          <AttributeField
            label="Noise"
            value={attributes.noise ?? '0'}
            onCommit={(value) => setAttribute('noise', value)}
          />
          <AttributeField
            label="Cutoff"
            value={attributes.cutoff ?? '0'}
            onCommit={(value) => setAttribute('cutoff', value)}
          />
          <AttributeField
            label="User"
            value={attributes.user ?? ''}
            onCommit={(value) => setAttribute('user', value)}
          />
        </Section>
      )}
      {node.kind === 'geom' && (
        <>
          <Section title="Physics">
            <AttributeField
              label="Mass"
              value={attributes.mass ?? ''}
              onCommit={(value) => setAttribute('mass', value)}
            />
            <AttributeField
              label="Density"
              value={attributes.density ?? ''}
              onCommit={(value) => setAttribute('density', value)}
            />
            <AttributeField
              label="Friction"
              value={attributes.friction ?? ''}
              onCommit={(value) => setAttribute('friction', value)}
            />
            <AttributeField
              label="Restitution"
              value={restitutionFromSolref(attributes.solref)}
              onCommit={setRestitutionValue}
            />
          </Section>
          <Section title="Material">
            <AttributeField
              label="RGBA"
              value={attributes.rgba ?? node.rgba.join(' ')}
              onCommit={(value) => setAttribute('rgba', value)}
            />
            {!isSplatBackdropNode(node) && isVisibleGeom(node) && (
              <label className="flex items-start gap-2 text-[11px] text-muted">
                <input
                  type="checkbox"
                  aria-label="Hidden in camera images"
                  className="mt-0.5 size-3.5 accent-accent"
                  checked={node.group === CAMERA_HIDDEN_GEOM_GROUP}
                  onChange={(event) => {
                    const nextXml = setGeomHiddenInCameras(xml, node, event.target.checked);
                    if (nextXml) onDocumentChange(nextXml);
                  }}
                />
                <span>
                  Hidden in camera images
                  <span className="block text-[10px] text-muted">
                    Still collides and shows here. Use it for a table or support that stands in for
                    a surface the splat backdrop renders.
                  </span>
                </span>
              </label>
            )}
          </Section>
        </>
      )}
    </>
  );
}

export function InspectorPanel({
  onDocumentChange,
  onBackdropRotation,
  onPreviewCamera,
  previewCameraId,
  showHeader = true,
  tableOverlaps = [],
  onDropOntoTable,
}: InspectorPanelProps) {
  const { graph } = usePhysics();
  const selectedIds = useEditorStore((state) => state.selectedIds);
  const node = graph && selectedIds.length === 1 ? graph.nodes[selectedIds[0]] : null;

  return (
    <Panel className="w-full border-0">
      {showHeader && <PanelHeader title="Inspector" />}
      <PanelBody className={showHeader ? undefined : 'flex-none overflow-visible'}>
        {node && graph ? (
          <Inspector
            key={node.id}
            node={node}
            graph={graph}
            onDocumentChange={onDocumentChange}
            onBackdropRotation={onBackdropRotation}
            onPreviewCamera={onPreviewCamera}
            previewCameraId={previewCameraId}
            tableOverlap={tableOverlaps.find((overlap) => overlap.name === node.name) ?? null}
            onDropOntoTable={onDropOntoTable}
          />
        ) : (
          <p className="p-3 text-xs text-muted">
            {selectedIds.length > 1
              ? `${selectedIds.length} objects selected.`
              : 'Select an object to inspect it.'}
          </p>
        )}
      </PanelBody>
    </Panel>
  );
}
