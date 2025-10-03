// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import CodeBlock, { CodeSnippet } from '@/components/common/codeblock'

export default function SpeechToTextDocumentation({ port }: { port: number }) {
  const transcriptionAPISnippet: CodeSnippet[] = [
    {
      language: 'Python',
      languageCode: 'py',
      code: `import requests

# Transcribe audio to text
url = "http://localhost:${port}/v1/audio/transcriptions"
files = {"file": open("audio_file.wav", "rb")}
data = {
    "language": "en",
    "use_denoise": False
}

response = requests.post(url, files=files, data=data)
result = response.json()
print("Transcription:", result["text"])`,
    },
    {
      language: 'Javascript',
      languageCode: 'js',
      code: `import fs from 'fs'

// Transcribe audio to text
const audioBuffer = fs.readFileSync('audio_file.wav')
const formData = new FormData()
formData.append('file', new Blob([audioBuffer], { type: 'audio/wav' }), 'audio_file.wav')
formData.append('language', 'en')
formData.append('use_denoise', 'false')

const response = await fetch('http://localhost:${port}/v1/audio/transcriptions', {
  method: 'POST',
  body: formData,
})

const result = await response.json()
console.log('Transcription:', result.text)`,
    },
  ]

  const translationAPISnippet: CodeSnippet[] = [
    {
      language: 'Python',
      languageCode: 'py',
      code: `import requests

# Translate audio to English text
url = "http://localhost:${port}/v1/audio/translations"
files = {"file": open("non_english_audio.wav", "rb")}
data = {
    "language": "fr"  # Source language (French in this example)
}

response = requests.post(url, files=files, data=data)
result = response.json()
print("Translation:", result["text"])`,
    },
    {
      language: 'Javascript',
      languageCode: 'js',
      code: `import fs from 'fs'

// Translate audio to English text
const audioBuffer = fs.readFileSync('non_english_audio.wav')
const formData = new FormData()
formData.append('file', new Blob([audioBuffer], { type: 'audio/wav' }), 'non_english_audio.wav')
formData.append('language', 'fr')  // Source language (French in this example)

const response = await fetch('http://localhost:${port}/v1/audio/translations', {
  method: 'POST',
  body: formData,
})

const result = await response.json()
console.log('Translation:', result.text)`,
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
                  Speech-to-Text API
                </h1>
              </div>
            </div>
          </div>

          <div id="overview" className="prose flex max-w-none flex-col gap-4">
            {/* Speech-to-Text */}
            <p className="leading-relaxed text-slate-700">
              The Speech-to-Text service provides accurate transcription using
              OpenVINO-optimized Whisper models. It supports multiple audio
              formats and languages with optional noise suppression, enabling
              you to convert speech to text or translate speech to English
              directly on your edge device, without requiring an internet
              connection.
            </p>

            <p className="text-lg leading-relaxed font-semibold text-slate-700">
              Audio Transcription
            </p>
            <p className="leading-relaxed text-slate-700">
              The transcription endpoint converts speech to text in the same
              language as the input audio. Here&apos;s a simple example to
              transcribe audio files:
            </p>
            <CodeBlock
              title={'Transcribe audio to text'}
              data={transcriptionAPISnippet}
            />

            <p className="text-lg leading-relaxed font-semibold text-slate-700">
              Audio Translation
            </p>
            <p className="leading-relaxed text-slate-700">
              The translation endpoint converts speech in any supported language
              directly to English text. This is particularly useful for
              multilingual applications where you need consistent English output
              regardless of the input language:
            </p>
            <CodeBlock
              title={'Translate audio to English text'}
              data={translationAPISnippet}
            />

            <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
              <p className="text-sm text-blue-800">
                <strong>💡 Note:</strong> Translation converts speech in any
                supported language directly to English text, while transcription
                converts speech to text in the same language as the audio.
                Choose translation for multilingual applications requiring
                English output, or transcription for preserving the original
                language.
              </p>
            </div>

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
