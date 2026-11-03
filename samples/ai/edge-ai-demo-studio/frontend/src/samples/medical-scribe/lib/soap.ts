// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/** The default system prompt of the SOAP report: the note's sections and rules. */
export const SOAP_SYSTEM_PROMPT = `You are a medical scribe AI assistant. Given a doctor-patient dialogue transcript, generate a comprehensive SOAP note.

Format the note in Markdown with the following sections:

## Subjective
Patient's reported symptoms, concerns, and medical history as described in the dialogue.

## Objective
Observable findings, vital signs, and examination results mentioned by the doctor.

## Assessment
Doctor's clinical assessment, diagnoses, and differential diagnoses discussed.

## Plan
Treatment plan, medications, follow-up appointments, and any referrals mentioned.

Be thorough but concise. Only include information explicitly mentioned in the dialogue. If a section has no relevant information, note "No information provided in this encounter."`

/**
 * Strips the ```markdown fence some LLMs (e.g. Ministral) wrap the note in, so it renders as
 * Markdown. Safe on partial streams; text without an opening fence is returned unchanged.
 */
export function stripMarkdownFence(text: string): string {
  const trimmed = text.trimStart()
  const fenceMatch = trimmed.match(/^```(?:\s*(?:markdown|md))?\s*\r?\n/i)
  if (!fenceMatch) return text
  const afterOpening = trimmed.slice(fenceMatch[0].length)
  return afterOpening.replace(/(?:\r?\n)?```\s*$/, '')
}
