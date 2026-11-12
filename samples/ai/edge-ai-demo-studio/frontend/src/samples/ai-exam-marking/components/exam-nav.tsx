// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { cn } from '@/lib/utils'
import type { ExamRole } from '../hooks/use-exam-role'

export type ExamTab =
  | 'define'
  | 'bbox'
  | 'grading'
  | 'history'
  | 'dashboard'
  | 'chatbot'
  | 'dispatch'

type NavItem =
  | { label: string; tabs: { value: ExamTab; label: string }[] }
  | { label: string; value: ExamTab }

/** What each role can reach, in step order. */
const NAV: Record<ExamRole, NavItem[]> = {
  teacher: [
    {
      label: 'Setup',
      tabs: [
        { value: 'define', label: 'Marking Scheme' },
        { value: 'bbox', label: 'Bounding Box Setup' },
      ],
    },
    { label: 'Grading', value: 'grading' },
    { label: 'History', value: 'history' },
    { label: 'Dashboard', value: 'dashboard' },
    { label: 'Agent', value: 'chatbot' },
    { label: 'Dispatch', value: 'dispatch' },
  ],
  student: [{ label: 'History', value: 'history' }],
}

function StepNumber({
  index,
  active,
  size,
}: {
  index: number
  active: boolean
  size: 'main' | 'sub'
}) {
  return (
    <span
      className={cn(
        'flex shrink-0 items-center justify-center rounded-full font-semibold',
        size === 'main' ? 'h-6 w-6 text-xs' : 'h-5 w-5 text-[10px]',
        active
          ? size === 'main'
            ? 'bg-primary-foreground text-primary'
            : 'bg-primary text-primary-foreground'
          : 'bg-border text-muted-foreground',
      )}
      aria-hidden
    >
      {index}
    </span>
  )
}

function NavButton({
  active,
  index,
  label,
  onClick,
  size = 'main',
}: {
  active: boolean
  index: number
  label: string
  onClick: () => void
  size?: 'main' | 'sub'
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'step' : undefined}
      className={cn(
        'w-full text-left text-xs font-medium transition-all duration-200',
        size === 'main'
          ? 'relative rounded-lg px-4 py-3'
          : 'rounded-md px-3 py-2',
        active
          ? size === 'main'
            ? 'bg-primary text-primary-foreground shadow-primary/20 shadow-lg'
            : 'text-primary font-semibold'
          : 'text-muted-foreground hover:text-foreground',
      )}
    >
      <span
        className={cn('flex items-center', size === 'main' ? 'gap-3' : 'gap-2')}
      >
        <StepNumber index={index} active={active} size={size} />
        {label}
      </span>
    </button>
  )
}

/** The step list beside the demo's content. */
export function ExamNav({
  role,
  activeTab,
  onSelect,
}: {
  role: ExamRole
  activeTab: ExamTab
  onSelect: (tab: ExamTab) => void
}) {
  return (
    <nav className="space-y-1 p-6" aria-label="AI Exam Marking steps">
      {NAV[role].map((item, index) => {
        const step = index + 1
        if ('tabs' in item) {
          const open = item.tabs.some((tab) => tab.value === activeTab)
          return (
            <div key={item.label}>
              <NavButton
                active={open}
                index={step}
                label={item.label}
                onClick={() => onSelect(item.tabs[0].value)}
              />
              {open && (
                <div className="mt-1 ml-4 space-y-1 border-l pl-4">
                  {item.tabs.map((tab, subIndex) => (
                    <NavButton
                      key={tab.value}
                      size="sub"
                      active={activeTab === tab.value}
                      index={subIndex + 1}
                      label={tab.label}
                      onClick={() => onSelect(tab.value)}
                    />
                  ))}
                </div>
              )}
            </div>
          )
        }
        return (
          <NavButton
            key={item.value}
            active={activeTab === item.value}
            index={step}
            label={item.label}
            onClick={() => onSelect(item.value)}
          />
        )
      })}
    </nav>
  )
}
