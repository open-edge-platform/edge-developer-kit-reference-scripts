// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { APIError, type CollectionConfig } from 'payload'
import { detectFaces, faceServiceConfigured } from '../../lib/face-service'
import { kioskOrAdmin } from '../access'

const dirname = path.dirname(fileURLToPath(import.meta.url))

/**
 * Reference portraits for face verification — one enrolled photo per citizen.
 *
 * A separate upload collection rather than a blob on the citizen row: it
 * gives the admin a real image picker with a preview instead of a base64
 * text field, and keeps the bytes on disk where the kiosk reads them
 * directly (see cmsFile).
 *
 * Read access follows the registry: the kiosk key or a logged-in admin.
 * These are face templates in all but name — nothing here is public.
 *
 * SYNTHETIC DATA FOR DEMO ONLY.
 */
export const FacePhotos: CollectionConfig = {
  slug: 'face-photos',
  admin: {
    useAsTitle: 'filename',
    defaultColumns: ['filename', 'alt', 'updatedAt'],
    group: 'Registry',
    description:
      'Reference portraits matched against the kiosk camera during identity checks. ' +
      'Upload one here, then attach it to a citizen under Citizens → Face reference photo. ' +
      'A head-and-shoulders photo with one clearly visible face works best.',
  },
  access: {
    read: kioskOrAdmin,
    create: kioskOrAdmin,
    update: kioskOrAdmin,
    delete: ({ req }) => Boolean(req.user),
  },
  upload: {
    staticDir: path.resolve(
      process.cwd(),
      process.env.KIOSK_FACE_PHOTOS_DIR ?? path.resolve(dirname, '../../../face-photos'),
    ),
    // The face worker decodes with OpenCV, which reads all three.
    mimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
    displayPreview: true,
  },
  hooks: {
    /**
     * Refuse a portrait the face detector cannot use, at the moment it is
     * uploaded.
     *
     * The same detector that will later have to find a face in this picture
     * says now whether it can. Without this the upload succeeds, looks
     * correct in the admin, and fails days later at the kiosk — where the
     * person it rejects is the citizen, who can do nothing about it and is
     * told only that their face did not match.
     *
     * Advisory when the face service is unavailable: an install may well be
     * populating the registry before the worker is running, and refusing
     * every upload because a check could not run would be worse than
     * accepting a portrait that later turns out to be unusable.
     */
    beforeValidate: [
      async ({ req }) => {
        const file = req.file
        if (!file?.data?.length || !faceServiceConfigured()) return

        let faces: number
        try {
          faces = await detectFaces(new Uint8Array(file.data), file.mimetype)
        } catch (error) {
          req.payload.logger.warn(
            `Could not check ${file.name} for a face (${(error as Error).message}) — ` +
              'accepting it unchecked.',
          )
          return
        }

        if (faces === 0) {
          throw new APIError(
            `No face could be detected in ${file.name}. A reference portrait needs one ` +
              'clearly visible, forward-facing face — otherwise the kiosk has nothing to ' +
              'match the citizen against.',
            400,
          )
        }
        if (faces > 1) {
          throw new APIError(
            `${faces} faces were detected in ${file.name}. A reference portrait must show ` +
              'only the citizen it belongs to, or the kiosk may enroll the wrong person.',
            400,
          )
        }
      },
    ],
  },
  fields: [
    {
      name: 'alt',
      type: 'text',
      admin: { description: 'Who this is a photo of — shown in the admin list.' },
    },
  ],
}
