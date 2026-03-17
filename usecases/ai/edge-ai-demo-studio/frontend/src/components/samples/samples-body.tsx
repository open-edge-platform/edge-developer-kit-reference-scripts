// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

export default function SamplesBody({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-1 flex-col overflow-hidden p-6">
      <div className="mx-auto flex h-full w-full max-w-6xl flex-col overflow-hidden rounded-lg">
        {children}
      </div>
    </div>
  )
}
