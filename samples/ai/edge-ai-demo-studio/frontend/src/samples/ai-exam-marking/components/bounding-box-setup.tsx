// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useState } from 'react'
import { ImageDropZone } from '@/components/common/image-drop-zone'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Crop, ArrowRight } from 'lucide-react'
import { readFileAsDataUrl } from '@/lib/browser/image-utils'
import { toastError } from '@/lib/browser/toast-error'
import type {
  DataEntry,
  BoundingBox,
} from '@/samples/ai-exam-marking/lib/types'
import { resizeImage } from '@/samples/ai-exam-marking/lib/image-utils'
import Image from 'next/image'
import { BoundingBoxDrawer } from './bounding-box-drawer'
import { QuestionHeading } from './question-heading'

type BoundingBoxSetupProps = {
  dataEntries: DataEntry[]
  setDataEntries: (entries: DataEntry[]) => void
  referenceImage: string
  setReferenceImage: (image: string) => void
  onNext: () => void
}

export function BoundingBoxSetup({
  dataEntries,
  setDataEntries,
  referenceImage,
  setReferenceImage,
  onNext,
}: BoundingBoxSetupProps) {
  // The question whose box is being drawn; the drawer is open while set.
  const [selectedEntryForBBox, setSelectedEntryForBBox] = useState<
    string | null
  >(null)

  const handleImageUpload = async (file: File | null) => {
    if (!file) return
    try {
      const dataUrl = await readFileAsDataUrl(file)
      setReferenceImage(await resizeImage(dataUrl, 612, 792))
    } catch (error) {
      toastError(`Could not read ${file.name}`)(error)
    }
  }

  const handleSaveBoundingBox = (box: BoundingBox) => {
    if (selectedEntryForBBox) {
      setDataEntries(
        dataEntries.map((entry) =>
          entry.id === selectedEntryForBBox
            ? { ...entry, boundingBox: box }
            : entry,
        ),
      )
      setSelectedEntryForBBox(null)
    }
  }

  const handleClearBoundingBox = (entryId: string) => {
    setDataEntries(
      dataEntries.map((entry) =>
        entry.id === entryId ? { ...entry, boundingBox: undefined } : entry,
      ),
    )
  }

  return (
    <div className="space-y-6">
      {referenceImage && selectedEntryForBBox && (
        <BoundingBoxDrawer
          imageUrl={referenceImage}
          onSaveBoundingBox={handleSaveBoundingBox}
          onClose={() => setSelectedEntryForBBox(null)}
          initialBox={
            dataEntries.find((e) => e.id === selectedEntryForBBox)?.boundingBox
          }
        />
      )}

      <Card>
        <CardHeader>
          <CardTitle>Upload Sample Answer Sheet</CardTitle>
          <CardDescription className="text-xs">
            Upload a sample image of the answer sheet to define bounding boxes
            for each question
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!referenceImage ? (
            <ImageDropZone
              file={null}
              onFileChange={(file) => void handleImageUpload(file)}
              label="Click to upload sample image"
              hint="PNG, JPG, JPEG up to 10MB"
            />
          ) : (
            <div className="space-y-4">
              <div className="rounded-lg border p-4">
                <Image
                  src={referenceImage}
                  alt="Sample answer sheet"
                  width={0}
                  height={0}
                  sizes="100vw"
                  className="max-h-96 w-full object-contain"
                  unoptimized
                />
              </div>
              <Button
                variant="outline"
                className="text-xs"
                onClick={() => {
                  setReferenceImage('')
                  setDataEntries(
                    dataEntries.map((e) => ({ ...e, boundingBox: undefined })),
                  )
                }}
              >
                Change Image
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {referenceImage && dataEntries.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Draw Bounding Boxes</CardTitle>
            <CardDescription className="text-xs">
              Draw a bounding box on the sample image for each question&apos;s
              answer area
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3 text-xs">
              {dataEntries.map((entry) => (
                <div key={entry.id} className="bg-card rounded-lg border p-4">
                  <div className="mb-3">
                    <QuestionHeading
                      number={entry.number}
                      marks={entry.marks}
                    />
                  </div>
                  <div className="space-y-2">
                    {entry.boundingBox && (
                      <div className="bg-muted rounded-lg p-3">
                        <p className="text-muted-foreground mb-2 font-medium">
                          Bounding Box:
                        </p>
                        <div className="grid grid-cols-2 gap-2 text-xs">
                          <div>X1: {entry.boundingBox.x1}</div>
                          <div>Y1: {entry.boundingBox.y1}</div>
                          <div>X2: {entry.boundingBox.x2}</div>
                          <div>Y2: {entry.boundingBox.y2}</div>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleClearBoundingBox(entry.id)}
                          className="mt-2 w-full text-xs"
                        >
                          Clear Box
                        </Button>
                      </div>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setSelectedEntryForBBox(entry.id)}
                      className="w-full text-xs"
                    >
                      <Crop className="mr-2 h-3 w-3" aria-hidden />
                      {entry.boundingBox ? 'Edit' : 'Draw'} Bounding Box
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Button onClick={onNext} className="w-full text-xs">
        Continue to Grading
        <ArrowRight className="ml-2 h-4 w-4" aria-hidden />
      </Button>
    </div>
  )
}
