// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

type WorkspaceMetric = {
  label: string
  value: number
}

export function WorkspacePageHeader({
  title,
  apiOnline,
  metrics,
}: {
  title: string
  apiOnline: boolean
  metrics: WorkspaceMetric[]
}) {
  return (
    <section className="mb-7 flex flex-wrap items-end justify-between gap-4 border-b border-[#dce3dc] pb-5">
      <div className="flex items-center gap-2">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-[30px]">{title}</h1>
        <span
          role="status"
          aria-label={`API ${apiOnline ? "online" : "offline"}`}
          title={`API ${apiOnline ? "online" : "offline"}`}
          className={`size-2 rounded-full ${apiOnline ? "bg-[#67b942]" : "bg-[#d67954]"}`}
        />
      </div>
      <div className="flex flex-wrap items-center gap-4 font-mono text-xs text-[#647166] sm:gap-6">
        {metrics.map(({ label, value }) => (
          <div key={label}>
            <span className="mr-2 text-lg font-semibold text-[#17251a]">{value}</span>
            {label}
          </div>
        ))}
      </div>
    </section>
  )
}