import { act, cleanup, renderHook } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ReactNode } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("useSubmitJob", () => {
  it("posts a typed submission and invalidates workspace data", async () => {
    const job = {
      id: "job-1",
      kind: "train",
      payload: {},
      status: "queued",
      created_at: "2026-10-05T00:00:00Z",
    }
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(job), {
        status: 202,
        headers: { "Content-Type": "application/json" },
      }),
    )
    vi.stubGlobal("fetch", fetchMock)

    const { useSubmitJob } = await import("./use-jobs")
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    queryClient.setQueryData(["get", "/jobs"], [])
    queryClient.setQueryData(["get", "/assets"], [])
    queryClient.setQueryData(["get", "/runs"], [])
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )
    const { result } = renderHook(() => useSubmitJob(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({
        body: { kind: "train", max_iterations: 1, num_envs: 1 },
      })
    })

    expect(queryClient.getQueryState(["get", "/jobs"])?.isInvalidated).toBe(true)
    expect(queryClient.getQueryState(["get", "/assets"])?.isInvalidated).toBe(true)
    expect(queryClient.getQueryState(["get", "/runs"])?.isInvalidated).toBe(true)
    const request = fetchMock.mock.calls[0]?.[0] as Request
    expect(new URL(request.url).pathname).toBe("/api/jobs")
    queryClient.clear()
  })
})

describe("useDeleteJob", () => {
  it("deletes the selected job and invalidates the queue", async () => {
    vi.resetModules()
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal("fetch", fetchMock)

    const { useDeleteJob } = await import("./use-jobs")
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    queryClient.setQueryData(["get", "/jobs"], [{ id: "job-1" }])
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )
    const { result } = renderHook(() => useDeleteJob(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({ params: { path: { job_id: "job-1" } } })
    })

    expect(queryClient.getQueryState(["get", "/jobs"])?.isInvalidated).toBe(true)
    const request = fetchMock.mock.calls[0]?.[0] as Request
    expect(request.method).toBe("DELETE")
    expect(new URL(request.url).pathname).toBe("/api/jobs/job-1")
    queryClient.clear()
  })
})

describe("useDeleteAsset", () => {
  it("deletes the selected asset and invalidates the asset list", async () => {
    vi.resetModules()
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal("fetch", fetchMock)

    const { useDeleteAsset } = await import("./use-assets")
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    queryClient.setQueryData(["get", "/assets"], [{ id: "asset-1" }])
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )
    const { result } = renderHook(() => useDeleteAsset(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({ params: { path: { asset_id: "asset-1" } } })
    })

    expect(queryClient.getQueryState(["get", "/assets"])?.isInvalidated).toBe(true)
    const request = fetchMock.mock.calls[0]?.[0] as Request
    expect(request.method).toBe("DELETE")
    expect(new URL(request.url).pathname).toBe("/api/assets/asset-1")
    queryClient.clear()
  })
})

describe("useDeleteRun", () => {
  it("deletes the selected run and invalidates the run list", async () => {
    vi.resetModules()
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal("fetch", fetchMock)

    const { useDeleteRun } = await import("./use-runs")
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    queryClient.setQueryData(["get", "/runs"], [{ id: "experiment/run-1" }])
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )
    const { result } = renderHook(() => useDeleteRun(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync({ params: { path: { experiment: "experiment", run_name: "run-1" } } })
    })

    expect(queryClient.getQueryState(["get", "/runs"])?.isInvalidated).toBe(true)
    const request = fetchMock.mock.calls[0]?.[0] as Request
    expect(request.method).toBe("DELETE")
    expect(new URL(request.url).pathname).toBe("/api/runs/experiment/run-1")
    queryClient.clear()
  })
})