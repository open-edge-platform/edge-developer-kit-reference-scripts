/* eslint-disable @typescript-eslint/no-explicit-any */
// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { type DropzoneOptions } from 'react-dropzone'

// ==============================|| TYPES - DROPZONE ||============================== //

export enum DropzopType {
  Default = 'DEFAULT',
  Standard = 'STANDARD',
}

export interface CustomFile extends File {
  path?: string
  preview?: string
  lastModifiedDate?: Date
}

export interface UploadProps extends DropzoneOptions {
  error?: boolean
  file?: CustomFile[] | null
  acceptFileType?: any
  showList?: boolean
  type?: DropzopType
  setFieldValue: (field: string, value: any) => void
}

export interface UploadMultiFileProps extends DropzoneOptions {
  files?: CustomFile[] | null
  error?: boolean
  showList?: boolean
  type?: DropzopType
  acceptFileType?: Record<string, any[]>
  isMultiple?: boolean
  isUploading?: boolean
  onUpload?: VoidFunction
  onRemove?: (file: File | string) => void
  onRemoveAll?: VoidFunction
  setFieldValue: (field: string, value: any) => void
}

export interface FilePreviewProps {
  showList?: boolean
  type?: DropzopType
  files: (File | string)[]
  onRemove?: (file: File | string) => void
}
