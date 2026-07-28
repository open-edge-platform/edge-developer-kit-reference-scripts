// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import type React from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import NextImage from 'next/image'
import { v4 as uuidv4 } from 'uuid'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import {
  Camera,
  UserPen,
  ClipboardList,
  Clock,
  Download,
  Expand,
  FileImage,
  FolderOpen,
  RefreshCw,
  RotateCcw,
  ScanText,
  Settings2,
  Sparkles,
  Upload,
  Printer,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react'
import { jsPDF } from 'jspdf'
import type {
  DataEntry,
  LLMResultEntry,
  SavedRecord,
} from '@/lib/ai-exam-marking/types'
import { WebcamStream } from '@/components/common/webcam-stream'
import { useWebcamStream } from '@/hooks/use-webcam-stream'
import { useGrading } from '@/samples/ai-exam-marking/hooks/useGrading'
import { useOCR } from '@/samples/ai-exam-marking/hooks/useOCR'
import { useGetService } from '@/context/service-status-context'

const MARKING_DATA_DIR = '/data/ai-exam-marking'

const DEFAULT_OCR_PROMPT = `Given an image of a student answer sheet, extract the following information and return it as a single JSON object.

1. Student information (usually found in the header or top section of the sheet):
- 'student_name': The student's full name as a string (empty string if not found)
- 'student_id': The student's ID or registration number as a string (empty string if not found)

2. Each question and its corresponding answer(s) as numbered entries. Each entry should use the question number as the key and contain 'question' and 'answer' fields. The answer should be a single string combining all bullet points separated by semicolons.

If a question does not have an answer, set the answer field to an empty string. If the question number is missing, skip that question. Do not include any additional text or formatting outside of the JSON structure.

Example output:
{
'student_name': 'John Smith',
'student_id': 'S12345',
'1': {
'question': 'Explain one way a business could increase its gross profit margin.',
'answer': 'increase selling price'
},
'2': {
'question': 'Analyze the importance to Backyard Shoes of satisfying customer needs.',
'answer': 'lead to customer loyalty; build brand image'
},
'3': {
'question': 'Explain one method of above the line promotion a business could use. [3m]',
'answer': 'tv ads; promotes to large audience'
}
}
Your task is to generate the exact same structured JSON output based on the provided image content.`

const DEFAULT_LLM_PROMPT = `You are an AI grading assistant tasked with evaluating student answers based on a provided marking scheme for each question.

This question is about: {question}, with a maximum of {marks} marks.

The student answer may consist of the question starting with numbering and the student's answer; ignore the question and only grade the answer provided.
Only evaluate the student answer based on the question stated above and ignore all other questions.
Do not generate or complete the student answer based on the marking scheme if the student answer is empty or not provided.

The marking scheme for this question is:
{marking_scheme}

Follow these steps for this question:

1. Understand the Question and Marking Scheme

Read the question and the marking scheme.
Identify the required references and acceptable alternatives (e.g., synonyms, minor typos).

2. Evaluate the Student Answer.

Check if the answer explicitly references the required elements from the marking scheme.
Look for implied references.
Note minor errors (e.g., typos, incorrect terminology) but decide if they hinder understanding.

3. Apply the Marking Guidance

Award mark per valid reference (up to the maximum available).
Do not deduct marks for minor errors if the student's reasoning is clear and correct.
For open-ended criteria, ensure the explanation logically follows from the question.

4. Handle Ambiguity or Unlisted Answers

If the student's answer is correct but not explicitly covered in the marking scheme (e.g., a valid alternative method, creative solution, or answer phrased differently but logically equivalent):
Assign marks only if the marking scheme explicitly allows for alternative answers (e.g., "any correct method accepted," "multiple valid approaches").
If the marking scheme does not allow alternative answers, flag the response for human review by stating 'True'.

5. Provide Feedback

List the references identified in the student answer and assign marks accordingly.
Highlight errors or omissions but only penalize if required by the marking scheme.
Disregard irrelevant information.
Provide the feedback in only 10 words.

6. Finalize the Score

Sum the marks based on the marking scheme's criteria.

Return a JSON with the following fields:
student_answer: Student answer extracted based on question above. Do not include the question. 
feedback: A summary of the evaluation.
marks_awarded: The total marks given.
human_review: A boolean (true or false) indicating if the answer needs human review.`

type GradingEntry = {
  id: string
  studentName?: string
  studentId?: string
  uploadedImage: string
  annotatedImage: string
  overlayImage?: string
  ocrText?: string
  llmResults?: LLMResultEntry[]
  isProcessing: boolean
  processingStep?: string
  error?: string
  reviewed?: boolean
}

type GradingSectionProps = {
  dataEntries: DataEntry[]
  entries: GradingEntry[]
  setEntries: React.Dispatch<React.SetStateAction<GradingEntry[]>>
  saveRecord: (record: SavedRecord) => void
}

export type { GradingEntry }

function resizeImage(
  dataUrl: string,
  width: number,
  height: number,
): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(img, 0, 0, width, height)
      resolve(canvas.toDataURL('image/jpeg', 0.9))
    }
    img.src = dataUrl
  })
}

export function GradingSection({
  dataEntries,
  entries,
  setEntries,
  saveRecord,
}: GradingSectionProps) {
  const [ocrPrompt, setOcrPrompt] = useState(DEFAULT_OCR_PROMPT)
  const [llmPrompt, setLlmPrompt] = useState(DEFAULT_LLM_PROMPT)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [previewEntry, setPreviewEntry] = useState<{
    image: string
    label: string
    overlay?: string
  } | null>(null)
  const { mutateAsync: runOCR } = useOCR()
  const { mutateAsync: runGrading } = useGrading()
  const fileWatcherService = useGetService('file-watcher')
  const fileWatcherPort = fileWatcherService?.port ?? 8030

  const {
    devices,
    selectedDeviceId,
    videoRef,
    listDevices,
    startCamera,
    stopCamera,
    captureImage,
    isReady: webcamReady,
    error: webcamError,
  } = useWebcamStream()
  const [isWsActive, setIsWsActive] = useState(false)
  const [wsConnectState, setWsConnectState] = useState<
    'connecting' | 'connected'
  >('connecting')
  const wsStatus = isWsActive ? wsConnectState : 'disconnected'
  const [watchedPath, setWatchedPath] = useState('')
  const wsRef = useRef<WebSocket | null>(null)
  const addImageRef = useRef<(url: string) => void>(() => {})
  const [reviewEntry, setReviewEntry] = useState<{
    entryId: string
    uploadedImage: string
    label: string
    ocrText: string
    llmResults: LLMResultEntry[]
    studentName?: string
    studentId?: string
  } | null>(null)
  const [isRegenerating, setIsRegenerating] = useState(false)

  type QueueItem = {
    id: string
    dataUrl: string
    base64: string
  }
  const processingQueueRef = useRef<QueueItem[]>([])
  const isProcessingRef = useRef(false)
  const drainQueueRef = useRef<() => void>(() => {})

  const updateEntry = (id: string, patch: Partial<GradingEntry>) => {
    setEntries((prev) =>
      prev.map((e) => (e.id === id ? { ...e, ...patch } : e)),
    )
  }

  const removeEntry = (id: string) => {
    setEntries((prev) => prev.filter((e) => e.id !== id))
  }

  const retryEntry = (id: string, uploadedImage: string) => {
    const base64 = uploadedImage.split(',')[1]
    updateEntry(id, {
      isProcessing: true,
      error: undefined,
      processingStep: 'Queued…',
    })
    processingQueueRef.current.push({ id, dataUrl: uploadedImage, base64 })
    drainQueueRef.current()
  }

  const rotateImage = (imageSrc: string, degrees: number): Promise<string> => {
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
        const scale = Math.min(
          targetWidth / img.height,
          targetHeight / img.width,
        )
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

  const buildAnnotatedImage = async (
    uploadedImage: string,
    results: LLMResultEntry[],
  ): Promise<{ annotated: string; overlay: string }> => {
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
      const label = result.marksAwardedOverMaxMarks
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

      const [awarded, max] = label.split('/').map(Number)
      let iconPath = `${MARKING_DATA_DIR}/neutral.png`
      if (awarded === max) iconPath = `${MARKING_DATA_DIR}/correct.png`
      else if (awarded === 0) iconPath = `${MARKING_DATA_DIR}/wrong.png`

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
    const totalAwarded = results.reduce((sum, r) => {
      const [a] = r.marksAwardedOverMaxMarks.split('/').map(Number)
      return sum + (isNaN(a) ? 0 : a)
    }, 0)
    const totalMax = results.reduce((sum, r) => {
      const [, m] = r.marksAwardedOverMaxMarks.split('/').map(Number)
      return sum + (isNaN(m) ? 0 : m)
    }, 0)
    const totalLabel = `${totalAwarded}/${totalMax}`
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

  const processImage = async (
    entryId: string,
    uploadedImage: string,
    base64: string,
  ) => {
    updateEntry(entryId, {
      isProcessing: true,
      error: undefined,
      processingStep: 'Extracting text…',
      ocrText: undefined,
      llmResults: undefined,
      annotatedImage: '',
      overlayImage: undefined,
    })
    try {
      const parsed = await runOCR({ image: base64, prompt: ocrPrompt })
      const ocrResult: Record<number, { question: string; answer: string }> = {}
      let studentName = ''
      let studentId = ''
      for (const [key, value] of Object.entries(parsed)) {
        if (key === 'student_name') {
          studentName = typeof value === 'string' ? value : 'undefined'
          continue
        }
        if (key === 'student_id') {
          studentId = typeof value === 'string' ? value : 'undefined'
          continue
        }
        const numKey = Number(key)
        if (!Number.isFinite(numKey) || numKey <= 0) continue
        if (typeof value === 'object' && value !== null) {
          const obj = value as Record<string, string>
          ocrResult[numKey] = {
            question: obj.question ?? 'N/A',
            answer: obj.answer ?? '',
          }
        }
      }
      updateEntry(entryId, { studentName, studentId })

      const sortedDataEntries = [...(dataEntries ?? [])].sort(
        (a, b) => a.number - b.number,
      )
      const dataEntryByNumber = new Map(
        sortedDataEntries.map((entry) => [String(entry.number), entry]),
      )
      const fallbackQuestionNumbers = Object.keys(ocrResult)
        .map((key) => Number(key))
        .filter((num) => Number.isInteger(num) && num > 0)
        .sort((a, b) => a - b)
      const questionNumbers =
        sortedDataEntries.length > 0
          ? sortedDataEntries.map((entry) => Number(entry.number))
          : fallbackQuestionNumbers

      const totalQuestions = questionNumbers.length
      const newResults: LLMResultEntry[] = []
      let accumulatedMarks = 0
      let accumulatedMaxMarks = 0
      let lastPrompt = llmPrompt

      for (let i = 0; i < totalQuestions; i++) {
        updateEntry(entryId, {
          processingStep: `Grading question ${i + 1} of ${totalQuestions}…`,
        })
        const qNumber = String(questionNumbers[i])
        const qInfo = dataEntryByNumber.get(qNumber)
        const question =
          qInfo?.question ?? ocrResult[questionNumbers[i]]?.question ?? 'N/A'
        const scheme = qInfo?.scheme ?? 'N/A'
        const numericMaxMarks = Number(qInfo?.marks)
        const maxMarks = Number.isFinite(numericMaxMarks)
          ? String(numericMaxMarks)
          : 'N/A'

        const finalPrompt = llmPrompt
          .replace('{question}', question)
          .replace('{marks}', String(maxMarks))
          .replace('{marking_scheme}', scheme)
        lastPrompt = finalPrompt

        const gradingResultObj = await runGrading({
          prompt: finalPrompt,
          answer: ocrResult[questionNumbers[i]]?.answer ?? '',
        })
        if (!gradingResultObj) continue

        const numericGivenMarks = Number(gradingResultObj?.marks_awarded)
        const givenMarks = Number.isFinite(numericGivenMarks)
          ? numericGivenMarks
          : 0
        accumulatedMarks += givenMarks
        accumulatedMaxMarks += Number.isFinite(numericMaxMarks)
          ? numericMaxMarks
          : 0

        newResults.push({
          questionNumber: qNumber,
          extractedAnswer: gradingResultObj?.student_answer ?? 'N/A',
          feedback: gradingResultObj?.feedback ?? 'N/A',
          marksAwardedOverMaxMarks: `${givenMarks}/${maxMarks}`,
          marksAccumulatedOverMaxMarksAccumulated: `${accumulatedMarks}/${accumulatedMaxMarks}`,
          humanReview: gradingResultObj?.human_review ?? false,
        })
      }

      updateEntry(entryId, { processingStep: 'Annotating image…' })
      const { annotated: annotatedImage, overlay: overlayImage } =
        await buildAnnotatedImage(uploadedImage, newResults)
      const ocrText = Object.entries(ocrResult)
        .map(([num, { question, answer }]) => `${num}. ${question}\n${answer}`)
        .join('\n\n')

      updateEntry(entryId, {
        annotatedImage,
        overlayImage,
        ocrText,
        llmResults: newResults,
        isProcessing: false,
      })

      const record: SavedRecord = {
        id: entryId,
        timestamp: new Date().toISOString(),
        studentName: studentName || undefined,
        studentId: studentId || entryId || undefined,
        dataEntries: (dataEntries ?? []).map((e) => ({
          number: e.number.toString(),
          question: e.question,
          marks: e.marks.toString(),
          scheme: e.scheme,
        })),
        ocrResult: {
          text: ocrText,
          imagePreview: annotatedImage,
          overlayImage,
        },
        llmResult: { prompt: lastPrompt, response: newResults },
      }
      saveRecord(record)
    } catch {
      updateEntry(entryId, {
        isProcessing: false,
        error: 'Processing failed. Please try again.',
      })
    }
  }

  useEffect(() => {
    drainQueueRef.current = () => {
      if (isProcessingRef.current) return
      const next = processingQueueRef.current.shift()
      if (!next) return
      isProcessingRef.current = true
      processImage(next.id, next.dataUrl, next.base64).finally(() => {
        isProcessingRef.current = false
        drainQueueRef.current()
      })
    }
  })

  const addImageFromDataUrl = useCallback(
    (dataUrl: string) => {
      const id = uuidv4().replace(/\D/g, '').slice(-8).padStart(8, '0')
      const base64 = dataUrl.split(',')[1]
      const entry: GradingEntry = {
        id,
        uploadedImage: dataUrl,
        annotatedImage: '',
        isProcessing: true,
        processingStep: 'Queued…',
      }
      setEntries((prev) => [...prev, entry])
      processingQueueRef.current.push({ id, dataUrl, base64 })
      drainQueueRef.current()
    },
    [setEntries],
  )

  useEffect(() => {
    addImageRef.current = addImageFromDataUrl
  }, [addImageFromDataUrl])

  useEffect(() => {
    if (!isWsActive) {
      wsRef.current?.close()
      wsRef.current = null
      return
    }

    const wsUrl = new URL(`ws://127.0.0.1:${fileWatcherPort}/ws`)
    if (watchedPath.trim()) wsUrl.searchParams.set('path', watchedPath.trim())
    const ws = new WebSocket(wsUrl.toString())
    wsRef.current = ws

    const mimeMap: Record<string, string> = {
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      png: 'image/png',
      gif: 'image/gif',
      webp: 'image/webp',
    }

    ws.onopen = () => setWsConnectState('connected')

    ws.onmessage = async (event) => {
      try {
        const data = JSON.parse(event.data as string) as {
          filename: string
          base64: string
        }
        const ext = data.filename.split('.').pop()?.toLowerCase() ?? ''
        const mimeType = mimeMap[ext] ?? 'image/jpeg'
        const dataUrl = `data:${mimeType};base64,${data.base64}`
        const resized = await resizeImage(dataUrl, 612, 792)
        addImageRef.current(resized)
      } catch {
        // ignore malformed messages
      }
    }

    ws.onerror = () => setWsConnectState('connecting')

    ws.onclose = () => {
      wsRef.current = null
      setWsConnectState('connecting')
      setIsWsActive(false)
    }

    return () => {
      ws.close()
      wsRef.current = null
    }
  }, [isWsActive, watchedPath, fileWatcherPort])

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    const reader = new FileReader()
    reader.onload = async (ev) => {
      const dataUrl = ev.target?.result
      if (typeof dataUrl !== 'string') return
      addImageFromDataUrl(await resizeImage(dataUrl, 612, 792))
    }
    reader.readAsDataURL(file)
  }

  const handleCapture = async () => {
    const imageSrc = captureImage()
    if (!imageSrc) return
    const rotated = await rotateImage(imageSrc, 270)
    const resized = await resizeImage(rotated, 612, 792)
    addImageFromDataUrl(resized)
  }

  const handleDownload = (annotatedImage: string) => {
    const link = document.createElement('a')
    link.href = annotatedImage
    link.download = `graded-${Date.now()}.png`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  const exportEntry = (entry: GradingEntry, label: string) => {
    const doc = new jsPDF()
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

    addText(`Grading Report — ${label}`, 16, true)
    addText(`Exported: ${new Date().toLocaleString()}`, 9)
    y += 4

    addText('Marking Scheme', 13, true)
    for (const de of dataEntries) {
      addText(`Q${de.number}: ${de.question} (${de.marks} marks)`, 10, true)
      addText(`Scheme: ${de.scheme}`, 9)
      y += 2
    }

    if (entry.ocrText) {
      addText('OCR Extracted Text', 13, true)
      addText(entry.ocrText, 9)
      y += 4
    }

    if (entry.llmResults && entry.llmResults.length > 0) {
      addText('LLM Grading Analysis', 13, true)
      for (const r of entry.llmResults) {
        addText(
          `Question ${r.questionNumber} — ${r.marksAwardedOverMaxMarks}`,
          11,
          true,
        )
        addText(`Student Answer: ${r.extractedAnswer}`, 9)
        addText(`Feedback: ${r.feedback}`, 9)
        addText(
          `Running Total: ${r.marksAccumulatedOverMaxMarksAccumulated}${r.humanReview ? ' ⚠ Human Review' : ''}`,
          9,
        )
        y += 3
      }
    }

    if (entry.annotatedImage?.startsWith('data:image/png')) {
      try {
        doc.addPage()
        y = 20
        addText('Annotated Image', 13, true)
        const imgProps = doc.getImageProperties(entry.annotatedImage)
        const imgWidth = maxWidth
        const imgHeight = (imgProps.height / imgProps.width) * imgWidth
        doc.addImage(
          entry.annotatedImage,
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

    doc.save(`grading-report-${entry.studentId || entry.id}.pdf`)
  }

  return (
    <div className="space-y-6">
      {/* Settings Dialog */}
      <Dialog open={isSettingsOpen} onOpenChange={setIsSettingsOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Settings2 className="h-4 w-4" />
              Grading Configuration
            </DialogTitle>
            <DialogDescription className="text-xs">
              Customize the prompts used during OCR extraction and AI grading.
              Changes apply to all subsequent gradings.
            </DialogDescription>
          </DialogHeader>

          <Tabs defaultValue="ocr" className="mt-2">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="ocr" className="gap-2 text-xs">
                <ScanText className="h-3.5 w-3.5" />
                OCR/VLM Prompt
              </TabsTrigger>
              <TabsTrigger value="llm" className="gap-2 text-xs">
                <Sparkles className="h-3.5 w-3.5" />
                LLM Grading Prompt
              </TabsTrigger>
            </TabsList>

            <TabsContent value="ocr" className="mt-4 space-y-3">
              <div className="bg-muted/40 rounded-lg border px-4 py-3">
                <p className="text-muted-foreground text-xs leading-relaxed">
                  Sent to the vision model to extract text from each uploaded
                  answer sheet image. Use{' '}
                  <code className="bg-muted rounded px-1 font-mono">
                    plain text instructions
                  </code>{' '}
                  only — no template variables needed.
                </p>
              </div>
              <Textarea
                value={ocrPrompt}
                onChange={(e) => setOcrPrompt(e.target.value)}
                className="max-h-[320px] font-mono text-xs"
                placeholder="Enter OCR extraction instructions..."
              />
              <div className="flex justify-end">
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground hover:text-foreground gap-1.5 text-xs"
                  onClick={() => setOcrPrompt(DEFAULT_OCR_PROMPT)}
                >
                  <RotateCcw className="h-3 w-3" />
                  Reset to default
                </Button>
              </div>
            </TabsContent>

            <TabsContent value="llm" className="mt-4 space-y-3">
              <div className="bg-muted/40 rounded-lg border px-4 py-3">
                <p className="text-muted-foreground text-xs leading-relaxed">
                  Sent to the LLM for each question. Use the template variables{' '}
                  <code className="bg-muted rounded px-1 font-mono">
                    {'{question}'}
                  </code>
                  ,{' '}
                  <code className="bg-muted rounded px-1 font-mono">
                    {'{marks}'}
                  </code>
                  , and{' '}
                  <code className="bg-muted rounded px-1 font-mono">
                    {'{marking_scheme}'}
                  </code>{' '}
                  which are substituted automatically.
                </p>
              </div>
              <Textarea
                value={llmPrompt}
                onChange={(e) => setLlmPrompt(e.target.value)}
                className="max-h-[320px] font-mono text-xs"
                placeholder="Enter LLM grading instructions..."
              />
              <div className="flex justify-end">
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground hover:text-foreground gap-1.5 text-xs"
                  onClick={() => setLlmPrompt(DEFAULT_LLM_PROMPT)}
                >
                  <RotateCcw className="h-3 w-3" />
                  Reset to default
                </Button>
              </div>
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>

      {/* Image Input */}
      <Card>
        <CardHeader className="flex flex-row items-start justify-between">
          <div>
            <CardTitle>Add Answer Sheets</CardTitle>
            <CardDescription className="mt-1 text-xs">
              Upload or capture images — each will be graded automatically
            </CardDescription>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="gap-2 text-xs"
            onClick={() => setIsSettingsOpen(true)}
          >
            <Settings2 className="h-4 w-4" />
            Edit Prompts
            <span className="sr-only">Grading settings</span>
          </Button>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="upload" className="w-full">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="upload" className="text-xs">
                <Upload className="mr-2 h-4 w-4" />
                Upload
              </TabsTrigger>
              <TabsTrigger value="webcam" className="text-xs">
                <Camera className="mr-2 h-4 w-4" />
                Camera
              </TabsTrigger>
              <TabsTrigger value="scanner" className="text-xs">
                <Printer className="mr-2 h-4 w-4" />
                Scanner
              </TabsTrigger>
            </TabsList>

            <TabsContent value="upload" className="mt-4">
              <div className="border-border bg-muted/20 hover:bg-muted/40 flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-12 transition-colors">
                <FileImage className="text-muted-foreground mb-4 h-12 w-12" />
                <Label
                  htmlFor="grading-image-upload"
                  className="cursor-pointer"
                >
                  <div className="text-center">
                    <p className="text-foreground mb-2 text-sm font-medium">
                      Click to upload or drag and drop
                    </p>
                    <p className="text-muted-foreground text-xs">
                      PNG, JPG, JPEG up to 10MB
                    </p>
                  </div>
                </Label>
                <Input
                  id="grading-image-upload"
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleFileUpload}
                />
                <Button
                  className="mt-4 text-xs"
                  onClick={() =>
                    document.getElementById('grading-image-upload')?.click()
                  }
                >
                  <Upload className="mr-2 h-4 w-4" />
                  Select Image
                </Button>
              </div>
            </TabsContent>

            <TabsContent value="scanner" className="mt-4">
              <div className="bg-muted/20 rounded-lg border">
                <div className="flex flex-col items-center justify-center gap-4 p-8">
                  <div className="w-full space-y-1.5">
                    <Label htmlFor="scanner-watch-path" className="text-xs">
                      Watched Folder Path
                    </Label>
                    <div className="relative">
                      <FolderOpen className="text-muted-foreground absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2" />
                      <Input
                        id="scanner-watch-path"
                        value={watchedPath}
                        onChange={(e) => setWatchedPath(e.target.value)}
                        placeholder="Enter the path to watch (e.g., /home/user/Documents or C:\Users\John\Documents)"
                        disabled={isWsActive}
                        className="h-8 pl-7 font-mono text-xs"
                      />
                    </div>
                  </div>
                  <div
                    className={`rounded-full p-4 ${
                      wsStatus === 'connected'
                        ? 'bg-green-100 dark:bg-green-900/30'
                        : wsStatus === 'connecting'
                          ? 'bg-yellow-100 dark:bg-yellow-900/30'
                          : 'bg-muted'
                    }`}
                  >
                    {wsStatus === 'connected' ? (
                      <Wifi className="h-10 w-10 text-green-600 dark:text-green-400" />
                    ) : (
                      <WifiOff className="text-muted-foreground h-10 w-10" />
                    )}
                  </div>
                  <div className="space-y-1 text-center">
                    <p className="text-foreground text-sm font-medium">
                      {wsStatus === 'connected'
                        ? 'Ready to receive scanned papers…'
                        : wsStatus === 'connecting'
                          ? 'Connecting…'
                          : 'Auto-Grade via Scanner'}
                    </p>
                    <p className="text-muted-foreground text-xs">
                      {wsStatus === 'connected'
                        ? 'Scan answer sheets to the watched folder — each will be graded automatically as it arrives.'
                        : 'Connect and scan answer sheets directly to the watched folder. Each scanned image will be picked up and graded automatically.'}
                    </p>
                  </div>
                  <Button
                    className="mt-2 text-xs"
                    variant={isWsActive ? 'destructive' : 'default'}
                    onClick={() => setIsWsActive((v) => !v)}
                  >
                    {isWsActive ? (
                      <>
                        <WifiOff className="mr-2 h-4 w-4" />
                        Disconnect
                      </>
                    ) : (
                      <>
                        <Wifi className="mr-2 h-4 w-4" />
                        Connect
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="webcam" className="mt-4">
              <WebcamStream
                videoRef={videoRef}
                isReady={webcamReady}
                error={webcamError}
                startCamera={startCamera}
                stopCamera={stopCamera}
                devices={devices}
                selectedDeviceId={selectedDeviceId}
                listDevices={listDevices}
              />
              {webcamReady && (
                <div className="mt-4 flex justify-center">
                  <Button onClick={handleCapture} className="flex-1">
                    <Camera className="mr-2 h-4 w-4" />
                    Capture Photo
                  </Button>
                </div>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* Results Grid */}
      {entries.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {entries.map((entry, idx) => {
            const entryLabel = entry.studentId
              ? `Answer Sheet - ${entry.studentId}`
              : `Answer Sheet - ${entry.id}`
            return (
              <Card key={entry.id} className="gap-2 overflow-hidden">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-sm font-medium">
                      {entryLabel}
                    </CardTitle>
                    {!entry.isProcessing &&
                      entry.llmResults &&
                      entry.llmResults.length > 0}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0"
                    onClick={() => removeEntry(entry.id)}
                    disabled={entry.isProcessing}
                  >
                    <X className="h-4 w-4" />
                    <span className="sr-only">Remove</span>
                  </Button>
                </CardHeader>
                <CardContent className="p-4 pt-0">
                  {entry.isProcessing ? (
                    <div className="relative aspect-[3/4] overflow-hidden rounded-lg border">
                      <NextImage
                        src={entry.uploadedImage}
                        alt="Processing"
                        fill
                        unoptimized
                        className="scale-105 object-cover opacity-20 blur-sm"
                      />
                      <div className="from-background/60 to-background/95 absolute inset-0 bg-gradient-to-t" />
                      <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-4">
                        <div className="bg-background/90 ring-border/50 animate-pulse rounded-full p-3.5 shadow-md ring-1">
                          {entry.processingStep === 'Queued…' ? (
                            <Clock className="text-muted-foreground h-5 w-5" />
                          ) : entry.processingStep?.includes('Extracting') ? (
                            <ScanText className="text-primary h-5 w-5" />
                          ) : entry.processingStep?.includes('Annotating') ? (
                            <FileImage className="text-primary h-5 w-5" />
                          ) : (
                            <Sparkles className="text-primary h-5 w-5" />
                          )}
                        </div>
                        <div className="space-y-2 text-center">
                          <p className="text-foreground text-xs font-medium">
                            {entry.processingStep ?? 'Processing…'}
                          </p>
                          {entry.processingStep !== 'Queued…' && (
                            <div className="flex justify-center gap-1">
                              <span className="bg-primary h-1.5 w-1.5 animate-bounce rounded-full [animation-delay:-0.3s]" />
                              <span className="bg-primary h-1.5 w-1.5 animate-bounce rounded-full [animation-delay:-0.15s]" />
                              <span className="bg-primary h-1.5 w-1.5 animate-bounce rounded-full" />
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ) : entry.error ? (
                    <div className="relative aspect-[3/4] overflow-hidden rounded-lg border">
                      <NextImage
                        src={entry.uploadedImage}
                        alt="Failed to process"
                        fill
                        unoptimized
                        className="object-cover opacity-40"
                      />
                      <div className="from-background/60 to-background/95 absolute inset-0 bg-gradient-to-t" />
                      <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-4 text-center">
                        <p className="text-destructive text-xs font-medium">
                          {entry.error}
                        </p>
                        <Button
                          size="sm"
                          className="text-xs"
                          onClick={() =>
                            retryEntry(entry.id, entry.uploadedImage)
                          }
                        >
                          <RefreshCw className="mr-2 h-3.5 w-3.5" />
                          Retry Grading
                        </Button>
                      </div>
                    </div>
                  ) : entry.annotatedImage ? (
                    <div className="overflow-hidden rounded-lg border">
                      <NextImage
                        src={entry.annotatedImage}
                        alt={`Graded answer sheet ${idx + 1}`}
                        width={600}
                        height={800}
                        unoptimized
                        className="h-auto w-full object-contain"
                      />
                    </div>
                  ) : (
                    <div className="overflow-hidden rounded-lg border">
                      <NextImage
                        src={entry.uploadedImage}
                        alt={`Answer sheet ${idx + 1}`}
                        width={600}
                        height={800}
                        unoptimized
                        className="h-auto w-full object-contain"
                      />
                    </div>
                  )}
                </CardContent>

                {entry.annotatedImage && !entry.isProcessing && (
                  <CardFooter className="grid gap-1.5 px-4">
                    <div className="grid grid-cols-3 gap-1.5">
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-xs"
                        onClick={() =>
                          setPreviewEntry({
                            image: entry.annotatedImage,
                            label: entryLabel,
                            overlay: entry.overlayImage,
                          })
                        }
                      >
                        <Expand className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className={
                          !entry.reviewed &&
                          entry.llmResults?.some((r) => r.humanReview)
                            ? 'text-destructive hover:text-destructive border-destructive/40 hover:bg-destructive/10 text-xs'
                            : 'text-xs'
                        }
                        onClick={() =>
                          setReviewEntry({
                            entryId: entry.id,
                            uploadedImage: entry.uploadedImage,
                            label: entryLabel,
                            ocrText: entry.ocrText ?? '',
                            llmResults: entry.llmResults
                              ? entry.llmResults.map((r) => ({ ...r }))
                              : [],
                            studentName: entry.studentName,
                            studentId: entry.studentId,
                          })
                        }
                      >
                        <UserPen className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-xs"
                        onClick={() => exportEntry(entry, entryLabel)}
                      >
                        <Download className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </CardFooter>
                )}
              </Card>
            )
          })}
        </div>
      )}

      {/* Human Review Dialog */}
      <Dialog
        open={reviewEntry !== null}
        onOpenChange={(open) => !open && setReviewEntry(null)}
      >
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ClipboardList className="h-4 w-4" />
              {reviewEntry?.label} — Human Review
            </DialogTitle>
            <DialogDescription className="text-xs">
              Extracted OCR text and AI grading results for manual verification.
              Edit marks or feedback then click Regenerate.
            </DialogDescription>
          </DialogHeader>
          {reviewEntry && (
            <Tabs defaultValue="grading" className="mt-2">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="ocr" className="gap-2 text-xs">
                  <ScanText className="h-3.5 w-3.5" />
                  OCR Text
                </TabsTrigger>
                <TabsTrigger value="grading" className="gap-2 text-xs">
                  <Sparkles className="h-3.5 w-3.5" />
                  Grading Results
                </TabsTrigger>
              </TabsList>
              <TabsContent value="ocr" className="mt-3">
                <pre className="bg-muted max-h-[60vh] overflow-auto rounded-lg p-4 text-xs break-words whitespace-pre-wrap">
                  {reviewEntry.ocrText || 'No OCR text available.'}
                </pre>
              </TabsContent>
              <TabsContent value="grading" className="mt-3 space-y-3">
                <div className="max-h-[50vh] overflow-auto rounded-lg border">
                  <table className="w-full text-xs">
                    <thead className="bg-muted sticky top-0">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium">Q</th>
                        <th className="px-3 py-2 text-left font-medium">
                          Answer
                        </th>
                        <th className="px-3 py-2 text-left font-medium">
                          Feedback
                        </th>
                        <th className="px-3 py-2 text-left font-medium">
                          Marks
                        </th>
                        <th className="px-3 py-2 text-left font-medium">
                          Review
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {reviewEntry.llmResults.map((r, rIdx) => (
                        <tr key={r.questionNumber} className="border-t">
                          <td className="px-3 py-2 font-medium">
                            {r.questionNumber}
                          </td>
                          <td className="max-w-[180px] px-3 py-2 whitespace-pre-wrap">
                            {r.extractedAnswer}
                          </td>
                          <td className="max-w-[200px] px-3 py-2">
                            <Textarea
                              className="min-h-[60px] text-xs"
                              value={r.feedback}
                              onChange={(e) =>
                                setReviewEntry((prev) => {
                                  if (!prev) return prev
                                  const updated = prev.llmResults.map(
                                    (item, i) =>
                                      i === rIdx
                                        ? { ...item, feedback: e.target.value }
                                        : item,
                                  )
                                  return { ...prev, llmResults: updated }
                                })
                              }
                            />
                          </td>
                          <td className="px-3 py-2">
                            <Input
                              className="h-7 w-20 text-xs"
                              value={r.marksAwardedOverMaxMarks}
                              onChange={(e) =>
                                setReviewEntry((prev) => {
                                  if (!prev) return prev
                                  const updated = prev.llmResults.map(
                                    (item, i) =>
                                      i === rIdx
                                        ? {
                                            ...item,
                                            marksAwardedOverMaxMarks:
                                              e.target.value,
                                          }
                                        : item,
                                  )
                                  return { ...prev, llmResults: updated }
                                })
                              }
                            />
                          </td>
                          <td className="px-3 py-2">
                            {r.humanReview ? (
                              <span className="text-destructive font-semibold">
                                Yes
                              </span>
                            ) : (
                              <span className="text-muted-foreground">No</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Button
                  className="w-full text-xs"
                  disabled={isRegenerating}
                  onClick={async () => {
                    if (!reviewEntry) return
                    setIsRegenerating(true)
                    try {
                      const {
                        annotated: annotatedImage,
                        overlay: overlayImage,
                      } = await buildAnnotatedImage(
                        reviewEntry.uploadedImage,
                        reviewEntry.llmResults,
                      )
                      updateEntry(reviewEntry.entryId, {
                        annotatedImage,
                        overlayImage,
                        llmResults: reviewEntry.llmResults,
                        reviewed: true,
                      })
                      const record: SavedRecord = {
                        id: reviewEntry.entryId,
                        timestamp: new Date().toISOString(),
                        studentName: reviewEntry.studentName || undefined,
                        studentId:
                          reviewEntry.studentId ||
                          reviewEntry.entryId ||
                          undefined,
                        dataEntries: (dataEntries ?? []).map((e) => ({
                          number: e.number.toString(),
                          question: e.question,
                          marks: e.marks.toString(),
                          scheme: e.scheme,
                        })),
                        ocrResult: {
                          text: reviewEntry.ocrText,
                          imagePreview: annotatedImage,
                          overlayImage,
                        },
                        llmResult: {
                          prompt: llmPrompt,
                          response: reviewEntry.llmResults,
                        },
                      }
                      saveRecord(record)
                      setReviewEntry(null)
                    } finally {
                      setIsRegenerating(false)
                    }
                  }}
                >
                  {isRegenerating ? (
                    <>
                      <span className="bg-primary mr-2 h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
                      Regenerating…
                    </>
                  ) : (
                    <>
                      <ScanText className="mr-2 h-4 w-4" />
                      Regenerate Annotations
                    </>
                  )}
                </Button>
              </TabsContent>
            </Tabs>
          )}
        </DialogContent>
      </Dialog>

      {/* Image Preview Dialog */}
      <Dialog
        open={previewEntry !== null}
        onOpenChange={(open) => !open && setPreviewEntry(null)}
      >
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{previewEntry?.label}</DialogTitle>
          </DialogHeader>
          {previewEntry && (
            <div className="space-y-4">
              <div className="max-h-[70vh] overflow-auto rounded-lg border">
                <NextImage
                  src={previewEntry.image}
                  alt={previewEntry.label}
                  width={1200}
                  height={1600}
                  unoptimized
                  className="h-auto w-full object-contain"
                />
              </div>
              <div className="flex gap-2">
                <Button
                  className="flex-1 text-xs"
                  disabled={!previewEntry.overlay}
                  onClick={() => {
                    if (!previewEntry.overlay) return
                    const win = window.open('', '_blank')
                    if (!win) return
                    win.document.write(
                      `<!DOCTYPE html><html><head><title>${previewEntry.label}</title><style>` +
                        `@page{size:A4;margin:0}body{margin:0;padding:0}` +
                        `img{width:100%;height:auto;display:block}` +
                        `</style></head><body>` +
                        `<img src="${previewEntry.overlay}" />` +
                        `</body></html>`,
                    )
                    win.document.close()
                    win.onload = () => {
                      win.print()
                      win.close()
                    }
                  }}
                >
                  <Printer className="mr-2 h-4 w-4" />
                  Print Overlay
                </Button>
                <Button
                  variant="outline"
                  className="flex-1 text-xs"
                  onClick={() => handleDownload(previewEntry.image)}
                >
                  <Download className="mr-2 h-4 w-4" />
                  Download
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
