// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client';

import { Button, cn } from '@mujoco-studio/ui';
import { Box, Check, Eye, Palette, Pencil, Plus, RefreshCw, Trash2, X } from 'lucide-react';
import Image from 'next/image';
import { useState } from 'react';

import { BOX_FACE_OPTIONS, type BoxFace } from '@/lib/editor/document';
import {
  hasArtifactFile,
  objectModelConversion,
  type ProcessingStatus,
  type SceneAsset,
} from '@/lib/scenes/assetsApi';

function statusLabel(status: ProcessingStatus): string {
  switch (status) {
    case 'uploaded':
      return 'Upload complete';
    case 'queued':
      return 'Preparing object';
    case 'processing':
      return 'Preparing object';
    case 'ready':
      return 'Ready to place';
    case 'failed':
      return 'Needs attention';
  }
}

function dimensionsLabel(asset: SceneAsset): string | null {
  const dimensions = asset.metadata?.dimensionsMeters;
  if (!dimensions || dimensions.length !== 3) return null;
  return dimensions.map((entry) => `${entry.value.toFixed(2)} m`).join(' x ');
}

export function AssetCard({
  asset,
  onRename,
  onDelete,
  onReprocess,
  onPreview,
  onAddToScene,
  onDragStart,
  onDragEnd,
  onApplyMaterial,
  textureFace,
  onTextureFaceChange,
  canApplyMaterialToFace,
  isPreviewing,
  isAddingToScene,
  isApplyingMaterial,
  hasSceneSelection,
  isRenaming,
  isDeleting,
  isReprocessing,
}: {
  asset: SceneAsset;
  onRename: (name: string) => void;
  onDelete: () => void;
  onReprocess: () => void;
  onPreview: () => void;
  onAddToScene: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onApplyMaterial: () => void;
  textureFace: BoxFace | 'all';
  onTextureFaceChange: (face: BoxFace | 'all') => void;
  canApplyMaterialToFace: boolean;
  isPreviewing: boolean;
  isAddingToScene: boolean;
  isApplyingMaterial: boolean;
  hasSceneSelection: boolean;
  isRenaming: boolean;
  isDeleting: boolean;
  isReprocessing: boolean;
}) {
  const dimensions = dimensionsLabel(asset);
  const preparing = asset.processingStatus === 'queued' || asset.processingStatus === 'processing';
  const isMaterial = asset.kind === 'material';
  const hasCanonicalMesh = hasArtifactFile(asset.canonicalMesh);
  const thumbnail = hasArtifactFile(asset.thumbnail) ? asset.thumbnail : null;
  const isObjectModel = Boolean(objectModelConversion(asset));
  // Procedural and generated objects have no single source mesh to preview or reprocess.
  const hasSourceMesh = !isMaterial && !asset.primitive && !asset.customSource && !isObjectModel;
  const canAddToScene =
    asset.processingStatus === 'ready' &&
    (Boolean(asset.primitive || asset.customSource) ||
      isObjectModel ||
      hasCanonicalMesh ||
      (asset.filename?.toLowerCase().endsWith('.stl') ?? false));
  const canDragToScene =
    asset.kind === 'mesh' && !asset.primitive && !asset.customSource && canAddToScene;
  const [isEditing, setIsEditing] = useState(false);
  const [name, setName] = useState(asset.name);

  const saveName = () => {
    const nextName = name.trim();
    if (!nextName || nextName === asset.name) {
      setName(asset.name);
      setIsEditing(false);
      return;
    }
    onRename(nextName);
    setIsEditing(false);
  };

  return (
    <article
      draggable={canDragToScene}
      onDragStart={(event) => {
        if (!canDragToScene) {
          event.preventDefault();
          return;
        }
        event.dataTransfer.effectAllowed = 'copy';
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      className={cn(
        'border bg-surface-raised p-2.5',
        isPreviewing ? 'border-accent/70' : 'border-border',
        canDragToScene && 'cursor-grab active:cursor-grabbing',
      )}
    >
      <div className="flex items-start gap-2">
        <div
          className="flex size-8 shrink-0 items-center justify-center border border-border bg-surface text-muted"
          style={isMaterial ? { color: asset.material?.color ?? '#9eb4c8' } : undefined}
        >
          {thumbnail?.filename ? (
            <Image
              src={`/api/asset-artifacts/file/${encodeURIComponent(thumbnail.filename)}`}
              alt=""
              width={32}
              height={32}
              className="size-full object-cover"
            />
          ) : isMaterial ? (
            <Palette className="size-4" />
          ) : (
            <Box className="size-4" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          {isEditing ? (
            <div className="flex items-center gap-1">
              <input
                autoFocus
                value={name}
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') saveName();
                  if (event.key === 'Escape') {
                    setName(asset.name);
                    setIsEditing(false);
                  }
                }}
                className="h-6 min-w-0 flex-1 border border-border bg-surface px-1.5 text-xs text-foreground outline-none focus:border-accent"
                aria-label="Object name"
              />
              <Button
                size="icon"
                variant="ghost"
                disabled={isRenaming}
                onClick={saveName}
                title="Save object name"
              >
                <Check />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                disabled={isRenaming}
                onClick={() => {
                  setName(asset.name);
                  setIsEditing(false);
                }}
                title="Cancel rename"
              >
                <X />
              </Button>
            </div>
          ) : (
            <div className="flex min-w-0 items-center gap-1">
              <p className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
                {asset.name}
              </p>
              {hasSourceMesh && (
                <Button
                  size="icon"
                  variant="ghost"
                  className={cn(isPreviewing && 'text-accent')}
                  onClick={onPreview}
                  title="View 3D object"
                >
                  <Eye />
                </Button>
              )}
              <Button
                size="icon"
                variant="ghost"
                onClick={() => setIsEditing(true)}
                title="Rename object"
              >
                <Pencil />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                disabled={isDeleting}
                onClick={onDelete}
                title="Remove object"
              >
                <Trash2 className="text-danger" />
              </Button>
            </div>
          )}
          <p
            className={cn(
              'mt-0.5 text-[11px]',
              asset.processingStatus === 'ready' && 'text-info',
              asset.processingStatus === 'failed' && 'text-danger',
              !['ready', 'failed'].includes(asset.processingStatus) && 'text-muted',
            )}
          >
            {statusLabel(asset.processingStatus)}
          </p>
        </div>
      </div>
      {preparing && (
        <div className="mt-2 h-1 overflow-hidden bg-border">
          <div
            className="h-full bg-accent transition-[width]"
            style={{ width: `${asset.processingProgress ?? 20}%` }}
          />
        </div>
      )}
      {dimensions && <p className="mt-2 text-[11px] text-muted">{dimensions}</p>}
      {isMaterial && (
        <p className="mt-2 text-[11px] text-muted">
          {(asset.material?.metallic ?? 0).toFixed(2)} metallic ·{' '}
          {(asset.material?.roughness ?? 0.6).toFixed(2)} roughness
        </p>
      )}
      {asset.customSource && <p className="mt-2 text-[11px] text-muted">Custom MuJoCo shape</p>}
      {isObjectModel && <p className="mt-2 text-[11px] text-muted">Generated textured object</p>}
      {asset.processingStatus === 'failed' && asset.processingError && (
        <>
          <p className="mt-2 text-[11px] leading-4 text-danger">{asset.processingError}</p>
          {hasSourceMesh && (
            <Button
              size="sm"
              variant="outline"
              className="mt-2 w-full"
              disabled={isReprocessing}
              onClick={onReprocess}
              title="Retry mesh processing from the stored source file"
            >
              <RefreshCw />
              {isReprocessing ? 'Retrying processing' : 'Retry processing'}
            </Button>
          )}
        </>
      )}
      {asset.processingStatus === 'ready' &&
        !asset.primitive &&
        !asset.customSource &&
        !isObjectModel && (
          <p className="mt-2 text-[11px] text-muted">
            Placement will be available after the object preview is ready.
          </p>
        )}
      {asset.processingStatus === 'ready' && hasSourceMesh && (
        <Button
          size="sm"
          variant="outline"
          className="mt-2 w-full"
          disabled={isReprocessing}
          onClick={onReprocess}
          title="Regenerate the canonical mesh, thumbnail, and collision artifacts from the stored source file"
        >
          <RefreshCw />
          {isReprocessing ? 'Reprocessing' : 'Reprocess'}
        </Button>
      )}
      {isMaterial ? (
        <>
          {canApplyMaterialToFace && (
            <label className="mt-2 block text-[11px] text-muted">
              Texture face
              <select
                value={textureFace}
                onChange={(event) => onTextureFaceChange(event.target.value as BoxFace | 'all')}
                className="mt-1 h-8 w-full border border-border bg-surface px-2 text-xs text-foreground outline-none focus:border-accent"
              >
                <option value="all">All faces</option>
                {BOX_FACE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          <Button
            size="sm"
            variant="outline"
            className="mt-2 w-full"
            disabled={!hasSceneSelection || isApplyingMaterial}
            onClick={onApplyMaterial}
            title={
              hasSceneSelection
                ? 'Apply to the selected scene object'
                : 'Select a body or geom in the scene first'
            }
          >
            <Palette />
            {isApplyingMaterial ? 'Applying material' : 'Apply to selected'}
          </Button>
        </>
      ) : (
        <Button
          size="sm"
          variant="outline"
          className="mt-2 w-full"
          disabled={!canAddToScene || isAddingToScene}
          onClick={onAddToScene}
          title={
            canAddToScene
              ? 'Add object to the current scene'
              : 'Only ready objects with a supported mesh can be added to the scene'
          }
        >
          <Plus />
          {isAddingToScene ? 'Adding object' : 'Add to scene'}
        </Button>
      )}
    </article>
  );
}
