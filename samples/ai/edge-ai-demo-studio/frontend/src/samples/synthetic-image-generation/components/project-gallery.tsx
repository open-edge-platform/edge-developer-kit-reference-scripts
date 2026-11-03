// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Search } from 'lucide-react'
import { useState } from 'react'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
import { EmptyState } from '@/components/common/empty-state'
import { downloadBlob, downloadUrl } from '@/lib/browser/download'
import { fetchOk } from '@/lib/browser/fetch-json'
import type { GenerationBatchState } from '../hooks/use-generation-batch'
import { useDeleteAsset } from '../hooks/use-projects'
import type { GeneratedImage } from '../lib/types'
import { ImageCard, imageFileName } from './image-card'
import { ImagePreviewModal } from './image-preview-modal'
import { ProcessingOverlay } from './processing-overlay'
import { type GalleryFilter, ProjectHeader } from './project-header'

interface ProjectGalleryProps {
  apiBase: string | undefined
  projects: string[]
  currentProject: string
  onProjectChange: (project: string) => void
  onCreateProject: () => void
  /** This tab's images (generating and failed ones) first, then the history. */
  images: GeneratedImage[]
  batch: Pick<GenerationBatchState, 'retry' | 'remove' | 'forgetUrl'>
}

/**
 * The right column: the current project's images, filtered by type. A failed
 * image keeps its place with its error, to be retried or removed.
 */
export function ProjectGallery({
  apiBase,
  projects,
  currentProject,
  onProjectChange,
  onCreateProject,
  images,
  batch,
}: ProjectGalleryProps) {
  const [filter, setFilter] = useState<GalleryFilter>('all')
  const [previewing, setPreviewing] = useState<GeneratedImage | null>(null)
  const [deleting, setDeleting] = useState<GeneratedImage | null>(null)
  const [downloadingId, setDownloadingId] = useState<string | null>(null)
  const { mutateAsync: deleteAsset } = useDeleteAsset(apiBase)

  const shown = images.filter(
    (img) =>
      img.project === currentProject &&
      (filter === 'all' || img.type === filter),
  )

  const download = async (img: GeneratedImage) => {
    setDownloadingId(img.id)
    const fileName = `dataset-${imageFileName(img)}`
    try {
      const response = await fetchOk(img.url)
      downloadBlob(await response.blob(), fileName)
    } catch {
      // Let the browser fetch it directly if the blob could not be read.
      downloadUrl(img.url, fileName)
    } finally {
      setDownloadingId(null)
    }
  }

  const confirmDelete = async (img: GeneratedImage) => {
    await deleteAsset(img.url)
    batch.forgetUrl(img.url)
    if (previewing?.url === img.url) setPreviewing(null)
  }

  return (
    <>
      <ProjectHeader
        apiBase={apiBase}
        currentProject={currentProject}
        projects={projects}
        onProjectChange={onProjectChange}
        filter={filter}
        onFilterChange={setFilter}
        onCreateProject={onCreateProject}
      />

      {shown.length === 0 ? (
        <EmptyState
          icon={Search}
          size="sm"
          title="No generated assets yet"
          description="Upload a base image and configure your parameters to begin synthetic generation."
          className="py-24 opacity-70"
        />
      ) : (
        <div className="grid max-h-[625px] grid-cols-1 gap-6 overflow-y-auto pr-2 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((img) => (
            <ImageCard
              key={img.id}
              img={img}
              busy={downloadingId !== null}
              onSelect={() => setPreviewing(img)}
              onDownload={() => void download(img)}
              onDelete={() => setDeleting(img)}
              onRetry={() => batch.retry(img.id)}
              onRemove={() => batch.remove(img.id)}
            />
          ))}
        </div>
      )}

      {previewing && (
        <ImagePreviewModal
          image={previewing}
          onClose={() => setPreviewing(null)}
        />
      )}

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null)
        }}
        variant="destructive"
        title="Delete this image?"
        description={
          deleting
            ? `${imageFileName(deleting)} is deleted from the project. This cannot be undone.`
            : undefined
        }
        confirmLabel="Delete image"
        pendingLabel="Deleting…"
        onConfirm={() => (deleting ? confirmDelete(deleting) : undefined)}
      />

      {downloadingId && <ProcessingOverlay />}
    </>
  )
}
