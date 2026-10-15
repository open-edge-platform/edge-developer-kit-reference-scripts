"use client"

import { useMemo, useState } from "react"
import {
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  Clock3,
  LoaderCircle,
  RefreshCw,
  Trash2,
  X,
  XCircle,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { ConfirmDeleteDialog } from "@/components/confirm-delete-dialog"
import { DataTable } from "@/components/data-table"
import { WorkspacePageHeader } from "@/components/workspace-page-header"
import { getApiErrorMessage } from "@/lib/api"
import type { Job, JobKind } from "@/lib/api"
import { formatDate } from "@/lib/format-date"
import { useCancelJob, useDeleteJob, useJobEvents, useJobs } from "@/lib/hooks/api/use-jobs"

function statusLabel(status: Job["status"]) {
  return status.replaceAll("_", " ")
}

function jobLabel(kind: JobKind) {
  const labels: Record<JobKind, string> = {
    process_gvhmr: "GVHMR",
    process_gmr: "GMR",
    process_csv_to_npz: "CSV to NPZ",
    train: "Training",
    resume: "Resume Training",
    play: "Playback",
    play_chain: "Play Chain",
    tensorboard: "TensorBoard",
  }
  return labels[kind]
}

function JobStatusIcon({ status }: { status: Job["status"] }) {
  const icons = {
    queued: Clock3,
    running: LoaderCircle,
    succeeded: CheckCircle2,
    failed: CircleAlert,
    canceled: XCircle,
    interrupted: CircleAlert,
  }
  const colors: Record<Job["status"], string> = {
    queued: "text-[#7c887d]",
    running: "animate-spin text-[#6d9d45]",
    succeeded: "text-[#42783a]",
    failed: "text-[#c45b38]",
    canceled: "text-[#849084]",
    interrupted: "text-[#a66b27]",
  }
  const Icon = icons[status]

  return (
    <span role="img" aria-label={statusLabel(status)} title={statusLabel(status)} className={`shrink-0 ${colors[status]}`}>
      <Icon size={12} />
    </span>
  )
}

export default function QueuePage() {
  const jobsQuery = useJobs()
  const cancelJobMutation = useCancelJob()
  const deleteJobMutation = useDeleteJob()
  const jobs = jobsQuery.data ?? []
  const jobData = useMemo(() => {
    const currentJobs = jobsQuery.data ?? []
    return {
      activeJobs: currentJobs.filter((job) => job.status === "queued" || job.status === "running"),
      completedJobs: currentJobs.filter((job) => job.status === "succeeded").length,
      orderedJobs: currentJobs.slice().sort((left, right) => right.created_at.localeCompare(left.created_at)),
    }
  }, [jobsQuery.data])
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null)
  const [logLines, setLogLines] = useState<string[]>([])
  const [message, setMessage] = useState<string | null>(null)
  const [jobToDelete, setJobToDelete] = useState<Job | null>(null)

  useJobEvents(selectedJobId, setLogLines)

  const selectedJob = useMemo(
    () => jobsQuery.data?.find((job) => job.id === selectedJobId) ?? null,
    [jobsQuery.data, selectedJobId],
  )

  async function refreshJobs() {
    await jobsQuery.refetch()
  }

  async function cancelJob(jobId: string) {
    setMessage(null)
    try {
      await cancelJobMutation.mutateAsync({ params: { path: { job_id: jobId } } })
    } catch (error) {
      setMessage(getApiErrorMessage(error, "Could not cancel job"))
    }
  }

  async function deleteJob() {
    if (!jobToDelete) return
    setMessage(null)
    try {
      await deleteJobMutation.mutateAsync({ params: { path: { job_id: jobToDelete.id } } })
      if (selectedJobId === jobToDelete.id) {
        setSelectedJobId(null)
        setLogLines([])
      }
      setJobToDelete(null)
    } catch (error) {
      setMessage(getApiErrorMessage(error, "Could not delete job"))
      setJobToDelete(null)
    }
  }

  return (
    <main className="min-h-svh">
      <div className="mx-auto max-w-[1500px] px-4 py-7 sm:px-8 sm:py-9">
        <WorkspacePageHeader
          title="Job Queue"
          apiOnline={jobsQuery.isSuccess}
          metrics={[
            { label: "TOTAL JOBS", value: jobs.length },
            { label: "IN PROGRESS", value: jobData.activeJobs.length },
            { label: "SUCCEEDED", value: jobData.completedJobs },
          ]}
        />

        {message && (
          <div role="alert" className="mb-5 flex items-center gap-2 border-l-2 border-[#c45b38] bg-[#fff0e9] px-3 py-2.5 text-sm text-[#763b29]">
            <CircleAlert size={16} />
            <span>{message}</span>
            <button className="ml-auto" aria-label="Dismiss message" onClick={() => setMessage(null)}><X size={16} /></button>
          </div>
        )}

        <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_350px]">
          <div>
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold">All Jobs</h2>
              <Button variant="ghost" size="icon-sm" aria-label="Refresh" title="Refresh" onClick={() => void refreshJobs()}><RefreshCw /></Button>
            </div>
            <DataTable
              ariaLabel="All jobs"
              columns={[
                {
                  key: "job",
                  header: "Job",
                  cell: (job, index) => (
                    <span className="block min-w-0">
                      <span className="flex min-w-0 items-center gap-2">
                        {/* <span className="font-mono text-[10px] text-[#929d93]">{String(jobData.orderedJobs.length - index).padStart(2, "0")}</span> */}
                        <span className="truncate text-sm font-medium">{jobLabel(job.kind)}</span>
                      </span>
                      <span className="mt-1 block truncate font-mono text-xs text-[#7c887d]">{job.id}</span>
                      <span className="mt-1 block text-xs text-[#7c887d] sm:hidden">{formatDate(job.created_at)}</span>
                      <span className="mt-1 flex items-center gap-2 text-xs capitalize text-[#687568] sm:hidden">
                        <JobStatusIcon status={job.status} />{statusLabel(job.status)}
                      </span>
                    </span>
                  ),
                },
                {
                  key: "status",
                  header: "Status",
                  className: "hidden sm:table-cell",
                  cell: (job) => (
                    <span className="inline-flex items-center gap-2 text-xs capitalize text-[#687568]">
                    {statusLabel(job.status)}
                    </span>
                  ),
                },
                {
                  key: "submitted",
                  header: "Submitted",
                  className: "hidden sm:table-cell",
                  cell: (job) => <span className="font-mono text-xs text-[#7c887d]">{formatDate(job.created_at)}</span>,
                },
              ]}
              rows={jobData.orderedJobs}
              getRowId={(job) => job.id}
              getRowLabel={(job) => `${jobLabel(job.kind)} job`}
              getActions={(job) => job.status === "queued" || job.status === "running"
                ? [{
                    label: "Cancel job",
                    icon: <X size={14} />,
                    disabled: cancelJobMutation.isPending,
                    onSelect: (selectedJob) => void cancelJob(selectedJob.id),
                  }]
                : [{
                    label: "Delete",
                    icon: <Trash2 size={14} />,
                    destructive: true,
                    onSelect: setJobToDelete,
                  }]}
              emptyMessage="No jobs submitted"
              onRowClick={(job) => {
                setMessage(null)
                if (selectedJobId !== job.id) {
                  setLogLines([])
                  setSelectedJobId(job.id)
                }
              }}
              selectedRowId={selectedJobId}
            />
          </div>

          <aside className="min-w-0 space-y-6">
            {selectedJob ? (
              <>
                <section>
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <h2 className="workspace-side-heading">Selected Job</h2>
                    <span className="inline-flex items-center gap-2 text-xs capitalize text-[#687568]">
                      <JobStatusIcon status={selectedJob.status} />
                    </span>
                  </div>
                  <div className="workspace-side-panel">
                    <div className="px-3 py-3">
                      <p className="workspace-side-primary">{jobLabel(selectedJob.kind)}</p>
                      <p className="workspace-side-secondary mt-1 break-all font-mono text-[#849084]">{selectedJob.id}</p>
                    </div>
                    <dl className="workspace-side-secondary grid grid-cols-[90px_minmax(0,1fr)] gap-x-3 gap-y-2 px-3 py-3">
                      <dt className="text-[#849084]">Submitted</dt><dd>{formatDate(selectedJob.created_at)}</dd>
                      {selectedJob.started_at && <><dt className="text-[#849084]">Started</dt><dd>{formatDate(selectedJob.started_at)}</dd></>}
                      {selectedJob.finished_at && <><dt className="text-[#849084]">Finished</dt><dd>{formatDate(selectedJob.finished_at)}</dd></>}
                    </dl>
                    <details className="workspace-disclosure px-3 py-2.5">
                      <summary>Job Details<ChevronDown aria-hidden="true" size={14} /></summary>
                      <pre className="mt-2 max-h-44 overflow-auto whitespace-pre-wrap break-words font-mono text-[10px] leading-4 text-[#687568]">{JSON.stringify(selectedJob.payload, null, 2)}</pre>
                    </details>
                    {selectedJob.error && <p className="break-words px-3 py-3 text-xs text-[#a64c38]">{selectedJob.error}</p>}
                  </div>
                </section>

                <section>
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <h2 className="workspace-side-heading truncate">Terminal</h2>
                    <span className={`size-2 rounded-full ${selectedJob.status === "running" ? "animate-pulse bg-[#70ad42]" : selectedJob.status === "failed" ? "bg-[#cf6945]" : "bg-[#a9b4a8]"}`} />
                  </div>
                  <div aria-live="polite" className="h-72 overflow-auto border border-[#263329] bg-[#162019] p-3 font-mono text-[10px] leading-5 text-[#d0dfcf] sm:h-80">
                    {logLines.length === 0 ? (
                      <p className="text-[#849486]">Waiting for job output…</p>
                    ) : (
                      logLines.map((line, index) => <p key={`${index}-${line}`} className="break-words">{line}</p>)
                    )}
                  </div>
                </section>
              </>
            ) : (
              <div className="grid min-h-40 place-items-center text-center">
                <div>
                  <Clock3 className="mx-auto mb-2 text-[#9ca99c]" size={22} />
                  <p className="text-sm text-[#5f6d61]">Select a job</p>
                </div>
              </div>
            )}
          </aside>
        </section>
      </div>
      <ConfirmDeleteDialog

        open={jobToDelete !== null}
        onOpenChange={(open) => {
          if (!open && !deleteJobMutation.isPending) setJobToDelete(null)
        }}
        title="Delete job?"
        description="This permanently removes the job from history and deletes its saved output log."
        itemName={jobToDelete ? `${jobLabel(jobToDelete.kind)} · ${jobToDelete.id}` : ""}
        pending={deleteJobMutation.isPending}
        onConfirm={() => void deleteJob()}
      />
    </main>
  )
}