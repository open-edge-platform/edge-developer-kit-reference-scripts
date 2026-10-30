// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { refetchFilesMock, useAssetFilesMock } = vi.hoisted(() => ({
  refetchFilesMock: vi.fn(),
  useAssetFilesMock: vi.fn(),
}))

vi.mock("@/lib/hooks/api/use-assets", () => ({ useAssetFiles: useAssetFilesMock }))

import { AssetFilesBrowser } from "./asset-files-browser"

const firstAsset = {
  id: "asset-1",
  filename: "walk.mp4",
  extension: ".mp4",
  size_bytes: 10,
  created_at: "2026-10-06T00:00:00Z",
  artifacts: [],
}
const secondAsset = {
  id: "asset-2",
  filename: "turn.mp4",
  extension: ".mp4",
  size_bytes: 10,
  created_at: "2026-10-06T00:00:00Z",
  artifacts: [],
}
const firstFiles = [
  { path: "input/walk.mp4", is_video: true },
  { path: "artifacts/gmr/motion.npz", is_video: false },
  { path: "artifacts/gmr/preview #1.mp4", is_video: true },
]

beforeEach(() => {
  useAssetFilesMock.mockImplementation((assetId: string) => ({
    data: assetId === "asset-1" ? firstFiles : [{ path: "input/turn.mp4", is_video: true }],
    isLoading: false,
    isError: false,
    refetch: refetchFilesMock,
  }))
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("AssetFilesBrowser", () => {
  it("renders an expandable file tree and opens only video files in the player", async () => {
    render(<AssetFilesBrowser asset={firstAsset} />)
    fireEvent.click(screen.getByRole("button", { name: "Expand Files" }))
    expect(refetchFilesMock).toHaveBeenCalledOnce()

    const artifactsFolder = await screen.findByRole("button", { name: "Collapse artifacts" })
    expect(artifactsFolder.getAttribute("aria-expanded")).toBe("true")
    expect(screen.getByRole("button", { name: "Collapse artifacts/gmr" })).toBeTruthy()
    expect(artifactsFolder.closest("li")?.querySelector("ul")).not.toBeNull()

    const motionEntry = screen.getByRole("button", { name: "artifacts/gmr/motion.npz" }) as HTMLButtonElement
    expect(motionEntry.disabled).toBe(true)

    fireEvent.click(artifactsFolder)
    expect(screen.getByRole("button", { name: "Expand artifacts" }).getAttribute("aria-expanded")).toBe("false")
    expect(screen.queryByRole("button", { name: "artifacts/gmr/preview #1.mp4" })).toBeNull()
    expect(screen.queryByRole("dialog")).toBeNull()

    fireEvent.click(screen.getByRole("button", { name: "Expand artifacts" }))
    const videoEntry = await screen.findByRole("button", { name: "artifacts/gmr/preview #1.mp4" })

    fireEvent.click(videoEntry)

    const player = await screen.findByLabelText("walk.mp4: artifacts/gmr/preview #1.mp4")
    expect(player.getAttribute("src")).toBe(
      "/api/assets/asset-1/files/artifacts/gmr/preview%20%231.mp4",
    )
    expect(screen.getByRole("dialog")).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: "Close video preview" }))
    expect(screen.queryByRole("dialog")).toBeNull()
  })

  it("closes the active preview when the selected asset changes", async () => {
    const { rerender } = render(<AssetFilesBrowser key={firstAsset.id} asset={firstAsset} />)
    fireEvent.click(screen.getByRole("button", { name: "Expand Files" }))
    fireEvent.click(await screen.findByRole("button", { name: "input/walk.mp4" }))
    expect(await screen.findByRole("dialog")).toBeTruthy()

    rerender(<AssetFilesBrowser key={secondAsset.id} asset={secondAsset} />)

    expect(screen.queryByRole("dialog")).toBeNull()
    expect(screen.getAllByRole("button", { name: "Expand Files" })).toHaveLength(1)
    expect(useAssetFilesMock).toHaveBeenCalledWith("asset-2")
  })

  it.each([
    "javascript:alert(1).mp4",
    'preview" onerror="alert(1)?redirect=//attacker.example#fragment.mp4',
    "preview #1.mp4",
    "preview %25 &copy;.mp4",
    "data:text/html,<script>alert(1)</script>.mp4",
    "subfolder/clip\\name.mp4",
  ])("keeps the rendered source same-origin for %s", async (filename) => {
    const asset = { ...firstAsset, id: "//attacker.example/<script>" }
    const filePath = `input/${filename}`
    useAssetFilesMock.mockReturnValue({
      data: [{ path: filePath, is_video: true }],
      isLoading: false,
      isError: false,
      refetch: refetchFilesMock,
    })
    render(<AssetFilesBrowser asset={asset} />)

    fireEvent.click(screen.getByRole("button", { name: "Expand Files" }))
    fireEvent.click(await screen.findByRole("button", { name: filePath }))

    const player = await screen.findByLabelText(`${asset.filename}: ${filePath}`)
    const src = player.getAttribute("src")
    if (!src) throw new Error("The video preview source was not rendered.")

    expect(src).toBe(
      `/api/assets/${encodeURIComponent(asset.id)}/files/${filePath.split("/").map(encodeURIComponent).join("/")}`,
    )
    const destination = new URL(src, "https://app.example")
    expect(destination.origin).toBe("https://app.example")
    expect(destination.search).toBe("")
    expect(destination.hash).toBe("")
    expect(new URL(src, "http://127.0.0.1:3008").origin).toBe("http://127.0.0.1:3008")
  })
})