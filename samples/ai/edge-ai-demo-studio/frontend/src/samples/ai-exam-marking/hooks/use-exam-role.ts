// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useState } from 'react'

export type ExamRole = 'teacher' | 'student'

/** Who uses the demo: a teacher (sets up, grades) or a student (own results only); `null` until chosen. */
export function useExamRole() {
  const [role, setRole] = useState<ExamRole | null>(null)
  const [studentId, setStudentId] = useState('')
  const [loggingIn, setLoggingIn] = useState(false)

  return {
    role,
    /** The ID the student logged in with; '' for a teacher. */
    studentId,
    /** The student ID form is shown. */
    loggingIn,
    chooseTeacher: () => setRole('teacher'),
    startStudentLogin: () => setLoggingIn(true),
    cancelStudentLogin: () => setLoggingIn(false),
    logInStudent: (id: string) => {
      setStudentId(id)
      setLoggingIn(false)
      setRole('student')
    },
    changeRole: () => {
      setRole(null)
      setStudentId('')
    },
  }
}
