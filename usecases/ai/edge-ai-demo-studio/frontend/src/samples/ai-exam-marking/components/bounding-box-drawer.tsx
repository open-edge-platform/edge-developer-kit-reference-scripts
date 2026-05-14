// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { X } from 'lucide-react'
import type { BoundingBox } from '@/lib/ai-exam-marking/types'

interface BoundingBoxDrawerProps {
  imageUrl: string
  onSaveBoundingBox: (box: BoundingBox) => void
  onClose: () => void
  initialBox?: BoundingBox
}

export function BoundingBoxDrawer({
  imageUrl,
  onSaveBoundingBox,
  onClose,
  initialBox,
}: BoundingBoxDrawerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [isDrawing, setIsDrawing] = useState(false)
  const [startPoint, setStartPoint] = useState<{ x: number; y: number } | null>(
    null,
  )
  const [currentBox, setCurrentBox] = useState<BoundingBox | null>(
    initialBox || null,
  )
  const [image, setImage] = useState<HTMLImageElement | null>(null)

  const drawImage = useCallback(
    (img: HTMLImageElement) => {
      const canvas = canvasRef.current
      if (!canvas) return

      canvas.width = img.width
      canvas.height = img.height
      const ctx = canvas.getContext('2d')
      if (!ctx) return

      ctx.drawImage(img, 0, 0)

      // Draw existing box if present
      if (currentBox) {
        ctx.strokeStyle = '#ef4444'
        ctx.lineWidth = 2
        ctx.strokeRect(
          currentBox.x1,
          currentBox.y1,
          currentBox.x2 - currentBox.x1,
          currentBox.y2 - currentBox.y1,
        )
      }
    },
    [currentBox],
  )

  // Load image
  useEffect(() => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      setImage(img)
      drawImage(img)
    }
    img.src = imageUrl
  }, [imageUrl, drawImage])

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return

    const rect = canvas.getBoundingClientRect()
    const x = Math.round((e.clientX - rect.left) * (canvas.width / rect.width))
    const y = Math.round((e.clientY - rect.top) * (canvas.height / rect.height))

    setIsDrawing(true)
    setStartPoint({ x, y })
  }

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing || !startPoint || !image) return

    const canvas = canvasRef.current
    if (!canvas) return

    const rect = canvas.getBoundingClientRect()
    const x = Math.round((e.clientX - rect.left) * (canvas.width / rect.width))
    const y = Math.round((e.clientY - rect.top) * (canvas.height / rect.height))

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Redraw image and box
    ctx.drawImage(image, 0, 0)

    // Draw preview box
    const x1 = Math.min(startPoint.x, x)
    const y1 = Math.min(startPoint.y, y)
    const x2 = Math.max(startPoint.x, x)
    const y2 = Math.max(startPoint.y, y)

    ctx.strokeStyle = '#3b82f6'
    ctx.lineWidth = 2
    ctx.strokeRect(x1, y1, x2 - x1, y2 - y1)

    // Draw current box if exists
    if (
      currentBox &&
      (currentBox.x1 !== x1 ||
        currentBox.y1 !== y1 ||
        currentBox.x2 !== x2 ||
        currentBox.y2 !== y2)
    ) {
      ctx.strokeStyle = '#ef4444'
      ctx.lineWidth = 1
      ctx.globalAlpha = 0.5
      ctx.strokeRect(
        currentBox.x1,
        currentBox.y1,
        currentBox.x2 - currentBox.x1,
        currentBox.y2 - currentBox.y1,
      )
      ctx.globalAlpha = 1
    }
  }

  const handleMouseUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing || !startPoint || !image) return

    const canvas = canvasRef.current
    if (!canvas) return

    const rect = canvas.getBoundingClientRect()
    const x = Math.round((e.clientX - rect.left) * (canvas.width / rect.width))
    const y = Math.round((e.clientY - rect.top) * (canvas.height / rect.height))

    const x1 = Math.min(startPoint.x, x)
    const y1 = Math.min(startPoint.y, y)
    const x2 = Math.max(startPoint.x, x)
    const y2 = Math.max(startPoint.y, y)

    const newBox: BoundingBox = { x1, y1, x2, y2 }
    setCurrentBox(newBox)
    setIsDrawing(false)
    setStartPoint(null)

    // Redraw with new box
    const ctx = canvas.getContext('2d')
    if (ctx) {
      ctx.drawImage(image, 0, 0)
      ctx.strokeStyle = '#ef4444'
      ctx.lineWidth = 2
      ctx.strokeRect(x1, y1, x2 - x1, y2 - y1)
    }
  }

  const handleClearBox = () => {
    setCurrentBox(null)
    if (image) {
      drawImage(image)
    }
  }

  const handleSave = () => {
    if (currentBox) {
      onSaveBoundingBox(currentBox)
      onClose()
    }
  }

  return (
    <Card className="w-full p-6">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">Draw Grading Box</h3>
        <Button variant="ghost" size="sm" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="space-y-4">
        <p className="text-muted-foreground text-xs">
          Click and drag on the image to draw a grading box around the answer
          area
        </p>

        <div className="border-border bg-muted overflow-x-auto rounded-lg border p-4">
          <canvas
            ref={canvasRef}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={() => setIsDrawing(false)}
            className="cursor-crosshair"
          />
        </div>

        {currentBox && (
          <div className="bg-muted grid grid-cols-2 gap-4 rounded-lg p-4 md:grid-cols-4">
            <div>
              <label className="text-xs font-medium">X1</label>
              <Input
                type="number"
                value={currentBox.x1}
                readOnly
                className="bg-background text-xs"
              />
            </div>
            <div>
              <label className="text-xs font-medium">Y1</label>
              <Input
                type="number"
                value={currentBox.y1}
                readOnly
                className="bg-background text-xs"
              />
            </div>
            <div>
              <label className="text-xs font-medium">X2</label>
              <Input
                type="number"
                value={currentBox.x2}
                readOnly
                className="bg-background text-xs"
              />
            </div>
            <div>
              <label className="text-xs font-medium">Y2</label>
              <Input
                type="number"
                value={currentBox.y2}
                readOnly
                className="bg-background text-xs"
              />
            </div>
          </div>
        )}

        <div className="flex gap-2">
          {currentBox && (
            <Button
              variant="outline"
              className="text-xs"
              onClick={handleClearBox}
            >
              Clear Box
            </Button>
          )}
          <Button
            onClick={handleSave}
            disabled={!currentBox}
            className="ml-auto text-xs"
          >
            Save Bounding Box
          </Button>
        </div>
      </div>
    </Card>
  )
}
