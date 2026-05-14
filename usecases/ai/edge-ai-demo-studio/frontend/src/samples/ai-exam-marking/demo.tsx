// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useEffect, useRef, useState } from 'react'
import { DataDefinition } from './components/data-definition'
import { BoundingBoxSetup } from './components/bounding-box-setup'
import { GradingSection } from './components/grading-section'
import { HistoryView } from './components/history-view'
import { Tabs, TabsContent } from '@/components/ui/tabs'
import type { DataEntry } from '@/lib/ai-exam-marking/types'
import type { GradingEntry } from './components/grading-section'
import { AlertTriangle } from 'lucide-react'
import type { Sample } from '../types'
import { useGetServices } from '@/context/service-status-context'
import {
  useMcpParams,
  useOptionalServiceGroup,
  useTextGenerationParams,
  useTtsParams,
} from '@/samples/common/hooks'
import { SampleParamsSlot } from '../common/sample-params-slot'
import { useExamRecords } from './hooks/use-exam-records'

export function AiExamMarkingDemo({ sample }: { sample: Sample }) {
  const textGen = useTextGenerationParams()
  const tts = useTtsParams(sample.id)

  const stt = useOptionalServiceGroup({
    serviceId: 'speech-to-text',
    serviceLabel: 'Speech to Text',
    offlineMessage:
      'Enable STT for voice input. Start the service from the services page.',
  })

  const mcp = useMcpParams()

  const { 'text-generation': textGenService } = useGetServices([
    'text-generation',
  ])
  const isMultimodal = textGenService?.currentModelType === 'multimodal'

  const [dataEntries, setDataEntries] = useState<DataEntry[]>([])
  const [gradingEntries, setGradingEntries] = useState<GradingEntry[]>([])
  const [activeTab, setActiveTab] = useState('define')
  const [referenceImage, setReferenceImage] = useState<string>('')
  const { records, saveRecord, deleteRecord, deleteAllRecords } =
    useExamRecords()

  const defineScrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (defineScrollRef.current) {
      defineScrollRef.current.scrollTop = defineScrollRef.current.scrollHeight
    }
  }, [dataEntries])

  const navItems = [
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
  ]

  const isStep1Active = activeTab === 'define' || activeTab === 'bbox'

  return (
    <div className="space-y-4">
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

      <SampleParamsSlot
        groups={[textGen.group, tts.group, stt.group, mcp.group]}
      />

      {/* Main Content */}
      <div className="flex overflow-hidden">
        {/* Sidebar Navigation */}
        <aside className="border-border bg-card/50 supports-[backdrop-filter]:bg-card/30 w-64 border-r backdrop-blur">
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
                    Set up your test paper structure with questions and marking
                    schemes
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
              <div className="h-full overflow-y-auto p-8">
                <div className="mb-6">
                  <h2 className="text-foreground font-bold">Grading</h2>
                  <p className="text-muted-foreground mt-2 text-xs">
                    Upload or capture answer sheet images — each will be graded
                    automatically via OCR and LLM
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
                  records={records}
                  deleteRecord={deleteRecord}
                  deleteAllRecords={deleteAllRecords}
                />
              </div>
            </TabsContent>
          </Tabs>
        </main>
      </div>
    </div>
  )
}
