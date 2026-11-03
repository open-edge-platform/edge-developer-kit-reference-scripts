// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/** A marking-scheme question's number, its marks underneath. */
export function QuestionHeading({
  number,
  marks,
}: {
  number: number
  marks: number
}) {
  return (
    <div className="flex items-center gap-3">
      <div
        className="bg-primary text-primary-foreground flex h-8 w-8 shrink-0 items-center justify-center rounded-full font-semibold"
        aria-hidden
      >
        {number}
      </div>
      <div>
        <p className="text-card-foreground font-medium">Question {number}</p>
        <p className="text-muted-foreground text-xs">{marks} marks</p>
      </div>
    </div>
  )
}
