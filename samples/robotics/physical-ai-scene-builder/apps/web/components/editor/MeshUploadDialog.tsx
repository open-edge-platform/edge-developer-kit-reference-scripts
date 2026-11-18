// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client';

import { Button } from '@mujoco-studio/ui';
import { FileUp, X } from 'lucide-react';
import type { FormEvent } from 'react';

import {
  MATERIAL_CATEGORIES,
  type AssetCategory,
  type CollisionStrategy,
  type MeshSourceUnit,
  type MeshSourceUpAxis,
} from '@/lib/scenes/assetsApi';

export function MeshUploadDialog({
  file,
  name,
  category,
  unit,
  upAxis,
  collisionStrategy,
  fileInput,
  mtlFile,
  textureFiles,
  mtlInput,
  textureInput,
  isPending,
  error,
  onClose,
  onNameChange,
  onCategoryChange,
  onUnitChange,
  onUpAxisChange,
  onCollisionStrategyChange,
  onFileChange,
  onMtlFileChange,
  onTextureFilesChange,
  onSubmit,
}: {
  file: File | null;
  name: string;
  category: AssetCategory;
  unit: MeshSourceUnit;
  upAxis: MeshSourceUpAxis;
  collisionStrategy: CollisionStrategy;
  fileInput: { current: HTMLInputElement | null };
  mtlFile: File | null;
  textureFiles: readonly File[];
  mtlInput: { current: HTMLInputElement | null };
  textureInput: { current: HTMLInputElement | null };
  isPending: boolean;
  error: string | null;
  onClose: () => void;
  onNameChange: (value: string) => void;
  onCategoryChange: (value: AssetCategory) => void;
  onUnitChange: (value: MeshSourceUnit) => void;
  onUpAxisChange: (value: MeshSourceUpAxis) => void;
  onCollisionStrategyChange: (value: CollisionStrategy) => void;
  onFileChange: (file: File | null) => void;
  onMtlFileChange: (file: File | null) => void;
  onTextureFilesChange: (files: readonly File[]) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isPending) onClose();
      }}
    >
      <section
        className="max-h-[calc(100vh-2rem)] w-full max-w-md overflow-y-auto border border-border bg-surface shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="upload-object-title"
      >
        <header className="flex items-start justify-between border-b border-border px-4 py-3">
          <div>
            <h2 id="upload-object-title" className="text-sm font-medium text-foreground">
              Upload object
            </h2>
            <p className="mt-1 text-[11px] leading-4 text-muted">
              Choose a mesh file and the category that will help you find it later.
            </p>
          </div>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            onClick={onClose}
            disabled={isPending}
            title="Close upload form"
          >
            <X />
          </Button>
        </header>
        <form className="space-y-4 p-4" onSubmit={onSubmit}>
          <fieldset className="min-w-0 border border-dashed border-border bg-surface-raised p-3">
            <legend className="px-1 text-[11px] text-muted">Object file</legend>
            <div className="flex min-w-0 items-center gap-2">
              <FileUp className="size-4 shrink-0 text-muted" />
              <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                {file ? file.name : 'No file selected'}
              </span>
              {file && (
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  onClick={() => onFileChange(null)}
                  title="Remove selected file"
                >
                  <X />
                </Button>
              )}
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="mt-2 w-full"
              onClick={() => fileInput.current?.click()}
            >
              <FileUp />
              {file ? 'Change file' : 'Select file'}
            </Button>
            <p className="mt-2 text-[11px] leading-4 text-muted">
              GLB, OBJ, or STL files up to 200 MB; OBJ + MTL conversion accepts up to 500 MB per
              file.
            </p>
          </fieldset>

          {file?.name.toLowerCase().endsWith('.obj') && (
            <>
              <fieldset className="min-w-0 border border-dashed border-border bg-surface-raised p-3">
                <legend className="px-1 text-[11px] text-muted">Material file</legend>
                <div className="flex min-w-0 items-center gap-2">
                  <FileUp className="size-4 shrink-0 text-muted" />
                  <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                    {mtlFile ? mtlFile.name : 'No MTL selected'}
                  </span>
                  {mtlFile && (
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      onClick={() => onMtlFileChange(null)}
                      title="Remove material file"
                    >
                      <X />
                    </Button>
                  )}
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="mt-2 w-full"
                  onClick={() => mtlInput.current?.click()}
                >
                  <FileUp />
                  {mtlFile ? 'Change .mtl' : 'Select .mtl'}
                </Button>
              </fieldset>

              <fieldset className="min-w-0 border border-dashed border-border bg-surface-raised p-3">
                <legend className="px-1 text-[11px] text-muted">
                  Texture images <span className="text-muted-foreground">(optional)</span>
                </legend>
                {textureFiles.length > 0 && (
                  <ul className="space-y-1">
                    {textureFiles.map((texture, index) => (
                      <li
                        key={`${texture.name}-${index}`}
                        className="flex min-w-0 items-center gap-2"
                      >
                        <FileUp className="size-4 shrink-0 text-muted" />
                        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                          {texture.name}
                        </span>
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          onClick={() =>
                            onTextureFilesChange(
                              textureFiles.filter((_, fileIndex) => fileIndex !== index),
                            )
                          }
                          title="Remove texture"
                        >
                          <X />
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="mt-2 w-full"
                  onClick={() => textureInput.current?.click()}
                >
                  <FileUp />
                  Add PNG/JPEG textures
                </Button>
                <p className="mt-2 text-[11px] leading-4 text-muted">
                  Select the images referenced by the MTL. With an MTL selected, the OBJ is
                  converted and added with its materials.
                </p>
              </fieldset>
            </>
          )}

          <label className="block text-[11px] text-muted">
            Name <span className="text-muted-foreground">(optional)</span>
            <input
              name="object-name"
              disabled={Boolean(mtlFile)}
              value={name}
              onChange={(event) => onNameChange(event.target.value)}
              placeholder="Uses the file name when empty"
              className="mt-1 h-8 w-full border border-border bg-surface-raised px-2 text-xs text-foreground outline-none placeholder:text-muted focus:border-accent"
            />
          </label>

          <label className="block text-[11px] text-muted">
            Category
            <select
              disabled={Boolean(mtlFile)}
              value={category}
              onChange={(event) => onCategoryChange(event.target.value as AssetCategory)}
              className="mt-1 h-8 w-full border border-border bg-surface-raised px-2 text-xs text-foreground outline-none focus:border-accent"
            >
              {MATERIAL_CATEGORIES.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>

          <fieldset
            disabled={Boolean(mtlFile)}
            className="space-y-3 border border-border bg-surface-raised p-3"
          >
            <legend className="px-1 text-[11px] text-muted">Calibration</legend>
            <label className="block text-[11px] text-muted">
              Source unit
              <select
                aria-label="Source unit"
                value={unit}
                onChange={(event) => onUnitChange(event.target.value as MeshSourceUnit)}
                className="mt-1 h-8 w-full border border-border bg-surface px-2 text-xs text-foreground outline-none focus:border-accent"
              >
                <option value="m">Metres</option>
                <option value="cm">Centimetres</option>
                <option value="mm">Millimetres</option>
              </select>
            </label>
            <label className="block text-[11px] text-muted">
              Source up axis
              <select
                aria-label="Source up axis"
                value={upAxis}
                onChange={(event) => onUpAxisChange(event.target.value as MeshSourceUpAxis)}
                className="mt-1 h-8 w-full border border-border bg-surface px-2 text-xs text-foreground outline-none focus:border-accent"
              >
                <option value="y">Y-up</option>
                <option value="z">Z-up</option>
              </select>
            </label>
            <label className="block text-[11px] text-muted">
              Collision
              <select
                aria-label="Collision strategy"
                value={collisionStrategy}
                onChange={(event) =>
                  onCollisionStrategyChange(event.target.value as CollisionStrategy)
                }
                className="mt-1 h-8 w-full border border-border bg-surface px-2 text-xs text-foreground outline-none focus:border-accent"
              >
                <option value="box">Box collider</option>
                <option value="convex-hull">Convex hull (mesh)</option>
                <option value="none">Visual only</option>
              </select>
            </label>
            <p className="text-[10px] leading-4 text-muted">
              {mtlFile
                ? 'OBJ + MTL conversion adds the object directly, using its source scale and Y-up orientation. Calibrate it in the inspector after insertion.'
                : 'Meshes are converted to metres and MuJoCo Z-up before placement.'}
            </p>
          </fieldset>

          {error && <p className="text-xs text-danger">{error}</p>}
          <div className="flex justify-end gap-2 border-t border-border pt-3">
            <Button type="button" variant="ghost" onClick={onClose} disabled={isPending}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={!file || isPending}>
              <FileUp />
              {isPending
                ? mtlFile
                  ? 'Converting object'
                  : 'Uploading object'
                : mtlFile
                  ? 'Convert and add'
                  : 'Upload object'}
            </Button>
          </div>
        </form>
      </section>
    </div>
  );
}
