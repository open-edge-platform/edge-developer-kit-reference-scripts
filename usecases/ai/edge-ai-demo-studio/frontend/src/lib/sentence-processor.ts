// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

const MIN_WORDS_PER_SENTENCE = 5

const EMOJI_REGEX =
  /[\u{1F600}-\u{1F64F}]|[\u{1F300}-\u{1F5FF}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/gu

function removeEmojis(text: string): string {
  return text.replace(EMOJI_REGEX, '')
}

function countWords(text: string): number {
  return text
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 0).length
}

/**
 * Processes streaming text into complete sentences using Intl.Segmenter.
 * Buffers short sentences together until a minimum word count is reached.
 */
export class SentenceProcessor {
  private segmenter: Intl.Segmenter
  private accumulatedText = ''
  private sentenceBuffer = ''

  constructor(locale: string = 'en') {
    this.segmenter = new Intl.Segmenter(locale, { granularity: 'sentence' })
  }

  /** Feed a new chunk of streamed text. Returns any completed sentences. */
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

  /** Flush all remaining buffered text as final sentences. */
  flush(): string[] {
    const completedSentences: string[] = []

    if (this.accumulatedText.trim()) {
      const segments = Array.from(this.segmenter.segment(this.accumulatedText))
      for (const segment of segments) {
        const sentence = this.processSentence(segment.segment)
        if (sentence) {
          completedSentences.push(sentence)
        }
      }
      this.accumulatedText = ''
    }

    const finalSentence = this.flushBuffer()
    if (finalSentence) {
      completedSentences.push(finalSentence)
    }

    return completedSentences
  }

  private processSentence(sentence: string): string | null {
    const cleanSentence = removeEmojis(sentence).trim()
    if (!cleanSentence) return null

    this.sentenceBuffer += (this.sentenceBuffer ? ' ' : '') + cleanSentence

    if (countWords(this.sentenceBuffer) >= MIN_WORDS_PER_SENTENCE) {
      const result = this.sentenceBuffer
      this.sentenceBuffer = ''
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
