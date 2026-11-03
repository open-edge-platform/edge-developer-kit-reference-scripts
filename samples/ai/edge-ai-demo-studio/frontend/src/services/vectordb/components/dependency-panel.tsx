// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Brain, CheckCircle2, Clock, ListOrdered } from 'lucide-react'
import type { ReactNode } from 'react'
import { ServiceLink } from '@/components/common/service-link'
import { TruncatedText } from '@/components/common/truncated-text'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { STATE_LABEL } from '@/lib/instances/service-presentation'
import { getServiceModelName } from '@/services/common/get-service-model'
import type { ServiceInstance } from '@/services/types'
import {
  NO_RERANKER,
  type VectorDbDependencies,
} from '../hooks/use-vectordb-dependencies'
import {
  instanceKeyOfSiblingAddress,
  workerUsesSiblings,
} from '../hooks/use-vectordb-siblings'
import type { VectorDbConfig } from '../types'

/** The model an instance runs and its state, in one line. */
function InstanceFacts({ instance }: { instance: ServiceInstance }) {
  const model = getServiceModelName(instance)
  return (
    <span className="text-muted-foreground flex min-w-0 items-baseline gap-1 text-xs">
      {model && (
        <TruncatedText text={model} className="text-foreground max-w-56" />
      )}
      <span className="shrink-0">
        {model ? '· ' : ''}
        {STATE_LABEL[instance.status]}
      </span>
    </span>
  )
}

/** A selector when there is a choice, else the instance's name; then its model and state. */
function DependencyField({
  id,
  label,
  instances,
  value,
  onChange,
  noneLabel,
  missing,
}: {
  id: string
  label: ReactNode
  instances: ServiceInstance[]
  value: string
  onChange: (key: string) => void
  /** Offered first when the dependency is optional. */
  noneLabel?: string
  /** Shown when no instance exists. */
  missing: ReactNode
}) {
  const selected = instances.find((i) => i.instanceKey === value)
  const hasChoice =
    instances.length > 0 && instances.length + (noneLabel ? 1 : 0) > 1
  return (
    <div className="min-w-0 space-y-1.5">
      <Label
        htmlFor={hasChoice ? id : undefined}
        className="text-muted-foreground text-xs"
      >
        {label}
      </Label>
      {instances.length === 0 ? (
        <p className="text-muted-foreground text-xs">{missing}</p>
      ) : hasChoice ? (
        <Select value={value} onValueChange={onChange}>
          <SelectTrigger id={id} className="w-full text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {noneLabel && (
              <SelectItem value={NO_RERANKER} className="text-xs">
                {noneLabel}
              </SelectItem>
            )}
            {instances.map((instance) => (
              <SelectItem
                key={instance.instanceKey}
                value={instance.instanceKey}
                className="text-xs"
              >
                {instance.label} ({STATE_LABEL[instance.status]})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <p className="text-foreground text-sm font-medium">
          <TruncatedText text={instances[0].label} />
        </p>
      )}
      {selected && <InstanceFacts instance={selected} />}
    </div>
  )
}

/** What the worker embeds and ranks with now, from its configuration. */
function workerUsesLabel(
  config: VectorDbConfig | undefined,
  instances: ServiceInstance[],
): string | null {
  if (!config?.embedding_url) return null
  const key = instanceKeyOfSiblingAddress(config.embedding_url)
  const instance = instances.find((i) => i.instanceKey === key)
  return `${instance?.label ?? config.embedding_url} (${config.embedding_model ?? 'model not set'})`
}

/**
 * The Embeddings (required) and Rerank (optional) instances this Vector Database uses, and whether
 * the worker already has them; otherwise they are applied before the next upload, chunk or search.
 */
export function DependencyPanel({
  dependencies,
  workerConfig,
}: {
  dependencies: VectorDbDependencies
  workerConfig: VectorDbConfig | undefined
}) {
  const {
    siblings,
    embeddingInstances,
    rerankInstances,
    embeddingsKey,
    rerankChoice,
    chooseEmbeddings,
    chooseReranker,
  } = dependencies
  const applied = workerUsesSiblings(workerConfig, siblings)
  const current = workerUsesLabel(workerConfig, embeddingInstances)

  return (
    <Card className="gap-3 py-4" data-testid="vectordb-dependencies">
      <CardHeader className="px-4">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Brain aria-hidden="true" className="text-primary h-4 w-4" />
          Embedding and reranking
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 px-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <DependencyField
            id="vectordb-embeddings-instance"
            label="Embeddings instance"
            instances={embeddingInstances}
            value={embeddingsKey ?? ''}
            onChange={chooseEmbeddings}
            missing={
              <>
                No Embeddings instance.{' '}
                <ServiceLink
                  serviceType="embeddings"
                  className="text-primary underline-offset-2 hover:underline"
                >
                  Add one
                </ServiceLink>{' '}
                to embed and search.
              </>
            }
          />
          <DependencyField
            id="vectordb-reranker-instance"
            label={
              <>
                <ListOrdered aria-hidden="true" className="h-3 w-3" />
                Reranker (optional)
              </>
            }
            instances={rerankInstances}
            value={rerankChoice}
            onChange={chooseReranker}
            noneLabel="No reranking"
            missing="No Rerank instance: results keep their similarity order."
          />
        </div>

        <p
          className="text-muted-foreground flex items-start gap-1.5 text-xs"
          data-testid="vectordb-dependencies-applied"
          role="status"
        >
          {applied ? (
            <>
              <CheckCircle2
                aria-hidden="true"
                className="text-success mt-0.5 h-3.5 w-3.5 shrink-0"
              />
              The worker uses these.
            </>
          ) : (
            <>
              <Clock
                aria-hidden="true"
                className="mt-0.5 h-3.5 w-3.5 shrink-0"
              />
              <span>
                Applied before the next embedding, added chunk or search
                {current ? `; the worker uses ${current} until then` : ''}.
              </span>
            </>
          )}
        </p>
        <p className="text-muted-foreground text-xs">
          Search compares vectors made by the same model: keep one embedding
          model per knowledge base, or embed its documents again after
          switching.
        </p>
      </CardContent>
    </Card>
  )
}
