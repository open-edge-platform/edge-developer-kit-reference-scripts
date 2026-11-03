// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { BarChart3, Fingerprint, ImageIcon, Loader, Type } from 'lucide-react'
import { useState } from 'react'
import { EmptyState } from '@/components/common/empty-state'
import { ImageDropZone } from '@/components/common/image-drop-zone'
import { InfoTip } from '@/components/common/info-tip'
import { InlineNotice } from '@/components/common/inline-notice'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { IMAGE_ACCEPT, readFileAsDataUrl } from '@/lib/browser/image-utils'
import { plural } from '@/lib/browser/format'
import { DemoLayout } from '@/services/common/demo/components/demo-layout'
import { DemoParameterSidebar } from '@/services/common/demo/components/demo-parameter-sidebar'
import { demoStateKey } from '@/services/common/demo/demo-session'
import { useSessionState } from '@/services/common/demo/session-store'
import { getServiceModelName } from '@/services/common/get-service-model'
import type { Service } from '@/services/types'
import { EmbeddingDetails } from './components/embedding-details'
import { EngineBadge } from './components/engine-badge'
import { SimilarityResults } from './components/similarity-results'
import { getEmbeddingCapabilities } from './config'
import type { EmbeddingInput } from './hooks/use-embed'
import { useEmbeddingComparison } from './hooks/use-embedding-comparison'
import { useEmbeddingsParams } from './hooks/use-params'

/** Plus GIF, which the OEP worker also reads. */
const EMBED_IMAGE_ACCEPT = `${IMAGE_ACCEPT},image/gif,.gif`

const DEFAULT_INPUT = 'Intel OpenVINO provides hardware-optimized AI inference.'
const DEFAULT_REFERENCES = [
  'AI inference optimization',
  'Cloud deployment guide',
  'Cooking recipes collection',
].join('\n')

type InputMode = 'text' | 'image'

function isInputMode(value: string): value is InputMode {
  return value === 'text' || value === 'image'
}

export function EmbeddingDemo({ service }: { service: Service }) {
  const [input, setInput] = useSessionState(
    demoStateKey(service, 'embeddings:input'),
    DEFAULT_INPUT,
  )
  const [referenceTextsInput, setReferenceTextsInput] = useSessionState(
    demoStateKey(service, 'embeddings:references'),
    DEFAULT_REFERENCES,
  )
  const [requestedInputMode, setInputMode] = useState<InputMode>('text')
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [imageError, setImageError] = useState<string | null>(null)
  const { values: embeddingsValues, params } = useEmbeddingsParams({
    sessionKey: demoStateKey(service, 'embeddings:params'),
  })
  const model = getServiceModelName(service, true) ?? ''
  const comparison = useEmbeddingComparison(service.apiBase, model)

  const capabilities = getEmbeddingCapabilities(service)
  const canEmbedImages = capabilities.image
  // Text-only models fall back to text without touching the stored choice, so it survives a model swap.
  const inputMode: InputMode = canEmbedImages ? requestedInputMode : 'text'
  const isImageSubject = inputMode === 'image'

  const referenceTexts = referenceTextsInput
    .split('\n')
    .map((text) => text.trim())
    .filter(Boolean)

  const handleEmbed = async () => {
    let subject: EmbeddingInput
    if (isImageSubject) {
      if (!imageFile) return
      try {
        subject = {
          type: 'image_base64',
          image_base64: await readFileAsDataUrl(imageFile),
        }
      } catch {
        setImageError('Could not read the selected image.')
        return
      }
    } else {
      subject = input
    }
    comparison.compare(
      subject,
      referenceTexts,
      embeddingsValues.encodingFormat,
      isImageSubject && imageFile
        ? { kind: 'image', name: imageFile.name }
        : { kind: 'text', text: input.trim() },
    )
  }

  const canSubmit = isImageSubject ? Boolean(imageFile) : Boolean(input.trim())
  // Without references only the subject is embedded, for Vector details.
  const comparing = referenceTexts.length > 0
  const isBusy = comparison.isEmbedding || comparison.isComparing

  return (
    <DemoLayout sidebar={<DemoParameterSidebar params={params} />}>
      <div className="space-y-4">
        <EngineBadge capabilities={capabilities} />

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label
                htmlFor={isImageSubject ? undefined : 'embed-subject-text'}
                className="text-foreground text-sm font-medium"
              >
                {isImageSubject ? 'Your image' : 'Your text'}
              </Label>
              {canEmbedImages && (
                <Tabs
                  value={inputMode}
                  onValueChange={(value) => {
                    if (isInputMode(value)) setInputMode(value)
                  }}
                >
                  <TabsList className="h-8" aria-label="What to compare">
                    <TabsTrigger
                      value="text"
                      className="h-7 gap-1 px-2.5 text-xs"
                      data-testid="embed-input-text"
                    >
                      <Type aria-hidden className="h-3.5 w-3.5" />
                      Text
                    </TabsTrigger>
                    <TabsTrigger
                      value="image"
                      className="h-7 gap-1 px-2.5 text-xs"
                      data-testid="embed-input-image"
                    >
                      <ImageIcon aria-hidden className="h-3.5 w-3.5" />
                      Image
                    </TabsTrigger>
                  </TabsList>
                </Tabs>
              )}
            </div>
            {isImageSubject ? (
              <>
                <ImageDropZone
                  file={imageFile}
                  onFileChange={(file) => {
                    setImageFile(file)
                    setImageError(null)
                  }}
                  accept={EMBED_IMAGE_ACCEPT}
                  label="Drop an image to compare"
                  testId="embed-image-zone"
                  inputTestId="embed-image-input"
                />
                <p className="text-muted-foreground text-xs">
                  The descriptions that best match the image rank first
                  (zero-shot classification).
                </p>
                {imageError && (
                  <InlineNotice tone="destructive" size="sm">
                    {imageError}
                  </InlineNotice>
                )}
              </>
            ) : (
              <>
                <Textarea
                  id="embed-subject-text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Enter text to generate embeddings..."
                  rows={5}
                  className="bg-muted/30 resize-none"
                />
                <p className="text-muted-foreground text-xs">
                  {plural(input.split(/\s+/).filter(Boolean).length, 'word')}
                </p>
              </>
            )}
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-1.5">
              <Label
                htmlFor="embed-reference-texts"
                className="text-foreground text-sm font-medium"
              >
                Compare with
              </Label>
              <InfoTip
                ariaLabel="Info about reference texts"
                tooltip={
                  isImageSubject
                    ? 'Enter candidate descriptions to compare against your image, one per line. The best-matching description wins (zero-shot classification).'
                    : 'Enter texts to compare against your input. The AI will measure how similar each one is in meaning.'
                }
              />
            </div>
            <Textarea
              id="embed-reference-texts"
              value={referenceTextsInput}
              onChange={(e) => setReferenceTextsInput(e.target.value)}
              placeholder={
                isImageSubject
                  ? 'Enter descriptions to match, one per line...'
                  : 'Enter reference texts, one per line...'
              }
              rows={5}
              className="bg-muted/30 resize-none"
            />
            <p className="text-muted-foreground text-xs">
              {comparing
                ? `${plural(referenceTexts.length, 'text')} · one per line`
                : 'Optional: add texts to compare with, one per line. Without them, only the vector is made.'}
            </p>
          </div>
        </div>

        <Button
          onClick={handleEmbed}
          disabled={isBusy || !canSubmit}
          data-testid="embed-compare-button"
          className="w-full gap-2"
        >
          {isBusy ? (
            <>
              <Loader aria-hidden className="h-4 w-4 animate-spin" />
              {comparing ? 'Comparing…' : 'Embedding…'}
            </>
          ) : comparing ? (
            <>
              <BarChart3 aria-hidden className="h-4 w-4" />
              Compare similarity
            </>
          ) : (
            <>
              <Fingerprint aria-hidden className="h-4 w-4" />
              Generate embedding
            </>
          )}
        </Button>

        {comparison.error && (
          <InlineNotice tone="destructive" size="sm" data-testid="embed-error">
            {comparison.error.message}
          </InlineNotice>
        )}

        {comparison.decodeError && (
          <InlineNotice
            tone="destructive"
            size="sm"
            data-testid="embed-decode-error"
          >
            {comparison.decodeError}
          </InlineNotice>
        )}
      </div>

      {!comparison.embedding && !comparison.isEmbedding && (
        <EmptyState
          icon={BarChart3}
          title="Compare similarity"
          description={
            canEmbedImages
              ? 'Each reference is scored by how close it is in meaning to your text or image, most similar first. The model turns every input into a vector (an embedding); an image and the text that describes it produce similar vectors. The raw vector is under Vector details.'
              : 'Each reference is scored by how close it is in meaning to your text, most similar first. The model turns every input into a vector (an embedding); texts with similar meaning produce similar vectors. The raw vector is under Vector details.'
          }
          className="py-12"
        />
      )}

      {(comparison.results.length > 0 || comparison.isComparing) && (
        <SimilarityResults
          results={comparison.results}
          subject={comparison.subject}
          pending={comparison.isComparing}
        />
      )}

      {(comparison.embedding || comparison.isEmbedding) && (
        <>
          <Separator />
          <EmbeddingDetails
            embedding={comparison.embedding}
            model={comparison.model}
            pending={comparison.isEmbedding}
            subject={comparison.subject}
          />
        </>
      )}
    </DemoLayout>
  )
}
