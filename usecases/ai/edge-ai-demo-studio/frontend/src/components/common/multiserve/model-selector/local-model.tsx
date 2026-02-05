// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { Button } from '@/components/ui/button'
import { AlertCircle, CheckCircle2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { CustomFile } from '@/types/dropzone'
import { useUploadLocalModel } from '@/hooks/use-workload'
import { toast } from 'sonner'
import {
  validateLlamaCPPModelName,
  validateOVMSModelName,
} from '@/utils/model-validation'
import { Workload } from '@/payload-types'
import { ModelTypes } from '@/types/workload'
import { ConfirmationDialog } from '../../confirmation-dialog'
import Dropzone from '../../dropzone'

interface LocalModelProps {
  selectedEngine: Workload['engine']
  task: string
  type: ModelTypes
  modelName: string
  onTempFileUpload?: (tempFilePath: string) => void
}

export function LocalModel({
  selectedEngine,
  task,
  type,
  modelName,
  onTempFileUpload,
}: LocalModelProps) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [showCancelDialog, setShowCancelDialog] = useState(false)

  const {
    mutate: uploadModelFile,
    isPending: isUploading,
    isSuccess,
    isError,
    error,
    reset,
    uploadProgress,
    cancel,
  } = useUploadLocalModel()

  const isUploadingRef = useRef(false)

  useEffect(() => {
    isUploadingRef.current = isUploading
  }, [isUploading])

  useEffect(() => {
    return () => {
      if (isUploadingRef.current) {
        setShowCancelDialog(true)
      }
    }
  }, [])

  const validateModelName = (name: string) => {
    if (selectedEngine === 'llamacpp') {
      return validateLlamaCPPModelName(name)
    }

    if (selectedEngine === 'ovms') {
      return validateOVMSModelName(name)
    }

    return true
  }

  const handleUpload = () => {
    if (selectedFile && validateModelName(modelName)) {
      uploadModelFile(
        {
          file: selectedFile,
          engine: selectedEngine,
          type,
          task,
          modelName,
        },
        {
          onSuccess: (data) => {
            if (data) onTempFileUpload?.(data)
          },
          onError: (error) => {
            toast.error(error.message || 'Upload failed')
          },
        },
      )
    }
  }

  const acceptFileType: Record<string, string[]> =
    selectedEngine === 'llamacpp'
      ? { 'application/octet-stream': ['.gguf'] }
      : { 'application/zip': ['.zip'] }

  const handleClearFile = () => {
    setSelectedFile(null)
    reset()
    // setTempFilePath('')
    onTempFileUpload?.('')
  }

  const handleSetFieldValue = (_field: string, value: CustomFile[]) => {
    const files = value
    if (files && files.length > 0) {
      const file = files[files.length - 1]
      setSelectedFile(file)
      reset()
    } else {
      handleClearFile()
    }
  }

  return (
    <>
      <ConfirmationDialog
        isOpen={showCancelDialog}
        onClose={() => {
          // User clicked "No, Continue" - just close dialog
          setShowCancelDialog(false)
        }}
        onConfirm={() => {
          // User clicked "Yes, Cancel Upload" - cancel and close
          cancel()
          setShowCancelDialog(false)
        }}
        title="Cancel Upload?"
        description="An upload is in progress. Are you sure you want to cancel it?"
        confirmText="Yes, Cancel Upload"
        cancelText="No, Continue"
        variant="destructive"
        preventDismiss={true}
      />
      <div className="space-y-4">
        <div>
          <Label htmlFor="local-file-upload" className="text-base font-medium">
            Model File
          </Label>
          <div className="mt-2">
            <Dropzone
              files={selectedFile ? [selectedFile] : []}
              setFieldValue={handleSetFieldValue}
              acceptFileType={acceptFileType}
              isMultiple={false}
              isUploading={isUploading}
              onUpload={handleUpload}
              disabled={!validateModelName(modelName)}
            />
          </div>
        </div>

        {isUploading && (
          <div className="space-y-1">
            <div className="flex justify-between text-sm text-gray-500">
              <span>Uploading...</span>
              <span>{uploadProgress}%</span>
            </div>
            <Progress value={uploadProgress} className="h-2 w-full" />
            <Button
              variant="destructive"
              size="sm"
              className="mt-2 w-full"
              onClick={() => cancel()}
            >
              Cancel Upload
            </Button>
          </div>
        )}

        {isSuccess && (
          <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 p-3 text-green-800">
            <CheckCircle2 className="h-5 w-5" />
            <span className="text-sm font-medium">
              File uploaded. Please select the model to use it.
            </span>
          </div>
        )}

        {isError && (
          <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-red-800">
            <AlertCircle className="h-5 w-5" />
            <span className="text-sm">
              {error instanceof Error ? error.message : 'Upload failed'}
            </span>
          </div>
        )}
      </div>
    </>
  )
}
