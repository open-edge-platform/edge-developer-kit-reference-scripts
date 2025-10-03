// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import CodeBlock, { CodeSnippet } from '@/components/common/codeblock'

export default function TextToSpeechDocumentation({ port }: { port: number }) {
  const generateOpenAISnippet: CodeSnippet[] = [
    {
      language: 'Python',
      languageCode: 'py',
      code: `from pathlib import Path
from openai import OpenAI

client = OpenAI(base_url="http://localhost:${port}/v1", api_key="not-needed")
speech_file_path = Path(__file__).parent / "speech.mp3"

with client.audio.speech.with_streaming_response.create(
    model="kokoro",
    voice="af_heart",
    input="Today is a wonderful day to build something people love!",
) as response:
    response.stream_to_file(speech_file_path)
`,
    },
    {
      language: 'Javascript',
      languageCode: 'js',
      code: `import fs from "fs";
import path from "path";
import OpenAI from "openai";

const openai = new OpenAI({
  baseURL: 'http://localhost:${port}/v1',
  apiKey: 'not-needed',
});
const speechFile = path.resolve("./speech.mp3");

const mp3 = await openai.audio.speech.create({
  model: "kokoro",
  voice: "af_heart",
  input: "Today is a wonderful day to build something people love!",
});

const buffer = Buffer.from(await mp3.arrayBuffer());
await fs.promises.writeFile(speechFile, buffer);
`,
    },
  ]

  const streamingOpenAISnippet: CodeSnippet[] = [
    {
      language: 'Python',
      languageCode: 'py',
      code: `import asyncio
from openai import AsyncOpenAI
from openai.helpers import LocalAudioPlayer

openai = AsyncOpenAI(base_url="http://localhost:${port}/v1", api_key="not-needed")

async def main() -> None:
    async with openai.audio.speech.with_streaming_response.create(
        model="kokoro",
        voice="af_heart",
        input="Today is a wonderful day to build something people love!",
        response_format="pcm",
    ) as response:
        await LocalAudioPlayer().play(response)

if __name__ == "__main__":
    asyncio.run(main())
`,
    },
    {
      language: 'Javascript',
      languageCode: 'js',
      code: `import OpenAI from "openai";
import fs from "fs";
import { spawn } from "child_process";
import path from "path";

const openai = new OpenAI({
  baseURL: 'http://localhost:5002/v1',
  apiKey: 'not-needed',
});

const response = await openai.audio.speech.create({
  model: 'kokoro',
  voice: 'af_heart',
  input: 'Today is a wonderful day to build something people love!',
  response_format: 'wav',
});

const filePath = path.resolve('./speech.wav');
const buffer = Buffer.from(await response.arrayBuffer());
await fs.promises.writeFile(filePath, buffer);

// Play the audio using ffplay (make sure ffplay is installed)
const player = spawn('ffplay', ['-autoexit', filePath], { stdio: 'inherit' });
player.on('exit', () => {
  fs.promises.unlink(filePath); // Clean up the file after playing
});
`,
    },
  ]

  const voicesAPISnippet: CodeSnippet[] = [
    {
      language: 'Python',
      languageCode: 'py',
      code: `import requests

url = f"http://localhost:${port}/v1/audio/voices"
response = requests.get(url)
print(response.json())`,
    },
    {
      language: 'Javascript',
      languageCode: 'js',
      code: `const url = 'http://localhost:${port}/v1/audio/voices'
fetch(url)
  .then(res => res.json())
  .then(data => console.log(data))`,
    },
  ]

  const kokoroFastAPISnippet: CodeSnippet[] = [
    {
      language: 'Python',
      languageCode: 'py',
      code: `from pathlib import Path
from openai import OpenAI
import requests

base_url = "http://localhost:5002/v1"
client = OpenAI(base_url=base_url, api_key="not-needed")
speech_file_path = Path(__file__).parent / "speech.mp3"

with client.audio.speech.with_streaming_response.create(
    model="kokoro",
    voice="af_heart",
    input="Today is a wonderful day to build something people love!",
    extra_body={"stream": False, "return_download_link": True},
) as response:
    download_path = response.headers.get("x-download-path")
    download_url = base_url + download_path

    r = requests.get(download_url)
    with open(speech_file_path, "wb") as f:
        f.write(r.content)
`,
    },
    {
      language: 'Javascript',
      languageCode: 'js',
      code: `import fs from 'fs'
import path from 'path'
import OpenAI from 'openai'

const openai = new OpenAI({
  baseURL: 'http://localhost:5002/v1',
  apiKey: 'not-needed',
})
const speechFile = path.resolve('./speech.mp3')

const mp3 = await openai.audio.speech.create({
  model: 'kokoro',
  voice: 'af_heart',
  input: 'Today is a wonderful day to build something people love!',
  // @ts-expect-error --undocumented param
  stream: false,
  return_download_link: true,
})

const downloadPath = mp3.headers.get('x-download-path')
const downloadUrl = openai.baseURL + downloadPath

const response = await fetch(downloadUrl)
const buffer = Buffer.from(await response.arrayBuffer())
await fs.promises.writeFile(speechFile, buffer)
`,
    },
  ]

  return (
    <div className="grid gap-8 lg:grid-cols-4">
      <div className="lg:col-span-4">
        <div className="space-y-8">
          <div>
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h1 className="text-3xl font-bold text-slate-900">
                  Text-to-Speech API
                </h1>
              </div>
            </div>
          </div>

          <div id="overview" className="prose flex max-w-none flex-col gap-4">
            <p className="leading-relaxed text-slate-700">
              This text-to-speech service leverages the capabilities of the{' '}
              <a
                className="text-primary font-medium"
                target="_blank"
                href="https://github.com/remsky/Kokoro-FastAPI/tree/master"
              >
                Kokoro-FastAPI
              </a>
              , providing efficient and scalable speech synthesis with
              OpenAI-compatible endpoints. You can generate speech audio from
              text, list available voices, and stream audio using simple HTTP
              APIs. This service is not affiliated with OpenAI, but implements a
              compatible API for local and private deployment.
            </p>
            <p className="leading-relaxed text-slate-700">
              Here&apos;s a simple example to generate speech using the{' '}
              <a
                className="text-primary font-medium"
                target="_blank"
                href="https://platform.openai.com/docs/guides/text-to-speech"
              >
                OpenAI Library
              </a>
              .
            </p>
            <CodeBlock
              title="Generate spoken audio from input text"
              data={generateOpenAISnippet}
            />

            <p className="leading-relaxed text-slate-700">
              This API supports streaming audio output for real-time playback or
              file writing.
            </p>
            <CodeBlock
              title="Stream spoken audio from input text directly to your speakers"
              data={streamingOpenAISnippet}
            />

            <p className="text-lg leading-relaxed font-semibold text-slate-700">
              Voice options
            </p>
            <p className="leading-relaxed text-slate-700">
              Use the{' '}
              <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-sm">
                /v1/audio/voices
              </code>{' '}
              endpoint to list all available voices for speech synthesis.
            </p>
            <CodeBlock title={'List Voices Example'} data={voicesAPISnippet} />

            <p className="text-lg leading-relaxed font-semibold text-slate-700">
              Kokoro-FastAPI specific parameters
            </p>
            <p className="leading-relaxed text-slate-700">
              There are a few parameters that are only available in
              Kokoro-FastAPI, which are not available in the OpenAI API. These
              parameters are used to control the generation process and can be
              used to customize the output of the model.
            </p>
            <p className="leading-relaxed text-slate-700">
              These parameters can be passed to the Kokoro-FastAPI Server using
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
                stream
              </code>{' '}
              and{' '}
              <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-sm">
                return_download_link
              </code>{' '}
              parameter, which is exclusive to Kokoro-FastAPI:
            </p>
            <CodeBlock
              title={'Kokoro-FastAPI Speech API with exclusive parameters'}
              data={kokoroFastAPISnippet}
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
