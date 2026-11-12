// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useCallback } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  useGetService,
  useServiceApiBase,
} from '@/context/service-status-context'
import { requireApiBase } from '@/lib/browser/api-base'
import { fetchJson, isHttpError, postJson } from '@/lib/browser/fetch-json'
import {
  formatMarks,
  formatTotal,
  withRunningTotals,
} from '@/samples/ai-exam-marking/lib/marks'
import type { SavedRecord } from '@/samples/ai-exam-marking/lib/types'
import { useExamRecords } from './use-records'

const SERVICE_NAME = 'Exam Marking Database'

/** A marking-scheme question as the database stores it: every field as text. */
type ApiDataEntry = {
  number: string
  question: string
  marks: string
  scheme: string
}

type ApiGradingEntry = {
  questionNumber: string
  extractedAnswer: string
  feedback: string
  /** `null` when the stored `awarded/max` text did not parse. */
  marksAwarded: number | null
  maxMarks: number | null
  humanReview: boolean
}

/** A record as the database returns it; the images come only from the single-record endpoint. */
type ApiRecord = {
  id: string
  timestamp: string
  studentName?: string
  studentId?: string
  subjectId?: string
  dataEntries?: ApiDataEntry[]
  gradingEntries?: ApiGradingEntry[]
  ocrText?: string
  llmPrompt?: string
  annotatedImage?: string | null
  overlayImage?: string | null
}

/** Map the wire format back to the SavedRecord shape used by the UI. */
function toSavedRecord(r: ApiRecord): SavedRecord {
  return {
    id: r.id,
    timestamp: r.timestamp,
    studentName: r.studentName || undefined,
    studentId: r.studentId || undefined,
    subjectId: r.subjectId || undefined,
    dataEntries: (r.dataEntries ?? []).map((e) => ({
      number: Number(e.number),
      question: e.question,
      marks: Number(e.marks),
      scheme: e.scheme,
    })),
    ocrResult: {
      text: r.ocrText ?? '',
      imagePreview: r.annotatedImage ?? undefined,
      overlayImage: r.overlayImage ?? undefined,
    },
    llmResult: {
      prompt: r.llmPrompt ?? '',
      response: withRunningTotals(
        (r.gradingEntries ?? []).map((e) => ({
          questionNumber: e.questionNumber,
          extractedAnswer: e.extractedAnswer,
          feedback: e.feedback,
          marks: { awarded: e.marksAwarded, max: e.maxMarks },
          runningTotal: { awarded: 0, max: 0 },
          humanReview: e.humanReview,
        })),
      ),
    },
  }
}

/** The upsert body: question fields and marks as text (`awarded/max`), as the database stores them. */
function toRequestBody(record: SavedRecord) {
  return {
    id: record.id,
    timestamp: record.timestamp,
    studentName: record.studentName,
    studentId: record.studentId,
    subjectId: record.subjectId,
    dataEntries: record.dataEntries.map((e): ApiDataEntry => ({
      number: String(e.number),
      question: e.question,
      marks: String(e.marks),
      scheme: e.scheme,
    })),
    ocrResult: record.ocrResult,
    llmResult: {
      prompt: record.llmResult.prompt,
      response: record.llmResult.response.map((e) => ({
        questionNumber: e.questionNumber,
        extractedAnswer: e.extractedAnswer,
        feedback: e.feedback,
        marksAwardedOverMaxMarks: formatMarks(e.marks),
        marksAccumulatedOverMaxMarksAccumulated: formatTotal(e.runningTotal),
        humanReview: e.humanReview,
      })),
    },
  }
}

const recordsKey = (apiBase: string | undefined) =>
  ['exam-marking-database', 'records', apiBase] as const

const recordUrl = (apiBase: string, id: string) =>
  `${apiBase}/v1/records/${encodeURIComponent(id)}`

const recordDetailQuery = (apiBase: string | undefined, id: string) => ({
  queryKey: [...recordsKey(apiBase), id] as const,
  queryFn: async (): Promise<SavedRecord> => {
    requireApiBase(apiBase, SERVICE_NAME)
    return toSavedRecord(
      await fetchJson<ApiRecord>(recordUrl(apiBase, id), {
        errorMessage: 'Failed to load exam record',
      }),
    )
  },
  staleTime: 10_000,
})

/** Load the full record (with annotated images) when the list copy lacks them. */
export function useExamRecordDetailQuery(
  apiBase: string | undefined,
  record: SavedRecord | null,
) {
  return useQuery({
    ...recordDetailQuery(apiBase, record?.id ?? ''),
    enabled: Boolean(apiBase) && !!record && !record.ocrResult.imagePreview,
  })
}

/** Resolve a record with its annotated images, falling back to the given copy. */
export function useLoadFullExamRecord(apiBase: string | undefined) {
  const qc = useQueryClient()
  return useCallback(
    async (record: SavedRecord): Promise<SavedRecord> => {
      if (record.ocrResult.imagePreview || !apiBase) return record
      try {
        return await qc.fetchQuery(recordDetailQuery(apiBase, record.id))
      } catch {
        return record
      }
    },
    [apiBase, qc],
  )
}

/** Fetch all persisted records from the database; idle while the service has no address. */
function useExamRecordsQuery(apiBase: string | undefined) {
  return useQuery({
    queryKey: recordsKey(apiBase),
    enabled: Boolean(apiBase),
    queryFn: async (): Promise<SavedRecord[]> => {
      requireApiBase(apiBase, SERVICE_NAME)
      const data = await fetchJson<ApiRecord[]>(`${apiBase}/v1/records`, {
        errorMessage: 'Failed to load exam records',
      })
      return data.map(toSavedRecord)
    },
    staleTime: 10_000,
  })
}

/** Save (upsert) a single graded record to the database. */
function useSaveExamRecord(apiBase: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (record: SavedRecord) => {
      requireApiBase(apiBase, SERVICE_NAME)
      return postJson<unknown>(`${apiBase}/v1/records`, toRequestBody(record), {
        errorMessage: 'Failed to save exam record',
      })
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: recordsKey(apiBase) }),
  })
}

/** Delete a single record by id; one already gone counts as deleted. */
function useDeleteExamRecord(apiBase: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      requireApiBase(apiBase, SERVICE_NAME)
      try {
        await fetchJson<void>(recordUrl(apiBase, id), {
          method: 'DELETE',
          errorMessage: 'Failed to delete exam record',
        })
      } catch (error) {
        if (!isHttpError(error, 404)) throw error
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: recordsKey(apiBase) }),
  })
}

/** Delete all records. */
function useDeleteAllExamRecords(apiBase: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => {
      requireApiBase(apiBase, SERVICE_NAME)
      return fetchJson<{ deleted: number }>(`${apiBase}/v1/records`, {
        method: 'DELETE',
        errorMessage: 'Failed to delete all exam records',
      })
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: recordsKey(apiBase) }),
  })
}

/**
 * The History records: the exam database's while it runs, else this session's in memory. A graded
 * sheet counts as saved only once the database stores it.
 */
export function useExamRecordStore() {
  const online = useGetService('exam-marking-database')?.status === 'online'
  const serviceApiBase = useServiceApiBase('exam-marking-database')
  const apiBase = online ? serviceApiBase : undefined

  const local = useExamRecords()
  const dbRecords = useExamRecordsQuery(apiBase)
  const saveToDb = useSaveExamRecord(apiBase)
  const deleteFromDb = useDeleteExamRecord(apiBase)
  const deleteAllFromDb = useDeleteAllExamRecords(apiBase)

  const records = apiBase && dbRecords.data ? dbRecords.data : local.records

  /** Resolves false when the database is not running or did not store the record. */
  const saveRecord = async (record: SavedRecord): Promise<boolean> => {
    if (!apiBase) return false
    try {
      await saveToDb.mutateAsync(record)
    } catch {
      return false
    }
    local.saveRecord(record)
    return true
  }

  const deleteRecord = (id: string) => {
    local.deleteRecord(id)
    if (apiBase) deleteFromDb.mutate(id)
  }

  const deleteAllRecords = () => {
    local.deleteAllRecords()
    if (apiBase) deleteAllFromDb.mutate()
  }

  return { records, saveRecord, deleteRecord, deleteAllRecords }
}
