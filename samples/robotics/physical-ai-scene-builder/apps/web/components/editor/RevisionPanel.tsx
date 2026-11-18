// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client';

import { Button, Panel, PanelBody, PanelHeader } from '@mujoco-studio/ui';
import { History, RotateCcw } from 'lucide-react';
import { useMemo } from 'react';

import { listSceneRevisions, type SceneRevision } from '@/lib/scenes/revisions';

export interface RevisionPanelProps {
  projectId?: number;
  sceneId: number | null;
  refreshKey: number;
  onRestore: (revision: SceneRevision) => void;
}

export function RevisionPanel({ projectId, sceneId, refreshKey, onRestore }: RevisionPanelProps) {
  const revisions = useMemo(() => {
    if (refreshKey < 0 || !projectId || !sceneId) return [];
    return listSceneRevisions(projectId, sceneId);
  }, [projectId, refreshKey, sceneId]);

  return (
    <Panel className="w-full border-0">
      <PanelHeader title="Revisions" />
      <PanelBody className="overflow-y-auto">
        {!sceneId ? (
          <p className="p-3 text-xs text-muted">Save this scene before creating revisions.</p>
        ) : revisions.length === 0 ? (
          <div className="flex flex-col items-center px-5 py-12 text-center text-muted">
            <History className="size-6" />
            <p className="mt-3 text-xs">No local revisions yet.</p>
            <p className="mt-1 text-[11px]">A revision is recorded after each successful save.</p>
          </div>
        ) : (
          revisions.map((revision) => (
            <div
              key={revision.id}
              className="flex items-center gap-3 border-b border-border px-3 py-3 last:border-b-0"
            >
              <History className="size-4 shrink-0 text-accent" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium text-foreground">{revision.name}</p>
                <time className="mt-1 block text-[10px] text-muted" dateTime={revision.createdAt}>
                  {new Date(revision.createdAt).toLocaleString()}
                </time>
              </div>
              <Button
                size="icon"
                variant="ghost"
                title="Restore revision"
                onClick={() => onRestore(revision)}
              >
                <RotateCcw />
              </Button>
            </div>
          ))
        )}
      </PanelBody>
    </Panel>
  );
}
