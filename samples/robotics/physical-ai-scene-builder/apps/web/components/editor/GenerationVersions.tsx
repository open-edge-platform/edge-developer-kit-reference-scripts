// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client';

import type {
  TeleoperationCarryOverV1,
  TeleoperationSceneVersionDetailV1,
  TeleoperationSceneVersionV1,
} from '@mujoco-studio/types';
import { Button, DeleteDialog, useNotice } from '@mujoco-studio/ui';
import { ArrowLeft, History, LoaderCircle, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';

import { readJsonBody, requestErrorFromBody } from '@/lib/http/requestError';
import { noticeFromError } from '@/lib/notices';

import { TeleoperationReviewPanel } from '../teleoperation/TeleoperationReviewPanel';
import { formatDate } from '../teleoperation/reviewUtils';

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

export function versionCounts(version: { generatedCount: number; episodeCount: number }): string {
  return `${plural(version.generatedCount, 'generated scene')} · ${plural(version.episodeCount, 'episode')}`;
}

/**
 * Generate data versions of a saved scene. `refreshKey` changes whenever the open session's data
 * changes, so counts and merge options stay current.
 */
export function useSceneVersions(
  sceneId: number | undefined,
  currentCollectionId: string | null,
  refreshKey: string,
) {
  const [state, setState] = useState<{
    key: string;
    versions: TeleoperationSceneVersionV1[];
  } | null>(null);
  const [reload, setReload] = useState(0);
  const requestKey = `${sceneId ?? ''}|${currentCollectionId ?? ''}|${refreshKey}|${reload}`;

  useEffect(() => {
    if (!sceneId) return undefined;
    const controller = new AbortController();
    const query = currentCollectionId ? `?current=${encodeURIComponent(currentCollectionId)}` : '';
    fetch(`/api/teleoperation/scenes/${sceneId}/versions${query}`, {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (response) => {
        const body = (await readJsonBody(response)) as { versions?: TeleoperationSceneVersionV1[] };
        if (!response.ok || !Array.isArray(body?.versions)) return;
        setState({ key: requestKey, versions: body.versions });
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [currentCollectionId, requestKey, sceneId]);

  const versions = sceneId ? (state?.versions ?? []) : [];
  return {
    versions,
    earlier: versions.filter((version) => version.collectionId !== currentCollectionId),
    reload: () => setReload((value) => value + 1),
  };
}

/** Choose between the current scene and earlier versions' Generate data. */
export function SceneVersionPicker({
  currentLabel,
  earlier,
  value,
  onChange,
}: {
  currentLabel: string;
  earlier: readonly TeleoperationSceneVersionV1[];
  value: string;
  onChange: (collectionId: string) => void;
}) {
  if (earlier.length === 0) return null;
  return (
    <div
      className="flex items-center gap-2 border-b border-border px-3 py-2"
      title="Editing and saving the scene starts a new version. Earlier versions keep their generated scenes and episodes for review and download."
    >
      <label
        className="flex shrink-0 items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.14em] text-muted"
        htmlFor="generate-scene-version"
      >
        <History className="size-3.5" />
        Version
      </label>
      <select
        id="generate-scene-version"
        aria-label="Scene version"
        className="h-7 min-w-0 flex-1 border border-border bg-background px-2 text-[11px] text-foreground"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">Current · {currentLabel}</option>
        {earlier.map((version) => (
          <option key={version.collectionId} value={version.collectionId}>
            Earlier · {formatDate(version.updatedAt)} · {versionCounts(version)}
          </option>
        ))}
      </select>
    </div>
  );
}

/** What happened to the earlier version's generated scenes when this version started. */
export function CarryOverNotice({ carryOver }: { carryOver: TeleoperationCarryOverV1 }) {
  const [showSkipped, setShowSkipped] = useState(false);
  if (carryOver.imported.length === 0 && carryOver.skipped.length === 0 && !carryOver.error) {
    return null;
  }
  return (
    <div
      aria-label="Generated scenes carried over"
      className="space-y-1.5 border border-info/40 bg-info/10 px-2.5 py-2 text-[10px] leading-relaxed text-foreground"
      role="status"
    >
      {carryOver.error ? (
        <p>
          The generated scenes of the earlier version ({formatDate(carryOver.fromUpdatedAt)}) could
          not be rebuilt in the edited scene: {carryOver.error}
        </p>
      ) : (
        <p>
          {plural(carryOver.imported.length, 'generated scene')} rebuilt in the edited scene from
          the earlier version ({formatDate(carryOver.fromUpdatedAt)}).
          {carryOver.skipped.length > 0 && ` ${carryOver.skipped.length} no longer fit.`}
        </p>
      )}
      {carryOver.skipped.length > 0 && (
        <>
          <button
            className="text-[10px] text-info underline-offset-2 hover:underline"
            onClick={() => setShowSkipped((value) => !value)}
            type="button"
          >
            {showSkipped ? 'Hide' : 'Show'} the scenes that were not rebuilt
          </button>
          {showSkipped && (
            <ul className="space-y-0.5 text-muted">
              {carryOver.skipped.map((entry) => (
                <li key={entry.stateId}>
                  <span className="text-foreground">{entry.label}</span>: {entry.reason}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      <p className="text-muted">
        The earlier version and its episodes are still available under Scene version.
      </p>
    </div>
  );
}

/** Read-only view of an earlier version: generated scenes, episodes, download, and delete. */
export function EarlierVersionView({
  collectionId,
  episodeCameraHost,
  episodeStatsHost,
  onBack,
  onDeleted,
}: {
  collectionId: string;
  episodeCameraHost?: HTMLDivElement | null;
  episodeStatsHost?: HTMLDivElement | null;
  onBack: () => void;
  onDeleted: () => void;
}) {
  const showNotice = useNotice();
  const [detail, setDetail] = useState<{
    id: string;
    value: TeleoperationSceneVersionDetailV1 | null;
    error: string | null;
  } | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/teleoperation/versions/${encodeURIComponent(collectionId)}`, {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (response) => {
        const body = await readJsonBody(response);
        if (!response.ok) {
          throw requestErrorFromBody(body, response.status, 'The version could not be loaded.');
        }
        setDetail({
          id: collectionId,
          value: body as TeleoperationSceneVersionDetailV1,
          error: null,
        });
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setDetail({
          id: collectionId,
          value: null,
          error: reason instanceof Error ? reason.message : 'The version could not be loaded.',
        });
      });
    return () => controller.abort();
  }, [collectionId]);

  const current = detail?.id === collectionId ? detail : null;
  const value = current?.value ?? null;
  const generated = value?.states.filter((state) => state.stateId !== 'state-000000') ?? [];

  async function deleteVersion(): Promise<void> {
    setDeleting(true);
    try {
      const response = await fetch(
        `/api/teleoperation/versions/${encodeURIComponent(collectionId)}`,
        { method: 'DELETE' },
      );
      if (!response.ok) {
        throw requestErrorFromBody(
          await readJsonBody(response),
          response.status,
          'The version could not be deleted.',
        );
      }
      setDeleteOpen(false);
      onDeleted();
    } catch (reason) {
      showNotice(
        noticeFromError('Version not deleted', reason, 'The version could not be deleted.'),
      );
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-4 px-3 py-3" aria-label="Earlier scene version">
      <div className="flex items-center justify-between gap-2">
        <Button onClick={onBack} size="sm" variant="ghost">
          <ArrowLeft />
          Current scene
        </Button>
        <Button
          aria-label="Delete this version"
          disabled={!value || deleting}
          onClick={() => setDeleteOpen(true)}
          size="sm"
          title="Delete this version's generated scenes and episodes"
          variant="outline"
        >
          <Trash2 className="text-danger" />
          Delete version
        </Button>
      </div>
      <p className="border border-border bg-background px-2.5 py-2 text-[10px] leading-relaxed text-muted">
        Read-only: this data was generated before the scene was last edited.
        {value && ` Last changed ${formatDate(value.version.updatedAt)}.`}
      </p>
      {!current && (
        <p className="flex items-center gap-2 text-[10px] text-muted" role="status">
          <LoaderCircle className="size-3.5 animate-spin" /> Loading version
        </p>
      )}
      {current?.error && <p className="text-[10px] text-danger">{current.error}</p>}
      {value && (
        <>
          <section className="space-y-1.5">
            <h3 className="text-[10px] font-medium text-foreground">
              {plural(generated.length, 'generated scene')}
            </h3>
            {generated.length > 0 && (
              <ul className="max-h-40 space-y-0.5 overflow-y-auto text-[10px] text-muted">
                {generated.map((state) => {
                  const values = state.sourceRandomization?.values ?? [];
                  return (
                    <li key={state.stateId} className="flex justify-between gap-2">
                      <span className="truncate text-foreground">{state.label}</span>
                      <span className="shrink-0 tabular-nums">
                        {values.length === 3
                          ? `${values[0].toFixed(1)}, ${values[1].toFixed(1)} cm · ${values[2].toFixed(0)}°`
                          : ''}
                        {state.objectRandomization?.length
                          ? ` · +${state.objectRandomization.length} object${state.objectRandomization.length === 1 ? '' : 's'}`
                          : ''}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
          <section className="space-y-1.5 border-t border-border pt-3">
            <h3 className="text-[10px] font-medium text-foreground">Recorded episodes</h3>
            <TeleoperationReviewPanel
              cameraPreviewHost={episodeCameraHost}
              statsGraphsHost={episodeStatsHost}
              version={{
                collectionId,
                episodes: value.episodes,
                streamHz: value.streamHz,
              }}
            />
          </section>
        </>
      )}
      <DeleteDialog
        open={deleteOpen}
        itemName={value ? `version from ${formatDate(value.version.updatedAt)}` : 'version'}
        itemType="scene version"
        busy={deleting}
        onCancel={() => {
          if (!deleting) setDeleteOpen(false);
        }}
        onConfirm={() => void deleteVersion()}
      />
    </div>
  );
}
