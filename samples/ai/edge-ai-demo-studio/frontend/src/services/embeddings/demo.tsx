// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import {
  BarChart3,
  ChevronDown,
  Fingerprint,
  Info,
  Loader2,
  Play,
} from 'lucide-react'
import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Textarea } from '@/components/ui/textarea'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { engines } from '@/engines/registry'
import { cn } from '@/lib/utils'
import { DemoParameterSidebar } from '@/services/common/demo/components/demo-parameter-sidebar'
import { Service } from '../types'
import { useEmbed } from './hooks'
import { useEmbeddingsParams } from './hooks/use-params'

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

function toNumericEmbedding(embedding: number[] | string): number[] {
  return typeof embedding === 'string'
    ? decodeBase64Embedding(embedding)
    : embedding
}

function tryNumericEmbedding(embedding: number[] | string): number[] | null {
  try {
    return toNumericEmbedding(embedding)
  } catch {
    return null
  }
}

function cosineSimilarity(a: number[], b: number[]): number {
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

function getSimilarityLevel(score: number) {
  if (score >= 0.7) {
    return {
      label: 'High',
      barColor: 'bg-primary',
      badgeVariant: 'default' as const,
    }
  }
  if (score >= 0.4) {
    return {
      label: 'Moderate',
      barColor: 'bg-secondary',
      badgeVariant: 'secondary' as const,
    }
  }
  return {
    label: 'Low',
    barColor: 'bg-muted-foreground/40',
    badgeVariant: 'outline' as const,
  }
}

export function EmbeddingDemo({ service }: { service: Service }) {
  const [input, setInput] = useState(
    'Intel OpenVINO provides hardware-optimized AI inference.',
  )
  const [referenceTextsInput, setReferenceTextsInput] = useState(
    [
      'AI inference optimization',
      'Cloud deployment guide',
      'Cooking recipes collection',
    ].join('\n'),
  )
  const [showDetails, setShowDetails] = useState(false)
  const [submittedReferenceTexts, setSubmittedReferenceTexts] = useState<
    string[]
  >([])
  const { values: embeddingsValues, params } = useEmbeddingsParams()
  const engine = engines[service.engine ?? 'default']
  const modelConfig = {
    name: service.currentModel ?? service.defaultModel?.name ?? '',
    device: service.currentDevice ?? service.defaultModel?.device ?? '',
    backend: service.currentBackend ?? service.defaultModel?.backend,
    quant: service.currentQuant ?? service.defaultModel?.quant,
  }
  const model = engine.getModelName(modelConfig, true)
  const embedMutation = useEmbed(service.id, model)

  const embedding = embedMutation.data?.data?.[0]?.embedding
    ? tryNumericEmbedding(embedMutation.data.data[0].embedding)
    : null
  const embeddingDecodeError =
    embedMutation.data?.data?.[0]?.embedding && !embedding
      ? 'Failed to decode embedding response for selected encoding format.'
      : null
  const dims = embedding?.length ?? 0
  const norm = embedding
    ? Math.sqrt(embedding.reduce((s, v) => s + v * v, 0))
    : 0

  const similarityMutation = useEmbed(service.id, model)
  const referenceTexts = referenceTextsInput
    .split('\n')
    .map((text) => text.trim())
    .filter(Boolean)

  const handleEmbed = () => {
    const textsToCompare = referenceTexts
    setSubmittedReferenceTexts(textsToCompare)
    embedMutation.mutate(
      { input: [input], encodingFormat: embeddingsValues.encodingFormat },
      {
        onSuccess: () => {
          if (textsToCompare.length > 0) {
            similarityMutation.mutate({
              input: textsToCompare,
              encodingFormat: embeddingsValues.encodingFormat,
            })
          }
        },
      },
    )
  }

  const similarityResults =
    embedding && similarityMutation.data?.data
      ? similarityMutation.data.data
          .map((item, i) => {
            const candidate = tryNumericEmbedding(item.embedding)
            if (!candidate) {
              return null
            }
            return {
              text: submittedReferenceTexts[i] ?? `Reference ${i + 1}`,
              score: cosineSimilarity(embedding, candidate),
            }
          })
          .filter((item): item is { text: string; score: number } => !!item)
      : []

  return (
    <div className="flex flex-col gap-6 xl:flex-row">
      <div className="min-w-0 flex-1 space-y-6">
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="space-y-2">
              <p className="text-foreground text-sm font-medium">
                Text to Embed
              </p>
              <Textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Enter text to generate embeddings..."
                rows={5}
                className="bg-muted/30 resize-none"
              />
              <p className="text-muted-foreground text-[11px]">
                {input.split(/\s+/).filter(Boolean).length} words
              </p>
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-1.5">
                <p className="text-foreground text-sm font-medium">
                  Compare With
                </p>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className="hover:bg-muted/20 flex h-5 w-5 items-center justify-center rounded"
                      aria-label="Info about reference texts"
                    >
                      <Info className="text-muted-foreground h-3.5 w-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent sideOffset={6}>
                    Enter texts to compare against your input. The AI will
                    measure how similar each one is in meaning.
                  </TooltipContent>
                </Tooltip>
              </div>
              <Textarea
                value={referenceTextsInput}
                onChange={(e) => setReferenceTextsInput(e.target.value)}
                placeholder="Enter reference texts, one per line..."
                rows={5}
                className="bg-muted/30 resize-none"
              />
              <p className="text-muted-foreground text-[11px]">
                {referenceTexts.length} text
                {referenceTexts.length === 1 ? '' : 's'} · one per line
              </p>
            </div>
          </div>

          <Button
            onClick={handleEmbed}
            disabled={embedMutation.isPending || !input.trim()}
            className="bg-primary hover:bg-primary-light w-full gap-2 text-white"
          >
            {embedMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Computing Embedding...
              </>
            ) : (
              <>
                <Play className="h-4 w-4" />
                Generate Embedding
              </>
            )}
          </Button>

          {embedMutation.isError && (
            <p className="text-destructive text-xs" data-testid="embed-error">
              {embedMutation.error.message}
            </p>
          )}

          {embeddingDecodeError && (
            <p
              className="text-destructive text-xs"
              data-testid="embed-decode-error"
            >
              {embeddingDecodeError}
            </p>
          )}
        </div>

        {!embedding && !embedMutation.isPending && (
          <div className="border-border bg-muted/5 flex flex-col items-center justify-center rounded-xl border border-dashed py-12">
            <div className="bg-muted/50 mb-4 flex h-12 w-12 items-center justify-center rounded-full">
              <Fingerprint className="text-muted-foreground h-6 w-6" />
            </div>
            <p className="text-muted-foreground text-sm font-medium">
              How does it work?
            </p>
            <p className="text-muted-foreground/70 mt-1 max-w-sm text-center text-xs leading-relaxed">
              Embeddings convert text into numeric vectors that capture meaning.
              Texts with similar meaning produce similar vectors, enabling
              semantic search and comparison.
            </p>
          </div>
        )}

        {(similarityResults.length > 0 || similarityMutation.isPending) && (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <div className="bg-primary/10 flex h-6 w-6 items-center justify-center rounded-md">
                <BarChart3 className="text-primary h-3.5 w-3.5" />
              </div>
              <p className="text-foreground text-sm font-medium">
                Semantic Similarity
              </p>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className="hover:bg-muted/20 flex h-5 w-5 items-center justify-center rounded"
                    aria-label="Info about similarity"
                  >
                    <Info className="text-muted-foreground h-3.5 w-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent sideOffset={6} className="max-w-64">
                  Cosine similarity measures how close two texts are in meaning.
                  Scores range from 0 (unrelated) to 1 (identical meaning).
                </TooltipContent>
              </Tooltip>
            </div>

            {similarityMutation.isPending && (
              <div className="border-border bg-muted/10 flex h-24 items-center justify-center rounded-xl border">
                <Loader2 className="text-primary h-6 w-6 animate-spin" />
              </div>
            )}

            {similarityResults.length > 0 && (
              <div className="space-y-3">
                {[...similarityResults]
                  .sort((a, b) => b.score - a.score)
                  .map((item) => {
                    const level = getSimilarityLevel(item.score)
                    return (
                      <div
                        key={item.text}
                        className="border-border bg-muted/10 space-y-2.5 rounded-xl border p-4"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <p className="text-foreground text-sm leading-snug">
                            &ldquo;{item.text}&rdquo;
                          </p>
                          <div className="flex shrink-0 items-center gap-2">
                            <Badge
                              variant={level.badgeVariant}
                              className="text-[10px]"
                            >
                              {level.label}
                            </Badge>
                            <span className="text-foreground min-w-[3ch] text-right font-mono text-lg font-semibold">
                              {(item.score * 100).toFixed(0)}
                              <span className="text-muted-foreground text-xs font-normal">
                                %
                              </span>
                            </span>
                          </div>
                        </div>
                        <div className="bg-muted h-2 overflow-hidden rounded-full">
                          <div
                            className={cn(
                              'h-full rounded-full transition-all duration-500',
                              level.barColor,
                            )}
                            style={{
                              width: `${Math.max(0, item.score) * 100}%`,
                            }}
                          />
                        </div>
                      </div>
                    )
                  })}
              </div>
            )}
          </div>
        )}

        {(embedding || embedMutation.isPending) && (
          <>
            <Separator />
            <div className="space-y-4">
              <button
                type="button"
                className="flex w-full items-center gap-2"
                onClick={() => setShowDetails(!showDetails)}
                aria-expanded={showDetails}
              >
                <div className="bg-muted flex h-6 w-6 items-center justify-center rounded-md">
                  <Fingerprint className="text-muted-foreground h-3.5 w-3.5" />
                </div>
                <p className="text-muted-foreground text-sm font-medium">
                  Under the Hood
                </p>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span
                      className="hover:bg-muted/20 flex h-5 w-5 items-center justify-center rounded"
                      aria-label="Info about embeddings"
                    >
                      <Info className="text-muted-foreground h-3.5 w-3.5" />
                    </span>
                  </TooltipTrigger>
                  <TooltipContent sideOffset={6} className="max-w-72">
                    The AI converts your text into a list of numbers called an
                    embedding vector — a mathematical fingerprint that captures
                    meaning. Similar texts produce similar fingerprints.
                  </TooltipContent>
                </Tooltip>
                <ChevronDown
                  className={cn(
                    'text-muted-foreground ml-auto h-4 w-4 transition-transform duration-200',
                    showDetails && 'rotate-180',
                  )}
                />
              </button>

              {showDetails && (
                <>
                  {embedMutation.isPending && (
                    <div className="flex h-32 items-center justify-center">
                      <Loader2 className="text-primary h-6 w-6 animate-spin" />
                    </div>
                  )}

                  {embedding && (
                    <>
                      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                        <div className="border-border bg-muted/10 rounded-lg border p-3">
                          <div className="flex items-center gap-1">
                            <p className="text-foreground font-mono text-lg font-semibold">
                              {dims}
                            </p>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span
                                  className="hover:bg-muted/20 flex h-4 w-4 items-center justify-center rounded"
                                  aria-label="Info about dimensions"
                                >
                                  <Info className="text-muted-foreground h-3 w-3" />
                                </span>
                              </TooltipTrigger>
                              <TooltipContent
                                sideOffset={6}
                                className="max-w-56"
                              >
                                The number of values in the vector. More
                                dimensions can capture finer shades of meaning.
                              </TooltipContent>
                            </Tooltip>
                          </div>
                          <p className="text-muted-foreground text-[11px]">
                            Dimensions
                          </p>
                        </div>
                        <div className="border-border bg-muted/10 rounded-lg border p-3">
                          <div className="flex items-center gap-1">
                            <p className="text-foreground font-mono text-lg font-semibold">
                              {norm.toFixed(2)}
                            </p>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span
                                  className="hover:bg-muted/20 flex h-4 w-4 items-center justify-center rounded"
                                  aria-label="Info about magnitude"
                                >
                                  <Info className="text-muted-foreground h-3 w-3" />
                                </span>
                              </TooltipTrigger>
                              <TooltipContent
                                sideOffset={6}
                                className="max-w-56"
                              >
                                The length of the vector. Normalized embeddings
                                have a magnitude close to 1.
                              </TooltipContent>
                            </Tooltip>
                          </div>
                          <p className="text-muted-foreground text-[11px]">
                            Magnitude
                          </p>
                        </div>
                        {embedMutation.data?.model && (
                          <div className="border-border bg-muted/10 col-span-2 rounded-lg border p-3 sm:col-span-1">
                            <p className="text-foreground truncate text-sm font-semibold">
                              {embedMutation.data.model}
                            </p>
                            <p className="text-muted-foreground text-[11px]">
                              Model
                            </p>
                          </div>
                        )}
                      </div>

                      <div className="border-border bg-muted/10 rounded-xl border p-4">
                        <p className="text-muted-foreground mb-3 text-xs">
                          Each cell is one number in the AI&apos;s
                          &ldquo;fingerprint&rdquo; for your text. Similar texts
                          produce similar color patterns.
                        </p>
                        <div className="grid grid-cols-16 gap-[2px]">
                          {embedding.slice(0, 192).map((val, i) => (
                            <div
                              key={`v-${i}`}
                              className="aspect-square rounded-[2px]"
                              style={{
                                backgroundColor:
                                  val >= 0
                                    ? `rgba(0, 104, 181, ${Math.min(1, Math.abs(val) * 5)})`
                                    : `rgba(239, 68, 68, ${Math.min(1, Math.abs(val) * 5)})`,
                              }}
                              title={`Value ${i + 1} of ${dims}: ${val.toFixed(4)}`}
                            />
                          ))}
                        </div>
                        <div className="text-muted-foreground mt-3 flex items-center justify-between text-[10px]">
                          <span>Showing 192 of {dims} values</span>
                          <span>
                            <span className="text-primary">■</span> Positive
                            <span className="text-destructive ml-1.5">
                              ■
                            </span>{' '}
                            Negative
                          </span>
                        </div>
                      </div>
                    </>
                  )}
                </>
              )}
            </div>
          </>
        )}
      </div>

      <div className="shrink-0 space-y-4 xl:w-72">
        <DemoParameterSidebar params={params} />
      </div>
    </div>
  )
}
