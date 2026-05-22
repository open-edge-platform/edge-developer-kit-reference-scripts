// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

export {
  type TextGenerationParams,
  useTextGenerationParams,
} from './use-text-generation-params'
export { type TtsParams, useTtsParams } from './use-tts-params'
export { useOptionalServiceGroup } from './use-optional-service-group'
export { useMcpParams } from './use-mcp-params'
// Re-export from services/common/hooks for backward compatibility
export { useSttRecording } from '@/services/common/hooks/use-stt-recording'
export { useTtsPlayback } from '@/services/common/hooks/use-tts-playback'
export { useWakeWordTrigger } from './use-wake-word-trigger'
export { useRagParams } from './use-rag-params'
export { useRagChatSetup } from './use-rag-chat-setup'
export { useWakeWordStt } from './use-wake-word-stt'
export { useSentenceSpeech } from './use-sentence-speech'
