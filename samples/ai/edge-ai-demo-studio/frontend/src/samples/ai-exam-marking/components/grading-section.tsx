// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import type React from 'react'
import { useEffect, useRef, useState } from 'react'
import NextImage from 'next/image'
import { v4 as uuidv4 } from 'uuid'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
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
  Clock,
  Download,
  Expand,
  FileImage,
  RotateCcw,
  ScanText,
  Settings2,
  Sparkles,
  Upload,
  X,
} from 'lucide-react'
import type {
  DataEntry,
  LLMResultEntry,
  SavedRecord,
} from '@/lib/ai-exam-marking/types'
import { WebcamStream } from '@/components/common/webcam-stream'
import { useWebcamStream } from '@/hooks/use-webcam-stream'
import { useGrading } from '@/samples/ai-exam-marking/hooks/useGrading'
import { useOCR } from '@/samples/ai-exam-marking/hooks/useOCR'

const MARKING_DATA_DIR = '/data/ai-exam-marking'

const DEFAULT_OCR_PROMPT = `Given the following questions and answers from an image, extract each question and its corresponding answer(s) as a question-and-answer pair in a structured JSON format. Each entry should be numbered (e.g., 1, 2, 3, etc.), with the question as the text and the answer as a single string (combining all bullet points from the original answer array, separated by semicolons). Return the output as a dictionary where each key is the question number, and the value is another dictionary containing 'question' and 'answer' keys. For example:
If a question does not have an answer, set the answer field to an empty string. If the question number is missing, skip that question and do not include it in the output. Do not include any additional text or formatting outside of the JSON structure.
{
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
  uploadedImage: string
  annotatedImage: string
  isProcessing: boolean
  processingStep?: string
  error?: string
}

type GradingSectionProps = {
  dataEntries: DataEntry[]
  entries: GradingEntry[]
  setEntries: React.Dispatch<React.SetStateAction<GradingEntry[]>>
  saveRecord: (record: SavedRecord) => void
}

export type { GradingEntry }

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
  } | null>(null)
  const { mutateAsync: runOCR } = useOCR()
  const { mutateAsync: runGrading } = useGrading()

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
  ): Promise<string> => {
    const img = new globalThis.Image()
    const imageLoaded = await new Promise<boolean>((resolve) => {
      img.onload = () => resolve(true)
      img.onerror = () => resolve(false)
      img.src = uploadedImage
    })
    if (!imageLoaded) return uploadedImage

    const canvas = document.createElement('canvas')
    canvas.width = img.width
    canvas.height = img.height
    const ctx = canvas.getContext('2d')
    if (!ctx) return uploadedImage

    ctx.drawImage(img, 0, 0)

    for (let i = 0; i < dataEntries.length; i++) {
      const entry = dataEntries[i]
      const result = results.find(
        (r) => r.questionNumber === entry.number.toString(),
      )
      if (!entry.boundingBox || !result) continue

      const { x1, y1, x2 } = entry.boundingBox
      const label = result.marksAwardedOverMaxMarks
      ctx.font =
        "italic 28px 'Shadows Into Light Regular', 'Segoe Script', 'Brush Script MT', cursive"
      const padding = 2
      const iconGap = 8
      const textMetrics = ctx.measureText(label)
      const textWidth = textMetrics.width
      const textHeight = 28
      const textX = x2 - textWidth - padding
      const textY = y1 + textHeight + padding

      ctx.fillStyle = 'red'
      ctx.fillText(label, textX, textY)

      const [awarded, max] = label.split('/').map(Number)
      let iconPath = `${MARKING_DATA_DIR}/neutral.png`
      if (awarded === max) iconPath = `${MARKING_DATA_DIR}/correct.png`
      else if (awarded === 0) iconPath = `${MARKING_DATA_DIR}/wrong.png`

      const iconSize = 52
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
          resolve()
        }
        icon.onerror = () => resolve()
      })

      const feedback = result.feedback
      ctx.font =
        "italic 10px 'Shadows Into Light Regular', 'Segoe Script', 'Brush Script MT', cursive"
      const feedbackFontSize = 12
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
      lines.forEach((line, lineIdx) => {
        const lineWidth = ctx.measureText(line).width
        const feedbackX = x2 - lineWidth - padding
        const feedbackY = textY + textHeight + padding + lineIdx * lineHeight
        ctx.fillText(line, feedbackX, feedbackY)
      })
    }

    return canvas.toDataURL('image/png')
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
    })
    try {
      const parsed = await runOCR({ image: base64, prompt: ocrPrompt })
      const ocrResult: Record<number, { question: string; answer: string }> = {}
      for (const [key, value] of Object.entries(parsed)) {
        ocrResult[Number(key)] = {
          question: value.question ?? 'N/A',
          answer: value.answer ?? '',
        }
      }

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
      const annotatedImage = await buildAnnotatedImage(
        uploadedImage,
        newResults,
      )
      updateEntry(entryId, { annotatedImage, isProcessing: false })

      const ocrText = Object.entries(ocrResult)
        .map(([num, { question, answer }]) => `${num}. ${question}\n${answer}`)
        .join('\n\n')

      const record: SavedRecord = {
        id: entryId,
        timestamp: new Date().toISOString(),
        dataEntries: (dataEntries ?? []).map((e) => ({
          number: e.number.toString(),
          question: e.question,
          marks: e.marks.toString(),
          scheme: e.scheme,
        })),
        ocrResult: { text: ocrText, imagePreview: annotatedImage },
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

  const addImageFromDataUrl = (dataUrl: string) => {
    const id = `entry-${Date.now()}-${uuidv4()}`
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
  }

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    const reader = new FileReader()
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result
      if (typeof dataUrl !== 'string') return
      addImageFromDataUrl(dataUrl)
    }
    reader.readAsDataURL(file)
  }

  const handleCapture = async () => {
    const imageSrc = captureImage()
    if (!imageSrc) return
    const rotated = await rotateImage(imageSrc, 270)
    addImageFromDataUrl(rotated)
  }

  const handleDownload = (annotatedImage: string, index: number) => {
    const link = document.createElement('a')
    link.href = annotatedImage
    link.download = `graded-${index + 1}-${uuidv4()}.png`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
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
                OCR Prompt
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
        <CardHeader className="flex flex-row items-start justify-between space-y-0">
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
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="upload" className="text-xs">
                <Upload className="mr-2 h-4 w-4" />
                Upload
              </TabsTrigger>
              <TabsTrigger value="webcam" className="text-xs">
                <Camera className="mr-2 h-4 w-4" />
                Camera
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
          {entries.map((entry, idx) => (
            <Card key={entry.id} className="overflow-hidden">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">
                  Answer Sheet {idx + 1}
                </CardTitle>
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
              <CardContent className="space-y-3 p-4 pt-0">
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
                  <div className="bg-destructive/10 flex aspect-[3/4] flex-col items-center justify-center gap-2 rounded-lg border p-4 text-center">
                    <p className="text-destructive text-xs font-medium">
                      {entry.error}
                    </p>
                    <p className="text-muted-foreground text-xs">
                      You can remove this image and try again.
                    </p>
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

                {entry.annotatedImage && !entry.isProcessing && (
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      className="flex-1 text-xs"
                      onClick={() =>
                        setPreviewEntry({
                          image: entry.annotatedImage,
                          label: `Answer Sheet ${idx + 1}`,
                        })
                      }
                    >
                      <Expand className="mr-2 h-4 w-4" />
                      Preview
                    </Button>
                    <Button
                      variant="outline"
                      className="flex-1 text-xs"
                      onClick={() => handleDownload(entry.annotatedImage, idx)}
                    >
                      <Download className="mr-2 h-4 w-4" />
                      Download
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

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
              <Button
                className="w-full text-xs"
                onClick={() => {
                  const link = document.createElement('a')
                  link.href = previewEntry.image
                  link.download = `graded-${uuidv4()}.png`
                  document.body.appendChild(link)
                  link.click()
                  document.body.removeChild(link)
                }}
              >
                <Download className="mr-2 h-4 w-4" />
                Download
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
