// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import fs from 'node:fs'
import path from 'node:path'
import type { Payload } from 'payload'

/**
 * Seed the SQLite registry from data/citizens.csv on first init. Idempotent
 * per collection: each seeder is skipped once its collection holds rows.
 * Everything derived (birthdays, plates, summons numbers, fine splits) is
 * deterministic per citizenKey so demo runs are reproducible.
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
  hasCriminalRecord: boolean
  recordType: string
  recordStatus: string
  severity: string
  officerReviewRequired: boolean
  hasOutstandingFines: boolean
  unpaidFineCount: number
  totalUnpaidAmount: number
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
      hasCriminalRecord: c[11] === 'TRUE',
      recordType: c[12],
      recordStatus: c[13],
      severity: c[14],
      officerReviewRequired: c[15] === 'TRUE',
      hasOutstandingFines: c[16] === 'TRUE',
      unpaidFineCount: Number(c[17]),
      totalUnpaidAmount: Number(c[18]),
    }
  })
}

/** Small deterministic PRNG so every seed run produces identical demo data. */
function mulberry32(seed: number) {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const OFFENCES = [
  'Exceeding speed limit by 26–40 km/h',
  'Running a red light',
  'Illegal parking in a yellow zone',
  'Using a mobile phone while driving',
  'Failure to display road tax',
  'Overtaking on a double line',
]

const PLATE_PREFIXES = ['W', 'B', 'V', 'J', 'P', 'S', 'K', 'M']

function plateFor(rand: () => number): string {
  const letter = () => String.fromCharCode(65 + Math.floor(rand() * 26))
  const prefix = PLATE_PREFIXES[Math.floor(rand() * PLATE_PREFIXES.length)]
  return `${prefix}${letter()}${letter()} ${1000 + Math.floor(rand() * 9000)}`
}

/** Split `total` into `count` positive whole amounts that sum exactly. */
function splitAmount(total: number, count: number, rand: () => number): number[] {
  if (count <= 1) return [total]
  const weights = Array.from({ length: count }, () => 0.5 + rand())
  const sum = weights.reduce((a, b) => a + b, 0)
  const amounts = weights.map((w) => Math.max(1, Math.floor((w / sum) * total)))
  amounts[0] += total - amounts.reduce((a, b) => a + b, 0)
  return amounts
}

/**
 * Registry columns not present in the source CSV, derived deterministically
 * per citizenKey: civil status, JKM means-test data and MyKad loss history.
 * Used both when creating fresh rows and when backfilling a database seeded
 * before these columns existed.
 */
function citizenExtras(citizenKey: number, age: number, country: string) {
  const rand = mulberry32(citizenKey * 15013)
  const married = age >= 21 && rand() < 0.45

  // Race then religion: Malays are constitutionally Muslim; other races draw
  // from their common religious affiliations.
  let race: 'Malay' | 'Chinese' | 'Indian' | 'Other'
  let religion: 'Islam' | 'Buddhist' | 'Christian' | 'Hindu' | 'Other'
  if (country === 'Malaysia') {
    const r = rand()
    race = r < 0.58 ? 'Malay' : r < 0.82 ? 'Chinese' : r < 0.92 ? 'Indian' : 'Other'
    const s = rand()
    religion =
      race === 'Malay'
        ? 'Islam'
        : race === 'Chinese'
          ? s < 0.75
            ? 'Buddhist'
            : 'Christian'
          : race === 'Indian'
            ? s < 0.8
              ? 'Hindu'
              : 'Christian'
            : s < 0.5
              ? 'Christian'
              : 'Other'
  } else {
    race = 'Other'
    const s = rand()
    religion = s < 0.5 ? 'Buddhist' : s < 0.7 ? 'Christian' : 'Other'
  }

  return {
    race,
    religion,
    maritalStatus: (married ? 'married' : 'single') as 'married' | 'single',
    monthlyIncome: Math.round((900 + rand() * 4600) / 50) * 50,
    isOku: rand() < 0.12,
    childrenUnder18: married || age >= 28 ? Math.floor(rand() * 4) : 0,
    idCardLossCount:
      country === 'Malaysia' ? (rand() < 0.03 ? 2 : rand() < 0.15 ? 1 : 0) : 0,
  }
}

async function seedCitizens(payload: Payload): Promise<Map<number, number>> {
  const keyToDbId = new Map<number, number>()
  const existing = await payload.find({ collection: 'citizens', limit: 200, depth: 0 })
  if (existing.totalDocs > 0) {
    for (const doc of existing.docs) keyToDbId.set(doc.citizenKey as number, doc.id as number)
    // Databases seeded before the civil-status / welfare / MyKad columns
    // existed have null there — backfill them with the same derived values a
    // fresh seed would produce.
    const missing = existing.docs.filter((doc) => doc.religion == null)
    if (missing.length > 0) {
      payload.logger.info(`Backfilling registry extras for ${missing.length} citizens…`)
      for (const doc of missing) {
        await payload.update({
          collection: 'citizens',
          id: doc.id,
          data: citizenExtras(doc.citizenKey as number, (doc.age as number) ?? 30, doc.country as string),
        })
      }
    }
    return keyToDbId
  }

  const citizens = parseCsv()
  payload.logger.info(`Seeding ${citizens.length} synthetic citizens into db.sqlite…`)

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
        hasCriminalRecord: c.hasCriminalRecord,
        criminalRecord: c.hasCriminalRecord
          ? {
              type: c.recordType,
              status: c.recordStatus as 'Closed' | 'Under Review' | 'Pending Court',
              severity: c.severity as 'Low' | 'Medium' | 'High',
              officerReviewRequired: c.officerReviewRequired,
            }
          : {},
        hasOutstandingFines: c.hasOutstandingFines,
        unpaidFineCount: c.unpaidFineCount,
        totalUnpaidAmount: c.totalUnpaidAmount,
        ...citizenExtras(c.citizenKey, c.age, c.country),
      },
    })
    keyToDbId.set(c.citizenKey, doc.id as number)
  }
  payload.logger.info('Citizen registry seed complete.')
  return keyToDbId
}

async function seedFines(payload: Payload, keyToDbId: Map<number, number>): Promise<void> {
  const { totalDocs } = await payload.count({ collection: 'fines' })
  if (totalDocs > 0) return

  const citizens = parseCsv().filter((c) => c.hasOutstandingFines && c.unpaidFineCount > 0)
  payload.logger.info(`Generating summonses for ${citizens.length} citizens with fines…`)

  for (const c of citizens) {
    const rand = mulberry32(c.citizenKey * 7919)
    const plate = plateFor(rand)
    const amounts = splitAmount(c.totalUnpaidAmount, c.unpaidFineCount, rand)
    for (let i = 0; i < c.unpaidFineCount; i++) {
      const daysAgo = 5 + Math.floor(rand() * 280)
      await payload.create({
        collection: 'fines',
        data: {
          summonsNo: `WJ${String(10_000_000 + c.citizenKey * 137 + i * 13)}`,
          citizen: keyToDbId.get(c.citizenKey)!,
          documentNumber: c.citizenId,
          plateNumber: plate,
          offence: OFFENCES[Math.floor(rand() * OFFENCES.length)],
          amount: amounts[i],
          issuedAt: new Date(Date.now() - daysAgo * 86_400_000).toISOString(),
          status: 'unpaid',
        },
      })
    }
  }
  payload.logger.info('Summons seed complete.')
}

/** Common Malaysian models in the 1,401–1,600cc band the demo fee assumes. */
const VEHICLE_MODELS = [
  { model: 'Perodua Myvi 1.5', engineCc: 1496 },
  { model: 'Honda City 1.5', engineCc: 1498 },
  { model: 'Toyota Vios 1.5', engineCc: 1496 },
  { model: 'Proton Persona 1.6', engineCc: 1597 },
  { model: 'Proton Iriz 1.6', engineCc: 1597 },
  { model: 'Nissan Almera 1.5', engineCc: 1498 },
]

async function seedVehicles(payload: Payload, keyToDbId: Map<number, number>): Promise<void> {
  const { totalDocs } = await payload.count({ collection: 'vehicles' })
  if (totalDocs > 0) return

  const citizens = parseCsv()
  payload.logger.info(`Registering vehicles for ${citizens.length} citizens…`)

  const usedPlates = new Set<string>()
  for (const c of citizens) {
    const rand = mulberry32(c.citizenKey * 104729)
    const count = 1 + Math.floor(rand() * 3)
    for (let i = 0; i < count; i++) {
      // seedFines issues each fined citizen's summonses against the first
      // plate drawn from mulberry32(citizenKey * 7919) — the citizen's first
      // vehicle reuses that draw so summonses match a vehicle they own.
      let plate =
        i === 0 && c.hasOutstandingFines && c.unpaidFineCount > 0
          ? plateFor(mulberry32(c.citizenKey * 7919))
          : plateFor(rand)
      while (usedPlates.has(plate)) plate = plateFor(rand)
      usedPlates.add(plate)

      const spec = VEHICLE_MODELS[Math.floor(rand() * VEHICLE_MODELS.length)]
      const expiryInDays = Math.floor(rand() * 75) - 15
      await payload.create({
        collection: 'vehicles',
        data: {
          plateNumber: plate,
          citizen: keyToDbId.get(c.citizenKey)!,
          documentNumber: c.citizenId,
          model: spec.model,
          engineCc: spec.engineCc,
          year: 2012 + Math.floor(rand() * 13),
          roadTaxExpiry: new Date(Date.now() + expiryInDays * 86_400_000).toISOString(),
        },
      })
    }
  }
  payload.logger.info('Vehicle registry seed complete.')
}

/**
 * Driving licenses per citizen. Class D covers automatic cars, so a citizen
 * never holds D and DA together. Roughly: 20% hold no license (can apply for
 * anything), the rest hold a car class and/or B2 with a mix of valid,
 * renewable-expired and cancelled (> 3 years expired) records.
 */
async function seedLicenses(payload: Payload, keyToDbId: Map<number, number>): Promise<void> {
  const { totalDocs } = await payload.count({ collection: 'licenses' })
  if (totalDocs > 0) return

  const citizens = parseCsv()
  payload.logger.info(`Issuing driving licenses for ${citizens.length} citizens…`)

  for (const c of citizens) {
    const rand = mulberry32(c.citizenKey * 48611)
    if (rand() < 0.2) continue // never licensed — new application fully open

    const classes: ('B2' | 'D' | 'DA')[] = []
    if (c.age >= 17 && rand() < 0.85) classes.push(rand() < 0.6 ? 'D' : 'DA')
    if (c.age >= 16 && rand() < 0.35) classes.push('B2')
    for (const licenseClass of classes) {
      // 60% valid, 30% expired but renewable, 10% expired > 3y (cancelled).
      const bucket = rand()
      const expiryInDays =
        bucket < 0.6
          ? 30 + Math.floor(rand() * 690)
          : bucket < 0.9
            ? -(10 + Math.floor(rand() * 990))
            : -(1130 + Math.floor(rand() * 700))
      const issuedYearsAgo = 2 + Math.floor(rand() * 9)
      await payload.create({
        collection: 'licenses',
        data: {
          licenseNo: `JPJ${String(60_000_000 + c.citizenKey * 211)}${licenseClass}`,
          citizen: keyToDbId.get(c.citizenKey)!,
          documentNumber: c.citizenId,
          licenseClass,
          licenseType: c.age < 20 ? 'PDL' : 'CDL',
          issuedAt: new Date(Date.now() - issuedYearsAgo * 365 * 86_400_000).toISOString(),
          expiresAt: new Date(Date.now() + expiryInDays * 86_400_000).toISOString(),
        },
      })
    }
  }
  payload.logger.info('License registry seed complete.')
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

async function seedAdminUser(payload: Payload): Promise<void> {
  const { totalDocs } = await payload.count({ collection: 'users' })
  if (totalDocs > 0) return
  const email = process.env.PAYLOAD_ADMIN_EMAIL
  const password = process.env.PAYLOAD_ADMIN_PASSWORD
  if (!email || !password) {
    payload.logger.warn(
      'No admin user seeded — set cms.admin_email and cms.admin_password in config.yaml.',
    )
    return
  }
  await payload.create({ collection: 'users', data: { email, password } })
  payload.logger.info(`Seeded admin user (${email}).`)
}

export async function seedRegistry(payload: Payload): Promise<void> {
  const keyToDbId = await seedCitizens(payload)
  await seedFines(payload, keyToDbId)
  await seedVehicles(payload, keyToDbId)
  await seedLicenses(payload, keyToDbId)
  await seedFacePhotos(payload, keyToDbId)
  await seedAdminUser(payload)
}
