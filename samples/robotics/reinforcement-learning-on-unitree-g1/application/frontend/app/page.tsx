// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

"use client"

import { useMemo, useState } from "react"
import {
  CircleAlert,
  Download,
  FileVideo2,
  LoaderCircle,
  RefreshCw,
  Trash2,
  Upload,
  X,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  WorkspaceSidePanel,
  WorkspaceSidePanelActions,
  WorkspaceSidePanelIdentity,
  WorkspaceSidePanelPrimary,
  WorkspaceSidePanelRow,
  WorkspaceSidePanelSecondary,
} from "@/components/ui/workspace-side-panel"
import { AssetFilesBrowser } from "@/components/asset-files-browser"
import { DataProcessingDialog } from "@/components/data-processing-dialog"
import { ConfirmDeleteDialog } from "@/components/confirm-delete-dialog"
import { DataTable } from "@/components/data-table"
import { WorkspacePageHeader } from "@/components/workspace-page-header"
import { getApiErrorMessage } from "@/lib/api"
import type { Asset, Device, JobSubmission } from "@/lib/api"
import { formatDate } from "@/lib/format-date"
import { useAssets, useDeleteAsset, useDownloadAsset, useUploadAsset } from "@/lib/hooks/api/use-assets"
import { useDevices } from "@/lib/hooks/api/use-devices"
import { useJobEvents, useJobs, useSubmitJob } from "@/lib/hooks/api/use-jobs"

const DEFAULT_DEVICES: Device[] = ["cpu"]

function preferredDevice(devices: Device[]): Device {
  return (["xpu", "cpu"] as Device[]).find((device) => devices.includes(device)) ?? devices[0] ?? "cpu"
}

function resolveDevice(selected: Device | null, devices: Device[], fallback: Device) {
  return selected && devices.includes(selected) ? selected : fallback
}

function formatBytes(bytes: number) {
  if (bytes < 1_000_000) return `${(bytes / 1_000).toFixed(0)} KB`
  return `${(bytes / 1_000_000).toFixed(1)} MB`
}

export default function Page() {
  const assetsQuery = useAssets()
  const jobsQuery = useJobs()
  const devicesQuery = useDevices()
  const uploadMutation = useUploadAsset()
  const deleteAssetMutation = useDeleteAsset()
  const downloadAssetMutation = useDownloadAsset()
  const submitJobMutation = useSubmitJob()
  const assets = assetsQuery.data ?? []
  const jobs = jobsQuery.data ?? []
  const availableDevices: Device[] = devicesQuery.data ?? DEFAULT_DEVICES
  const defaultDevice = preferredDevice(availableDevices)
  const jobMetrics = useMemo(() => {
    const currentJobs = jobsQuery.data ?? []
    return {
      activeJobs: currentJobs.filter((job) => job.status === "queued" || job.status === "running"),
      completedJobs: currentJobs.filter((job) => job.status === "succeeded").length,
    }
  }, [jobsQuery.data])
  const apiOnline = [assetsQuery, jobsQuery, devicesQuery].every(
    (query) => query.isSuccess,
  )
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null)
  const [assetToDelete, setAssetToDelete] = useState<Asset | null>(null)
    const [processingDialogOpen, setProcessingDialogOpen] = useState(false)
    const [selectedJobId, setSelectedJobId] = useState<string | null>(null)
    const [message, setMessage] = useState<string | null>(null)
    const [logLines, setLogLines] = useState<string[]>([])
    const [maxIterations, setMaxIterations] = useState(10001)
    const [numEnvs, setNumEnvs] = useState(4096)
    const [selectedTrainDevice, setSelectedTrainDevice] = useState<Device | null>(null)
    const [selectedEnvDevice, setSelectedEnvDevice] = useState<Device | null>(null)
  const trainingDevice = resolveDevice(selectedTrainDevice, availableDevices, defaultDevice)
  const environmentDevice = resolveDevice(selectedEnvDevice, availableDevices, defaultDevice)

  useJobEvents(selectedJobId, setLogLines)

  async function refreshWorkspace() {
    await Promise.all([
      assetsQuery.refetch(),
      jobsQuery.refetch(),
      devicesQuery.refetch(),
    ])
  }

  const selectedAsset = useMemo(
    () => assetsQuery.data?.find((asset) => asset.id === selectedAssetId) ?? null,
    [assetsQuery.data, selectedAssetId],
  )
  const selectedJob = useMemo(
    () => jobsQuery.data?.find((job) => job.id === selectedJobId) ?? null,
    [jobsQuery.data, selectedJobId],
  )
  const selectedProcessingJob = useMemo(() => {
    if (!selectedAsset || !selectedJob || selectedJob.payload.asset_id !== selectedAsset.id) {
      return null
    }
    return selectedJob.kind === "process_gvhmr" ||
      selectedJob.kind === "process_gmr" ||
      selectedJob.kind === "process_csv_to_npz"
      ? selectedJob
      : null
  }, [selectedAsset, selectedJob])
  async function uploadVideo(file: File | undefined) {
    if (!file) return
    setMessage(null)
    try {
      const asset = await uploadMutation.mutateAsync(file)
      setSelectedAssetId(asset.id)
    } catch (error) {
      setMessage(getApiErrorMessage(error, "Upload failed"))
    }
  }

  async function deleteAsset() {
    if (!assetToDelete) return
    setMessage(null)
    try {
      await deleteAssetMutation.mutateAsync({ params: { path: { asset_id: assetToDelete.id } } })
      if (selectedAssetId === assetToDelete.id) setSelectedAssetId(null)
      setAssetToDelete(null)
    } catch (error) {
      setMessage(getApiErrorMessage(error, "Could not delete asset"))
      setAssetToDelete(null)
    }
  }

  async function downloadAsset(asset: Asset) {
    setMessage(null)
    try {
      await downloadAssetMutation.mutateAsync(asset.id)
    } catch (error) {
      setMessage(getApiErrorMessage(error, "Could not download asset"))
    }
  }

  async function submitJob(submission: JobSubmission) {
    setMessage(null)
    try {
      const job = await submitJobMutation.mutateAsync({ body: submission })
      setLogLines([])
      setSelectedJobId(job.id)
    } catch (error) {
      setMessage(getApiErrorMessage(error, "Could not queue job"))
    }
  }

  return (
    <main className="min-h-svh">
      <div className="mx-auto max-w-[1500px] px-4 py-7 sm:px-8 sm:py-9">
        <WorkspacePageHeader
          title="Motion Library"
          apiOnline={apiOnline}
          metrics={[
            { label: "VIDEOS", value: assets.length },
            { label: "IN QUEUE", value: jobMetrics.activeJobs.length },
            { label: "JOBS DONE", value: jobMetrics.completedJobs },
          ]}
        />

        {message && (
          <div role="alert" className="mb-5 flex items-center gap-2 border-l-2 border-[#c45b38] bg-[#fff0e9] px-3 py-2.5 text-sm text-[#763b29]">
            <CircleAlert size={16} />
            <span>{message}</span>
            <button className="ml-auto" aria-label="Dismiss message" onClick={() => setMessage(null)}><X size={16} /></button>
          </div>
        )}

        <div className="grid gap-7 lg:grid-cols-[minmax(0,1fr)_350px]">
            <div className="min-w-0 space-y-7">
              <section className="flex flex-wrap items-center justify-between gap-4 border border-dashed border-[#b8c5b7] bg-[#f7faf3] px-5 py-4">
                <div className="flex items-center gap-3">
                  <div>
                    <h2 className="text-sm font-semibold">Upload Video</h2>
                  </div>
                </div>
                <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-md bg-[#1c2a20] px-3 text-sm font-medium text-white transition-colors hover:bg-[#314536] has-[:disabled]:opacity-60">
                  {uploadMutation.isPending ? <LoaderCircle className="animate-spin" size={15} /> : <PlusIcon />}
                  {uploadMutation.isPending ? "Uploading" : "Choose"}
                  <input
                    className="sr-only"
                    type="file"
                    accept="video/mp4,video/quicktime,.mp4,.mov"
                    disabled={uploadMutation.isPending}
                    onChange={(event) => {
                      uploadVideo(event.currentTarget.files?.[0])
                      event.currentTarget.value = ""
                    }}
                  />
                </label>
              </section>

              <section>
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-sm font-semibold">All Videos <span className="ml-2 font-mono text-xs font-normal text-[#859086]">{assets.length}</span></h2>
                  <Button variant="ghost" size="icon-sm" aria-label="Refresh" title="Refresh" onClick={() => void refreshWorkspace()}><RefreshCw /></Button>
                </div>
                <DataTable
                  ariaLabel="Uploaded videos"
                  columns={[
                    {
                      key: "source",
                      header: "Source",
                      cell: (asset) => (
                        <span className="block min-w-0">
                          <span className="block truncate text-sm font-medium">{asset.filename}</span>
                          <span className="block text-xs text-[#818c82]">{formatDate(asset.created_at)}</span>
                        </span>
                      ),
                    },
                    {
                      key: "status",
                      header: "Status",
                      className: "hidden sm:table-cell",
                      cell: (asset) => {
                        const complete = asset.artifacts.includes("motion_npz")
                        return (
                          <span className={`inline-flex items-center gap-1.5 text-xs ${complete ? "text-[#42783a]" : "text-[#7c887d]"}`}>
                            <span className={`size-1.5 rounded-full ${complete ? "bg-[#67b942]" : "bg-[#bbc5b9]"}`} />
                            {complete ? "Ready" : `${asset.artifacts.length}/4`}
                          </span>
                        )
                      },
                    },
                    {
                      key: "size",
                      header: "Size",
                      className: "hidden sm:table-cell",
                      cell: (asset) => <span className="font-mono text-xs text-[#7d887e]">{formatBytes(asset.size_bytes)}</span>,
                    },
                  ]}
                  rows={assets}
                  getRowId={(asset) => asset.id}
                  getRowLabel={(asset) => asset.filename}
                  getActions={() => [
                    {
                      label: "Download",
                      icon: <Download size={14} />,
                      disabled: downloadAssetMutation.isPending,
                      onSelect: (asset) => void downloadAsset(asset),
                    },
                    {
                      label: "Delete",
                      icon: <Trash2 size={14} />,
                      destructive: true,
                      onSelect: setAssetToDelete,
                    },
                  ]}
                  emptyMessage="No videos yet"
                  onRowClick={(asset) => setSelectedAssetId(asset.id)}
                  selectedRowId={selectedAssetId}
                />
              </section>
            </div>

            <aside className="min-w-0 space-y-6">
              {selectedAsset ? (
                          <>
                            <section key={selectedAsset.id}>
                              <div className="mb-3 flex min-w-0 items-center gap-2">
                                <h2 className="workspace-side-heading shrink-0">Selected Video</h2>
                                <span className={`inline-flex items-center gap-1.5 text-xs ${selectedAsset.artifacts.includes("motion_npz") ? "text-[#42783a]" : "text-[#7c887d]"}`}>
                                  <span className={`size-1.5 rounded-full ${selectedAsset.artifacts.includes("motion_npz") ? "bg-[#67b942]" : "bg-[#bbc5b9]"}`} />
                                  {selectedAsset.artifacts.includes("motion_npz") ? "Ready" : `${selectedAsset.artifacts.length}/4`}
                                </span>
                              </div>
                              <WorkspaceSidePanel>
                                <WorkspaceSidePanelIdentity>
                                  <WorkspaceSidePanelPrimary className="break-words">{selectedAsset.filename}</WorkspaceSidePanelPrimary>
                                  <WorkspaceSidePanelSecondary>{formatBytes(selectedAsset.size_bytes)} · {formatDate(selectedAsset.created_at)}</WorkspaceSidePanelSecondary>
                                </WorkspaceSidePanelIdentity>
                                <WorkspaceSidePanelRow label="Status">
                                  <span className="font-mono text-xs text-[#566658]">{selectedAsset.artifacts.length}/4</span>
                                </WorkspaceSidePanelRow>
                                <AssetFilesBrowser asset={selectedAsset} />
                                <WorkspaceSidePanelActions>
                                  <Button className="workspace-side-action w-full" onClick={() => setProcessingDialogOpen(true)}>
                                    {selectedAsset.artifacts.length > 0 ? "Open Processing" : "Process Video"}
                                  </Button>
                                </WorkspaceSidePanelActions>
                              </WorkspaceSidePanel>
                              <DataProcessingDialog
                                key={selectedAsset.id}
                                asset={selectedAsset}
                                jobs={jobs}
                                open={processingDialogOpen}
                                onOpenChange={setProcessingDialogOpen}
                                terminalJob={selectedProcessingJob}
                                terminalLines={selectedProcessingJob ? logLines : []}
                                maxIterations={maxIterations}
                                numEnvs={numEnvs}
                                onSubmit={(submission) => void submitJob(submission)}
                              />
                            </section>

                            {selectedAsset.artifacts.includes("motion_npz") && (
                              <section>
                                <div className="mb-3">
                                  <h2 className="workspace-side-heading">Start Training</h2>
                                  <p className="mt-1 text-xs text-[#768176]">Unitree G1 Motion Tracking</p>
                                </div>
                                <div className="space-y-3 border-y border-[#dce3dc] bg-white p-3">
                                  <label className="grid gap-1 text-[10px] font-mono uppercase text-[#7b877d]">
                                    Iterations
                                    <input className="h-9 w-full rounded border border-[#cfd8cc] bg-white px-2 text-sm font-sans text-[#1b2a1e]" type="number" min={1} max={100000} value={maxIterations} onChange={(event) => setMaxIterations(Number(event.target.value))} />
                                  </label>
                                  <label className="grid gap-1 text-[10px] font-mono uppercase text-[#7b877d]">
                                    Environments
                                    <input className="h-9 w-full rounded border border-[#cfd8cc] bg-white px-2 text-sm font-sans text-[#1b2a1e]" type="number" min={1} max={8192} value={numEnvs} onChange={(event) => setNumEnvs(Number(event.target.value))} />
                                  </label>
                                  <label className="grid gap-1 text-[10px] font-mono uppercase text-[#7b877d]">
                                    Device
                                    <select
                                      aria-label="Training device"
                                      className="h-9 w-full rounded border border-[#cfd8cc] bg-white px-2 text-xs font-sans text-[#1b2a1e]"
                                      value={trainingDevice}
                                      onChange={(event) => setSelectedTrainDevice(event.target.value as Device)}
                                    >
                                      {availableDevices.map((device) => <option key={device} value={device}>{device.toUpperCase()}</option>)}
                                    </select>
                                  </label>
                                  <label className="grid gap-1 text-[10px] font-mono uppercase text-[#7b877d]">
                                    Env device
                                    <select
                                      aria-label="Training environment device"
                                      className="h-9 w-full rounded border border-[#cfd8cc] bg-white px-2 text-xs font-sans text-[#1b2a1e]"
                                      value={environmentDevice}
                                      onChange={(event) => setSelectedEnvDevice(event.target.value as Device)}
                                    >
                                      {availableDevices.map((device) => <option key={device} value={device}>{device.toUpperCase()}</option>)}
                                    </select>
                                  </label>
                                  <Button
                                    className="workspace-side-action w-full"
                                    disabled={jobMetrics.activeJobs.some((job) => job.kind === "train" && job.payload.asset_id === selectedAsset.id)}
                                    onClick={() =>
                                      void submitJob({
                                        kind: "train",
                                        asset_id: selectedAsset.id,
                                        device: trainingDevice,
                                        env_device: environmentDevice,
                                        max_iterations: maxIterations,
                                        num_envs: numEnvs,
                                      })
                                    }
                                  >
                                    Train
                                  </Button>
                                </div>
                              </section>
                            )}
                          </>
                        ) : (
                          <div className="grid min-h-40 place-items-center text-center">
                            <div>
                              <FileVideo2 className="mx-auto mb-2 text-[#9ca99c]" size={22} />
                              <p className="text-sm text-[#5f6d61]">Select a video</p>
                            </div>
                          </div>
                        )}
            </aside>
        </div>
      </div>
      <ConfirmDeleteDialog
        open={assetToDelete !== null}
        onOpenChange={(open) => {
          if (!open && !deleteAssetMutation.isPending) setAssetToDelete(null)
        }}
        title="Delete video?"
        description="This permanently removes the uploaded video, its generated artifacts, and preview."
        itemName={assetToDelete?.filename ?? ""}
        pending={deleteAssetMutation.isPending}
        onConfirm={() => void deleteAsset()}
      />
    </main>
  )
}

function PlusIcon() {
  return <Upload size={15} />
}
