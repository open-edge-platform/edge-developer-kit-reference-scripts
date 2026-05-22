// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { ServiceDocsData } from '@/services/types'

export const getDocsData = ({ host }: { host: string }): ServiceDocsData => {
  // MCP endpoints live on the frontend itself, not on a proxied worker
  const origin = host.includes('/')
    ? host.substring(0, host.indexOf('/'))
    : host

  return {
    serviceDescription:
      'The MCP Manager provides a centralized interface for managing Model Context Protocol (MCP) server configurations. MCP servers expose tools that LLMs can invoke during text generation for dynamic tool calling.',
    overview:
      'Manage MCP server configurations through the Payload CMS REST API. Add, update, enable/disable, and remove MCP servers. Enabled servers and their tools can be consumed by other services (e.g., Text Generation) for agentic workflows.',
    endpoints: [
      {
        method: 'GET',
        path: '/api/mcp-servers',
        description:
          'List all configured MCP servers. Returns a paginated list of server records.',
      },
      {
        method: 'POST',
        path: '/api/mcp-servers',
        description: 'Add a new MCP server configuration.',
        params: [
          {
            name: 'name',
            type: 'string',
            required: true,
            desc: 'Display name for the MCP server',
          },
          {
            name: 'url',
            type: 'string',
            required: true,
            desc: 'MCP server endpoint URL (e.g., http://localhost:8000/mcp)',
          },
          {
            name: 'apiKey',
            type: 'string',
            required: false,
            desc: 'Optional API key for authentication',
          },
          {
            name: 'disabled',
            type: 'boolean',
            required: false,
            desc: 'Whether the server is disabled (default: false)',
          },
        ],
      },
      {
        method: 'PATCH',
        path: '/api/mcp-servers/{id}',
        description:
          'Update an existing MCP server configuration. Supports partial updates.',
        params: [
          {
            name: 'name',
            type: 'string',
            required: false,
            desc: 'Updated display name',
          },
          {
            name: 'url',
            type: 'string',
            required: false,
            desc: 'Updated endpoint URL',
          },
          {
            name: 'apiKey',
            type: 'string',
            required: false,
            desc: 'Updated API key',
          },
          {
            name: 'disabled',
            type: 'boolean',
            required: false,
            desc: 'Enable or disable the server',
          },
        ],
      },
      {
        method: 'DELETE',
        path: '/api/mcp-servers/{id}',
        description: 'Remove an MCP server configuration.',
        params: [
          {
            name: 'id',
            type: 'number',
            required: true,
            desc: 'The server record ID',
          },
        ],
      },
    ],
    sampleCode: [
      {
        title: 'List MCP servers',
        codeSnippets: [
          {
            language: 'Python',
            languageCode: 'python',
            code: `import requests\n\nresponse = requests.get("http://${origin}/api/mcp-servers")\nservers = response.json()\n\nfor server in servers.get("docs", []):\n    status = "enabled" if not server.get("disabled") else "disabled"\n    print(f"{server['name']} ({server['url']}) - {status}")`,
          },
          {
            language: 'cURL',
            languageCode: 'bash',
            code: `curl http://${origin}/api/mcp-servers`,
          },
        ],
      },
      {
        title: 'Add a new MCP server',
        codeSnippets: [
          {
            language: 'Python',
            languageCode: 'python',
            code: `import requests\n\nresponse = requests.post(\n    "http://${origin}/api/mcp-servers",\n    json={\n        "name": "Weather Tools",\n        "url": "http://localhost:7906/mcp",\n        "disabled": False,\n    },\n)\nprint(response.json())`,
          },
          {
            language: 'cURL',
            languageCode: 'bash',
            code: `curl -X POST http://${origin}/api/mcp-servers \\\n  -H "Content-Type: application/json" \\\n  -d '{"name": "Weather Tools", "url": "http://localhost:7906/mcp"}'`,
          },
        ],
      },
    ],
    responseExample: `{\n  "docs": [\n    {\n      "id": 1,\n      "name": "Weather Tools",\n      "url": "http://localhost:7906/mcp",\n      "apiKey": null,\n      "disabled": false,\n      "updatedAt": "2026-01-15T10:30:00.000Z",\n      "createdAt": "2026-01-15T10:30:00.000Z"\n    }\n  ],\n  "totalDocs": 1,\n  "limit": 10,\n  "totalPages": 1,\n  "page": 1,\n  "pagingCounter": 1,\n  "hasPrevPage": false,\n  "hasNextPage": false\n}`,
  }
}
