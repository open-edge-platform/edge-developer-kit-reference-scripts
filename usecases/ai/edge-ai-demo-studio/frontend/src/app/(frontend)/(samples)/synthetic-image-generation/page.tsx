// Copyright (C) 2025 Intel Corporation
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
  Image,
} from 'lucide-react'
import { useCallback, useMemo, useState, useRef, useEffect } from 'react'
import {
  getInactivePrerequisites,
  getPreparingPrerequisites,
  startPrerequisites,
} from '@/utils/prerequisite-utils'
import {
  useCreateWorkload,
  useGetWorkloadsStatus,
  useUpdateWorkload,
} from '@/hooks/use-workload'
import { SampleHeader, PrerequisiteBanner } from '@/components/samples'
import {
  GenerationType,
  useDeleteSyntheticImageAsset,
  useCreateSyntheticImageProject,
  useDeleteSyntheticImageProject,
  useExportSyntheticImageProject,
  useGenerateSyntheticImage,
  useGetSyntheticImageHistory,
  useGetSyntheticImageProjects,
} from '@/hooks/use-synthetic-image-generation'
import { LogsDropdown } from '@/components/samples/synthetic-image-generation/logging'
import { MetricsDropdown } from '@/components/samples/synthetic-image-generation/telemetry'
import { SYNTHETIC_IMAGE_GENERATION_WORKLOAD } from '@/lib/workloads/synthetic-image-generation'

interface GeneratedImage {
  id: string
  url: string
  type: GenerationType
  customTypeRaw?: string
  timestamp: number
  prompt: string
  isLoading?: boolean
  project?: string
}

export default function SyntheticImageGenerationPage() {
  const { data: workloads, isLoading: isWorkloadsLoading } =
    useGetWorkloadsStatus()
  const createWorkload = useCreateWorkload()
  const updateWorkload = useUpdateWorkload()

  const prerequisiteServices = useMemo(() => {
    const ps = [SYNTHETIC_IMAGE_GENERATION_WORKLOAD.name]
    return ps
  }, [])

  const inactivePrerequisites = useMemo(() => {
    return getInactivePrerequisites(prerequisiteServices, workloads)
  }, [prerequisiteServices, workloads])

  const preparingPrerequisites = useMemo(() => {
    return getPreparingPrerequisites(prerequisiteServices, workloads)
  }, [prerequisiteServices, workloads])

  const preparePrerequisite = useCallback(() => {
    startPrerequisites(
      prerequisiteServices,
      workloads,
      createWorkload,
      updateWorkload,
    )
  }, [createWorkload, prerequisiteServices, updateWorkload, workloads])

  const isServicesReady =
    !isWorkloadsLoading &&
    inactivePrerequisites.length === 0 &&
    preparingPrerequisites.length === 0

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

  const isDisabled = true // Placeholder for actual disabled logic
  const [image, setImage] = useState<string | null>(null)
  const [, setIsSettingsOpen] = useState(false)

  // Generation Configuration
  const [genType, setGenType] = useState<GenerationType>(
    GenerationType.GOOD_DATASET,
  )
  const objective = ''
  const [customPrompt, setCustomPrompt] = useState('')
  const [customType, setCustomType] = useState('')
  const [count, setCount] = useState(1)
  const [isGenerating, setIsGenerating] = useState(false)

  // Results & Tracking
  const [generatedImages, setGeneratedImages] = useState<GeneratedImage[]>([])
  const [activeTab, setActiveTab] = useState<GenerationType | 'all'>('all')
  const [selectedImage, setSelectedImage] = useState<GeneratedImage | null>(
    null,
  )

  // Project Management
  const [currentProject, setCurrentProject] = useState('')
  const [isProjectDropdownOpen, setIsProjectDropdownOpen] = useState(false)

  const projectImages = generatedImages.filter(
    (img) => img.project === currentProject,
  )
  const filteredImages =
    activeTab === 'all'
      ? projectImages
      : projectImages.filter((img) => img.type === activeTab)

  // Action Processing State
  const [processingImageId, setProcessingImageId] = useState<string | null>(
    null,
  )
  const [processingAction, setProcessingAction] = useState<
    'delete' | 'download' | null
  >(null)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const projectDropdownRef = useRef<HTMLDivElement>(null)

  // Sync project selection when projects list changes
  useEffect(() => {
    if (projects.length > 0) {
      setCurrentProject((prev) =>
        projects.includes(prev) ? prev : projects[0],
      )
    } else {
      setCurrentProject('')
    }
  }, [projects])

  // Parse history URLs into GeneratedImage objects
  useEffect(() => {
    if (historyUrls.length > 0) {
      const historyImages: GeneratedImage[] = historyUrls.map((url, i) => {
        let type = GenerationType.GOOD_DATASET
        let customTypeRaw: string | undefined
        let timestamp = Date.now()
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

        return {
          id: i.toString(),
          url: url,
          type: type,
          customTypeRaw: customTypeRaw,
          timestamp: timestamp,
          prompt: '',
          project: projectName,
        }
      })
      setGeneratedImages(historyImages)
    } else {
      setGeneratedImages([])
    }
  }, [historyUrls])

  // Handle Escape key for modal
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

  // Handle image upload
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

  const handleGenerate = async () => {
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
          const { imageUrls, finalPrompt } =
            await generateSyntheticImageMutation.mutateAsync({
              baseImage64: base64Image,
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
    } catch {
      alert('Error during generation. Please check your API configuration.')
    } finally {
      setIsGenerating(false)
    }
  }

  const handleDownload = async (img: GeneratedImage) => {
    setProcessingImageId(img.id)
    setProcessingAction('download')

    // Small delay to ensure dialog is seen
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
      // Fallback for simple download attempt if fetch fails (e.g. CORS)
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
  }

  const handleDelete = async (id: string, url: string) => {
    if (!confirm('Are you sure you want to delete this asset?')) return

    setProcessingImageId(id)
    setProcessingAction('delete')

    try {
      const filename = url.split('/').slice(-3).join('/')
      if (filename) {
        await deleteAssetMutation.mutateAsync(filename)
        // Artificial delay for better UX
        await new Promise((resolve) =>
          setTimeout(() => resolve(undefined), 500),
        )
        setGeneratedImages((prev) => prev.filter((img) => img.id !== id))
        if (selectedImage?.id === id) {
          setSelectedImage(null)
        }
      }
    } catch {
      alert('Failed to delete asset.')
    } finally {
      setProcessingImageId(null)
      setProcessingAction(null)
    }
  }

  return (
    <>
      <SampleHeader
        icon={Image}
        title="Synthetic Image Generation"
        description="Generate & edit images from text in real-time."
        onOpenSettings={() => setIsSettingsOpen(true)}
        disabled={isDisabled}
        badge={null}
      >
        <LogsDropdown />
        <MetricsDropdown />
      </SampleHeader>
      <PrerequisiteBanner
        inactivePrerequisites={inactivePrerequisites}
        preparingPrerequisites={preparingPrerequisites}
        isLoading={isWorkloadsLoading}
        onStart={preparePrerequisite}
        isStarting={createWorkload.isPending || updateWorkload.isPending}
      />
      <div className="grid grid-cols-1 gap-6 p-6 lg:grid-cols-10">
        <section className="flex flex-col space-y-6 lg:col-span-3">
          <div className="bg-card border-border text-card-foreground h-full rounded-2xl border p-6 shadow-xl">
            <div className="mb-6 flex items-center gap-2">
              <Settings className="text-primary h-5 w-5" />
              <h2 className="text-lg font-semibold">
                Generation Configuration
              </h2>
            </div>

            <div className="space-y-5">
              {/* Image Upload Area */}
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
                  style={{ aspectRatio: '16/9' }}
                >
                  {image ? (
                    <NextImage
                      src={image}
                      className="object-cover"
                      alt="Upload"
                      fill
                      unoptimized
                    />
                  ) : (
                    <div className="text-muted-foreground flex h-full flex-col items-center justify-center gap-2">
                      <Upload className="group-hover:text-foreground h-8 w-8 transition-colors" />
                      <span className="text-sm font-medium">
                        Click to upload source
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
                      <X className="h-4 w-4" />
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

              {/* Type Selection */}
              <div>
                <span className="text-muted-foreground mb-2 block text-xs font-bold uppercase">
                  Generation Type
                </span>
                <div className="grid grid-cols-1 gap-2">
                  <button
                    onClick={() => setGenType(GenerationType.GOOD_DATASET)}
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
                    onClick={() =>
                      setGenType(GenerationType.MISSING_COMPONENTS)
                    }
                    className={`flex items-center justify-between rounded-xl border px-4 py-3 text-left transition-all ${
                      genType === GenerationType.MISSING_COMPONENTS
                        ? 'border-amber-500/50 bg-amber-500/10 text-amber-600 dark:text-amber-400'
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
                        ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
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

              {/* Conditional Prompt Field */}
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

              {/* Count Slider */}
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
                  className="bg-secondary accent-primary h-1.5 w-full cursor-pointer appearance-none rounded-lg"
                />
              </div>

              {/* Generate Button */}
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
              <div className="text-muted-foreground flex h-full flex-col items-center justify-center gap-6 py-24">
                <div className="bg-background border-border flex h-20 w-20 items-center justify-center rounded-full border shadow-xl">
                  <Folder className="text-primary h-10 w-10" />
                </div>
                <div className="max-w-md space-y-2 text-center">
                  <h1 className="text-foreground text-xl font-bold">
                    No Projects Found
                  </h1>
                  <p className="text-muted-foreground text-sm">
                    Create your first project to start generating synthetic
                    datasets.
                  </p>
                </div>
                <button
                  onClick={async () => {
                    const name = prompt('Enter project name:')
                    if (name) {
                      try {
                        const newProjectName =
                          await createProjectMutation.mutateAsync(name)
                        await refetchProjects()
                        setCurrentProject(newProjectName)
                      } catch (e) {
                        alert(`Failed to create project: ${e}`)
                      }
                    }
                  }}
                  className="bg-primary hover:bg-primary/90 text-primary-foreground shadow-primary/20 flex items-center gap-2 rounded-lg px-6 py-3 font-bold shadow-lg transition-all active:scale-95"
                  disabled={preparingPrerequisites.length > 0}
                >
                  <Plus className="h-5 w-5" />
                  <span>Create New Project</span>
                </button>
              </div>
            ) : (
              <>
                <div className="mb-6 flex flex-col gap-4">
                  <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
                    <div className="flex items-center gap-4">
                      <div className="flex items-center gap-2">
                        <ImageIcon className="text-primary h-5 w-5" />
                        <h2 className="text-lg font-semibold">
                          Generated Dataset Assets
                        </h2>
                      </div>

                      {/* Project Dropdown */}
                      <div className="relative" ref={projectDropdownRef}>
                        <button
                          onClick={() =>
                            setIsProjectDropdownOpen(!isProjectDropdownOpen)
                          }
                          className="bg-secondary hover:bg-secondary/80 border-border text-foreground flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors"
                        >
                          <Folder className="text-primary h-3 w-3" />
                          <span>{currentProject}</span>
                          <ChevronDown
                            className={`text-muted-foreground h-3 w-3 transition-transform ${isProjectDropdownOpen ? 'rotate-180' : ''}`}
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
                        onClick={async () => {
                          const name = prompt('Enter project name:')
                          if (name) {
                            try {
                              const newProjectName =
                                await createProjectMutation.mutateAsync(name)
                              await refetchProjects()
                              setCurrentProject(newProjectName)
                            } catch (e) {
                              alert(`Failed to create project: ${e}`)
                            }
                          }
                        }}
                      >
                        <Plus className="h-3 w-3" />
                        <span>New Project</span>
                      </button>
                      <button
                        onClick={async () => {
                          try {
                            await exportProjectMutation.mutateAsync(
                              currentProject,
                            )
                          } catch (e) {
                            alert(`Failed to export project: ${e}`)
                          }
                        }}
                        disabled={exportProjectMutation.isPending}
                        className="flex items-center gap-2 rounded-md bg-green-600 px-3 py-1.5 text-xs font-bold text-white shadow-lg shadow-green-500/20 transition-colors hover:bg-green-500 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {exportProjectMutation.isPending ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Download className="h-3 w-3" />
                        )}
                        <span>
                          {exportProjectMutation.isPending
                            ? 'Exporting...'
                            : 'Download'}
                        </span>
                      </button>
                      <button
                        onClick={async () => {
                          if (projects.length <= 1) {
                            alert('Cannot delete the last project')
                            return
                          }
                          if (
                            confirm(
                              `Are you sure you want to delete project "${currentProject}"? All assets will be lost.`,
                            )
                          ) {
                            try {
                              await deleteProjectMutation.mutateAsync(
                                currentProject,
                              )
                              await refetchProjects()
                              await refetchHistory()
                            } catch (e) {
                              alert(`Failed to delete project: ${e}`)
                            }
                          }
                        }}
                        className="bg-destructive hover:bg-destructive/90 shadow-destructive/20 flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-bold text-white shadow-lg transition-colors"
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
                  <div className="grid max-h-[625px] grid-cols-1 gap-6 overflow-y-auto pr-2 sm:grid-cols-2 lg:grid-cols-5">
                    {filteredImages.map((img) => (
                      <div
                        key={img.id}
                        className="bg-card border-border group hover:border-primary/50 overflow-hidden rounded-xl border shadow-lg transition-colors"
                      >
                        <div
                          role="button"
                          tabIndex={0}
                          className="relative aspect-square cursor-pointer overflow-hidden"
                          onClick={() =>
                            !img.isLoading && setSelectedImage(img)
                          }
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              if (!img.isLoading) {
                                setSelectedImage(img)
                              }
                            }
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
                            <span
                              className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${
                                img.type === GenerationType.GOOD_DATASET
                                  ? 'bg-primary/10 text-primary border-primary/30'
                                  : img.type ===
                                      GenerationType.MISSING_COMPONENTS
                                    ? 'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400'
                                    : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                              }`}
                            >
                              {img.type.split('_')[0]}
                            </span>
                            {img.type === GenerationType.CUSTOM &&
                              img.customTypeRaw && (
                                <span className="bg-secondary/90 text-secondary-foreground border-border/50 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase shadow-md backdrop-blur-sm">
                                  {img.customTypeRaw}
                                </span>
                              )}
                          </div>
                        </div>
                        <div className="flex items-center justify-between p-4">
                          <div className="flex flex-col">
                            <span className="text-muted-foreground font-mono text-[10px]">
                              ID: {img.url.split('/').pop()}
                            </span>
                            <span className="text-muted-foreground text-[10px]">
                              {new Date(img.timestamp).toLocaleTimeString()}
                            </span>
                          </div>
                          <div className="flex gap-2">
                            <button
                              onClick={() => handleDownload(img)}
                              disabled={processingImageId !== null}
                              className={`bg-secondary border-border flex items-center rounded-md border px-2 py-2 text-[10px] font-bold tracking-wider uppercase transition-colors ${
                                processingImageId !== null
                                  ? 'text-muted-foreground cursor-not-allowed opacity-50'
                                  : 'hover:border-primary/50 text-muted-foreground hover:text-foreground'
                              }`}
                              title="Download"
                            >
                              <Download className="h-3 w-3" />
                            </button>
                            <button
                              onClick={() => handleDelete(img.id, img.url)}
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
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </section>
      </div>
      {/* Image Preview Modal */}
      {selectedImage && (
        <div
          role="dialog"
          aria-modal="true"
          className="animate-in fade-in fixed inset-0 z-50 flex items-center justify-center bg-black/95 p-4 transition-all duration-300"
        >
          <button
            onClick={() => setSelectedImage(null)}
            className="absolute top-6 right-6 z-50 rounded-full border border-slate-700 bg-slate-800/50 p-2 text-slate-400 backdrop-blur-sm transition-colors hover:bg-slate-700 hover:text-white"
          >
            <X className="h-6 w-6" />
          </button>

          <div className="flex h-full w-full max-w-7xl flex-col items-center justify-center gap-4">
            <NextImage
              src={selectedImage.url}
              className="h-auto·max-h-[80vh]·w-auto·max-w-full·rounded-lg·border·border-slate-800·object-contain·shadow-2xl"
              alt="Full preview"
              height={1024}
              width={1024}
              unoptimized
            />

            <div className="w-full max-w-2xl rounded-xl border border-slate-800 bg-slate-900/90 p-4 backdrop-blur-sm">
              <div className="mb-2 flex items-center justify-between">
                <span className="font-mono text-xs text-slate-500">
                  ID: {selectedImage.url.split('/').pop()}
                </span>
                <div className="flex gap-2">
                  <span
                    className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${
                      selectedImage.type === GenerationType.GOOD_DATASET
                        ? 'border-indigo-500/30 bg-indigo-500/10 text-indigo-400'
                        : selectedImage.type ===
                            GenerationType.MISSING_COMPONENTS
                          ? 'border-amber-500/30 bg-amber-500/10 text-amber-400'
                          : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                    }`}
                  >
                    {selectedImage.type.split('_')[0]}
                  </span>
                  {selectedImage.type === GenerationType.CUSTOM &&
                    selectedImage.customTypeRaw && (
                      <span className="rounded-full border border-slate-500/30 bg-slate-500/10 px-2 py-0.5 text-[10px] font-bold text-slate-400 uppercase">
                        {selectedImage.customTypeRaw}
                      </span>
                    )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Processing Dialog */}
      {processingImageId && (
        <div className="animate-in fade-in fixed inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-sm duration-200">
          <div className="mx-4 flex w-full max-w-sm flex-col items-center gap-6 rounded-2xl border border-slate-800 bg-slate-900 p-8 shadow-2xl">
            <div className="relative">
              <div className="absolute inset-0 animate-pulse rounded-full bg-indigo-500/20 blur-xl"></div>
              <Loader2 className="relative z-10 h-12 w-12 animate-spin text-indigo-500" />
            </div>
            <div className="space-y-2 text-center">
              <h3 className="text-xl font-bold text-white">
                {processingAction === 'download'
                  ? 'Exporting Asset...'
                  : 'Deleting Asset...'}
              </h3>
              <p className="text-sm text-slate-400">
                Please wait while we process your request.
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
