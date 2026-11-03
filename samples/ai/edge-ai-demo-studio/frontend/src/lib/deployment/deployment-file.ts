// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import fs from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { REPO_ROOT } from '@/lib/constants'
import {
  type DeploymentConfig,
  deploymentConfigSchema,
} from '@/lib/deployment/deployment-schema'
import { logger } from '@/lib/logger'

const DEPLOYMENT_FILE_NAME = 'deployment.json'

/** First match wins: `DEPLOYMENT_CONFIG_PATH`, the repository root, then `frontend/`. */
function candidatePaths(): string[] {
  const fromEnv = process.env.DEPLOYMENT_CONFIG_PATH
  return [
    ...(fromEnv ? [path.resolve(fromEnv)] : []),
    path.join(REPO_ROOT, DEPLOYMENT_FILE_NAME),
    path.resolve(process.cwd(), DEPLOYMENT_FILE_NAME),
  ]
}

/** The file in use, parsed and validated; null when absent or invalid (logged, whole file ignored). */
export function loadDeploymentConfig(): {
  config: DeploymentConfig
  filePath: string
} | null {
  const filePath = candidatePaths().find((p) => fs.existsSync(p))
  if (!filePath) return null

  let raw: unknown
  try {
    raw = JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch (error) {
    logger.error(
      `deployment.json at ${filePath} is not valid JSON — ignoring it:`,
      error,
    )
    return null
  }

  const parsed = deploymentConfigSchema.safeParse(raw)
  if (!parsed.success) {
    logger.error(
      `deployment.json at ${filePath} failed validation — ignoring it:\n` +
        z.prettifyError(parsed.error),
    )
    return null
  }

  return { config: parsed.data, filePath }
}

/** Where "save" writes: the file currently in use, else the first candidate location. */
export function getDeploymentConfigWritePath(): string {
  const candidates = candidatePaths()
  return candidates.find((p) => fs.existsSync(p)) ?? candidates[0]
}

export function writeDeploymentConfig(
  config: DeploymentConfig,
  filePath: string,
): void {
  deploymentConfigSchema.parse(config)
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
  logger.log(`🛠️  Saved current service configuration to ${filePath}`)
}
