// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import McpManagerService from '@/components/workloads/mcp-manager/mcp-manager-service'
import { useGetWorkloadByType } from '@/hooks/use-workload'
import {
  TEXT_GENERATION_TYPE,
  TEXT_GENERATION_WORKLOAD,
} from '@/lib/workloads/text-generation'
import { useMcpServerInfo } from '@/hooks/use-mcp-clients'
import MCPTextGenerationDemo from '@/components/workloads/mcp-manager/demo'
import McpServersTab from '@/components/workloads/mcp-manager/mcp-servers-tab'
import { DocumentationTemplate } from '@/components/workloads/documentation'
import McpManagerDocumentation from '@/components/workloads/mcp-manager/documentation'
import Endpoint from '@/components/workloads/endpoint'
import { mcpManagerEndpoints } from '@/components/workloads/mcp-manager/api'
import { useEffect, useMemo } from 'react'
import { DocumentationProps } from '@/types/workload'
import { getBaseURL, getModelNameWithPrefix } from '@/utils/common'

export default function McpManagerPage() {
  const { data: llmWorkload, isLoading: llmWorkloadIsLoading } =
    useGetWorkloadByType(TEXT_GENERATION_TYPE)
  const url = getBaseURL()

  const workloadModel = useMemo(() => {
    return (
      llmWorkload?.models?.default || TEXT_GENERATION_WORKLOAD.models.default
    )
  }, [llmWorkload?.models])

  const modelName = useMemo(() => {
    return getModelNameWithPrefix(
      llmWorkload?.engine || TEXT_GENERATION_WORKLOAD.engine,
      workloadModel,
    )
  }, [workloadModel, llmWorkload?.engine])

  const {
    isInitialized,
    activeServers,
    toolsLoading,
    refreshMcpData,
    unloadMcpData,
  } = useMcpServerInfo()

  const data: DocumentationProps = {
    overview: <McpManagerDocumentation url={url} />,
    endpoints: <Endpoint apis={mcpManagerEndpoints} url={url} />,
  }

  useEffect(() => {
    return () => {
      unloadMcpData()
    }
  }, [unloadMcpData])

  return (
    <McpManagerService
      loadMcpData={refreshMcpData}
      unloadMcpData={unloadMcpData}
      isInitialized={isInitialized && activeServers.length > 0}
      toolsLoading={toolsLoading}
      demoElement={
        <MCPTextGenerationDemo
          disabled={
            !llmWorkload ||
            llmWorkload.status !== 'active' ||
            !isInitialized ||
            toolsLoading ||
            activeServers.length === 0
          }
          selectedModel={modelName}
          servers={activeServers}
          llmWorkloadIsLoading={llmWorkloadIsLoading}
        />
      }
      docsElement={<DocumentationTemplate data={data} />}
      serversListElement={<McpServersTab />}
    />
  )
}
