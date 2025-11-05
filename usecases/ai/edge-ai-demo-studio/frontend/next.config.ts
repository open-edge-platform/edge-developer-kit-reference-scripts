// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { NextConfig } from 'next'
import { withPayload } from '@payloadcms/next/withPayload'
import {
  LIPSYNC_PORT,
  EMBEDDING_PORT,
  SPEECH_TO_TEXT_PORT,
  TEXT_TO_SPEECH_PORT,
  IMAGE_GENERATION_PORT,
} from '@/lib/constants'

const nextConfig: NextConfig = {
  devIndicators: false,
  output: 'standalone',
  serverExternalPackages: ['openvino-node'],
  outputFileTracingIncludes: {
    '/': ['./node_modules/@libsql/win32-x64-msvc/**/*'],
  },
  experimental: {
    proxyTimeout: 1000 * 120, // 120 seconds
  },
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.externals = [
        ...config.externals,
        { 'openvino-node': 'commonjs openvino-node' },
      ]
    }
    return config
  },
  async redirects() {
    return [
      {
        source: '/',
        destination: '/text-generation',
        permanent: false,
      },
    ]
  },
  async rewrites() {
    return [
      {
        source: '/api/stt/v1/:slug*',
        destination: `http://localhost:${SPEECH_TO_TEXT_PORT}/v1/:slug*`,
      },
      {
        source: '/api/embeddings/v1/:slug*',
        destination: `http://localhost:${EMBEDDING_PORT}/v1/:slug*`,
      },
      {
        source: '/api/tts/v1/:slug*',
        destination: `http://localhost:${TEXT_TO_SPEECH_PORT}/v1/:slug*`,
      },
      {
        source: '/api/lipsync/:slug*',
        destination: `http://localhost:${LIPSYNC_PORT}/:slug*`,
      },
      {
        source: '/api/images/v1/:slug*',
        destination: `http://localhost:${IMAGE_GENERATION_PORT}/v3/images/:slug*`,
      },
    ]
  },
}

export default withPayload(nextConfig)
