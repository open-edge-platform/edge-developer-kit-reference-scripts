// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import type React from 'react'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Plus,
  Trash2,
  ArrowRight,
  GripVertical,
  Sparkles,
  Calculator,
} from 'lucide-react'
import {
  SUBJECTS,
  type DataEntry,
  type QuestionType,
  type Subject,
} from '@/samples/ai-exam-marking/lib/types'
import demoQuestionsData from '@/samples/ai-exam-marking/lib/demo-questions.json'
import demoMathQuestionsData from '@/samples/ai-exam-marking/lib/demo-math-questions.json'
import { v4 as uuidv4 } from 'uuid'
import { QuestionHeading } from './question-heading'

type DataDefinitionProps = {
  dataEntries: DataEntry[]
  setDataEntries: (entries: DataEntry[]) => void
  subject: Subject
  setSubject: (s: Subject) => void
  onNext: () => void
}

export function DataDefinition({
  dataEntries,
  setDataEntries,
  subject,
  setSubject,
  onNext,
}: DataDefinitionProps) {
  const [number, setNumber] = useState('')
  const [question, setQuestion] = useState('')
  const [marks, setMarks] = useState('')
  const [scheme, setScheme] = useState('')
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null)

  // auto-derive question type from subject
  const isMathSubject = SUBJECTS[subject][1] === 'math'

  const addEntry = () => {
    if (number && question && marks && scheme) {
      const newEntry: DataEntry = {
        id: uuidv4(),
        number: Number.parseInt(number),
        question,
        marks: Number.parseInt(marks),
        scheme,
        type: isMathSubject ? 'math' : 'text',
      }
      setDataEntries([...dataEntries, newEntry])
      setNumber('')
      setQuestion('')
      setMarks('')
      setScheme('')
    }
  }

  const loadDemoQuestions = () => {
    const demoData = isMathSubject ? demoMathQuestionsData : demoQuestionsData
    const demoEntries: DataEntry[] = Object.values(demoData).map(
      (q: Omit<DataEntry, 'id' | 'type'> & Record<string, unknown>) => ({
        ...q,
        id: uuidv4(),
        type: (q.type as QuestionType) ?? 'text',
      }),
    )
    setDataEntries(demoEntries)
  }

  const removeEntry = (id: string) => {
    setDataEntries(dataEntries.filter((entry) => entry.id !== id))
  }

  const handleDragStart = (index: number) => {
    setDraggedIndex(index)
  }

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault()
    if (draggedIndex === null || draggedIndex === index) return

    const newEntries = [...dataEntries]
    const draggedItem = newEntries[draggedIndex]
    newEntries.splice(draggedIndex, 1)
    newEntries.splice(index, 0, draggedItem)

    setDataEntries(newEntries)
    setDraggedIndex(index)
  }

  const handleDragEnd = () => {
    setDraggedIndex(null)
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Setup Test Paper Marking Scheme</CardTitle>
          <CardDescription className="text-xs">
            Define the marking scheme for each question in the test paper
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <fieldset className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="subject" className="text-xs">
                Subject
              </Label>
              <Select
                value={subject}
                onValueChange={(v) => setSubject(v as Subject)}
              >
                <SelectTrigger id="subject" className="text-xs">
                  <SelectValue placeholder="Select subject" />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(SUBJECTS) as Subject[]).map((s) => (
                    <SelectItem key={s} value={s} className="text-xs">
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="question-number" className="text-xs">
                  Question Number
                </Label>
                <Input
                  id="question-number"
                  type="number"
                  placeholder="e.g., 1"
                  value={number}
                  onChange={(e) => setNumber(e.target.value)}
                  className="text-xs"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="marks" className="text-xs">
                  Marks
                </Label>
                <Input
                  id="marks"
                  type="number"
                  placeholder="e.g., 10"
                  value={marks}
                  onChange={(e) => setMarks(e.target.value)}
                  className="text-xs"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="question" className="text-xs">
                Question
              </Label>
              <Textarea
                id="question"
                placeholder="Enter the question text"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                rows={3}
                className="text-xs"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="scheme" className="text-xs">
                Marking Scheme
              </Label>
              <Textarea
                id="scheme"
                placeholder="Enter the marking scheme or answer key"
                value={scheme}
                onChange={(e) => setScheme(e.target.value)}
                rows={4}
                className="text-xs"
              />
            </div>

            <div className="flex flex-col gap-2 sm:flex-row">
              <Button onClick={addEntry} className="flex-1 text-xs">
                <Plus className="mr-2 h-4 w-4" />
                Add Question
              </Button>
              <Button
                onClick={loadDemoQuestions}
                variant="outline"
                className="flex-1 bg-transparent text-xs"
              >
                {isMathSubject ? (
                  <Calculator className="mr-2 h-4 w-4" aria-hidden />
                ) : (
                  <Sparkles className="mr-2 h-4 w-4" aria-hidden />
                )}
                Load Sample Questions
              </Button>
            </div>
          </fieldset>
        </CardContent>
      </Card>

      {dataEntries.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Defined Questions ({dataEntries.length})</CardTitle>
            <CardDescription className="text-xs">
              Test paper questions and their marking schemes
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3 text-xs">
              {dataEntries.map((entry, index) => (
                <div
                  key={entry.id}
                  draggable
                  onDragStart={() => handleDragStart(index)}
                  onDragOver={(e) => handleDragOver(e, index)}
                  onDragEnd={handleDragEnd}
                  className={`bg-card cursor-move rounded-lg border p-4 transition-opacity ${
                    draggedIndex === index ? 'opacity-50' : 'opacity-100'
                  }`}
                >
                  <div className="mb-3 flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <GripVertical
                        className="text-muted-foreground h-5 w-5 shrink-0"
                        aria-hidden
                      />
                      <QuestionHeading
                        number={entry.number}
                        marks={entry.marks}
                      />
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => removeEntry(entry.id)}
                      aria-label={`Remove question ${entry.number}`}
                      title="Remove question"
                    >
                      <Trash2
                        className="text-destructive h-4 w-4"
                        aria-hidden
                      />
                    </Button>
                  </div>
                  <div className="space-y-2 text-xs">
                    <div>
                      <p className="text-muted-foreground font-medium">
                        Question:
                      </p>
                      <p className="text-card-foreground">{entry.question}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground font-medium">
                        Marking Scheme:
                      </p>
                      <p className="text-card-foreground">{entry.scheme}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <Button onClick={onNext} className="mt-6 w-full text-xs">
              Continue to Bounding Box Setup
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
