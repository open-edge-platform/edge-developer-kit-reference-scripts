// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/** A `base64` embedding: little-endian float32 values. */
function decodeBase64Embedding(embedding: string): number[] {
  const binary = atob(embedding)
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))

  if (bytes.byteLength % 4 !== 0) {
    throw new Error('Invalid base64 embedding payload length')
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const values: number[] = []
  for (let i = 0; i < bytes.byteLength; i += 4) {
    values.push(view.getFloat32(i, true))
  }

  return values
}

/** Decodes a `float` or `base64` embedding; `null` when a base64 payload cannot be decoded. */
export function decodeEmbedding(embedding: number[] | string): number[] | null {
  if (typeof embedding !== 'string') return embedding
  try {
    return decodeBase64Embedding(embedding)
  } catch {
    return null
  }
}

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB)
  return denom === 0 ? 0 : dot / denom
}

export function vectorNorm(values: number[]): number {
  return Math.sqrt(values.reduce((sum, v) => sum + v * v, 0))
}

export type SimilarityLevel = 'High' | 'Moderate' | 'Low'

export function similarityLevel(score: number): SimilarityLevel {
  if (score >= 0.7) return 'High'
  if (score >= 0.4) return 'Moderate'
  return 'Low'
}
