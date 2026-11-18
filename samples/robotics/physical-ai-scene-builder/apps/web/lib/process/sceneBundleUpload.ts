// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import Busboy from 'busboy';
import { createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export interface SceneBundleUpload {
  sceneBundlePath: string;
  cleanupDirectory: string;
  sceneBundleName: string;
  profile: Record<string, unknown>;
}

export class SceneBundleUploadError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = 'SceneBundleUploadError';
    this.status = status;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function parseSceneBundleUpload(
  request: Request,
  label: 'evaluation' | 'teleoperation',
  maxBundleBytes: number,
): Promise<SceneBundleUpload> {
  const contentType = request.headers.get('content-type');
  if (!contentType?.toLowerCase().startsWith('multipart/form-data')) {
    throw new SceneBundleUploadError(`${label} sessions must use multipart/form-data.`);
  }
  if (!request.body) {
    throw new SceneBundleUploadError(`${label} upload did not include a request body.`);
  }
  const cleanupDirectory = await mkdtemp(path.join(os.tmpdir(), `robotic-studio-${label}-`));
  const sceneBundlePath = path.join(cleanupDirectory, 'scene.mujoco-scene');
  let sceneBundleName = '';
  let profileText = '';
  let sceneBundleFound = false;
  let sceneBundleTruncated = false;
  const filePipelines: Promise<void>[] = [];
  try {
    const parser = Busboy({
      headers: Object.fromEntries(request.headers),
      limits: {
        files: 1,
        fields: 1,
        fileSize: maxBundleBytes,
        fieldSize: 8 * 1024 ** 2,
      },
    });
    await new Promise<void>((resolve, reject) => {
      parser.on('field', (name, value, info) => {
        if (info.valueTruncated) {
          reject(new SceneBundleUploadError(`${name} exceeds the upload limit.`, 413));
          return;
        }
        if (name !== 'profile') {
          reject(new SceneBundleUploadError(`Unexpected ${label} field '${name}'.`));
          return;
        }
        if (profileText) {
          reject(new SceneBundleUploadError('The profile field was provided more than once.'));
          return;
        }
        profileText = value;
      });
      parser.on('file', (name, file, info) => {
        if (name !== 'sceneBundle' || sceneBundleFound) {
          file.resume();
          return;
        }
        sceneBundleFound = true;
        sceneBundleName = info.filename;
        file.on('limit', () => {
          sceneBundleTruncated = true;
        });
        filePipelines.push(pipeline(file, createWriteStream(sceneBundlePath)));
      });
      parser.once('filesLimit', () =>
        reject(new SceneBundleUploadError('Only one sceneBundle file may be uploaded.')),
      );
      parser.once('fieldsLimit', () =>
        reject(new SceneBundleUploadError('Only a profile field is supported.')),
      );
      parser.once('error', reject);
      parser.once('close', resolve);
      const input = Readable.fromWeb(
        request.body as unknown as import('node:stream/web').ReadableStream<Uint8Array>,
      );
      input.once('error', (error) => {
        parser.destroy(error);
        reject(error);
      });
      input.pipe(parser);
    });
    await Promise.all(filePipelines);
    if (sceneBundleTruncated) {
      throw new SceneBundleUploadError(
        `Scene bundle exceeds the ${Math.round(maxBundleBytes / 1024 ** 2)} MB limit.`,
        413,
      );
    }
    if (!sceneBundleFound || !sceneBundleName.toLowerCase().endsWith('.mujoco-scene')) {
      throw new SceneBundleUploadError('Upload a .mujoco-scene file as sceneBundle.');
    }
    if (!profileText) throw new SceneBundleUploadError('A profile JSON field is required.');
    let profile: unknown;
    try {
      profile = JSON.parse(profileText);
    } catch {
      throw new SceneBundleUploadError('The profile field must contain valid JSON.');
    }
    if (!isRecord(profile))
      throw new SceneBundleUploadError('The profile field must contain an object.');
    return { sceneBundlePath, cleanupDirectory, sceneBundleName, profile };
  } catch (error) {
    await Promise.allSettled(filePipelines);
    await rm(cleanupDirectory, { recursive: true, force: true });
    throw error;
  }
}

export async function cleanupSceneBundleUpload(upload: SceneBundleUpload | null): Promise<void> {
  if (upload) await rm(upload.cleanupDirectory, { recursive: true, force: true });
}
