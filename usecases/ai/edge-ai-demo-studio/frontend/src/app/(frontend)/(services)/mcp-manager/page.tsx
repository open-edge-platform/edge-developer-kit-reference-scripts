// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import McpManagerService from '@/components/workloads/mcp-manager/mcp-manager-service'
import { useGetWorkloadByType } from '@/hooks/use-workload'
import { TEXT_GENERATION_WORKLOAD } from '@/lib/workloads/text-generation'
import { useMcpServerInfo } from '@/hooks/use-mcp-clients'
import MCPTextGenerationDemo from '@/components/workloads/mcp-manager/demo'
import McpServersTab from '@/components/workloads/mcp-manager/mcp-servers-tab'
import {
  DocumentationProps,
  DocumentationTemplate,
} from '@/components/workloads/documentation'
import McpManagerDocumentation from '@/components/workloads/mcp-manager/documentation'
import { FRONTEND_PORT } from '@/lib/constants'
import Endpoint from '@/components/workloads/endpoint'
import { mcpManagerEndpoints } from '@/components/workloads/mcp-manager/api'
import { useEffect } from 'react'

export default function McpManagerPage() {
  const { data: llmWorkload, isLoading: llmWorkloadIsLoading } =
    useGetWorkloadByType('text-generation')

  const {
    isInitialized,
    activeServers,
    toolsLoading,
    refreshMcpData,
    unloadMcpData,
  } = useMcpServerInfo()

  const data: DocumentationProps = {
    overview: <McpManagerDocumentation port={FRONTEND_PORT} />,
    endpoints: <Endpoint apis={mcpManagerEndpoints} port={FRONTEND_PORT} />,
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
          selectedModel={llmWorkload?.model || TEXT_GENERATION_WORKLOAD.model}
          servers={activeServers}
          llmWorkloadIsLoading={llmWorkloadIsLoading}
        />
      }
      docsElement={<DocumentationTemplate data={data} />}
      serversListElement={<McpServersTab />}
    />
  )
}
