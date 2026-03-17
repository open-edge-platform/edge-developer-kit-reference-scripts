// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { Textarea } from '@/components/ui/textarea'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { useCompletion } from '@ai-sdk/react'
import {
  AlertCircleIcon,
  ChevronDown,
  Info,
  Play,
  ToolCase,
  Zap,
} from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { toast } from 'sonner'
import {
  getInactivePrerequisites,
  getPreparingPrerequisites,
  startPrerequisites,
} from '@/utils/prerequisite-utils'
import {
  useCreateWorkload,
  useGetWorkloadsStatus,
  useUpdateWorkload,
} from '@/hooks/use-workload'
import { McpServerInfo } from '@/types/mcp-manager'
import { MCP_VERIFIED_MODELS } from '@/lib/workloads/mcp'
import { TEXT_GENERATION_TYPE } from '@/lib/workloads/text-generation'

interface MCPTextGenerationDemoProps {
  disabled?: boolean
  selectedModel: string
  servers: McpServerInfo[]
  llmWorkloadIsLoading?: boolean
}

export default function MCPTextGenerationDemo({
  disabled,
  selectedModel,
  servers,
  llmWorkloadIsLoading,
}: MCPTextGenerationDemoProps) {
  const [prompt, setPrompt] = useState('')
  const { isLoading, completion, complete } = useCompletion({
    api: '/api/mcp/completions',
    body: {
      stream: true,
    },
  })

  const createWorkload = useCreateWorkload()
  const updateWorkload = useUpdateWorkload()

  const { data: workloads } = useGetWorkloadsStatus()

  const inactivePrerequisites = useMemo(
    () => getInactivePrerequisites([TEXT_GENERATION_TYPE], workloads),
    [workloads],
  )

  const preparingPrerequisites = useMemo(
    () => getPreparingPrerequisites([TEXT_GENERATION_TYPE], workloads),
    [workloads],
  )

  const preparePrerequisite = useCallback(() => {
    startPrerequisites(
      [TEXT_GENERATION_TYPE],
      workloads,
      createWorkload,
      updateWorkload,
    )
  }, [createWorkload, updateWorkload, workloads])

  // Check if the selected model is a validated model
  const isValidatedModel = MCP_VERIFIED_MODELS.some((model) =>
    selectedModel.includes(model),
  )

  const handleGenerate = async () => {
    if (!prompt.trim()) {
      toast.error('Error', {
        description: 'Please enter a prompt',
      })
      return
    }

    const tools = Object.values(servers).flatMap((server) =>
      server.tools.map((tool) => tool.name),
    )

    await complete(prompt, { body: { model: selectedModel, tools } })
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      {/* Main MCP Manager Card */}
      <div className="lg:col-span-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Play className="h-5 w-5" />
              Interactive Text Generation with MCP
            </CardTitle>
            <CardDescription>
              Try out text generation using connected MCP servers and their
              tools.
              <div className="mt-2">
                {!llmWorkloadIsLoading &&
                  inactivePrerequisites &&
                  inactivePrerequisites.length > 0 && (
                    <div>
                      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-900/20">
                        <div className="flex items-center justify-between">
                          <div>
                            <h3 className="font-semibold text-amber-800 dark:text-amber-200">
                              Prerequisites Required
                            </h3>
                            <p className="text-sm text-amber-700 dark:text-amber-300">
                              The following service(s) need to be started:{' '}
                              {inactivePrerequisites.join(', ')}
                            </p>
                          </div>
                          <Button
                            onClick={preparePrerequisite}
                            className="bg-blue-600 text-white hover:bg-blue-700"
                            disabled={
                              createWorkload.isPending ||
                              updateWorkload.isPending ||
                              (preparingPrerequisites &&
                                preparingPrerequisites.length > 0)
                            }
                          >
                            <Play className="mr-2 h-4 w-4" />
                            {createWorkload.isPending ||
                            updateWorkload.isPending
                              ? 'Starting...'
                              : 'Start Service(s)'}
                          </Button>
                        </div>
                      </div>
                    </div>
                  )}
                {!llmWorkloadIsLoading &&
                  preparingPrerequisites &&
                  preparingPrerequisites.length > 0 && (
                    <Alert
                      variant="default"
                      className="border-blue-200 bg-blue-50"
                    >
                      <AlertCircleIcon className="stroke-blue-600" />
                      <AlertTitle className="text-blue-800">
                        Prerequisites Starting
                      </AlertTitle>
                      <AlertDescription className="text-blue-700">
                        <p>
                          The following prerequisite services are currently
                          starting:{' '}
                          <strong>{preparingPrerequisites.join(', ')}</strong>
                        </p>
                      </AlertDescription>
                    </Alert>
                  )}
              </div>
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!isValidatedModel && (
              <Alert
                variant="default"
                className="border-orange-200 bg-orange-50"
              >
                <AlertCircleIcon className="stroke-orange-800" />
                <AlertTitle className="text-orange-800">
                  Custom LLM Detected
                </AlertTitle>
                <AlertDescription className="text-sm text-orange-700">
                  You are using a custom LLM ({selectedModel}) that is not in
                  the validated models list. MCP tool calling may not work as
                  expected. For best results, use one of the validated models.
                </AlertDescription>
              </Alert>
            )}

            <div>
              <label
                htmlFor="text-prompt"
                className="mb-2 block text-sm font-medium"
              >
                Enter your prompt:
              </label>
              <Textarea
                disabled={disabled || isLoading}
                id="text-prompt"
                placeholder="Type your prompt here..."
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                className="min-h-[100px]"
              />
            </div>

            <Button
              onClick={handleGenerate}
              disabled={disabled || isLoading}
              className="w-full"
            >
              {isLoading ? (
                <>
                  <div className="mr-2 h-4 w-4 animate-spin rounded-full border-b-2 border-white" />
                  Generating...
                </>
              ) : (
                <>
                  <Zap className="mr-2 h-4 w-4" />
                  Generate Text
                </>
              )}
            </Button>

            {completion && (
              <div className="mt-4">
                <div className="mb-2 flex items-center justify-between">
                  <label
                    htmlFor="generated-text"
                    className="text-sm font-medium"
                  >
                    Generated Text:
                  </label>
                </div>
                <div className="rounded-lg border bg-slate-50 p-4">
                  <Markdown remarkPlugins={[remarkGfm]}>{completion}</Markdown>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* MCP Manager - Server & Tools Card */}
      <div className="lg:col-span-1">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ToolCase className="h-5 w-5" />
              Servers & Tools
            </CardTitle>
            <CardDescription>
              Enabled MCP Servers and their available tools
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {servers === null ||
              (servers.length === 0 && (
                <p className="text-sm text-slate-500 italic">
                  No MCP servers enabled and connected. Make sure to add in the
                  MCP Servers List and connect.
                </p>
              ))}

            {/* Show list of tools grouped by servers */}
            {servers.map((server) => {
              const serverUrl = server.url
              const tools = server.tools

              return (
                <Collapsible key={server.name} className="mb-4">
                  <CollapsibleTrigger className="group flex w-full items-center gap-2 rounded-md p-2 transition-colors hover:bg-slate-50">
                    <ChevronDown className="h-4 w-4 text-slate-500 transition-transform group-data-[state=closed]:rotate-[-90deg]" />
                    <span className="font-semibold text-slate-900">
                      {server.name}
                    </span>
                    <Badge
                      className={`text-xs ${server.isConnected ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}
                    >
                      {server.isConnected ? 'Online' : 'Offline'}
                    </Badge>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Info className="h-4 w-4 text-slate-500 transition-colors hover:text-slate-700" />
                      </TooltipTrigger>
                      <TooltipContent>
                        <p className="text-sm">{serverUrl}</p>
                      </TooltipContent>
                    </Tooltip>
                    <div className="ml-auto text-xs text-slate-500">
                      {tools.length} tool
                      {tools.length !== 1 ? 's' : ''}
                    </div>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="mt-2 pl-6">
                    {!server.isConnected ? (
                      <p className="text-sm text-slate-500 italic">
                        Server is not connected
                      </p>
                    ) : (
                      <>
                        <div className="flex flex-wrap gap-2">
                          {tools.map((tool) => {
                            const toolDescription =
                              tool.description || 'No description available'

                            return (
                              <Tooltip key={tool.name}>
                                <TooltipTrigger asChild>
                                  <Badge
                                    variant="secondary"
                                    className="hover:bg-secondary/80 transition-colors"
                                  >
                                    {tool.name}
                                  </Badge>
                                </TooltipTrigger>
                                <TooltipContent>
                                  <div className="text-sm whitespace-pre-line">
                                    {toolDescription}
                                  </div>
                                </TooltipContent>
                              </Tooltip>
                            )
                          })}
                        </div>
                        {tools.length === 0 && (
                          <p className="text-sm text-slate-500 italic">
                            No tools available
                          </p>
                        )}
                      </>
                    )}
                  </CollapsibleContent>
                </Collapsible>
              )
            })}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
