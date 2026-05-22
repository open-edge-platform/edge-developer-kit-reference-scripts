// Copyright (C) 2024 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

// material-ui ui/src/types/dropzone.ts
import { type SxProps, type Theme } from '@mui/material/styles';
//third-party
import { type DropzoneOptions } from 'react-dropzone';

// ==============================|| TYPES - DROPZONE ||============================== //

export enum DropzopType {
  Default = 'DEFAULT',
  Standard = 'STANDARD',
}

export interface CustomFile extends File {
  path?: string;
  preview?: string;
  lastModifiedDate?: Date;
}

export interface UploadProps extends DropzoneOptions {
  error?: boolean;
  file?: CustomFile[] | null;
  acceptFileType?: any;
  showList?: boolean;
  type?: DropzopType;
  setFieldValue: (field: string, value: any) => void;
  sx?: SxProps<Theme>;
}

export interface UploadMultiFileProps extends DropzoneOptions {
  files?: CustomFile[] | null;
  error?: boolean;
  showList?: boolean;
  type?: DropzopType;
  sx?: SxProps<Theme>;
  acceptFileType?: Record<string, any[]>;
  isMultiple?: boolean;
  isUploading?: boolean;
  onUpload?: VoidFunction;
  onRemove?: (file: File | string) => void;
  onRemoveAll?: VoidFunction;
  setFieldValue: (field: string, value: any) => void;
}

export interface FilePreviewProps {
  showList?: boolean;
  type?: DropzopType;
  files: (File | string)[];
  onRemove?: (file: File | string) => void;
}
