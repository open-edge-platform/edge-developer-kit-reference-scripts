// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { NextRequest } from 'next/server'

const sseClients = new Set<ReadableStreamDefaultController>()

function broadcastEvent(data: {
  type: 'detection' | 'clear' | 'connected'
  event?: { timestamp: string; model: string; score: number }
}) {
  const message = `data: ${JSON.stringify(data)}\n\n`
  sseClients.forEach((controller) => {
    try {
      controller.enqueue(new TextEncoder().encode(message))
    } catch (error) {
      console.error('Failed to send SSE message:', error)
      sseClients.delete(controller)
    }
  })
}

export async function GET() {
  const stream = new ReadableStream({
    start(controller) {
      sseClients.add(controller)

      const message = `data: ${JSON.stringify({ type: 'connected' })}\n\n`
      controller.enqueue(new TextEncoder().encode(message))

      // Keep-alive ping every 30 seconds
      const keepAliveInterval = setInterval(() => {
        try {
          controller.enqueue(new TextEncoder().encode(': keep-alive\n\n'))
        } catch (error) {
          console.error('Failed to send keep-alive ping:', error)
          clearInterval(keepAliveInterval)
          sseClients.delete(controller)
        }
      }, 30000)

      return () => {
        clearInterval(keepAliveInterval)
        sseClients.delete(controller)
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    console.log('Received detection:', JSON.stringify(body))

    // Create detection event
    const event = {
      timestamp: new Date().toISOString(),
      model: body.model || 'Unknown',
      score: body.score || 0,
    }

    // Broadcast to all connected SSE clients
    broadcastEvent({ type: 'detection', event })

    return Response.json({
      success: true,
      message: 'Wake word detected successfully',
      event,
    })
  } catch (error) {
    let errorMessage = 'Failed to process detection'
    if (error instanceof Error) {
      errorMessage = error.message
    }
    console.error(errorMessage, error)

    return Response.json(
      {
        success: false,
        message: errorMessage,
        data: null,
      },
      { status: 500 },
    )
  }
}
