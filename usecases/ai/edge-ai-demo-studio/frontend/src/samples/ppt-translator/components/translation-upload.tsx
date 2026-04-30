// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useCallback, useState } from 'react'
import { Upload, FileText, AlertCircle, Loader2 } from 'lucide-react'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { FileDropZone } from '@/components/common/file-drop-zone'

interface TranslationUploadProps {
  disabled?: boolean
  isUploading?: boolean
  uploadError?: string | null
  model: string
  onUpload: (file: File) => void
}

const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024

function validatePptFile(file: File): string | null {
  const name = file.name.toLowerCase()
  if (!name.endsWith('.pptx') && !name.endsWith('.ppt')) {
    return 'Please select a valid PowerPoint file (.pptx or .ppt)'
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return 'File size must be less than 50MB'
  }
  return null
}

export function TranslationUpload({
  disabled,
  isUploading = false,
  uploadError,
  model,
  onUpload,
}: TranslationUploadProps) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null)

  const validate = useCallback((f: File) => validatePptFile(f), [])

  const handleSubmit = () => {
    if (selectedFile) onUpload(selectedFile)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Upload Presentation</CardTitle>
        <CardDescription>
          Upload a PowerPoint file (.pptx or .ppt) to translate
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <FileDropZone
          file={selectedFile}
          onFileChange={setSelectedFile}
          accept=".pptx,.ppt"
          validate={validate}
          disabled={disabled || isUploading}
          label="Drop your PowerPoint file here"
          hint="or click to browse (.pptx, .ppt)"
          maxSizeHint="Maximum file size: 50MB"
          fileIcon={FileText}
          testId="file-upload-area"
          inputTestId="file-input"
        />

        {uploadError && (
          <div className="border-destructive/50 bg-destructive/10 text-destructive rounded-lg border p-4">
            <p className="flex items-center gap-2 text-sm font-medium">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              {uploadError}
            </p>
          </div>
        )}

        <Button
          data-testid="start-translation-button"
          onClick={handleSubmit}
          disabled={!selectedFile || disabled || isUploading}
          className="w-full"
          size="lg"
        >
          {isUploading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Uploading...
            </>
          ) : (
            <>
              <Upload className="mr-2 h-4 w-4" />
              Start Translation
            </>
          )}
        </Button>

        <div className="bg-muted rounded-lg p-4">
          <div className="text-muted-foreground space-y-1 text-xs">
            <p>✓ Supported formats: .pptx, .ppt</p>
            <p>✓ Maximum file size: 50MB</p>
            <p>✓ All formatting will be preserved</p>
            <p>✓ Translation uses {model}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
