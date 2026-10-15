import { useEffect, type Dispatch, type SetStateAction } from "react"
import { useQueryClient } from "@tanstack/react-query"

import { $api, connectJobEvents } from "@/lib/api"
import type { Job } from "@/lib/api"

export function useJobs() {
  return $api.useQuery("get", "/jobs", undefined, { refetchInterval: 5000 })
}

export function useSubmitJob() {
  const queryClient = useQueryClient()

  return $api.useMutation("post", "/jobs", {
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["get", "/jobs"] }),
        queryClient.invalidateQueries({ queryKey: ["get", "/assets"] }),
        queryClient.invalidateQueries({ queryKey: ["get", "/runs"] }),
      ])
    },
  })
}

export function useCancelJob() {
  const queryClient = useQueryClient()

  return $api.useMutation("post", "/jobs/{job_id}/cancel", {
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["get", "/jobs"] }),
  })
}

export function useDeleteJob() {
  const queryClient = useQueryClient()

  return $api.useMutation("delete", "/jobs/{job_id}", {
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["get", "/jobs"] }),
  })
}

export function useJobEvents(jobId: string | null, setLogLines: Dispatch<SetStateAction<string[]>>) {
  const queryClient = useQueryClient()

  useEffect(() => {
    if (!jobId) return

    return connectJobEvents(jobId, {
      onLog: (line) => setLogLines((current) => [...current, line].slice(-240)),
      onStatus: (updated) => {
        queryClient.setQueryData<Job[]>(["get", "/jobs"], (current) =>
          current?.map((job) => (job.id === updated.id ? updated : job)),
        )
        if (updated.status !== "queued" && updated.status !== "running") {
          void queryClient.invalidateQueries({ queryKey: ["get", "/assets"] })
          void queryClient.invalidateQueries({ queryKey: ["get", "/runs"] })
        }
      },
    })
  }, [jobId, queryClient, setLogLines])
}