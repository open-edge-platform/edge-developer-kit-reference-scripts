// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { formatMarks, formatTotal, sheetTotal } from './marks'
import type { DataEntry, LLMResultEntry } from './types'
import { resizeImageDataUrl } from '@/lib/browser/image-utils'
import { MEDIA_SRC_CHARS, safeMediaSrc } from '@/lib/validation'

/** Directory served by the file-watcher service that holds the grading icons. */
export const MARKING_DATA_DIR = '/data/ai-exam-marking'

/** Resizes `dataUrl` to `width`x`height` as a JPEG (the sample's fixed page size). */
export function resizeImage(
  dataUrl: string,
  width: number,
  height: number,
): Promise<string> {
  return resizeImageDataUrl(dataUrl, width, height).catch(() => dataUrl)
}

/** Rotates `imageSrc` by `degrees` onto a 1080x1920 canvas and returns a JPEG. */
export function rotateImage(
  imageSrc: string,
  degrees: number,
): Promise<string> {
  return new Promise((resolve) => {
    const img = new globalThis.Image()
    img.onload = () => {
      const targetWidth = 1080
      const targetHeight = 1920
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        resolve(imageSrc)
        return
      }
      canvas.width = targetWidth
      canvas.height = targetHeight
      ctx.translate(canvas.width / 2, canvas.height / 2)
      ctx.rotate((degrees * Math.PI) / 180)
      const scale = Math.min(targetWidth / img.height, targetHeight / img.width)
      const scaledWidth = img.width * scale
      const scaledHeight = img.height * scale
      ctx.drawImage(
        img,
        -scaledWidth / 2,
        -scaledHeight / 2,
        scaledWidth,
        scaledHeight,
      )
      resolve(canvas.toDataURL('image/jpeg', 0.9))
    }
    img.onerror = () => resolve(imageSrc)
    img.src = imageSrc
  })
}

/**
 * Draws marks, review icons and feedback at each question's box plus the total top-right. Returns
 * the annotated image and a transparent overlay of just the annotations (for printing).
 */
export async function buildAnnotatedImage(
  uploadedImage: string,
  results: LLMResultEntry[],
  dataEntries: DataEntry[],
  iconDir: string,
): Promise<{ annotated: string; overlay: string }> {
  const img = new globalThis.Image()
  const imageLoaded = await new Promise<boolean>((resolve) => {
    img.onload = () => resolve(true)
    img.onerror = () => resolve(false)
    img.src = uploadedImage
  })
  if (!imageLoaded) return { annotated: uploadedImage, overlay: '' }

  const canvas = document.createElement('canvas')
  canvas.width = 2480
  canvas.height = 3508
  const ctx = canvas.getContext('2d')
  if (!ctx) return { annotated: uploadedImage, overlay: '' }

  const overlayCanvas = document.createElement('canvas')
  overlayCanvas.width = 2480
  overlayCanvas.height = 3508
  const overlayCtx = overlayCanvas.getContext('2d')
  if (!overlayCtx) return { annotated: uploadedImage, overlay: '' }

  ctx.drawImage(img, 0, 0, 2480, 3508)

  for (let i = 0; i < dataEntries.length; i++) {
    const entry = dataEntries[i]
    const result = results.find(
      (r) => r.questionNumber === entry.number.toString(),
    )
    if (!entry.boundingBox || !result) continue

    const scaleX = 2480 / 612
    const scaleY = 3508 / 792
    const x1 = entry.boundingBox.x1 * scaleX
    const y1 = entry.boundingBox.y1 * scaleY
    const x2 = entry.boundingBox.x2 * scaleX
    const label = formatMarks(result.marks)
    const labelFontSize = Math.round(28 * scaleX)
    ctx.font = `italic ${labelFontSize}px 'Shadows Into Light Regular', 'Segoe Script', 'Brush Script MT', cursive`
    const padding = Math.round(2 * scaleX)
    const iconGap = Math.round(8 * scaleX)
    const textMetrics = ctx.measureText(label)
    const textWidth = textMetrics.width
    const textHeight = labelFontSize
    const textX = x2 - textWidth - padding
    const textY = y1 + textHeight + padding

    ctx.fillStyle = 'red'
    ctx.fillText(label, textX, textY)
    overlayCtx.font = ctx.font
    overlayCtx.fillStyle = 'red'
    overlayCtx.fillText(label, textX, textY)

    const { awarded, max } = result.marks
    let iconPath = `${iconDir}/neutral.png`
    if (awarded !== null && awarded === max) {
      iconPath = `${iconDir}/correct.png`
    } else if (awarded === 0) iconPath = `${iconDir}/wrong.png`

    const iconSize = Math.round(52 * scaleX)
    const icon = new globalThis.Image()
    icon.src = iconPath
    await new Promise<void>((resolve) => {
      icon.onload = () => {
        ctx.drawImage(
          icon,
          textX - iconSize - padding - iconGap,
          textY - iconSize + padding,
          iconSize,
          iconSize,
        )
        overlayCtx.drawImage(
          icon,
          textX - iconSize - padding - iconGap,
          textY - iconSize + padding,
          iconSize,
          iconSize,
        )
        resolve()
      }
      icon.onerror = () => resolve()
    })

    const feedback = result.feedback
    const feedbackFontSize = Math.round(12 * scaleX)
    ctx.font = `italic ${Math.round(10 * scaleX)}px 'Shadows Into Light Regular', 'Segoe Script', 'Brush Script MT', cursive`
    const maxLineWidth = (x2 - x1 - padding * 2) * 1.5
    const lineHeight = feedbackFontSize + 4

    const words = feedback.split(' ')
    const lines: string[] = []
    let currentLine = ''
    for (const word of words) {
      const testLine = currentLine ? `${currentLine} ${word}` : word
      if (ctx.measureText(testLine).width > maxLineWidth && currentLine) {
        lines.push(currentLine)
        currentLine = word
      } else {
        currentLine = testLine
      }
    }
    if (currentLine) lines.push(currentLine)

    ctx.fillStyle = 'red'
    overlayCtx.font = ctx.font
    overlayCtx.fillStyle = 'red'
    lines.forEach((line, lineIdx) => {
      const lineWidth = ctx.measureText(line).width
      const feedbackX = x2 - lineWidth - padding
      const feedbackY = textY + textHeight + padding + lineIdx * lineHeight
      ctx.fillText(line, feedbackX, feedbackY)
      overlayCtx.fillText(line, feedbackX, feedbackY)
    })
  }

  // Draw total marks at top-right
  const totalLabel = formatTotal(sheetTotal(results))
  const totalFontSize = Math.round(50 * (2480 / 612))
  const totalFont = `bold italic ${totalFontSize}px 'Shadows Into Light Regular', 'Segoe Script', 'Brush Script MT', cursive`
  ctx.font = totalFont
  ctx.fillStyle = 'red'
  overlayCtx.font = totalFont
  overlayCtx.fillStyle = 'red'
  const totalPadding = Math.round(20 * (2480 / 612))
  const totalMetrics = ctx.measureText(totalLabel)
  const totalX = 2480 - totalMetrics.width - totalPadding
  const totalY = totalFontSize + totalPadding
  ctx.fillText(totalLabel, totalX, totalY)
  overlayCtx.fillText(totalLabel, totalX, totalY)

  return {
    annotated: canvas.toDataURL('image/png'),
    overlay: overlayCanvas.toDataURL('image/png'),
  }
}

/** Opens a print-only window showing `src` (a data URL) full-page on A4. */
export function printOverlay(label: string, src: string): void {
  if (!src.startsWith('data:image/png;base64,')) return
  const win = window.open('', '_blank')
  if (!win) return
  let imageSrc = ''
  for (const ch of safeMediaSrc(src)) {
    let allowedChar = ''
    for (const allowed of MEDIA_SRC_CHARS) {
      if (allowed === ch) {
        allowedChar = allowed
        break
      }
    }
    if (!allowedChar) {
      win.close()
      return
    }
    imageSrc += allowedChar
  }
  if (!imageSrc) {
    win.close()
    return
  }
  const doc = win.document
  doc.title = label
  const style = doc.createElement('style')
  style.textContent =
    '@page{size:A4;margin:0}body{margin:0;padding:0}img{width:100%;height:auto;display:block}'
  doc.head.append(style)
  const image = doc.createElement('img')
  image.onload = () => {
    win.print()
    win.close()
  }
  image.onerror = () => win.close()
  image.src = imageSrc
  doc.body.append(image)
}
