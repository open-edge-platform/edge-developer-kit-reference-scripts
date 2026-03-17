// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import CodeBlock from '@/components/common/codeblock'
import { CodeSnippet } from '@/types/code'

export default function WakeWordDetectionDocumentation({
  port,
}: {
  port: number
}) {
  const subscribeWebhookSnippet: CodeSnippet[] = [
    {
      language: 'Python',
      languageCode: 'py',
      code: `import requests

response = requests.post(
    f"http://localhost:${port}/v1/wake-word-detection/webhooks/subscribe",
    json={
        "url": "https://your-server.com/webhook",
        "name": "My Webhook",
        "threshold": 0.6,
        "api_key": "your-optional-api-key"
    }
)
print(response.json())`,
    },
    {
      language: 'Javascript',
      languageCode: 'js',
      code: `const response = await fetch(
  'http://localhost:${port}/v1/wake-word-detection/webhooks/subscribe',
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: 'https://your-server.com/webhook',
      name: 'My Webhook',
      threshold: 0.6,
      api_key: 'your-optional-api-key'
    })
  }
)
const data = await response.json()
console.log(data)`,
    },
  ]

  const startDetectionSnippet: CodeSnippet[] = [
    {
      language: 'Python',
      languageCode: 'py',
      code: `import requests

# Start detection
response = requests.post(
    f"http://localhost:${port}/v1/wake-word-detection/start"
)
print(response.json())

# Stop detection
response = requests.post(
    f"http://localhost:${port}/v1/wake-word-detection/stop"
)
print(response.json())`,
    },
    {
      language: 'Javascript',
      languageCode: 'js',
      code: `// Start detection
const startResponse = await fetch(
  'http://localhost:${port}/v1/wake-word-detection/start',
  { method: 'POST' }
)
const startData = await startResponse.json()
console.log(startData)

// Stop detection
const stopResponse = await fetch(
  'http://localhost:${port}/v1/wake-word-detection/stop',
  { method: 'POST' }
)
const stopData = await stopResponse.json()
console.log(stopData)`,
    },
  ]

  const webhookReceiverSnippet: CodeSnippet[] = [
    {
      language: 'Python',
      languageCode: 'py',
      code: `from fastapi import FastAPI, Request

app = FastAPI()

@app.post("/webhook")
async def receive_detection(request: Request):
    data = await request.json()
    
    # Detection data structure:
    # {
    #   "event": "wake_word_detected",
    #   "model": "hey_jarvis_v0.1",
    #   "score": 0.717,
    #   "timestamp": "2025-11-28T10:30:00.123456",
    #   "message": "Wake word detected!"
    # }
    
    print(f"Wake word detected: {data['model']}")
    print(f"Confidence: {data['score']}")
    
    return {"success": True}`,
    },
    {
      language: 'Javascript',
      languageCode: 'js',
      code: `import express from 'express'

const app = express()
app.use(express.json())

app.post('/webhook', (req, res) => {
  const data = req.body
  
  // Detection data structure:
  // {
  //   event: 'wake_word_detected',
  //   model: 'hey_jarvis_v0.1',
  //   score: 0.717,
  //   timestamp: '2025-11-28T10:30:00.123456',
  //   message: 'Wake word detected!'
  // }
  
  console.log('Wake word detected:', data.model)
  console.log('Confidence:', data.score)
  
  res.json({ success: true })
})

app.listen(3000)`,
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
                  Wake Word Detection API
                </h1>
              </div>
            </div>
          </div>

          <div id="overview" className="prose flex max-w-none flex-col gap-4">
            {/* Wake Word Detection */}
            <p className="leading-relaxed text-slate-700">
              This wake word detection service uses&nbsp;
              <a
                className="text-primary font-medium"
                target="_blank"
                href="https://github.com/dscripka/openWakeWord"
              >
                openWakeWord
              </a>
              &nbsp;to detect wake words in real-time from the server&apos;s
              microphone. When a wake word is detected, the service sends a
              webhook notification to all registered subscribers with detection
              details including the model name, confidence score, and timestamp.
            </p>

            <p className="text-lg leading-relaxed font-semibold text-slate-700">
              How it works
            </p>
            <ol className="list-decimal space-y-2 pl-6 text-slate-700">
              <li>
                <strong>Subscribe to webhooks:</strong> Register your endpoint
                to receive detection notifications
              </li>
              <li>
                <strong>Start detection:</strong> Begin listening for wake words
                on the server&apos;s microphone
              </li>
              <li>
                <strong>Receive events:</strong> Your webhook will be called
                when wake words are detected
              </li>
              <li>
                <strong>Stop detection:</strong> Stop listening when you&apos;re
                done
              </li>
            </ol>

            <p className="text-lg leading-relaxed font-semibold text-slate-700">
              Step 1: Subscribe to webhooks
            </p>
            <p className="leading-relaxed text-slate-700">
              Register your endpoint to receive wake word detection
              notifications. You can optionally set a custom threshold (0.0-1.0)
              and provide an API key for authentication.
            </p>
            <CodeBlock
              title={'Subscribe to wake word detection webhooks'}
              data={subscribeWebhookSnippet}
            />

            <p className="text-lg leading-relaxed font-semibold text-slate-700">
              Step 2: Start/Stop detection
            </p>
            <p className="leading-relaxed text-slate-700">
              Control the wake word detection service. Detection must be started
              after subscribing to receive notifications.
            </p>
            <CodeBlock
              title={'Control detection service'}
              data={startDetectionSnippet}
            />

            <p className="text-lg leading-relaxed font-semibold text-slate-700">
              Step 3: Receive webhook notifications
            </p>
            <p className="leading-relaxed text-slate-700">
              When a wake word is detected, your endpoint will receive a POST
              request with the detection details. Here&apos;s an example of how
              to handle incoming webhooks:
            </p>
            <CodeBlock
              title={'Handle wake word detection webhooks'}
              data={webhookReceiverSnippet}
            />

            <p className="text-lg leading-relaxed font-semibold text-slate-700">
              Available models
            </p>
            <p className="leading-relaxed text-slate-700">
              The service includes several pre-trained wake word models:
            </p>
            <ul className="list-disc space-y-2 pl-6 text-slate-700">
              <li>
                <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-sm">
                  hey_jarvis_v0.1
                </code>{' '}
                - Responds to &quot;Hey Jarvis&quot;
              </li>
              <li>
                <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-sm">
                  alexa_v0.1
                </code>{' '}
                - Responds to &quot;Alexa&quot;
              </li>
              <li>
                <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-sm">
                  hey_mycroft_v0.1
                </code>{' '}
                - Responds to &quot;Hey Mycroft&quot;
              </li>
              <li>
                <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-sm">
                  hey_rhasspy_v0.1
                </code>{' '}
                - Responds to &quot;Hey Rhasspy&quot;
              </li>
              <li>
                <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-sm">
                  timer_v0.1
                </code>{' '}
                - Responds to &quot;Timer&quot;
              </li>
              <li>
                <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-sm">
                  weather_v0.1
                </code>{' '}
                - Responds to &quot;Weather&quot;
              </li>
            </ul>
            <p className="leading-relaxed text-slate-700">
              Models are automatically downloaded when first used. You can also
              upload custom ONNX wake word models through the UI or API.
            </p>

            <p className="leading-relaxed text-slate-700">
              For more details on available endpoints and parameters, refer to
              the&nbsp;
              <span className="text-primary font-medium">Endpoints</span> tab.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
