// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { GenerationType } from './api'
import type { GeneratedImage } from './types'

/**
 * Parses a history asset URL (`.../outputs/<project>/<TYPE>/<14-digit-timestamp>-…`) into a
 * {@link GeneratedImage}. Legacy flat `<timestamp>_<TYPE>_….png` names, under `/outputs/` or not,
 * are handled as fallbacks.
 */
export function parseHistoryUrl(url: string): GeneratedImage {
  let type = GenerationType.GOOD_DATASET
  let customTypeRaw: string | undefined
  let timestamp = 0
  let datePart = ''
  let projectName = 'Default Project'

  const filename = url.split('/').pop() || ''
  const urlDecoded = decodeURIComponent(url)
  const outputsIndex = urlDecoded.indexOf('/outputs/')

  if (outputsIndex !== -1) {
    const pathParts = urlDecoded.substring(outputsIndex + 9).split('/')
    if (pathParts.length >= 3) {
      projectName = pathParts[0]
      const typeStr = pathParts[1]

      if (typeStr === 'SYNTHETIC') type = GenerationType.GOOD_DATASET
      else if (typeStr === 'MISSING_COMPONENT')
        type = GenerationType.MISSING_COMPONENTS
      else if (typeStr.startsWith('CUSTOM')) {
        type = GenerationType.CUSTOM
        if (typeStr.startsWith('CUSTOM_')) {
          customTypeRaw = typeStr.substring(7)
        }
      }
      const nameParts = pathParts[2].split('-')
      if (nameParts.length > 0) datePart = nameParts[0]
    } else if (!filename.includes('-')) {
      const parts = filename.split('_')
      datePart = parts[0]
      if (parts.length >= 3) {
        const typeStr = parts.slice(1, parts.length - 1).join('_')
        if (typeStr === 'SYNTHETIC') type = GenerationType.GOOD_DATASET
        else if (typeStr === 'MISSING_COMPONENT')
          type = GenerationType.MISSING_COMPONENTS
        else if (typeStr === 'CUSTOM') type = GenerationType.CUSTOM
        else if (typeStr.startsWith('CUSTOM_')) {
          type = GenerationType.CUSTOM
          customTypeRaw = typeStr.substring(7)
        }
      }
    }
  } else {
    if (filename.includes('_')) {
      const parts = filename.split('_')
      datePart = parts[0]
    }
  }

  if (datePart && datePart.length === 14) {
    const year = parseInt(datePart.substring(0, 4))
    const month = parseInt(datePart.substring(4, 6)) - 1
    const day = parseInt(datePart.substring(6, 8))
    const hour = parseInt(datePart.substring(8, 10))
    const minute = parseInt(datePart.substring(10, 12))
    const second = parseInt(datePart.substring(12, 14))
    timestamp = new Date(year, month, day, hour, minute, second).getTime()
  }

  const maskUrl =
    type === GenerationType.MISSING_COMPONENTS
      ? url.replace(/\.png$/, '-mask.png')
      : undefined

  return {
    // Unlike a list position, the URL still names the same image after a refetch.
    id: url,
    url,
    type,
    customTypeRaw,
    timestamp,
    project: projectName,
    maskUrl,
  }
}
