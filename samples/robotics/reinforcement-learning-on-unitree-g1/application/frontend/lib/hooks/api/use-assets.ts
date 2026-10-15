import { useMutation, useQueryClient } from "@tanstack/react-query"

import { $api, uploadAsset } from "@/lib/api"
import { downloadAssetArchive } from "@/lib/api/download-archive"

export function useAssets() {
  return $api.useQuery("get", "/assets", undefined, { refetchInterval: 5000 })
}

export function useAssetFiles(assetId: string | null) {
  return $api.useQuery(
    "get",
    "/assets/{asset_id}/files",
    { params: { path: { asset_id: assetId ?? "" } } },
    { enabled: assetId !== null },
  )
}

export function useUploadAsset() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: uploadAsset,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["get", "/assets"] }),
  })
}

export function useDeleteAsset() {
  const queryClient = useQueryClient()

  return $api.useMutation("delete", "/assets/{asset_id}", {
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["get", "/assets"] }),
  })
}

export function useDownloadAsset() {
  return useMutation({ mutationFn: downloadAssetArchive })
}