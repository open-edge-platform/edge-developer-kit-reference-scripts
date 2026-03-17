// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { NextConfig } from 'next'
import { withPayload } from '@payloadcms/next/withPayload'
import withBundleAnalyzer from '@next/bundle-analyzer'
import {
  LIPSYNC_PORT,
  EMBEDDING_PORT,
  SPEECH_TO_TEXT_PORT,
  TEXT_TO_SPEECH_PORT,
  IMAGE_GENERATION_PORT,
  SYNTHETIC_IMAGE_GENERATION_PORT,
  WAKE_WORD_DETECTION_PORT,
  TEXT_GENERATION_PORT,
} from '@/lib/constants'

const bundleAnalyzer = withBundleAnalyzer({
  enabled: process.env.ANALYZE === 'true',
})

const nextConfig: NextConfig = {
  devIndicators: false,
  output: 'standalone',
  outputFileTracingIncludes: {
    '/': ['./node_modules/@libsql/win32-x64-msvc/**/*'],
  },
  experimental: {
    proxyTimeout: 1000 * 120, // 120 seconds
  },
  webpack: (config) => {
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
        source: `/api/text-generation/:slug*`,
        destination: `http://localhost:${TEXT_GENERATION_PORT}/:slug*`,
      },
      {
        source: `/api/speech-to-text/:slug*`,
        destination: `http://localhost:${SPEECH_TO_TEXT_PORT}/:slug*`,
      },
      {
        source: `/api/embeddings/:slug*`,
        destination: `http://localhost:${EMBEDDING_PORT}/:slug*`,
      },
      {
        source: `/api/text-to-speech/:slug*`,
        destination: `http://localhost:${TEXT_TO_SPEECH_PORT}/:slug*`,
      },
      {
        source: `/api/lipsync/:slug*`,
        destination: `http://localhost:${LIPSYNC_PORT}/:slug*`,
      },
      {
        source: '/api/images/v1/:slug*',
        destination: `http://localhost:${IMAGE_GENERATION_PORT}/v3/images/:slug*`,
      },
      {
        source: '/api/synthetic-image-generation/:slug*',
        destination: `http://localhost:${SYNTHETIC_IMAGE_GENERATION_PORT}/:slug*`,
      },
      {
        source: '/api/wake-word-detection/:slug*',
        destination: `http://localhost:${WAKE_WORD_DETECTION_PORT}/:slug*`,
      },
    ]
  },
}

export default bundleAnalyzer(withPayload(nextConfig))
