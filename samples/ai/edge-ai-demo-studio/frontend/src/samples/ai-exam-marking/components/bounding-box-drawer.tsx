// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useState, useRef, useEffect, useCallback, useId } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { X } from 'lucide-react'
import type { BoundingBox } from '@/samples/ai-exam-marking/lib/types'

const BOX_FIELDS = ['x1', 'y1', 'x2', 'y2'] as const

interface BoundingBoxDrawerProps {
  imageUrl: string
  onSaveBoundingBox: (box: BoundingBox) => void
  onClose: () => void
  initialBox?: BoundingBox
}

/** Canvas-space point under a mouse event, scaled for the canvas's CSS size. */
function toCanvasPoint(
  e: React.MouseEvent<HTMLCanvasElement>,
  canvas: HTMLCanvasElement,
): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect()
  return {
    x: Math.round((e.clientX - rect.left) * (canvas.width / rect.width)),
    y: Math.round((e.clientY - rect.top) * (canvas.height / rect.height)),
  }
}

function drawBox(
  ctx: CanvasRenderingContext2D,
  box: BoundingBox,
  {
    stroke,
    width,
    alpha = 1,
  }: { stroke: string; width: number; alpha?: number },
): void {
  ctx.strokeStyle = stroke
  ctx.lineWidth = width
  ctx.globalAlpha = alpha
  ctx.strokeRect(box.x1, box.y1, box.x2 - box.x1, box.y2 - box.y1)
  ctx.globalAlpha = 1
}

export function BoundingBoxDrawer({
  imageUrl,
  onSaveBoundingBox,
  onClose,
  initialBox,
}: BoundingBoxDrawerProps) {
  const fieldId = useId()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [isDrawing, setIsDrawing] = useState(false)
  const [startPoint, setStartPoint] = useState<{ x: number; y: number } | null>(
    null,
  )
  const [currentBox, setCurrentBox] = useState<BoundingBox | null>(
    initialBox || null,
  )
  const [image, setImage] = useState<HTMLImageElement | null>(null)

  // Memoized by hand: it is a dependency of the redraw effect below.
  const drawImage = useCallback(
    (img: HTMLImageElement) => {
      const canvas = canvasRef.current
      if (!canvas) return

      canvas.width = img.width
      canvas.height = img.height
      const ctx = canvas.getContext('2d')
      if (!ctx) return

      ctx.drawImage(img, 0, 0)

      if (currentBox) {
        drawBox(ctx, currentBox, { stroke: '#ef4444', width: 2 })
      }
    },
    [currentBox],
  )

  useEffect(() => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => setImage(img)
    img.src = imageUrl
  }, [imageUrl])

  useEffect(() => {
    if (image) drawImage(image)
  }, [image, currentBox, drawImage])

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return

    const { x, y } = toCanvasPoint(e, canvas)

    setIsDrawing(true)
    setStartPoint({ x, y })
  }

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing || !startPoint || !image) return

    const canvas = canvasRef.current
    if (!canvas) return

    const { x, y } = toCanvasPoint(e, canvas)

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.drawImage(image, 0, 0)

    const x1 = Math.min(startPoint.x, x)
    const y1 = Math.min(startPoint.y, y)
    const x2 = Math.max(startPoint.x, x)
    const y2 = Math.max(startPoint.y, y)

    drawBox(ctx, { x1, y1, x2, y2 }, { stroke: '#3b82f6', width: 2 })

    if (
      currentBox &&
      (currentBox.x1 !== x1 ||
        currentBox.y1 !== y1 ||
        currentBox.x2 !== x2 ||
        currentBox.y2 !== y2)
    ) {
      drawBox(ctx, currentBox, { stroke: '#ef4444', width: 1, alpha: 0.5 })
    }
  }

  const handleMouseUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing || !startPoint || !image) return

    const canvas = canvasRef.current
    if (!canvas) return

    const { x, y } = toCanvasPoint(e, canvas)

    const x1 = Math.min(startPoint.x, x)
    const y1 = Math.min(startPoint.y, y)
    const x2 = Math.max(startPoint.x, x)
    const y2 = Math.max(startPoint.y, y)

    const newBox: BoundingBox = { x1, y1, x2, y2 }
    setCurrentBox(newBox)
    setIsDrawing(false)
    setStartPoint(null)

    const ctx = canvas.getContext('2d')
    if (ctx) {
      ctx.drawImage(image, 0, 0)
      drawBox(ctx, { x1, y1, x2, y2 }, { stroke: '#ef4444', width: 2 })
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
        <Button
          variant="ghost"
          size="sm"
          onClick={onClose}
          aria-label="Close the grading box editor"
        >
          <X className="h-4 w-4" aria-hidden />
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
            {BOX_FIELDS.map((field) => (
              <div key={field}>
                <Label
                  htmlFor={`${fieldId}-${field}`}
                  className="text-xs font-medium"
                >
                  {field.toUpperCase()}
                </Label>
                <Input
                  id={`${fieldId}-${field}`}
                  type="number"
                  value={currentBox[field]}
                  readOnly
                  className="bg-background text-xs"
                />
              </div>
            ))}
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
