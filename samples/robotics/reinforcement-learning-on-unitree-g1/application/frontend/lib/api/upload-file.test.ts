import { describe, expect, it, vi } from "vitest"

const { post } = vi.hoisted(() => ({ post: vi.fn() }))

vi.mock("./client", () => ({ fetchClient: { POST: post } }))

import { uploadAsset } from "./upload-file"

describe("uploadAsset", () => {
  it("sends the file as multipart form data and returns the typed asset", async () => {
    const file = new File(["video"], "walk.mp4", { type: "video/mp4" })
    const asset = {
      id: "asset-1",
      filename: file.name,
      extension: ".mp4",
      size_bytes: file.size,
      created_at: "2026-10-05T00:00:00Z",
      artifacts: [],
    }
    post.mockResolvedValue({ data: asset, response: new Response() })

    await expect(uploadAsset(file)).resolves.toEqual(asset)

    const [path, options] = post.mock.calls[0]
    expect(path).toBe("/assets")
    expect(options.body).toBeInstanceOf(FormData)
    expect((options.body as FormData).get("file")).toBe(file)
  })
})