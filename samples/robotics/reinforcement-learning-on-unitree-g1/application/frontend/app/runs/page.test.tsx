// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { useAssetsMock, useDevicesMock, useJobsMock, useRunsMock, useRunFilesMock, refetchRunFilesMock, mutateAsyncMock, deleteRunMutationMock, downloadRunMutationMock } = vi.hoisted(() => ({
	useAssetsMock: vi.fn(),
	useDevicesMock: vi.fn(),
	useJobsMock: vi.fn(),
	useRunsMock: vi.fn(),
	useRunFilesMock: vi.fn(),
	refetchRunFilesMock: vi.fn(),
	mutateAsyncMock: vi.fn(),
	deleteRunMutationMock: vi.fn(),
	downloadRunMutationMock: vi.fn(),
}))

vi.mock("@/lib/hooks/api/use-assets", () => ({ useAssets: useAssetsMock }))
vi.mock("@/lib/hooks/api/use-devices", () => ({ useDevices: useDevicesMock }))
vi.mock("@/lib/hooks/api/use-jobs", () => ({
	useJobs: useJobsMock,
	useSubmitJob: () => ({ mutateAsync: mutateAsyncMock }),
}))
vi.mock("@/lib/hooks/api/use-runs", () => ({
	useRuns: useRunsMock,
	useRunFiles: useRunFilesMock,
	useDeleteRun: () => ({ mutateAsync: deleteRunMutationMock }),
	useDownloadRun: () => ({ isPending: false, mutateAsync: downloadRunMutationMock }),
}))

import RunsPage from "./page"

const viewerWindow = {
	opener: window as Window | null,
	close: vi.fn(),
	location: { replace: vi.fn() },
}

beforeEach(() => {
	vi.stubEnv("NEXT_PUBLIC_HUMANOID_RL_PLAYBACK_PORT", "8081")
	vi.stubEnv("NEXT_PUBLIC_HUMANOID_RL_TENSORBOARD_PORT", "6767")
	useAssetsMock.mockReturnValue({
		data: [{ id: "asset-1", filename: "motion.mp4", artifacts: ["motion_npz"] }],
		isSuccess: true,
		refetch: vi.fn(),
	})
	useDevicesMock.mockReturnValue({ data: ["cpu"], isSuccess: true, refetch: vi.fn() })
	useJobsMock.mockReturnValue({ data: [], isSuccess: true, refetch: vi.fn() })
	useRunsMock.mockReturnValue({
		data: [{
			id: "experiment/demo-run",
			name: "demo-run",
			experiment: "experiment",
			checkpoints: ["model_1.pt", "model_2.pt"],
			modified_at: "2026-10-06T00:00:00Z",
		}],
		isSuccess: true,
		refetch: vi.fn(),
	})
	useRunFilesMock.mockReturnValue({ data: [], isLoading: false, isError: false, refetch: refetchRunFilesMock })
	mutateAsyncMock.mockReset().mockResolvedValue({})
	deleteRunMutationMock.mockReset().mockResolvedValue(undefined)
	downloadRunMutationMock.mockReset().mockResolvedValue(undefined)
	viewerWindow.close.mockReset()
	viewerWindow.location.replace.mockReset()
	vi.spyOn(window, "open").mockReturnValue(viewerWindow as unknown as Window)
})

afterEach(() => {
	cleanup()
	vi.restoreAllMocks()
	vi.useRealTimers()
	vi.unstubAllGlobals()
	vi.unstubAllEnvs()
})

function selectRunAndCheckpoints(checkpoints: string[]) {
	const runButton = screen.getByText("demo-run").closest("button")
	if (!runButton) throw new Error("Run row was not rendered as a button.")
	fireEvent.click(runButton)
	for (const checkpoint of checkpoints) {
		fireEvent.click(screen.getByRole("checkbox", { name: `Select checkpoint ${checkpoint} for playback` }))
	}
}

describe("RunsPage playback", () => {
	it.each([
		{ kind: "play", status: "running" },
		{ kind: "play_chain", status: "queued" },
		{ kind: "tensorboard", status: "running" },
	])("blocks only the matching start while a $kind job is active", ({ kind, status }) => {
		useJobsMock.mockReturnValue({
			data: [{ id: "existing-job", kind, status }],
			isSuccess: true,
			refetch: vi.fn(),
		})
		render(<RunsPage />)
		selectRunAndCheckpoints(["model_1.pt"])

		const playButton = screen.getByRole("button", { name: "Start Play" })
		const tensorBoardButton = screen.getByRole("button", { name: "Start TensorBoard" })
		const playbackIsActive = kind === "play" || kind === "play_chain"
		expect(playButton.hasAttribute("disabled")).toBe(playbackIsActive)
		expect(tensorBoardButton.hasAttribute("disabled")).toBe(kind === "tensorboard")
		const warning = screen.getByRole("alert")
		expect(warning.textContent).toContain(
			playbackIsActive ? "existing Play session" : "existing TensorBoard session",
		)
		expect(warning.nextElementSibling).toBe(playbackIsActive ? playButton : tensorBoardButton)
	})

	it.each([
		{ kind: "play", status: "running" },
		{ kind: "play_chain", status: "queued" },
	])("disables Launch Play when another $kind job is active", async ({ kind, status }) => {
		const fetchMock = vi.fn()
			.mockResolvedValueOnce({ ok: true, json: async () => ({ status: "running" }) })
			.mockResolvedValueOnce({ ok: true })
		vi.stubGlobal("fetch", fetchMock)
		mutateAsyncMock.mockResolvedValueOnce({ id: "play-job" })
		let currentJobs: { id: string; kind: string; status: string }[] = []
		const jobsQuery = {
			get data() { return currentJobs },
			isSuccess: true,
			refetch: vi.fn(),
		}
		useJobsMock.mockReturnValue(jobsQuery)
		const view = render(<RunsPage />)
		selectRunAndCheckpoints(["model_1.pt"])

		fireEvent.click(screen.getByRole("button", { name: "Start Play" }))
		await screen.findByRole("button", { name: "Launch Play" })
		currentJobs = [
			{ id: "play-job", kind: "play", status: "running" },
			{ id: "other-play-job", kind, status },
		]
		view.rerender(<RunsPage />)

		expect(screen.getByRole("button", { name: "Launch Play" }).hasAttribute("disabled")).toBe(true)
		expect(screen.getByRole("button", { name: "Stop Play" }).hasAttribute("disabled")).toBe(false)
	})

	it("waits for a single play job before offering the launch action", async () => {
		const fetchMock = vi.fn()
			.mockResolvedValueOnce({ ok: true, json: async () => ({ status: "running" }) })
			.mockResolvedValueOnce({ ok: true })
		vi.stubGlobal("fetch", fetchMock)
		mutateAsyncMock.mockResolvedValueOnce({ id: "play-job" })
		render(<RunsPage />)
		selectRunAndCheckpoints(["model_1.pt"])

		fireEvent.click(screen.getByRole("button", { name: "Start Play" }))

		expect(window.open).not.toHaveBeenCalled()
		expect(mutateAsyncMock).toHaveBeenCalledWith({
			body: {
				kind: "play",
				asset_id: "asset-1",
				run_id: "experiment/demo-run",
				checkpoint: "model_1.pt",
				device: "cpu",
				max_iterations: null,
				num_envs: 1,
			},
		})
		await screen.findByRole("button", { name: "Launch Play" })
		expect(screen.getByRole("button", { name: "Stop Play" })).toBeTruthy()

		fireEvent.click(screen.getByRole("button", { name: "Launch Play" }))
		expect(window.open).toHaveBeenCalledWith("about:blank", "_blank")
		expect(viewerWindow.opener).toBeNull()
		expect(viewerWindow.location.replace).toHaveBeenCalledWith("http://127.0.0.1:8081/")
	})

	it("starts a play chain without opening its viewer early", async () => {
		const fetchMock = vi.fn()
			.mockResolvedValueOnce({ ok: true, json: async () => ({ status: "running" }) })
			.mockResolvedValueOnce({ ok: true })
		vi.stubGlobal("fetch", fetchMock)
		mutateAsyncMock.mockResolvedValueOnce({ id: "play-chain-job" })
		render(<RunsPage />)
		selectRunAndCheckpoints(["model_1.pt", "model_2.pt"])

		fireEvent.click(screen.getByRole("button", { name: "Start Play" }))

		expect(window.open).not.toHaveBeenCalled()
		expect(mutateAsyncMock).toHaveBeenCalledWith({
			body: {
				kind: "play_chain",
				asset_ids: ["asset-1", "asset-1"],
				run_ids: ["experiment/demo-run", "experiment/demo-run"],
				checkpoints: ["model_1.pt", "model_2.pt"],
				device: "cpu",
				max_iterations: null,
				num_envs: 1,
			},
		})
		await screen.findByRole("button", { name: "Launch Play" })
	})

	it("reports when queuing playback fails without opening the viewer", async () => {
		mutateAsyncMock.mockRejectedValueOnce(new Error("Queue unavailable"))
		render(<RunsPage />)
		selectRunAndCheckpoints(["model_1.pt"])

		fireEvent.click(screen.getByRole("button", { name: "Start Play" }))

		const alert = await screen.findByRole("alert")
		expect(window.open).not.toHaveBeenCalled()
		expect(viewerWindow.close).not.toHaveBeenCalled()
		expect(alert.textContent).toContain("Queue unavailable")
	})

	it("stops a ready playback job", async () => {
		const fetchMock = vi.fn()
			.mockResolvedValueOnce({ ok: true, json: async () => ({ status: "running" }) })
			.mockResolvedValueOnce({ ok: true })
			.mockResolvedValueOnce({ ok: true, json: async () => ({ status: "canceled" }) })
		vi.stubGlobal("fetch", fetchMock)
		mutateAsyncMock.mockResolvedValueOnce({ id: "play-job" })
		let currentJobs: { id: string; kind: string; status: string }[] = []
		const jobsQuery = {
			get data() { return currentJobs },
			isSuccess: true,
			refetch: vi.fn(async () => { currentJobs = [] }),
		}
		useJobsMock.mockReturnValue(jobsQuery)
		const view = render(<RunsPage />)
		selectRunAndCheckpoints(["model_1.pt"])

		fireEvent.click(screen.getByRole("button", { name: "Start Play" }))
		await screen.findByRole("button", { name: "Launch Play" })
		currentJobs = [{ id: "play-job", kind: "play", status: "running" }]
		view.rerender(<RunsPage />)
		expect(screen.getByRole("alert").textContent).toContain("existing Play session")
		fireEvent.click(screen.getByRole("button", { name: "Stop Play" }))
		expect(screen.queryByRole("alert")).toBeNull()
		expect(screen.getByRole("button", { name: "Stopping Play" })).toBeTruthy()

		expect(fetchMock).toHaveBeenLastCalledWith(
			expect.stringContaining("/jobs/play-job/cancel"),
			expect.objectContaining({ method: "POST" }),
		)
		await screen.findByRole("button", { name: "Start Play" })
	})

	it("reports when the browser blocks Launch Play", async () => {
		vi.mocked(window.open).mockReturnValueOnce(null)
		const fetchMock = vi.fn()
			.mockResolvedValueOnce({ ok: true, json: async () => ({ status: "running" }) })
			.mockResolvedValueOnce({ ok: true })
		vi.stubGlobal("fetch", fetchMock)
		mutateAsyncMock.mockResolvedValueOnce({ id: "play-job" })
		render(<RunsPage />)
		selectRunAndCheckpoints(["model_1.pt"])

		fireEvent.click(screen.getByRole("button", { name: "Start Play" }))
		await screen.findByRole("button", { name: "Launch Play" })
		fireEvent.click(screen.getByRole("button", { name: "Launch Play" }))

		const alert = await screen.findByRole("alert")
		expect(mutateAsyncMock).toHaveBeenCalledOnce()
		expect(alert.textContent).toContain("Allow pop-ups to open playback.")
	})
})

describe("RunsPage TensorBoard", () => {
	it("starts TensorBoard before offering the launch action", async () => {
		const fetchMock = vi.fn()
			.mockResolvedValueOnce({ ok: true, json: async () => ({ status: "running" }) })
			.mockResolvedValueOnce({ ok: true, json: async () => ({ ready: true }) })
		vi.stubGlobal("fetch", fetchMock)
		mutateAsyncMock.mockResolvedValueOnce({ id: "tensorboard-job" })
		render(<RunsPage />)
		selectRunAndCheckpoints([])

		fireEvent.click(screen.getByRole("button", { name: "Start TensorBoard" }))

		expect(window.open).not.toHaveBeenCalled()
		expect(mutateAsyncMock).toHaveBeenCalledWith({ body: { kind: "tensorboard", run_id: "experiment/demo-run" } })
		await screen.findByRole("button", { name: "Launch TensorBoard" })
		expect(fetchMock).toHaveBeenCalledTimes(2)
		expect(screen.getByRole("button", { name: "Stop TensorBoard" })).toBeTruthy()

		fireEvent.click(screen.getByRole("button", { name: "Launch TensorBoard" }))
		expect(window.open).toHaveBeenCalledWith("about:blank", "_blank")
		expect(viewerWindow.opener).toBeNull()
		expect(viewerWindow.location.replace).toHaveBeenCalledWith("http://127.0.0.1:6767/tensorboard/")
	})

	it("stops TensorBoard and returns to the start action", async () => {
		const fetchMock = vi.fn()
			.mockResolvedValueOnce({ ok: true, json: async () => ({ status: "running" }) })
			.mockResolvedValueOnce({ ok: true, json: async () => ({ ready: true }) })
			.mockResolvedValueOnce({ ok: true })
		vi.stubGlobal("fetch", fetchMock)
		mutateAsyncMock.mockResolvedValueOnce({ id: "tensorboard-job" })
		let currentJobs: { id: string; kind: string; status: string }[] = []
		const jobsQuery = {
			get data() { return currentJobs },
			isSuccess: true,
			refetch: vi.fn(async () => { currentJobs = [] }),
		}
		useJobsMock.mockReturnValue(jobsQuery)
		const view = render(<RunsPage />)
		selectRunAndCheckpoints([])

		fireEvent.click(screen.getByRole("button", { name: "Start TensorBoard" }))
		await screen.findByRole("button", { name: "Launch TensorBoard" })
		currentJobs = [{ id: "tensorboard-job", kind: "tensorboard", status: "running" }]
		view.rerender(<RunsPage />)
		expect(screen.getByRole("alert").textContent).toContain("existing TensorBoard session")
		fireEvent.click(screen.getByRole("button", { name: "Stop TensorBoard" }))
		expect(screen.queryByRole("alert")).toBeNull()
		expect(screen.getByRole("button", { name: "Stopping TensorBoard" })).toBeTruthy()

		expect(fetchMock).toHaveBeenLastCalledWith(
			expect.stringContaining("/jobs/tensorboard-job/cancel"),
			expect.objectContaining({ method: "POST" }),
		)
		await screen.findByRole("button", { name: "Start TensorBoard" })
	})
})

describe("RunsPage polling", () => {
	it.each([
		{ start: "Start Play", launch: "Launch Play", checkpoints: ["model_1.pt"] },
		{ start: "Start TensorBoard", launch: "Launch TensorBoard", checkpoints: [] },
	])("retries $start with a function-only timer callback", async ({ start, launch, checkpoints }) => {
		vi.useFakeTimers()
		const timeoutSpy = vi.spyOn(window, "setTimeout")
		const fetchMock = vi.fn()
			.mockResolvedValueOnce({ ok: true, json: async () => ({ status: "queued" }) })
			.mockResolvedValueOnce({ ok: true, json: async () => ({ status: "running" }) })
			.mockResolvedValueOnce({ ok: true, json: async () => ({ ready: true }) })
		vi.stubGlobal("fetch", fetchMock)
		mutateAsyncMock.mockResolvedValueOnce({ id: "viewer-job" })
		render(<RunsPage />)
		selectRunAndCheckpoints(checkpoints)

		await act(async () => {
			fireEvent.click(screen.getByRole("button", { name: start }))
		})

		expect(fetchMock).toHaveBeenCalledTimes(1)
		const retryTimers = timeoutSpy.mock.calls.filter(([, delay]) => delay === 500)
		expect(retryTimers).toHaveLength(1)
		expect(retryTimers[0][0]).toBeTypeOf("function")
		expect(screen.queryByRole("button", { name: launch })).toBeNull()

		await act(async () => {
			await vi.advanceTimersByTimeAsync(499)
		})
		expect(fetchMock).toHaveBeenCalledTimes(1)

		await act(async () => {
			await vi.advanceTimersByTimeAsync(1)
		})
		expect(fetchMock).toHaveBeenCalledTimes(3)
		expect(screen.getByRole("button", { name: launch })).toBeTruthy()
	})
})

describe("RunsPage cancellation errors", () => {
	it.each([
		{ start: "Start Play", stop: "Stop Play", checkpoints: ["model_1.pt"] },
		{ start: "Start TensorBoard", stop: "Stop TensorBoard", checkpoints: [] },
	])("reports failures from $stop", async ({ start, stop, checkpoints }) => {
		const fetchMock = vi.fn()
			.mockResolvedValueOnce({ ok: true, json: async () => ({ status: "running" }) })
			.mockResolvedValueOnce({ ok: true, json: async () => ({ ready: true }) })
			.mockResolvedValueOnce({ ok: false, json: async () => ({ detail: "Cancellation denied" }) })
		vi.stubGlobal("fetch", fetchMock)
		mutateAsyncMock.mockResolvedValueOnce({ id: "viewer-job" })
		render(<RunsPage />)
		selectRunAndCheckpoints(checkpoints)

		fireEvent.click(screen.getByRole("button", { name: start }))
		await screen.findByRole("button", { name: stop })
		fireEvent.click(screen.getByRole("button", { name: stop }))

		expect((await screen.findByRole("alert")).textContent).toContain("Cancellation denied")
		expect((await screen.findByRole("button", { name: stop })).hasAttribute("disabled")).toBe(false)
	})
})

describe("RunsPage selected run panel", () => {
	it("marks runs without checkpoints as not ready", () => {
		useRunsMock.mockReturnValue({
			data: [{
				id: "experiment/demo-run",
				name: "demo-run",
				experiment: "experiment",
				checkpoints: [],
				modified_at: "2026-10-06T00:00:00Z",
			}],
			isSuccess: true,
			refetch: vi.fn(),
		})
		render(<RunsPage />)
		selectRunAndCheckpoints([])

		expect(screen.getByText("No checkpoints")).toBeTruthy()
		expect(screen.getByText("0 checkpoints")).toBeTruthy()
		expect(screen.queryByRole("button", { name: "Open TensorBoard" })).toBeNull()
	})

	it("shows checkpoint readiness and loads files when expanded", () => {
		useRunFilesMock.mockReturnValue({
			data: [{ path: "config.yaml" }, { path: "logs/progress.csv" }],
			isLoading: false,
			isError: false,
			refetch: refetchRunFilesMock,
		})
		render(<RunsPage />)
		selectRunAndCheckpoints([])

		expect(screen.getByText("Ready")).toBeTruthy()
		expect(useRunFilesMock).toHaveBeenCalledWith("experiment", "demo-run")
		expect(refetchRunFilesMock).not.toHaveBeenCalled()
		expect(screen.queryByText("progress.csv")).toBeNull()

		fireEvent.click(screen.getByRole("button", { name: "Expand Files" }))

		expect(refetchRunFilesMock).toHaveBeenCalledOnce()
		expect(screen.getByText("progress.csv")).toBeTruthy()
	})

	it("stacks full-width run actions", () => {
		render(<RunsPage />)
		selectRunAndCheckpoints(["model_1.pt"])

		const tensorBoardButton = screen.getByRole("button", { name: "Open TensorBoard" })
		const resumeButton = screen.getByRole("button", { name: "Resume Training" })
		const playButton = screen.getByRole("button", { name: "Play" })
		const actionGroup = tensorBoardButton.closest('[data-slot="workspace-side-panel-actions"]')

		expect(actionGroup?.children).toHaveLength(2)
		expect(tensorBoardButton.className).toContain("w-full")
		expect(resumeButton.className).toContain("w-full")
		expect(playButton.className).toContain("w-full")
	})

	it("submits resume using only the selected run and checkpoint", () => {
		render(<RunsPage />)
		selectRunAndCheckpoints(["model_1.pt"])

		fireEvent.click(screen.getByRole("button", { name: "Resume Training" }))

		expect(mutateAsyncMock).toHaveBeenCalledWith({
			body: {
				kind: "resume",
				run_id: "experiment/demo-run",
				checkpoint: "model_1.pt",
			},
		})
	})

	it("reports resume submission failures", async () => {
		mutateAsyncMock.mockRejectedValueOnce(new Error("Resume queue unavailable"))
		render(<RunsPage />)
		selectRunAndCheckpoints(["model_1.pt"])

		fireEvent.click(screen.getByRole("button", { name: "Resume Training" }))

		expect((await screen.findByRole("alert")).textContent).toContain("Resume queue unavailable")
	})
})

describe("RunsPage row actions", () => {
	it("offers Download and Delete with concise labels", async () => {
		render(<RunsPage />)
		fireEvent.click(screen.getByRole("button", { name: "More actions for demo-run" }))

		const downloadAction = await screen.findByRole("menuitem", { name: "Download" })
		expect(screen.getByRole("menuitem", { name: "Delete" })).toBeTruthy()
		fireEvent.click(downloadAction)

		expect(downloadRunMutationMock).toHaveBeenCalledWith({ experiment: "experiment", runName: "demo-run" })
	})
})