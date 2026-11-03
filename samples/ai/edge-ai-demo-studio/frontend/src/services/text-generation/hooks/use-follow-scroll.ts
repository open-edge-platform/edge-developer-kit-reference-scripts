// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import {
  type RefObject,
  type WheelEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import type { ChatMsg, ChatStatus } from '../lib/chat-helpers'

/** How close to the end (px) still counts as reading the latest output. */
const BOTTOM_SLACK = 24

interface FollowedContent {
  messages: ChatMsg[]
  status: ChatStatus
  error?: Error
}

/**
 * Keeps the conversation scrolled to the newest output while the reader is at the end; scrolling
 * up stops following. `contentRef` is observed so growth after render (images loading) follows too.
 */
export function useFollowScroll(
  scrollRef: RefObject<HTMLDivElement | null>,
  contentRef: RefObject<HTMLDivElement | null>,
  { messages, status, error }: FollowedContent,
) {
  const [following, setFollowing] = useState(true)
  const followingRef = useRef(true)
  const lastScrollTopRef = useRef(0)

  const lastMessage = messages[messages.length - 1]
  const [seenLastId, setSeenLastId] = useState(lastMessage?.id)
  if (lastMessage?.id !== seenLastId) {
    setSeenLastId(lastMessage?.id)
    // A new user message (or a cleared conversation) resumes following.
    if (lastMessage?.role !== 'assistant') setFollowing(true)
  }

  useLayoutEffect(() => {
    followingRef.current = following
    const el = scrollRef.current
    if (following && el) el.scrollTop = el.scrollHeight
  }, [scrollRef, following, messages, status, error])

  useEffect(() => {
    const el = scrollRef.current
    const content = contentRef.current
    if (!el || !content) return
    const observer = new ResizeObserver(() => {
      if (followingRef.current) el.scrollTop = el.scrollHeight
    })
    observer.observe(content)
    return () => observer.disconnect()
  }, [scrollRef, contentRef])

  const setFollow = (follow: boolean) => {
    followingRef.current = follow
    setFollowing(follow)
  }

  const onScroll = () => {
    const el = scrollRef.current
    if (!el) return
    const atBottom =
      el.scrollHeight - el.scrollTop - el.clientHeight <= BOTTOM_SLACK
    if (atBottom) setFollow(true)
    else if (el.scrollTop < lastScrollTopRef.current) setFollow(false)
    lastScrollTopRef.current = el.scrollTop
  }

  // Stops following on wheel-up, before streamed output can pull the view back down.
  const onWheel = (e: WheelEvent<HTMLDivElement>) => {
    const el = scrollRef.current
    if (!el || e.deltaY >= 0) return
    if (el.scrollHeight - el.clientHeight > BOTTOM_SLACK) setFollow(false)
  }

  const jumpToLatest = () => {
    setFollow(true)
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }

  return { following, onScroll, onWheel, jumpToLatest }
}
