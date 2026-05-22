// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

export {
  usePptTranslatorParams,
  useTranslate,
  useTranslationStatus,
  useDownload,
  SUPPORTED_LANGUAGES,
} from '@/services/ppt-translator/hooks'

export type {
  PptTranslatorParamValues,
  SupportedLanguage,
  TranslatePayload,
  TranslateResult,
  TranslationJob,
} from '@/services/ppt-translator/hooks'
