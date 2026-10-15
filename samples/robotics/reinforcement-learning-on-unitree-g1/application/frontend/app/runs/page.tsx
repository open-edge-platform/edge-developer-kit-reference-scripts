"use client"

import { useMemo, useRef, useState } from "react"
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core"
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { ArrowUpRight, CircleAlert, Download, FolderOpen, GripVertical, LoaderCircle, Play, RefreshCw, Trash2, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
	WorkspaceSidePanel,
	WorkspaceSidePanelActions,
	WorkspaceSidePanelIdentity,
	WorkspaceSidePanelPrimary,
	WorkspaceSidePanelRow,
	WorkspaceSidePanelSecondary,
} from "@/components/ui/workspace-side-panel"
import { ConfirmDeleteDialog } from "@/components/confirm-delete-dialog"
import { DataTable } from "@/components/data-table"
import { RunFilesBrowser } from "@/components/run-files-browser"
import { WorkspacePageHeader } from "@/components/workspace-page-header"
import { API_BASE_URL, getApiErrorMessage } from "@/lib/api"
import type { Device, JobSubmission } from "@/lib/api"
import { formatDate } from "@/lib/format-date"
import { useAssets } from "@/lib/hooks/api/use-assets"
import { useDevices } from "@/lib/hooks/api/use-devices"
import { useJobs, useSubmitJob } from "@/lib/hooks/api/use-jobs"
import { useDeleteRun, useDownloadRun, useRuns } from "@/lib/hooks/api/use-runs"

type ChainItem = { runId: string; checkpoint: string; assetId: string }
const DEFAULT_DEVICES: Device[] = ["cpu"]
const DEFAULT_MAX_ITERATIONS = 10001
const DEFAULT_NUM_ENVS = 4096

function preferredDevice(devices: Device[]): Device {
	return (["xpu", "cpu"] as Device[]).find((device) => devices.includes(device)) ?? devices[0] ?? "cpu"
}

type MotionAssetOption = { id: string; filename: string }

function SortableChainItem({
	item,
	index,
	runName,
	motionAssets,
	onAssetChange,
}: {
	item: ChainItem
	index: number
	runName: string
	motionAssets: MotionAssetOption[]
	onAssetChange: (assetId: string) => void
}) {
	const itemKey = `${item.runId}\0${item.checkpoint}`
	const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: itemKey })

	return (
		<div
			ref={setNodeRef}
			style={{ transform: CSS.Transform.toString(transform), transition }}
			className={`grid gap-2 px-3 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(150px,0.8fr)] sm:items-center ${isDragging ? "relative z-10 opacity-60" : ""}`}
		>
			<span className="flex min-w-0 items-center gap-2">
				<span className="w-5 shrink-0 text-center font-mono text-xs text-[#849084]">{index + 1}.</span>
				<span className="min-w-0">
					  <span className="workspace-side-primary block truncate">{runName}</span>
					  <span className="workspace-side-secondary block truncate font-mono text-[#849084]">{item.checkpoint}</span>
				</span>
			</span>
			<div className="flex min-w-0 items-center gap-2">
				<select
					aria-label={`Motion for ${runName} ${item.checkpoint}`}
					className="h-8 min-w-0 flex-1 rounded border border-[#cfd8cc] bg-white px-2 text-xs"
					value={item.assetId}
					onChange={(event) => onAssetChange(event.target.value)}
				>
					<option value="">Select motion</option>
					{motionAssets.map((asset) => <option key={asset.id} value={asset.id}>{asset.filename}</option>)}
				</select>
				<button
					type="button"
					{...attributes}
					{...listeners}
					aria-label={`Reorder checkpoint ${index + 1}: ${item.checkpoint}`}
					title="Drag to reorder"
					className="grid size-8 shrink-0 cursor-grab place-items-center touch-none text-[#849084] active:cursor-grabbing"
				>
					<GripVertical size={15} />
				</button>
			</div>
		</div>
	)
}

export default function RunsPage() {
	const assetsQuery = useAssets()
	const jobsQuery = useJobs()
	const runsQuery = useRuns()
	const devicesQuery = useDevices()
	const submitJobMutation = useSubmitJob()
	const deleteRunMutation = useDeleteRun()
	const downloadRunMutation = useDownloadRun()
	const assets = assetsQuery.data ?? []
	const runs = runsQuery.data ?? []
	const availableDevices: Device[] = devicesQuery.data ?? DEFAULT_DEVICES
	const executionDevice = preferredDevice(availableDevices)
	const apiOnline = [assetsQuery, jobsQuery, runsQuery, devicesQuery].every(
		(query) => query.isSuccess,
	)
	const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
	const [runToDelete, setRunToDelete] = useState<(typeof runs)[number] | null>(null)
	const [chainItems, setChainItems] = useState<ChainItem[]>([])
	const [message, setMessage] = useState<string | null>(null)
	const [openingTensorBoard, setOpeningTensorBoard] = useState(false)
	const [tensorBoardRunId, setTensorBoardRunId] = useState<string | null>(null)
	const [tensorBoardJobId, setTensorBoardJobId] = useState<string | null>(null)
	const [tensorBoardUrl, setTensorBoardUrl] = useState<string | null>(null)
	const [stoppingTensorBoard, setStoppingTensorBoard] = useState(false)
	const tensorBoardAbortController = useRef<AbortController | null>(null)
	const [startingPlayback, setStartingPlayback] = useState(false)
	const [playbackJobId, setPlaybackJobId] = useState<string | null>(null)
	const [playbackReady, setPlaybackReady] = useState(false)
	const [stoppingPlayback, setStoppingPlayback] = useState(false)
	const playbackAbortController = useRef<AbortController | null>(null)

	async function refreshWorkspace() {
		await Promise.all([
			assetsQuery.refetch(),
			jobsQuery.refetch(),
			runsQuery.refetch(),
			devicesQuery.refetch(),
		])
	}

	const selectedRun = useMemo(
		() => runsQuery.data?.find((run) => run.id === selectedRunId) ?? null,
		[runsQuery.data, selectedRunId],
	)
	const motionAssets = useMemo(
		() => assetsQuery.data?.filter((asset) => asset.artifacts.includes("motion_npz")) ?? [],
		[assetsQuery.data],
	)
	const defaultMotionId = motionAssets[0]?.id ?? ""
	const singleSelectedCheckpoint = chainItems.length === 1 ? chainItems[0] : null
	const jobMetrics = useMemo(() => {
		const currentJobs = jobsQuery.data ?? []
		return {
			activeJobs: currentJobs.filter((job) => job.status === "queued" || job.status === "running"),
			completedJobs: currentJobs.filter((job) => job.status === "succeeded").length,
		}
	}, [jobsQuery.data])
	const hasActivePlayback = jobMetrics.activeJobs.some((job) => job.kind === "play" || job.kind === "play_chain",)
	const hasOtherActivePlayback = jobMetrics.activeJobs.some(
		(job) => (job.kind === "play" || job.kind === "play_chain") && job.id !== playbackJobId,
	)
	const hasActiveTensorBoard = jobMetrics.activeJobs.some((job) => job.kind === "tensorboard")
	const selectedCheckpointKeys = useMemo(
		() => new Set(chainItems.map((item) => `${item.runId}\0${item.checkpoint}`)),
		[chainItems],
	)
	const sensors = useSensors(
		useSensor(PointerSensor),
		useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
	)

	function handleChainDragEnd({ active, over }: DragEndEvent) {
		if (!over || active.id === over.id) return

		setChainItems((current) => {
			const oldIndex = current.findIndex((item) => `${item.runId}\0${item.checkpoint}` === String(active.id))
			const newIndex = current.findIndex((item) => `${item.runId}\0${item.checkpoint}` === String(over.id))
			return oldIndex < 0 || newIndex < 0 ? current : arrayMove(current, oldIndex, newIndex)
		})
	}

	async function submitJob(submission: JobSubmission) {
		setMessage(null)
		try {
			await submitJobMutation.mutateAsync({ body: submission })
		} catch (error) {
			setMessage(getApiErrorMessage(error, "Could not queue job"))
		}
	}

	async function deleteRun() {
		if (!runToDelete) return
		setMessage(null)
		const [experiment, runName] = runToDelete.id.split("/")
		if (!experiment || !runName) {
			setMessage("Could not identify the selected run.")
			setRunToDelete(null)
			return
		}
		try {
			await deleteRunMutation.mutateAsync({ params: { path: { experiment, run_name: runName } } })
			if (selectedRunId === runToDelete.id) setSelectedRunId(null)
			setChainItems((current) => current.filter((item) => item.runId !== runToDelete.id))
			setRunToDelete(null)
		} catch (error) {
			setMessage(getApiErrorMessage(error, "Could not delete run"))
			setRunToDelete(null)
		}
	}

	async function downloadRun(run: (typeof runs)[number]) {
		setMessage(null)
		const [experiment, runName] = run.id.split("/")
		if (!experiment || !runName) {
			setMessage("Could not identify the selected run.")
			return
		}
		try {
			await downloadRunMutation.mutateAsync({ experiment, runName })
		} catch (error) {
			setMessage(getApiErrorMessage(error, "Could not download run"))
		}
	}

	async function startTensorBoard(runId: string) {
		if (hasActiveTensorBoard) return
		setOpeningTensorBoard(true)
		setMessage(null)
		const controller = new AbortController()
		tensorBoardAbortController.current = controller
		try {
			const job = await submitJobMutation.mutateAsync({ body: { kind: "tensorboard", run_id: runId } })
			setTensorBoardJobId(job.id)
			while (!controller.signal.aborted) {
				const jobResponse = await fetch(`${API_BASE_URL}/jobs/${job.id}`, { signal: controller.signal })
				const currentJob = await jobResponse.json()
				if (!jobResponse.ok) throw new Error(currentJob.detail ?? "Could not check TensorBoard startup.")
				if (["failed", "canceled", "interrupted", "succeeded"].includes(currentJob.status)) {
					throw new Error(currentJob.error ?? "TensorBoard stopped before it was ready.")
				}
				if (currentJob.status === "running") {
					const readyResponse = await fetch(`${API_BASE_URL}/jobs/${job.id}/ready`, { signal: controller.signal })
					const readiness = await readyResponse.json()
					if (!readyResponse.ok) throw new Error(readiness.detail ?? "Could not check TensorBoard readiness.")
					if (readiness.ready) {
						setTensorBoardRunId(runId)
						setTensorBoardUrl(`http://localhost:${process.env.NEXT_PUBLIC_HUMANOID_RL_TENSORBOARD_PORT}/tensorboard/`)
						return
					}
				}
				await new Promise((resolve) => window.setTimeout(resolve, 500))
			}
		} catch (error) {
			if (!controller.signal.aborted) {
				setTensorBoardJobId(null)
				setMessage(getApiErrorMessage(error, "Could not start TensorBoard"))
			}
		} finally {
			if (tensorBoardAbortController.current === controller) tensorBoardAbortController.current = null
			setOpeningTensorBoard(false)
		}
	}

	function launchTensorBoard() {
		const tensorBoardWindow = window.open(tensorBoardUrl ?? "/tensorboard/", "_blank")
		if (!tensorBoardWindow) setMessage("Allow pop-ups to open TensorBoard.")
	}

	function stopTensorBoard() {
		if (!tensorBoardJobId) return
		tensorBoardAbortController.current?.abort()
		setStoppingTensorBoard(true)
		setMessage(null)
		void fetch(`${API_BASE_URL}/jobs/${tensorBoardJobId}/cancel`, { method: "POST" })
			.then(async (response) => {
				if (!response.ok) {
					const result = await response.json()
					throw new Error(result.detail ?? "Could not stop TensorBoard.")
				}
				setTensorBoardRunId(null)
				setTensorBoardJobId(null)
				setTensorBoardUrl(null)
				await jobsQuery.refetch()
			})
			.catch((error: unknown) => {
				setMessage(getApiErrorMessage(error, "Could not stop TensorBoard"))
			})
			.finally(() => setStoppingTensorBoard(false))
	}

	async function startPlayback() {
		if (hasActivePlayback || chainItems.length === 0 || chainItems.some((item) => !item.assetId)) return
		setStartingPlayback(true)
		setPlaybackReady(false)
		setPlaybackJobId(null)
		setMessage(null)
		const controller = new AbortController()
		playbackAbortController.current = controller

		let submission: JobSubmission
		if (chainItems.length === 1) {
			const item = chainItems[0]
			if (!item) return
			submission = {
				kind: "play",
				asset_id: item.assetId,
				run_id: item.runId,
				checkpoint: item.checkpoint,
				device: "cpu",
				max_iterations: null,
				num_envs: 1,
			}
		} else {
			submission = {
				kind: "play_chain",
				asset_ids: chainItems.map((item) => item.assetId),
				run_ids: chainItems.map((item) => item.runId),
				checkpoints: chainItems.map((item) => item.checkpoint),
				device: "cpu",
				max_iterations: null,
				num_envs: 1,
			}
		}

		try {
			const job = await submitJobMutation.mutateAsync({ body: submission })
			setPlaybackJobId(job.id)
			while (!controller.signal.aborted) {
				const jobResponse = await fetch(`${API_BASE_URL}/jobs/${job.id}`, { signal: controller.signal })
				const currentJob = await jobResponse.json()
				if (!jobResponse.ok) {
					throw new Error(currentJob.detail ?? "Could not check playback startup.")
				}
				if (["failed", "canceled", "interrupted", "succeeded"].includes(currentJob.status)) {
					throw new Error(currentJob.error ?? "Playback stopped before the viewer was ready.")
				}
				if (currentJob.status === "running") {
					const probeController = new AbortController()
					const abortProbe = () => probeController.abort()
					const timeoutId = window.setTimeout(abortProbe, 2000)
					controller.signal.addEventListener("abort", abortProbe, { once: true })
					try {
						const viewerResponse = await fetch("/playback/", { signal: probeController.signal })
						if (viewerResponse.ok) {
							setPlaybackReady(true)
							return
						}
					} catch (error) {
						if (controller.signal.aborted) throw error
					} finally {
						window.clearTimeout(timeoutId)
						controller.signal.removeEventListener("abort", abortProbe)
					}
				}
				await new Promise((resolve) => window.setTimeout(resolve, 500))
			}
		} catch (error) {
			if (!controller.signal.aborted) {
				setPlaybackJobId(null)
				setMessage(getApiErrorMessage(error, "Could not start playback"))
			}
		} finally {
			if (playbackAbortController.current === controller) playbackAbortController.current = null
			setStartingPlayback(false)
		}
	}

	function stopPlayback() {
		if (!playbackJobId) return
		playbackAbortController.current?.abort()
		setStoppingPlayback(true)
		setMessage(null)
		void fetch(`${API_BASE_URL}/jobs/${playbackJobId}/cancel`, { method: "POST" })
			.then(async (response) => {
				const result = response.status === 204 ? null : await response.json()
				if (!response.ok) throw new Error(result?.detail ?? "Could not stop playback.")
				setPlaybackJobId(null)
				setPlaybackReady(false)
				await jobsQuery.refetch()
			})
			.catch((error: unknown) => {
				setMessage(getApiErrorMessage(error, "Could not stop playback"))
			})
			.finally(() => setStoppingPlayback(false))
	}

	function launchPlayback() {
		if (hasOtherActivePlayback) return
		const viewerWindow = window.open(`http://localhost:${process.env.NEXT_PUBLIC_HUMANOID_RL_PLAYBACK_PORT}/`, "_blank")
		if (!viewerWindow) setMessage("Allow pop-ups to open playback.")
	}

	return (
		<main className="min-h-svh">
			<div className="mx-auto max-w-[1500px] px-4 py-7 sm:px-8 sm:py-9">
				<WorkspacePageHeader
					title="Training Runs"
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
				<section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_350px]">
					<div>
						<div className="mb-3 flex items-center justify-between">
							<h2 className="text-sm font-semibold">All Runs</h2>
							<Button variant="ghost" size="icon-sm" aria-label="Refresh" title="Refresh" onClick={() => void refreshWorkspace()}><RefreshCw /></Button>
						</div>
						<DataTable
							ariaLabel="Local training runs"
							columns={[
								{
									key: "run",
									header: "Run",
									cell: (run) => (
										<span className="block min-w-0">
											<span className="block truncate text-sm font-medium">{run.name}</span>
											<span className="block truncate text-xs text-[#818c82]">{run.experiment}</span>
										</span>
									),
								},
								{
									key: "modified",
									header: "Modified",
									className: "hidden sm:table-cell",
									cell: (run) => <span className="font-mono text-xs text-[#7c887d]">{formatDate(run.modified_at)}</span>,
								},
							]}
							rows={runs}
							getRowId={(run) => run.id}
							getRowLabel={(run) => run.name}
							getActions={() => [
								{
									label: "Download",
									icon: <Download size={14} />,
									disabled: downloadRunMutation.isPending,
									onSelect: (run) => void downloadRun(run),
								},
								{
									label: "Delete",
									icon: <Trash2 size={14} />,
									destructive: true,
									onSelect: setRunToDelete,
								},
							]}
							emptyMessage="No training runs found"
							onRowClick={(run) => setSelectedRunId(run.id)}
							selectedRowId={selectedRunId}
						/>
					</div>
					<aside className="min-w-0 space-y-6">
						{selectedRun ? (
							<>
								<section>
									<div className="mb-3">
										  <h2 className="workspace-side-heading">Selected Run</h2>
									</div>
									<WorkspaceSidePanel>
										<WorkspaceSidePanelIdentity>
											<WorkspaceSidePanelPrimary className="truncate">{selectedRun.name}</WorkspaceSidePanelPrimary>
											<WorkspaceSidePanelSecondary className="truncate">{selectedRun.experiment} · {formatDate(selectedRun.modified_at)}</WorkspaceSidePanelSecondary>
										</WorkspaceSidePanelIdentity>
										<WorkspaceSidePanelRow label="Status">
											<span className="inline-flex items-center gap-2">
												<span className={`inline-flex items-center gap-1.5 text-xs ${selectedRun.checkpoints.length > 0 ? "text-[#42783a]" : "text-[#7c887d]"}`}>
													<span className={`size-1.5 rounded-full ${selectedRun.checkpoints.length > 0 ? "bg-[#67b942]" : "bg-[#bbc5b9]"}`} />
													{/* {selectedRun.checkpoints.length > 0 ? "Ready" : "No checkpoints"} */}
												</span>
											</span>
										</WorkspaceSidePanelRow>
										<RunFilesBrowser run={selectedRun} />
										{selectedRun.checkpoints.length > 0 && (
											<WorkspaceSidePanelActions>
												{hasActiveTensorBoard && !stoppingTensorBoard && !openingTensorBoard && (
													<p role="alert" className="text-sm font-medium text-red-700">
														Close or cancel the existing TensorBoard session before starting another.
													</p>
												)}
												{tensorBoardRunId === selectedRun.id ? (
													<>
														<Button className="workspace-side-action" onClick={launchTensorBoard}>
															Launch TensorBoard <ArrowUpRight size={13} />
														</Button>
														<Button className="workspace-side-action" disabled={openingTensorBoard || stoppingTensorBoard} onClick={stopTensorBoard}>
															{stoppingTensorBoard ? <><LoaderCircle className="animate-spin" size={13} /> Stopping TensorBoard</> : "Stop TensorBoard"}
														</Button>
													</>
												) : (
													<>
														<Button className="workspace-side-action" disabled={openingTensorBoard || hasActiveTensorBoard} onClick={() => startTensorBoard(selectedRun.id)}>
															{openingTensorBoard ? <LoaderCircle className="animate-spin" size={13} /> : <ArrowUpRight size={13} />}
															{openingTensorBoard ? "Starting TensorBoard" : "Start TensorBoard"}
														</Button>
														{tensorBoardJobId && tensorBoardRunId !== selectedRun.id && (
															<Button className="workspace-side-action" disabled={stoppingTensorBoard} onClick={stopTensorBoard}>
																{stoppingTensorBoard ? <><LoaderCircle className="animate-spin" size={13} /> Stopping TensorBoard</> : "Cancel TensorBoard"}
															</Button>
														)}
													</>
												)}
											</WorkspaceSidePanelActions>
										)}
									</WorkspaceSidePanel>
								</section>
								<section>
									<div className="mb-3">
										  <h2 className="workspace-side-heading">Checkpoints</h2>
									</div>
									  <div className="workspace-side-panel">
										{selectedRun.checkpoints.length === 0 ? (
											<p className="px-4 py-7 text-center text-xs text-[#859086]">No checkpoint files found</p>
										) : selectedRun.checkpoints.map((checkpoint) => (
											<div key={checkpoint} className="flex items-center gap-2 px-3 py-3">
												<input
													aria-label={`Select checkpoint ${checkpoint} for playback`}
													className="accent-[#6d9d45]"
													type="checkbox"
													checked={selectedCheckpointKeys.has(`${selectedRun.id}\0${checkpoint}`)}
													onChange={(event) => setChainItems((current) =>
														event.target.checked
															? [...current, { runId: selectedRun.id, checkpoint, assetId: defaultMotionId }]
															: current.filter((item) => item.runId !== selectedRun.id || item.checkpoint !== checkpoint),
													)}
												/>
												<span className="min-w-0 flex-1 truncate font-mono text-xs">{checkpoint}</span>
											</div>
										))}
									</div>
								</section>
								{chainItems.length > 0 && (
									<section>
										<div className="mb-3">
											  <h2 className="workspace-side-heading">Selected Checkpoints · {chainItems.length}</h2>
										</div>
										<div className="workspace-side-panel">
										<DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleChainDragEnd}>
											<SortableContext
												items={chainItems.map((item) => `${item.runId}\0${item.checkpoint}`)}
												strategy={verticalListSortingStrategy}
											>
												{chainItems.map((item, index) => {
													const run = runs.find((candidate) => candidate.id === item.runId)
													return (
														<SortableChainItem
															key={`${item.runId}\0${item.checkpoint}`}
															item={item}
															index={index}
															runName={run?.name ?? item.runId}
															motionAssets={motionAssets}
															onAssetChange={(assetId) => setChainItems((current) => current.map((candidate) =>
																candidate.runId === item.runId && candidate.checkpoint === item.checkpoint
																	? { ...candidate, assetId }
																	: candidate,
															))}
														/>
													)
												})}
											</SortableContext>
										</DndContext>
										</div>
									</section>
								)}
								<WorkspaceSidePanelActions className="border-y border-[#dce3dc] bg-white">
									{hasActivePlayback && !stoppingPlayback && !startingPlayback &&(
										<p role="alert" className="text-sm font-medium text-red-700">
											Close or cancel the existing Play session before starting another.
										</p>
									)}
									<Button
										className="workspace-side-action w-full"
										disabled={startingPlayback || stoppingPlayback || hasOtherActivePlayback || (!playbackReady && hasActivePlayback) || chainItems.some((item) => !item.assetId) || chainItems.length === 0}
										onClick={() => playbackReady ? launchPlayback() : void startPlayback()}
									>
										{startingPlayback
											? <><LoaderCircle className="animate-spin" size={14} /> Starting Play</>
											: playbackReady ? "Launch Play" : "Start Play"}
									</Button>
									{playbackJobId && (
										<Button className="workspace-side-action w-full" disabled={startingPlayback || stoppingPlayback} onClick={stopPlayback}>
											{stoppingPlayback ? <><LoaderCircle className="animate-spin" size={14} /> Stopping Play</> : "Stop Play"}
										</Button>
									)}
									<Button
										className="workspace-side-action w-full"
										disabled={!singleSelectedCheckpoint || singleSelectedCheckpoint.runId !== selectedRun.id}
										onClick={() => {
											if (!singleSelectedCheckpoint || singleSelectedCheckpoint.runId !== selectedRun.id) return
											void submitJob({
												kind: "resume",
												run_id: selectedRun.id,
												checkpoint: singleSelectedCheckpoint.checkpoint,
											})
										}}
										>
										Resume Training
									</Button>
								</WorkspaceSidePanelActions>
							</>
						) : (
							<div className="grid min-h-40 place-items-center text-center">
								<div>
									<FolderOpen className="mx-auto mb-2 text-[#9ca99c]" size={22} />
									<p className="text-sm text-[#5f6d61]">Select a run</p>
								</div>
							</div>
						)}
					</aside>
				</section>
			</div>
			<ConfirmDeleteDialog
				open={runToDelete !== null}
				onOpenChange={(open) => {
					if (!open && !deleteRunMutation.isPending) setRunToDelete(null)
				}}
				title="Delete run?"
				description="This permanently removes the run directory, including checkpoints and logs."
				itemName={runToDelete ? `${runToDelete.experiment}/${runToDelete.name}` : ""}
				pending={deleteRunMutation.isPending}
				onConfirm={() => void deleteRun()}
			/>
		</main>
	)
}