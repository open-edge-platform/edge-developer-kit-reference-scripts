// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { useState, useCallback } from 'react'
import { Upload, FileText, X, AlertCircle, Loader2 } from 'lucide-react'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface TranslationUploadProps {
  disabled?: boolean
  isUploading?: boolean
  uploadError?: string | null
  model: string
  onUpload: (file: File) => void
}

const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024

export function TranslationUpload({
  disabled,
  isUploading = false,
  uploadError,
  model,
  onUpload,
}: TranslationUploadProps) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [validationError, setValidationError] = useState<string | null>(null)

  const validateAndSetFile = useCallback((file: File) => {
    const name = file.name.toLowerCase()
    if (!name.endsWith('.pptx') && !name.endsWith('.ppt')) {
      setValidationError(
        'Please select a valid PowerPoint file (.pptx or .ppt)',
      )
      return
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      setValidationError('File size must be less than 50MB')
      return
    }
    setValidationError(null)
    setSelectedFile(file)
  }, [])

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setIsDragging(false)
      setValidationError(null)
      const file = e.dataTransfer.files[0]
      if (file) validateAndSetFile(file)
    },
    [validateAndSetFile],
  )

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setValidationError(null)
      const file = e.target.files?.[0]
      if (file) validateAndSetFile(file)
    },
    [validateAndSetFile],
  )

  const clearFile = useCallback(() => {
    setSelectedFile(null)
    setValidationError(null)
  }, [])

  const handleSubmit = () => {
    if (selectedFile) onUpload(selectedFile)
  }

  const displayError = validationError ?? uploadError

  return (
    <Card>
      <CardHeader>
        <CardTitle>Upload Presentation</CardTitle>
        <CardDescription>
          Upload a PowerPoint file (.pptx or .ppt) to translate
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!selectedFile ? (
          <div
            data-testid="file-upload-area"
            onDragEnter={handleDragEnter}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={cn(
              'relative cursor-pointer rounded-lg border-2 border-dashed p-12 text-center transition-all duration-200',
              isDragging && 'border-primary bg-primary/5',
              !isDragging &&
                'border-muted-foreground/25 hover:border-primary/50 hover:bg-muted/50',
              (disabled || isUploading) && 'pointer-events-none opacity-50',
            )}
          >
            <input
              data-testid="file-input"
              type="file"
              accept=".pptx,.ppt"
              onChange={handleFileInput}
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
              disabled={disabled || isUploading}
            />
            <Upload className="text-muted-foreground mx-auto mb-4 h-16 w-16" />
            <p className="mb-2 text-lg font-medium">
              Drop your PowerPoint file here
            </p>
            <p className="text-muted-foreground text-sm">
              or click to browse (.pptx, .ppt)
            </p>
            <p className="text-muted-foreground mt-2 text-xs">
              Maximum file size: 50MB
            </p>
          </div>
        ) : (
          <div className="flex items-center justify-between rounded-lg border-2 border-green-500 bg-green-50 p-6 dark:bg-green-950/20">
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <FileText className="h-8 w-8 flex-shrink-0 text-green-600 dark:text-green-400" />
              <div className="min-w-0 flex-1">
                <p className="text-foreground truncate font-medium">
                  {selectedFile.name}
                </p>
                <p className="text-muted-foreground text-sm">
                  {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
                </p>
              </div>
            </div>
            {!isUploading && (
              <Button
                variant="ghost"
                size="icon"
                onClick={clearFile}
                className="flex-shrink-0 hover:bg-red-100 dark:hover:bg-red-950"
                title="Remove file"
              >
                <X className="h-5 w-5 text-red-600 dark:text-red-400" />
              </Button>
            )}
          </div>
        )}

        {displayError && (
          <div className="border-destructive/50 bg-destructive/10 text-destructive rounded-lg border p-4">
            <p className="flex items-center gap-2 text-sm font-medium">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              {displayError}
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
