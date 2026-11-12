// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { getErrorMessage } from '@/lib/errors'
import {
  buildAnnotatedImage,
  MARKING_DATA_DIR,
} from '@/samples/ai-exam-marking/lib/image-utils'
import {
  buildArchiveRequest,
  buildSavedRecord,
} from '@/samples/ai-exam-marking/lib/records'
import {
  SUBJECTS,
  type ArchiveRequest,
  type DataEntry,
  type GradingEntry,
  type LLMResultEntry,
  type SavedRecord,
  type Subject,
} from '@/samples/ai-exam-marking/lib/types'
import { useGrading, type GradingResult } from './use-grading'
import { useOCR } from './use-ocr'

interface UseGradingPipelineOptions {
  dataEntries: DataEntry[]
  subject: Subject
  ocrPrompt: string
  llmPrompt: string
  updateEntry: (id: string, patch: Partial<GradingEntry>) => void
  /** Saves the graded sheet's record, then archives it with the Exam Marking Agent. */
  finalizeEntry: (
    entryId: string,
    archive: ArchiveRequest,
    record: SavedRecord,
  ) => Promise<void>
  /** Unlocks a scanned sheet that was not saved, so the agent may send it again. */
  releaseSource: (filename: string | undefined) => void
}

/** Why a call failed, short enough to show on the answer sheet. */
function shortErrorMessage(error: unknown): string {
  const message = getErrorMessage(error, 'Unknown error')
  return message.length > 200 ? `${message.slice(0, 200)}…` : message
}

interface OcrSheet {
  /** Empty when the sheet does not show it. */
  studentName: string
  studentId: string
  /** Question and answer text by question number. */
  answers: Record<number, { question: string; answer: string }>
}

/** Drops the model's verdicts (e.g. "which is correct") from a `VISUAL:` graph description. */
function sanitizeVisualAnswer(answer: string): string {
  if (!answer.startsWith('VISUAL:')) return answer
  return answer
    .replace(/,?\s*but\s+the\s+graph\s+shown\s+has[^\]]*(?=\])/gi, '')
    .replace(/,?\s*which\s+is\s+(?:in)?correct[^\]]*(?=\])/gi, '')
    .replace(
      /,?\s*(?:this|it)\s+(?:is|looks)\s+(?:in)?correct[^\]]*(?=\])/gi,
      '',
    )
}

/** The OCR route's JSON: student fields plus one object per question number. */
function parseOcrSheet(parsed: Record<string, unknown>): OcrSheet {
  const sheet: OcrSheet = { studentName: '', studentId: '', answers: {} }
  for (const [key, value] of Object.entries(parsed)) {
    if (key === 'student_name') {
      if (typeof value === 'string') sheet.studentName = value
      continue
    }
    if (key === 'student_id') {
      // model doesn't reliably honor the "no spacing" instruction, so strip whitespace ourselves
      if (typeof value === 'string') sheet.studentId = value.replace(/\s+/g, '')
      continue
    }
    const numKey = Number(key)
    if (!Number.isFinite(numKey) || numKey <= 0) continue
    if (typeof value === 'object' && value !== null) {
      const obj = value as Record<string, string>
      sheet.answers[numKey] = {
        question: obj.question ?? 'N/A',
        answer: sanitizeVisualAnswer(obj.answer ?? ''),
      }
    }
  }
  return sheet
}

/** Remove an echoed "<n>. <question>" or "<question>" prefix (case-insensitive) from an OCR answer. */
function stripQuestionPrefix(
  answer: string,
  qNumber: string,
  question: string,
): string {
  const stripQuestion = (text: string) => {
    const t = text.trimStart()
    return t.slice(0, question.length).toLowerCase() === question.toLowerCase()
      ? t.slice(question.length).trimStart()
      : text
  }
  let rest = answer.trimStart()
  if (rest.startsWith(qNumber)) {
    const afterNumber = rest.slice(qNumber.length).replace(/^[.):-]?\s*/, '')
    const stripped = stripQuestion(afterNumber)
    if (stripped !== afterNumber) rest = stripped
  }
  return stripQuestion(rest).trim()
}

/**
 * OCR -> per-question grading -> annotate -> save, for one answer sheet. If a question fails, the
 * graded ones stay and the rest are flagged for review; only a fully graded sheet is saved.
 */
export function useGradingPipeline({
  dataEntries,
  subject,
  ocrPrompt,
  llmPrompt,
  updateEntry,
  finalizeEntry,
  releaseSource,
}: UseGradingPipelineOptions) {
  const { mutateAsync: runOCR } = useOCR()
  const { mutateAsync: runGrading } = useGrading()

  const processImage = async (
    entryId: string,
    uploadedImage: string,
    base64: string,
    sourceFilename?: string,
  ) => {
    updateEntry(entryId, {
      step: { phase: 'extracting' },
      error: undefined,
      ocrText: undefined,
      llmResults: undefined,
      annotatedImage: '',
      overlayImage: undefined,
    })
    try {
      // prepend subject context so the model applies the right grading strategy
      const subjectPrefix = `This is a ${subject} exam paper.\n\n`
      const {
        studentName,
        studentId,
        answers: ocrResult,
      } = parseOcrSheet(
        await runOCR({ image: base64, prompt: subjectPrefix + ocrPrompt }),
      )
      const ocrText = Object.entries(ocrResult)
        .map(([num, { question, answer }]) => `${num}. ${question}\n${answer}`)
        .join('\n\n')
      updateEntry(entryId, { studentName, studentId, ocrText })

      const sortedDataEntries = [...dataEntries].sort(
        (a, b) => a.number - b.number,
      )
      const dataEntryByNumber = new Map(
        sortedDataEntries.map((entry) => [String(entry.number), entry]),
      )
      const ocrQuestionNumbers = Object.keys(ocrResult)
        .map((key) => Number(key))
        .filter((num) => Number.isInteger(num) && num > 0)
        .sort((a, b) => a - b)
      const configuredQuestionNumbers = sortedDataEntries
        .map((entry) => Number(entry.number))
        .filter((num) => Number.isInteger(num) && num > 0)
      // Grade the scheme's questions this sheet answers; a sheet may carry only some of them.
      const matchedConfiguredQuestionNumbers = configuredQuestionNumbers.filter(
        (num) => ocrQuestionNumbers.includes(num),
      )
      const questionNumbers =
        matchedConfiguredQuestionNumbers.length > 0
          ? matchedConfiguredQuestionNumbers
          : ocrQuestionNumbers.length > 0
            ? ocrQuestionNumbers
            : configuredQuestionNumbers

      const totalQuestions = questionNumbers.length
      const newResults: LLMResultEntry[] = []
      const runningTotal = { awarded: 0, max: 0 }
      let lastPrompt = llmPrompt

      const questionAt = (i: number) => {
        const qNumber = String(questionNumbers[i])
        const qInfo = dataEntryByNumber.get(qNumber)
        const numericMaxMarks = Number(qInfo?.marks)
        const question =
          qInfo?.question ?? ocrResult[questionNumbers[i]]?.question ?? 'N/A'
        const rawAnswer = (ocrResult[questionNumbers[i]]?.answer ?? '').trim()
        return {
          qNumber,
          question,
          scheme: qInfo?.scheme ?? 'N/A',
          answer:
            stripQuestionPrefix(rawAnswer, qNumber, question) || rawAnswer,
          /** `null` when the marking scheme gives no maximum. */
          maxMarks: Number.isFinite(numericMaxMarks) ? numericMaxMarks : null,
        }
      }

      for (let i = 0; i < totalQuestions; i++) {
        updateEntry(entryId, {
          step: { phase: 'grading', question: i + 1, total: totalQuestions },
        })
        const { qNumber, question, scheme, answer, maxMarks } = questionAt(i)

        const finalPrompt = (subjectPrefix + llmPrompt)
          .replace('{question}', question)
          .replace('{marks}', String(maxMarks ?? 'N/A'))
          .replace('{marking_scheme}', scheme)
        lastPrompt = finalPrompt

        let gradingResultObj: GradingResult
        try {
          gradingResultObj = await runGrading({ prompt: finalPrompt, answer })
        } catch (error) {
          // Keep what is graded; list this question and the rest as not
          // graded, for a retry or for the reviewer to mark by hand.
          const notGraded: LLMResultEntry[] = []
          for (let j = i; j < totalQuestions; j++) {
            const pending = questionAt(j)
            notGraded.push({
              questionNumber: pending.qNumber,
              extractedAnswer: pending.answer || 'N/A',
              feedback:
                j === i
                  ? `Not graded: ${shortErrorMessage(error)}`
                  : `Not graded: grading stopped at question ${qNumber}`,
              marks: { awarded: null, max: pending.maxMarks },
              runningTotal: { ...runningTotal },
              humanReview: true,
            })
          }
          let annotated: { annotated: string; overlay: string } | undefined
          if (newResults.length > 0) {
            updateEntry(entryId, { step: { phase: 'annotating' } })
            annotated = await buildAnnotatedImage(
              uploadedImage,
              newResults,
              dataEntries,
              MARKING_DATA_DIR,
            ).catch(() => undefined)
          }
          updateEntry(entryId, {
            llmResults: [...newResults, ...notGraded],
            annotatedImage: annotated?.annotated ?? '',
            overlayImage: annotated?.overlay,
            step: null,
            error: `Grading question ${qNumber} failed (${newResults.length} of ${totalQuestions} graded): ${shortErrorMessage(error)}`,
          })
          releaseSource(sourceFilename)
          return
        }

        const numericGivenMarks = Number(gradingResultObj?.marks_awarded)
        const givenMarks = Number.isFinite(numericGivenMarks)
          ? numericGivenMarks
          : 0
        runningTotal.awarded += givenMarks
        runningTotal.max += maxMarks ?? 0

        newResults.push({
          questionNumber: qNumber,
          extractedAnswer: answer || 'N/A',
          feedback: gradingResultObj?.feedback ?? 'N/A',
          marks: { awarded: givenMarks, max: maxMarks },
          runningTotal: { ...runningTotal },
          humanReview: gradingResultObj?.human_review ?? false,
        })
        // Shown as it comes rather than all at the end.
        updateEntry(entryId, { llmResults: [...newResults] })
      }

      updateEntry(entryId, { step: { phase: 'annotating' } })
      const { annotated: annotatedImage, overlay: overlayImage } =
        await buildAnnotatedImage(
          uploadedImage,
          newResults,
          dataEntries,
          MARKING_DATA_DIR,
        )

      updateEntry(entryId, {
        annotatedImage,
        overlayImage,
        llmResults: newResults,
        step: null,
      })

      // Manual uploads/webcam captures have no prior_mark file, so they are stored directly.
      await finalizeEntry(
        entryId,
        buildArchiveRequest({
          entryId,
          sourceFilename,
          annotatedImage,
          studentId,
          subject,
        }),
        buildSavedRecord({
          entryId,
          studentName,
          studentId,
          subjectId: SUBJECTS[subject][0],
          dataEntries,
          ocrText,
          overlayImage,
          annotatedImage,
          llmPrompt: lastPrompt,
          llmResults: newResults,
        }),
      )
    } catch (error) {
      // OCR or annotating failed; whatever was written so far stays.
      releaseSource(sourceFilename)
      updateEntry(entryId, {
        step: null,
        error: `Processing failed: ${shortErrorMessage(error)}`,
      })
    }
  }

  return { processImage }
}
