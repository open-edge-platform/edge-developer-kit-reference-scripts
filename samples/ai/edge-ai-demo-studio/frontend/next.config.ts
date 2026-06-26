// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import withBundleAnalyzer from '@next/bundle-analyzer'
import { withPayload } from '@payloadcms/next/withPayload'
import { logger } from './src/lib/logger'
import type { NextConfig } from 'next'
import Database from 'libsql'
import path from 'node:path'
import { getServicesPortMap } from './src/services/config-registry'

const proxyTimeoutSetting = () => {
  const dbPath = path.resolve(process.cwd(), 'db.sqlite')
  const db = new Database(dbPath)

  try {
    const row = db
      .prepare('SELECT proxy_timeout FROM app_settings LIMIT 1')
      .get() as { proxy_timeout?: number } | undefined
    return row?.proxy_timeout ?? 30
  } catch (error) {
    logger.warn(
      '[next.config.ts] proxyTimeout read skipped: ',
      error instanceof Error ? error.message : String(error),
    )
    return 30
  } finally {
    db.close()
  }
}

const bundleAnalyzer = withBundleAnalyzer({
  enabled: process.env.ANALYZE === 'true',
})

const nextConfig: NextConfig = {
  /* config options here */
  output: 'standalone',
  outputFileTracingExcludes: {
    '/*': [
      './test-results/**',
      './playwright-report/**',
      './db.sqlite',
      './tests/**',
      './scripts/**',
      // musl/Alpine Linux binaries — not needed on standard glibc Linux
      './node_modules/@img/sharp-libvips-linuxmusl-x64/**',
      './node_modules/@img/sharp-linuxmusl-x64/**',
      './node_modules/@libsql/linux-x64-musl/**',
    ],
  },
  outputFileTracingIncludes: {
    '/*': [
      './node_modules/@img/sharp-win32-x64/lib/**',
      './node_modules/@img/sharp-libvips-win32-x64/lib/**',
    ],
  },
  reactCompiler: true,
  allowedDevOrigins: [],
  async rewrites() {
    return [
      ...Object.entries(getServicesPortMap()).map(([name, port]) => ({
        source: `/api/${name}/:path*`,
        destination: `http://localhost:${port}/:path*`,
      })),
    ]
  },
  experimental: {
    proxyTimeout: 1000 * proxyTimeoutSetting(),
    proxyClientMaxBodySize: 500 * 1024 * 1024,
  },
}

export default bundleAnalyzer(withPayload(nextConfig))
