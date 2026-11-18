// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client';

import { Button } from '@mujoco-studio/ui';
import { ImagePlus, Palette, X } from 'lucide-react';
import type { FormEvent } from 'react';

export function MaterialFormDialog({
  materialName,
  materialColor,
  materialMetallic,
  materialRoughness,
  textureFile,
  textureInput,
  isPending,
  error,
  onClose,
  onNameChange,
  onColorChange,
  onMetallicChange,
  onRoughnessChange,
  onTextureClear,
  onSubmit,
}: {
  materialName: string;
  materialColor: string;
  materialMetallic: number;
  materialRoughness: number;
  textureFile: File | null;
  textureInput: { current: HTMLInputElement | null };
  isPending: boolean;
  error: string | null;
  onClose: () => void;
  onNameChange: (value: string) => void;
  onColorChange: (value: string) => void;
  onMetallicChange: (value: number) => void;
  onRoughnessChange: (value: number) => void;
  onTextureClear: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="max-h-[calc(100vh-2rem)] w-full max-w-md overflow-y-auto border border-border bg-surface shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-material-title"
      >
        <header className="flex items-start justify-between border-b border-border px-4 py-3">
          <div>
            <h2 id="create-material-title" className="text-sm font-medium text-foreground">
              Create material
            </h2>
            <p className="mt-1 text-[11px] leading-4 text-muted">
              Define an appearance, then apply it to a selected mesh.
            </p>
          </div>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            onClick={onClose}
            title="Close material form"
          >
            <X />
          </Button>
        </header>
        <form className="space-y-4 p-4" onSubmit={onSubmit}>
          <label className="block text-[11px] text-muted">
            Material name
            <input
              required
              autoFocus
              name="material-name"
              value={materialName}
              onChange={(event) => onNameChange(event.target.value)}
              className="mt-1 h-8 w-full border border-border bg-surface-raised px-2 text-xs text-foreground outline-none focus:border-accent"
            />
          </label>

          {!textureFile ? (
            <label className="flex items-center justify-between gap-2 text-[11px] text-muted">
              Color
              <input
                type="color"
                value={materialColor}
                onChange={(event) => onColorChange(event.target.value)}
                className="h-8 w-14 border border-border bg-surface-raised p-0.5"
                aria-label="Material color"
              />
            </label>
          ) : (
            <p className="text-[11px] leading-4 text-muted">
              The image supplies this material&apos;s color.
            </p>
          )}

          <MaterialRange label="Metallic" value={materialMetallic} onChange={onMetallicChange} />
          <MaterialRange label="Roughness" value={materialRoughness} onChange={onRoughnessChange} />

          <fieldset className="min-w-0 border border-dashed border-border bg-surface-raised p-3">
            <legend className="px-1 text-[11px] text-muted">Texture image (optional)</legend>
            <p className="mb-2 text-[11px] leading-4 text-muted">
              PNG or JPG image applied through this material.
            </p>
            <div className="min-w-0 rounded border border-border bg-surface p-2">
              <div className="flex min-w-0 items-center gap-2">
                <ImagePlus className="size-4 shrink-0 text-muted" />
                <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
                  {textureFile ? textureFile.name : 'No image selected'}
                </span>
                {textureFile && (
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    onClick={onTextureClear}
                    title="Remove texture image"
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
                onClick={() => textureInput.current?.click()}
              >
                <ImagePlus />
                {textureFile ? 'Change image' : 'Select image'}
              </Button>
            </div>
          </fieldset>

          {error && <p className="text-xs text-danger">{error}</p>}
          <div className="flex justify-end gap-2 border-t border-border pt-3">
            <Button type="button" variant="ghost" onClick={onClose} disabled={isPending}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={isPending}>
              <Palette />
              {isPending ? 'Creating material' : 'Create material'}
            </Button>
          </div>
        </form>
      </section>
    </div>
  );
}

function MaterialRange({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="grid grid-cols-[4.5rem_minmax(0,1fr)_2rem] items-center gap-2 text-[11px] text-muted">
      <span>{label}</span>
      <input
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-full accent-accent"
      />
      <span className="text-right tabular-nums">{value.toFixed(2)}</span>
    </label>
  );
}
