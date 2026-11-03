// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { UIMessage } from 'ai'
import { z } from 'zod'
import { logger } from '@/lib/logger'
import { getWorkloadEndpoint } from '@/lib/workers/instance-lookup'

/** System prompt of a Text Generation chat answer, with knowledge-base passages when using RAG. */

const DEFAULT_SYSTEM_PROMPT = `You are a human-like conversational AI. 
Your goal is to communicate in a way that is natural, empathetic, and engaging. 
Prioritize clarity and warmth in your responses.
You only reply in plain natural language, Do not produce any HIGHLIGHT, Markdown format, programming codes, formatted structured output`

function createRAGSystemPrompt(context: string) {
  return `You are a helpful assistant that answers questions based on provided context.
Use the following pieces of retrieved context to answer the question.
If you don't know the answer from the context, say so honestly instead of making things up.
Always ground your responses in the provided context.

Context:
${context}

Answer the user's question based on the context above.`
}

const RAG_CONTEXT_PLACEHOLDER = /\{\s*context\s*\}/gi

/** `customPrompt` with the context at its `{context}` placeholder, else appended. */
function injectRAGContext(customPrompt: string, context: string): string {
  const replaced = customPrompt.replace(RAG_CONTEXT_PLACEHOLDER, context)
  if (replaced !== customPrompt) return replaced
  return `${customPrompt}\n\nContext:\n${context}`
}

const SIBLING_ADDRESS = {
  embeddings: /^\/api\/embeddings@[a-z0-9_-]+\/v1$/,
  rerank: /^\/api\/rerank@[a-z0-9_-]+\/v1$/,
} as const

/** Only an instance's app address (`siblingWorkerAddress`): the vector database calls it. */
const siblingAddress = (type: keyof typeof SIBLING_ADDRESS) =>
  z.string().regex(SIBLING_ADDRESS[type])

/** The Embeddings (and Rerank) services a knowledge base's documents were embedded with. */
export const vectordbConfigSchema = z.object({
  embeddingUrl: siblingAddress('embeddings'),
  embeddingModel: z.string().min(1),
  rerankerUrl: siblingAddress('rerank').optional(),
  rerankerModel: z.string().min(1).optional(),
})

type VectorDbConfig = z.infer<typeof vectordbConfigSchema>

function configuredFor(current: unknown, wanted: VectorDbConfig): boolean {
  if (!current || typeof current !== 'object') return false
  const config = current as Record<string, unknown>
  return (
    config.embedding_url === wanted.embeddingUrl &&
    config.embedding_model === wanted.embeddingModel &&
    (config.reranker_url ?? undefined) === wanted.rerankerUrl &&
    (config.reranker_model ?? undefined) === wanted.rerankerModel
  )
}

/**
 * Points the vector database at `wanted` unless already set: the worker keeps one configuration for
 * every caller, and a question must be embedded by its knowledge base's model.
 */
async function ensureVectorDbConfig(baseUrl: string, wanted: VectorDbConfig) {
  const current = await fetch(new URL(`${baseUrl}/v1/config`))
  if (current.ok && configuredFor(await current.json(), wanted)) return
  const response = await fetch(new URL(`${baseUrl}/v1/configure`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      embedding_url: wanted.embeddingUrl,
      embedding_model: wanted.embeddingModel,
      reranker_url: wanted.rerankerUrl ?? null,
      reranker_model: wanted.rerankerModel ?? null,
    }),
  })
  if (!response.ok) {
    throw new Error(
      `Configuring the vector database failed: ${response.status}`,
    )
  }
}

/** The passages a knowledge base returns for `query`, joined; null when none. */
async function fetchRAGContext(
  knowledgeBaseId: number,
  query: string,
  topK: number,
  vectordbInstanceKey?: string,
  vectordbConfig?: VectorDbConfig,
): Promise<string | null> {
  let vectordb: { baseUrl: string }
  try {
    vectordb = await getWorkloadEndpoint('vectordb', vectordbInstanceKey)
  } catch (error) {
    logger.error('RAG search skipped — vector database unavailable:', error)
    return null
  }

  if (vectordbConfig) {
    try {
      await ensureVectorDbConfig(vectordb.baseUrl, vectordbConfig)
    } catch (error) {
      logger.error(
        'RAG search skipped — vector database not configured:',
        error,
      )
      return null
    }
  }

  try {
    const response = await fetch(
      new URL(`${vectordb.baseUrl}/v1/kb/${knowledgeBaseId}/search`),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query,
          search_type: 'similarity',
          top_k: topK,
          top_n: 3,
        }),
      },
    )
    if (!response.ok) {
      logger.error(`RAG search failed: ${response.status}`)
      return null
    }

    const results: unknown = await response.json()
    if (!Array.isArray(results) || results.length === 0) return null
    return results
      .map((r: unknown) =>
        r && typeof r === 'object' && 'content' in r ? String(r.content) : '',
      )
      .filter(Boolean)
      .join('\n\n---\n\n')
  } catch (error) {
    logger.error('RAG context fetch error:', error)
    return null
  }
}

function getLastUserText(messages: UIMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') {
      return messages[i].parts
        .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
        .map((p) => p.text)
        .join('')
    }
  }
  return ''
}

/**
 * With a knowledge base, its passages for the last user message go into the user's prompt (at
 * `{context}`) or a grounded default; a search that finds nothing leaves the prompt as is.
 */
export async function buildChatSystemPrompt({
  customPrompt,
  messages,
  knowledgeBaseId,
  topK = 4,
  vectordbInstanceKey,
  vectordbConfig,
}: {
  customPrompt?: string
  messages: UIMessage[]
  knowledgeBaseId?: number
  topK?: number
  vectordbInstanceKey?: string
  /** What to search with; the worker's current configuration when unset. */
  vectordbConfig?: VectorDbConfig
}): Promise<string> {
  const trimmed = customPrompt?.trim()
  const base = trimmed || DEFAULT_SYSTEM_PROMPT
  if (knowledgeBaseId == null) return base

  const query = getLastUserText(messages)
  if (!query) return base
  const context = await fetchRAGContext(
    knowledgeBaseId,
    query,
    topK,
    vectordbInstanceKey,
    vectordbConfig,
  )
  if (!context) return base
  return trimmed
    ? injectRAGContext(trimmed, context)
    : createRAGSystemPrompt(context)
}
