// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

export interface GenerationSourceObject {
  id: string;
  body: string;
}

export interface SceneGenerationCandidates {
  sourceObjects: GenerationSourceObject[];
  destinationBodies: GenerationSourceObject[];
}

function preferredBody(bodies: GenerationSourceObject[], names: readonly string[]): string | null {
  for (const name of names) {
    const exact = bodies.find((body) => body.body.toLowerCase() === name);
    if (exact) return exact.body;
  }
  for (const name of names) {
    const partial = bodies.find((body) => body.body.toLowerCase().includes(name));
    if (partial) return partial.body;
  }
  return null;
}

function isFreeJoint(element: Element): boolean {
  return (
    element.tagName === 'freejoint' ||
    (element.tagName === 'joint' && element.getAttribute('type') === 'free')
  );
}

function isEligibleRigidBody(body: Element): boolean {
  const name = body.getAttribute('name')?.trim() ?? '';
  if (!name || !body.querySelector(':scope > geom')) return false;
  const joints = [...body.children].filter(
    (child) => child.tagName === 'freejoint' || child.tagName === 'joint',
  );
  return joints.length === 0 || (joints.length === 1 && isFreeJoint(joints[0]));
}

function containsRobotJoints(body: Element): boolean {
  const suffixes = ['shoulder_pan', 'shoulder_lift', 'elbow_flex', 'wrist_flex', 'wrist_roll'];
  return [...body.querySelectorAll('joint')].some((joint) =>
    suffixes.some((suffix) => (joint.getAttribute('name') ?? '').endsWith(suffix)),
  );
}

function sourceObject(body: Element): GenerationSourceObject {
  const name = body.getAttribute('name') ?? '';
  return { id: name.replace(/[^a-zA-Z0-9_-]/g, '_'), body: name };
}

export function findSceneGenerationCandidates(xml: string): SceneGenerationCandidates {
  if (typeof DOMParser === 'undefined') return { sourceObjects: [], destinationBodies: [] };
  const document = new DOMParser().parseFromString(xml, 'application/xml');
  if (document.querySelector('parsererror')) return { sourceObjects: [], destinationBodies: [] };
  const worldbody = document.querySelector('mujoco > worldbody');
  const rigidBodies = worldbody
    ? [...worldbody.children].filter(
        (child) =>
          child.tagName === 'body' && isEligibleRigidBody(child) && !containsRobotJoints(child),
      )
    : [];
  const destinationBodies = rigidBodies.map(sourceObject);
  const destination =
    preferredBody(destinationBodies, [
      'destination',
      'container',
      'basket',
      'box',
      'bin',
      'tray',
    ]) ??
    destinationBodies[1]?.body ??
    destinationBodies[0]?.body ??
    null;
  const sourceObjects = destinationBodies.filter((body) => body.body !== destination);
  return { sourceObjects, destinationBodies };
}
