// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import path from 'path'

const TEXT_GENERATION_PORT = 5001
const TEXT_TO_SPEECH_PORT = 5002
const EMBEDDING_PORT = 5003
const LIPSYNC_PORT = 5004
const SPEECH_TO_TEXT_PORT = 5005
const LOG_FILE_PATH = path.resolve(path.dirname(''), '../logs')
const UINT32_RANGE = 2 ** 32

// Whitelist of allowed ports for health checks - based on defined application ports
const ALLOWED_PORTS = [
  TEXT_GENERATION_PORT, // Text generation service port
  TEXT_TO_SPEECH_PORT, // Text to speech service port
  EMBEDDING_PORT, // Embedding service port
  LIPSYNC_PORT,
  SPEECH_TO_TEXT_PORT, // Speech to text service port
]

const WORKER_DIR = path.resolve(path.dirname(''), '../workers')

export {
  TEXT_GENERATION_PORT,
  TEXT_TO_SPEECH_PORT,
  SPEECH_TO_TEXT_PORT,
  EMBEDDING_PORT,
  LOG_FILE_PATH,
  UINT32_RANGE,
  ALLOWED_PORTS,
  WORKER_DIR,
  LIPSYNC_PORT,
}
