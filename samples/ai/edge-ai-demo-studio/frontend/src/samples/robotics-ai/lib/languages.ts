// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/**
 * The languages the robot can be spoken to in: the code transcription takes,
 * the name shown, and the name the agent is told to answer in.
 */
export const ROBOT_LANGUAGES = [
  { code: 'en', label: 'English', agentName: 'english' },
  { code: 'ms', label: 'Malay', agentName: 'malay' },
  { code: 'zh', label: 'Chinese', agentName: 'chinese' },
  { code: 'ja', label: 'Japanese', agentName: 'japanese' },
] as const

export type RobotLanguage = (typeof ROBOT_LANGUAGES)[number]['code']

export const DEFAULT_ROBOT_LANGUAGE: RobotLanguage = 'en'

function find(code: string) {
  return ROBOT_LANGUAGES.find((language) => language.code === code)
}

export function isRobotLanguage(code: string): code is RobotLanguage {
  return find(code) !== undefined
}

export function robotLanguageLabel(code: RobotLanguage): string {
  return find(code)?.label ?? 'English'
}

/** The language name the agent answers in, e.g. `chinese`. */
export function agentLanguageName(code: RobotLanguage): string {
  return find(code)?.agentName ?? 'english'
}
