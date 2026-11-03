// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/** One candidate document of the rerank demo, as its own input box. */
export interface CandidateDocument {
  /** Tells the boxes apart while they are added, edited and removed. */
  id: string
  text: string
}

// A plain counter outside any hook: ids only need to be unique for the page.
let nextDocumentId = 0

export function newDocument(text = ''): CandidateDocument {
  nextDocumentId += 1
  return { id: `doc-${nextDocumentId}`, text }
}

/** What a rerank request is sent with: the filled boxes and their numbers. */
export interface SubmittedDocuments {
  texts: string[]
  /** The 1-based box number of each text: empty boxes are skipped. */
  numbers: number[]
}

export function submittedDocuments(
  documents: CandidateDocument[],
): SubmittedDocuments {
  const texts: string[] = []
  const numbers: number[] = []
  documents.forEach((doc, i) => {
    const text = doc.text.trim()
    if (!text) return
    texts.push(text)
    numbers.push(i + 1)
  })
  return { texts, numbers }
}

/** How a document moved from where it was entered to where it ranked. */
export function rankMovement(original: number, ranked: number): string {
  const delta = original - ranked
  if (delta > 0) return `Up ${delta}`
  if (delta < 0) return `Down ${-delta}`
  return 'Same place'
}
