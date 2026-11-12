// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import {
  BookOpen,
  BrainCircuit,
  GraduationCap,
  LayoutDashboard,
  Send,
} from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { VlmRequiredNotice } from '@/samples/common/components/vlm-required-notice'
import type { Sample } from '../types'
import { AgentConversationPanel } from './components/agent-conversation-panel'
import { BoundingBoxSetup } from './components/bounding-box-setup'
import { DataDefinition } from './components/data-definition'
import { ExamNav, type ExamTab } from './components/exam-nav'
import { ExamSection } from './components/exam-section'
import { GradingSection } from './components/grading-section'
import { HistoryView } from './components/history-view'
import { ResultsDashboard } from './components/results-dashboard'
import { RoleSelect, StudentLoginForm } from './components/role-gate'
import {
  DEFAULT_SEND_RESULT_CONFIG,
  SendResultSetup,
  type SendResultConfig,
} from './components/send-result-setup'
import { useExamAgentChat } from './hooks/use-agent-chat'
import { useExamRecordStore } from './hooks/use-database'
import { useExamRole } from './hooks/use-exam-role'
import { useGradingSession } from './hooks/use-grading-session'
import { computeDashboardStats } from './lib/dashboard-stats'
import type { DataEntry, Subject } from './lib/types'

export function AiExamMarkingDemo({ sample: _sample }: { sample: Sample }) {
  const exam = useExamRole()
  const [activeTab, setActiveTab] = useState<ExamTab>('define')
  const [dataEntries, setDataEntries] = useState<DataEntry[]>([])
  const [subject, setSubject] = useState<Subject>('Business Studies')
  const [referenceImage, setReferenceImage] = useState('')
  const [sendResultConfig, setSendResultConfig] = useState<SendResultConfig>(
    DEFAULT_SEND_RESULT_CONFIG,
  )
  const { records, saveRecord, deleteRecord, deleteAllRecords } =
    useExamRecordStore()
  const stats = computeDashboardStats(records)

  // Above the tabs and the role: grading carries on, and the conversation
  // stays, whichever tab is shown.
  const grading = useGradingSession({ dataEntries, subject, saveRecord })
  const chat = useExamAgentChat()

  return (
    <div className="space-y-4">
      <VlmRequiredNotice>
        The selected Text Generation model may not accept images, and answer
        sheets are read from images. Choose a vision language model (VLM) under
        Services.
      </VlmRequiredNotice>

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
                subject={subject}
                setSubject={setSubject}
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
              icon={BrainCircuit}
              description="Query student results, class statistics, and performance insights from the exam database"
            >
              <AgentConversationPanel
                messages={chat.messages}
                status={chat.status}
                input={chat.input}
                onInputChange={chat.setInput}
                onSend={chat.handleSend}
                onStop={chat.handleStop}
                onReset={chat.handleReset}
                emptyStateText="Ask about student scores, class statistics, or request a performance report"
                placeholder="e.g. Which students scored above 80%?"
                messagesClassName="max-h-[480px] min-h-[320px]"
              />
            </ExamSection>

            <ExamSection
              active={activeTab === 'dispatch'}
              title="Dispatch"
              icon={Send}
              description="Dispatch grading results to teachers/students"
            >
              <SendResultSetup
                value={sendResultConfig}
                onChange={setSendResultConfig}
              />
            </ExamSection>
          </main>
        </div>
      )}
    </div>
  )
}
