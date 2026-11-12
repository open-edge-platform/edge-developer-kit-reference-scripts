// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

// THIS FILE IS AUTO-GENERATED. DO NOT EDIT MANUALLY.
// Source of truth: scripts/generate-registries.mjs
// Run "npm run codegen" to regenerate.

/** Service types whose worker traffic is proxied through `/api/<type>/*`:
 *  every type whose `execution.mode` is not `'none'`. Plain data, so
 *  next.config.ts can read it without loading the service registry. */
export const proxiedServiceTypes: readonly string[] = [
  'diarization',
  'embeddings',
  'exam-marking-agent',
  'exam-marking-database',
  'face-recognition',
  'file-watcher',
  'frame-generation',
  'geti-classifier',
  'image-based-video-search',
  'image-generation',
  'lipsync',
  'loss-prevention',
  'medical-scribe-database',
  'ocr',
  'pallet-defect-detection',
  'ppt-translator',
  'rerank',
  'robotics-ai',
  'speech-to-text',
  'synthetic-image-generation',
  'text-generation',
  'text-to-speech',
  'vectordb',
  'wake-word-detection',
]
