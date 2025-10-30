// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import React from 'react'
import { type FileRejection } from 'react-dropzone'

import { type CustomFile } from '@/types/dropzone'

interface RejectionFilesProps {
  fileRejections: FileRejection[]
}

export default function RejectionFiles({
  fileRejections,
}: RejectionFilesProps): React.JSX.Element {
  function getDropzoneData(
    file: CustomFile | string,
    index?: number,
  ): Record<string, string | number | Date | undefined> {
    if (typeof file === 'string') {
      return {
        key: index ? `${file}-${index}` : file,
        preview: file,
      }
    }

    return {
      key: index ? `${file.name}-${index}` : file.name,
      name: file.name,
      size: file.size,
      path: file.path,
      type: file.type,
      preview: file.preview,
      lastModified: file.lastModified,
      lastModifiedDate: file.lastModifiedDate,
    }
  }

  return (
    <div className="rounded-lg border border-red-300 bg-red-50 p-4">
      {fileRejections.map(({ file, errors }) => {
        const { path, size } = getDropzoneData(file)

        return (
          <div key={path ? (path as string) : null} className="my-2">
            <p className="truncate text-sm font-semibold">
              {path ? (path as string) : null} - {size ? (size as number) : ''}
            </p>

            <ul className="list-inside list-disc">
              {errors.map((error) => (
                <li key={error.code} className="text-xs text-red-600">
                  {error.message}
                </li>
              ))}
            </ul>
          </div>
        )
      })}
    </div>
  )
}
