// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client';

import type { RuntimeFile } from '@mujoco-studio/mujoco';
import { DEFAULT_SCENE } from '@mujoco-studio/scene';
import { NoticeProvider } from '@mujoco-studio/ui';
import dynamic from 'next/dynamic';

import type { SceneAsset as PersistedSceneAsset } from '@/lib/scenes/api';

// The editor is entirely client-side (WASM + WebGL), so skipping SSR avoids a
// wasted server render and the hydration mismatch it produced.
const EditorShell = dynamic(() => import('./EditorShell').then((m) => m.EditorShell), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-xs text-muted">
      Loading Physical AI Scene Builder…
    </div>
  ),
});

export interface EditorShellClientProps {
  projectId?: number;
  sceneId?: number;
  sceneCreatedAt?: string;
  initialScene?: string;
  initialSceneName?: string;
  initialTemplateId?: string;
  initialFiles?: readonly RuntimeFile[];
  initialSplatFile?: RuntimeFile;
  initialAssets?: readonly (number | PersistedSceneAsset)[];
  initialGraph?: unknown;
}

export function EditorShellClient({
  projectId,
  sceneId,
  sceneCreatedAt,
  initialScene,
  initialSceneName,
  initialTemplateId,
  initialFiles,
  initialSplatFile,
  initialAssets,
  initialGraph,
}: EditorShellClientProps) {
  return (
    <NoticeProvider>
      <EditorShell
        projectId={projectId}
        sceneId={sceneId}
        sceneCreatedAt={sceneCreatedAt}
        initialScene={initialScene ?? DEFAULT_SCENE.xml}
        initialSceneName={initialSceneName ?? DEFAULT_SCENE.name}
        initialTemplateId={initialTemplateId}
        initialFiles={initialFiles}
        initialSplatFile={initialSplatFile}
        initialAssets={initialAssets}
        initialGraph={initialGraph}
      />
    </NoticeProvider>
  );
}
