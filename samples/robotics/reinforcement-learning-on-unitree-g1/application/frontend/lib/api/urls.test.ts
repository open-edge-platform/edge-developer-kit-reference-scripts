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
})