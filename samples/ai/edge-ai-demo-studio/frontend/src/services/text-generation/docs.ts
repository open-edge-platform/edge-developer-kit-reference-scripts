// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { ServiceDocsData } from '@/services/types'

export const getDocsData = ({
  host,
  model,
}: {
  host: string
  model?: string
}): ServiceDocsData => {
  const inferModel = model || 'openvino:OpenVINO/Qwen3-8B-int4-ov'
  const servedModel = inferModel.includes(':')
    ? inferModel.slice(inferModel.indexOf(':') + 1)
    : inferModel

  return {
    serviceDescription:
      'The Text Generation service leverages the OpenVINO Model Server to provide efficient and scalable deployment of large language models for real-time text generation. It exposes OpenAI-compatible endpoints, enabling seamless use with existing OpenAI client libraries such as the Python openai package or the Node.js openai library — without requiring an internet connection.',
    overview:
      'The service exposes two OpenAI-compatible endpoints: the Chat Completions API for multi-turn conversational generation, and the Completions API for single-prompt text generation. Both endpoints support streaming via Server-Sent Events, configurable sampling parameters, and beam search. For parameters exclusive to OpenVINO Model Server (such as top_k or repetition_penalty), pass them via the extra_body parameter in Python or directly in JavaScript with a @ts-expect-error comment.',
    endpoints: [
      {
        method: 'POST',
        path: '/v1/chat/completions',
        description:
          'Generate a response from an array of messages. Suitable for multi-turn chat applications. Supports streaming, tool/function calls, structured output (JSON schema), and vision-language models via image URLs in message content.',
        params: [
          {
            name: 'model',
            type: 'string',
            required: true,
            desc: 'Model identifier in <provider>:<model_id> format, where provider is "openvino" or "llamacpp" (e.g. "openvino:OpenVINO/Qwen3-8B-int4-ov"). Run GET /v1/models to list the available identifiers.',
          },
          {
            name: 'messages',
            type: 'array',
            required: true,
            desc: 'Array of message objects, each with a role (system | user | assistant) and content (string or multimodal array with text and image_url entries).',
          },
          {
            name: 'max_tokens',
            type: 'integer',
            required: false,
            desc: 'Maximum number of tokens to generate. If unset, generation stops at the EOS token.',
          },
          {
            name: 'temperature',
            type: 'float',
            required: false,
            desc: 'Sampling temperature (default: 1.0). Values greater than 0 enable multinomial sampling.',
          },
          {
            name: 'top_p',
            type: 'float',
            required: false,
            desc: 'Nucleus sampling threshold (default: 1.0). Must be in (0, 1]. Set to 1 to consider all tokens.',
          },
          {
            name: 'top_k',
            type: 'integer',
            required: false,
            desc: 'Top-K sampling — OpenVINO Model Server exclusive. Controls the number of top tokens to consider. Set to -1 to consider all tokens.',
          },
          {
            name: 'repetition_penalty',
            type: 'float',
            required: false,
            desc: 'Penalises repeated tokens (default: 1.0) — OpenVINO Model Server exclusive. Values above 1.0 discourage repetition; below 1.0 encourage it.',
          },
          {
            name: 'frequency_penalty',
            type: 'float',
            required: false,
            desc: 'Penalises tokens proportional to how often they have appeared so far (default: 0.0). Range: -2.0 to 2.0.',
          },
          {
            name: 'presence_penalty',
            type: 'float',
            required: false,
            desc: 'Penalises tokens that have appeared at least once in the text so far (default: 0.0). Range: -2.0 to 2.0.',
          },
          {
            name: 'stream',
            type: 'boolean',
            required: false,
            desc: 'Stream partial message deltas via Server-Sent Events (default: false). The stream is terminated by a data: [DONE] message.',
          },
          {
            name: 'stop',
            type: 'string | string[]',
            required: false,
            desc: 'Up to 4 sequences where the API stops generating further tokens.',
          },
          {
            name: 'n',
            type: 'integer',
            required: false,
            desc: 'Number of completion choices to return (default: 1). Works with beam search (best_of) or multinomial sampling.',
          },
          {
            name: 'best_of',
            type: 'integer',
            required: false,
            desc: 'Number of sequences generated internally; top n are returned. Acts as the beam width for beam search. Must be >= n.',
          },
          {
            name: 'seed',
            type: 'integer',
            required: false,
            desc: 'Random seed for reproducible generation (default: 0).',
          },
          {
            name: 'tools',
            type: 'array',
            required: false,
            desc: 'List of tools the model may call. Only function-type tools are supported. See the OpenAI API reference for the schema.',
          },
          {
            name: 'tool_choice',
            type: 'string | object',
            required: false,
            desc: 'Controls which tool is called: none | auto | required, or a specific function via {"type": "function", "function": {"name": "..."}}.',
          },
          {
            name: 'response_format',
            type: 'object',
            required: false,
            desc: 'Output format constraint. Use { "type": "json_schema", "json_schema": {...} } for structured outputs matching a JSON schema.',
          },
        ],
      },
      {
        method: 'POST',
        path: '/v1/completions',
        description:
          'Generate text from a single prompt string. Suitable for completion-style sample such as code generation or document continuation. Supports streaming, echo, log probability output, and OpenVINO-exclusive sampling parameters.',
        params: [
          {
            name: 'model',
            type: 'string',
            required: true,
            desc: 'Model identifier in <provider>:<model_id> format, where provider is "openvino" or "llamacpp" (e.g. "openvino:OpenVINO/Qwen3-8B-int4-ov"). Run GET /v1/models to list the available identifiers.',
          },
          {
            name: 'prompt',
            type: 'string',
            required: true,
            desc: 'The input prompt to generate a completion for. Only a single string prompt is currently supported.',
          },
          {
            name: 'max_tokens',
            type: 'integer',
            required: false,
            desc: 'Maximum number of tokens to generate. If unset, generation stops at the EOS token.',
          },
          {
            name: 'temperature',
            type: 'float',
            required: false,
            desc: 'Sampling temperature (default: 1.0). Values greater than 0 enable multinomial sampling.',
          },
          {
            name: 'top_p',
            type: 'float',
            required: false,
            desc: 'Nucleus sampling threshold (default: 1.0). Must be in (0, 1]. Set to 1 to consider all tokens.',
          },
          {
            name: 'top_k',
            type: 'integer',
            required: false,
            desc: 'Top-K sampling — OpenVINO Model Server exclusive. Controls the number of top tokens to consider. Set to -1 to consider all tokens.',
          },
          {
            name: 'repetition_penalty',
            type: 'float',
            required: false,
            desc: 'Penalises repeated tokens (default: 1.0) — OpenVINO Model Server exclusive. Values above 1.0 discourage repetition.',
          },
          {
            name: 'frequency_penalty',
            type: 'float',
            required: false,
            desc: 'Penalises tokens proportional to how often they have appeared so far (default: 0.0). Range: -2.0 to 2.0.',
          },
          {
            name: 'presence_penalty',
            type: 'float',
            required: false,
            desc: 'Penalises tokens that have appeared at least once so far (default: 0.0). Range: -2.0 to 2.0.',
          },
          {
            name: 'stream',
            type: 'boolean',
            required: false,
            desc: 'Stream partial text deltas via Server-Sent Events (default: false). The stream is terminated by a data: [DONE] message.',
          },
          {
            name: 'stop',
            type: 'string | string[]',
            required: false,
            desc: 'Up to 4 sequences where the API stops generating further tokens.',
          },
          {
            name: 'n',
            type: 'integer',
            required: false,
            desc: 'Number of completion choices to return (default: 1).',
          },
          {
            name: 'best_of',
            type: 'integer',
            required: false,
            desc: 'Number of sequences generated internally; top n are returned. Acts as the beam width for beam search. Must be >= n.',
          },
          {
            name: 'echo',
            type: 'boolean',
            required: false,
            desc: 'Echo the prompt back in the response in addition to the completion.',
          },
          {
            name: 'logprobs',
            type: 'integer',
            required: false,
            desc: 'Include log probabilities for the returned token. Only value 1 is accepted.',
          },
          {
            name: 'seed',
            type: 'integer',
            required: false,
            desc: 'Random seed for reproducible generation (default: 0).',
          },
        ],
      },
    ],
    sampleCodeIntro:
      'The service is fully compatible with the OpenAI Python and Node.js client libraries. Use base_url pointing to the service and set api_key to any non-empty string. For OpenVINO-exclusive parameters (top_k, repetition_penalty, etc.), use extra_body in Python or pass them directly with a @ts-expect-error annotation in TypeScript.',
    sampleCode: [
      {
        title: 'Chat Completions',
        codeSnippets: [
          {
            language: 'Python',
            languageCode: 'python',
            code: `from openai import OpenAI

client = OpenAI(base_url="${host}/v1", api_key="unused")
model = "${inferModel}"

response = client.chat.completions.create(
    model=model,
    messages=[
        {"role": "system", "content": "You are a helpful assistant."},
        {"role": "user", "content": "Tell me about OpenVINO"},
    ],
)
print("response:", response.choices[0].message.content)`,
          },
          {
            language: 'JavaScript',
            languageCode: 'javascript',
            code: `import OpenAI from 'openai'

const client = new OpenAI({
  baseURL: '${host}/v1',
  apiKey: 'unused',
})
const model = '${inferModel}'

const response = await client.chat.completions.create({
  model,
  messages: [
    { role: 'system', content: 'You are a helpful assistant.' },
    { role: 'user', content: 'Tell me about OpenVINO' },
  ],
})

console.log(response.choices[0].message.content)`,
          },
          {
            language: 'cURL',
            languageCode: 'bash',
            code: `curl ${host}/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "${inferModel}",
    "messages": [
      {"role": "system", "content": "You are a helpful assistant."},
      {"role": "user", "content": "Tell me about OpenVINO"}
    ],
    "stream": false
  }'`,
          },
        ],
      },
      {
        title: 'Completions',
        codeSnippets: [
          {
            language: 'Python',
            languageCode: 'python',
            code: `from openai import OpenAI

client = OpenAI(base_url="${host}/v1", api_key="unused")
model = "${inferModel}"

response = client.completions.create(
    model=model,
    prompt="Tell me about OpenVINO",
    max_tokens=100,
    stream=False,
)
print("response:", response.choices[0].text)`,
          },
          {
            language: 'JavaScript',
            languageCode: 'javascript',
            code: `import OpenAI from 'openai'

const client = new OpenAI({
  baseURL: '${host}/v1',
  apiKey: 'unused',
})
const model = '${inferModel}'

const response = await client.completions.create({
  model,
  prompt: 'Write a one-sentence story about OpenVINO.',
})

console.log(response.choices[0].text)`,
          },
          {
            language: 'cURL',
            languageCode: 'bash',
            code: `curl ${host}/v1/completions \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "${inferModel}",
    "prompt": "Tell me about OpenVINO",
    "stream": false
  }'`,
          },
        ],
      },
      {
        title: 'OpenVINO Exclusive Parameters',
        codeSnippets: [
          {
            language: 'Python',
            languageCode: 'python',
            code: `from openai import OpenAI

client = OpenAI(base_url="${host}/v1", api_key="unused")
model = "${inferModel}"

response = client.completions.create(
    model=model,
    prompt="Tell me about OpenVINO",
    max_tokens=100,
    extra_body={"top_k": 1},
    stream=False,
)
print("response:", response.choices[0].text)`,
          },
          {
            language: 'JavaScript',
            languageCode: 'javascript',
            code: `import OpenAI from 'openai'

const client = new OpenAI({
  baseURL: '${host}/v1',
  apiKey: 'unused',
})
const model = '${inferModel}'

const response = await client.completions.create({
  model,
  prompt: 'Write a one-sentence story about OpenVINO.',
  // @ts-expect-error -- OpenVINO-exclusive parameter
  top_k: 1,
})

console.log(response.choices[0].text)`,
          },
        ],
      },
    ],
    responseExample: `// Chat Completions response
{
  "choices": [
    {
      "finish_reason": "stop",
      "index": 0,
      "logprobs": null,
      "message": {
        "content": "OpenVINO is Intel's open-source toolkit for optimizing and deploying AI inference...",
        "role": "assistant"
      }
    }
  ],
  "created": 1716825108,
  "model": "${servedModel}",
  "object": "chat.completion",
  "usage": {
    "completion_tokens": 38,
    "prompt_tokens": 22,
    "total_tokens": 60
  }
}

// Completions response
{
  "choices": [
    {
      "finish_reason": "stop",
      "index": 0,
      "logprobs": null,
      "text": "OpenVINO is Intel's open-source toolkit for optimizing and deploying AI inference..."
    }
  ],
  "created": 1716825108,
  "model": "${servedModel}",
  "object": "text_completion",
  "usage": {
    "completion_tokens": 14,
    "prompt_tokens": 17,
    "total_tokens": 31
  }
}`,
  }
}
