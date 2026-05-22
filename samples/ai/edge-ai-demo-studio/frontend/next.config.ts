// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import withBundleAnalyzer from '@next/bundle-analyzer'
import { withPayload } from '@payloadcms/next/withPayload'
import type { NextConfig } from 'next'
import { getServicesPortMap } from './src/services/config-registry'

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
}

export default bundleAnalyzer(withPayload(nextConfig))
