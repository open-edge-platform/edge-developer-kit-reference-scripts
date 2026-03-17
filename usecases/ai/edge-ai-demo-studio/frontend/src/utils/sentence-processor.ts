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
export class SentenceProcessor {
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
