// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { VoiceInfo } from './types'

/**
 * Preset voices from the vendored vieneu/assets/voices_v3_turbo.json, grouped by accent with
 * upstream's default first; gender and style are translated from each preset's description.
 */
export const VIENEU_VOICES: VoiceInfo[] = [
  {
    id: 'Hải Đăng',
    label: 'Hải Đăng (male, natural)',
    language: 'Vietnamese (Northern)',
  },
  {
    id: 'Adam bựa',
    label: 'Adam bựa (male, natural)',
    language: 'Vietnamese (Northern)',
  },
  {
    id: 'Trúc Ly',
    label: 'Trúc Ly (female, natural)',
    language: 'Vietnamese (Northern)',
  },
  {
    id: 'Thiện Minh',
    label: 'Thiện Minh (male, storytelling)',
    language: 'Vietnamese (Northern)',
  },
  {
    id: 'Mai Anh',
    label: 'Mai Anh (female, news)',
    language: 'Vietnamese (Northern)',
  },
  {
    id: 'Thiền Tâm Đức',
    label: 'Thiền Tâm Đức (male, storytelling)',
    language: 'Vietnamese (Northern)',
  },
  {
    id: 'Ngọc Huyền',
    label: 'Ngọc Huyền (female, natural)',
    language: 'Vietnamese (Northern)',
  },
  {
    id: 'Minh Đức',
    label: 'Minh Đức (male, news)',
    language: 'Vietnamese (Northern)',
  },
  {
    id: 'Phạm Tuyên',
    label: 'Phạm Tuyên (male, natural)',
    language: 'Vietnamese (Northern)',
  },
  {
    id: 'Xuân Vĩnh',
    label: 'Xuân Vĩnh (male, natural)',
    language: 'Vietnamese (Northern)',
  },
  {
    id: 'Thanh Bình',
    label: 'Thanh Bình (male, storytelling)',
    language: 'Vietnamese (Northern)',
  },
  {
    id: 'Ngọc Linh',
    label: 'Ngọc Linh (female, storytelling)',
    language: 'Vietnamese (Northern)',
  },
  {
    id: 'Đoan Trang',
    label: 'Đoan Trang (female, natural)',
    language: 'Vietnamese (Northern)',
  },
  {
    id: 'Quỳnh Anh',
    label: 'Quỳnh Anh (female, story reading)',
    language: 'Vietnamese (Northern)',
  },
  {
    id: 'Quốc Tuấn',
    label: 'Quốc Tuấn (male, natural)',
    language: 'Vietnamese (Northern)',
  },
  {
    id: 'Thùy Dung',
    label: 'Thùy Dung (female, news)',
    language: 'Vietnamese (Southern)',
  },
  {
    id: 'Thái Sơn',
    label: 'Thái Sơn (male, storytelling)',
    language: 'Vietnamese (Southern)',
  },
  {
    id: 'Thục Đoan',
    label: 'Thục Đoan (female, storytelling)',
    language: 'Vietnamese (Southern)',
  },
  {
    id: 'Minh Triết',
    label: 'Minh Triết (male, news)',
    language: 'Vietnamese (Southern)',
  },
  {
    id: 'Mỹ Duyên',
    label: 'Mỹ Duyên (female, story reading)',
    language: 'Vietnamese (Southern)',
  },
  {
    id: 'Đức Trí',
    label: 'Đức Trí (male, story reading)',
    language: 'Vietnamese (Southern)',
  },
  {
    id: 'Kim Thanh',
    label: 'Kim Thanh (female, story reading)',
    language: 'Vietnamese (Southern)',
  },
  {
    id: 'Adam',
    label: 'Adam (male, natural)',
    language: 'Vietnamese (Southern)',
  },
  {
    id: 'Quang Sơn',
    label: 'Quang Sơn (male, natural)',
    language: 'Vietnamese (Central)',
  },
  {
    id: 'Ngọc Trân',
    label: 'Ngọc Trân (female, natural)',
    language: 'Vietnamese (Central)',
  },
]
