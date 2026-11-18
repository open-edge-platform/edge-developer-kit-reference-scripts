// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client';

import { DEFAULT_SCENE } from '@mujoco-studio/scene';
import { ArrowLeft, LoaderCircle, X } from 'lucide-react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';

import { EditorShellClient } from '@/components/editor/EditorShellClient';
import { downloadSceneRuntimeFiles, downloadSceneSplat } from '@/lib/scenes/assetReferences';
import { getProject, getScene, type SceneSummary } from '@/lib/scenes/api';
import type { RuntimeFile } from '@mujoco-studio/mujoco';

function relationshipId(value: SceneSummary['project']): number | null {
  if (typeof value === 'number') return value;
  return value && typeof value.id === 'number' ? value.id : null;
}

export function SceneEditorClient({ isNew }: { isNew: boolean }) {
  const params = useParams<{ projectId: string; sceneId?: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();
  const projectId = Number(params.projectId);
  const sceneId = params.sceneId && params.sceneId !== 'new' ? Number(params.sceneId) : null;
  const templateParam = isNew ? searchParams.get('template') : null;
  const persistedTemplateId =
    templateParam && /^\d+$/.test(templateParam) ? Number(templateParam) : null;
  const initialTemplateId =
    templateParam && (templateParam === 'so101' || persistedTemplateId) ? templateParam : undefined;
  const [scene, setScene] = useState<SceneSummary | null>(null);
  const [runtimeFiles, setRuntimeFiles] = useState<RuntimeFile[]>([]);
  const [splatFile, setSplatFile] = useState<RuntimeFile | null>(null);
  const [splatWarning, setSplatWarning] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const invalidRoute =
    !Number.isInteger(projectId) || projectId <= 0 || (!isNew && !Number.isInteger(sceneId));

  useEffect(() => {
    if (invalidRoute) return undefined;
    let active = true;
    Promise.all([
      getProject(projectId),
      isNew
        ? persistedTemplateId
          ? getScene(persistedTemplateId)
          : Promise.resolve(null)
        : getScene(sceneId as number),
    ])
      .then(async ([, loadedScene]) => {
        if (isNew && persistedTemplateId && (!loadedScene || loadedScene.isTemplate !== true)) {
          throw new Error('This scene template is not available.');
        }
        if (
          !isNew &&
          loadedScene &&
          (loadedScene.isTemplate === true || relationshipId(loadedScene.project) !== projectId)
        ) {
          throw new Error('This scene does not belong to this project.');
        }
        // A missing or corrupt splat backdrop must not block opening the scene: the MJCF still
        // carries its collision heightfield, and the user is told why the backdrop is not shown.
        const [files, splat] = loadedScene
          ? await Promise.all([
              downloadSceneRuntimeFiles(loadedScene),
              downloadSceneSplat(loadedScene).then(
                (file) => ({ file, warning: null }),
                (reason: unknown) => ({
                  file: null,
                  warning:
                    reason instanceof Error
                      ? reason.message
                      : 'The splat backdrop could not be loaded.',
                }),
              ),
            ])
          : [[], { file: null, warning: null }];
        if (active) {
          setScene(
            loadedScene ?? {
              id: 0,
              name: DEFAULT_SCENE.name,
              project: projectId,
              mjcf: DEFAULT_SCENE.xml,
            },
          );
          setRuntimeFiles(files);
          setSplatFile(splat.file);
          setSplatWarning(splat.warning);
        }
      })
      .catch((reason: unknown) => {
        if (!active) return;
        setError(reason instanceof Error ? reason.message : 'The scene could not be loaded.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [invalidRoute, isNew, persistedTemplateId, projectId, sceneId]);

  if (loading) {
    return (
      <main className="flex h-full items-center justify-center bg-background text-xs text-muted">
        <span className="flex items-center gap-2">
          <LoaderCircle className="size-4 animate-spin text-accent" /> Loading scene
        </span>
      </main>
    );
  }

  if (error || invalidRoute || !scene) {
    return (
      <main className="flex h-full items-center justify-center bg-background px-6 text-center">
        <div>
          <p className="text-sm text-danger">{error ?? 'This scene link is invalid.'}</p>
          <button
            type="button"
            onClick={() => router.push(`/projects/${projectId}`)}
            className="mt-4 inline-flex items-center gap-2 text-xs text-muted underline underline-offset-4 hover:text-foreground"
          >
            <ArrowLeft className="size-3" /> Back to scenes
          </button>
        </div>
      </main>
    );
  }

  return (
    <>
      <EditorShellClient
        projectId={projectId}
        sceneId={isNew ? undefined : scene.id}
        sceneCreatedAt={isNew ? undefined : scene.createdAt}
        initialTemplateId={initialTemplateId}
        initialScene={scene.mjcf ?? DEFAULT_SCENE.xml}
        initialSceneName={scene.name}
        initialFiles={runtimeFiles}
        initialSplatFile={splatFile ?? undefined}
        initialAssets={scene.assets ?? undefined}
        initialGraph={scene.graph}
      />
      {splatWarning && (
        <div
          role="alert"
          aria-label="Splat backdrop warning"
          className="fixed bottom-4 left-1/2 z-50 flex max-w-lg -translate-x-1/2 items-start gap-3 border border-warning/60 bg-surface px-3 py-2 text-xs text-foreground shadow-lg"
        >
          <p className="min-w-0">
            <span className="font-medium">Splat backdrop not loaded.</span> {splatWarning} The scene
            opened without it; its collision heightfield is unchanged. Upload the PLY again from the
            Splat panel to restore it.
          </p>
          <button
            type="button"
            aria-label="Dismiss splat backdrop warning"
            className="shrink-0 text-muted hover:text-foreground"
            onClick={() => setSplatWarning(null)}
          >
            <X className="size-3.5" />
          </button>
        </div>
      )}
    </>
  );
}
