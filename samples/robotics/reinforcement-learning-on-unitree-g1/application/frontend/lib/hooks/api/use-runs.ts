import { useMutation, useQueryClient } from "@tanstack/react-query"

import { $api } from "@/lib/api"
import { downloadRunArchive } from "@/lib/api/download-archive"

export function useRuns() {
  return $api.useQuery("get", "/runs", undefined, { refetchInterval: 5000 })
}

export function useRunFiles(experiment: string | null, runName: string | null) {
  return $api.useQuery(
    "get",
    "/runs/{experiment}/{run_name}/files",
    {
      params: {
        path: { experiment: experiment ?? "", run_name: runName ?? "" },
      },
    },
    { enabled: false }
  )
}

export function useDeleteRun() {
  const queryClient = useQueryClient()

  return $api.useMutation("delete", "/runs/{experiment}/{run_name}", {
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["get", "/runs"] }),
  })
}

export function useDownloadRun() {
  return useMutation({
    mutationFn: ({
      experiment,
      runName,
    }: {
      experiment: string
      runName: string
    }) => downloadRunArchive(experiment, runName),
  })
}
