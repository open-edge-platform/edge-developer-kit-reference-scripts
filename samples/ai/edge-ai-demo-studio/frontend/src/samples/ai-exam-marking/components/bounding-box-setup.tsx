// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import type React from 'react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Upload, Crop, ArrowRight } from 'lucide-react'
import type { DataEntry, BoundingBox } from '@/lib/ai-exam-marking/types'
import Image from 'next/image'
import { BoundingBoxDrawer } from './bounding-box-drawer'

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
  const [selectedEntryForBBox, setSelectedEntryForBBox] = useState<
    string | null
  >(null)
  const [showBBoxDrawer, setShowBBoxDrawer] = useState(false)

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      const reader = new FileReader()
      reader.onload = (event) => {
        setReferenceImage(event.target?.result as string)
      }
      reader.readAsDataURL(file)
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
      setShowBBoxDrawer(false)
    }
  }

  const handleOpenBBoxDrawer = (entryId: string) => {
    setSelectedEntryForBBox(entryId)
    setShowBBoxDrawer(true)
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
      {showBBoxDrawer && referenceImage && selectedEntryForBBox && (
        <BoundingBoxDrawer
          imageUrl={referenceImage}
          onSaveBoundingBox={handleSaveBoundingBox}
          onClose={() => setShowBBoxDrawer(false)}
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
            <Label className="border-border hover:bg-muted/50 flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-8">
              <Upload className="text-muted-foreground mb-2 h-8 w-8" />
              <span className="text-sm font-medium">
                Click to upload sample image
              </span>
              <span className="text-muted-foreground text-xs">
                PNG, JPG, JPEG up to 10MB
              </span>
              <Input
                type="file"
                accept="image/*"
                onChange={handleImageUpload}
                className="hidden"
              />
            </Label>
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
                  <div className="mb-3 flex items-center gap-3">
                    <div className="bg-primary text-primary-foreground flex h-8 w-8 shrink-0 items-center justify-center rounded-full font-semibold">
                      {entry.number}
                    </div>
                    <div>
                      <p className="text-card-foreground font-medium">
                        Question {entry.number}
                      </p>
                      <p className="text-muted-foreground text-xs">
                        {entry.marks} marks
                      </p>
                    </div>
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
                      onClick={() => handleOpenBBoxDrawer(entry.id)}
                      className="w-full text-xs"
                    >
                      <Crop className="mr-2 h-3 w-3" />
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
        <ArrowRight className="ml-2 h-4 w-4" />
      </Button>
    </div>
  )
}
