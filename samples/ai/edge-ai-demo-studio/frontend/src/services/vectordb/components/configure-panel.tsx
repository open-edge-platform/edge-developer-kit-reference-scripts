// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Database, Server } from 'lucide-react'
import { ConfigSection } from '@/components/configure/config-section'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useDraftSummary } from '@/components/services/new-instance-summary'
import { useGetService } from '@/context/service-status-context'
import { useDraftState } from '@/hooks/use-draft-state'
import { getServiceMetadata } from '@/lib/instances/service-metadata'
import { STATE_LABEL } from '@/lib/instances/service-presentation'
import { WorkerConfigurePanel } from '@/services/common/configure/worker-configure-panel'
import type { Service } from '@/services/types'
import type { VectorDbBackendId } from '../types'

const BACKEND_OPTIONS: {
  value: VectorDbBackendId
  label: string
  description: string
}[] = [
  {
    value: 'faiss',
    label: 'FAISS',
    description: 'On-disk index per knowledge base. No extra services.',
  },
  {
    value: 'pgvector',
    label: 'PostgreSQL + pgvector',
    description:
      'Vectors in PostgreSQL through the OEP document-ingestion pipeline. Uses an embedded PostgreSQL unless a connection string is given under Advanced settings.',
  },
]

function toBackend(value: string | undefined): VectorDbBackendId {
  return value === 'pgvector' ? 'pgvector' : 'faiss'
}

function isPgConnectionStringValid(value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed) return true
  return /^postgres(ql)?(\+psycopg)?:\/\/\S+$/i.test(trimmed)
}

/** Where a drafted setup keeps its vectors, for the New instance summary. */
function storageSummary(backend: VectorDbBackendId, external: boolean) {
  if (backend === 'faiss') return 'FAISS index on disk'
  return external
    ? 'PostgreSQL + pgvector, external server'
    : 'PostgreSQL + pgvector, embedded server'
}

/** The Text Embedding instance the worker embeds with: the primary one (running, else first). */
function useEmbeddingsSummary(): string {
  const embeddings = useGetService('embeddings')
  if (!embeddings?.added || !embeddings.label) {
    return 'Text Embedding, not added yet'
  }
  return `${embeddings.label} (${STATE_LABEL[embeddings.status].toLowerCase()})`
}

/**
 * Vector Database runtime settings: the shared worker panel with the storage backend in place of
 * the model (the worker has none) and pgvector's external server under Advanced settings.
 */
export function VectorDbConfigurePanel({ service }: { service: Service }) {
  const metadata = getServiceMetadata(service)
  const current = {
    backend: toBackend(metadata.vectorDbBackend),
    pgConnectionString: metadata.pgConnectionString ?? '',
  }
  const { draft, setDraft, reset } = useDraftState(current)
  const pgConnectionString = draft.pgConnectionString.trim()
  const pgConnectionValid = isPgConnectionStringValid(draft.pgConnectionString)

  const currentBackendLabel =
    BACKEND_OPTIONS.find((o) => o.value === current.backend)?.label ??
    current.backend

  const embeddingsSummary = useEmbeddingsSummary()
  useDraftSummary({
    rows: [
      {
        label: 'Storage',
        value: storageSummary(draft.backend, pgConnectionString !== ''),
      },
      { label: 'Embeddings', value: embeddingsSummary },
    ],
    downloads: [],
    // FAISS needs nothing beyond the shared Python environment; pgvector's
    // ingestion service is fetched on its first start (see start.sh).
    firstStartNote:
      draft.backend === 'pgvector'
        ? 'There is no model to download, but the first start fetches the Open Edge Platform document-ingestion service, which can take several minutes.'
        : undefined,
  })

  return (
    <WorkerConfigurePanel
      service={service}
      clearModelCache={false}
      statusItems={[
        { label: 'Storage backend', value: currentBackendLabel },
        ...(current.backend === 'pgvector'
          ? [
              {
                label: 'PostgreSQL',
                value: current.pgConnectionString ? 'External' : 'Embedded',
              },
            ]
          : []),
      ]}
      extension={{
        changed:
          draft.backend !== current.backend ||
          pgConnectionString !== current.pgConnectionString.trim(),
        valid: pgConnectionValid,
        reset,
        config: {
          metadata: {
            vectorDbBackend: draft.backend,
            pgConnectionString: pgConnectionString || null,
          },
        },
      }}
      modelSection={
        <ConfigSection title="Storage">
          <div className="space-y-2">
            <Label
              htmlFor="vectordb-cfg-backend"
              className="text-muted-foreground text-xs"
            >
              <Database aria-hidden="true" className="mr-1 h-3 w-3" />
              Vector store backend
            </Label>
            <Select
              value={draft.backend}
              onValueChange={(v) => setDraft({ backend: toBackend(v) })}
            >
              <SelectTrigger
                data-testid="vectordb-cfg-backend"
                id="vectordb-cfg-backend"
                className="w-full text-xs"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {BACKEND_OPTIONS.map((o) => (
                  <SelectItem
                    key={o.value}
                    value={o.value}
                    textValue={o.label}
                    className="text-xs"
                  >
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-muted-foreground text-xs">
              {
                BACKEND_OPTIONS.find((o) => o.value === draft.backend)
                  ?.description
              }
            </p>
          </div>

          <p className="text-muted-foreground text-xs">
            Knowledge bases are not migrated between backends: each backend
            keeps its own vectors.
          </p>
        </ConfigSection>
      }
      advanced={
        draft.backend === 'pgvector' && (
          <ConfigSection title="PostgreSQL" className="space-y-2">
            <Label
              htmlFor="vectordb-cfg-pg-connection"
              className="text-muted-foreground text-xs"
            >
              <Server aria-hidden="true" className="mr-1 h-3 w-3" />
              Connection string (optional)
            </Label>
            <Input
              data-testid="vectordb-cfg-pg-connection"
              id="vectordb-cfg-pg-connection"
              className="text-xs"
              placeholder="PostgreSQL connection URL"
              value={draft.pgConnectionString}
              onChange={(e) => setDraft({ pgConnectionString: e.target.value })}
              spellCheck={false}
              autoComplete="off"
              aria-invalid={!pgConnectionValid || undefined}
              aria-describedby={
                pgConnectionValid ? undefined : 'vectordb-cfg-pg-error'
              }
            />
            <p className="text-muted-foreground text-xs">
              Leave empty to use the embedded PostgreSQL server started with the
              worker (stored under the worker&apos;s data directory). An
              external server needs the <code>vector</code> extension available.
            </p>
            {!pgConnectionValid && (
              <p
                id="vectordb-cfg-pg-error"
                className="text-destructive text-xs"
              >
                Must be a PostgreSQL URL starting with postgresql://
              </p>
            )}
          </ConfigSection>
        )
      }
    />
  )
}
