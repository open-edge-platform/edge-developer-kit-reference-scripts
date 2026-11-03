// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { cn } from '@/lib/utils'

export interface AssistantAvatarStyle {
  /** Background of the avatar circle; `bg-primary/15` by default. */
  avatarClassName?: string
  /** Colour of its "AI" text; `text-primary` by default. */
  avatarTextClassName?: string
}

/** The round "AI" marker beside the assistant's messages. */
export function AssistantAvatar({
  avatarClassName = 'bg-primary/15',
  avatarTextClassName = 'text-primary',
}: AssistantAvatarStyle) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        'ring-border/50 mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ring-1',
        avatarClassName,
      )}
    >
      <span className={cn('text-[10px] font-bold', avatarTextClassName)}>
        AI
      </span>
    </div>
  )
}
