// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { FileText, Trash2, Search, Database, Plus, Loader2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { CustomFile } from '@/types/dropzone'
import {
  useCreateKnowledgeBase,
  useCreateKnowledgeBaseEmbeddings,
  useDeleteKnowledgeBase,
  useDeleteKnowledgeBaseFile,
  useGetKnowledgeBaseFiles,
  useGetKnowledgeBases,
  useSearchKnowledgeBase,
  useUploadKnowledgeBaseFile,
} from '@/hooks/use-embedding'
import Dropzone from '@/components/common/dropzone'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { KnowledgeBase, KnowledgeBaseFile } from '@/types/embedding'

interface EmbeddingDemoProps {
  disabled: boolean
  model?: string
}

export default function EmbeddingDemo({ disabled }: EmbeddingDemoProps) {
  const { data: knowledgeBases, refetch: refetchKbs } = useGetKnowledgeBases({
    disabled,
  })

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <KnowledgeBaseManagement
        disabled={disabled}
        knowledgeBases={knowledgeBases ?? []}
        refetch={refetchKbs}
      />
      <KnowledgeBaseDocuments
        disabled={disabled}
        knowledgeBases={knowledgeBases ?? []}
      />
      <KnowledgeBaseSearch
        disabled={disabled}
        knowledgeBases={knowledgeBases ?? []}
      />
    </div>
  )
}

function KnowledgeBaseSearch({
  disabled,
  knowledgeBases,
}: {
  disabled: boolean
  knowledgeBases: KnowledgeBase[]
}) {
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<Record<string, unknown>[]>(
    [],
  )
  const [selectedKbId, setSelectedKbId] = useState<number | null>(null)

  const searchKnowledgeBase = useSearchKnowledgeBase()

  const handleSearch = () => {
    if (!searchQuery.trim()) {
      toast.error('Please enter a search query')
      return
    }

    if (!selectedKbId) {
      toast.error('Please select a knowledge base to search')
      return
    }

    searchKnowledgeBase.mutate(
      {
        kbId: selectedKbId,
        query: searchQuery,
      },
      {
        onSuccess: (response) => {
          if (response) {
            setSearchResults(response)
            toast.success('Search completed successfully!')
          } else {
            toast.error('Search failed. Please try again.')
          }
        },
        onError: (error) => {
          console.error('Error searching knowledge base:', error)
          toast.error('Failed to search knowledge base.')
        },
      },
    )
  }

  useEffect(() => {
    // if selectedKbId is no longer in knowledgeBases, reset it
    if (
      selectedKbId &&
      !knowledgeBases.find((kb: KnowledgeBase) => kb.id === selectedKbId)
    ) {
      setSelectedKbId(null)
      setSearchResults([])
      setSearchQuery('')
    }
  }, [knowledgeBases, selectedKbId])

  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Search className="h-5 w-5" />
          Knowledge Base Search
        </CardTitle>
        <CardDescription>
          Search through your knowledge bases using semantic similarity
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="space-y-2 lg:col-span-1">
            <Label htmlFor="kb-select">Knowledge Base</Label>
            <Select
              value={selectedKbId?.toString() || ''}
              onValueChange={(value) => setSelectedKbId(parseInt(value))}
              disabled={disabled}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select a knowledge base" />
              </SelectTrigger>
              <SelectContent>
                {knowledgeBases.map((kb: KnowledgeBase) => (
                  <SelectItem key={kb.id} value={kb.id?.toString() || ''}>
                    {kb.name}
                  </SelectItem>
                ))}

                {knowledgeBases.length === 0 && (
                  <div className="p-4 text-sm text-slate-500">
                    No knowledge bases available, please create one first.
                  </div>
                )}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2 lg:col-span-2">
            <Label htmlFor="search-query">Search Query</Label>
            <Input
              id="search-query"
              placeholder="Enter your search query..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              disabled={disabled}
            />
          </div>
        </div>

        <Button
          onClick={handleSearch}
          disabled={
            disabled ||
            searchKnowledgeBase.isPending ||
            !searchQuery.trim() ||
            !selectedKbId
          }
          className="w-full"
        >
          {searchKnowledgeBase.isPending
            ? 'Searching...'
            : 'Search Knowledge Base'}
        </Button>

        {searchResults.length > 0 && (
          <div className="space-y-2">
            <Label>Search Results</Label>
            <div className="max-h-60 space-y-2 overflow-y-auto">
              {searchResults.map((result, index) => (
                <div key={index} className="rounded border p-3 text-sm">
                  <div className="mb-1 font-medium text-slate-700">
                    Result {index + 1}
                  </div>
                  <div className="text-slate-600">
                    {(result.content as string) ||
                      (result.text as string) ||
                      'No content available'}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function KnowledgeBaseManagement({
  disabled,
  knowledgeBases,
  refetch,
}: {
  disabled?: boolean
  knowledgeBases: KnowledgeBase[]
  refetch: () => void
}) {
  const [kbName, setKbName] = useState('')
  const createKnowledgeBase = useCreateKnowledgeBase()
  const deleteKnowledgeBase = useDeleteKnowledgeBase()
  const [deletingKbId, setDeletingKbId] = useState<number | null>(null)

  const handleCreateKB = () => {
    if (!kbName.trim()) {
      toast.error('Please enter a knowledge base name')
      return
    }

    createKnowledgeBase.mutate(
      { name: kbName },
      {
        onSuccess: () => {
          toast.success('Knowledge base created successfully!')
          setKbName('')
          refetch()
        },
        onError: (error) => {
          console.error('Error creating knowledge base:', error)
          toast.error('Failed to create knowledge base.')
        },
      },
    )
  }

  const handleDeleteKB = (kbId: number, kbName: string) => {
    setDeletingKbId(kbId)
    deleteKnowledgeBase.mutate(
      { id: kbId },
      {
        onSuccess: () => {
          toast.success(`Knowledge base "${kbName}" deleted successfully.`)
          refetch()
        },
        onError: () => {
          toast.error(`Failed to delete knowledge base "${kbName}".`)
        },
        onSettled: () => {
          setDeletingKbId(null)
        },
      },
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Database className="h-5 w-5" />
          Knowledge Base Management
        </CardTitle>
        <CardDescription>
          Create and manage your knowledge bases
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2">
          <Input
            placeholder="Enter knowledge base name..."
            value={kbName}
            onChange={(e) => setKbName(e.target.value)}
            disabled={disabled}
            onKeyDown={(e) => e.key === 'Enter' && handleCreateKB()}
          />
          <Button
            onClick={handleCreateKB}
            disabled={
              disabled || createKnowledgeBase.isPending || !kbName.trim()
            }
          >
            {createKnowledgeBase.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
          </Button>
        </div>

        {knowledgeBases.length > 0 ? (
          <div className="space-y-2">
            <div className="text-sm text-slate-600">
              {knowledgeBases.length} knowledge base(s)
            </div>
            {knowledgeBases.map((kb: KnowledgeBase) => (
              <div
                key={kb.id}
                className="flex items-center justify-between rounded-lg border p-3"
              >
                <div className="flex-1">
                  <div className="font-medium">{kb.name}</div>
                  <div className="text-sm text-slate-500">ID: {kb.id}</div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-red-500 hover:text-red-700"
                  onClick={() => kb.id && handleDeleteKB(kb.id, kb.name)}
                  disabled={deletingKbId === kb.id}
                >
                  {deletingKbId === kb.id ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4" />
                  )}
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <div className="py-8 text-center text-slate-500">
            No knowledge bases created yet. <br />
            Create one to get started!
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function KnowledgeBaseDocuments({
  disabled,
  knowledgeBases,
}: {
  disabled?: boolean
  knowledgeBases: KnowledgeBase[]
}) {
  const [selectedKbId, setSelectedKbId] = useState<number | null>(null)
  const [selectedFiles, setSelectedFiles] = useState<CustomFile[]>([])
  const [isUploading, setIsUploading] = useState(false)
  const [deletingFileName, setDeletingFileName] = useState<string | null>(null)

  const { data: existingFiles, refetch: refetchFiles } =
    useGetKnowledgeBaseFiles(selectedKbId || 0)
  const uploadFile = useUploadKnowledgeBaseFile()
  const createEmbeddings = useCreateKnowledgeBaseEmbeddings()
  const deleteFile = useDeleteKnowledgeBaseFile()

  const resetState = useCallback(() => {
    setIsUploading(false)
    setSelectedFiles([])
  }, [])

  const setFieldValue = (field: string, value: CustomFile[]) => {
    setSelectedFiles(value)
  }

  const handleDeleteFile = (fileName: string) => {
    if (!selectedKbId) return

    setDeletingFileName(fileName)
    deleteFile.mutate(
      { kbId: selectedKbId, fileName },
      {
        onSuccess: () => {
          toast.success(`File "${fileName}" deleted successfully.`)
          refetchFiles()
        },
        onError: (error) => {
          console.error('Error deleting file:', error)
          toast.error(`Failed to delete file "${fileName}".`)
        },
        onSettled: () => {
          setDeletingFileName(null)
        },
      },
    )
  }

  const handleUpload = () => {
    if (!selectedKbId) {
      toast.error('Please select a knowledge base')
      return
    }

    if (selectedFiles.length === 0) {
      toast.error('Please select files to upload')
      return
    }

    setIsUploading(true)
    const uploadPromises = selectedFiles.map((file) =>
      uploadFile.mutateAsync({ kbId: selectedKbId, file }),
    )

    Promise.all(uploadPromises)
      .then(() => {
        toast.success('Files uploaded successfully!')
        refetchFiles() // Refresh the files list
        // Now create embeddings
        return createEmbeddings.mutateAsync({ kbId: selectedKbId })
      })
      .then((response) => {
        if (response) {
          toast.success('Embeddings created successfully!')
        } else {
          toast.error('Failed to create embeddings.')
        }
      })
      .catch((error) => {
        console.error('Error in upload/embedding process:', error)
        toast.error('Failed to upload files or create embeddings.')
      })
      .finally(() => {
        resetState()
      })
  }

  useEffect(() => {
    // if selectedKbId is no longer in knowledgeBases, reset it
    if (
      selectedKbId &&
      !knowledgeBases.find((kb: KnowledgeBase) => kb.id === selectedKbId)
    ) {
      setSelectedKbId(null)
      resetState()
      refetchFiles()
    }
  }, [knowledgeBases, refetchFiles, resetState, selectedKbId])

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileText className="h-5 w-5" />
          Knowledge Base Documents
        </CardTitle>
        <CardDescription>
          Upload documents to your knowledge bases and create embeddings
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="kb-select-upload">Knowledge Base</Label>
          <Select
            value={selectedKbId?.toString() || ''}
            onValueChange={(value) => setSelectedKbId(parseInt(value))}
            disabled={disabled}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select a knowledge base" />
            </SelectTrigger>
            <SelectContent>
              {knowledgeBases.map((kb: KnowledgeBase) => (
                <SelectItem key={kb.id} value={kb.id?.toString() || ''}>
                  {kb.name}
                </SelectItem>
              ))}

              {knowledgeBases.length === 0 && (
                <div className="p-4 text-sm text-slate-500">
                  No knowledge bases available, please create one first.
                </div>
              )}
            </SelectContent>
          </Select>
        </div>

        {/* Existing Files Display */}
        {selectedKbId && existingFiles && (
          <>
            <div className="space-y-2">
              <Label>Existing Files ({existingFiles.length})</Label>
              {existingFiles.length > 0 ? (
                <div className="max-h-40 space-y-1 overflow-y-auto rounded border p-2">
                  {existingFiles.map(
                    (file: KnowledgeBaseFile, index: number) => (
                      <div
                        key={index}
                        className="flex items-center justify-between rounded px-2 py-1 hover:bg-slate-50"
                      >
                        <div className="flex items-center gap-2">
                          <FileText className="h-4 w-4 text-slate-500" />
                          <span className="text-sm">{file.name}</span>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0 text-red-500 hover:text-red-700"
                          onClick={() => handleDeleteFile(file.name)}
                          disabled={deletingFileName === file.name || disabled}
                        >
                          {deletingFileName === file.name ? (
                            <Loader2 className="size-4 animate-spin" />
                          ) : (
                            <Trash2 className="h-3 w-3" />
                          )}
                        </Button>
                      </div>
                    ),
                  )}
                </div>
              ) : (
                <div className="rounded border p-4 text-center text-sm text-slate-500">
                  No files uploaded yet
                </div>
              )}
            </div>

            <Dropzone
              files={selectedFiles}
              acceptFileType={{ 'application/pdf': ['.pdf'] }}
              setFieldValue={setFieldValue}
              onUpload={handleUpload}
              isUploading={isUploading}
              error={false}
            />
          </>
        )}

        {!selectedKbId && (
          <div className="py-4 text-center text-sm text-slate-500">
            Please select a knowledge base to upload documents
          </div>
        )}
      </CardContent>
    </Card>
  )
}
