// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { BundledLanguage } from 'shiki/bundle/web'

export interface CodeSnippet {
  language: string
  languageCode: BundledLanguage
  code: string
}
