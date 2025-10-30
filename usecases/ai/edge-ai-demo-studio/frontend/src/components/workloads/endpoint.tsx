// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { Check, Copy } from 'lucide-react'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '../ui/accordion'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { useState } from 'react'
import { toast } from 'sonner'

export interface EndpointProps {
  title: string
  description: string
  path: string
  headers?: string
  body?: string
  method: 'GET' | 'POST' | 'PUT' | 'DELETE'
  parameters?: Parameter[]
  exampleResponse: string
  queryParams?: string[]
  formData?: string[]
}

export interface Parameter {
  name: string
  description: string
  required?: boolean
}

export default function Endpoint({
  apis,
  port,
}: {
  apis: EndpointProps[]
  port: number
}) {
  const [copiedIndex, setCopiedIndex] = useState<
    { type: 'path' | 'curl'; index: number } | undefined
  >()
  const handleCopyApiPath = (index: number, path: string) => {
    const fullUrl = `http://localhost:${port}${path.startsWith('/') ? path : `/${path}`}`
    navigator.clipboard.writeText(fullUrl)
    setCopiedIndex({ type: 'path', index })
    toast.success('Path copied to clipboard')
    setTimeout(() => {
      setCopiedIndex(undefined)
    }, 2000)
  }

  const handleCopyCurlExample = (curlLines: string, index: number) => {
    navigator.clipboard.writeText(curlLines)
    setCopiedIndex({ type: 'curl', index })
    toast.success('cURL Example copied to clipboard')
    setTimeout(() => {
      setCopiedIndex(undefined)
    }, 2000)
  }

  return (
    <div className="flex w-full flex-col gap-2 py-2">
      <h3 className="mb-2 font-semibold">REST API Endpoints</h3>
      <Accordion
        type="single"
        collapsible
        className="flex w-full flex-col gap-2"
      >
        {apis.map((api, index) => {
          const curlLines = [
            `curl -X ${api.method} "https://api.edge-ai-hub.com${api.path}${
              api.queryParams && api.queryParams.length > 0
                ? `?${new URLSearchParams(
                    Object.fromEntries(
                      api.queryParams.map((param) => {
                        const [key, value = ''] = param.split('=')
                        return [key, value]
                      }),
                    ),
                  ).toString()}`
                : ''
            }"` + ' \\',
            '  -H "Authorization: Bearer YOUR_API_KEY"' +
              (api.headers ? ' \\' : ''),
            api.headers
              ? `  -H "${api.headers}"` +
                (api.formData || api.body ? ' \\' : '')
              : null,
            api.formData
              ? api.formData
                  .map(
                    (param, index) =>
                      `  -F "${param}"${index < api.formData!.length - 1 ? ' \\' : ''}`,
                  )
                  .join('\n')
              : null,
            api.body
              ? `  -d ${`'${JSON.stringify(JSON.parse(api.body), null, 4)}'`.split("}'").join("  }'")}`
              : null,
          ]
            .filter(Boolean)
            .join('\n')

          return (
            <AccordionItem key={api.title} value={api.title}>
              <div className="relative w-full rounded bg-slate-900 px-3 text-sm text-slate-100 transition-all duration-200 hover:scale-[1.02] hover:bg-slate-800 hover:shadow-lg hover:ring-2 hover:ring-slate-400/50">
                <AccordionTrigger className="w-full cursor-pointer text-left">
                  <div className="flex flex-1 flex-col gap-2">
                    <div className="text-md text-slate-600 text-white">
                      {api.title}
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary">{api.method}</Badge>
                      <div className="flex flex-1 cursor-default items-center">
                        <span className="px-4 font-semibold break-all">
                          {api.path}
                        </span>
                      </div>
                    </div>
                  </div>
                </AccordionTrigger>
                <Button
                  variant={
                    copiedIndex?.type === 'path' && copiedIndex.index === index
                      ? 'default'
                      : 'secondary'
                  }
                  className="absolute top-4 right-4 size-8 p-4"
                  onClick={(e) => {
                    e.stopPropagation()
                    handleCopyApiPath(index, api.path)
                  }}
                  title="Copy path"
                >
                  {copiedIndex?.type === 'path' &&
                  copiedIndex.index === index ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
              </div>
              <AccordionContent className="space-y-6">
                <div className="border-border mt-4 rounded-lg border p-4">
                  <p className="text-sm">{api.description}</p>
                </div>

                {/* Parameters */}
                {api.parameters && api.parameters.length > 0 && (
                  <div>
                    <h4 className="mb-2 font-medium">Parameters</h4>
                    <div className="space-y-2">
                      {api.parameters.map((param, index) => (
                        <div key={index} className="rounded border p-3">
                          <div className="mb-1 flex items-center gap-2">
                            <code className="rounded bg-slate-100 px-2 py-1 font-mono text-xs">
                              {param.name}
                              {param.required && (
                                <span className="text-red-500">*</span>
                              )}
                            </code>
                          </div>
                          <p className="text-sm text-slate-600">
                            {param.description}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Request Body Example */}
                {api.body && (
                  <div>
                    <h4 className="mb-2 font-medium">Request Body Example</h4>
                    <div className="rounded bg-slate-50 p-3 text-sm">
                      <pre>{api.body}</pre>
                    </div>
                  </div>
                )}

                {/* cURL Example */}
                <div className="relative">
                  <h4 className="mb-2 font-medium">cURL Example</h4>
                  <Button
                    variant={
                      copiedIndex?.type === 'curl' &&
                      copiedIndex.index === index
                        ? 'default'
                        : 'secondary'
                    }
                    className="absolute top-10 right-4 size-8 p-4"
                    onClick={() => handleCopyCurlExample(curlLines, index)}
                    title="Copy cURL"
                  >
                    {copiedIndex?.type === 'curl' &&
                    copiedIndex.index === index ? (
                      <Check className="h-4 w-4" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </Button>
                  <div className="rounded bg-slate-900 p-3 text-sm text-slate-100">
                    <pre>{curlLines}</pre>
                  </div>
                </div>

                {/* Response Example */}
                <div>
                  <h4 className="mb-2 font-medium">Response Example</h4>
                  <div className="rounded bg-slate-50 p-3 text-sm">
                    <pre>{api.exampleResponse}</pre>
                  </div>
                </div>
              </AccordionContent>
            </AccordionItem>
          )
        })}
      </Accordion>
    </div>
  )
}
