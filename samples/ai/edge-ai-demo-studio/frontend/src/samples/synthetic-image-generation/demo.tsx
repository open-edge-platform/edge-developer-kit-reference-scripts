// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Folder, Plus } from 'lucide-react'
import { useState } from 'react'
import { EmptyState } from '@/components/common/empty-state'
import { Button } from '@/components/ui/button'
import {
  useServiceApiBase,
  useServiceLiveStatus,
} from '@/context/service-status-context'
import type { Sample } from '../types'
import { CreateProjectDialog } from './components/create-project-dialog'
import { GenerationConfigPanel } from './components/generation-config-panel'
import { ProjectGallery } from './components/project-gallery'
import { galleryImages } from './lib/gallery-images'
import { useGenerationBatch } from './hooks/use-generation-batch'
import { useProjectsAndHistory } from './hooks/use-projects'

export function SyntheticImageGenerationDemo({
  sample: _sample,
}: {
  sample: Sample
}) {
  const apiBase = useServiceApiBase('synthetic-image-generation')
  const isServicesReady =
    useServiceLiveStatus('synthetic-image-generation') === 'online'

  const { projects, historyUrls } = useProjectsAndHistory(
    apiBase,
    isServicesReady,
  )
  const batch = useGenerationBatch(apiBase)
  const images = galleryImages(historyUrls, batch.items)

  const [selectedProject, setSelectedProject] = useState<string | null>(null)
  const currentProject =
    selectedProject !== null && projects.includes(selectedProject)
      ? selectedProject
      : (projects[0] ?? '')
  const [creatingProject, setCreatingProject] = useState(false)

  return (
    <>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-10">
        <div className="lg:col-span-3">
          <GenerationConfigPanel projectName={currentProject} batch={batch} />
        </div>

        <section className="bg-card border-border text-card-foreground min-h-[500px] rounded-2xl border p-6 shadow-xl lg:col-span-7">
          {projects.length === 0 ? (
            <EmptyState
              icon={Folder}
              tone="primary"
              size="sm"
              title="No Projects Found"
              description="Create your first project to start generating synthetic datasets."
              className="h-full py-24"
            >
              <Button
                onClick={() => setCreatingProject(true)}
                disabled={!isServicesReady}
                className="mt-6 gap-2 font-bold"
              >
                <Plus className="h-5 w-5" aria-hidden />
                Create New Project
              </Button>
            </EmptyState>
          ) : (
            <ProjectGallery
              apiBase={apiBase}
              projects={projects}
              currentProject={currentProject}
              onProjectChange={setSelectedProject}
              onCreateProject={() => setCreatingProject(true)}
              images={images}
              batch={batch}
            />
          )}
        </section>
      </div>

      <CreateProjectDialog
        apiBase={apiBase}
        open={creatingProject}
        onOpenChange={setCreatingProject}
        onCreated={setSelectedProject}
      />
    </>
  )
}
