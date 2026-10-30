// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { useState } from "react"
import {
  Check,
  ChevronDown,
  FileVideo2,
  LoaderCircle,
  Play,
  RefreshCw,
  Terminal,
  X,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "./ui/dialog"
import type { components } from "@/lib/api-schema"

type Asset = components["schemas"]["AssetView"]
type Job = components["schemas"]["Job"]
type JobKind = components["schemas"]["JobKind"]
type JobSubmission = components["schemas"]["JobSubmission"]

const stages: Array<{
  kind: JobKind
  label: string
  artifact: string
  predecessor?: string
  preview?: "gvhmr_global" | "gmr_video"
}> = [
  {
    kind: "process_gvhmr",
    label: "GVHMR",
    artifact: "gvhmr",
    preview: "gvhmr_global",
  },
  {
    kind: "process_gmr",
    label: "GMR",
    artifact: "gmr_csv",
    predecessor: "gvhmr",
    preview: "gmr_video",
  },
  {
    kind: "process_csv_to_npz",
    label: "CSV to NPZ",
    artifact: "motion_npz",
    predecessor: "gmr_csv",
  },
]

const terminalStatuses = new Set<Job["status"]>([
  "succeeded",
  "failed",
  "canceled",
  "interrupted",
])

function statusLabel(status: Job["status"]) {
  return status.replaceAll("_", " ")
}

type DataProcessingDialogProps = {
  asset: Asset
  jobs: Job[]
  open: boolean
  onOpenChange: (open: boolean) => void
  terminalJob: Job | null
  terminalLines: string[]
  maxIterations: number
  numEnvs: number
  onSubmit: (submission: JobSubmission) => void
}

export function DataProcessingDialog({
  asset,
  jobs,
  open,
  onOpenChange,
  terminalJob,
  terminalLines,
  maxIterations,
  numEnvs,
  onSubmit,
}: DataProcessingDialogProps) {
  const [selectedStageIndex, setSelectedStageIndex] = useState(0)

  function stageComplete(artifact: string) {
    return asset.artifacts.includes(artifact)
  }

  function assetJob(kind: JobKind) {
    return jobs.find(
      (job) =>
        job.kind === kind &&
        job.payload.asset_id === asset.id &&
        !terminalStatuses.has(job.status),
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(76rem,calc(100vw-2rem))] max-h-[92svh] max-w-none sm:h-[90svh]">
        <header className="flex items-start justify-between gap-4 border-b border-[#dce3dc] px-5 py-4 sm:px-6">
          <div className="min-w-0">
            <DialogTitle className="text-base font-semibold">Motion Processing</DialogTitle>
            <DialogDescription className="mt-1 truncate text-xs text-[#748074]">
              {asset.filename}
            </DialogDescription>
          </div>
          <DialogClose
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Close processing dialog"
                title="Close"
              >
                <X />
              </Button>
            }
          />
        </header>

        <nav
          aria-label="Processing stages"
          className="grid grid-cols-3 border-b border-[#dce3dc] bg-[#f3f6f0] px-3 py-3 sm:px-6"
        >
          {stages.map((stage, index) => {
            const done = stageComplete(stage.artifact)
            const active = assetJob(stage.kind)
            const selected = selectedStageIndex === index

            return (
              <button
                key={stage.kind}
                type="button"
                aria-current={selected ? "step" : undefined}
                onClick={() => setSelectedStageIndex(index)}
                className={`relative flex min-w-0 items-center gap-2 border-b-2 px-2 py-2.5 text-left transition-colors sm:gap-3 sm:px-4 ${selected ? "border-[#527f3d] text-[#203a25]" : "border-transparent text-[#758176] hover:text-[#344a36]"}`}
              >
                <span
                  className={`grid size-7 shrink-0 place-items-center rounded-full text-xs ${done ? "bg-[#dff1d0] text-[#426d35]" : selected ? "bg-[#e2ecd8] text-[#426d35]" : "bg-white text-[#758176]"}`}
                >
                  {active ? (
                    <LoaderCircle className="animate-spin" size={14} />
                  ) : done ? (
                    <Check size={14} />
                  ) : (
                    <span className="font-mono">0{index + 1}</span>
                  )}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-xs font-semibold sm:text-sm">
                    {stage.label}
                  </span>
                  <span className="hidden truncate text-[10px] text-[#849084] sm:block">
                    {active
                      ? statusLabel(active.status)
                      : done
                        ? "complete"
                        : "pending"}
                  </span>
                </span>
              </button>
            )
          })}
        </nav>

        {stages.map((stage, index) => {
          if (selectedStageIndex !== index) return null

          const done = stageComplete(stage.artifact)
          const active = assetJob(stage.kind)
          const predecessorDone =
            !stage.predecessor || stageComplete(stage.predecessor)
          const previewUrl = stage.preview
            ? new URL("/api/assets/", "http://localhost")
            : null
          if (previewUrl && stage.preview) {
            previewUrl.pathname += `${encodeURIComponent(asset.id)}/previews/${encodeURIComponent(stage.preview)}`
          }
          const statusText = active
            ? `Job ${statusLabel(active.status)}`
            : done
              ? null
              : predecessorDone
                ? "Ready to run"
                : "Waiting for previous stage"

          return (
            <section key={stage.kind} className="flex min-h-0 flex-1 flex-col overflow-y-auto sm:overflow-hidden">
              <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 px-5 py-4 sm:px-6">
                <div className="min-w-0">
                  <p className="text-sm font-semibold">{stage.label}</p>
                  <p className="mt-0.5 text-xs text-[#7e897f]">{statusText}</p>
                </div>
                <Button
                  size="sm"
                  variant={done ? "outline" : "secondary"}
                  disabled={!predecessorDone || Boolean(active)}
                  onClick={() =>
                    onSubmit({
                      kind: stage.kind,
                      asset_id: asset.id,
                      max_iterations: null,
                      num_envs: numEnvs,
                    })
                  }
                >
                  {active ? (
                    <LoaderCircle className="animate-spin" />
                  ) : done ? (
                    <RefreshCw />
                  ) : (
                    <Play />
                  )}
                  {/* {active ? "Queued" : done ? "Retry stage" : "Run stage"} */}
                </Button>
              </div>

              <div className="w-full px-4 pb-4 sm:flex sm:min-h-0 sm:flex-1 sm:px-6 sm:pb-5">
                <div className="relative aspect-video max-h-[58svh] w-full overflow-hidden bg-[#101713] sm:h-full sm:max-h-full sm:aspect-auto">
                {previewUrl && done ? (
                  <video
                    key={`${asset.id}:${stage.preview}`}
                    className="absolute inset-0 h-full w-full object-contain"
                    controls
                    playsInline
                    preload="metadata"
                    aria-label={`${stage.label} rendered video`}
                  >
                    <source src={previewUrl.pathname} type="video/mp4" />
                  </video>
                ) : (
                  <div className="absolute inset-0 grid place-items-center border border-dashed border-[#cfd8cc] bg-white px-4 text-center">
                    <div>
                      {stage.kind === "process_csv_to_npz" ? (
                        <Check className="mx-auto mb-2 text-[#527f3d]" size={22} />
                      ) : (
                        <FileVideo2 className="mx-auto mb-2 text-[#91a08f]" size={24} />
                      )}
                      <p className="text-sm font-medium text-[#354638]">
                        {stage.kind === "process_csv_to_npz"
                          ? done
                            ? "Motion file is ready"
                            : "No video preview for this stage"
                          : predecessorDone
                            ? "Rendered video will appear here"
                            : "Complete the previous stage to continue"}
                      </p>
                      {stage.kind === "process_csv_to_npz" && done && (
                        // <a
                        //   className="mt-2 inline-flex text-xs font-medium text-[#527f3d] underline underline-offset-4"
                        //   href={`/api/assets/${asset.id}/artifacts/motion_npz`}
                        //   target="_blank"
                        //   rel="noreferrer"
                        // >
                        //   Download motion NPZ
                        // </a>
                        null
                      )}
                    </div>
                  </div>
                )}
                </div>
              </div>

              <details className="group shrink-0 border-t border-[#dce3dc] bg-white">
                <summary className="flex cursor-pointer list-none items-center gap-2 px-5 py-3 text-xs font-medium text-[#566658] outline-none hover:bg-[#f7f9f5] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#7da35c] sm:px-6">
                  <ChevronDown
                    className="transition-transform group-open:rotate-180"
                    size={14}
                  />
                  <Terminal size={14} />
                  <span>Terminal</span>
                  {/* <span className="ml-auto text-[10px] font-normal uppercase text-[#859086]">
                    {terminalJob ? statusLabel(terminalJob.status) : "Optional"}
                  </span> */}
                </summary>
                <div className="max-h-48 overflow-auto border-t border-[#263329] bg-[#162019] px-4 py-3 font-mono text-[10px] leading-5 text-[#d0dfcf]">
                  {terminalJob ? (
                    terminalLines.length > 0 ? (
                      terminalLines.map((line, lineIndex) => (
                        <p key={`${lineIndex}-${line}`} className="break-words">
                          {line}
                        </p>
                      ))
                    ) : (
                      <p className="text-[#849486]">Waiting for process output…</p>
                    )
                  ) : (
                    <p className="text-[#849486]">
                      Run a stage to stream its output here. Select a processing job in the queue to view its log.
                    </p>
                  )}
                  {terminalJob?.error && (
                    <p className="mt-2 text-[#f29b7c]">{terminalJob.error}</p>
                  )}
                </div>
              </details>
            </section>
          )
        })}
      </DialogContent>
    </Dialog>
  )
}