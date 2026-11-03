// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import fs from 'node:fs'
import path from 'node:path'
import type { Payload } from 'payload'

/**
 * Seed the SQLite registry from data/citizens.csv on first init. Idempotent
 * per collection: each seeder is skipped once its collection holds rows.
 * A seeded patient's date of birth and hospital record are derived from
 * their key and ID number, so demo runs are reproducible.
 *
 * SYNTHETIC DATA FOR DEMO ONLY.
 */

type CsvCitizen = {
  citizenKey: number
  citizenId: string
  name: string
  country: 'Malaysia' | 'Vietnam'
  age: number
  phone: string
  email: string
  addressLine: string
  city: string
  postcode: string
  notes: string
}

const CSV_PATH = process.env.KIOSK_CITIZENS_CSV ?? path.join(process.cwd(), 'data', 'citizens.csv')

function parseCsv(): CsvCitizen[] {
  const raw = fs.readFileSync(CSV_PATH, 'utf8')
  const [, ...rows] = raw.trim().split(/\r?\n/)
  return rows.map((row) => {
    const c = row.split(',')
    return {
      citizenKey: Number(c[0]),
      citizenId: c[1],
      name: c[2],
      country: c[3] as CsvCitizen['country'],
      age: Number(c[4]),
      phone: c[5],
      email: c[6],
      addressLine: c[7],
      city: c[8],
      postcode: c[9],
      notes: c[10],
    }
  })
}

async function seedCitizens(payload: Payload): Promise<Map<number, number>> {
  const keyToDbId = new Map<number, number>()
  const existing = await payload.find({ collection: 'citizens', limit: 200, depth: 0 })
  if (existing.totalDocs > 0) {
    for (const doc of existing.docs) keyToDbId.set(doc.citizenKey as number, doc.id as number)
    return keyToDbId
  }

  const citizens = parseCsv()
  payload.logger.info(`Seeding ${citizens.length} synthetic patients into db.sqlite…`)

  for (const c of citizens) {
    const doc = await payload.create({
      collection: 'citizens',
      data: {
        citizenKey: c.citizenKey,
        citizenId: c.citizenId,
        name: c.name,
        country: c.country,
        age: c.age,
        phone: c.phone,
        email: c.email,
        address: { line: c.addressLine, city: c.city, postcode: c.postcode },
        notes: c.notes,
      },
    })
    keyToDbId.set(c.citizenKey, doc.id as number)
  }
  payload.logger.info('Patient registry seed complete.')
  return keyToDbId
}

/**
 * Reference portraits for the face check, seeded from data/faces/. Files are
 * taken in filename order and attached to citizenKey 1, 2, 3… so the mapping
 * is reproducible: the same photo always lands on the same synthetic citizen.
 *
 * Nothing ships in data/faces/ — no portrait of a real person is seeded on the
 * user's behalf. Out of the box every citizen starts without one and the face
 * check has nothing to match against, which is the path a demo should walk
 * into by default. Drop your own images in to change that.
 */
const FACES_DIR = process.env.KIOSK_FACES_SEED_DIR ?? path.join(process.cwd(), 'data', 'faces')

const FACE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp'])

async function seedFacePhotos(payload: Payload, keyToDbId: Map<number, number>): Promise<void> {
  const { totalDocs } = await payload.count({ collection: 'face-photos' })
  if (totalDocs > 0) return
  if (!fs.existsSync(FACES_DIR)) {
    payload.logger.info(`No face photos at ${FACES_DIR} — every citizen starts without one.`)
    return
  }

  const files = fs
    .readdirSync(FACES_DIR)
    .filter((name) => FACE_EXTENSIONS.has(path.extname(name).toLowerCase()))
    .sort()
  if (files.length === 0) return

  payload.logger.info(
    `Enrolling ${files.length} reference portraits from ${FACES_DIR}; ` +
      'every other citizen starts without one.',
  )
  for (const [index, file] of files.entries()) {
    const citizenKey = index + 1
    const citizenDbId = keyToDbId.get(citizenKey)
    // More photos than citizens: the extras have nobody to belong to.
    if (citizenDbId === undefined) break

    const citizen = await payload.findByID({ collection: 'citizens', id: citizenDbId, depth: 0 })
    const photo = await payload.create({
      collection: 'face-photos',
      data: { alt: `Reference portrait — ${citizen.name}` },
      filePath: path.join(FACES_DIR, file),
    })
    await payload.update({
      collection: 'citizens',
      id: citizenDbId,
      data: { faceImage: photo.id as number },
    })
    payload.logger.info(`  ${file} -> ${citizen.name} (citizenKey ${citizenKey})`)
  }
  payload.logger.info('Face photo seed complete.')
}

/**
 * The configured admin login follows config.yaml: the account is created on
 * the first start, and its password is set to the configured one on every
 * start after that — so a password changed in config.yaml (the settings
 * page, or the file) is the login as soon as the kiosk restarts. The reverse
 * holds too: a password changed inside /admin lasts until the next start.
 * Other accounts made in the admin are never touched.
 */
async function seedAdminUser(payload: Payload): Promise<void> {
  const email = process.env.PAYLOAD_ADMIN_EMAIL
  const password = process.env.PAYLOAD_ADMIN_PASSWORD
  if (!email || !password) {
    const { totalDocs } = await payload.count({ collection: 'users' })
    if (totalDocs === 0) {
      payload.logger.warn(
        'No admin user seeded — set cms.admin_email and cms.admin_password in config.yaml.',
      )
    }
    return
  }
  const { docs } = await payload.find({
    collection: 'users',
    where: { email: { equals: email } },
    limit: 1,
  })
  if (docs.length === 0) {
    await payload.create({ collection: 'users', data: { email, password } })
    payload.logger.info(`Seeded admin user (${email}).`)
    return
  }
  await payload.update({ collection: 'users', id: docs[0].id, data: { password } })
}

export async function seedRegistry(payload: Payload): Promise<void> {
  const keyToDbId = await seedCitizens(payload)
  await seedFacePhotos(payload, keyToDbId)
  await seedAdminUser(payload)
}
