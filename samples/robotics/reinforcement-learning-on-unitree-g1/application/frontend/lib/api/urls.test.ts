// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest"

import { assetFileUrl, assetPreviewUrl, jobEventsUrl } from "./urls"

describe("API URLs", () => {
  it("prefixes media URLs with the same-origin API route and encodes path segments", () => {
    expect(assetPreviewUrl("asset/1", "gmr preview")).toBe(
      "/api/assets/asset%2F1/previews/gmr%20preview",
    )
  })

  it("builds the job event URL under the API route", () => {
    expect(jobEventsUrl("job-1")).toBe("/api/jobs/job-1/events")
  })

  it("encodes asset file paths without encoding directory separators", () => {
    expect(assetFileUrl("asset/1", "artifacts/preview #1.mp4")).toBe(
      "/api/assets/asset%2F1/files/artifacts/preview%20%231.mp4",
    )
  })

  it("keeps untrusted media names in same-origin API paths", () => {
    const urls = [
      assetFileUrl("javascript:alert(1)", "javascript:alert(1)"),
      assetPreviewUrl("javascript:alert(1)", "javascript:alert(1)"),
    ]

    for (const url of urls) {
      expect(url.startsWith("/api/")).toBe(true)
      expect(new URL(url, "https://app.example").origin).toBe("https://app.example")
    }
  })

  it.each([
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "//attacker.example/video.mp4",
    "https://attacker.example/video.mp4",
    '"><img src=x onerror=alert(1)>',
    "\u0000\r\njavascript:alert(1)",
    "\\\\attacker.example\\video.mp4",
    "%2f%2fattacker.example/video.mp4",
    "preview.mp4?redirect=//attacker.example#fragment",
  ])("encodes hostile media identifiers without introducing a URL scheme: %s", (value) => {
    for (const url of [assetFileUrl(value, value), assetPreviewUrl(value, value)]) {
      expect(url.startsWith("/api/assets/")).toBe(true)
      const destination = new URL(url, "https://app.example")
      expect(destination.origin).toBe("https://app.example")
      expect(destination.protocol).toBe("https:")
      expect(destination.search).toBe("")
      expect(destination.hash).toBe("")
    }
  })
})