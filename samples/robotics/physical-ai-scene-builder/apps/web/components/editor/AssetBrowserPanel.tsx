// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client';

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Panel, PanelBody, PanelHeader, cn } from '@mujoco-studio/ui';
import { Box, FileUp, Plus, Search, SlidersHorizontal } from 'lucide-react';
import { useDeferredValue, useRef, useState } from 'react';

import type { BoxFace, MeshObjectPlacement, PrimitiveObjectPlacement } from '@/lib/editor/document';
import { listRobotMeshReferences } from '@/lib/scenes/api';
import {
  CATEGORIES,
  createCustomAsset,
  createMaterial,
  createPrimitiveAsset,
  deleteAsset,
  queryAssets,
  reprocessAsset,
  updateAssetName,
  uploadAsset,
  uploadMaterialTexture,
  type AssetCategory,
  type AssetKind,
  type CollisionStrategy,
  type MeshSourceUnit,
  type MeshSourceUpAxis,
  type SceneAsset,
} from '@/lib/scenes/assetsApi';
import { convertObjToMjcf, type Obj2MjcfConversion } from '@/lib/scenes/obj2mjcfApi';
import {
  convertImageTo3d,
  getImageTo3dServiceStatus,
  startImageTo3dService,
  stopImageTo3dService,
  type ImageTo3dEvent,
  type ImageTo3dPipelineType,
} from '@/lib/scenes/imageTo3dApi';

import { AssetCard } from './AssetCard';
import type { PreviewableAsset } from './AssetPreview';
import { MaterialFormDialog } from './MaterialFormDialog';
import { MeshUploadDialog } from './MeshUploadDialog';
import { PrimitiveObjectDialog } from './PrimitiveObjectDialog';

export type { SceneAsset, SceneAssetArtifact } from '@/lib/scenes/assetsApi';

const ASSET_KINDS: readonly AssetKind[] = ['mesh', 'material'];
const ACCEPTED_MESH_FILES = '.glb,.obj,.stl';

export function AssetBrowserPanel({
  previewAssetId,
  onPreviewAsset,
  onAddToScene,
  onAddObjectModel,
  onDragAsset,
  hasSceneSelection,
  canApplyMaterialToFace,
  onApplyMaterial,
}: {
  previewAssetId: number | null;
  onPreviewAsset: (asset: PreviewableAsset) => void;
  onAddToScene: (
    asset: SceneAsset,
    placement?: PrimitiveObjectPlacement | MeshObjectPlacement,
  ) => Promise<void>;
  onAddObjectModel: (conversion: Obj2MjcfConversion) => Promise<void>;
  onDragAsset: (asset: SceneAsset | null) => void;
  hasSceneSelection: boolean;
  canApplyMaterialToFace: boolean;
  onApplyMaterial: (asset: SceneAsset, face: BoxFace | null) => Promise<void>;
}) {
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const textureInput = useRef<HTMLInputElement>(null);
  const mtlInput = useRef<HTMLInputElement>(null);
  const objTextureInput = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<AssetKind>('mesh');
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>('all');
  const [textureFace, setTextureFace] = useState<BoxFace | 'all'>('all');
  const [uploadCategory, setUploadCategory] = useState<AssetCategory>('general');
  const [search, setSearch] = useState('');
  const [managementError, setManagementError] = useState<string | null>(null);
  const [materialName, setMaterialName] = useState('New material');
  const [materialColor, setMaterialColor] = useState('#9eb4c8');
  const [materialMetallic, setMaterialMetallic] = useState(0);
  const [materialRoughness, setMaterialRoughness] = useState(0.6);
  const [textureFile, setTextureFile] = useState<File | null>(null);
  const [materialFormOpen, setMaterialFormOpen] = useState(false);
  const [meshFormOpen, setMeshFormOpen] = useState(false);
  const [primitiveFormOpen, setPrimitiveFormOpen] = useState(false);
  const [meshFile, setMeshFile] = useState<File | null>(null);
  const [meshName, setMeshName] = useState('');
  const [mtlFile, setMtlFile] = useState<File | null>(null);
  const [objTextureFiles, setObjTextureFiles] = useState<File[]>([]);
  const [uploadUnit, setUploadUnit] = useState<MeshSourceUnit>('m');
  const [uploadUpAxis, setUploadUpAxis] = useState<MeshSourceUpAxis>('z');
  const [uploadCollisionStrategy, setUploadCollisionStrategy] = useState<CollisionStrategy>('box');
  const deferredSearch = useDeferredValue(search.trim());

  const robotMeshesQuery = useQuery({
    queryKey: ['robot-mesh-ids'],
    queryFn: listRobotMeshReferences,
    retry: false,
  });
  const robotMeshes = robotMeshesQuery.data ?? [];
  const assets = useInfiniteQuery({
    queryKey: ['assets', kind, category, deferredSearch, robotMeshes],
    queryFn: ({ pageParam }) =>
      queryAssets({
        page: pageParam,
        kind,
        category,
        search: deferredSearch,
        robotMeshes: kind === 'mesh' ? robotMeshes : [],
      }),
    initialPageParam: 1,
    getNextPageParam: (lastPage) => (lastPage.hasNextPage ? lastPage.nextPage : undefined),
    enabled: kind === 'material' || robotMeshesQuery.isSuccess,
    retry: false,
  });
  const upload = useMutation({
    mutationFn: uploadAsset,
    onSuccess: () => {
      setMeshFormOpen(false);
      setMeshFile(null);
      setMeshName('');
      setUploadUnit('m');
      setUploadUpAxis('z');
      setUploadCollisionStrategy('box');
      return queryClient.invalidateQueries({ queryKey: ['assets'] });
    },
  });
  const createObject = useMutation({
    mutationFn: async (placement: PrimitiveObjectPlacement) => {
      await createPrimitiveAsset({
        name: placement.name,
        category: 'general',
        primitive: placement,
      });
      return queryClient.invalidateQueries({ queryKey: ['assets'] });
    },
    onSuccess: () => setPrimitiveFormOpen(false),
  });
  const createCustomShape = useMutation({
    mutationFn: ({ name, source }: { name: string; source: string }) =>
      createCustomAsset({ name, source, category: 'general' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['assets'] }),
  });
  const createFromImage = useMutation({
    mutationFn: async ({
      image,
      pipelineType,
      onEvent,
    }: {
      image: File;
      pipelineType: ImageTo3dPipelineType;
      onEvent: (event: ImageTo3dEvent) => void;
    }) => {
      let conversion: Obj2MjcfConversion;
      try {
        conversion = await convertImageTo3d({ image, pipelineType, onEvent });
      } finally {
        // The pipeline saves the object to the library, so list it even if placement fails.
        queryClient.invalidateQueries({ queryKey: ['assets'] });
      }
      await onAddObjectModel(conversion);
    },
  });
  const imageServiceStatus = useQuery({
    queryKey: ['image-to-3d-service'],
    queryFn: getImageTo3dServiceStatus,
    enabled: primitiveFormOpen,
    refetchInterval: primitiveFormOpen ? 2_000 : false,
    retry: false,
  });
  const startImageService = useMutation({
    mutationFn: startImageTo3dService,
    onSuccess: () => imageServiceStatus.refetch(),
  });
  const stopImageService = useMutation({
    mutationFn: stopImageTo3dService,
    onSuccess: () => imageServiceStatus.refetch(),
  });
  const imageServiceError =
    imageServiceStatus.error ?? startImageService.error ?? stopImageService.error;
  const create = useMutation({
    mutationFn: async ({
      name,
      color,
      metallic,
      roughness,
      textureFile,
    }: {
      name: string;
      color: string;
      metallic: number;
      roughness: number;
      textureFile: File | null;
    }) => {
      const texture = textureFile ? await uploadMaterialTexture(textureFile) : null;
      return createMaterial({ name, color, metallic, roughness, texture: texture?.id ?? null });
    },
    onSuccess: () => {
      setTextureFile(null);
      setMaterialFormOpen(false);
      return queryClient.invalidateQueries({ queryKey: ['assets'] });
    },
  });
  const rename = useMutation({
    mutationFn: updateAssetName,
    onSuccess: () => {
      setManagementError(null);
      return queryClient.invalidateQueries({ queryKey: ['assets'] });
    },
    onError: (error) => setManagementError(error.message),
  });
  const remove = useMutation({
    mutationFn: deleteAsset,
    onSuccess: () => {
      setManagementError(null);
      return queryClient.invalidateQueries({ queryKey: ['assets'] });
    },
    onError: (error) => setManagementError(error.message),
  });
  const reprocess = useMutation({
    mutationFn: reprocessAsset,
    onSuccess: () => {
      setManagementError(null);
      return queryClient.invalidateQueries({ queryKey: ['assets'] });
    },
    onError: (error) => setManagementError(error.message),
  });
  const addToScene = useMutation({
    mutationFn: (asset: SceneAsset) => onAddToScene(asset),
    onError: (error) => setManagementError(error.message),
  });
  const convertObject = useMutation({
    mutationFn: async () => {
      if (!meshFile || !mtlFile) throw new Error('Choose an OBJ and an MTL file.');
      const { libraryError, ...conversion } = await convertObjToMjcf({
        obj: meshFile,
        mtl: mtlFile,
        textures: objTextureFiles,
        name: meshName,
        category: uploadCategory,
      });
      // The route saves the object to the library, so list it even if placement fails.
      queryClient.invalidateQueries({ queryKey: ['assets'] });
      setManagementError(
        libraryError ? `The object was placed but not saved to the library: ${libraryError}` : null,
      );
      await onAddObjectModel(conversion);
    },
    onSuccess: () => {
      setMeshFormOpen(false);
      setMeshFile(null);
      setMeshName('');
      setMtlFile(null);
      setObjTextureFiles([]);
    },
  });
  const applyMaterial = useMutation({
    mutationFn: ({ asset, face }: { asset: SceneAsset; face: BoxFace | null }) =>
      onApplyMaterial(asset, face),
    onError: (error) => setManagementError(error.message),
  });

  const assetList = assets.data?.pages.flatMap((page) => page.docs) ?? [];
  const isLoadingAssets = assets.isLoading || (kind === 'mesh' && robotMeshesQuery.isPending);
  const assetError =
    kind === 'mesh' && robotMeshesQuery.isError ? robotMeshesQuery.error : assets.error;

  return (
    <Panel className="min-h-0 w-72 flex-1 shrink-0 border-r border-border">
      <PanelHeader
        title="Assets"
        actions={
          <Button size="icon" variant="ghost" title="Filter objects">
            <SlidersHorizontal />
          </Button>
        }
      />
      <PanelBody className="p-3">
        <div className="space-y-3">
          <input
            ref={fileInput}
            className="hidden"
            type="file"
            accept={ACCEPTED_MESH_FILES}
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = '';
              if (file) {
                setMeshFile(file);
                setMtlFile(null);
                setObjTextureFiles([]);
                setUploadUpAxis(file.name.toLowerCase().endsWith('.glb') ? 'y' : 'z');
              }
            }}
          />
          <input
            ref={textureInput}
            className="hidden"
            type="file"
            accept="image/png,image/jpeg"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0] ?? null;
              event.currentTarget.value = '';
              setTextureFile(file);
            }}
          />
          <input
            ref={mtlInput}
            className="hidden"
            type="file"
            accept=".mtl"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0] ?? null;
              event.currentTarget.value = '';
              if (file) setMtlFile(file);
            }}
          />
          <input
            ref={objTextureInput}
            className="hidden"
            type="file"
            accept="image/png,image/jpeg"
            multiple
            onChange={(event) => {
              const files = [...(event.currentTarget.files ?? [])];
              event.currentTarget.value = '';
              if (files.length) setObjTextureFiles((current) => [...current, ...files]);
            }}
          />
          {kind === 'mesh' ? (
            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={() => {
                  setManagementError(null);
                  setPrimitiveFormOpen(true);
                }}
              >
                <Box />
                Create object
              </Button>
              <Button
                type="button"
                variant="primary"
                className="w-full"
                onClick={() => setMeshFormOpen(true)}
              >
                <FileUp />
                Upload object
              </Button>
            </div>
          ) : (
            <div className="grid gap-2">
              <Button
                type="button"
                variant="primary"
                className="w-full"
                onClick={() => setMaterialFormOpen(true)}
              >
                <Plus />
                Create material
              </Button>
            </div>
          )}
          {upload.error && <p className="text-xs text-danger">{upload.error.message}</p>}
          {managementError && <p className="text-xs text-danger">{managementError}</p>}
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search objects"
              className="h-8 w-full border border-border bg-surface-raised py-1 pl-8 pr-2 text-xs text-foreground outline-none placeholder:text-muted focus:border-accent"
              aria-label="Search objects"
            />
          </div>

          <div className="grid grid-cols-3 gap-1" aria-label="Object type">
            {ASSET_KINDS.map((nextKind) => (
              <Button
                key={nextKind}
                size="sm"
                variant={kind === nextKind ? 'outline' : 'ghost'}
                className={cn(kind === nextKind && 'border-accent/60 text-accent')}
                onClick={() => setKind(nextKind)}
              >
                {nextKind}
              </Button>
            ))}
          </div>

          <label className="block text-[11px] text-muted">
            Filter category
            <select
              value={category}
              disabled={kind === 'material'}
              onChange={(event) => setCategory(event.target.value as typeof category)}
              className="mt-1 h-8 w-full border border-border bg-surface-raised px-2 text-xs text-foreground outline-none focus:border-accent"
            >
              {CATEGORIES.map((value) => (
                <option key={value} value={value}>
                  {value === 'all' ? 'All categories' : value}
                </option>
              ))}
            </select>
          </label>
        </div>

        {materialFormOpen && (
          <MaterialFormDialog
            materialName={materialName}
            materialColor={materialColor}
            materialMetallic={materialMetallic}
            materialRoughness={materialRoughness}
            textureFile={textureFile}
            textureInput={textureInput}
            isPending={create.isPending}
            error={create.error?.message ?? null}
            onClose={() => setMaterialFormOpen(false)}
            onNameChange={setMaterialName}
            onColorChange={setMaterialColor}
            onMetallicChange={setMaterialMetallic}
            onRoughnessChange={setMaterialRoughness}
            onTextureClear={() => setTextureFile(null)}
            onSubmit={(event) => {
              event.preventDefault();
              if (create.isPending) return;
              create.mutate({
                name: materialName,
                color: textureFile ? '#ffffff' : materialColor,
                metallic: materialMetallic,
                roughness: materialRoughness,
                textureFile,
              });
            }}
          />
        )}

        {meshFormOpen && (
          <MeshUploadDialog
            file={meshFile}
            name={meshName}
            category={uploadCategory}
            unit={uploadUnit}
            upAxis={uploadUpAxis}
            collisionStrategy={uploadCollisionStrategy}
            fileInput={fileInput}
            mtlFile={mtlFile}
            textureFiles={objTextureFiles}
            mtlInput={mtlInput}
            textureInput={objTextureInput}
            isPending={upload.isPending || convertObject.isPending}
            error={upload.error?.message ?? convertObject.error?.message ?? null}
            onClose={() => setMeshFormOpen(false)}
            onNameChange={setMeshName}
            onCategoryChange={setUploadCategory}
            onUnitChange={setUploadUnit}
            onUpAxisChange={setUploadUpAxis}
            onCollisionStrategyChange={setUploadCollisionStrategy}
            onFileChange={(file) => {
              setMeshFile(file);
              setMtlFile(null);
              setObjTextureFiles([]);
            }}
            onMtlFileChange={setMtlFile}
            onTextureFilesChange={(files) => setObjTextureFiles([...files])}
            onSubmit={(event) => {
              event.preventDefault();
              if (!meshFile || upload.isPending || convertObject.isPending) return;
              if (meshFile.name.toLowerCase().endsWith('.obj') && mtlFile) {
                convertObject.mutate();
                return;
              }
              upload.mutate({
                file: meshFile,
                category: uploadCategory,
                name: meshName,
                unit: uploadUnit,
                upAxis: uploadUpAxis,
                collisionStrategy: uploadCollisionStrategy,
              });
            }}
          />
        )}

        {primitiveFormOpen && (
          <PrimitiveObjectDialog
            isPending={createObject.isPending || createCustomShape.isPending}
            error={createObject.error?.message ?? null}
            onClose={() => setPrimitiveFormOpen(false)}
            onSubmit={(placement) => createObject.mutate(placement)}
            onCreateCustomShape={async (name, source) => {
              await createCustomShape.mutateAsync({ name, source });
            }}
            onCreateFromImage={async (image, pipelineType, onEvent) => {
              await createFromImage.mutateAsync({ image, pipelineType, onEvent });
            }}
            imageService={imageServiceStatus.data ?? null}
            imageServiceError={imageServiceError?.message ?? null}
            isStartingImageService={startImageService.isPending}
            onStartImageService={async () => {
              await startImageService.mutateAsync();
            }}
            isStoppingImageService={stopImageService.isPending}
            onStopImageService={async () => {
              await stopImageService.mutateAsync();
            }}
          />
        )}

        <div className="mt-4 space-y-2">
          {isLoadingAssets && <p className="text-xs text-muted">Loading objects…</p>}
          {assetError && <p className="text-xs text-danger">{assetError.message}</p>}
          {!isLoadingAssets && !assetError && assetList.length === 0 && (
            <div className="border border-dashed border-border px-3 py-8 text-center">
              <Box className="mx-auto size-5 text-muted" />
              <p className="mt-3 text-xs text-muted-foreground">No objects found.</p>
              <p className="mt-1 text-[11px] text-muted">
                Upload an object to start building your scene.
              </p>
            </div>
          )}
          {assetList.map((asset) => (
            <AssetCard
              key={asset.id}
              asset={asset}
              onRename={(name) => rename.mutate({ id: asset.id, name, kind: asset.kind })}
              onDelete={() => {
                if (window.confirm(`Remove ${asset.name}?`))
                  remove.mutate({ id: asset.id, kind: asset.kind });
              }}
              onReprocess={() => reprocess.mutate(asset.id)}
              onPreview={() => onPreviewAsset(asset)}
              onAddToScene={() => addToScene.mutate(asset)}
              onDragStart={() => onDragAsset(asset)}
              onDragEnd={() => onDragAsset(null)}
              onApplyMaterial={() =>
                applyMaterial.mutate({
                  asset,
                  face: textureFace === 'all' ? null : textureFace,
                })
              }
              textureFace={textureFace}
              onTextureFaceChange={setTextureFace}
              canApplyMaterialToFace={canApplyMaterialToFace}
              isPreviewing={previewAssetId === asset.id}
              isAddingToScene={addToScene.isPending && addToScene.variables?.id === asset.id}
              isApplyingMaterial={
                applyMaterial.isPending && applyMaterial.variables?.asset.id === asset.id
              }
              hasSceneSelection={hasSceneSelection}
              isRenaming={rename.isPending && rename.variables?.id === asset.id}
              isDeleting={remove.isPending && remove.variables?.id === asset.id}
              isReprocessing={reprocess.isPending && reprocess.variables === asset.id}
            />
          ))}
          {assets.hasNextPage && (
            <Button
              className="w-full"
              disabled={assets.isFetchingNextPage}
              onClick={() => assets.fetchNextPage()}
            >
              {assets.isFetchingNextPage ? 'Loading objects' : 'Load more'}
            </Button>
          )}
        </div>
      </PanelBody>
    </Panel>
  );
}
