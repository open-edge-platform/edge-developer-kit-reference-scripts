// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { API_BASE_URL } from "./client"

export function downloadAssetArchive(assetId: string) {
  return downloadArchive(
    `/assets/${encodeURIComponent(assetId)}/download`,
    `asset-${assetId}.zip`,
  )
}

export function downloadRunArchive(experiment: string, runName: string) {
  return downloadArchive(
    `/runs/${encodeURIComponent(experiment)}/${encodeURIComponent(runName)}/download`,
    `run-${experiment}-${runName}.zip`,
  )
}

async function downloadArchive(path: string, filename: string): Promise<void> {
  const link = document.createElement("a")
  link.href = `${API_BASE_URL}${path}`
  link.download = filename
  document.body.append(link)
  link.click()
  link.remove()
}