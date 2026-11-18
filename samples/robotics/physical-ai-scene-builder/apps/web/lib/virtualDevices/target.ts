// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** Official Python image the host helper runs; the device relays use only the standard library. */
export const DEFAULT_HELPER_IMAGE = 'python:3.13-alpine';

export class VirtualDeviceError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = 'VirtualDeviceError';
    this.status = status;
  }
}

/**
 * Where virtual devices are created: inside the Physical AI Studio container (a container only
 * sees its own `/dev`), or on this computer through a short-lived helper container, for clients
 * that run outside Docker.
 */
export type VirtualDeviceTarget =
  { kind: 'container'; container: string } | { kind: 'host'; image: string };

function hostTarget(): VirtualDeviceTarget {
  return {
    kind: 'host',
    image: process.env.ROBOTIC_STUDIO_DEVICE_HELPER_IMAGE?.trim() || DEFAULT_HELPER_IMAGE,
  };
}

/**
 * `ROBOTIC_STUDIO_VIRTUAL_DEVICE_TARGET=host` always uses the host; a configured
 * `ROBOTIC_STUDIO_PHYSICALAI_CONTAINER` always uses that container. Otherwise the one running
 * Physical AI Studio container is used, or the host when there is none.
 */
export async function resolveDeviceTarget(): Promise<VirtualDeviceTarget> {
  if (process.env.ROBOTIC_STUDIO_VIRTUAL_DEVICE_TARGET?.trim() === 'host') return hostTarget();
  const configured = process.env.ROBOTIC_STUDIO_PHYSICALAI_CONTAINER?.trim();
  if (configured) return { kind: 'container', container: configured };
  let output: string;
  try {
    ({ stdout: output } = await execFileAsync('docker', [
      'ps',
      '--format',
      '{{.Names}}\t{{.Image}}',
    ]));
  } catch {
    throw new VirtualDeviceError(
      'Docker is unavailable, and virtual devices are created through Docker. Check that this server can run docker.',
      503,
    );
  }
  const matches = output
    .split('\n')
    .map((line) => line.split('\t'))
    .filter(([name, image]) => name && `${name} ${image ?? ''}`.includes('physical-ai-studio'))
    .map(([name]) => name);
  if (matches.length > 1) {
    throw new VirtualDeviceError(
      `Several Physical AI Studio containers are running (${matches.join(', ')}). Set ROBOTIC_STUDIO_PHYSICALAI_CONTAINER to choose one.`,
      409,
    );
  }
  return matches.length === 1 ? { kind: 'container', container: matches[0] } : hostTarget();
}

/** The device worker's arguments for a target. */
export function targetArguments(target: VirtualDeviceTarget): string[] {
  return target.kind === 'container'
    ? [
        '--container',
        target.container,
        '--relay-python',
        process.env.ROBOTIC_STUDIO_PHYSICALAI_PYTHON?.trim() || 'python3',
      ]
    : ['--helper-image', target.image];
}

/** Where the devices appear, for status: the container's name, or null for this computer. */
export function targetContainer(target: VirtualDeviceTarget): string | null {
  return target.kind === 'container' ? target.container : null;
}
