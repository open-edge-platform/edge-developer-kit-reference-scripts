// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import type { RecognizedFace } from '../hooks'
import { RefImage } from './ref-image'

interface FaceImageOverlayProps {
  imageUrl: string
  naturalWidth: number
  naturalHeight: number
  faces: RecognizedFace[]
}

/** Probe image with detected face boxes, landmarks and match labels. */
export function FaceImageOverlay({
  imageUrl,
  naturalWidth,
  naturalHeight,
  faces,
}: FaceImageOverlayProps) {
  const stroke = Math.max(2, Math.max(naturalWidth, naturalHeight) / 400)
  const fontSize = Math.max(11, Math.max(naturalWidth, naturalHeight) / 40)

  return (
    <div className="bg-muted/30 relative overflow-hidden rounded-lg border">
      <RefImage
        src={imageUrl}
        alt="Face recognition source"
        className="block h-auto max-h-[32rem] w-full object-contain"
      />
      {faces.length > 0 && naturalWidth > 0 && naturalHeight > 0 && (
        <svg
          className="pointer-events-none absolute inset-0 h-full w-full"
          viewBox={`0 0 ${naturalWidth} ${naturalHeight}`}
          preserveAspectRatio="xMidYMid meet"
        >
          {faces.map((face, faceIndex) => {
            const [x, y, w, h] = face.box
            const label = face.match
              ? `${face.matched ? face.match.name : 'Unknown'} ${face.match.similarity.toFixed(2)}`
              : 'No gallery'
            return (
              <g key={faceIndex}>
                <rect
                  x={x}
                  y={y}
                  width={w}
                  height={h}
                  className="fill-transparent stroke-sky-500"
                  strokeWidth={stroke}
                />
                {face.landmarks.map(([lx, ly], i) => (
                  <circle
                    key={i}
                    cx={lx}
                    cy={ly}
                    r={stroke}
                    className="fill-sky-500"
                  />
                ))}
                <text
                  x={x}
                  y={Math.max(fontSize, y - stroke * 2)}
                  fontSize={fontSize}
                  fontWeight={600}
                  className="fill-sky-500"
                  stroke="rgba(0,0,0,0.65)"
                  strokeWidth={fontSize / 8}
                  style={{ paintOrder: 'stroke' }}
                >
                  {label}
                </text>
              </g>
            )
          })}
        </svg>
      )}
    </div>
  )
}
