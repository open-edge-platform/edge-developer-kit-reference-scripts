// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { EndpointProps } from '../endpoint'

export const mcpManagerEndpoints: EndpointProps[] = [
  {
    title: 'MCP Completion API',
    description:
      'Generate text based on a given prompt using OpenVINO Model Server with optional MCP tool integration.',
    path: '/api/mcp/completions',
    body: `{
    "prompt": "What is the weather in New York?",
    "stream": false,
    "tools": [],
    "maxSteps": 3
}`,
    method: 'POST',
    headers: `Content-Type: application/json`,
    exampleResponse: `{
  "text": "The current temperature in New York is 15°C with Cloudy conditions and humidity at 70%.",
  "steps": [
    {
      "content": [
        {
          "type": "tool-call",
          "toolCallId": "iOwhrntoQFcGCR6s",
          "toolName": "get_weather_by_location",
          "input": { "location": "New York" }
        },
        {
          "type": "tool-result",
          "toolCallId": "iOwhrntoQFcGCR6s",
          "toolName": "get_weather_by_location",
          "output": {
            "content": [{ "type": "text", "text": "{\\"temperature\\": \\"15°C\\", \\"condition\\": \\"Cloudy\\"}" }],
            "isError": false
          }
        }
      ],
      "finishReason": "stop",
      "usage": { "inputTokens": 350, "outputTokens": 23, "totalTokens": 373 }
    },
    {
      "content": [
        {
          "type": "text",
          "text": "The current temperature in New York is 15°C with Cloudy conditions and humidity at 70%."
        }
      ],
      "finishReason": "stop",
      "usage": { "inputTokens": 448, "outputTokens": 23, "totalTokens": 471 }
    }
  ],
  "toolCalls": [],
  "toolResults": [],
  "reasoning": [],
  "usage": { "inputTokens": 448, "outputTokens": 23, "totalTokens": 471 },
  "model": "OpenVINO/Qwen2.5-1.5B-Instruct-int4-ov"
}`,
    parameters: [
      {
        name: 'prompt',
        description:
          'The prompt to generate completions for, encoded as a string.',
        required: true,
      },
      {
        name: 'stream',
        description:
          'If set to true, returns a stream of UI messages. If false, returns the complete response. Default: false',
        required: false,
      },
      {
        name: 'tools',
        description:
          'Array of MCP tool names to make available during generation. If empty array, all available MCP tools will be used. The model can automatically invoke these tools as needed.',
        required: false,
      },
      {
        name: 'maxSteps',
        description:
          'Maximum number of tool invocation steps allowed during generation. Controls how many times the model can call tools before completing. Default: 3',
        required: false,
      },
    ],
  },
  {
    title: 'MCP Chat Completions API',
    description:
      'Generate conversational responses using OpenVINO Model Server with optional MCP tool integration. Supports both simple message format and Vercel AI SDK UIMessage format.',
    path: '/api/mcp/chat/completions',
    body: `{
    "messages": [
      {
        "role": "system",
        "content": "You are a helpful assistant."
      },
      {
        "role": "user",
        "content": "What is the weather in New York?"
      }
    ],
    "stream": false,
    "tools": [],
    "maxSteps": 3
}`,
    method: 'POST',
    headers: `Content-Type: application/json`,
    exampleResponse: `{
  "text": "The current temperature in New York is 15°C with Cloudy conditions and humidity at 70%.",
  "steps": [
    {
      "content": [
        {
          "type": "tool-call",
          "toolCallId": "abc123",
          "toolName": "get_weather_by_location",
          "input": { "location": "New York" }
        },
        {
          "type": "tool-result",
          "toolCallId": "abc123",
          "toolName": "get_weather_by_location",
          "output": {
            "content": [{ "type": "text", "text": "{\\"temperature\\": \\"15°C\\", \\"condition\\": \\"Cloudy\\"}" }],
            "isError": false
          }
        }
      ],
      "finishReason": "stop",
      "usage": { "inputTokens": 361, "outputTokens": 23, "totalTokens": 384 }
    },
    {
      "content": [
        {
          "type": "text",
          "text": "The current temperature in New York is 15°C with Cloudy conditions and humidity at 70%."
        }
      ],
      "finishReason": "stop",
      "usage": { "inputTokens": 459, "outputTokens": 23, "totalTokens": 482 }
    }
  ],
  "toolCalls": [],
  "toolResults": [],
  "reasoning": [],
  "usage": { "inputTokens": 459, "outputTokens": 23, "totalTokens": 482 },
  "messages": [
    {
      "role": "system",
      "content": "You are a helpful assistant."
    },
    {
      "role": "user",
      "content": "What is the weather in New York?"
    }
  ]
}`,
    parameters: [
      {
        name: 'messages',
        description:
          'A list of messages comprising the conversation so far. Each object should contain role ("system", "user", or "assistant") and content (text string). Supports both simple ChatMessage format and Vercel AI SDK UIMessage format.',
        required: true,
      },
      {
        name: 'stream',
        description:
          'If set to true, returns a stream of UI messages. If false, returns the complete response. Default: false',
        required: false,
      },
      {
        name: 'tools',
        description:
          'Array of MCP tool names to make available during generation. If empty array, all available MCP tools will be used. The model can automatically invoke these tools as needed.',
        required: false,
      },
      {
        name: 'maxSteps',
        description:
          'Maximum number of tool invocation steps allowed during generation. Controls how many times the model can call tools before completing. Default: 3',
        required: false,
      },
    ],
  },
  {
    title: 'Get MCP Clients',
    description:
      'Retrieve information about connected MCP servers, their tools, and connection status.',
    path: '/api/mcp/clients',
    method: 'GET',
    exampleResponse: `{
  "servers": [
    {
      "id": "1",
      "name": "Weather Tools",
      "url": "http://localhost:7906/mcp",
      "active": true,
      "isConnected": true,
      "toolCount": 1,
      "tools": [
        {
          "name": "get_weather_by_location",
          "description": "Get weather information based on location.\\n    \\n    Args:\\n        location: The location for which to get the weather.\\n        \\n    Returns:\\n        dict: A dictionary containing mock weather information.\\n    "
        }
      ]
    }
  ],
  "totalTools": 1,
  "lastUpdate": "2025-11-20T06:45:44.880Z"
}`,
    parameters: [],
  },
  {
    title: 'Close MCP Clients',
    description:
      'Cleanup and close all MCP client connections. Useful for releasing resources or refreshing connections.',
    path: '/api/mcp/clients/close',
    method: 'POST',
    exampleResponse: `{
  "success": true,
  "message": "All MCP clients have been cleaned up",
  "timestamp": "2025-01-15T10:30:00.000Z"
}`,
    parameters: [],
  },
]
