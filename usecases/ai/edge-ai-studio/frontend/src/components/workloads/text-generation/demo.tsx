// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client'

import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import { useChat } from '@/hooks/use-chat'
import { Play, Zap } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

interface TextGenerationDemoProps {
  disabled?: boolean
  selectedModel: string
}

export default function TextGenerationDemo({
  disabled,
  selectedModel,
}: TextGenerationDemoProps) {
  const [prompt, setPrompt] = useState('')
  const [generatedText, setGeneratedText] = useState('')
  const chat = useChat()

  const handleGenerate = async () => {
    if (!prompt.trim()) {
      toast.error('Error', {
        description: 'Please enter a prompt',
      })
      return
    }

    chat
      .mutateAsync({ prompt, model: selectedModel })
      .then((response) => {
        if (response) {
          setGeneratedText(response.choices[0].message.content ?? ''.trim())
        } else {
          toast.error('Error', {
            description: 'Failed to generate text. Please try again.',
          })
        }
      })
      .catch((error) => {
        console.error('Text generation error:', error)
        toast.error('Error', {
          description:
            'An error occurred while generating text. Please try again.',
        })
      })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Play className="h-5 w-5" />
          Interactive Text Generation
        </CardTitle>
        <CardDescription>
          Try text generation with our edge-optimized model
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <label
            htmlFor="text-prompt"
            className="mb-2 block text-sm font-medium"
          >
            Enter your prompt:
          </label>
          <Textarea
            disabled={disabled || chat.isPending}
            id="text-prompt"
            placeholder="Write a story about a robot learning to paint..."
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            className="min-h-[100px]"
          />
        </div>

        <Button
          onClick={handleGenerate}
          disabled={disabled || chat.isPending}
          className="w-full"
        >
          {chat.isPending ? (
            <>
              <div className="mr-2 h-4 w-4 animate-spin rounded-full border-b-2 border-white" />
              Generating...
            </>
          ) : (
            <>
              <Zap className="mr-2 h-4 w-4" />
              Generate Text
            </>
          )}
        </Button>

        {generatedText && (
          <div className="mt-4">
            <div className="mb-2 flex items-center justify-between">
              <label htmlFor="generated-text" className="text-sm font-medium">
                Generated Text:
              </label>
            </div>
            <div className="rounded-lg border bg-slate-50 p-4">
              <p id="generated-text" className="text-slate-700">
                {generatedText}
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
