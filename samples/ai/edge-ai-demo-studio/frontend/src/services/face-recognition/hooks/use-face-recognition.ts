// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationOptions,
} from '@tanstack/react-query'

// ── Types (mirror workers/face-recognition responses) ───────────────────────

export interface FaceSimilarity {
  person_id: string
  name: string
  similarity: number
}

/** One detected face with its gallery match. `box` is [x, y, w, h] pixels. */
export interface RecognizedFace {
  box: [number, number, number, number]
  score: number
  landmarks: [number, number][]
  /** Best gallery candidate (null when the gallery is empty). */
  match: FaceSimilarity | null
  /** True when the best similarity clears the pipeline's threshold. */
  matched: boolean
  /** All gallery candidates, sorted by similarity descending. */
  similarities: FaceSimilarity[]
}

export interface RecognizeResult {
  elapsed_ms: number
  image: { width: number; height: number }
  gallery_size: number
  model: string
  label: string
  runtime: string
  threshold: number
  detect_ms: number
  embed_ms: number
  num_faces: number
  faces: RecognizedFace[]
}

export interface GalleryPerson {
  id: string
  name: string
  num_images: number
  /** Base64 JPEG data URLs of the enrolled face crops. */
  thumbnails: string[]
}

export interface GalleryResponse {
  persons: GalleryPerson[]
}

export interface EnrollRequest {
  name: string
  files: File[]
}

export interface EnrollFileStatus {
  file: string
  error?: string
}

export interface EnrollResponse {
  person: GalleryPerson
  files: EnrollFileStatus[]
}

// ── Fetchers ────────────────────────────────────────────────────────────────

const BASE = '/api/face-recognition'

async function parseOrThrow<T>(res: Response, fallback: string): Promise<T> {
  const data = (await res.json()) as T & { detail?: string; error?: string }
  if (!res.ok) {
    throw new Error(data.detail ?? data.error ?? fallback)
  }
  return data
}

export async function fetchGallery(): Promise<GalleryResponse> {
  const url = new URL(`${BASE}/gallery`, window.location.origin)
  const res = await fetch(url)
  return parseOrThrow(res, 'Failed to load gallery')
}

export async function enrollPerson(
  req: EnrollRequest,
): Promise<EnrollResponse> {
  const formData = new FormData()
  formData.append('name', req.name)
  for (const file of req.files) formData.append('files', file)
  const url = new URL(`${BASE}/gallery`, window.location.origin)
  const res = await fetch(url, { method: 'POST', body: formData })
  return parseOrThrow(res, 'Failed to enroll person')
}

export async function deletePerson(personId: string): Promise<GalleryResponse> {
  const url = new URL(`${BASE}/gallery/${personId}`, window.location.origin)
  const res = await fetch(url, { method: 'DELETE' })
  return parseOrThrow(res, 'Failed to delete person')
}

export async function clearGallery(): Promise<GalleryResponse> {
  const url = new URL(`${BASE}/gallery`, window.location.origin)
  const res = await fetch(url, { method: 'DELETE' })
  return parseOrThrow(res, 'Failed to clear gallery')
}

export async function recognizeImage(file: File): Promise<RecognizeResult> {
  const formData = new FormData()
  formData.append('file', file)
  const url = new URL(`${BASE}/recognize`, window.location.origin)
  const res = await fetch(url, {
    method: 'POST',
    body: formData,
  })
  return parseOrThrow(res, 'Recognition request failed')
}

// ── Hooks ───────────────────────────────────────────────────────────────────

const GALLERY_KEY = ['face-recognition', 'gallery']

export function useGallery(enabled = true) {
  return useQuery<GalleryResponse, Error>({
    queryKey: GALLERY_KEY,
    queryFn: fetchGallery,
    enabled,
  })
}

/** Invalidates the gallery query after any gallery mutation settles. */
function useGalleryMutation<TData, TVariables>(
  mutationFn: (variables: TVariables) => Promise<TData>,
  options?: UseMutationOptions<TData, Error, TVariables>,
) {
  const queryClient = useQueryClient()
  return useMutation<TData, Error, TVariables>({
    mutationFn,
    ...options,
    onSettled: (...args) => {
      queryClient.invalidateQueries({ queryKey: GALLERY_KEY })
      options?.onSettled?.(...args)
    },
  })
}

export function useEnroll(
  options?: UseMutationOptions<EnrollResponse, Error, EnrollRequest>,
) {
  return useGalleryMutation(enrollPerson, options)
}

export function useDeletePerson(
  options?: UseMutationOptions<GalleryResponse, Error, string>,
) {
  return useGalleryMutation(deletePerson, options)
}

export function useClearGallery(
  options?: UseMutationOptions<GalleryResponse, Error, void>,
) {
  return useGalleryMutation(() => clearGallery(), options)
}

export function useRecognize(
  options?: UseMutationOptions<RecognizeResult, Error, File>,
) {
  return useMutation<RecognizeResult, Error, File>({
    mutationFn: recognizeImage,
    ...options,
  })
}
