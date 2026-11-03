// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { plural } from '@/lib/browser/format'
import { type CandidateDocument, newDocument } from '../lib/documents'

/** Most documents the demo takes; the worker scores every one. */
const MAX_DOCUMENTS = 20

/** One numbered box per document, so boundaries never hinge on blank lines; results cite the numbers. */
export function CandidateDocuments({
  documents,
  onChange,
  disabled,
}: {
  documents: CandidateDocument[]
  onChange: (documents: CandidateDocument[]) => void
  disabled?: boolean
}) {
  const filled = documents.filter((d) => d.text.trim()).length

  const update = (id: string, text: string) =>
    onChange(documents.map((d) => (d.id === id ? { ...d, text } : d)))

  return (
    <fieldset className="min-w-0 space-y-3" data-testid="rerank-documents">
      <legend className="text-foreground text-sm font-medium">
        Candidate documents
      </legend>
      <p id="rerank-documents-hint" className="text-muted-foreground text-xs">
        One document per box. The reranker orders them by relevance to the
        query; empty boxes are skipped.
      </p>
      <ol className="space-y-2">
        {documents.map((doc, i) => {
          const number = i + 1
          const inputId = `rerank-document-${doc.id}`
          return (
            <li key={doc.id} className="flex items-start gap-2">
              <label
                htmlFor={inputId}
                className="text-muted-foreground bg-muted/40 mt-1.5 flex h-7 min-w-7 shrink-0 items-center justify-center rounded-md px-1.5 font-mono text-xs font-medium"
              >
                <span className="sr-only">Document </span>
                {number}
              </label>
              <Textarea
                id={inputId}
                data-testid={`rerank-document-input-${number}`}
                aria-describedby="rerank-documents-hint"
                value={doc.text}
                onChange={(e) => update(doc.id, e.target.value)}
                placeholder="Document text…"
                rows={2}
                disabled={disabled}
                className="bg-muted/30 min-h-0 flex-1 resize-none text-sm"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="mt-0.5 shrink-0"
                aria-label={`Remove document ${number}`}
                disabled={disabled || documents.length === 1}
                onClick={() =>
                  onChange(documents.filter((d) => d.id !== doc.id))
                }
              >
                <X aria-hidden="true" className="h-4 w-4" />
              </Button>
            </li>
          )
        })}
      </ol>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-testid="rerank-add-document"
          disabled={disabled || documents.length >= MAX_DOCUMENTS}
          onClick={() => onChange([...documents, newDocument()])}
        >
          <Plus aria-hidden="true" className="h-3.5 w-3.5" />
          Add document
        </Button>
        <p
          className="text-muted-foreground text-xs"
          data-testid="rerank-documents-count"
        >
          {plural(filled, 'document')} to rank
          {documents.length >= MAX_DOCUMENTS && ` · limit of ${MAX_DOCUMENTS}`}
        </p>
      </div>
    </fieldset>
  )
}
