// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { SceneGraph, SceneNode } from '@mujoco-studio/types';

import {
  aimCamera,
  deleteNode,
  duplicateNode,
  insertCamera,
  insertContainer,
  insertLight,
  insertMountedCamera,
  insertPrimitiveObject,
  insertTable,
  isSplatBackdropNode,
  resizeContainer,
  robotInstancePrefixForNode,
  setNodeAttribute,
} from '../editor/document';
import type { SceneOperation } from './contracts';

export function applySceneOperations(
  xml: string,
  graph: SceneGraph,
  operations: readonly SceneOperation[],
): string {
  let candidate = xml;
  for (const operation of operations) {
    let next: string | null = null;
    if (operation.type === 'add_table') {
      next = insertTable(candidate, operation)?.xml ?? null;
    } else if (operation.type === 'add_container') {
      next = insertContainer(candidate, operation)?.xml ?? null;
    } else if (operation.type === 'resize_container') {
      next = resizeContainer(candidate, operation.name, operation);
      if (!next)
        throw new Error(
          `"${operation.name}" is not a container from add_container, or the new size is invalid.`,
        );
    } else if (operation.type === 'add_primitive') {
      next = insertPrimitiveObject(candidate, { ...operation, type: operation.shape })?.xml ?? null;
    } else if (operation.type === 'add_camera') {
      next = insertCamera(candidate, operation)?.xml ?? null;
    } else if (operation.type === 'aim_camera') {
      const document = new DOMParser().parseFromString(candidate, 'application/xml');
      const cameras = [...document.getElementsByTagName('camera')].filter(
        (element) => element.getAttribute('name') === operation.camera,
      );
      if (cameras.length !== 1)
        throw new Error(
          `Camera "${operation.camera}" must identify one existing camera. Read get_scene first.`,
        );
      if (cameras[0].parentElement?.tagName !== 'worldbody')
        throw new Error(
          `Camera "${operation.camera}" is mounted on a body; aim_camera moves world cameras only. Edit its pos and quat with set_attribute in the parent body frame.`,
        );
      next = aimCamera(candidate, operation.camera, operation);
    } else if (operation.type === 'add_mounted_camera') {
      const matches = Object.values(graph.nodes).filter(
        (node) => node.kind === 'body' && node.name === operation.parentBody,
      );
      const parent = matches.length === 1 ? matches[0] : undefined;
      if (!parent || parent.kind !== 'body' || parent.mjIndex <= 0 || isSplatBackdropNode(parent)) {
        throw new Error(
          `Camera parent "${operation.parentBody}" must identify one existing, unprotected body. Read get_scene first.`,
        );
      }
      const document = new DOMParser().parseFromString(candidate, 'application/xml');
      const bodies = [...document.getElementsByTagName('body')].filter(
        (element) => element.getAttribute('name') === parent.name,
      );
      if (bodies.length !== 1)
        throw new Error(`Camera parent "${parent.name}" no longer exists uniquely in this batch.`);
      next =
        insertMountedCamera(candidate, {
          ...operation,
          parent,
          rotation: operation.quaternion,
        })?.xml ?? null;
    } else if (operation.type === 'add_light') {
      next = insertLight(candidate, { ...operation, type: operation.lightType })?.xml ?? null;
    } else {
      const matches = Object.values(graph.nodes).filter(
        (node) => node.kind === operation.target.kind && node.name === operation.target.name,
      );
      const node: SceneNode | undefined = matches.length === 1 ? matches[0] : undefined;
      if (!node)
        throw new Error(
          `Target "${operation.target.name}" must identify one existing scene node. Read get_scene after adding nodes.`,
        );
      const document = new DOMParser().parseFromString(candidate, 'application/xml');
      const elements = [...document.getElementsByTagName(node.kind)].filter(
        (element) => element.getAttribute('name') === node.name,
      );
      if (elements.length !== 1)
        throw new Error(`Target "${node.name}" no longer exists uniquely in this batch.`);
      if (node.id === graph.rootId || isSplatBackdropNode(node)) {
        throw new Error(
          'The world and generated splat backdrop are protected. Edit splat calibration in the Splat tab.',
        );
      }
      if (operation.type === 'set_attribute') {
        next = setNodeAttribute(
          candidate,
          node,
          operation.attribute,
          typeof operation.value === 'number' ? String(operation.value) : operation.value,
        );
      } else {
        if (robotInstancePrefixForNode(candidate, node)) {
          throw new Error('Delete and duplicate robot instances through the editor UI.');
        }
        next =
          operation.type === 'delete_node'
            ? deleteNode(candidate, node)
            : duplicateNode(candidate, node);
      }
    }
    if (!next)
      throw new Error(`Could not apply ${operation.type}. Check the target, sizes, and values.`);
    candidate = next;
  }
  return candidate;
}
