// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useState } from 'react'
import { cosineSimilarity, decodeEmbedding } from '../lib/embedding-math'
import { type EmbeddingInput, useEmbed } from './use-embed'

export interface SimilarityResult {
  /** Position among the references submitted. */
  index: number
  text: string
  score: number
}

/** What the references were compared with, as the person gave it. */
export type ComparisonSubject =
  { kind: 'text'; text: string } | { kind: 'image'; name: string }

/**
 * Embeds the subject, then the references, scoring each against it. A new comparison clears the
 * old scores so they never show against another subject or reference list.
 */
export function useEmbeddingComparison(
  apiBase: string | undefined,
  model: string,
) {
  const subject = useEmbed(apiBase, model)
  const references = useEmbed(apiBase, model)
  const { reset: resetReferences, mutate: embedReferences } = references
  // Snapshot of the latest comparison's inputs, which may change after a click.
  const [submitted, setSubmitted] = useState<string[]>([])
  const [subjectShown, setSubjectShown] = useState<ComparisonSubject | null>(
    null,
  )

  const compare = (
    input: EmbeddingInput,
    referenceTexts: string[],
    encodingFormat: string,
    shown: ComparisonSubject,
  ) => {
    resetReferences()
    setSubmitted(referenceTexts)
    setSubjectShown(shown)
    subject.mutate(
      { input: [input], encodingFormat },
      {
        onSuccess: () => {
          if (referenceTexts.length === 0) return
          embedReferences({ input: referenceTexts, encodingFormat })
        },
      },
    )
  }

  const raw = subject.data?.data?.[0]?.embedding
  const embedding = raw ? decodeEmbedding(raw) : null

  const results: SimilarityResult[] = []
  if (embedding && references.data) {
    references.data.data.forEach((item, index) => {
      const candidate = decodeEmbedding(item.embedding)
      const text = submitted[index]
      if (candidate && text !== undefined) {
        results.push({
          index,
          text,
          score: cosineSimilarity(embedding, candidate),
        })
      }
    })
  }

  return {
    compare,
    embedding,
    decodeError:
      raw && !embedding
        ? 'Failed to decode embedding response for selected encoding format.'
        : null,
    model: subject.data?.model,
    subject: subjectShown,
    isEmbedding: subject.isPending,
    error: subject.error ?? references.error,
    isComparing: references.isPending,
    results,
  }
}
