// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { LIPSYNC_PORT } from '@/lib/constants'

export type LipsyncStatus = 'idle' | 'processing' | 'complete'

export interface LipsyncStatusMessage {
  type: 'lipsync_status'
  status: 'processing_started' | 'processing_complete'
  timestamp: number
}

export class LipsyncStatusTracker {
  private ws: WebSocket | null = null
  private sessionId: string
  private statusCallback: ((status: LipsyncStatus) => void) | null = null
  private currentStatus: LipsyncStatus = 'idle'
  private reconnectAttempts: number = 0
  private maxReconnectAttempts: number = 3
  private reconnectTimeout: NodeJS.Timeout | null = null

  constructor(sessionId: string) {
    this.sessionId = sessionId
  }

  // Start WebSocket connection for real-time status updates on lipsync processing
  connectWebSocket(onStatusChange?: (status: LipsyncStatus) => void): void {
    if (onStatusChange) {
      this.statusCallback = onStatusChange
    }

    // Don't attempt to reconnect if we've exceeded max attempts
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      if (this.reconnectAttempts === this.maxReconnectAttempts) {
        console.warn(
          `[LipsyncStatusTracker] Max reconnection attempts reached. Lipsync status tracking disabled.`,
        )
        this.reconnectAttempts++
      }
      return
    }

    // Use window.location.protocol to determine ws:// or wss://
    const protocol =
      typeof window !== 'undefined' && window.location.protocol === 'https:'
        ? 'wss:'
        : 'ws:'
    const wsUrl = `${protocol}//localhost:${LIPSYNC_PORT}/ws/${this.sessionId}`

    try {
      this.ws = new WebSocket(wsUrl)

      this.ws.onopen = () => {
        this.reconnectAttempts = 0 // Reset on successful connection
        console.log(
          `[LipsyncStatusTracker] WebSocket connected for session ${this.sessionId}`,
        )
      }

      this.ws.onmessage = (event) => {
        try {
          const message: LipsyncStatusMessage = JSON.parse(event.data)

          if (message.type === 'lipsync_status') {
            const newStatus: LipsyncStatus =
              message.status === 'processing_started'
                ? 'processing'
                : message.status === 'processing_complete'
                  ? 'complete'
                  : 'idle'

            this.updateStatus(newStatus)
          }
        } catch (error) {
          console.error(
            '[LipsyncStatusTracker] Error parsing WebSocket message:',
            error,
          )
        }
      }

      this.ws.onerror = (error) => {
        // Log detailed error information for debugging
        if (this.reconnectAttempts === 0) {
          console.warn(
            `[LipsyncStatusTracker] WebSocket connection failed for session ${this.sessionId}.`,
            'URL:',
            wsUrl,
            `This is normal if the lipsync session has not started yet. Error: ${error}`,
          )
        }
      }

      this.ws.onclose = () => {
        this.ws = null

        // Only log if we had a successful connection before
        if (this.reconnectAttempts === 0) {
          console.log(
            `[LipsyncStatusTracker] WebSocket closed for session ${this.sessionId}`,
          )
        }

        // Don't attempt to reconnect automatically
        this.reconnectAttempts = this.maxReconnectAttempts
      }
    } catch (error) {
      if (this.reconnectAttempts === 0) {
        console.warn(
          `[LipsyncStatusTracker] WebSocket not available. Lipsync status tracking disabled. Error: ${error}`,
        )
      }
      this.reconnectAttempts = this.maxReconnectAttempts
    }
  }

  disconnect(): void {
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout)
      this.reconnectTimeout = null
    }

    this.statusCallback = null
    this.currentStatus = 'idle'
    this.reconnectAttempts = 0
  }

  private updateStatus(newStatus: LipsyncStatus): void {
    if (
      (this.currentStatus !== newStatus || newStatus === 'complete') &&
      this.statusCallback
    ) {
      this.currentStatus = newStatus
      try {
        this.statusCallback(newStatus)
      } catch (error) {
        console.error('[LipsyncStatusTracker] Error in status callback:', error)
      }
    }
  }
}
