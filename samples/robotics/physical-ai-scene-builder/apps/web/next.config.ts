// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import path from 'node:path';

import type { NextConfig } from 'next';
import { withPayload } from '@payloadcms/next/withPayload';

const nextConfig: NextConfig = {
  // Lets a second build live in its own directory without replacing the normal production build.
  distDir: process.env.ROBOTIC_STUDIO_NEXT_DIST_DIR?.trim() || '.next',
  output: 'standalone',
  // The root AGENTS.md already points agents at node_modules/next/dist/docs; don't let `next dev`
  // generate apps/web/AGENTS.md and CLAUDE.md when it detects a coding agent.
  agentRules: false,
  outputFileTracingRoot: path.join(__dirname, '../..'),
  outputFileTracingIncludes: {
    '/*': [
      '../../payload/src/**/*',
      '../../samples/so101-environment/**/*',
      './migrations/**/*',
      './scripts/**/*',
    ],
  },
  // Workspace packages ship TypeScript sources rather than a build artifact.
  transpilePackages: [
    '@mujoco-studio/mujoco',
    '@mujoco-studio/scene',
    '@mujoco-studio/types',
    '@mujoco-studio/ui',
  ],
};

export default withPayload(nextConfig, { devBundleServerPackages: false });
