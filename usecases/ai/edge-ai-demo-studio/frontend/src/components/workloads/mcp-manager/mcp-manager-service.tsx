// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import {
  AlertCircleIcon,
  Code,
  Loader2,
  Play,
  Power,
  PowerOff,
  Rows3,
} from 'lucide-react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import React from 'react'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { toast } from 'sonner'

export default function McpManagerService({
  loadMcpData,
  unloadMcpData,
  isInitialized,
  toolsLoading,
  demoElement,
  docsElement,
  serversListElement,
}: {
  loadMcpData: () => void
  unloadMcpData: () => void
  isInitialized: boolean
  toolsLoading: boolean
  demoElement: React.ReactNode
  docsElement: React.ReactNode
  serversListElement: React.ReactNode
}) {
  const toggleService = () => {
    if (!isInitialized && !toolsLoading) {
      try {
        loadMcpData()
      } catch (error) {
        console.error('Error connecting to MCP servers:', error)
        toast.error('Connection Failed', {
          description:
            'An error occurred while connecting to the MCP servers. Please make sure the MCP Servers are configured and accessible.',
        })
      }
    } else if (isInitialized) {
      unloadMcpData()
    }
  }

  return (
    <>
      <div className="w-full py-8">
        <div className="mb-8 flex w-full items-center justify-between gap-4 px-6">
          {/* Header */}
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="text-2xl font-bold text-slate-900">
                MCP Manager
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={toggleService}
              className="ml-2"
              variant={isInitialized ? 'destructive' : 'default'}
              disabled={toolsLoading}
            >
              {toolsLoading ? (
                <>
                  <Loader2 className="mr-1 size-4 animate-spin" />
                  Connecting...
                </>
              ) : isInitialized ? (
                <>
                  <PowerOff className="mr-1 h-4 w-4" />
                  Disconnect
                </>
              ) : (
                <>
                  <Power className="mr-1 h-4 w-4" />
                  Connect
                </>
              )}
            </Button>
          </div>
        </div>

        {/* Main Tabs */}
        <Tabs defaultValue="demo" className="w-full">
          <TabsList className="mb-8 grid w-full grid-cols-3">
            <TabsTrigger value="demo" className="flex items-center gap-2">
              <Play className="h-4 w-4" />
              Live Demo
            </TabsTrigger>
            <TabsTrigger value="docs" className="flex items-center gap-2">
              <Code className="h-4 w-4" />
              Documentation
            </TabsTrigger>
            <TabsTrigger
              value="servers-list"
              className="flex items-center gap-2"
            >
              <Rows3 className="h-4 w-4" />
              MCP Servers List
            </TabsTrigger>
          </TabsList>
          <TabsContent value="demo" className="space-y-6">
            {toolsLoading ? (
              <Alert>
                <AlertCircleIcon />
                <AlertTitle>Connecting to MCP Servers</AlertTitle>
                <AlertDescription>
                  The MCP Manager service is currently connecting to configured
                  servers. Please wait...
                </AlertDescription>
              </Alert>
            ) : (
              !isInitialized && (
                <Alert variant="default">
                  <AlertCircleIcon />
                  <AlertTitle>MCP Manager Not Connected</AlertTitle>
                  <AlertDescription>
                    Click the &ldquo;Connect&rdquo; button above to connect to
                    MCP servers and start using the tools. The demo will be
                    available once connected.
                  </AlertDescription>
                </Alert>
              )
            )}
            {demoElement}
          </TabsContent>

          <TabsContent value="docs" className="space-y-6">
            {docsElement}
          </TabsContent>

          <TabsContent value="servers-list" className="space-y-6">
            {serversListElement}
          </TabsContent>
        </Tabs>
      </div>
    </>
  )
}
