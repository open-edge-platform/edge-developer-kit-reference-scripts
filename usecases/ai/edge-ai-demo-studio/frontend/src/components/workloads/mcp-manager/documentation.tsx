// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import CodeBlock, { CodeSnippet } from '@/components/common/codeblock'

export default function McpManagerDocumentation({ port }: { port: number }) {
  const completionAPISnippet: CodeSnippet[] = [
    {
      language: 'Python',
      languageCode: 'py',
      code: `import requests

response = requests.post(
    "http://localhost:${port}/api/mcp/completions",
    json={
        "prompt": "What is the weather like in New York?",
        "stream": False,
        "tools": [],  # Optional: specify MCP tool names
        "maxSteps": 3,
    },
)
result = response.json()
print("response:", result["text"])`,
    },
    {
      language: 'Javascript',
      languageCode: 'js',
      code: `const response = await fetch('http://localhost:${port}/api/mcp/completions', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    prompt: 'What is the weather like in New York?',
    stream: false,
    tools: [], // Optional: specify MCP tool names
    maxSteps: 3,
  }),
})

const result = await response.json()
console.log(result.text)`,
    },
  ]

  const chatAPISnippet: CodeSnippet[] = [
    {
      language: 'Python',
      languageCode: 'py',
      code: `import requests

response = requests.post(
    "http://localhost:${port}/api/mcp/chat/completions",
    json={
        "messages": [
            {"role": "system", "content": "You are a helpful assistant."},
            {"role": "user", "content": "What is the weather like in New York?"},
        ],
        "stream": False,
        "tools": [],  # Optional: specify MCP tool names
        "maxSteps": 3,
    },
)
result = response.json()
print("response:", result["text"])`,
    },
    {
      language: 'Javascript',
      languageCode: 'js',
      code: `const response = await fetch('http://localhost:${port}/api/mcp/chat/completions', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    messages: [
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'user', content: 'What is the weather like in New York?' },
    ],
    stream: false,
    tools: [], // Optional: specify MCP tool names
    maxSteps: 3,
  }),
})

const result = await response.json()
console.log(result.text)`,
    },
  ]

  const mcpServersSnippet: CodeSnippet[] = [
    {
      language: 'Python',
      languageCode: 'py',
      code: `import requests

# Get available MCP servers and tools
servers_response = requests.get("http://localhost:${port}/api/mcp/clients")
servers = servers_response.json()

print(f"Total tools available: {servers['totalTools']}")
for server in servers["servers"]:
    print(f"Server: {server['name']} - {server['toolCount']} tools")
    for tool in server["tools"]:
        print(f"  - {tool['name']}: {tool['description']}")`,
    },
    {
      language: 'Javascript',
      languageCode: 'js',
      code: `// Get available MCP servers and tools
const serversResponse = await fetch('http://localhost:${port}/api/mcp/clients')
const servers = await serversResponse.json()

console.log(\`Total tools available: \${servers.totalTools}\`)
servers.servers.forEach((server) => {
  console.log(\`Server: \${server.name} - \${server.toolCount} tools\`)
  server.tools.forEach((tool) => {
    console.log(\`  - \${tool.name}: \${tool.description}\`)
  })
})`,
    },
  ]

  const mcpToolsSnippet: CodeSnippet[] = [
    {
      language: 'Python',
      languageCode: 'py',
      code: `import requests

# Use specific MCP tools in completion
response = requests.post(
    "http://localhost:${port}/api/mcp/completions",
    json={
        "prompt": "What is the weather in New York?",
        "stream": False,
        "tools": ["get_weather"],  # Specify which MCP tools to use
        "maxSteps": 5,
    },
)
result = response.json()
print("response:", result["text"])`,
    },
    {
      language: 'Javascript',
      languageCode: 'js',
      code: `// Use specific MCP tools in completion
const response = await fetch('http://localhost:${port}/api/mcp/completions', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    prompt: "What is the weather in New York?",
    stream: false,
    tools: ['get_weather'], // Specify which MCP tools to use
    maxSteps: 5,
  }),
})

const result = await response.json()
console.log(result.text)`,
    },
  ]

  return (
    <div className="grid gap-8 lg:grid-cols-4">
      {/* Main Documentation Content */}
      <div className="lg:col-span-4">
        <div className="space-y-8">
          {/* Header */}
          <div>
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h1 className="text-3xl font-bold text-slate-900">
                  MCP Manager API
                </h1>
              </div>
            </div>
          </div>

          <div id="overview" className="prose flex max-w-none flex-col gap-4">
            {/* MCP Manager */}
            <p className="leading-relaxed text-slate-700">
              The MCP Manager provides an intelligent text generation service
              that combines the power of&nbsp;
              <a
                className="text-primary font-medium"
                target="_blank"
                href="https://docs.openvino.ai/2025/model-server/ovms_what_is_openvino_model_server.html"
              >
                OpenVINO Model Server
              </a>
              &nbsp;with&nbsp;
              <a
                className="text-primary font-medium"
                target="_blank"
                href="https://modelcontextprotocol.io/"
              >
                Model Context Protocol (MCP)
              </a>
              . This integration enables LLMs to seamlessly access external
              tools and data sources through MCP servers, allowing for dynamic
              tool usage during text generation.
            </p>
            <p className="leading-relaxed text-slate-700">
              Here&apos;s a simple example to generate text using the
              completions API:
            </p>
            <CodeBlock
              title={'Generate text with completions API'}
              data={completionAPISnippet}
            />

            <p className="leading-relaxed text-slate-700">
              Rather than just using a single prompt, using the chat completions
              API allows an array of messages with different roles to give a
              better response for conversational interactions. Here&apos;s an
              example using the chat API:
            </p>
            <CodeBlock
              title={'Generate text with chat API'}
              data={chatAPISnippet}
            />

            <p className="text-lg leading-relaxed font-semibold text-slate-700">
              Working with MCP Tools
            </p>
            <p className="leading-relaxed text-slate-700">
              The MCP Manager integrates with Model Context Protocol (MCP)
              servers to provide tools that can be used during text generation.
              You can retrieve available tools from enabled MCP servers:
            </p>
            <CodeBlock
              title={'Get Available MCP Servers and Tools'}
              data={mcpServersSnippet}
            />
            <p className="leading-relaxed text-slate-700">
              You can then specify which tools to use in your completions:
            </p>
            <CodeBlock
              title={'Using MCP Tools in Completions'}
              data={mcpToolsSnippet}
            />
            <p className="leading-relaxed text-slate-700">
              When tools are specified, the model can use them automatically
              during generation to fetch information or perform actions. The
              <code className="mx-1 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-sm">
                maxSteps
              </code>
              parameter controls how many tool invocations are allowed.
            </p>
            <p className="leading-relaxed text-slate-700">
              Please refer to the&nbsp;
              <span className="text-primary font-medium">Endpoints</span> tab
              for a complete list of available endpoints and parameters.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
