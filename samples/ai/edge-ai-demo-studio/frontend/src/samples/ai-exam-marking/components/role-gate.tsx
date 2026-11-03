// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { BookOpen, GraduationCap, IdCard, type LucideIcon } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { ExamRole } from '../hooks/use-exam-role'

const ROLES: {
  role: ExamRole
  icon: LucideIcon
  title: string
  description: string
}[] = [
  {
    role: 'teacher',
    icon: GraduationCap,
    title: 'Teacher',
    description: 'Create marking schemes and grade student answers',
  },
  {
    role: 'student',
    icon: BookOpen,
    title: 'Student',
    description: 'Review your results',
  },
]

export function RoleSelect({
  onSelect,
}: {
  onSelect: (role: ExamRole) => void
}) {
  return (
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
          {ROLES.map(({ role, icon: Icon, title, description }) => (
            <button
              key={role}
              type="button"
              onClick={() => onSelect(role)}
              className="group border-border hover:border-primary hover:bg-primary/5 focus-visible:ring-primary flex flex-col items-center gap-4 rounded-xl border-2 bg-transparent p-8 transition-all duration-200 focus-visible:ring-2 focus-visible:outline-none"
            >
              <div className="bg-primary/10 group-hover:bg-primary/20 flex h-16 w-16 items-center justify-center rounded-full transition-colors duration-200">
                <Icon className="text-primary h-8 w-8" aria-hidden />
              </div>
              <div className="space-y-1">
                <p className="text-foreground font-semibold">{title}</p>
                <p className="text-muted-foreground text-xs">{description}</p>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

export function StudentLoginForm({
  onSubmit,
  onBack,
}: {
  onSubmit: (studentId: string) => void
  onBack: () => void
}) {
  const [draft, setDraft] = useState('')
  const studentId = draft.trim()

  return (
    <div className="flex h-[calc(100svh-12rem)] items-center justify-center">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-2 text-center">
          <div className="bg-primary/10 mx-auto flex h-16 w-16 items-center justify-center rounded-full">
            <IdCard className="text-primary h-8 w-8" aria-hidden />
          </div>
          <h2 className="text-foreground text-2xl font-bold">Student Login</h2>
          <p className="text-muted-foreground text-sm">
            Enter your student ID to continue
          </p>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (studentId) onSubmit(studentId)
          }}
          className="space-y-4"
        >
          <div className="space-y-1.5">
            <Label htmlFor="student-id-input" className="text-xs">
              Student ID{' '}
              <span className="text-destructive" aria-hidden>
                *
              </span>
            </Label>
            <Input
              id="student-id-input"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="e.g. S12345"
              required
              autoFocus
            />
          </div>
          <Button type="submit" disabled={!studentId} className="w-full">
            Continue
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onBack}
            className="text-muted-foreground w-full text-xs"
          >
            Back
          </Button>
        </form>
      </div>
    </div>
  )
}
