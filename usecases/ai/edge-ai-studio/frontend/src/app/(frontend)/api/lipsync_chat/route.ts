// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import {
  EMBEDDING_PORT,
  LIPSYNC_PORT,
  TEXT_GENERATION_PORT,
} from '@/lib/constants'
import { TTS_MODELS } from '@/lib/workloads/text-to-speech'
import { OVMSModelConfig } from '@/types/chat_model'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import {
  UIMessage,
  convertToModelMessages,
  extractReasoningMiddleware,
  streamText,
  wrapLanguageModel,
} from 'ai'

// Configuration constants
const createDefaultSystemPrompt = (language: string) => {
  return `/no_think You are a human-like conversational AI. 
Your goal is to communicate in a way that is natural, empathetic, and engaging. 
Prioritize clarity and warmth in your responses.
You always response in ${language} ISO 639-1 language code standard.
You only reply in plain natural language, Do not produce any HIGHLIGHT, Markdown format, programming codes, formatted structured output`
}

const CONFIG = {
  MIN_WORDS_PER_SENTENCE: 5,
  SEGMENTER_LOCALE: 'en' as const,
  EMOJI_REGEX:
    /[\u{1F600}-\u{1F64F}]|[\u{1F300}-\u{1F5FF}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/gu,
} as const

const removeEmojis = (text: string): string => {
  return text.replace(CONFIG.EMOJI_REGEX, '')
}

const countWords = (text: string): number => {
  return text
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 0).length
}

const isValidSentence = (text: string): boolean => {
  return text.trim().length > 0
}

// Sentence processor for handling sentence segmentation and buffering
class SentenceProcessor {
  private segmenter: Intl.Segmenter
  private accumulatedText = ''
  private sentenceBuffer = ''

  constructor(locale: string = CONFIG.SEGMENTER_LOCALE) {
    this.segmenter = new Intl.Segmenter(locale, { granularity: 'sentence' })
  }

  addTextChunk(chunk: string): string[] {
    this.accumulatedText += chunk
    const segments = Array.from(this.segmenter.segment(this.accumulatedText))
    const completedSentences: string[] = []

    // Process complete sentences (not the last segment which might be incomplete)
    for (let i = 0; i < segments.length - 1; i++) {
      const sentence = this.processSentence(segments[i].segment)
      if (sentence) {
        completedSentences.push(sentence)
      }
    }

    // Keep the last segment as it might be incomplete
    const lastSegment = segments[segments.length - 1]
    this.accumulatedText = lastSegment ? lastSegment.segment : ''

    return completedSentences
  }

  finishProcessing(): string[] {
    const completedSentences: string[] = []

    // Process any remaining accumulated text
    if (this.accumulatedText.trim()) {
      const segments = Array.from(this.segmenter.segment(this.accumulatedText))
      segments.forEach((segment) => {
        const sentence = this.processSentence(segment.segment)
        if (sentence) {
          completedSentences.push(sentence)
        }
      })
    }

    // Flush any remaining buffered content
    const finalSentence = this.flushBuffer()
    if (finalSentence) {
      completedSentences.push(finalSentence)
    }

    return completedSentences
  }

  private processSentence(sentence: string): string | null {
    const cleanSentence = removeEmojis(sentence).trim()

    if (!isValidSentence(cleanSentence)) {
      return null
    }

    // Add sentence to buffer
    this.sentenceBuffer += (this.sentenceBuffer ? ' ' : '') + cleanSentence

    const wordCount = countWords(this.sentenceBuffer)

    if (wordCount >= CONFIG.MIN_WORDS_PER_SENTENCE) {
      const result = this.sentenceBuffer
      this.sentenceBuffer = '' // Reset buffer after outputting
      return result
    }

    return null
  }

  private flushBuffer(): string | null {
    if (this.sentenceBuffer.trim()) {
      const result = this.sentenceBuffer.trim()
      this.sentenceBuffer = ''
      return result
    }
    return null
  }
}

async function getAvailableModel(): Promise<string> {
  const response = await fetch(
    `http://localhost:${TEXT_GENERATION_PORT}/v1/config`,
  )

  if (!response.ok) {
    throw new Error('Failed to fetch model configuration')
  }

  const models: OVMSModelConfig = await response.json()

  const availableModel = Object.keys(models).find((modelName) => {
    const model = models[modelName]
    return model.model_version_status[0]?.state === 'AVAILABLE'
  })

  if (!availableModel) {
    throw new Error('No available model found')
  }

  return availableModel
}

// Sentence handler for processing completed sentences
class SentenceHandler {
  static handleCompletedSentence(
    sentence: string,
    sessionId: string,
    voice: string,
    ttsModel: string,
  ): void {
    // const wordCount = countWords(sentence)
    // console.log(`Sentence (${wordCount} words):`, sentence)

    fetch(`http://localhost:${LIPSYNC_PORT}/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text: sentence,
        session_id: sessionId,
        chat_type: 'echo',
        voice: voice,
        model: ttsModel,
        speed: '0.8',
      }),
    })
  }
}

const createRAGContextPrompt = async (
  knowledgeBaseId: number,
  query: string,
  language: string,
) => {
  const url = new URL(
    `http://localhost:${EMBEDDING_PORT}/v1/kb/${knowledgeBaseId}/search?q=${encodeURIComponent(query)}`,
  )
  const response = await fetch(url)
  const searchResults = await response.json()

  // Create system message with RAG context
  const contextContent = searchResults
    .map((result: { content: string }) => result.content)
    .join('\n\n---\n\n')

  const systemMessage = `/no_think
Use the following pieces of retrieved context to answer the question. 
If you don't know the answer, just say that you do not know the answer.
Always response in ${language} ISO language standard

Context: ${contextContent}
Answer:`
  return systemMessage
}

export async function POST(req: Request) {
  const {
    messages,
    sessionId,
    voice,
    language,
    knowledgeBaseId,
    ttsModel,
  }: {
    messages: UIMessage[]
    sessionId: string
    voice: string
    language: string
    knowledgeBaseId: number
    ttsModel: string
  } = await req.json()
  if (
    !TTS_MODELS.map((model) => model.languages)
      .map((lang) => lang.map((l) => l.voices))
      .flat(2)
      .includes(voice)
  ) {
    return new Response('Unsupported voice', { status: 400 })
  }

  // Get available model
  let model: string
  try {
    model = await getAvailableModel()
  } catch (error) {
    console.error('Model service error:', error)
    return new Response('No available model', { status: 500 })
  }

  // Initialize sentence processor
  const sentenceProcessor = new SentenceProcessor()

  // Create OpenAI compatible provider
  const provider = createOpenAICompatible({
    baseURL: `http://localhost:${TEXT_GENERATION_PORT}/v3`,
    name: 'ovms',
  })

  const ragContext = knowledgeBaseId
    ? await createRAGContextPrompt(
        knowledgeBaseId,
        messages[messages.length - 1].parts
          .map((part) => {
            if (part.type === 'text') return part.text
            else return ''
          })
          .join(''),
        language,
      )
    : undefined

  const wrappedModel = wrapLanguageModel({
    model: provider(model),
    middleware: extractReasoningMiddleware({ tagName: 'think' }),
  })

  const result = streamText({
    model: wrappedModel,
    system: ragContext ?? createDefaultSystemPrompt(language),
    messages: convertToModelMessages(messages),
    onChunk({ chunk }) {
      if (chunk.type === 'text-delta') {
        const completedSentences = sentenceProcessor.addTextChunk(chunk.text)
        // Handle each completed sentence
        completedSentences.forEach((sentence) => {
          SentenceHandler.handleCompletedSentence(
            sentence,
            sessionId,
            voice,
            ttsModel,
          )
        })
      }
    },
    onFinish() {
      const finalSentences = sentenceProcessor.finishProcessing()

      // Handle final sentences
      finalSentences.forEach((sentence) => {
        SentenceHandler.handleCompletedSentence(
          sentence,
          sessionId,
          voice,
          ttsModel,
        )
      })
    },
  })

  return result.toUIMessageStreamResponse()
}
