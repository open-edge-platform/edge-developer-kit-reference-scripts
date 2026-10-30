// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { DataProcessingDialog } from "./data-processing-dialog"

afterEach(cleanup)

describe.each([
  "javascript:alert(1)",
  "//attacker.example/<script>",
  'asset/" onerror="alert(1)?redirect=//attacker.example#fragment',
  "data:text/html,<script>alert(1)</script>",
  "asset/1 ?#%",
  "%2e%2e",
])("DataProcessingDialog media URLs for %s", (assetId) => {
  it.each([
    { stage: "GVHMR", preview: "gvhmr_global" },
    { stage: "GMR", preview: "gmr_video" },
  ])("keeps the $stage source on the same-origin API route", ({ stage, preview }) => {
    render(
      <DataProcessingDialog
        asset={{
          id: assetId,
          filename: "motion.mp4",
          extension: ".mp4",
          size_bytes: 10,
          created_at: "2026-10-06T00:00:00Z",
          artifacts: ["gvhmr", "gmr_csv"],
        }}
        jobs={[]}
        open
        onOpenChange={vi.fn()}
        terminalJob={null}
        terminalLines={[]}
        maxIterations={10001}
        numEnvs={4096}
        onSubmit={vi.fn()}
      />,
    )
    const navigation = screen.getByRole("navigation", { name: "Processing stages" })
    fireEvent.click(within(navigation).getByText(stage))

    const source = screen.getByLabelText(`${stage} rendered video`).querySelector("source")
    const src = source?.getAttribute("src")
    if (!src) throw new Error("The video preview source was not rendered.")

    expect(src).toBe(`/api/assets/${encodeURIComponent(assetId)}/previews/${preview}`)
    expect(new URL(src, "https://app.example").origin).toBe("https://app.example")
    expect(new URL(src, "https://app.example").search).toBe("")
    expect(new URL(src, "https://app.example").hash).toBe("")
    expect(new URL(src, "http://127.0.0.1:3008").origin).toBe("http://127.0.0.1:3008")
  })
})
