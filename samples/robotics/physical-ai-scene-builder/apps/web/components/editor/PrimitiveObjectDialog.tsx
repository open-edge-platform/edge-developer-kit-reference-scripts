// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client';

import { Button, cn } from '@mujoco-studio/ui';
import { Box, Code2, ImageUp, Loader2, Play, Square, X } from 'lucide-react';
import { useRef, useState } from 'react';

import {
  IMAGE_TO_3D_PIPELINE_TYPES,
  IMAGE_TO_3D_STAGES,
  type ImageTo3dEvent,
  type ImageTo3dPipelineType,
  type TrellisServiceState,
} from '@/lib/scenes/imageTo3dApi';

import {
  CUSTOM_GEOM_TYPES,
  parseCustomGeomDefinition,
  type PrimitiveGeomType,
  type PrimitiveObjectPlacement,
} from '@/lib/editor/document';

type NumberVector = [number, number, number];

const PRIMITIVE_GEOM_TYPES: readonly { value: PrimitiveGeomType; label: string }[] = [
  { value: 'box', label: 'Box' },
  { value: 'sphere', label: 'Sphere' },
  { value: 'capsule', label: 'Capsule' },
  { value: 'cylinder', label: 'Cylinder' },
  { value: 'ellipsoid', label: 'Ellipsoid' },
];
const DEFAULT_CUSTOM_GEOM =
  '<geom type="box" name="custom_box" pos="0 0 0.5" size="0.1 0.1 0.1" rgba="0.35 0.65 0.95 1" mass="1" friction="1 0.005 0.0001" />';

function hexColorToRgba(
  color: string,
  alpha: number,
): readonly [number, number, number, number] | null {
  const match = color.trim().match(/^#([a-f\d]{6})$/i);
  if (!match || !Number.isFinite(alpha) || alpha < 0 || alpha > 1) return null;
  const value = match[1];
  return [
    Number.parseInt(value.slice(0, 2), 16) / 255,
    Number.parseInt(value.slice(2, 4), 16) / 255,
    Number.parseInt(value.slice(4, 6), 16) / 255,
    alpha,
  ];
}

function updateNumberVector(values: NumberVector, index: number, value: number): NumberVector {
  return values.map((entry, entryIndex) => (entryIndex === index ? value : entry)) as NumberVector;
}

function defaultPrimitiveSize(type: PrimitiveGeomType): NumberVector {
  if (type === 'sphere') return [0.12, 0, 0];
  if (type === 'capsule' || type === 'cylinder') return [0.08, 0.2, 0];
  return [0.1, 0.1, 0.1];
}

export function PrimitiveObjectDialog({
  isPending,
  error,
  onClose,
  onSubmit,
  onCreateCustomShape,
  onCreateFromImage,
  imageService,
  imageServiceError,
  isStartingImageService,
  onStartImageService,
  isStoppingImageService,
  onStopImageService,
}: {
  isPending: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (placement: PrimitiveObjectPlacement) => void;
  onCreateCustomShape: (name: string, source: string) => Promise<void>;
  onCreateFromImage: (
    image: File,
    pipelineType: ImageTo3dPipelineType,
    onEvent: (event: ImageTo3dEvent) => void,
  ) => Promise<void>;
  imageService: TrellisServiceState | null;
  imageServiceError: string | null;
  isStartingImageService: boolean;
  onStartImageService: () => Promise<void>;
  isStoppingImageService: boolean;
  onStopImageService: () => Promise<void>;
}) {
  const [activeTab, setActiveTab] = useState<'general' | 'custom' | 'image'>('general');
  const [name, setName] = useState('New object');
  const [type, setType] = useState<PrimitiveGeomType>('box');
  const [position, setPosition] = useState<NumberVector>([0, 0, 0.5]);
  const [rotation, setRotation] = useState<NumberVector>([0, 0, 0]);
  const [size, setSize] = useState<NumberVector>(defaultPrimitiveSize('box'));
  const [color, setColor] = useState('#9eb4c8');
  const [opacity, setOpacity] = useState(1);
  const [mass, setMass] = useState(1);
  const [friction, setFriction] = useState<NumberVector>([1, 0.005, 0.0001]);
  const [customName, setCustomName] = useState('New custom shape');
  const [customSource, setCustomSource] = useState(DEFAULT_CUSTOM_GEOM);
  const [customError, setCustomError] = useState<string | null>(null);
  const [customPending, setCustomPending] = useState(false);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [pipelineType, setPipelineType] = useState<ImageTo3dPipelineType>('512');
  const [imageError, setImageError] = useState<string | null>(null);
  const [imagePending, setImagePending] = useState(false);
  const [imageStage, setImageStage] = useState<(typeof IMAGE_TO_3D_STAGES)[number] | null>(null);
  const [imageLogs, setImageLogs] = useState<string[]>([]);
  const imageInput = useRef<HTMLInputElement>(null);
  const imageServiceRunning = imageService?.status === 'running';
  const imageStageIndex = imageStage ? IMAGE_TO_3D_STAGES.indexOf(imageStage) : -1;
  const imageProgressPercent = imagePending
    ? Math.round(((imageStageIndex + 1) / IMAGE_TO_3D_STAGES.length) * 100)
    : 0;
  const sizeLabels =
    type === 'sphere'
      ? ['Radius']
      : type === 'capsule' || type === 'cylinder'
        ? ['Radius', 'Half length']
        : ['X', 'Y', 'Z'];
  const isBusy = isPending || customPending || imagePending;

  const submitCustomShape = async () => {
    const result = parseCustomGeomDefinition(customSource);
    if (!result.definition) {
      setCustomError(result.error ?? 'The MuJoCo definition is invalid.');
      return;
    }
    if (!customName.trim()) {
      setCustomError('Enter an object name.');
      return;
    }

    setCustomError(null);
    setCustomPending(true);
    try {
      await onCreateCustomShape(customName, customSource);
      setCustomPending(false);
      onClose();
    } catch (nextError) {
      setCustomError(nextError instanceof Error ? nextError.message : String(nextError));
      setCustomPending(false);
    }
  };

  const submitImage = async () => {
    if (!imageFile) {
      setImageError('Choose an image.');
      return;
    }

    setImageError(null);
    setImageLogs([]);
    setImageStage(null);
    setImagePending(true);
    try {
      await onCreateFromImage(imageFile, pipelineType, (event) => {
        if (event.type === 'stage') setImageStage(event.stage);
        else if (event.type === 'log') setImageLogs((lines) => [...lines.slice(-199), event.line]);
      });
      setImagePending(false);
      onClose();
    } catch (nextError) {
      setImageError(nextError instanceof Error ? nextError.message : String(nextError));
      setImagePending(false);
    }
  };
  const stopService = async () => {
    setImageError(null);
    try {
      await onStopImageService();
    } catch (error) {
      setImageError(error instanceof Error ? error.message : String(error));
    }
  };
  const startService = async () => {
    setImageError(null);
    try {
      await onStartImageService();
    } catch (error) {
      setImageError(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isBusy) onClose();
      }}
    >
      <section
        className="max-h-[calc(100vh-2rem)] w-full max-w-md overflow-y-auto border border-border bg-surface shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-object-title"
      >
        <header className="flex items-start justify-between border-b border-border px-4 py-3">
          <div>
            <h2 id="create-object-title" className="text-sm font-medium text-foreground">
              Create object
            </h2>
            <p className="mt-1 text-[11px] leading-4 text-muted">
              Choose a guided geom form or enter a MuJoCo definition directly.
            </p>
          </div>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            onClick={onClose}
            disabled={isBusy}
            title="Close create object form"
          >
            <X />
          </Button>
        </header>
        <div
          role="tablist"
          aria-label="Create object mode"
          className="grid grid-cols-3 border-b border-border px-3 pt-2"
        >
          <Button
            type="button"
            role="tab"
            aria-selected={activeTab === 'general'}
            variant={activeTab === 'general' ? 'outline' : 'ghost'}
            disabled={isBusy}
            className={cn(
              'h-auto min-h-8 whitespace-normal rounded-none border-x-0 border-t-0 px-2 py-1.5 text-center leading-3',
              activeTab === 'general'
                ? 'border-b-2 border-accent text-accent'
                : 'border-b-2 border-transparent',
            )}
            onClick={() => setActiveTab('general')}
          >
            General Geom
          </Button>
          <Button
            type="button"
            role="tab"
            aria-selected={activeTab === 'custom'}
            variant={activeTab === 'custom' ? 'outline' : 'ghost'}
            disabled={isBusy}
            className={cn(
              'h-auto min-h-8 whitespace-normal rounded-none border-x-0 border-t-0 px-2 py-1.5 text-center leading-3',
              activeTab === 'custom'
                ? 'border-b-2 border-accent text-accent'
                : 'border-b-2 border-transparent',
            )}
            onClick={() => setActiveTab('custom')}
          >
            Custom MuJoCo Shape (Experimental)
          </Button>
          <Button
            type="button"
            role="tab"
            aria-selected={activeTab === 'image'}
            variant={activeTab === 'image' ? 'outline' : 'ghost'}
            disabled={isBusy}
            className={cn(
              'h-auto min-h-8 whitespace-normal rounded-none border-x-0 border-t-0 px-2 py-1.5 text-center leading-3',
              activeTab === 'image'
                ? 'border-b-2 border-accent text-accent'
                : 'border-b-2 border-transparent',
            )}
            onClick={() => setActiveTab('image')}
          >
            Image to 3D model (Experimental)
          </Button>
        </div>
        <form
          className="space-y-4 p-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (activeTab === 'custom') {
              submitCustomShape();
              return;
            }
            if (activeTab === 'image') {
              if (!imageServiceRunning) {
                startService();
                return;
              }
              submitImage();
              return;
            }
            const rgba = hexColorToRgba(color, opacity);
            if (!rgba || isPending) return;
            onSubmit({ name, type, position, rotation, size, rgba, mass, friction });
          }}
        >
          {activeTab === 'general' ? (
            <>
              <label className="block text-[11px] text-muted">
                Object name
                <input
                  required
                  autoFocus
                  name="object-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  className="mt-1 h-8 w-full border border-border bg-surface-raised px-2 text-xs text-foreground outline-none focus:border-accent"
                />
              </label>

              <label className="block text-[11px] text-muted">
                Geom type
                <select
                  value={type}
                  onChange={(event) => {
                    const nextType = event.target.value as PrimitiveGeomType;
                    setType(nextType);
                    setSize(defaultPrimitiveSize(nextType));
                  }}
                  className="mt-1 h-8 w-full border border-border bg-surface-raised px-2 text-xs text-foreground outline-none focus:border-accent"
                >
                  {PRIMITIVE_GEOM_TYPES.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <fieldset className="border border-dashed border-border bg-surface-raised p-3">
                <legend className="px-1 text-[11px] text-muted">Position</legend>
                <NumberVectorFields
                  labels={['X', 'Y', 'Z']}
                  values={position}
                  onChange={(index, value) =>
                    setPosition(updateNumberVector(position, index, value))
                  }
                />
              </fieldset>

              <fieldset className="border border-dashed border-border bg-surface-raised p-3">
                <legend className="px-1 text-[11px] text-muted">Rotation (degrees)</legend>
                <NumberVectorFields
                  labels={['X', 'Y', 'Z']}
                  values={rotation}
                  onChange={(index, value) =>
                    setRotation(updateNumberVector(rotation, index, value))
                  }
                />
              </fieldset>

              <fieldset className="border border-dashed border-border bg-surface-raised p-3">
                <legend className="px-1 text-[11px] text-muted">Dimensions (meters)</legend>
                <NumberVectorFields
                  labels={sizeLabels}
                  values={size}
                  min={0.001}
                  onChange={(index, value) => setSize(updateNumberVector(size, index, value))}
                />
                <p className="mt-2 text-[11px] leading-4 text-muted">
                  {type === 'sphere'
                    ? 'Sphere uses a radius.'
                    : type === 'capsule' || type === 'cylinder'
                      ? 'Use radius and half length.'
                      : 'Use the X, Y, and Z half-sizes.'}
                </p>
              </fieldset>

              <fieldset className="border border-dashed border-border bg-surface-raised p-3">
                <legend className="px-1 text-[11px] text-muted">Appearance</legend>
                <div className="grid grid-cols-[1fr_1.5fr] items-center gap-3">
                  <label className="flex items-center justify-between gap-2 text-[11px] text-muted">
                    Color
                    <input
                      type="color"
                      value={color}
                      onChange={(event) => setColor(event.target.value)}
                      className="h-8 w-14 border border-border bg-surface-raised p-0.5"
                      aria-label="Object color"
                    />
                  </label>
                  <label className="grid grid-cols-[3.5rem_minmax(0,1fr)_2rem] items-center gap-2 text-[11px] text-muted">
                    <span>Opacity</span>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={opacity}
                      onChange={(event) => setOpacity(Number(event.target.value))}
                      className="w-full accent-accent"
                    />
                    <span className="text-right tabular-nums">{opacity.toFixed(2)}</span>
                  </label>
                </div>
              </fieldset>

              <fieldset className="border border-dashed border-border bg-surface-raised p-3">
                <legend className="px-1 text-[11px] text-muted">Physics</legend>
                <label className="grid grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-2 text-[11px] text-muted">
                  <span>Mass (kg)</span>
                  <input
                    type="number"
                    min={0.001}
                    step="any"
                    value={mass}
                    onChange={(event) => setMass(Number(event.target.value))}
                    className="h-8 w-full border border-border bg-surface px-2 text-xs text-foreground outline-none focus:border-accent"
                  />
                </label>
                <div className="mt-3">
                  <p className="mb-2 text-[11px] text-muted">Friction</p>
                  <NumberVectorFields
                    labels={['Sliding', 'Torsional', 'Rolling']}
                    values={friction}
                    min={0}
                    step="any"
                    onChange={(index, value) =>
                      setFriction(updateNumberVector(friction, index, value))
                    }
                  />
                </div>
              </fieldset>
            </>
          ) : activeTab === 'custom' ? (
            <div className="space-y-3">
              <label className="block text-[11px] text-muted">
                Object name
                <input
                  required
                  autoFocus
                  name="custom-object-name"
                  value={customName}
                  onChange={(event) => setCustomName(event.target.value)}
                  className="mt-1 h-8 w-full border border-border bg-surface-raised px-2 text-xs text-foreground outline-none focus:border-accent"
                />
              </label>
              <label className="block text-[11px] text-muted">
                MuJoCo geom or body definition
                <textarea
                  required
                  rows={8}
                  spellCheck={false}
                  wrap="off"
                  value={customSource}
                  onChange={(event) => {
                    setCustomSource(event.target.value);
                    if (customError) setCustomError(null);
                  }}
                  className="mt-1 min-h-44 max-h-80 w-full resize-y overflow-auto whitespace-pre border border-border bg-surface-raised px-2 py-2 font-mono text-[11px] leading-relaxed text-foreground outline-none focus:border-accent"
                  aria-describedby="custom-geom-help"
                />
              </label>
              <p id="custom-geom-help" className="text-[11px] leading-4 text-muted">
                Enter one <code className="text-muted-foreground">&lt;geom ... /&gt;</code> or{' '}
                <code className="text-muted-foreground">&lt;body&gt;...&lt;/body&gt;</code>{' '}
                definition. Bodies can contain a{' '}
                <code className="text-muted-foreground">&lt;freejoint /&gt;</code> and multiple
                geoms. Types: {CUSTOM_GEOM_TYPES.join(', ')}.
              </p>
            </div>
          ) : !imageServiceRunning ? (
            <div className="space-y-3">
              <fieldset className="min-w-0 border border-dashed border-border bg-surface-raised p-3">
                <legend className="px-1 text-[11px] text-muted">Image-to-3D service</legend>
                <p className="text-[11px] leading-4 text-muted">
                  {!imageService
                    ? 'Checking the TRELLIS.2 service…'
                    : imageService.status === 'starting'
                      ? 'Starting TRELLIS.2 (first run can take a while to load the model)…'
                      : imageService.status === 'error'
                        ? (imageService.error ?? 'TRELLIS.2 failed to start.')
                        : 'TRELLIS.2 is not running. Start it to enable image-to-3D.'}
                </p>
                <p className="mt-2 text-[11px] leading-4 text-muted">
                  {imageService?.gpuAvailable
                    ? 'GPU render node detected; Intel XPU compatibility is not verified.'
                    : 'No GPU render node detected on this host. An external service may still have a GPU.'}
                </p>
                {imageService && imageService.logs.length > 0 && (
                  <pre className="mt-2 max-h-32 overflow-y-auto whitespace-pre-wrap break-all border border-border bg-black/80 p-2 font-mono text-[10px] leading-relaxed text-green-400">
                    {imageService.logs.slice(-40).join('\n')}
                  </pre>
                )}
                {imageService?.status === 'starting' && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="mt-2 w-full"
                    disabled={isStoppingImageService}
                    onClick={() => void stopService()}
                  >
                    <Square />
                    {isStoppingImageService ? 'Stopping' : 'Cancel starting'}
                  </Button>
                )}
              </fieldset>
            </div>
          ) : (
            <div className="space-y-3">
              <fieldset className="min-w-0 border border-dashed border-border bg-surface-raised p-3">
                <legend className="px-1 text-[11px] text-muted">Source image</legend>
                <input
                  ref={imageInput}
                  className="hidden"
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={(event) => {
                    const file = event.currentTarget.files?.[0] ?? null;
                    event.currentTarget.value = '';
                    if (file) {
                      setImageFile(file);
                      if (imageError) setImageError(null);
                    }
                  }}
                />
                <div className="flex min-w-0 items-center gap-2">
                  <ImageUp className="size-4 shrink-0 text-muted" />
                  <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                    {imageFile ? imageFile.name : 'No image selected'}
                  </span>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="mt-2 w-full"
                  disabled={isBusy}
                  onClick={() => imageInput.current?.click()}
                >
                  <ImageUp />
                  {imageFile ? 'Change image' : 'Select image'}
                </Button>
                <p className="mt-2 text-[11px] leading-4 text-muted">PNG, JPEG, or WebP images.</p>
              </fieldset>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="w-full"
                disabled={imagePending || isStoppingImageService || !imageService?.pid}
                onClick={() => void stopService()}
              >
                <Square />
                {isStoppingImageService ? 'Stopping service' : 'Stop image-to-3D service'}
              </Button>
              {!imageService?.pid && (
                <p className="text-[11px] text-muted">
                  Externally managed service; stop it on its host.
                </p>
              )}
              <label className="block text-[11px] text-muted">
                Quality
                <select
                  value={pipelineType}
                  disabled={isBusy}
                  onChange={(event) => setPipelineType(event.target.value as ImageTo3dPipelineType)}
                  className="mt-1 h-8 w-full border border-border bg-surface-raised px-2 text-xs text-foreground outline-none focus:border-accent"
                >
                  {IMAGE_TO_3D_PIPELINE_TYPES.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </label>
              <p className="text-[11px] leading-4 text-muted">
                Generates a 3D model with TRELLIS.2, then converts it to MJCF. Higher quality takes
                longer. This can take a few minutes.
              </p>
              {imagePending && (
                <div className="space-y-2">
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-raised">
                    <div
                      className="h-full bg-accent transition-[width]"
                      style={{ width: `${Math.max(imageProgressPercent, 6)}%` }}
                    />
                  </div>
                  <p className="text-[11px] leading-4 text-muted">
                    {imageStage === 'generating'
                      ? 'Generating 3D model with TRELLIS.2…'
                      : imageStage === 'converting-mesh'
                        ? 'Converting mesh with glb2obj…'
                        : imageStage === 'converting-mjcf'
                          ? 'Converting to MJCF with obj2mjcf…'
                          : 'Starting…'}
                  </p>
                  <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap break-all border border-border bg-black/80 p-2 font-mono text-[10px] leading-relaxed text-green-400">
                    {imageLogs.length > 0 ? imageLogs.join('\n') : 'Waiting for output…'}
                  </pre>
                </div>
              )}
            </div>
          )}

          {(activeTab === 'custom'
            ? customError
            : activeTab === 'image'
              ? (imageError ?? imageServiceError)
              : error) && (
            <p role="alert" className="text-xs text-danger">
              {activeTab === 'custom'
                ? customError
                : activeTab === 'image'
                  ? (imageError ?? imageServiceError)
                  : error}
            </p>
          )}
          <div className="flex justify-end gap-2 border-t border-border pt-3">
            <Button type="button" variant="ghost" onClick={onClose} disabled={isBusy}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={
                isBusy ||
                (activeTab === 'image' &&
                  !imageServiceRunning &&
                  (isStartingImageService || imageService?.status === 'starting' || !imageService))
              }
            >
              {activeTab === 'general' ? (
                <>
                  <Box />
                  {isPending ? 'Creating object' : 'Create object'}
                </>
              ) : activeTab === 'custom' ? (
                <>
                  <Code2 />
                  {customPending ? 'Creating shape' : 'Create shape'}
                </>
              ) : !imageServiceRunning ? (
                <>
                  {isStartingImageService || imageService?.status === 'starting' ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <Play />
                  )}
                  {imageService?.status === 'starting'
                    ? 'Starting service'
                    : 'Start image-to-3D service'}
                </>
              ) : (
                <>
                  <ImageUp />
                  {imagePending ? 'Generating model' : 'Generate model'}
                </>
              )}
            </Button>
          </div>
        </form>
      </section>
    </div>
  );
}

function NumberVectorFields({
  labels,
  values,
  min,
  step = 'any',
  onChange,
}: {
  labels: readonly string[];
  values: NumberVector;
  min?: number;
  step?: number | 'any';
  onChange: (index: number, value: number) => void;
}) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {labels.map((label, index) => (
        <label key={label} className="min-w-0 text-[10px] text-muted">
          <span className="block truncate">{label}</span>
          <input
            type="number"
            min={min}
            step={step}
            value={values[index]}
            onChange={(event) => onChange(index, Number(event.target.value))}
            className="mt-1 h-8 w-full min-w-0 border border-border bg-surface px-2 text-xs text-foreground outline-none focus:border-accent"
          />
        </label>
      ))}
    </div>
  );
}
