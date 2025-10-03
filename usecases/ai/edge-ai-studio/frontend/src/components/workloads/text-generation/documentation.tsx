// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import CodeBlock, { CodeSnippet } from '@/components/common/codeblock'

export default function TextGenerationDocumentation({
  port,
  model,
}: {
  port: number
  model: string
}) {
  const completionAPISnippet: CodeSnippet[] = [
    {
      language: 'Python',
      languageCode: 'py',
      code: `from openai import OpenAI

client = OpenAI(base_url="http://localhost:${port}/v3", api_key="unused")
model = "${model}"
response = client.completions.create(
    model=model,
    prompt="Tell me about OpenVINO",
    max_tokens=100,
    stream=False,
)
print("response:", response.choices[0].text)`,
    },
    {
      language: 'Javascript',
      languageCode: 'js',
      code: `import OpenAI from 'openai'

const client = new OpenAI({
    baseURL: 'http://localhost:${port}/v3',
    apiKey: 'unused',
  })
const model = "${model}"

const response = await client.chat.create({
  model,
  prompt: 'Write a one-sentence bedtime story about a unicorn.',
})

console.log(response.choices[0].text)`,
    },
  ]

  const chatAPISnippet: CodeSnippet[] = [
    {
      language: 'Python',
      languageCode: 'py',
      code: `from openai import OpenAI

client = OpenAI(base_url="http://localhost:${port}/v3", api_key="unused")
model = "${model}"
response = completion = client.chat.completions.create(
    model=model,
    messages=[
        {"role": "system", "content": "You are a helpful assistant."},
        {"role": "user", "content": "Tell me about OpenVINO"},
    ],
)
print("response:", response.choices[0].message)`,
    },
    {
      language: 'Javascript',
      languageCode: 'js',
      code: `import OpenAI from 'openai'

const client = new OpenAI({
    baseURL: 'http://localhost:${port}/v3',
    apiKey: 'unused',
  })
const model = "${model}"

const response = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'user', content: 'Tell me about OpenVINO'},
    ],
  })

console.log(response.choices[0].text)`,
    },
  ]

  const openvinoSnippet: CodeSnippet[] = [
    {
      language: 'Python',
      languageCode: 'py',
      code: `from openai import OpenAI

client = OpenAI(base_url="http://localhost:${port}/v3", api_key="unused")
model = "${model}"
response = client.completions.create(
    model=model,
    prompt="Tell me about OpenVINO",
    max_tokens=100,
    extra_body={"top_k" : 1},
    stream=False,
)
print("response:", response.choices[0].text)`,
    },
    {
      language: 'Javascript',
      languageCode: 'js',
      code: `import OpenAI from 'openai'

const client = new OpenAI({
    baseURL: 'http://localhost:${port}/v3',
    apiKey: 'unused',
    // @ts-expect-error --undocumented param
    top_k: 1,
  })
const model = "${model}"

const response = await client.chat.create({
  model,
  prompt: 'Write a one-sentence bedtime story about a unicorn.',
})

console.log(response.choices[0].text)`,
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
                  Text Generation API
                </h1>
              </div>
            </div>
          </div>

          <div id="overview" className="prose flex max-w-none flex-col gap-4">
            {/* Text generation */}
            <p className="leading-relaxed text-slate-700">
              This text generation service leverages the capabilities of
              the&nbsp;
              <a
                className="text-primary font-medium"
                target="_blank"
                href="https://docs.openvino.ai/2025/model-server/ovms_what_is_openvino_model_server.html"
              >
                OpenVINO Model Server
              </a>
              , providing efficient and scalable deployment of machine learning
              models for real-time text generation in chat applications.
              Importantly, it is OpenAI-compatible, allowing you to use it with
              OpenAI API client libraries, such as the&nbsp;
              <a
                className="text-primary font-medium"
                target="_blank"
                href="https://platform.openai.com/docs/libraries/node-js-library"
              >
                OpenAI Node.js library
              </a>
              . This compatibility enables you to generate text, answer
              questions, and perform other natural language processing tasks
              directly on your edge device, without requiring an internet
              connection.
            </p>
            <p className="leading-relaxed text-slate-700">
              Here&apos;s a simple example to generate text with&nbsp;
              <a
                className="text-primary font-medium"
                target="_blank"
                href="https://platform.openai.com/docs/overview"
              >
                OpenAI Library
              </a>
              .
            </p>
            <CodeBlock
              title={'Generate text with completions API'}
              data={completionAPISnippet}
            />

            <p className="leading-relaxed text-slate-700">
              Rather than just using a single prompt, using the chat completions
              API allows an array of messages with different roles to give a
              better response for a chat. Here&apos;s another simple example to
              generate text using the&nbsp;
              <a
                className="text-primary font-medium"
                target="_blank"
                href="https://platform.openai.com/docs/api-reference/chat/create"
              >
                OpenAI Chat Completions API
              </a>
              &nbsp;instead
            </p>
            <CodeBlock
              title={'Generate text with chat API'}
              data={chatAPISnippet}
            />

            <p className="text-lg leading-relaxed font-semibold text-slate-700">
              OpenVINO specific parameters
            </p>
            <p className="leading-relaxed text-slate-700">
              There are a few parameters that are only available in the OpenVINO
              Model Server API, which are not available in the OpenAI API. These
              parameters are used to control the generation process and can be
              used to customize the output of the model.
            </p>
            <p className="leading-relaxed text-slate-700">
              These parameters can be passed to the OpenVINO Model Server using
              different approaches depending on your language:
            </p>
            <ul className="list-disc space-y-2 pl-6 text-slate-700">
              <li>
                <strong>Python:</strong> Use the{' '}
                <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-sm">
                  extra_body
                </code>{' '}
                parameter
              </li>
              <li>
                <strong>JavaScript/TypeScript:</strong> Pass parameters
                directly, but use{' '}
                <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-sm">
                  {`// @ts-expect-error`}
                </code>{' '}
                to avoid TypeScript errors
              </li>
            </ul>
            <p className="leading-relaxed text-slate-700">
              Here is an example showing how to use the{' '}
              <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-sm">
                top_k
              </code>{' '}
              parameter, which is exclusive to OpenVINO:
            </p>
            <CodeBlock
              title={'OpenVINO Completion API with exclusive parameters'}
              data={openvinoSnippet}
            />
            <p className="leading-relaxed text-slate-700">
              Please refer to the&nbsp;
              <span className="text-primary font-medium">Endpoints</span> tab
              for a list of available parameters.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
