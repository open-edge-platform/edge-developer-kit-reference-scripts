// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { BookOpen, Bot, GraduationCap, LayoutDashboard } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { VlmRequiredNotice } from '@/samples/common/components/vlm-required-notice'
import { SampleParamsSlot } from '@/samples/common/sample-params-slot'
import type { Sample } from '../types'
import { BoundingBoxSetup } from './components/bounding-box-setup'
import { DataDefinition } from './components/data-definition'
import { ExamChatbot } from './components/exam-chatbot'
import { ExamNav, type ExamTab } from './components/exam-nav'
import { ExamSection } from './components/exam-section'
import { GradingSection } from './components/grading-section'
import { HistoryView } from './components/history-view'
import { ResultsDashboard } from './components/results-dashboard'
import { RoleSelect, StudentLoginForm } from './components/role-gate'
import { useExamChat } from './hooks/use-exam-chat'
import { useExamRole } from './hooks/use-exam-role'
import { useGradingSession } from './hooks/use-grading-session'
import { useExamRecords } from './hooks/use-records'
import { computeDashboardStats } from './lib/dashboard-stats'
import type { DataEntry } from './lib/types'

export function AiExamMarkingDemo({ sample }: { sample: Sample }) {
  const exam = useExamRole()
  const [activeTab, setActiveTab] = useState<ExamTab>('define')
  const [dataEntries, setDataEntries] = useState<DataEntry[]>([])
  const [referenceImage, setReferenceImage] = useState('')
  const { records, saveRecord, deleteRecord, deleteAllRecords } =
    useExamRecords()
  const stats = computeDashboardStats(records)

  // Above the tabs and the role: grading carries on, and the conversation
  // stays, whichever tab is shown.
  const grading = useGradingSession({ dataEntries, saveRecord })
  const examChat = useExamChat(sample, stats)

  return (
    <div className="space-y-4">
      <VlmRequiredNotice>
        The selected Text Generation model may not accept images, and answer
        sheets are read from images. Choose a vision language model (VLM) under
        Services.
      </VlmRequiredNotice>

      {examChat.features.renderProviders(examChat.chat.setInput)}
      <SampleParamsSlot groups={examChat.groups} />

      {!exam.role &&
        (exam.loggingIn ? (
          <StudentLoginForm
            onSubmit={(studentId) => {
              exam.logInStudent(studentId)
              setActiveTab('history')
            }}
            onBack={exam.cancelStudentLogin}
          />
        ) : (
          <RoleSelect
            onSelect={(role) =>
              role === 'teacher'
                ? exam.chooseTeacher()
                : exam.startStudentLogin()
            }
          />
        ))}

      {exam.role && (
        <div className="flex">
          <aside className="border-border bg-card/50 supports-[backdrop-filter]:bg-card/30 flex w-64 flex-col border-r backdrop-blur">
            <div className="border-border flex items-center justify-between border-b px-6 py-4">
              <div className="flex items-center gap-2">
                {exam.role === 'teacher' ? (
                  <GraduationCap className="text-primary h-4 w-4" aria-hidden />
                ) : (
                  <BookOpen className="text-primary h-4 w-4" aria-hidden />
                )}
                <span className="text-foreground text-xs font-semibold capitalize">
                  {exam.role}
                  {exam.role === 'student' && exam.studentId
                    ? ` · ${exam.studentId}`
                    : ''}
                </span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={exam.changeRole}
                className="text-muted-foreground hover:text-foreground h-auto px-1 text-xs"
              >
                Change
              </Button>
            </div>
            <ExamNav
              role={exam.role}
              activeTab={activeTab}
              onSelect={setActiveTab}
            />
          </aside>

          <main className="min-w-0 flex-1 overflow-hidden">
            <ExamSection
              active={activeTab === 'define'}
              title="Define Test Questions"
              description="Set up your test paper structure with questions and marking schemes"
            >
              <DataDefinition
                dataEntries={dataEntries}
                setDataEntries={setDataEntries}
                onNext={() => setActiveTab('bbox')}
              />
            </ExamSection>

            <ExamSection
              active={activeTab === 'bbox'}
              title="Bounding Box Setup"
              description="Upload a sample answer sheet and draw bounding boxes to define the answer area for each question"
            >
              <BoundingBoxSetup
                dataEntries={dataEntries}
                setDataEntries={setDataEntries}
                referenceImage={referenceImage}
                setReferenceImage={setReferenceImage}
                onNext={() => setActiveTab('grading')}
              />
            </ExamSection>

            {/* Kept mounted: its camera and scanner connection, and the
                dialogs over its sheets, survive a look at another step. */}
            <ExamSection
              active={activeTab === 'grading'}
              keepMounted
              title="Grading"
              description="Upload or capture answer sheet images — each will be graded automatically via OCR and LLM"
            >
              <GradingSection
                dataEntries={dataEntries}
                grading={grading}
                saveRecord={saveRecord}
              />
            </ExamSection>

            <ExamSection
              active={activeTab === 'history'}
              title="History"
              description="View and manage your previous grading results"
            >
              <HistoryView
                role={exam.role}
                studentId={exam.studentId}
                records={records}
                deleteRecord={deleteRecord}
                deleteAllRecords={deleteAllRecords}
              />
            </ExamSection>

            <ExamSection
              active={activeTab === 'dashboard'}
              title="Results Dashboard"
              icon={LayoutDashboard}
              description="Class-wide statistics and performance overview across all graded students"
            >
              <ResultsDashboard records={records} stats={stats} />
            </ExamSection>

            <ExamSection
              active={activeTab === 'chatbot'}
              title="Chatbot"
              icon={Bot}
              description="Ask the AI assistant questions about exam results, marking schemes, or student performance"
            >
              <ExamChatbot {...examChat} />
            </ExamSection>
          </main>
        </div>
      )}
    </div>
  )
}
