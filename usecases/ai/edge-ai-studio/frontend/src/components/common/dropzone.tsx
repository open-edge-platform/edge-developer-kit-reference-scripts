// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { FileText, Trash2, Upload } from 'lucide-react'
import React, { useMemo } from 'react'
import { useDropzone } from 'react-dropzone'

import { Button } from '@/components/ui/button'
import { type CustomFile, type UploadMultiFileProps } from '@/types/dropzone'

import RejectionFiles from './rejection-file'

export default function Dropzone({
  files = [],
  setFieldValue,
  acceptFileType,
  isMultiple = true,
  isUploading,
  onUpload,
}: UploadMultiFileProps): React.JSX.Element {
  const acceptedFileString = useMemo(() => {
    if (acceptFileType)
      return `(Only ${Object.values(acceptFileType).flat().join(', ')} files are accepted)`
    return ''
  }, [acceptFileType])

  const {
    getRootProps,
    getInputProps,
    isDragActive,
    fileRejections,
    isDragReject,
  } = useDropzone({
    multiple: isMultiple,
    accept: acceptFileType,
    disabled: isUploading,
    onDrop: (acceptedFiles: CustomFile[]) => {
      if (files) {
        setFieldValue('files', [
          ...files,
          ...acceptedFiles.map((file: CustomFile) =>
            Object.assign(file, {
              preview: URL.createObjectURL(file),
            }),
          ),
        ])
      } else {
        setFieldValue(
          'files',
          acceptedFiles.map((file: CustomFile) =>
            Object.assign(file, {
              preview: URL.createObjectURL(file),
            }),
          ),
        )
      }
    },
  })

  const onRemoveAll = (): void => {
    setFieldValue('files', null)
  }

  const onRemove = (file: File | string): void => {
    const filteredItems = files?.filter((_file) => _file !== file)
    setFieldValue('files', filteredItems)
  }

  return (
    <>
      <div
        {...getRootProps()}
        className={`flex h-48 w-full flex-col items-center justify-center rounded-lg border-2 border-dashed bg-gray-50 text-gray-400 transition-colors ${
          isDragActive ? 'border-blue-500' : 'border-gray-300'
        } hover:border-blue-500`}
      >
        <input {...getInputProps()} />
        <Upload />
        <p className="mt-2">Click to upload or drag and drop</p>
        <p>{acceptedFileString}</p>
      </div>
      <ul className="max-h-48 overflow-auto">
        {fileRejections.length > 0 && (
          <RejectionFiles fileRejections={[...fileRejections]} />
        )}
        {files &&
          files.map((file, index) => (
            <li
              key={index}
              className="flex items-center justify-between p-2 hover:bg-gray-100"
            >
              <div className="flex items-center gap-2 overflow-hidden">
                <FileText />
                <div>
                  <p className="text-sm font-medium">{file.name}</p>
                  <p className="text-xs text-gray-500">{`${(file.size / 1024).toFixed(2)} KB`}</p>
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="text-red-500 hover:text-red-700"
                disabled={isUploading}
                onClick={() => onRemove(file)}
              >
                <Trash2 />
              </Button>
            </li>
          ))}
      </ul>
      {files && files.length > 0 && (
        <div className="mt-4 flex justify-between">
          <Button variant="outline" onClick={onRemoveAll}>
            Remove All
          </Button>
          <Button
            onClick={onUpload}
            className={`${isDragReject ? 'cursor-not-allowed' : ''}`}
            disabled={isUploading || isDragReject}
          >
            {isUploading ? (
              <div className="flex items-center gap-2">
                <span>Uploading</span>
                <div className="size-5 animate-spin rounded-full border-2 border-white border-t-transparent"></div>
              </div>
            ) : (
              'Upload'
            )}
          </Button>
        </div>
      )}
    </>
  )
}
