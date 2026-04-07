// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import path from 'path'

const FRONTEND_PORT = Number(process.env.PORT) || 8080
const TEXT_GENERATION_PORT = 5000 //reserve 5001-5002 for multiserve service ports
const EMBEDDING_PORT = 5004 //reserve 5003-5004 for multiserve service ports
const TEXT_TO_SPEECH_PORT = 5010 //Start from 5010 for non multiserve ports
const LIPSYNC_PORT = 5011
const SPEECH_TO_TEXT_PORT = 5012
const IMAGE_GENERATION_PORT = 5013
const WAKE_WORD_DETECTION_PORT = 5014
const SYNTHETIC_IMAGE_GENERATION_PORT = 5015

const LOG_FILE_PATH = path.resolve(path.dirname(''), '../logs')
const MULTISERVE_MODELS_DIR_PATH = path.resolve(
  path.dirname(''),
  '../models/multiserve',
)
const MULTISERVE_REPO_PATH = path.resolve(
  path.dirname(''),
  '../workers/engine/multiserve',
)
const UV_PATH = path.resolve(
  path.dirname(''),
  `../workers/thirdparty/uv/${process.platform === 'win32' ? 'uv.exe' : 'uv'}`,
) // Path to UV executable
const UINT32_RANGE = 2 ** 32

// Whitelist of allowed ports for health checks - based on defined application ports
const ALLOWED_PORTS = [
  TEXT_GENERATION_PORT,
  TEXT_TO_SPEECH_PORT,
  EMBEDDING_PORT,
  LIPSYNC_PORT,
  SPEECH_TO_TEXT_PORT,
  IMAGE_GENERATION_PORT,
  WAKE_WORD_DETECTION_PORT,
  SYNTHETIC_IMAGE_GENERATION_PORT,
]

const WORKER_DIR = path.resolve(path.dirname(''), '../workers')

export {
  FRONTEND_PORT,
  TEXT_GENERATION_PORT,
  TEXT_TO_SPEECH_PORT,
  SPEECH_TO_TEXT_PORT,
  EMBEDDING_PORT,
  LOG_FILE_PATH,
  UINT32_RANGE,
  ALLOWED_PORTS,
  WORKER_DIR,
  LIPSYNC_PORT,
  IMAGE_GENERATION_PORT,
  MULTISERVE_REPO_PATH,
  MULTISERVE_MODELS_DIR_PATH,
  WAKE_WORD_DETECTION_PORT,
  SYNTHETIC_IMAGE_GENERATION_PORT,
  UV_PATH,
}
