// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { DOMParser, ParseError, XMLSerializer, type Document, type Element } from '@xmldom/xmldom';

export const VIRTUAL_DEVICE_METADATA = 'rs_virtual_device';

export const VIRTUAL_ROBOT_ADAPTERS = {
  so101: {
    label: 'SO-101 follower',
    endpoint: '/api/virtual-devices/so101',
    pythonModule: 'robotic_studio.robots.so101.virtual_device',
    joints: ['shoulder_pan', 'shoulder_lift', 'elbow_flex', 'wrist_flex', 'wrist_roll', 'gripper'],
  },
} as const;

export type VirtualRobotAdapter = keyof typeof VIRTUAL_ROBOT_ADAPTERS;

export interface VirtualRobotCapability {
  adapter: VirtualRobotAdapter;
  /** Joint namespace without its trailing "__"; empty for the original template arm. */
  robot: string;
}

function parse(xml: string): Document {
  let document: Document;
  try {
    document = new DOMParser({
      onError: (_level, message) => {
        throw new SyntaxError(`Invalid robot metadata XML: ${message}`);
      },
    }).parseFromString(xml, 'application/xml');
  } catch (error) {
    if (!(error instanceof ParseError)) throw error;
    throw new SyntaxError(error.message);
  }
  if (document.doctype || document.documentElement?.tagName !== 'mujoco') {
    throw new SyntaxError('Robot metadata requires an MJCF document without a DOCTYPE.');
  }
  return document;
}

function children(element: Element | null, tag: string): Element[] {
  if (!element) throw new SyntaxError('Robot metadata requires an MJCF root element.');
  return Array.from(element.childNodes).filter(
    (node): node is Element => node.nodeType === 1 && (node as Element).tagName === tag,
  );
}

function entries(document: Document): Element[] {
  return children(document.documentElement, 'custom').flatMap((custom) => children(custom, 'text'));
}

function adapterFor(value: string | null): VirtualRobotAdapter | null {
  return value !== null && Object.hasOwn(VIRTUAL_ROBOT_ADAPTERS, value)
    ? (value as VirtualRobotAdapter)
    : null;
}

function prefixFor(name: string): string | null {
  if (name === VIRTUAL_DEVICE_METADATA) return '';
  const suffix = `__${VIRTUAL_DEVICE_METADATA}`;
  return name.endsWith(suffix) ? name.slice(0, -VIRTUAL_DEVICE_METADATA.length) : null;
}

function hasJoints(document: Document, adapter: VirtualRobotAdapter, prefix: string): boolean {
  const worldbody = children(document.documentElement, 'worldbody')[0];
  if (!worldbody) return false;
  const joints = new Set(
    Array.from(worldbody.getElementsByTagName('joint')).map((joint) => joint.getAttribute('name')),
  );
  const actuated = new Set(
    children(document.documentElement, 'actuator').flatMap((section) =>
      Array.from(section.childNodes)
        .filter((node): node is Element => node.nodeType === 1)
        .map((actuator) => actuator.getAttribute('joint')),
    ),
  );
  return VIRTUAL_ROBOT_ADAPTERS[adapter].joints.every(
    (joint) => joints.has(`${prefix}${joint}`) && actuated.has(`${prefix}${joint}`),
  );
}

/** Capabilities are opt-in metadata; joint names only validate an explicitly selected adapter. */
export function virtualRobotCapabilities(xml: string): VirtualRobotCapability[] {
  if (!xml.trim()) return [];
  const document = parse(xml);
  const result = new Map<string, VirtualRobotCapability>();
  for (const entry of entries(document)) {
    const prefix = prefixFor(entry.getAttribute('name') ?? '');
    const adapter = adapterFor(entry.getAttribute('data'));
    if (prefix === null || !adapter || !hasJoints(document, adapter, prefix)) continue;
    result.set(prefix, { adapter, robot: prefix ? prefix.slice(0, -2) : '' });
  }
  return [...result.values()];
}

function addMetadata(document: Document, adapter: VirtualRobotAdapter, prefix: string): boolean {
  const name = `${prefix}${VIRTUAL_DEVICE_METADATA}`;
  if (entries(document).some((entry) => entry.getAttribute('name') === name)) return false;
  const root = document.documentElement;
  if (!root) throw new SyntaxError('Robot metadata requires an MJCF root element.');
  const custom = children(root, 'custom')[0] ?? root.appendChild(document.createElement('custom'));
  const text = document.createElement('text');
  text.setAttribute('name', name);
  text.setAttribute('data', adapter);
  custom.appendChild(text);
  return true;
}

export function withVirtualRobotCapability(
  xml: string,
  adapter: VirtualRobotAdapter,
  prefix = '',
): string {
  const document = parse(xml);
  return addMetadata(document, adapter, prefix)
    ? new XMLSerializer().serializeToString(document)
    : xml;
}
