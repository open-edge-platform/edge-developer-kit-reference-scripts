// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import NextImage from 'next/image'
import {
  Upload,
  Settings,
  Layers,
  Image as ImageIcon,
  X,
  ChevronRight,
  Search,
  Zap,
  Loader2,
  ChevronDown,
  Download,
  Trash2,
  Plus,
  Folder,
} from 'lucide-react'
import { useCallback, useMemo, useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useServiceLiveStatus } from '@/context/service-status-context'
import type { Sample } from '../types'
import {
  GenerationType,
  useDeleteSyntheticImageAsset,
  useCreateSyntheticImageProject,
  useDeleteSyntheticImageProject,
  useExportSyntheticImageProject,
  useGenerateSyntheticImage,
  useGetSyntheticImageHistory,
  useGetSyntheticImageProjects,
} from './hooks'

interface GeneratedImage {
  id: string
  url: string
  type: GenerationType
  customTypeRaw?: string
  timestamp: number
  prompt: string
  isLoading?: boolean
  project?: string
  maskUrl?: string
}

export function SyntheticImageGenerationDemo({
  sample: _sample,
}: {
  sample: Sample
}) {
  const serviceStatus = useServiceLiveStatus('synthetic-image-generation')
  const isServicesReady = serviceStatus === 'online'

  const { data: projectsData, refetch: refetchProjects } =
    useGetSyntheticImageProjects(isServicesReady)
  const { data: historyUrlsData, refetch: refetchHistory } =
    useGetSyntheticImageHistory(isServicesReady)
  const projects = useMemo(() => projectsData ?? [], [projectsData])
  const historyUrls = useMemo(() => historyUrlsData ?? [], [historyUrlsData])
  const generateSyntheticImageMutation = useGenerateSyntheticImage()
  const deleteAssetMutation = useDeleteSyntheticImageAsset()
  const createProjectMutation = useCreateSyntheticImageProject()
  const deleteProjectMutation = useDeleteSyntheticImageProject()
  const exportProjectMutation = useExportSyntheticImageProject()

  const [image, setImage] = useState<string | null>(null)
  const [referenceImage, setReferenceImage] = useState<string | null>(null)

  const [genType, setGenType] = useState<GenerationType>(
    GenerationType.GOOD_DATASET,
  )
  const objective = ''
  const [customPrompt, setCustomPrompt] = useState('')
  const [customType, setCustomType] = useState('')
  const [count, setCount] = useState(1)
  const [isGenerating, setIsGenerating] = useState(false)

  const [localImages, setLocalImages] = useState<GeneratedImage[]>([])
  const [deletedIds, setDeletedIds] = useState<Set<string>>(() => new Set())
  const [activeTab, setActiveTab] = useState<GenerationType | 'all'>('all')
  const [selectedImage, setSelectedImage] = useState<GeneratedImage | null>(
    null,
  )

  const [selectedProject, setSelectedProject] = useState<string | null>(null)
  const currentProject = useMemo(() => {
    if (selectedProject !== null && projects.includes(selectedProject))
      return selectedProject
    return projects[0] ?? ''
  }, [selectedProject, projects])
  const setCurrentProject = setSelectedProject
  const [isProjectDropdownOpen, setIsProjectDropdownOpen] = useState(false)

  const historyImages = useMemo<GeneratedImage[]>(() => {
    if (historyUrls.length === 0) return []
    return historyUrls.map((url, i) => {
      let type = GenerationType.GOOD_DATASET
      let customTypeRaw: string | undefined
      let timestamp = 0
      let datePart = ''
      let projectName = 'Default Project'

      const filename = url.split('/').pop() || ''
      const urlDecoded = decodeURIComponent(url)
      const outputsIndex = urlDecoded.indexOf('/outputs/')

      if (outputsIndex !== -1) {
        const pathParts = urlDecoded.substring(outputsIndex + 9).split('/')
        if (pathParts.length >= 3) {
          projectName = pathParts[0]
          const typeStr = pathParts[1]

          if (typeStr === 'SYNTHETIC') type = GenerationType.GOOD_DATASET
          else if (typeStr === 'MISSING_COMPONENT')
            type = GenerationType.MISSING_COMPONENTS
          else if (typeStr.startsWith('CUSTOM')) {
            type = GenerationType.CUSTOM
            if (typeStr.startsWith('CUSTOM_')) {
              customTypeRaw = typeStr.substring(7)
            }
          }
          const nameParts = pathParts[2].split('-')
          if (nameParts.length > 0) datePart = nameParts[0]
        } else if (!filename.includes('-')) {
          const parts = filename.split('_')
          datePart = parts[0]
          if (parts.length >= 3) {
            const typeStr = parts.slice(1, parts.length - 1).join('_')
            if (typeStr === 'SYNTHETIC') type = GenerationType.GOOD_DATASET
            else if (typeStr === 'MISSING_COMPONENT')
              type = GenerationType.MISSING_COMPONENTS
            else if (typeStr === 'CUSTOM') type = GenerationType.CUSTOM
            else if (typeStr.startsWith('CUSTOM_')) {
              type = GenerationType.CUSTOM
              customTypeRaw = typeStr.substring(7)
            }
          }
        }
      } else {
        if (filename.includes('_')) {
          const parts = filename.split('_')
          datePart = parts[0]
        }
      }

      if (datePart && datePart.length === 14) {
        const year = parseInt(datePart.substring(0, 4))
        const month = parseInt(datePart.substring(4, 6)) - 1
        const day = parseInt(datePart.substring(6, 8))
        const hour = parseInt(datePart.substring(8, 10))
        const minute = parseInt(datePart.substring(10, 12))
        const second = parseInt(datePart.substring(12, 14))
        timestamp = new Date(year, month, day, hour, minute, second).getTime()
      }

      const maskUrl =
        type === GenerationType.MISSING_COMPONENTS
          ? url.replace(/\.png$/, '-mask.png')
          : undefined

      return {
        id: `history-${i}`,
        url,
        type,
        customTypeRaw,
        timestamp,
        prompt: '',
        project: projectName,
        maskUrl,
      }
    })
  }, [historyUrls])

  const generatedImages = useMemo<GeneratedImage[]>(() => {
    const historyFiltered = historyImages.filter(
      (img) => !deletedIds.has(img.id),
    )
    return [...localImages, ...historyFiltered]
  }, [localImages, historyImages, deletedIds])

  const setGeneratedImages = useCallback(
    (
      updater:
        | GeneratedImage[]
        | ((prev: GeneratedImage[]) => GeneratedImage[]),
    ) => {
      if (typeof updater === 'function') {
        setLocalImages((prevLocal) => {
          const prevAll = [
            ...prevLocal,
            ...historyImages.filter((img) => !deletedIds.has(img.id)),
          ]
          const next = updater(prevAll)
          const historyIds = new Set(historyImages.map((img) => img.id))
          const newDeleted = new Set(deletedIds)
          historyImages.forEach((img) => {
            if (!next.find((n) => n.id === img.id)) newDeleted.add(img.id)
            else newDeleted.delete(img.id)
          })
          setDeletedIds(newDeleted)
          return next.filter((img) => !historyIds.has(img.id))
        })
      } else {
        const historyIds = new Set(historyImages.map((img) => img.id))
        const newDeleted = new Set(deletedIds)
        historyImages.forEach((img) => {
          if (!updater.find((n) => n.id === img.id)) newDeleted.add(img.id)
          else newDeleted.delete(img.id)
        })
        setDeletedIds(newDeleted)
        setLocalImages(updater.filter((img) => !historyIds.has(img.id)))
      }
    },
    [historyImages, deletedIds],
  )

  const projectImages = generatedImages.filter(
    (img) => img.project === currentProject,
  )
  const filteredImages =
    activeTab === 'all'
      ? projectImages
      : projectImages.filter((img) => img.type === activeTab)

  const [processingImageId, setProcessingImageId] = useState<string | null>(
    null,
  )
  const [processingAction, setProcessingAction] = useState<
    'delete' | 'download' | null
  >(null)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const refInputRef = useRef<HTMLInputElement>(null)
  const projectDropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSelectedImage(null)
      }
    }

    if (selectedImage) {
      window.addEventListener('keydown', handleKeyDown)
    }

    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedImage])

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      const reader = new FileReader()
      reader.onloadend = () => {
        setImage(reader.result as string)
      }
      reader.readAsDataURL(file)
    }
  }

  const handleReferenceImageChange = (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = e.target.files?.[0]
    if (file) {
      const reader = new FileReader()
      reader.onloadend = () => {
        setReferenceImage(reader.result as string)
      }
      reader.readAsDataURL(file)
    }
  }

  const handleGenerate = useCallback(async () => {
    if (!image) return

    setIsGenerating(true)
    const base64Image = image.split(',')[1]

    try {
      for (let i = 0; i < count; i++) {
        const placeholder: GeneratedImage = {
          id: (Date.now() + i).toString(),
          url: '',
          type: genType,
          customTypeRaw:
            genType === GenerationType.CUSTOM ? customType : undefined,
          timestamp: Date.now(),
          prompt: 'Generating...',
          isLoading: true,
          project: currentProject,
        }

        setGeneratedImages((prev) => [placeholder, ...prev])

        try {
          const { imageUrls, finalPrompt, maskUrl } =
            await generateSyntheticImageMutation.mutateAsync({
              baseImage64: base64Image,
              referenceImage64: referenceImage
                ? referenceImage.split(',')[1]
                : undefined,
              type: genType,
              objective,
              customPrompt,
              customType,
              projectName: currentProject,
            })

          setGeneratedImages((prev) =>
            prev.map((img) => {
              if (img.id === placeholder.id) {
                return {
                  ...img,
                  url: imageUrls[0],
                  prompt: finalPrompt,
                  isLoading: false,
                  maskUrl,
                }
              }
              return img
            }),
          )
        } catch {
          setGeneratedImages((prev) =>
            prev.filter((img) => img.id !== placeholder.id),
          )
        }
      }
    } finally {
      setIsGenerating(false)
    }
  }, [
    image,
    referenceImage,
    count,
    genType,
    customType,
    objective,
    customPrompt,
    currentProject,
    generateSyntheticImageMutation,
    setGeneratedImages,
  ])

  const handleDownload = useCallback(async (img: GeneratedImage) => {
    setProcessingImageId(img.id)
    setProcessingAction('download')

    await new Promise((resolve) => setTimeout(() => resolve(undefined), 800))

    try {
      const response = await fetch(img.url)
      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `dataset-${img.id}.png`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      window.URL.revokeObjectURL(url)
    } catch {
      const link = document.createElement('a')
      link.href = img.url
      link.download = `dataset-${img.id}.png`
      link.target = '_blank'
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
    } finally {
      setProcessingImageId(null)
      setProcessingAction(null)
    }
  }, [])

  const handleDelete = useCallback(
    async (id: string, url: string) => {
      setProcessingImageId(id)
      setProcessingAction('delete')

      try {
        const filename = url.split('/').slice(-3).join('/')
        if (filename) {
          await deleteAssetMutation.mutateAsync(filename)
          await new Promise((resolve) =>
            setTimeout(() => resolve(undefined), 500),
          )
          setGeneratedImages((prev) => prev.filter((img) => img.id !== id))
          if (selectedImage?.id === id) {
            setSelectedImage(null)
          }
        }
      } finally {
        setProcessingImageId(null)
        setProcessingAction(null)
      }
    },
    [deleteAssetMutation, selectedImage, setGeneratedImages],
  )

  return (
    <>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-10">
        <section className="flex flex-col space-y-6 lg:col-span-3">
          <div className="bg-card border-border text-card-foreground h-full rounded-2xl border p-6 shadow-xl">
            <div className="mb-6 flex items-center gap-2">
              <Settings className="text-primary h-5 w-5" />
              <h2 className="text-lg font-semibold">
                Generation Configuration
              </h2>
            </div>

            <div className="space-y-5">
              <div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label
                      htmlFor="image-upload"
                      className="text-muted-foreground mb-2 block text-xs font-bold uppercase"
                    >
                      Base Image
                    </label>
                    <div
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          fileInputRef.current?.click()
                        }
                      }}
                      onClick={() => fileInputRef.current?.click()}
                      className={`group relative cursor-pointer overflow-hidden rounded-xl border-2 border-dashed transition-all duration-300 ${
                        image
                          ? 'border-primary/50'
                          : 'border-border hover:border-primary/50'
                      }`}
                      style={{ aspectRatio: '1/1' }}
                    >
                      {image ? (
                        <NextImage
                          src={image}
                          className="object-cover"
                          alt="Base image"
                          fill
                          unoptimized
                        />
                      ) : (
                        <div className="text-muted-foreground flex h-full flex-col items-center justify-center gap-2 p-2">
                          <Upload className="group-hover:text-foreground h-6 w-6 transition-colors" />
                          <span className="text-center text-xs font-medium">
                            Upload source
                          </span>
                        </div>
                      )}
                      {image && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            setImage(null)
                            if (fileInputRef.current)
                              fileInputRef.current.value = ''
                          }}
                          className="absolute top-2 right-2 rounded-full bg-black/50 p-1 transition-colors hover:bg-black/70"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                    <input
                      id="image-upload"
                      type="file"
                      ref={fileInputRef}
                      onChange={handleImageChange}
                      accept="image/*"
                      className="hidden"
                    />
                  </div>

                  {genType === GenerationType.CUSTOM && (
                    <div>
                      <label
                        htmlFor="reference-upload"
                        className="text-muted-foreground mb-2 block text-xs font-bold uppercase"
                      >
                        Reference Image
                      </label>
                      <div
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            refInputRef.current?.click()
                          }
                        }}
                        onClick={() => refInputRef.current?.click()}
                        className={`group relative cursor-pointer overflow-hidden rounded-xl border-2 border-dashed transition-all duration-300 ${
                          referenceImage
                            ? 'border-primary/50'
                            : 'border-border hover:border-primary/50'
                        }`}
                        style={{ aspectRatio: '1/1' }}
                      >
                        {referenceImage ? (
                          <NextImage
                            src={referenceImage}
                            className="object-cover"
                            alt="Reference image"
                            fill
                            unoptimized
                          />
                        ) : (
                          <div className="text-muted-foreground flex h-full flex-col items-center justify-center gap-2 p-2">
                            <Upload className="group-hover:text-foreground h-6 w-6 transition-colors" />
                            <span className="text-center text-xs font-medium">
                              Upload reference
                            </span>
                          </div>
                        )}
                        {referenceImage && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              setReferenceImage(null)
                              if (refInputRef.current)
                                refInputRef.current.value = ''
                            }}
                            className="absolute top-2 right-2 rounded-full bg-black/50 p-1 transition-colors hover:bg-black/70"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        )}
                      </div>
                      <input
                        id="reference-upload"
                        type="file"
                        ref={refInputRef}
                        onChange={handleReferenceImageChange}
                        accept="image/*"
                        className="hidden"
                      />
                      <p className="text-muted-foreground mt-1 text-[10px]">
                        Optional — used as style guide
                      </p>
                    </div>
                  )}
                </div>
              </div>

              <div>
                <span className="text-muted-foreground mb-2 block text-xs font-bold uppercase">
                  Generation Type
                </span>
                <div className="grid grid-cols-1 gap-2">
                  <button
                    onClick={() => {
                      setGenType(GenerationType.GOOD_DATASET)
                      setReferenceImage(null)
                      if (refInputRef.current) refInputRef.current.value = ''
                    }}
                    className={`flex items-center justify-between rounded-xl border px-4 py-3 text-left transition-all ${
                      genType === GenerationType.GOOD_DATASET
                        ? 'bg-primary/10 border-primary/50 text-primary'
                        : 'bg-background border-border text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <Zap className="h-4 w-4" />
                      <span className="text-sm font-medium">Good Sample</span>
                    </div>
                    {genType === GenerationType.GOOD_DATASET && (
                      <ChevronRight className="h-4 w-4" />
                    )}
                  </button>
                  <button
                    onClick={() => {
                      setGenType(GenerationType.MISSING_COMPONENTS)
                      setReferenceImage(null)
                      if (refInputRef.current) refInputRef.current.value = ''
                    }}
                    className={`flex items-center justify-between rounded-xl border px-4 py-3 text-left transition-all ${
                      genType === GenerationType.MISSING_COMPONENTS
                        ? 'border-warning/50 bg-warning/10 text-warning'
                        : 'bg-background border-border text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <Layers className="h-4 w-4" />
                      <span className="text-sm font-medium">
                        Missing Components
                      </span>
                    </div>
                    {genType === GenerationType.MISSING_COMPONENTS && (
                      <ChevronRight className="h-4 w-4" />
                    )}
                  </button>
                  <button
                    onClick={() => setGenType(GenerationType.CUSTOM)}
                    className={`flex items-center justify-between rounded-xl border px-4 py-3 text-left transition-all ${
                      genType === GenerationType.CUSTOM
                        ? 'border-success/50 bg-success/10 text-success'
                        : 'bg-background border-border text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <ImageIcon className="h-4 w-4" />
                      <span className="text-sm font-medium">
                        Custom Generation (Experimental)
                      </span>
                    </div>
                    {genType === GenerationType.CUSTOM && (
                      <ChevronRight className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>

              {genType === GenerationType.CUSTOM && (
                <div className="animate-in slide-in-from-top-2 fade-in space-y-4 duration-300">
                  <div>
                    <label
                      htmlFor="custom-type"
                      className="text-muted-foreground mb-2 block text-xs font-bold uppercase"
                    >
                      Custom Type Name
                    </label>
                    <input
                      id="custom-type"
                      type="text"
                      value={customType}
                      onChange={(e) => setCustomType(e.target.value)}
                      placeholder="e.g. Broken Component"
                      className="bg-background border-input focus:ring-primary/50 w-full rounded-xl border px-4 py-3 text-sm transition-all focus:ring-2 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="custom-prompt"
                      className="text-muted-foreground mb-2 block text-xs font-bold uppercase"
                    >
                      User Instructions
                    </label>
                    <input
                      id="custom-prompt"
                      type="text"
                      value={customPrompt}
                      onChange={(e) => setCustomPrompt(e.target.value)}
                      placeholder="Describe specific modifications..."
                      className="bg-background border-input focus:ring-primary/50 w-full rounded-xl border px-4 py-3 text-sm transition-all focus:ring-2 focus:outline-none"
                    />
                  </div>
                </div>
              )}

              <div>
                <div className="mb-2 flex items-center justify-between">
                  <label
                    htmlFor="image-count"
                    className="text-muted-foreground text-xs font-bold uppercase"
                  >
                    Image Count
                  </label>
                  <span className="text-primary font-mono text-sm font-bold">
                    {count}
                  </span>
                </div>
                <input
                  id="image-count"
                  type="range"
                  min="1"
                  max="10"
                  value={count}
                  onChange={(e) => setCount(parseInt(e.target.value))}
                  className="accent-primary bg-muted h-1.5 w-full cursor-pointer appearance-none rounded-lg text-white"
                />
              </div>

              <button
                disabled={!image || isGenerating || projects.length === 0}
                onClick={handleGenerate}
                className={`flex w-full transform items-center justify-center gap-3 rounded-xl py-4 font-bold transition-all active:scale-[0.98] ${
                  !image || isGenerating || projects.length === 0
                    ? 'bg-muted text-muted-foreground cursor-not-allowed opacity-50'
                    : 'bg-primary hover:bg-primary/90 text-primary-foreground shadow-primary/20 shadow-lg'
                }`}
              >
                {isGenerating ? (
                  <>
                    <Loader2 className="h-5 w-5 animate-spin" />
                    <span>Processing Job...</span>
                  </>
                ) : (
                  <>
                    <Zap className="h-5 w-5" />
                    <span>Generate Synthetic Data</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </section>

        <section className="flex flex-col space-y-6 lg:col-span-7">
          <div className="bg-card border-border text-card-foreground h-full min-h-[500px] rounded-2xl border p-6 shadow-xl">
            {projects.length === 0 ? (
              <EmptyProjectsView
                isDisabled={!isServicesReady}
                onCreate={async () => {
                  const name = prompt('Enter project name:')
                  if (name) {
                    const newProjectName =
                      await createProjectMutation.mutateAsync(name)
                    await refetchProjects()
                    setCurrentProject(newProjectName)
                  }
                }}
              />
            ) : (
              <>
                <ProjectHeader
                  currentProject={currentProject}
                  projects={projects}
                  isProjectDropdownOpen={isProjectDropdownOpen}
                  setIsProjectDropdownOpen={setIsProjectDropdownOpen}
                  setCurrentProject={setCurrentProject}
                  projectDropdownRef={projectDropdownRef}
                  activeTab={activeTab}
                  setActiveTab={setActiveTab}
                  onCreateProject={async () => {
                    const name = prompt('Enter project name:')
                    if (name) {
                      const newProjectName =
                        await createProjectMutation.mutateAsync(name)
                      await refetchProjects()
                      setCurrentProject(newProjectName)
                    }
                  }}
                  onExportProject={async () => {
                    await exportProjectMutation.mutateAsync(currentProject)
                  }}
                  isExporting={exportProjectMutation.isPending}
                  onDeleteProject={async () => {
                    if (projects.length <= 1) return
                    await deleteProjectMutation.mutateAsync(currentProject)
                    await refetchProjects()
                    await refetchHistory()
                  }}
                />

                {filteredImages.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-24 text-center opacity-50">
                    <div className="bg-muted border-border mb-4 flex h-20 w-20 items-center justify-center rounded-full border">
                      <Search className="text-muted-foreground h-10 w-10" />
                    </div>
                    <h3 className="text-foreground mb-2 text-lg font-medium">
                      No generated assets yet
                    </h3>
                    <p className="text-muted-foreground max-w-xs text-sm">
                      Upload a base image and configure your parameters to begin
                      synthetic generation.
                    </p>
                  </div>
                ) : (
                  <div className="grid max-h-[625px] grid-cols-1 gap-6 overflow-y-auto pr-2 sm:grid-cols-2 lg:grid-cols-3">
                    {filteredImages.map((img) => (
                      <ImageCard
                        key={img.id}
                        img={img}
                        processingImageId={processingImageId}
                        onSelect={() => !img.isLoading && setSelectedImage(img)}
                        onDownload={() => handleDownload(img)}
                        onDelete={() => handleDelete(img.id, img.url)}
                      />
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </section>
      </div>

      {selectedImage && (
        <ImagePreviewModal
          image={selectedImage}
          onClose={() => setSelectedImage(null)}
        />
      )}

      {processingImageId && (
        <div className="animate-in fade-in fixed inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-sm duration-200">
          <div className="bg-card border-border mx-4 flex w-full max-w-sm flex-col items-center gap-6 rounded-2xl border p-8 shadow-2xl">
            <div className="relative">
              <div className="bg-primary/20 absolute inset-0 animate-pulse rounded-full blur-xl" />
              <Loader2 className="text-primary relative z-10 h-12 w-12 animate-spin" />
            </div>
            <div className="space-y-2 text-center">
              <h3 className="text-foreground text-xl font-bold">
                {processingAction === 'download'
                  ? 'Exporting Asset...'
                  : 'Deleting Asset...'}
              </h3>
              <p className="text-muted-foreground text-sm">
                Please wait while we process your request.
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

/* ─── Sub-components ──────────────────────────────────────────────── */

function EmptyProjectsView({
  isDisabled,
  onCreate,
}: {
  isDisabled: boolean
  onCreate: () => void
}) {
  return (
    <div className="text-muted-foreground flex h-full flex-col items-center justify-center gap-6 py-24">
      <div className="bg-background border-border flex h-20 w-20 items-center justify-center rounded-full border shadow-xl">
        <Folder className="text-primary h-10 w-10" />
      </div>
      <div className="max-w-md space-y-2 text-center">
        <h1 className="text-foreground text-xl font-bold">No Projects Found</h1>
        <p className="text-muted-foreground text-sm">
          Create your first project to start generating synthetic datasets.
        </p>
      </div>
      <button
        onClick={onCreate}
        className="bg-primary hover:bg-primary/90 text-primary-foreground shadow-primary/20 flex items-center gap-2 rounded-lg px-6 py-3 font-bold shadow-lg transition-all active:scale-95"
        disabled={isDisabled}
      >
        <Plus className="h-5 w-5" />
        <span>Create New Project</span>
      </button>
    </div>
  )
}

function ProjectHeader({
  currentProject,
  projects,
  isProjectDropdownOpen,
  setIsProjectDropdownOpen,
  setCurrentProject,
  projectDropdownRef,
  activeTab,
  setActiveTab,
  onCreateProject,
  onExportProject,
  isExporting,
  onDeleteProject,
}: {
  currentProject: string
  projects: string[]
  isProjectDropdownOpen: boolean
  setIsProjectDropdownOpen: (v: boolean) => void
  setCurrentProject: (v: string) => void
  projectDropdownRef: React.RefObject<HTMLDivElement | null>
  activeTab: GenerationType | 'all'
  setActiveTab: (v: GenerationType | 'all') => void
  onCreateProject: () => void
  onExportProject: () => void
  isExporting: boolean
  onDeleteProject: () => void
}) {
  return (
    <div className="mb-6 flex flex-col gap-4">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <ImageIcon className="text-primary h-5 w-5" />
            <h2 className="text-lg font-semibold">Generated Dataset Assets</h2>
          </div>

          <div className="relative" ref={projectDropdownRef}>
            <button
              onClick={() => setIsProjectDropdownOpen(!isProjectDropdownOpen)}
              className="bg-primary hover:bg-primary/80 border-border text-foreground flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-medium text-white transition-colors"
            >
              <Folder className="h-3 w-3 text-white" />
              <span>{currentProject}</span>
              <ChevronDown
                className={`h-3 w-3 text-white transition-transform ${isProjectDropdownOpen ? 'rotate-180' : ''}`}
              />
            </button>

            {isProjectDropdownOpen && (
              <div className="bg-popover border-border animate-in fade-in zoom-in-95 absolute top-full left-0 z-20 mt-1 w-48 rounded-lg border py-1 shadow-xl duration-100">
                {projects.map((p) => (
                  <button
                    key={p}
                    onClick={() => {
                      setCurrentProject(p)
                      setIsProjectDropdownOpen(false)
                    }}
                    className="hover:bg-accent hover:text-accent-foreground text-popover-foreground w-full px-4 py-2 text-left text-xs"
                  >
                    {p}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            className="bg-primary hover:bg-primary/90 text-primary-foreground shadow-primary/20 flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-bold shadow-lg transition-colors"
            onClick={onCreateProject}
          >
            <Plus className="h-3 w-3" />
            <span>New Project</span>
          </button>
          <button
            onClick={onExportProject}
            disabled={isExporting}
            className="flex items-center gap-2 rounded-md bg-green-600 px-3 py-1.5 text-xs font-bold text-white shadow-lg shadow-green-500/20 transition-colors hover:bg-green-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isExporting ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Download className="h-3 w-3" />
            )}
            <span>{isExporting ? 'Exporting...' : 'Download'}</span>
          </button>
          <button
            onClick={onDeleteProject}
            disabled={projects.length <= 1}
            className="bg-destructive hover:bg-destructive/90 shadow-destructive/20 flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-bold text-white shadow-lg transition-colors disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Trash2 className="h-3 w-3" />
            <span>Delete</span>
          </button>
        </div>
      </div>

      <div className="bg-muted border-border flex w-fit gap-1 overflow-x-auto rounded-lg border p-1 whitespace-nowrap">
        {(
          [
            'all',
            GenerationType.GOOD_DATASET,
            GenerationType.MISSING_COMPONENTS,
            GenerationType.CUSTOM,
          ] as const
        ).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`rounded-md px-4 py-1.5 text-xs font-semibold transition-all ${
              activeTab === tab
                ? 'bg-background text-foreground border-border border shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {tab === 'all'
              ? 'All assets'
              : (tab.charAt(0).toUpperCase() + tab.slice(1))
                  .split('_')
                  .join(' ')}
          </button>
        ))}
      </div>
    </div>
  )
}

function ImageCard({
  img,
  processingImageId,
  onSelect,
  onDownload,
  onDelete,
}: {
  img: GeneratedImage
  processingImageId: string | null
  onSelect: () => void
  onDownload: () => void
  onDelete: () => void
}) {
  return (
    <div className="bg-card border-border group hover:border-primary/50 overflow-hidden rounded-xl border shadow-lg transition-colors">
      <div
        role="button"
        tabIndex={0}
        className="relative aspect-square cursor-pointer overflow-hidden"
        onClick={onSelect}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') onSelect()
        }}
      >
        {img.isLoading ? (
          <div className="bg-muted flex h-full w-full animate-pulse items-center justify-center">
            <Loader2 className="text-primary h-8 w-8 animate-spin" />
          </div>
        ) : (
          <NextImage
            src={img.url}
            className="object-cover transition-transform duration-500 group-hover:scale-105"
            alt="Generated"
            fill
            unoptimized
          />
        )}
        <div className="absolute top-2 left-2 flex gap-1">
          <TypeBadge type={img.type} />
          {img.type === GenerationType.CUSTOM && img.customTypeRaw && (
            <span className="bg-primary/90 text-primary-foreground border-border/50 rounded-full border px-2 py-0.5 text-[10px] font-bold text-white uppercase shadow-md backdrop-blur-sm">
              {img.customTypeRaw}
            </span>
          )}
        </div>
      </div>
      <div className="flex items-center justify-between gap-2 p-4">
        <div className="flex min-w-0 flex-col">
          <span className="text-muted-foreground block truncate font-mono text-[10px]">
            ID: {img.url.split('/').pop()}
          </span>
          <span className="text-muted-foreground text-[10px]">
            {new Date(img.timestamp).toLocaleTimeString()}
          </span>
        </div>
        <div className="flex gap-2">
          <button
            onClick={onDownload}
            disabled={processingImageId !== null}
            className={`bg-primary border-border flex items-center rounded-md border px-2 py-2 text-[10px] font-bold tracking-wider text-white uppercase transition-colors ${
              processingImageId !== null
                ? 'text-muted-foreground cursor-not-allowed opacity-50'
                : 'hover:border-primary/50 text-muted-foreground hover:text-foreground'
            }`}
            title="Download"
          >
            <Download className="h-3 w-3" />
          </button>
          <button
            onClick={onDelete}
            disabled={processingImageId !== null}
            className={`bg-secondary border-border flex items-center rounded-md border px-2 py-2 text-[10px] font-bold tracking-wider uppercase transition-colors ${
              processingImageId !== null
                ? 'text-muted-foreground cursor-not-allowed opacity-50'
                : 'hover:border-destructive/50 text-muted-foreground hover:text-destructive'
            }`}
            title="Delete"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      </div>
    </div>
  )
}

function TypeBadge({ type }: { type: GenerationType }) {
  const className =
    type === GenerationType.GOOD_DATASET
      ? 'bg-primary border-primary text-white'
      : type === GenerationType.MISSING_COMPONENTS
        ? 'border-warning bg-warning text-white'
        : 'border-success bg-success text-white'

  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${className}`}
    >
      {type.split('_')[0]}
    </span>
  )
}

function ImagePreviewModal({
  image,
  onClose,
}: {
  image: GeneratedImage
  onClose: () => void
}) {
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      className="animate-in fade-in fixed inset-0 z-50 flex items-center justify-center bg-black/95 p-4 transition-all duration-300"
    >
      <button
        onClick={onClose}
        className="absolute top-6 right-6 z-50 rounded-full border border-slate-700 bg-slate-800/50 p-2 text-slate-400 backdrop-blur-sm transition-colors hover:bg-slate-700 hover:text-white"
      >
        <X className="h-6 w-6" />
      </button>

      <div className="flex h-full w-full max-w-7xl flex-col items-center justify-center gap-4">
        {image.type === GenerationType.MISSING_COMPONENTS && image.maskUrl ? (
          <div className="flex w-full items-start justify-center gap-4">
            <div className="flex flex-1 flex-col items-center gap-2">
              <span className="text-xs font-bold tracking-widest text-slate-400 uppercase">
                Bounding Box Mask
              </span>
              <NextImage
                src={image.maskUrl}
                className="h-auto max-h-[72vh] w-auto max-w-full rounded-lg border border-slate-800 object-contain shadow-2xl"
                alt="Bounding box mask"
                height={1024}
                width={1024}
                unoptimized
              />
            </div>
            <div className="flex flex-1 flex-col items-center gap-2">
              <span className="text-xs font-bold tracking-widest text-slate-400 uppercase">
                Generated Image
              </span>
              <NextImage
                src={image.url}
                className="h-auto max-h-[72vh] w-auto max-w-full rounded-lg border border-slate-800 object-contain shadow-2xl"
                alt="Full preview"
                height={1024}
                width={1024}
                unoptimized
              />
            </div>
          </div>
        ) : (
          <NextImage
            src={image.url}
            className="h-auto max-h-[80vh] w-auto max-w-full rounded-lg border border-slate-800 object-contain shadow-2xl"
            alt="Full preview"
            height={1024}
            width={1024}
            unoptimized
          />
        )}

        <div className="w-full max-w-2xl rounded-xl border border-slate-800 bg-slate-900/90 p-4 backdrop-blur-sm">
          <div className="mb-2 flex items-center justify-between">
            <span className="font-mono text-xs text-slate-500">
              ID: {image.url.split('/').pop()}
            </span>
            <div className="flex gap-2">
              <TypeBadge type={image.type} />
              {image.type === GenerationType.CUSTOM && image.customTypeRaw && (
                <span className="rounded-full border border-slate-500/30 bg-slate-500/10 px-2 py-0.5 text-[10px] font-bold text-slate-400 uppercase">
                  {image.customTypeRaw}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
