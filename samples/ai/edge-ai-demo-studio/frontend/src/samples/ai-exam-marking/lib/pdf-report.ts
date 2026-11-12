// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { jsPDF } from 'jspdf'
import { formatMarks, formatTotal } from './marks'
import type { LLMResultEntry, SavedDataEntry } from './types'

export interface GradingPdfInput {
  /** Optional heading suffix, e.g. "Answer Sheet - S12345". */
  label?: string
  studentName?: string
  studentId?: string
  /** Subject label, e.g. "Mathematics". */
  subject?: string
  timestamp: string
  dataEntries: readonly SavedDataEntry[]
  ocrText: string
  llmResults: LLMResultEntry[]
  annotatedImage?: string
}

export function buildGradingPdf(input: GradingPdfInput): jsPDF {
  const doc = new jsPDF()
  writeReport(doc, input)
  return doc
}

/** Every report in one PDF, each on a new page: browsers block a burst of downloads after the first. */
export function buildCombinedGradingPdf(
  inputs: readonly GradingPdfInput[],
): jsPDF {
  const doc = new jsPDF()
  inputs.forEach((input, index) => {
    if (index > 0) doc.addPage()
    writeReport(doc, input)
  })
  return doc
}

/** Writes one report into `doc`, from the top of its current page. */
function writeReport(doc: jsPDF, input: GradingPdfInput): void {
  const margin = 14
  const pageWidth = doc.internal.pageSize.getWidth()
  const maxWidth = pageWidth - margin * 2
  let y = 20

  const addText = (text: string, size = 10, bold = false) => {
    doc.setFontSize(size)
    doc.setFont('helvetica', bold ? 'bold' : 'normal')
    const lines = doc.splitTextToSize(text, maxWidth)
    for (const line of lines) {
      if (y > 275) {
        doc.addPage()
        y = 20
      }
      doc.text(line, margin, y)
      y += size * 0.5
    }
    y += 2
  }

  addText(
    input.label ? `Grading Report — ${input.label}` : 'Grading Report',
    16,
    true,
  )
  if (input.studentName || input.studentId) {
    addText(
      `Student: ${[input.studentName, input.studentId].filter(Boolean).join(' — ')}`,
      11,
      true,
    )
  }
  addText(`Saved: ${new Date(input.timestamp).toLocaleString()}`, 9)
  if (input.subject) addText(`Subject: ${input.subject}`, 9)
  y += 4

  addText('Marking Scheme', 13, true)
  for (const entry of input.dataEntries) {
    addText(
      `Q${entry.number}: ${entry.question} (${entry.marks} marks)`,
      10,
      true,
    )
    addText(`Scheme: ${entry.scheme}`, 9)
    y += 2
  }

  if (input.ocrText) {
    addText('OCR Extracted Text', 13, true)
    addText(input.ocrText, 9)
    y += 4
  }

  if (input.llmResults.length > 0) {
    addText('LLM Grading Analysis', 13, true)
    for (const r of input.llmResults) {
      addText(
        `Question ${r.questionNumber} — ${formatMarks(r.marks)}`,
        11,
        true,
      )
      addText(`Student Answer: ${r.extractedAnswer}`, 9)
      addText(`Feedback: ${r.feedback}`, 9)
      addText(
        `Running Total: ${formatTotal(r.runningTotal)}${r.humanReview ? ' ⚠ Human Review' : ''}`,
        9,
      )
      y += 3
    }
  }

  if (input.annotatedImage?.startsWith('data:image/png')) {
    try {
      doc.addPage()
      y = 20
      addText('Annotated Image', 13, true)
      const imgProps = doc.getImageProperties(input.annotatedImage)
      const imgWidth = maxWidth
      const imgHeight = (imgProps.height / imgProps.width) * imgWidth
      doc.addImage(
        input.annotatedImage,
        'PNG',
        margin,
        y,
        imgWidth,
        Math.min(imgHeight, 200),
      )
    } catch {
      // skip image if it fails
    }
  }
}
