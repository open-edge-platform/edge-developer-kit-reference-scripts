// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Loader, Settings, X, Zap } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import type { GenerationBatchState } from '../hooks/use-generation-batch'
import { GenerationType } from '../lib/api'
import type { BatchTally } from '../lib/generation-batch'
import { GenerationTypeSelector } from './generation-type-selector'
import { ImageUploadTile } from './image-upload-tile'

const FIELD_LABEL_CLASS =
  'text-muted-foreground mb-2 block text-xs font-bold uppercase'
const FIELD_INPUT_CLASS =
  'bg-background focus-visible:ring-primary/50 h-auto rounded-xl px-4 py-3 text-sm'

interface GenerationConfigPanelProps {
  /** The project new images are saved into; none yet means nothing to generate into. */
  projectName: string
  batch: GenerationBatchState
}

/** The left column: the batch's inputs, Generate and Cancel. */
export function GenerationConfigPanel({
  projectName,
  batch,
}: GenerationConfigPanelProps) {
  const [image, setImage] = useState<string | null>(null)
  const [referenceImage, setReferenceImage] = useState<string | null>(null)
  const [genType, setGenType] = useState(GenerationType.GOOD_DATASET)
  const [customPrompt, setCustomPrompt] = useState('')
  const [customType, setCustomType] = useState('')
  const [count, setCount] = useState(1)

  const isCustom = genType === GenerationType.CUSTOM
  const { isGenerating, progress } = batch
  const canGenerate = Boolean(image) && !isGenerating && projectName !== ''

  const generate = () => {
    if (!image || !canGenerate) return
    batch.start(
      {
        baseImage: image,
        referenceImage: referenceImage ?? undefined,
        type: genType,
        customPrompt,
        customType,
        projectName,
      },
      count,
    )
  }

  return (
    <section className="bg-card border-border text-card-foreground h-full space-y-6 rounded-2xl border p-6 shadow-xl">
      <div className="flex items-center gap-2">
        <Settings className="text-primary h-5 w-5" aria-hidden />
        <h2 className="text-lg font-semibold">Generation Configuration</h2>
      </div>

      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-3">
          <ImageUploadTile
            label="Base Image"
            placeholder="Upload source"
            inputId="image-upload"
            image={image}
            onChange={setImage}
            onClear={() => setImage(null)}
          />
          {isCustom && (
            <ImageUploadTile
              label="Reference Image"
              placeholder="Upload reference"
              inputId="reference-upload"
              image={referenceImage}
              onChange={setReferenceImage}
              onClear={() => setReferenceImage(null)}
              hint="Optional — used as style guide"
            />
          )}
        </div>

        <div>
          <span id="generation-type-label" className={FIELD_LABEL_CLASS}>
            Generation Type
          </span>
          <GenerationTypeSelector
            labelledBy="generation-type-label"
            value={genType}
            onChange={(type) => {
              setGenType(type)
              if (type !== GenerationType.CUSTOM) setReferenceImage(null)
            }}
          />
        </div>

        {isCustom && (
          <div className="animate-in slide-in-from-top-2 fade-in space-y-4 duration-300">
            <div>
              <Label htmlFor="custom-type" className={FIELD_LABEL_CLASS}>
                Custom Type Name
              </Label>
              <Input
                id="custom-type"
                value={customType}
                onChange={(e) => setCustomType(e.target.value)}
                placeholder="e.g. Broken Component"
                className={FIELD_INPUT_CLASS}
              />
            </div>
            <div>
              <Label htmlFor="custom-prompt" className={FIELD_LABEL_CLASS}>
                User Instructions
              </Label>
              <Input
                id="custom-prompt"
                value={customPrompt}
                onChange={(e) => setCustomPrompt(e.target.value)}
                placeholder="Describe specific modifications..."
                className={FIELD_INPUT_CLASS}
              />
            </div>
          </div>
        )}

        <div>
          <div className="mb-2 flex items-center justify-between">
            <span id="image-count-label" className={FIELD_LABEL_CLASS}>
              Image Count
            </span>
            <span className="text-primary font-mono text-sm font-bold">
              {count}
            </span>
          </div>
          <Slider
            aria-labelledby="image-count-label"
            value={[count]}
            min={1}
            max={10}
            step={1}
            onValueChange={([v]) => setCount(v)}
          />
        </div>

        <Button
          size="lg"
          disabled={!canGenerate}
          onClick={generate}
          className="h-auto w-full gap-3 rounded-xl py-4 font-bold active:scale-[0.98]"
        >
          {isGenerating ? (
            <>
              <Loader className="h-5 w-5 animate-spin" aria-hidden />
              {progress && progress.total > 1
                ? `Generating ${progress.index} of ${progress.total}…`
                : 'Generating…'}
            </>
          ) : (
            <>
              <Zap className="h-5 w-5" aria-hidden />
              Generate Synthetic Data
            </>
          )}
        </Button>
        {isGenerating && (
          <Button
            type="button"
            variant="outline"
            data-testid="cancel-generation-button"
            onClick={batch.cancel}
            disabled={progress?.cancelling}
            aria-busy={progress?.cancelling || undefined}
            className="h-auto w-full gap-2 rounded-xl py-3"
          >
            {progress?.cancelling ? (
              <Loader className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <X className="h-4 w-4" aria-hidden />
            )}
            {progress?.cancelling ? 'Cancelling…' : 'Cancel'}
          </Button>
        )}
        {isGenerating ? (
          <p className="text-muted-foreground text-xs">
            You can leave this page: the images keep generating on the worker
            and each finished one is saved to the project.
          </p>
        ) : (
          batch.tally && <BatchSummary tally={batch.tally} />
        )}
      </div>
    </section>
  )
}

/** How the latest batch ended, once none of its images is in the works. */
function BatchSummary({ tally }: { tally: BatchTally }) {
  const { total, done, failed, cancelled } = tally
  const images = (count: number) => `${count} image${count === 1 ? '' : 's'}`
  let text = `${done} of ${images(total)} generated.`
  if (done === total) text = `${images(total)} generated.`
  if (failed > 0) {
    text += ` ${failed} failed: retry or remove ${failed === 1 ? 'it' : 'them'} in the gallery.`
  }
  if (cancelled > 0) text += ` ${cancelled} cancelled before generating.`
  return (
    <p
      role="status"
      data-testid="generation-batch-summary"
      className="text-muted-foreground text-xs"
    >
      {text}
    </p>
  )
}
