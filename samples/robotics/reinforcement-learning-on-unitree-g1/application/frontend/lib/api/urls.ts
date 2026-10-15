import { API_BASE_URL } from "./client"

function apiUrl(path: string) {
  return `${API_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`
}

export function assetPreviewUrl(assetId: string, previewName: string) {
  return apiUrl(`/assets/${encodeURIComponent(assetId)}/previews/${encodeURIComponent(previewName)}`)
}

export function assetFileUrl(assetId: string, filePath: string) {
  const encodedPath = filePath.split("/").map(encodeURIComponent).join("/")
  return apiUrl(`/assets/${encodeURIComponent(assetId)}/files/${encodedPath}`)
}

export function assetArtifactUrl(assetId: string, artifactName: string) {
  return apiUrl(`/assets/${encodeURIComponent(assetId)}/artifacts/${encodeURIComponent(artifactName)}`)
}

export function jobEventsUrl(jobId: string) {
  return apiUrl(`/jobs/${encodeURIComponent(jobId)}/events`)
}