// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client';

import { Button, DeleteDialog, Dialog } from '@mujoco-studio/ui';
import {
  ArrowRight,
  Check,
  ChevronLeft,
  ChevronRight,
  FolderKanban,
  FolderPlus,
  LoaderCircle,
  Pencil,
  Trash2,
  X,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import {
  createProject,
  deleteProject,
  listProjects,
  updateProject,
  type ProjectSummary,
} from '@/lib/scenes/api';

const PAGE_SIZE = 8;

export function ProjectBrowser() {
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [editingProjectId, setEditingProjectId] = useState<number | null>(null);
  const [editingName, setEditingName] = useState('');
  const [editingDescription, setEditingDescription] = useState('');
  const [savingProjectId, setSavingProjectId] = useState<number | null>(null);
  const [deletingProjectId, setDeletingProjectId] = useState<number | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ProjectSummary | null>(null);
  const [page, setPage] = useState(1);
  const [pageInfo, setPageInfo] = useState<{
    totalPages: number;
    totalDocs: number;
  } | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    listProjects({ page, limit: PAGE_SIZE })
      .then((loadedPage) => {
        if (!active) return;
        setProjects(loadedPage.docs);
        setPageInfo(loadedPage);
      })
      .catch((reason: unknown) => {
        if (!active) return;
        setError(reason instanceof Error ? reason.message : 'Projects could not be loaded.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [page, refreshKey, router]);

  async function handleCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim()) {
      setCreateError('Enter a project name.');
      return;
    }
    setCreating(true);
    setCreateError(null);
    try {
      const project = await createProject(name, description);
      router.push(`/projects/${project.id}`);
    } catch (reason) {
      setCreateError(
        reason instanceof Error ? reason.message : 'The project could not be created.',
      );
    } finally {
      setCreating(false);
    }
  }

  function openCreateDialog() {
    setName('');
    setDescription('');
    setCreateError(null);
    setCreateDialogOpen(true);
  }

  function closeCreateDialog() {
    if (!creating) setCreateDialogOpen(false);
  }

  function beginEdit(project: ProjectSummary) {
    setEditingProjectId(project.id);
    setEditingName(project.name);
    setEditingDescription(project.description ?? '');
    setError(null);
  }

  function cancelEdit() {
    setEditingProjectId(null);
    setEditingName('');
    setEditingDescription('');
  }

  async function handleUpdate(event: React.FormEvent<HTMLFormElement>, projectId: number) {
    event.preventDefault();
    if (!editingName.trim()) {
      setError('Enter a project name.');
      return;
    }
    setSavingProjectId(projectId);
    setError(null);
    try {
      const updatedProject = await updateProject(projectId, {
        name: editingName,
        description: editingDescription,
      });
      setProjects((current) =>
        current.map((project) => (project.id === projectId ? updatedProject : project)),
      );
      cancelEdit();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The project could not be updated.');
    } finally {
      setSavingProjectId(null);
    }
  }

  async function handleDelete() {
    const project = deleteTarget;
    if (!project) return;
    setDeletingProjectId(project.id);
    setError(null);
    try {
      await deleteProject(project.id);
      if (projects.length === 1 && page > 1) setPage((current) => current - 1);
      setRefreshKey((current) => current + 1);
      if (editingProjectId === project.id) cancelEdit();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The project could not be deleted.');
    } finally {
      setDeletingProjectId(null);
      setDeleteTarget(null);
    }
  }

  if (loading) {
    return <LoadingState label="Loading projects" />;
  }

  return (
    <main className="h-full overflow-y-auto bg-background px-6 py-10 text-foreground">
      <div className="mx-auto max-w-5xl">
        <header className="mb-10 flex items-end justify-between gap-6 border-b border-border pb-5">
          <div>
            <p className="mb-2 text-[10px] uppercase tracking-[0.24em] text-accent">
              Physical AI Scene Builder
            </p>
            <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
            <p className="mt-2 text-sm text-muted">Choose a workspace for your scenes.</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="primary" onClick={openCreateDialog}>
              <FolderPlus /> Create project
            </Button>
          </div>
        </header>

        {error && <ErrorMessage message={error} />}

        <div className="grid gap-8">
          <section>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-xs font-medium uppercase tracking-[0.16em] text-muted">
                Your workspaces
              </h2>
              <span className="font-mono text-[11px] text-muted">
                {pageInfo?.totalDocs ?? projects.length}
              </span>
            </div>
            {projects.length ? (
              <div className="grid gap-2">
                {projects.map((project) => (
                  <div
                    key={project.id}
                    className="border border-border bg-surface transition-colors hover:border-border-strong"
                  >
                    <div className="flex min-h-20 items-center gap-4 px-4">
                      <button
                        type="button"
                        onClick={() => router.push(`/projects/${project.id}`)}
                        className="group flex min-w-0 flex-1 items-center gap-4 text-left outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
                      >
                        <span className="flex size-9 shrink-0 items-center justify-center border border-border bg-surface-raised text-accent">
                          <FolderKanban />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-foreground">
                            {project.name}
                          </span>
                          <span className="mt-1 block truncate text-xs text-muted">
                            {project.description || 'No description'}
                          </span>
                        </span>
                        <ArrowRight className="size-4 shrink-0 text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-accent" />
                      </button>
                      <div className="flex shrink-0 items-center gap-1 border-l border-border pl-3">
                        <Button
                          size="icon"
                          variant="ghost"
                          title={`Edit ${project.name}`}
                          aria-label={`Edit ${project.name}`}
                          onClick={() => beginEdit(project)}
                          disabled={deletingProjectId === project.id}
                        >
                          <Pencil />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          title={`Delete ${project.name}`}
                          aria-label={`Delete ${project.name}`}
                          onClick={() => setDeleteTarget(project)}
                          disabled={
                            deletingProjectId === project.id || savingProjectId === project.id
                          }
                        >
                          {deletingProjectId === project.id ? (
                            <LoaderCircle className="animate-spin" />
                          ) : (
                            <Trash2 />
                          )}
                        </Button>
                      </div>
                    </div>
                    {editingProjectId === project.id && (
                      <form
                        aria-label="Edit project"
                        className="grid gap-3 border-t border-border bg-surface-raised p-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end"
                        onSubmit={(event) => void handleUpdate(event, project.id)}
                      >
                        <label className="block text-xs text-muted">
                          Name
                          <input
                            value={editingName}
                            onChange={(event) => setEditingName(event.target.value)}
                            className="mt-1.5 h-8 w-full border border-border bg-surface px-2 text-sm text-foreground outline-none focus:border-accent focus:ring-1 focus:ring-accent/50"
                            autoFocus
                          />
                        </label>
                        <label className="block text-xs text-muted">
                          Description
                          <input
                            value={editingDescription}
                            onChange={(event) => setEditingDescription(event.target.value)}
                            className="mt-1.5 h-8 w-full border border-border bg-surface px-2 text-sm text-foreground outline-none focus:border-accent focus:ring-1 focus:ring-accent/50"
                          />
                        </label>
                        <div className="flex items-center gap-1">
                          <Button
                            type="submit"
                            size="icon"
                            variant="primary"
                            title="Save project"
                            aria-label="Save project"
                            disabled={savingProjectId === project.id}
                          >
                            {savingProjectId === project.id ? (
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
                            disabled={savingProjectId === project.id}
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
                <FolderKanban className="mx-auto size-6 text-muted" />
                <p className="mt-3 text-sm text-muted">No projects yet.</p>
                <Button className="mt-4" onClick={openCreateDialog}>
                  <FolderPlus /> Create project
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
                    title="Previous project page"
                    aria-label="Previous project page"
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
                    title="Next project page"
                    aria-label="Next project page"
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
        <Dialog
          open={createDialogOpen}
          title="Create project"
          description="Start a new workspace for your robotic scenes."
          onClose={closeCreateDialog}
        >
          <form onSubmit={handleCreate} className="space-y-4">
            {createError && <ErrorMessage message={createError} />}
            <label className="block text-xs text-muted">
              Name
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                className="mt-1.5 h-9 w-full border border-border bg-surface-raised px-3 text-sm text-foreground outline-none focus:border-accent focus:ring-1 focus:ring-accent/50"
                placeholder="Warehouse study"
                autoFocus
              />
            </label>
            <label className="block text-xs text-muted">
              Description
              <textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                rows={3}
                className="mt-1.5 w-full resize-none border border-border bg-surface-raised px-3 py-2 text-sm text-foreground outline-none focus:border-accent focus:ring-1 focus:ring-accent/50"
                placeholder="Optional"
              />
            </label>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={closeCreateDialog} disabled={creating}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" disabled={creating}>
                {creating ? <LoaderCircle className="animate-spin" /> : <FolderPlus />}
                {creating ? 'Creating' : 'Create project'}
              </Button>
            </div>
          </form>
        </Dialog>
        <DeleteDialog
          open={Boolean(deleteTarget)}
          itemName={deleteTarget?.name ?? ''}
          itemType="project"
          busy={deletingProjectId === deleteTarget?.id}
          onCancel={() => {
            if (!deletingProjectId) setDeleteTarget(null);
          }}
          onConfirm={() => void handleDelete()}
        />
      </div>
    </main>
  );
}

function LoadingState({ label }: { label: string }) {
  return (
    <main className="flex min-h-full items-center justify-center bg-background text-xs text-muted">
      <span className="flex items-center gap-2">
        <LoaderCircle className="size-4 animate-spin text-accent" />
        {label}
      </span>
    </main>
  );
}

function ErrorMessage({ message }: { message: string }) {
  return (
    <p className="mb-5 border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
      {message}
    </p>
  );
}
