// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import withBundleAnalyzer from '@next/bundle-analyzer'
import { withPayload } from '@payloadcms/next/withPayload'
import type { NextConfig } from 'next'
// Plain generated data: next.config.ts is transpiled without the `@/` alias,
// so it must not load the service registry itself.
import { proxiedServiceTypes } from './src/services/_generated/proxied-services'

const bundleAnalyzer = withBundleAnalyzer({
  enabled: process.env.ANALYZE === 'true',
})

const nextConfig: NextConfig = {
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
  // `next dev` trusts only `localhost` for HMR and dev assets; the app is
  // opened at 127.0.0.1.
  allowedDevOrigins: [
    '127.0.0.1',
    ...(process.env.NEXT_DEV_ORIGIN ? [process.env.NEXT_DEV_ORIGIN] : []),
  ],
  async rewrites() {
    return [
      // Service ports are allocated at start, so worker traffic goes through the instance proxy
      // route, which looks the port up: /api/<type>@<id>/*. A bare /api/<type>/* gets a 404 listing
      // the real addresses. `_draft` is a type's row-less draft engine (DRAFT_ENGINE_INSTANCE_ID).
      {
        source: '/api/:type([a-z0-9-]+)@:instance(_draft|[a-z0-9-]+)/:path*',
        destination: '/api/instance-proxy/:type@:instance/:path*',
      },
      ...proxiedServiceTypes.map((name) => ({
        source: `/api/${name}/:path*`,
        destination: `/api/instance-proxy/${name}/:path*`,
      })),
    ]
  },
  // No `proxyTimeout`: it only bounds rewrites to external URLs; the instance proxy route applies
  // the saved proxy timeout itself.
  experimental: {
    proxyClientMaxBodySize: 500 * 1024 * 1024,
  },
}

export default bundleAnalyzer(withPayload(nextConfig))
