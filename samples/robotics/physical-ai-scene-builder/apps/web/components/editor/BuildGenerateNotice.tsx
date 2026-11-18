// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client';

import { useMemo } from 'react';

import { canonicalMjcf } from '@/lib/editor/mjcfSource';

import { useTeleoperationRuntime } from '../teleoperation/TeleoperationRuntimeProvider';
import { useSceneVersions } from './GenerationVersions';

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/**
 * Non-blocking Build notice about Generate data: saving model changes starts a new Generate version
 * (nothing is lost), and a running Generate stream restarts on the edited scene when Generate opens.
 */
export function BuildGenerateNotice({
  sceneId,
  documentDirty,
  xml,
  savedXml,
}: {
  sceneId?: number;
  documentDirty: boolean;
  xml: string;
  savedXml: string;
}) {
  const { session, streaming, snapshot } = useTeleoperationRuntime();
  const sessionForScene = session && session.sceneId === String(sceneId) ? session : null;
  const recording =
    sessionForScene?.recording === 'recording' || snapshot?.header.recording === 'recording';
  // Formatting-only edits keep the same Generate version.
  const modelChanged = useMemo(
    () => documentDirty && canonicalMjcf(xml) !== canonicalMjcf(savedXml),
    [documentDirty, savedXml, xml],
  );
  const { versions } = useSceneVersions(
    modelChanged ? sceneId : undefined,
    sessionForScene?.collectionId ?? null,
    savedXml,
  );
  const latest = versions.find((version) => version.current) ?? versions[0];
  const hasData = Boolean(latest && (latest.generatedCount > 0 || latest.episodeCount > 0));

  let message: string | null = null;
  if (recording) {
    message =
      'A Generate recording is in progress on the saved scene. It is kept with the current Generate version; edits apply to new recordings after you save.';
  } else if (modelChanged && hasData && latest) {
    const kept: string[] = [];
    if (latest.generatedCount > 0) {
      kept.push(
        `${plural(latest.generatedCount, 'generated scene')} ${
          latest.generatedCount === 1 ? 'is' : 'are'
        } rebuilt in the edited scene`,
      );
    }
    if (latest.episodeCount > 0) {
      kept.push(
        `${plural(latest.episodeCount, 'recorded episode')} ${
          latest.episodeCount === 1 ? 'stays' : 'stay'
        } available under Generate > Scene version`,
      );
    }
    message = `Saving these changes starts a new Generate version. Nothing is deleted: ${kept.join(
      ', and ',
    )}.`;
    if (streaming) {
      message += ' Streaming restarts with the edited scene when you return to Generate.';
    }
  } else if (streaming && sessionForScene) {
    message =
      'Generate is streaming the saved scene. If you save model changes, streaming restarts with the edited scene when you return to Generate.';
  }
  if (!message) return null;

  return (
    <div
      aria-label="Generate data notice"
      className="pointer-events-none absolute bottom-4 left-1/2 z-10 w-[min(36rem,calc(100%-2rem))] -translate-x-1/2 border border-info/50 bg-surface/95 px-3 py-2 text-[11px] leading-relaxed text-foreground shadow-lg"
      role="status"
    >
      {message}
    </div>
  );
}
