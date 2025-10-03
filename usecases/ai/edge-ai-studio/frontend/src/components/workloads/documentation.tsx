// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'
import { Code } from 'lucide-react'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs'
import React from 'react'

export interface DocumentationProps {
  overview: React.ReactNode
  endpoints: React.ReactNode
}

export function DocumentationTemplate({ data }: { data: DocumentationProps }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Code className="h-5 w-5" />
          API Documentation & Examples
        </CardTitle>
        <CardDescription>Integration guide and code examples</CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="overview" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="endpoint">Endpoints</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-4">
            {data.overview}
          </TabsContent>
          <TabsContent value="endpoint" className="space-y-4">
            {data.endpoints}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  )
}
