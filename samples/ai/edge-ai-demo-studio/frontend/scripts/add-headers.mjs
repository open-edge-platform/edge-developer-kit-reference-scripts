#!/usr/bin/env node
/* eslint-disable no-console */
// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import fs from 'node:fs'
import path from 'node:path'

const header =
  '// Copyright (C) 2026 Intel Corporation\n// SPDX-License-Identifier: Apache-2.0\n\n'

function walk(dir) {
  let results = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      results = results.concat(walk(full))
    } else if (/\.(ts|tsx|mjs)$/.test(entry.name)) {
      results.push(full)
    }
  }
  return results
}

const srcFiles = walk(path.join('.', 'src'))
const scriptFiles = walk(path.join('.', 'scripts')).filter(
  (f) => !f.includes('add-headers'),
)
const rootFiles = ['next.config.ts'].filter((f) => fs.existsSync(f))
const allFiles = [...srcFiles, ...scriptFiles, ...rootFiles]

const skip = (f) => {
  const rel = f.replace(/\\/g, '/')
  if (rel.includes('_generated/')) return true
  if (rel.includes('payload-types.ts')) return true
  if (rel.includes('/migrations/')) return true
  if (rel.includes('next-env.d.ts')) return true
  return false
}

const added = []
const alreadyHas = []
const skipped = []
const fixed = []

for (const file of allFiles) {
  if (skip(file)) {
    skipped.push(file)
    continue
  }
  const content = fs.readFileSync(file, 'utf8')
  if (content.startsWith('// Copyright (C) 2026 Intel Corporation')) {
    alreadyHas.push(file)
    continue
  }
  // Header exists but not at top (misplaced)
  if (content.includes('// Copyright (C) 2026 Intel Corporation')) {
    const cleaned = content.replace(
      /\/\/ Copyright \(C\) 2026 Intel Corporation\n\/\/ SPDX-License-Identifier: Apache-2\.0\n\n?/g,
      '',
    )
    fs.writeFileSync(file, header + cleaned)
    fixed.push(file)
    continue
  }
  fs.writeFileSync(file, header + content)
  added.push(file)
}

console.log(`=== ADDED (${added.length}) ===`)
for (const f of added) console.log(`  ${f}`)
console.log(`=== FIXED (${fixed.length}) ===`)
for (const f of fixed) console.log(`  ${f}`)
console.log(`=== ALREADY HAD (${alreadyHas.length}) ===`)
for (const f of alreadyHas) console.log(`  ${f}`)
console.log(`=== SKIPPED (${skipped.length}) ===`)
for (const f of skipped) console.log(`  ${f}`)
