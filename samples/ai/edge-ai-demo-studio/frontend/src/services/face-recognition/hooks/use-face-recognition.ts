// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationOptions,
} from '@tanstack/react-query'
import { requireApiBase } from '@/lib/browser/api-base'
import { fetchJson } from '@/lib/browser/fetch-json'
import { fetchWork } from '@/services/common/metrics/work'

// Types mirror the face-recognition worker's responses.

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

// `apiBase` is `/api/<type>@<instanceId>`.

function fetchGallery(apiBase: string): Promise<GalleryResponse> {
  return fetchJson(`${apiBase}/gallery`, {
    errorMessage: 'Failed to load gallery',
  })
}

function enrollPerson(
  apiBase: string,
  req: EnrollRequest,
): Promise<EnrollResponse> {
  const formData = new FormData()
  formData.append('name', req.name)
  for (const file of req.files) formData.append('files', file)
  return fetchJson(`${apiBase}/gallery`, {
    method: 'POST',
    body: formData,
    errorMessage: 'Failed to enroll person',
  })
}

function deletePerson(
  apiBase: string,
  personId: string,
): Promise<GalleryResponse> {
  return fetchJson(`${apiBase}/gallery/${encodeURIComponent(personId)}`, {
    method: 'DELETE',
    errorMessage: 'Failed to delete person',
  })
}

function clearGallery(apiBase: string): Promise<GalleryResponse> {
  return fetchJson(`${apiBase}/gallery`, {
    method: 'DELETE',
    errorMessage: 'Failed to clear gallery',
  })
}

function recognizeImage(apiBase: string, file: File): Promise<RecognizeResult> {
  const formData = new FormData()
  formData.append('file', file)
  // One frame per call; enrolling faces in the gallery is not the benchmark.
  return fetchWork(
    apiBase,
    '/recognize',
    {
      method: 'POST',
      body: formData,
      errorMessage: 'Recognition request failed',
    },
    () => ({ items: 1 }),
  )
}

const galleryKey = (apiBase: string | undefined) =>
  ['face-recognition', 'gallery', apiBase] as const

export function useGallery(apiBase: string | undefined) {
  return useQuery<GalleryResponse, Error>({
    queryKey: galleryKey(apiBase),
    queryFn: () => {
      requireApiBase(apiBase, 'Face Recognition')
      return fetchGallery(apiBase)
    },
    enabled: Boolean(apiBase),
  })
}

/** Invalidates the gallery query after any gallery mutation settles. */
function useGalleryMutation<TData, TVariables>(
  apiBase: string | undefined,
  mutationFn: (apiBase: string, variables: TVariables) => Promise<TData>,
  options?: UseMutationOptions<TData, Error, TVariables>,
) {
  const queryClient = useQueryClient()
  return useMutation<TData, Error, TVariables>({
    mutationFn: (variables) => {
      requireApiBase(apiBase, 'Face Recognition')
      return mutationFn(apiBase, variables)
    },
    ...options,
    onSettled: (...args) => {
      queryClient.invalidateQueries({ queryKey: galleryKey(apiBase) })
      options?.onSettled?.(...args)
    },
  })
}

export function useEnroll(
  apiBase: string | undefined,
  options?: UseMutationOptions<EnrollResponse, Error, EnrollRequest>,
) {
  return useGalleryMutation(apiBase, enrollPerson, options)
}

export function useDeletePerson(
  apiBase: string | undefined,
  options?: UseMutationOptions<GalleryResponse, Error, string>,
) {
  return useGalleryMutation(apiBase, deletePerson, options)
}

export function useClearGallery(
  apiBase: string | undefined,
  options?: UseMutationOptions<GalleryResponse, Error, void>,
) {
  return useGalleryMutation(apiBase, (base) => clearGallery(base), options)
}

export function useRecognize(
  apiBase: string | undefined,
  options?: UseMutationOptions<RecognizeResult, Error, File>,
) {
  return useMutation<RecognizeResult, Error, File>({
    mutationFn: (file) => {
      requireApiBase(apiBase, 'Face Recognition')
      return recognizeImage(apiBase, file)
    },
    ...options,
  })
}
