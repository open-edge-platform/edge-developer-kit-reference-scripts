// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, Play, Square } from 'lucide-react'
import { DataDefinition } from './components/data-definition'
import { BoundingBoxSetup } from './components/bounding-box-setup'
import { GradingSection } from './components/grading-section'
import { HistoryView } from './components/history-view'
import { ResultsDashboard } from './components/results-dashboard'
import type { DashboardStats } from './components/results-dashboard'
import { Tabs, TabsContent } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import type { DataEntry } from '@/lib/ai-exam-marking/types'
import type { GradingEntry } from './components/grading-section'
import {
  AlertTriangle,
  BookOpen,
  Bot,
  GraduationCap,
  IdCard,
  LayoutDashboard,
} from 'lucide-react'
import type { Sample } from '../types'

type Role = 'teacher' | 'student'

import {
  useGetService,
  useGetServices,
  useServiceStatus,
} from '@/context/service-status-context'
import { useFeatureCollector } from '@/context/feature-collector'
import { useFeatureProviders } from '@/samples/common/feature-providers/use-feature-providers'
import {
  useOptionalServiceGroup,
  useTextGenerationParams,
} from '@/samples/common/hooks'
import { useTextGenChat } from '@/services/text-generation/hooks/use-chat'
import { ConversationPanel } from '@/services/text-generation/components/conversation-panel'
import { SampleParamsSlot } from '../common/sample-params-slot'
import { useExamRecords } from './hooks/useRecords'

// Optional-service feature integrations this sample wires (explicit opt-in).
// Order = Configure-sheet group order. See docs/OPTIONAL-SERVICES.md.
const FEATURE_SERVICES = ['text-to-speech', 'speech-to-text', 'mcp']

function buildChatSystemPrompt(stats: DashboardStats | null): string {
  if (!stats) {
    return 'You are an AI assistant helping with exam marking. No exam results have been graded yet. Answer general questions about exam marking.'
  }

  const lines: string[] = [
    "You are an AI assistant analyzing exam results. Answer the user's questions using the data below.",
    '',
    '=== DASHBOARD SUMMARY ===',
    `Total students: ${stats.totalStudents}`,
    `Class average: ${stats.averagePct !== null ? `${stats.averagePct}%` : 'N/A'}`,
    `Pass rate (≥50%): ${stats.passRate !== null ? `${stats.passRate}%` : 'N/A'}`,
    `Items flagged for human review: ${stats.humanReviewCount}`,
    '',
    '=== SCORE DISTRIBUTION ===',
    ...stats.buckets.map((b) => `${b.label}: ${b.count} student(s)`),
  ]

  if (stats.questionStats.length > 0) {
    lines.push('', '=== PER-QUESTION AVERAGES ===')
    for (const q of stats.questionStats) {
      lines.push(`${q.label}: avg ${q.avgAwarded}/${q.avgMax} (${q.avgPct}%)`)
    }
  }

  if (stats.scoredRecords.length > 0) {
    lines.push('', '=== STUDENT RESULTS ===')
    for (const { record, pct } of stats.scoredRecords) {
      const name =
        [
          record.studentName,
          record.studentId ? `(ID: ${record.studentId})` : null,
        ]
          .filter(Boolean)
          .join(' ') || 'Unknown'
      lines.push(`- ${name} | Score: ${pct}% | ${pct >= 50 ? 'Pass' : 'Fail'}`)
    }
  }

  return lines.join('\n')
}

export function AiExamMarkingDemo({ sample }: { sample: Sample }) {
  const textGen = useTextGenerationParams()

  const featureProviders = useFeatureProviders(FEATURE_SERVICES)
  const collector = useFeatureCollector(FEATURE_SERVICES)

  const { 'text-generation': textGenService } = useGetServices([
    'text-generation',
  ])
  const isMultimodal = textGenService?.currentModelType === 'multimodal'

  const fileWatcherService = useGetService('file-watcher')
  const fileWatcherStatus = fileWatcherService?.status ?? 'offline'
  const { startService, stopService, isActionPending } = useServiceStatus()
  const fileWatcherPending = isActionPending('file-watcher')

  const [role, setRole] = useState<Role | null>(null)
  const [studentLoginId, setStudentLoginId] = useState('')
  const [studentIdDraft, setStudentIdDraft] = useState('')
  const [showStudentIdForm, setShowStudentIdForm] = useState(false)

  const [dataEntries, setDataEntries] = useState<DataEntry[]>([])
  const [gradingEntries, setGradingEntries] = useState<GradingEntry[]>([])
  const [activeTab, setActiveTab] = useState('define')
  const [referenceImage, setReferenceImage] = useState<string>('')
  const { records, saveRecord, deleteRecord, deleteAllRecords } =
    useExamRecords()

  const [stats, setStats] = useState<DashboardStats | null>(null)

  const chatSystemPrompt = useMemo(() => buildChatSystemPrompt(stats), [stats])
  const chatExtraBody = useMemo(
    () => ({ systemPrompt: chatSystemPrompt }),
    [chatSystemPrompt],
  )
  const chat = useTextGenChat({
    textGenValues: textGen.values,
    requestParams: {},
    extraBody: chatExtraBody,
  })
  const stt = useOptionalServiceGroup({
    serviceId: 'speech-to-text',
    serviceLabel: 'Speech-to-Text',
  })

  const defineScrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (defineScrollRef.current) {
      defineScrollRef.current.scrollTop = defineScrollRef.current.scrollHeight
    }
  }, [dataEntries])

  const allNavItems = [
    {
      step: 1,
      label: 'Setup',
      subSteps: [
        { value: 'define', label: 'Marking Scheme' },
        { value: 'bbox', label: 'Bounding Box Setup' },
      ],
    },
    { step: 2, label: 'Grading', value: 'grading' },
    { step: 3, label: 'History', value: 'history' },
    { step: 4, label: 'Dashboard', value: 'dashboard' },
    { step: 5, label: 'Chatbot', value: 'chatbot' },
  ]
  const navItems =
    role === 'student'
      ? allNavItems
          .filter((item) => !('subSteps' in item) && item.value === 'history')
          .map((item, idx) => ({ ...item, step: idx + 1 }))
      : allNavItems.filter(
          (item) =>
            !('value' in item && item.value === 'dashboard') ||
            role === 'teacher',
        )

  const isStep1Active = activeTab === 'define' || activeTab === 'bbox'

  return (
    <div className="space-y-4">
      {/* File Watcher prerequisite banner */}
      {fileWatcherService && (
        <div
          className={`flex items-center justify-between gap-4 rounded-lg border px-4 py-3 ${
            fileWatcherStatus === 'online'
              ? 'border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-900/20'
              : 'border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-900/20'
          }`}
        >
          <div className="flex items-center gap-2">
            <span
              className={`h-2 w-2 rounded-full ${
                fileWatcherStatus === 'online'
                  ? 'animate-pulse bg-green-500'
                  : fileWatcherStatus === 'starting'
                    ? 'animate-pulse bg-amber-500'
                    : 'bg-red-500'
              }`}
            />
            <span
              className={`text-sm font-medium ${
                fileWatcherStatus === 'online'
                  ? 'text-green-800 dark:text-green-200'
                  : 'text-amber-800 dark:text-amber-200'
              }`}
            >
              File Watcher:{' '}
              {fileWatcherStatus === 'online'
                ? 'Running'
                : fileWatcherStatus === 'starting'
                  ? 'Starting…'
                  : 'Stopped'}
            </span>
          </div>
          {fileWatcherStatus === 'online' ? (
            <Button
              size="sm"
              variant="outline"
              className="h-7 gap-1.5 text-xs"
              disabled={fileWatcherPending}
              onClick={() => stopService('file-watcher')}
            >
              {fileWatcherPending ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Square className="h-3 w-3" />
              )}
              Stop
            </Button>
          ) : (
            <Button
              size="sm"
              className="h-7 gap-1.5 text-xs"
              disabled={fileWatcherPending || fileWatcherStatus === 'starting'}
              onClick={() => startService('file-watcher')}
            >
              {fileWatcherPending || fileWatcherStatus === 'starting' ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Play className="h-3 w-3" />
              )}
              Start
            </Button>
          )}
        </div>
      )}

      {/* VLM warning */}
      {textGenService?.status === 'online' && !isMultimodal && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-900/20">
          <div className="flex items-start gap-3">
            <AlertTriangle className="text-warning mt-0.5 h-5 w-5 shrink-0" />
            <div>
              <h4 className="font-semibold text-amber-800 dark:text-amber-200">
                VLM Required
              </h4>
              <p className="text-sm text-amber-700 dark:text-amber-300">
                The text generation service may not support image processing.
                Please ensure a Visual Language Model (VLM) is configured.
              </p>
            </div>
          </div>
        </div>
      )}

      <collector.Provider>
        {featureProviders.map(({ serviceId, Provider }) => (
          <Provider key={serviceId} sampleId={sample.id} />
        ))}
      </collector.Provider>

      <SampleParamsSlot groups={[textGen.group, ...collector.groups]} />

      {/* Role Selection */}
      {!role && !showStudentIdForm && (
        <div className="flex h-[calc(100svh-12rem)] items-center justify-center">
          <div className="w-full max-w-lg space-y-8 text-center">
            <div className="space-y-2">
              <h2 className="text-foreground text-2xl font-bold">
                Select Your Role
              </h2>
              <p className="text-muted-foreground text-sm">
                Choose how you want to use AI Exam Marking
              </p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <button
                onClick={() => setRole('teacher')}
                className="group border-border hover:border-primary hover:bg-primary/5 focus-visible:ring-primary flex flex-col items-center gap-4 rounded-xl border-2 bg-transparent p-8 transition-all duration-200 focus-visible:ring-2 focus-visible:outline-none"
              >
                <div className="bg-primary/10 group-hover:bg-primary/20 flex h-16 w-16 items-center justify-center rounded-full transition-colors duration-200">
                  <GraduationCap className="text-primary h-8 w-8" />
                </div>
                <div className="space-y-1">
                  <p className="text-foreground font-semibold">Teacher</p>
                  <p className="text-muted-foreground text-xs">
                    Create marking schemes and grade student answers
                  </p>
                </div>
              </button>
              <button
                onClick={() => {
                  setStudentIdDraft('')
                  setShowStudentIdForm(true)
                }}
                className="group border-border hover:border-primary hover:bg-primary/5 focus-visible:ring-primary flex flex-col items-center gap-4 rounded-xl border-2 bg-transparent p-8 transition-all duration-200 focus-visible:ring-2 focus-visible:outline-none"
              >
                <div className="bg-primary/10 group-hover:bg-primary/20 flex h-16 w-16 items-center justify-center rounded-full transition-colors duration-200">
                  <BookOpen className="text-primary h-8 w-8" />
                </div>
                <div className="space-y-1">
                  <p className="text-foreground font-semibold">Student</p>
                  <p className="text-muted-foreground text-xs">
                    Review your results
                  </p>
                </div>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Student ID Form */}
      {showStudentIdForm && (
        <div className="flex h-[calc(100svh-12rem)] items-center justify-center">
          <div className="w-full max-w-sm space-y-6">
            <div className="space-y-2 text-center">
              <div className="bg-primary/10 mx-auto flex h-16 w-16 items-center justify-center rounded-full">
                <IdCard className="text-primary h-8 w-8" />
              </div>
              <h2 className="text-foreground text-2xl font-bold">
                Student Login
              </h2>
              <p className="text-muted-foreground text-sm">
                Enter your student ID to continue
              </p>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault()
                const trimmed = studentIdDraft.trim()
                if (!trimmed) return
                setStudentLoginId(trimmed)
                setShowStudentIdForm(false)
                setRole('student')
                setActiveTab('history')
              }}
              className="space-y-4"
            >
              <div className="space-y-1.5">
                <label
                  htmlFor="student-id-input"
                  className="text-foreground text-xs font-medium"
                >
                  Student ID <span className="text-destructive">*</span>
                </label>
                <input
                  id="student-id-input"
                  type="text"
                  value={studentIdDraft}
                  onChange={(e) => setStudentIdDraft(e.target.value)}
                  placeholder="e.g. S12345"
                  autoFocus
                  className="border-input bg-background placeholder:text-muted-foreground focus-visible:ring-ring w-full rounded-md border px-3 py-2 text-sm shadow-sm focus-visible:ring-1 focus-visible:outline-none"
                />
              </div>
              <button
                type="submit"
                disabled={!studentIdDraft.trim()}
                className="bg-primary text-primary-foreground hover:bg-primary/90 w-full rounded-md px-4 py-2 text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50"
              >
                Continue
              </button>
              <button
                type="button"
                onClick={() => setShowStudentIdForm(false)}
                className="text-muted-foreground hover:text-foreground w-full text-xs transition-colors"
              >
                Back
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Main Content */}
      {role && (
        <div className="flex">
          {/* Sidebar Navigation */}
          <aside className="border-border bg-card/50 supports-[backdrop-filter]:bg-card/30 flex w-64 flex-col border-r backdrop-blur">
            <div className="border-border flex items-center justify-between border-b px-6 py-4">
              <div className="flex items-center gap-2">
                {role === 'teacher' ? (
                  <GraduationCap className="text-primary h-4 w-4" />
                ) : (
                  <BookOpen className="text-primary h-4 w-4" />
                )}
                <span className="text-foreground text-xs font-semibold capitalize">
                  {role}
                  {role === 'student' && studentLoginId
                    ? ` · ${studentLoginId}`
                    : ''}
                </span>
              </div>
              <button
                onClick={() => {
                  setRole(null)
                  setStudentLoginId('')
                }}
                className="text-muted-foreground hover:text-foreground text-xs transition-colors"
              >
                Change
              </button>
            </div>
            <nav className="space-y-1 p-6">
              {navItems.map((item) => {
                if ('subSteps' in item && item.subSteps) {
                  const firstSubStep = item.subSteps[0]

                  // Step 1 with sub-steps
                  return (
                    <div key={item.step}>
                      <button
                        onClick={() => {
                          if (firstSubStep) {
                            setActiveTab(firstSubStep.value)
                          }
                        }}
                        className={`relative w-full rounded-lg px-4 py-3 text-left text-xs font-medium transition-all duration-200 ${
                          isStep1Active
                            ? 'bg-primary text-primary-foreground shadow-primary/20 shadow-lg'
                            : 'text-muted-foreground hover:text-foreground'
                        }`}
                      >
                        <span className="flex items-center gap-3">
                          <span
                            className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                              isStep1Active
                                ? 'bg-primary-foreground text-primary'
                                : 'bg-border text-muted-foreground'
                            }`}
                          >
                            {item.step}
                          </span>
                          {item.label}
                        </span>
                      </button>
                      {isStep1Active && (
                        <div className="mt-1 ml-4 space-y-1 border-l pl-4">
                          {item.subSteps.map((sub, idx) => (
                            <button
                              key={sub.value}
                              onClick={() => setActiveTab(sub.value)}
                              className={`w-full rounded-md px-3 py-2 text-left text-xs font-medium transition-all duration-200 ${
                                activeTab === sub.value
                                  ? 'text-primary font-semibold'
                                  : 'text-muted-foreground hover:text-foreground'
                              }`}
                            >
                              <span className="flex items-center gap-2">
                                <span
                                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ${
                                    activeTab === sub.value
                                      ? 'bg-primary text-primary-foreground'
                                      : 'bg-border text-muted-foreground'
                                  }`}
                                >
                                  {idx + 1}
                                </span>
                                {sub.label}
                              </span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                }
                // Regular steps
                const isActive = activeTab === item.value
                return (
                  <button
                    key={item.value}
                    onClick={() => setActiveTab(item.value)}
                    className={`relative w-full rounded-lg px-4 py-3 text-left text-xs font-medium transition-all duration-200 ${
                      isActive
                        ? 'bg-primary text-primary-foreground shadow-primary/20 shadow-lg'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    <span className="flex items-center gap-3">
                      <span
                        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                          isActive
                            ? 'bg-primary-foreground text-primary'
                            : 'bg-border text-muted-foreground'
                        }`}
                      >
                        {item.step}
                      </span>
                      {item.label}
                    </span>
                  </button>
                )
              })}
            </nav>
          </aside>

          {/* Content Area */}
          <main className="min-w-0 flex-1 overflow-hidden">
            <Tabs
              value={activeTab}
              onValueChange={setActiveTab}
              className="h-full w-full"
            >
              <TabsContent
                value="define"
                className="h-full data-[state=inactive]:hidden"
              >
                <div
                  ref={defineScrollRef}
                  className="h-full space-y-6 overflow-y-auto p-8"
                >
                  <div>
                    <h2 className="text-foreground font-bold">
                      Define Test Questions
                    </h2>
                    <p className="text-muted-foreground mt-2 text-xs">
                      Set up your test paper structure with questions and
                      marking schemes
                    </p>
                  </div>
                  <DataDefinition
                    dataEntries={dataEntries}
                    setDataEntries={setDataEntries}
                    onNext={() => setActiveTab('bbox')}
                  />
                </div>
              </TabsContent>

              <TabsContent
                value="bbox"
                className="h-full data-[state=inactive]:hidden"
              >
                <div className="h-full space-y-6 overflow-y-auto p-8">
                  <div>
                    <h2 className="text-foreground font-bold">
                      Bounding Box Setup
                    </h2>
                    <p className="text-muted-foreground mt-2 text-xs">
                      Upload a sample answer sheet and draw bounding boxes to
                      define the answer area for each question
                    </p>
                  </div>
                  <BoundingBoxSetup
                    dataEntries={dataEntries}
                    setDataEntries={setDataEntries}
                    referenceImage={referenceImage}
                    setReferenceImage={setReferenceImage}
                    onNext={() => setActiveTab('grading')}
                  />
                </div>
              </TabsContent>

              <TabsContent
                value="grading"
                className="h-full data-[state=inactive]:hidden"
              >
                <div className="h-full space-y-6 overflow-y-auto p-8">
                  <div>
                    <h2 className="text-foreground font-bold">Grading</h2>
                    <p className="text-muted-foreground mt-2 text-xs">
                      Upload or capture answer sheet images — each will be
                      graded automatically via OCR and LLM
                    </p>
                  </div>
                  <GradingSection
                    dataEntries={dataEntries}
                    entries={gradingEntries}
                    setEntries={setGradingEntries}
                    saveRecord={saveRecord}
                  />
                </div>
              </TabsContent>

              <TabsContent
                value="history"
                className="h-full data-[state=inactive]:hidden"
              >
                <div className="h-full space-y-6 overflow-y-auto p-8">
                  <div>
                    <h2 className="text-foreground font-bold">History</h2>
                    <p className="text-muted-foreground mt-2 text-xs">
                      View and manage your previous grading results
                    </p>
                  </div>
                  <HistoryView
                    role={role}
                    studentId={studentLoginId}
                    records={records}
                    deleteRecord={deleteRecord}
                    deleteAllRecords={deleteAllRecords}
                  />
                </div>
              </TabsContent>

              <TabsContent
                value="dashboard"
                className="h-full data-[state=inactive]:hidden"
              >
                <div className="h-full space-y-6 overflow-y-auto p-8">
                  <div>
                    <h2 className="text-foreground flex items-center gap-2 font-bold">
                      <LayoutDashboard className="h-5 w-5" />
                      Results Dashboard
                    </h2>
                    <p className="text-muted-foreground mt-2 text-xs">
                      Class-wide statistics and performance overview across all
                      graded students
                    </p>
                  </div>
                  <ResultsDashboard records={records} onStats={setStats} />
                </div>
              </TabsContent>

              <TabsContent
                value="chatbot"
                className="h-full data-[state=inactive]:hidden"
              >
                <div className="h-full space-y-6 overflow-y-auto p-8">
                  <div>
                    <h2 className="text-foreground flex items-center gap-2 font-bold">
                      <Bot className="h-5 w-5" />
                      Chatbot
                    </h2>
                    <p className="text-muted-foreground mt-2 text-xs">
                      Ask the AI assistant questions about exam results, marking
                      schemes, or student performance
                    </p>
                  </div>
                  <ConversationPanel
                    messages={chat.messages}
                    status={chat.status}
                    input={chat.input}
                    onInputChange={chat.setInput}
                    onSend={chat.handleSend}
                    onStop={chat.handleStop}
                    onReset={chat.handleReset}
                    sttOnline={stt.online}
                    emptyStateText="Ask me anything about exam results or marking"
                    placeholder="e.g. Which students scored above 80%?"
                    messagesClassName="max-h-[480px] min-h-[320px]"
                  />
                </div>
              </TabsContent>
            </Tabs>
          </main>
        </div>
      )}
    </div>
  )
}
