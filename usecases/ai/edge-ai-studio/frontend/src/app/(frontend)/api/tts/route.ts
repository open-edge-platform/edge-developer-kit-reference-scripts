// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { TEXT_TO_SPEECH_PORT } from '@/lib/constants'

export async function POST(req: Request) {
  const url = `http://localhost:${TEXT_TO_SPEECH_PORT}/v1/audio/speech`
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: await req.text(),
  })

  if (!response.ok) {
    return new Response('Network response was not ok', { status: 500 })
  }

  return response
}
