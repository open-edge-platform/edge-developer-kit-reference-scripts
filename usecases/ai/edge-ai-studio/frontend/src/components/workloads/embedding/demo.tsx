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
import {
  FileText,
  Trash2,
  Search,
  Database,
  Plus,
  Loader2,
  Settings,
  Eye,
  PlusCircle,
  ChevronRight,
  Upload,
  Brain,
  MessageSquare,
} from 'lucide-react'
import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import { useQueryClient } from '@tanstack/react-query'
import type { CustomFile } from '@/types/dropzone'
import {
  useCreateKnowledgeBase,
  useCreateKnowledgeBaseEmbeddings,
  useCreateKnowledgeBaseEmbeddingsAdvanced,
  useDeleteKnowledgeBase,
  useDeleteKnowledgeBaseFile,
  useGetKnowledgeBaseFiles,
  useGetKnowledgeBases,
  useSearchKnowledgeBase,
  useUploadKnowledgeBaseFile,
  useGetKnowledgeBaseChunks,
  useAddChunkToKnowledgeBase,
  useDeleteChunksFromKnowledgeBase,
} from '@/hooks/use-embedding'
import Dropzone from '@/components/common/dropzone'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import type {
  KnowledgeBase,
  KnowledgeBaseFile,
  ChunkResult,
} from '@/types/embedding'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

interface EmbeddingDemoProps {
  disabled: boolean
  model?: string
}

export default function EmbeddingDemo({ disabled }: EmbeddingDemoProps) {
  const { data: knowledgeBases, refetch: refetchKbs } = useGetKnowledgeBases({
    disabled,
  })
  const [selectedKbId, setSelectedKbId] = useState<number | null>(null)

  // Find selected knowledge base
  const selectedKb = knowledgeBases?.find((kb) => kb.id === selectedKbId)

  return (
    <div className="space-y-6">
      {/* Header with workflow steps */}
      <div className="space-y-4 text-center">
        <h1 className="text-3xl font-bold text-balance">
          Knowledge Base Management
        </h1>
        <p className="text-muted-foreground mx-auto max-w-2xl text-pretty">
          Create knowledge bases, upload documents, and search through your
          content using AI embeddings
        </p>

        {/* Workflow Steps */}
        <div className="text-muted-foreground flex items-center justify-center gap-2 text-sm">
          <div className="flex items-center gap-1">
            <Database className="h-4 w-4" />
            <span>Create KB</span>
          </div>
          <ChevronRight className="h-4 w-4" />
          <div className="flex items-center gap-1">
            <Upload className="h-4 w-4" />
            <span>Upload Docs</span>
          </div>
          <ChevronRight className="h-4 w-4" />
          <div className="flex items-center gap-1">
            <Brain className="h-4 w-4" />
            <span>Generate Embeddings</span>
          </div>
          <ChevronRight className="h-4 w-4" />
          <div className="flex items-center gap-1">
            <Search className="h-4 w-4" />
            <span>Search & Manage</span>
          </div>
        </div>
      </div>

      {/* Step 1: Knowledge Base Selection/Creation */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="h-5 w-5" />
            Step 1: Select or Create Knowledge Base
          </CardTitle>
          <CardDescription>
            Choose an existing knowledge base or create a new one to get started
          </CardDescription>
        </CardHeader>
        <CardContent>
          <KnowledgeBaseSelector
            disabled={disabled}
            knowledgeBases={knowledgeBases ?? []}
            selectedKbId={selectedKbId}
            onSelectKb={setSelectedKbId}
            refetch={refetchKbs}
          />
        </CardContent>
      </Card>

      {/* Step 2: Document Management (only show if KB selected) */}
      {selectedKb && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Step 2: Manage Documents
              <Badge variant="secondary">{selectedKb.name}</Badge>
            </CardTitle>
            <CardDescription>
              Upload documents and create embeddings for your knowledge base
            </CardDescription>
          </CardHeader>
          <CardContent>
            <DocumentManager disabled={disabled} selectedKbId={selectedKbId!} />
          </CardContent>
        </Card>
      )}

      {/* Step 3: Search and Manage (only show if KB selected) */}
      {selectedKb && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MessageSquare className="h-5 w-5" />
              Step 3: Search and Manage Content
              <Badge variant="secondary">{selectedKb.name}</Badge>
            </CardTitle>
            <CardDescription>
              Search through your knowledge base and manage individual chunks
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="search" className="w-full">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="search" className="flex items-center gap-2">
                  <Search className="h-4 w-4" />
                  Search
                </TabsTrigger>
                <TabsTrigger value="chunks" className="flex items-center gap-2">
                  <Eye className="h-4 w-4" />
                  Manage Chunks
                </TabsTrigger>
              </TabsList>
              <TabsContent value="search" className="mt-6">
                <SearchInterface
                  disabled={disabled}
                  selectedKbId={selectedKbId!}
                />
              </TabsContent>
              <TabsContent value="chunks" className="mt-6">
                <ChunkManager
                  disabled={disabled}
                  selectedKbId={selectedKbId!}
                />
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      )}

      {/* Getting Started Message (only show if no KB selected) */}
      {!selectedKb && knowledgeBases && knowledgeBases.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="py-6">
            <div className="space-y-4 text-center">
              <div className="bg-muted mx-auto flex h-12 w-12 items-center justify-center rounded-full">
                <Database className="text-muted-foreground h-6 w-6" />
              </div>
              <div>
                <h3 className="font-semibold">Get Started</h3>
                <p className="text-muted-foreground text-sm">
                  Create your first knowledge base to begin uploading documents
                  and searching content
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function KnowledgeBaseSelector({
  disabled,
  knowledgeBases,
  selectedKbId,
  onSelectKb,
  refetch,
}: {
  disabled?: boolean
  knowledgeBases: KnowledgeBase[]
  selectedKbId: number | null
  onSelectKb: (id: number | null) => void
  refetch: () => void
}) {
  const [kbName, setKbName] = useState('')
  const [showCreateForm, setShowCreateForm] = useState(false)
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
        onSuccess: (response) => {
          toast.success('Knowledge base created successfully!')
          setKbName('')
          setShowCreateForm(false)
          refetch()
          // Auto-select the new KB
          if (response?.id) {
            onSelectKb(response.id)
          }
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
          if (selectedKbId === kbId) {
            onSelectKb(null)
          }
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
    <div className="space-y-4">
      {/* Knowledge Base Selection */}
      {knowledgeBases.length > 0 && (
        <div className="space-y-2">
          <Label>Select Knowledge Base</Label>
          <Select
            value={selectedKbId?.toString() || ''}
            onValueChange={(value) =>
              onSelectKb(value ? Number.parseInt(value) : null)
            }
            disabled={disabled}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Choose a knowledge base to work with" />
            </SelectTrigger>
            <SelectContent>
              {knowledgeBases.map((kb: KnowledgeBase) => (
                <SelectItem key={kb.id} value={kb.id?.toString() || ''}>
                  {kb.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Create New Knowledge Base */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>Create New Knowledge Base</Label>
          {!showCreateForm && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowCreateForm(true)}
              disabled={disabled}
            >
              <Plus className="mr-2 h-4 w-4" />
              New
            </Button>
          )}
        </div>

        {showCreateForm && (
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
                'Create'
              )}
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setShowCreateForm(false)
                setKbName('')
              }}
            >
              Cancel
            </Button>
          </div>
        )}
      </div>

      {/* Existing Knowledge Bases List */}
      {knowledgeBases.length > 0 && (
        <Collapsible>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" className="w-full justify-between">
              <span>
                Manage Existing Knowledge Bases ({knowledgeBases.length})
              </span>
              <Settings className="h-4 w-4" />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-2 space-y-2">
            {knowledgeBases.map((kb: KnowledgeBase) => (
              <div
                key={kb.id}
                className="flex items-center justify-between rounded-lg border p-3"
              >
                <div className="flex-1">
                  <div className="font-medium">{kb.name}</div>
                  <div className="text-muted-foreground text-sm">
                    ID: {kb.id}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive"
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
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  )
}

function DocumentManager({
  disabled,
  selectedKbId,
}: {
  disabled?: boolean
  selectedKbId: number
}) {
  const [selectedFiles, setSelectedFiles] = useState<CustomFile[]>([])
  const [isUploading, setIsUploading] = useState(false)
  const [deletingFileName, setDeletingFileName] = useState<string | null>(null)
  const [showEmbeddingConfig, setShowEmbeddingConfig] = useState(false)
  const [splitterName, setSplitterName] = useState('RecursiveCharacter')
  const [chunkSize, setChunkSize] = useState(1000)
  const [chunkOverlap, setChunkOverlap] = useState(200)

  const queryClient = useQueryClient()
  const { data: existingFiles, refetch: refetchFiles } =
    useGetKnowledgeBaseFiles(selectedKbId)
  const uploadFile = useUploadKnowledgeBaseFile()
  const createEmbeddings = useCreateKnowledgeBaseEmbeddings()
  const createEmbeddingsAdvanced = useCreateKnowledgeBaseEmbeddingsAdvanced()
  const deleteFile = useDeleteKnowledgeBaseFile()

  const resetState = useCallback(() => {
    setIsUploading(false)
    setSelectedFiles([])
  }, [])

  const setFieldValue = (field: string, value: CustomFile[]) => {
    setSelectedFiles(value)
  }

  const handleDeleteFile = (fileName: string) => {
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
        refetchFiles()
        // Create embeddings
        if (showEmbeddingConfig) {
          return createEmbeddingsAdvanced.mutateAsync({
            kbId: selectedKbId,
            splitterName,
            chunkSize,
            chunkOverlap,
          })
        } else {
          return createEmbeddings.mutateAsync({ kbId: selectedKbId })
        }
      })
      .then((response) => {
        if (response) {
          toast.success('Embeddings created successfully!')
          queryClient.invalidateQueries({
            queryKey: ['knowledge-base-chunks', selectedKbId],
          })
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

  return (
    <div className="space-y-6">
      {/* Existing Files */}
      {existingFiles && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label>Current Documents</Label>
            <Badge variant="outline">{existingFiles.length} files</Badge>
          </div>

          {existingFiles.length > 0 ? (
            <div className="grid gap-2">
              {existingFiles.map((file: KnowledgeBaseFile, index: number) => (
                <div
                  key={index}
                  className="hover:bg-muted/50 flex items-center justify-between rounded-lg border p-3"
                >
                  <div className="flex items-center gap-3">
                    <FileText className="text-muted-foreground h-4 w-4" />
                    <span className="font-medium">{file.name}</span>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    onClick={() => handleDeleteFile(file.name)}
                    disabled={deletingFileName === file.name || disabled}
                  >
                    {deletingFileName === file.name ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-muted-foreground py-8 text-center">
              <FileText className="mx-auto mb-2 h-8 w-8 opacity-50" />
              <p>No documents uploaded yet</p>
            </div>
          )}
        </div>
      )}

      {/* Upload New Documents */}
      <div className="space-y-4">
        <Label>Upload New Documents</Label>

        {/* Embedding Configuration */}
        <Collapsible
          open={showEmbeddingConfig}
          onOpenChange={setShowEmbeddingConfig}
        >
          <CollapsibleTrigger asChild>
            <Button variant="outline" size="sm">
              <Settings className="mr-2 h-4 w-4" />
              Advanced Embedding Options
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-4">
            <div className="bg-muted/50 grid gap-4 rounded-lg border p-4 lg:grid-cols-3">
              <div className="space-y-2">
                <Label>Text Splitter</Label>
                <Select value={splitterName} onValueChange={setSplitterName}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="RecursiveCharacter">
                      Recursive Character
                    </SelectItem>
                    <SelectItem value="Character">Character</SelectItem>
                    <SelectItem value="Markdown">Markdown</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Chunk Size</Label>
                <Input
                  type="number"
                  value={chunkSize}
                  onChange={(e) =>
                    setChunkSize(Number.parseInt(e.target.value))
                  }
                  min={100}
                  max={5000}
                />
              </div>
              <div className="space-y-2">
                <Label>Chunk Overlap</Label>
                <Input
                  type="number"
                  value={chunkOverlap}
                  onChange={(e) =>
                    setChunkOverlap(Number.parseInt(e.target.value))
                  }
                  min={0}
                  max={chunkSize - 1}
                />
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>

        {/* File Upload */}
        <Dropzone
          files={selectedFiles}
          acceptFileType={{ 'application/pdf': ['.pdf'] }}
          setFieldValue={setFieldValue}
          onUpload={handleUpload}
          isUploading={isUploading}
          error={false}
        />
      </div>
    </div>
  )
}

function SearchInterface({
  disabled,
  selectedKbId,
}: {
  disabled: boolean
  selectedKbId: number
}) {
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<Record<string, unknown>[]>(
    [],
  )
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [searchType, setSearchType] = useState('similarity')
  const [topK, setTopK] = useState(4)
  const [topN, setTopN] = useState(3)
  const [scoreThreshold, setScoreThreshold] = useState<number | undefined>(
    undefined,
  )
  const [fetchK, setFetchK] = useState(20)
  const [lambdaMult, setLambdaMult] = useState(0.5)

  const searchKnowledgeBase = useSearchKnowledgeBase()

  const handleSearch = () => {
    if (!searchQuery.trim()) {
      toast.error('Please enter a search query')
      return
    }

    const searchParams = {
      kbId: selectedKbId,
      query: searchQuery,
      searchType,
      topK,
      topN,
      ...(scoreThreshold !== undefined && { scoreThreshold }),
      ...(searchType === 'mmr' && { fetchK, lambdaMult }),
    }

    searchKnowledgeBase.mutate(searchParams, {
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
    })
  }

  return (
    <div className="space-y-6">
      {/* Search Input */}
      <div className="space-y-2">
        <Label htmlFor="search-query">Search Query</Label>
        <div className="flex gap-2">
          <Input
            id="search-query"
            placeholder="Ask a question or search for specific content..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            disabled={disabled}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          />
          <Button
            onClick={handleSearch}
            disabled={
              disabled || searchKnowledgeBase.isPending || !searchQuery.trim()
            }
          >
            {searchKnowledgeBase.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Search className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>

      {/* Advanced Options */}
      <Collapsible open={showAdvanced} onOpenChange={setShowAdvanced}>
        <CollapsibleTrigger asChild>
          <Button variant="outline" size="sm">
            <Settings className="mr-2 h-4 w-4" />
            Advanced Search Options
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-4">
          <div className="bg-muted/50 grid gap-4 rounded-lg border p-4 lg:grid-cols-2">
            <div className="space-y-2">
              <Label>Search Type</Label>
              <Select value={searchType} onValueChange={setSearchType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="similarity">Similarity</SelectItem>
                  <SelectItem value="mmr">MMR (Diversity)</SelectItem>
                  <SelectItem value="similarity_score_threshold">
                    Score Threshold
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Documents to Retrieve (top_k)</Label>
              <Input
                type="number"
                value={topK}
                onChange={(e) => setTopK(Number.parseInt(e.target.value))}
                min={1}
                max={20}
              />
            </div>
            <div className="space-y-2">
              <Label>Final Results (top_n)</Label>
              <Input
                type="number"
                value={topN}
                onChange={(e) => setTopN(Number.parseInt(e.target.value))}
                min={1}
                max={10}
              />
            </div>
            {searchType === 'similarity_score_threshold' && (
              <div className="space-y-2">
                <Label>Score Threshold</Label>
                <Input
                  type="number"
                  step="0.1"
                  value={scoreThreshold || ''}
                  onChange={(e) =>
                    setScoreThreshold(
                      e.target.value
                        ? Number.parseFloat(e.target.value)
                        : undefined,
                    )
                  }
                  placeholder="0.5"
                />
              </div>
            )}
            {searchType === 'mmr' && (
              <>
                <div className="space-y-2">
                  <Label>Fetch K (MMR)</Label>
                  <Input
                    type="number"
                    value={fetchK}
                    onChange={(e) => setFetchK(Number.parseInt(e.target.value))}
                    min={1}
                    max={50}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Lambda Multiplier (0=diverse, 1=similar)</Label>
                  <Input
                    type="number"
                    step="0.1"
                    value={lambdaMult}
                    onChange={(e) =>
                      setLambdaMult(Number.parseFloat(e.target.value))
                    }
                    min={0}
                    max={1}
                  />
                </div>
              </>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>

      {/* Search Results */}
      {searchResults.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <Label>Search Results</Label>
            <Badge variant="outline">{searchResults.length} results</Badge>
          </div>
          <div className="space-y-3">
            {searchResults.map((result, index) => (
              <Card key={index}>
                <CardContent>
                  <div className="space-y-2">
                    <div className="text-muted-foreground flex items-center gap-2 text-xs">
                      <Badge variant="secondary">Result {index + 1}</Badge>
                    </div>
                    <p className="text-sm leading-relaxed">
                      {(result.content as string) ||
                        (result.text as string) ||
                        'No content available'}
                    </p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {searchQuery &&
        searchResults.length === 0 &&
        !searchKnowledgeBase.isPending && (
          <div className="text-muted-foreground py-8 text-center">
            <Search className="mx-auto mb-2 h-8 w-8 opacity-50" />
            <p>No results found for your search query</p>
          </div>
        )}
    </div>
  )
}

function ChunkManager({
  disabled,
  selectedKbId,
}: {
  disabled: boolean
  selectedKbId: number
}) {
  const [showAddChunk, setShowAddChunk] = useState(false)
  const [newChunkContent, setNewChunkContent] = useState('')
  const [selectedChunks, setSelectedChunks] = useState<string[]>([])

  const {
    data: chunksResponse,
    isLoading,
    error,
    refetch,
  } = useGetKnowledgeBaseChunks(selectedKbId)
  const addChunk = useAddChunkToKnowledgeBase()
  const deleteChunks = useDeleteChunksFromKnowledgeBase()

  const chunks = chunksResponse?.chunks || []

  const handleAddChunk = () => {
    if (!newChunkContent.trim()) {
      toast.error('Please enter content for the chunk')
      return
    }

    addChunk.mutate(
      {
        kbId: selectedKbId,
        content: newChunkContent,
        metadata: { source: 'manual_entry' },
      },
      {
        onSuccess: () => {
          toast.success('Chunk added successfully')
          setNewChunkContent('')
          setShowAddChunk(false)
          refetch()
        },
        onError: (error) => {
          console.error('Error adding chunk:', error)
          toast.error('Failed to add chunk')
        },
      },
    )
  }

  const handleDeleteSelectedChunks = () => {
    if (selectedChunks.length === 0) {
      toast.error('Please select chunks to delete')
      return
    }

    deleteChunks.mutate(
      { kbId: selectedKbId, docIds: selectedChunks },
      {
        onSuccess: (response) => {
          if (response?.success) {
            toast.success(
              `Deleted ${response.deletion_info?.deleted_count} chunks`,
            )
            setSelectedChunks([])
            refetch()
          } else {
            toast.error('Failed to delete chunks')
          }
        },
        onError: (error) => {
          console.error('Error deleting chunks:', error)
          toast.error('Failed to delete chunks')
        },
      },
    )
  }

  const toggleChunkSelection = (docId: string) => {
    setSelectedChunks((prev) =>
      prev.includes(docId)
        ? prev.filter((id) => id !== docId)
        : [...prev, docId],
    )
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin" />
        <span className="ml-2">Loading chunks...</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="text-destructive py-8 text-center">
        Error loading chunks: {error.message}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header Actions */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Label>Content Chunks</Label>
          <Badge variant="outline">{chunks.length} chunks</Badge>
        </div>
        <div className="flex items-center gap-2">
          {selectedChunks.length > 0 && (
            <Button
              variant="destructive"
              size="sm"
              onClick={handleDeleteSelectedChunks}
              disabled={disabled || deleteChunks.isPending}
            >
              {deleteChunks.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="mr-2 h-4 w-4" />
              )}
              Delete Selected ({selectedChunks.length})
            </Button>
          )}
          <Button
            variant="outline"
            onClick={() => setShowAddChunk(!showAddChunk)}
            disabled={disabled}
          >
            <PlusCircle className="mr-2 h-4 w-4" />
            Add Chunk
          </Button>
        </div>
      </div>

      {/* Add Chunk Form */}
      {showAddChunk && (
        <Card>
          <CardContent>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="new-chunk-content">Chunk Content</Label>
                <Textarea
                  id="new-chunk-content"
                  placeholder="Enter the text content for the new chunk..."
                  value={newChunkContent}
                  onChange={(e) => setNewChunkContent(e.target.value)}
                  rows={4}
                  disabled={disabled}
                />
              </div>
              <div className="flex gap-2">
                <Button
                  onClick={handleAddChunk}
                  disabled={
                    disabled || addChunk.isPending || !newChunkContent.trim()
                  }
                >
                  {addChunk.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Plus className="mr-2 h-4 w-4" />
                  )}
                  Add Chunk
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setShowAddChunk(false)}
                >
                  Cancel
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Chunks List */}
      {chunks.length > 0 ? (
        <div className="space-y-3">
          {chunks.map((chunk: ChunkResult, index: number) => (
            <Card key={chunk.doc_id || index}>
              <CardContent>
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={selectedChunks.includes(chunk.doc_id)}
                    onChange={() => toggleChunkSelection(chunk.doc_id)}
                    className="mt-1 rounded"
                  />
                  <div className="flex-1 space-y-2">
                    <div className="text-muted-foreground flex items-center gap-2 text-xs">
                      <Badge variant="secondary" className="text-xs">
                        Chunk {chunk.chunk_id}
                      </Badge>
                      {chunk.metadata?.source && (
                        <span>Source: {chunk.metadata.source}</span>
                      )}
                    </div>
                    <p className="text-sm leading-relaxed">{chunk.content}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className="text-muted-foreground py-8 text-center">
          <Eye className="mx-auto mb-2 h-8 w-8 opacity-50" />
          <p>No chunks found</p>
          <p className="text-sm">
            Upload documents and create embeddings first
          </p>
        </div>
      )}
    </div>
  )
}
