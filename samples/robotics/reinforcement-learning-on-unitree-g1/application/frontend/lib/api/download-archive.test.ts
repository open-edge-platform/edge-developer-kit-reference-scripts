import { cleanup } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { downloadAssetArchive, downloadRunArchive } from "./download-archive"

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("archive downloads", () => {
  it("downloads asset and run ZIPs using their scoped endpoints and names", async () => {
    const downloadedNames: string[] = []
    const downloadUrls: string[] = []
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      downloadedNames.push(this.download)
      downloadUrls.push(this.href)
    })

    await downloadAssetArchive("asset-1")
    await downloadRunArchive("g1_tracking", "run 1")

    expect(downloadUrls).toEqual([
      `${window.location.origin}/api/assets/asset-1/download`,
      `${window.location.origin}/api/runs/g1_tracking/run%201/download`,
    ])
    expect(downloadedNames).toEqual(["asset-asset-1.zip", "run-g1_tracking-run 1.zip"])
  })
})