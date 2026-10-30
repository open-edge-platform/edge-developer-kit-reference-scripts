// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { components } from "../api-schema"
import { fetchClient } from "./client"

type UploadBody = components["schemas"]["Body_upload_asset_assets_post"]

const fileBody = (file: File): UploadBody => {
  const body = new FormData()
  body.append("file", file)
  return body as unknown as UploadBody
}

export async function uploadAsset(file: File) {
  const result = await fetchClient.POST("/assets", { body: fileBody(file) })
  if (result.error !== undefined || result.data === undefined) {
    throw result.error ?? new Error("Upload failed")
  }
  return result.data
}