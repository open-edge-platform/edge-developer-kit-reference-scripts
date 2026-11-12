// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { POST as examMarkingAgentChat } from '@/app/api/services/exam-marking-agent/chat/route'

/** The sample's alias for the Exam Marking Agent chat. */
export async function POST(req: Request) {
  return examMarkingAgentChat(req)
}
