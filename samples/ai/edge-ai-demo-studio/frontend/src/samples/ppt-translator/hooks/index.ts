// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

export {
  usePptTranslatorParams,
  SUPPORTED_LANGUAGES,
} from '@/services/ppt-translator/hooks/use-params'
export { useTranslate } from '@/services/ppt-translator/hooks/use-translate'
export { useTranslationStatus } from '@/services/ppt-translator/hooks/use-translation-status'
export { useDownload } from '@/services/ppt-translator/hooks/use-download'

export type { PptTranslatorParamValues } from '@/services/ppt-translator/hooks/use-params'
export type {
  TranslatePayload,
  TranslateResult,
} from '@/services/ppt-translator/hooks/use-translate'
export type { TranslationJob } from '@/services/ppt-translator/hooks/use-translation-status'
