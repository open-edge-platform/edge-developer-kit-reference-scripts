#!/usr/bin/env bash
# Copyright (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STUDIO_DIR="${DEMO_STUDIO_DIR:-"$SCRIPT_DIR/../../applications.ai.tools.edge-ai-studio"}"
STUDIO_FRONTEND_DIR="$STUDIO_DIR/frontend"
SOURCE_DEPLOYMENT="$SCRIPT_DIR/deployment.json"
TARGET_DEPLOYMENT="$STUDIO_DIR/deployment.json"

prepare_deployment() {
  if [[ ! -d "$STUDIO_FRONTEND_DIR" ]]; then
    printf 'Demo Studio frontend not found at %s\n' "$STUDIO_FRONTEND_DIR" >&2
    exit 1
  fi

  if [[ ! -f "$STUDIO_FRONTEND_DIR/db.sqlite" ]]; then
    printf 'Demo Studio database not found at %s\n' "$STUDIO_FRONTEND_DIR/db.sqlite" >&2
    exit 1
  fi

  if ! command -v node >/dev/null 2>&1; then
    printf 'Node.js is required to export the Demo Studio service configuration.\n' >&2
    exit 1
  fi

  (
    cd "$STUDIO_FRONTEND_DIR"
    node --input-type=module - "$SOURCE_DEPLOYMENT" <<'NODE'
import fs from 'node:fs'
import path from 'node:path'
import { createClient } from '@libsql/client'

const outputPath = process.argv[2]
const databasePath = path.resolve('db.sqlite')
const client = createClient({ url: `file:${databasePath}` })

try {
  const result = await client.execute(
    `SELECT type, models, port, metadata, engine
     FROM services
     WHERE status IN ('active', 'prepare', 'restart')
     ORDER BY type`,
  )

  if (result.rows.length === 0) {
    throw new Error('No Demo Studio services are currently configured to run.')
  }

  const services = Object.fromEntries(
    result.rows.map((row) => {
      const service = {
        status: 'online',
        engine: row.engine,
        ...(row.port === null ? {} : { port: Number(row.port) }),
        models: JSON.parse(row.models),
        ...(row.metadata === null ? {} : { metadata: JSON.parse(row.metadata) }),
      }

      return [row.type, service]
    }),
  )

  const deployment = {
    $schema: './docs/deployment.schema.json',
    services,
  }
  const temporaryPath = `${outputPath}.${process.pid}.tmp`

  fs.writeFileSync(temporaryPath, `${JSON.stringify(deployment, null, 2)}\n`)
  fs.renameSync(temporaryPath, outputPath)
  console.log(`Wrote ${Object.keys(services).length} service preset(s) to ${outputPath}`)
} finally {
  client.close()
}
NODE
  )

  cp "$SOURCE_DEPLOYMENT" "$TARGET_DEPLOYMENT"
  printf 'Copied deployment presets to %s\n' "$TARGET_DEPLOYMENT"
}

case "${1:-}" in
  --prepare-only)
    prepare_deployment
    exit 0
    ;;
  --help|-h)
    printf 'Usage: %s [--prepare-only] [next-dev-options]\n' "$(basename "$0")"
    exit 0
    ;;
esac

prepare_deployment
printf 'Demo Studio is configured but not started by this script.\n'
cd "$SCRIPT_DIR"
exec npm run dev -- "$@"