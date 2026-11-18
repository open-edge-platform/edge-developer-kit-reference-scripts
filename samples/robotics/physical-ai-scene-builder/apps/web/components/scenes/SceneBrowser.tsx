// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client';

import { Button, DeleteDialog } from '@mujoco-studio/ui';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronLeft,
  ChevronRight,
  FilePlus2,
  FolderKanban,
  LoaderCircle,
  Pencil,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import {
  deleteScene,
  getProject,
  listScenes,
  listAllTemplates,
  updateSceneName,
  type ProjectSummary,
  type SceneSummary,
} from '@/lib/scenes/api';

const PAGE_SIZE = 8;

export function SceneBrowser() {
  const params = useParams<{ projectId: string }>();
  const router = useRouter();
  const projectId = Number(params.projectId);
  const [project, setProject] = useState<ProjectSummary | null>(null);
  const [scenes, setScenes] = useState<SceneSummary[]>([]);
  const [templates, setTemplates] = useState<SceneSummary[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [loading, setLoading] = useState(true);
  const [editingSceneId, setEditingSceneId] = useState<number | null>(null);
  const [editingSceneName, setEditingSceneName] = useState('');
  const [savingSceneId, setSavingSceneId] = useState<number | null>(null);
  const [deletingSceneId, setDeletingSceneId] = useState<number | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SceneSummary | null>(null);
  const [page, setPage] = useState(1);
  const [pageInfo, setPageInfo] = useState<{
    totalPages: number;
    totalDocs: number;
  } | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const invalidProjectId = !Number.isInteger(projectId) || projectId <= 0;

  useEffect(() => {
    let active = true;
    if (invalidProjectId) return undefined;
    Promise.all([
      getProject(projectId),
      listScenes(projectId, { page, limit: PAGE_SIZE, isTemplate: false }),
      listAllTemplates(),
    ])
      .then(([currentProject, currentPage, loadedTemplates]) => {
        if (!active) return;
        setProject(currentProject);
        setTemplates(loadedTemplates);
        setSelectedTemplateId((current) =>
          current && loadedTemplates.some((template) => String(template.id) === current)
            ? current
            : String(loadedTemplates[0]?.id ?? ''),
        );
        setScenes(currentPage.docs);
        setPageInfo({
          totalPages: currentPage.totalPages,
          totalDocs: currentPage.totalDocs,
        });
      })
      .catch((reason: unknown) => {
        if (!active) return;
        setError(reason instanceof Error ? reason.message : 'Scenes could not be loaded.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [invalidProjectId, page, projectId, refreshKey, router]);

  function beginEdit(scene: SceneSummary) {
    setEditingSceneId(scene.id);
    setEditingSceneName(scene.name);
    setError(null);
  }

  function cancelEdit() {
    setEditingSceneId(null);
    setEditingSceneName('');
  }

  async function handleUpdate(event: React.FormEvent<HTMLFormElement>, sceneId: number) {
    event.preventDefault();
    if (!editingSceneName.trim()) {
      setError('Enter a scene name.');
      return;
    }
    setSavingSceneId(sceneId);
    setError(null);
    try {
      const updatedScene = await updateSceneName(sceneId, editingSceneName);
      setScenes((current) => current.map((scene) => (scene.id === sceneId ? updatedScene : scene)));
      cancelEdit();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The scene could not be updated.');
    } finally {
      setSavingSceneId(null);
    }
  }

  async function handleDelete() {
    const scene = deleteTarget;
    if (!scene) return;
    setDeletingSceneId(scene.id);
    setLoading(true);
    setError(null);
    try {
      await deleteScene(scene.id);
      if (scenes.length === 1 && page > 1) setPage((current) => current - 1);
      setRefreshKey((current) => current + 1);
      if (editingSceneId === scene.id) cancelEdit();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The scene could not be deleted.');
    } finally {
      setDeletingSceneId(null);
      setDeleteTarget(null);
    }
  }

  if (invalidProjectId) {
    return <InvalidState message="This project link is invalid." onBack={() => router.push('/')} />;
  }

  if (loading) return <LoadingState />;

  const selectedTemplate = templates.find((template) => String(template.id) === selectedTemplateId);

  return (
    <main className="h-full overflow-y-auto bg-background px-6 py-8 text-foreground">
      <div className="mx-auto max-w-5xl">
        <header className="mb-8 flex flex-wrap items-end justify-between gap-4 border-b border-border pb-5">
          <div className="flex items-start gap-3">
            <Button
              size="icon"
              variant="ghost"
              onClick={() => router.push('/')}
              title="Back to projects"
            >
              <ArrowLeft />
            </Button>
            <div>
              <p className="mb-2 flex items-center gap-2 text-[10px] uppercase tracking-[0.24em] text-accent">
                <FolderKanban className="size-3" /> Project
              </p>
              <h1 className="text-2xl font-semibold tracking-tight">
                {project?.name ?? 'Project'}
              </h1>
              <p className="mt-2 text-sm text-muted">{project?.description || 'Scene workspace'}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="primary"
              onClick={() => router.push(`/projects/${projectId}/scenes/new`)}
            >
              <Plus /> New scene
            </Button>
          </div>
        </header>

        {error && (
          <p className="mb-5 border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
            {error}
          </p>
        )}

        <section>
          {templates.length > 0 && (
            <section className="mb-8">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="text-xs font-medium uppercase tracking-[0.16em] text-muted">
                  Templates
                </h2>
                <span className="font-mono text-[11px] text-muted">
                  {templates.length} available
                </span>
              </div>
              <div className="flex items-center gap-3 border border-accent/40 bg-accent/5 p-3">
                <FilePlus2 className="size-5 shrink-0 text-accent" />
                <label className="min-w-0 flex-1 text-xs text-muted">
                  Choose a template
                  <select
                    aria-label="Choose scene template"
                    value={selectedTemplateId}
                    onChange={(event) => setSelectedTemplateId(event.target.value)}
                    className="mt-1.5 h-9 w-full border border-border bg-surface-raised px-2 text-sm text-foreground outline-none focus:border-accent focus:ring-1 focus:ring-accent/50"
                  >
                    {templates.map((template) => (
                      <option key={template.id} value={template.id}>
                        {template.name}
                        {typeof template.project === 'object' && template.project?.name
                          ? ` · ${template.project.name}`
                          : ''}
                      </option>
                    ))}
                  </select>
                </label>
                <Button
                  variant="primary"
                  aria-label="Use selected template"
                  disabled={!selectedTemplate}
                  onClick={() =>
                    selectedTemplate &&
                    router.push(`/projects/${projectId}/scenes/new?template=${selectedTemplate.id}`)
                  }
                >
                  Use template
                </Button>
              </div>
            </section>
          )}

          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-xs font-medium uppercase tracking-[0.16em] text-muted">Scenes</h2>
            <span className="font-mono text-[11px] text-muted">
              {pageInfo?.totalDocs ?? scenes.length}
            </span>
          </div>
          {scenes.length ? (
            <div className="grid gap-2">
              {scenes.map((scene) => (
                <div
                  key={scene.id}
                  className="border border-border bg-surface transition-colors hover:border-border-strong"
                >
                  <div className="flex min-h-20 items-center gap-4 px-4">
                    <button
                      type="button"
                      aria-label={`Open ${scene.name}`}
                      title={`Open ${scene.name}`}
                      onClick={() => router.push(`/projects/${projectId}/scenes/${scene.id}`)}
                      className="group flex min-w-0 flex-1 items-center gap-4 text-left outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
                    >
                      <span className="flex size-9 shrink-0 items-center justify-center border border-border bg-surface-raised text-accent">
                        <FilePlus2 />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-foreground">
                          {scene.name}
                        </span>
                        <span className="mt-1 block truncate text-xs text-muted">
                          Updated{' '}
                          {scene.updatedAt
                            ? new Date(scene.updatedAt).toLocaleString()
                            : 'recently'}
                        </span>
                      </span>
                      <ArrowRight className="size-4 shrink-0 text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-accent" />
                    </button>
                    <div className="flex shrink-0 items-center gap-1 border-l border-border pl-3">
                      <Button
                        size="icon"
                        variant="ghost"
                        title={`Edit ${scene.name}`}
                        aria-label={`Edit ${scene.name}`}
                        onClick={() => beginEdit(scene)}
                        disabled={deletingSceneId === scene.id}
                      >
                        <Pencil />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        title={`Delete ${scene.name}`}
                        aria-label={`Delete ${scene.name}`}
                        onClick={() => setDeleteTarget(scene)}
                        disabled={deletingSceneId === scene.id || savingSceneId === scene.id}
                      >
                        {deletingSceneId === scene.id ? (
                          <LoaderCircle className="animate-spin" />
                        ) : (
                          <Trash2 />
                        )}
                      </Button>
                    </div>
                  </div>
                  {editingSceneId === scene.id && (
                    <form
                      aria-label="Edit scene"
                      className="basis-full border-t border-border pt-3"
                      onSubmit={(event) => void handleUpdate(event, scene.id)}
                    >
                      <div className="flex flex-wrap items-end gap-2">
                        <label className="min-w-48 flex-1 text-xs text-muted">
                          Name
                          <input
                            value={editingSceneName}
                            onChange={(event) => setEditingSceneName(event.target.value)}
                            className="mt-1.5 h-8 w-full border border-border bg-surface-raised px-2 text-sm text-foreground outline-none focus:border-accent focus:ring-1 focus:ring-accent/50"
                            autoFocus
                          />
                        </label>
                        <Button
                          type="submit"
                          size="icon"
                          variant="primary"
                          title="Save scene"
                          aria-label="Save scene"
                          disabled={savingSceneId === scene.id}
                        >
                          {savingSceneId === scene.id ? (
                            <LoaderCircle className="animate-spin" />
                          ) : (
                            <Check />
                          )}
                        </Button>
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          title="Cancel editing"
                          aria-label="Cancel editing"
                          onClick={cancelEdit}
                          disabled={savingSceneId === scene.id}
                        >
                          <X />
                        </Button>
                      </div>
                    </form>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="border border-dashed border-border-strong px-5 py-12 text-center">
              <FilePlus2 className="mx-auto size-6 text-muted" />
              <p className="mt-3 text-sm text-muted">No scenes in this project.</p>
              <Button
                className="mt-4"
                onClick={() => router.push(`/projects/${projectId}/scenes/new`)}
              >
                <Plus /> Create first scene
              </Button>
            </div>
          )}
          {pageInfo && pageInfo.totalPages > 1 && (
            <div className="mt-4 flex items-center justify-between border-t border-border pt-3">
              <span className="text-xs text-muted">
                Page {page} of {pageInfo.totalPages}
              </span>
              <div className="flex items-center gap-1">
                <Button
                  size="icon"
                  variant="ghost"
                  title="Previous scene page"
                  aria-label="Previous scene page"
                  onClick={() => {
                    setLoading(true);
                    setPage((current) => Math.max(1, current - 1));
                  }}
                  disabled={page === 1 || loading}
                >
                  <ChevronLeft />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  title="Next scene page"
                  aria-label="Next scene page"
                  onClick={() => {
                    setLoading(true);
                    setPage((current) => current + 1);
                  }}
                  disabled={page >= pageInfo.totalPages || loading}
                >
                  <ChevronRight />
                </Button>
              </div>
            </div>
          )}
        </section>
      </div>
      <DeleteDialog
        open={Boolean(deleteTarget)}
        itemName={deleteTarget?.name ?? ''}
        itemType="scene"
        busy={deletingSceneId === deleteTarget?.id}
        onCancel={() => {
          if (!deletingSceneId) setDeleteTarget(null);
        }}
        onConfirm={() => void handleDelete()}
      />
    </main>
  );
}

function InvalidState({ message, onBack }: { message: string; onBack: () => void }) {
  return (
    <main className="flex min-h-full items-center justify-center bg-background px-6 text-center text-sm text-danger">
      <div>
        <p>{message}</p>
        <Button className="mt-4" onClick={onBack}>
          Back to projects
        </Button>
      </div>
    </main>
  );
}

function LoadingState() {
  return (
    <main className="flex min-h-full items-center justify-center bg-background text-xs text-muted">
      <span className="flex items-center gap-2">
        <LoaderCircle className="size-4 animate-spin text-accent" /> Loading scenes
      </span>
    </main>
  );
}
