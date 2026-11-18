// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import {
  CAMERA_CLIPPING_NUMERIC,
  normalizeCameraClipping,
  type CameraClipping,
} from '@mujoco-studio/mujoco';
import {
  SPLAT_BACKDROP_BODY,
  type BodyNode,
  type SceneNode,
  type SceneNodeKind,
} from '@mujoco-studio/types';

import { CAMERA_HIDDEN_GEOM_GROUP, isVisibleGeom } from './sceneGraph';
import { isFiniteVec3, type SplatHeightfield, type Vec3Tuple } from './splatCollision';

type SupportedAttribute =
  | 'pos'
  | 'euler'
  | 'quat'
  | 'axisangle'
  | 'xyaxes'
  | 'zaxis'
  | 'size'
  | 'mass'
  | 'density'
  | 'friction'
  | 'rgba'
  | 'axis'
  | 'range'
  | 'limited'
  | 'damping'
  | 'frictionloss'
  | 'noise'
  | 'cutoff'
  | 'user'
  | 'solref'
  | 'fovy'
  | 'resolution'
  | 'dir'
  | 'diffuse'
  | 'ambient'
  | 'specular'
  | 'attenuation'
  | 'exponent'
  | 'castshadow'
  | 'directional';

const DEFAULT_RESTITUTION_STIFFNESS = 1000;

export interface AssetPlacement {
  assetId: string;
  name: string;
  visualFile: string;
  collisionFile?: string;
  position: readonly [number, number, number];
  rotation: readonly [number, number, number, number];
}

export interface MeshObjectPlacement {
  position: readonly [number, number, number];
  rotation: readonly [number, number, number, number];
}

export interface AssetInsertionResult {
  xml: string;
  bodyName: string;
}

export type LightInsertionType = 'directional' | 'point' | 'spot';

export interface CameraPlacement {
  name: string;
  position: readonly [number, number, number];
  target: readonly [number, number, number];
  fovy: number;
}

export interface MountedCameraPlacement {
  name: string;
  parent: BodyNode;
  position: readonly [number, number, number];
  rotation: readonly [number, number, number, number];
  fovy: number;
}

export interface LightPlacement {
  name: string;
  type: LightInsertionType;
  position: readonly [number, number, number];
  direction: readonly [number, number, number];
}

export interface CameraInsertionResult {
  xml: string;
  nodeName: string;
}

export interface LightInsertionResult {
  xml: string;
  nodeName: string;
}

export type CameraClippingAttribute = 'near' | 'far';

export interface RobotPlacement {
  robotId: string;
  name: string;
  mjcf: string;
  meshFiles: ReadonlyMap<string, string>;
  position: readonly [number, number, number];
  rotation: readonly [number, number, number, number];
}

export interface RobotInsertionResult {
  xml: string;
  bodyName: string;
  instancePrefix: string;
}

export type PrimitiveGeomType = 'box' | 'sphere' | 'capsule' | 'cylinder' | 'ellipsoid';
export type BoxFace = 'right' | 'left' | 'top' | 'bottom' | 'front' | 'back';

export const CUSTOM_GEOM_TYPES = [
  'plane',
  'sphere',
  'capsule',
  'ellipsoid',
  'cylinder',
  'box',
] as const;
export type CustomGeomType = (typeof CUSTOM_GEOM_TYPES)[number];

export const BOX_FACE_OPTIONS: readonly { value: BoxFace; label: string }[] = [
  { value: 'front', label: 'Front (+Z)' },
  { value: 'back', label: 'Back (-Z)' },
  { value: 'right', label: 'Right (+X)' },
  { value: 'left', label: 'Left (-X)' },
  { value: 'top', label: 'Top (+Y)' },
  { value: 'bottom', label: 'Bottom (-Y)' },
];

export interface PrimitiveObjectDefinition {
  type: PrimitiveGeomType;
  size: readonly [number, number, number];
  rgba: readonly [number, number, number, number];
  mass: number;
  friction: readonly [number, number, number];
}

export interface PrimitiveObjectPlacement extends PrimitiveObjectDefinition {
  fixed?: boolean;
  name: string;
  position: readonly [number, number, number];
  rotation: readonly [number, number, number];
}

export interface PrimitiveObjectInsertionResult {
  xml: string;
  bodyName: string;
}

export interface CustomGeomDefinition {
  type: CustomGeomType;
  attributes: Readonly<Record<string, string>>;
}

export type CustomBodyChildDefinition =
  | { kind: 'freejoint'; attributes: Readonly<Record<string, string>> }
  | { kind: 'geom'; definition: CustomGeomDefinition };

export interface CustomBodyDefinition {
  type: 'body';
  attributes: Readonly<Record<string, string>>;
  children: readonly CustomBodyChildDefinition[];
}

export type CustomShapeDefinition = CustomGeomDefinition | CustomBodyDefinition;

export interface CustomGeomParseResult {
  definition: CustomShapeDefinition | null;
  error: string | null;
}

export interface CustomGeomInsertionResult {
  xml: string;
  nodeKind: 'body' | 'geom';
  nodeName: string;
}

export interface SceneMaterial {
  id: string;
  name: string;
  color: string;
  metallic: number;
  roughness: number;
  textureFile?: string;
}

export function materialNameFor(material: SceneMaterial): string {
  return identifier(`material_${material.id}`, 'material_default');
}

/** MJCF element names that map to each scene-graph node kind (sensors are listed separately). */
export const ELEMENT_NAMES: Record<SceneNodeKind, readonly string[]> = {
  body: ['body'],
  geom: ['geom'],
  joint: ['joint', 'freejoint', 'balljoint'],
  light: ['light'],
  camera: ['camera'],
  site: ['site'],
  sensor: [],
};

export const SENSOR_ELEMENT_NAMES: ReadonlySet<string> = new Set([
  'touch',
  'accelerometer',
  'velocimeter',
  'gyro',
  'force',
  'torque',
  'magnetometer',
  'rangefinder',
  'camprojection',
  'jointpos',
  'jointvel',
  'tendonpos',
  'tendonvel',
  'actuatorpos',
  'actuatorvel',
  'actuatorfrc',
  'jointactuatorfrc',
  'tendonactuatorfrc',
  'ballquat',
  'ballangvel',
  'jointlimitpos',
  'jointlimitvel',
  'jointlimitfrc',
  'tendonlimitpos',
  'tendonlimitvel',
  'tendonlimitfrc',
  'framepos',
  'framequat',
  'framexaxis',
  'frameyaxis',
  'framezaxis',
  'framelinvel',
  'frameangvel',
  'framelinacc',
  'frameangacc',
  'subtreecom',
  'subtreelinvel',
  'subtreeangmom',
  'insidesite',
  'geomdist',
  'geomnormal',
  'geomfromto',
  'contact',
  'energy',
  'clock',
  'tactile',
  'plugin',
  'user',
]);

function parse(xml: string): Document | null {
  const document = new DOMParser().parseFromString(xml, 'application/xml');
  return document.querySelector('parsererror') ? null : document;
}

const CUSTOM_GEOM_VECTOR_LENGTHS: Record<string, readonly number[]> = {
  pos: [3],
  euler: [3],
  quat: [4],
  axisangle: [4],
  xyaxes: [6],
  zaxis: [3],
  fromto: [6],
  rgba: [4],
  friction: [3],
  solref: [2, 6],
  solimp: [5],
};

const CUSTOM_GEOM_SCALAR_ATTRIBUTES = new Set([
  'mass',
  'density',
  'margin',
  'gap',
  'priority',
  'contype',
  'conaffinity',
  'condim',
  'group',
]);

const CUSTOM_BODY_VECTOR_LENGTHS: Record<string, readonly number[]> = {
  pos: [3],
  euler: [3],
  quat: [4],
  axisangle: [4],
  xyaxes: [6],
  zaxis: [3],
};

function customGeomSizeLength(type: CustomGeomType): number {
  return type === 'sphere' ? 1 : type === 'capsule' || type === 'cylinder' ? 2 : 3;
}

function customGeomType(value: string): CustomGeomType | null {
  return CUSTOM_GEOM_TYPES.find((type) => type === value) ?? null;
}

function numericAttributeValues(value: string): number[] | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const values = trimmed.split(/\s+/).map(Number);
  return values.length > 0 && values.every(Number.isFinite) ? values : null;
}

function elementAttributes(element: Element): Record<string, string> {
  return Object.fromEntries(
    [...element.attributes].map((attribute) => [attribute.name, attribute.value.trim()]),
  );
}

function hasMeaningfulText(element: Element): boolean {
  return [...element.childNodes].some(
    (node) => node.nodeType === Node.TEXT_NODE && Boolean(node.textContent?.trim()),
  );
}

function parseCustomGeomElement(element: Element): {
  definition: CustomGeomDefinition | null;
  error: string | null;
} {
  if (element.children.length > 0 || hasMeaningfulText(element)) {
    return { definition: null, error: 'The <geom> element cannot contain child elements or text.' };
  }

  const attributes = elementAttributes(element);
  const typeValue = attributes.type;
  if (!typeValue) {
    return { definition: null, error: 'Add a type attribute, such as type="box".' };
  }
  const type = customGeomType(typeValue);
  if (!type) {
    return {
      definition: null,
      error: `Geom type "${typeValue}" is not supported here. Use ${CUSTOM_GEOM_TYPES.join(', ')}.`,
    };
  }
  if ('name' in attributes && !attributes.name) {
    return { definition: null, error: 'The name attribute cannot be empty.' };
  }

  const size = attributes.size ? numericAttributeValues(attributes.size) : null;
  const allowsRadiusOnlyFromto =
    Boolean(attributes.fromto) && (type === 'capsule' || type === 'cylinder');
  const expectedSizeLengths = allowsRadiusOnlyFromto
    ? [1, customGeomSizeLength(type)]
    : [customGeomSizeLength(type)];
  if (attributes.size && !size) {
    return { definition: null, error: 'The size attribute must contain only numbers.' };
  }
  if (size && !expectedSizeLengths.includes(size.length)) {
    return {
      definition: null,
      error: `Geom type "${type}" expects ${expectedSizeLengths.join(' or ')} size values${allowsRadiusOnlyFromto ? ' when using fromto' : ''}.`,
    };
  }
  if (size && size.some((value) => (type === 'plane' ? value < 0 : value <= 0))) {
    return {
      definition: null,
      error:
        type === 'plane'
          ? 'Plane size values cannot be negative.'
          : 'Size values must be greater than zero.',
    };
  }

  for (const [attribute, value] of Object.entries(attributes)) {
    const expectedLengths =
      attribute === 'size'
        ? expectedSizeLengths
        : (CUSTOM_GEOM_VECTOR_LENGTHS[attribute] ??
          (CUSTOM_GEOM_SCALAR_ATTRIBUTES.has(attribute) ? [1] : null));
    if (!expectedLengths) continue;

    const values = numericAttributeValues(value);
    if (!values) {
      return { definition: null, error: `The ${attribute} attribute must contain only numbers.` };
    }
    if (!expectedLengths.includes(values.length)) {
      return {
        definition: null,
        error: `The ${attribute} attribute expects ${expectedLengths.join(' or ')} numeric value${expectedLengths.length === 1 && expectedLengths[0] === 1 ? '' : 's'}.`,
      };
    }
    if (attribute === 'rgba' && values.some((value) => value < 0 || value > 1)) {
      return { definition: null, error: 'RGBA values must be between 0 and 1.' };
    }
    if (
      (attribute === 'friction' || attribute === 'margin' || attribute === 'gap') &&
      values.some((value) => value < 0)
    ) {
      return { definition: null, error: `${attribute} values cannot be negative.` };
    }
    if ((attribute === 'mass' || attribute === 'density') && values[0] <= 0) {
      return { definition: null, error: `${attribute} must be greater than zero.` };
    }
  }

  return { definition: { type, attributes }, error: null };
}

function parseCustomBodyElement(element: Element): CustomBodyDefinition | string {
  if (hasMeaningfulText(element)) {
    return 'The <body> element can only contain <freejoint /> and <geom ... /> elements.';
  }

  const attributes = elementAttributes(element);
  if ('name' in attributes && !attributes.name) {
    return 'The body name attribute cannot be empty.';
  }

  for (const [attribute, value] of Object.entries(attributes)) {
    const expectedLengths = CUSTOM_BODY_VECTOR_LENGTHS[attribute];
    if (!expectedLengths) continue;
    const values = numericAttributeValues(value);
    if (!values) return `The body ${attribute} attribute must contain only numbers.`;
    if (!expectedLengths.includes(values.length)) {
      return `The body ${attribute} attribute expects ${expectedLengths.join(' or ')} numeric values.`;
    }
  }

  const children: CustomBodyChildDefinition[] = [];
  let freejointCount = 0;
  for (const child of [...element.children]) {
    if (child.tagName === 'freejoint') {
      freejointCount++;
      if (freejointCount > 1) return 'A custom body can contain only one <freejoint /> element.';
      if (child.children.length > 0 || hasMeaningfulText(child)) {
        return 'The <freejoint /> element cannot contain child elements or text.';
      }
      const childAttributes = elementAttributes(child);
      if ('name' in childAttributes && !childAttributes.name) {
        return 'The freejoint name attribute cannot be empty.';
      }
      children.push({ kind: 'freejoint', attributes: childAttributes });
      continue;
    }
    if (child.tagName !== 'geom') {
      return 'Custom bodies can contain only <freejoint /> and <geom ... /> elements.';
    }

    const result = parseCustomGeomElement(child);
    if (!result.definition) return result.error ?? 'The custom geom definition is invalid.';
    children.push({ kind: 'geom', definition: result.definition });
  }

  if (!children.some((child) => child.kind === 'geom')) {
    return 'Add at least one <geom ... /> element inside the custom body.';
  }

  return { type: 'body', attributes, children };
}

export function parseCustomGeomDefinition(source: string): CustomGeomParseResult {
  if (!source.trim()) {
    return {
      definition: null,
      error: 'Enter one MuJoCo <geom ... /> or <body ...>...</body> definition.',
    };
  }

  const document = new DOMParser().parseFromString(source, 'application/xml');
  if (document.querySelector('parsererror')) {
    return { definition: null, error: 'The MuJoCo definition is not valid XML.' };
  }

  const root = document.documentElement;
  if (!root || (root.tagName !== 'geom' && root.tagName !== 'body')) {
    return { definition: null, error: 'Use one <geom ... /> or <body ...>...</body> as the root.' };
  }
  if (root.tagName === 'body') {
    const definition = parseCustomBodyElement(root);
    return typeof definition === 'string'
      ? { definition: null, error: definition }
      : { definition, error: null };
  }

  return parseCustomGeomElement(root);
}

function serialize(document: Document): string {
  return new XMLSerializer().serializeToString(document);
}

function elementsFor(document: Document, kind: SceneNodeKind): Element[] {
  if (kind === 'sensor') {
    const sensorSection = document.documentElement.querySelector(':scope > sensor');
    return sensorSection
      ? [...sensorSection.children].filter((element) => SENSOR_ELEMENT_NAMES.has(element.tagName))
      : [];
  }
  const names = new Set(ELEMENT_NAMES[kind]);
  const walker = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_ELEMENT);
  const elements: Element[] = [];
  let current = walker.currentNode as Element;
  if (names.has(current.tagName)) elements.push(current);
  while (walker.nextNode()) {
    current = walker.currentNode as Element;
    if (names.has(current.tagName)) elements.push(current);
  }
  return elements;
}

function elementFor(document: Document, node: SceneNode): Element | null {
  if (node.kind === 'body') {
    if (node.mjIndex === 0) return null;
    const bodies = elementsFor(document, 'body');
    return (
      bodies.find((element) => element.getAttribute('name') === node.name) ??
      bodies[node.mjIndex - 1] ??
      null
    );
  }
  const elements = elementsFor(document, node.kind);
  return (
    elements.find((element) => element.getAttribute('name') === node.name) ??
    elements[node.mjIndex] ??
    null
  );
}

function withElement(
  xml: string,
  node: SceneNode,
  update: (element: Element) => void,
): string | null {
  const document = parse(xml);
  if (!document) return null;
  const element = elementFor(document, node);
  if (!element) return null;
  update(element);
  return serialize(document);
}

function numberList(values: readonly number[]): string {
  return values.map((value) => Number(value.toFixed(6))).join(' ');
}

function hasFiniteValues(values: readonly number[]): boolean {
  return values.every(Number.isFinite);
}

function hasSafeAssetPath(path: string): boolean {
  return path.length > 0 && !path.includes('..') && !path.includes('\\');
}

function identifier(value: string, fallback: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^[_-]+|[_-]+$/g, '');
  return normalized ? `asset_${normalized}` : fallback;
}

function uniqueName(document: Document, base: string): string {
  const names = new Set(
    [...document.querySelectorAll('[name]')]
      .map((element) => element.getAttribute('name'))
      .filter((name): name is string => Boolean(name)),
  );
  if (!names.has(base)) return base;

  let index = 2;
  while (names.has(`${base}_${index}`)) index++;
  return `${base}_${index}`;
}

function meshDeclarationMatches(document: Document, name: string, file: string): boolean {
  for (const mesh of document.querySelectorAll('asset > mesh')) {
    if (mesh.getAttribute('name') === name) return mesh.getAttribute('file') === file;
  }
  return false;
}

function ensureMeshDeclaration(document: Document, name: string, file: string): boolean {
  if (meshDeclarationMatches(document, name, file)) return true;
  if (
    [...document.querySelectorAll('asset > mesh')].some(
      (mesh) => mesh.getAttribute('name') === name,
    )
  ) {
    return false;
  }

  let assets = document.querySelector(':scope > asset');
  if (!assets) {
    assets = document.createElement('asset');
    document.documentElement.insertBefore(assets, document.documentElement.firstChild);
  }
  const mesh = document.createElement('mesh');
  mesh.setAttribute('name', name);
  mesh.setAttribute('file', file);
  assets.append(mesh);
  return true;
}

function materialRgba(color: string): string | null {
  const match = color.trim().match(/^#?([a-f\d]{6})([a-f\d]{2})?$/i);
  if (!match) return null;
  const value = match[1];
  const alpha = match[2] ? Number.parseInt(match[2], 16) / 255 : 1;
  return numberList([
    Number.parseInt(value.slice(0, 2), 16) / 255,
    Number.parseInt(value.slice(2, 4), 16) / 255,
    Number.parseInt(value.slice(4, 6), 16) / 255,
    alpha,
  ]);
}

function ensureMaterialDeclaration(
  document: Document,
  name: string,
  material: SceneMaterial,
): boolean {
  const rgba = materialRgba(material.color);
  if (!rgba || !Number.isFinite(material.metallic) || !Number.isFinite(material.roughness)) {
    return false;
  }

  let assets = document.querySelector(':scope > asset');
  if (!assets) {
    assets = document.createElement('asset');
    document.documentElement.insertBefore(assets, document.documentElement.firstChild);
  }
  let declaration = [...assets.querySelectorAll(':scope > material')].find(
    (entry) => entry.getAttribute('name') === name,
  );
  if (!declaration) {
    declaration = document.createElement('material');
    declaration.setAttribute('name', name);
    assets.append(declaration);
  }
  const textureName = material.textureFile
    ? identifier(`texture_${material.id}`, 'texture_default')
    : null;
  if (textureName && !hasSafeAssetPath(material.textureFile ?? '')) return false;
  if (textureName) {
    let texture = [...assets.querySelectorAll(':scope > texture')].find(
      (entry) => entry.getAttribute('name') === textureName,
    );
    if (!texture) {
      texture = document.createElement('texture');
      texture.setAttribute('name', textureName);
      assets.append(texture);
    }
    texture.setAttribute('type', '2d');
    texture.setAttribute('file', material.textureFile ?? '');
    declaration.setAttribute('texture', textureName);
    declaration.removeAttribute('texuniform');
  } else {
    declaration.removeAttribute('texture');
    declaration.removeAttribute('texuniform');
  }
  declaration.setAttribute('rgba', rgba);
  declaration.setAttribute('metallic', String(Math.max(0, Math.min(1, material.metallic))));
  declaration.setAttribute('roughness', String(Math.max(0, Math.min(1, material.roughness))));
  return true;
}

export function getNodeAttributes(xml: string, node: SceneNode): Record<string, string> {
  const document = parse(xml);
  const element = document ? elementFor(document, node) : null;
  if (!element) return {};
  return Object.fromEntries(
    [...element.attributes].map((attribute) => [attribute.name, attribute.value]),
  );
}

function dampingRatioForSolref(value: string | undefined): number {
  const values = value?.trim().split(/\s+/).map(Number) ?? [];
  if (values.length < 2 || !values.every(Number.isFinite)) return 1;
  if (values[0] > 0 && values[1] > 0) return values[1];
  if (values[0] < 0 && values[1] <= 0) {
    const stiffness = -values[0];
    const damping = -values[1];
    if (stiffness > 0) return damping / (2 * Math.sqrt(stiffness));
  }
  return 1;
}

function restitutionForDampingRatio(dampingRatio: number): number {
  if (!Number.isFinite(dampingRatio) || dampingRatio <= 0) return 1;
  if (dampingRatio >= 1) return 0;
  return Math.exp((-dampingRatio * Math.PI) / Math.sqrt(1 - dampingRatio ** 2));
}

export function restitutionFromSolref(solref: string | undefined): string {
  return restitutionForDampingRatio(dampingRatioForSolref(solref)).toFixed(3);
}

export function setRestitution(xml: string, node: SceneNode, value: string): string | null {
  if (node.kind !== 'geom') return null;
  const restitution = Number(value.trim());
  if (!Number.isFinite(restitution) || restitution < 0 || restitution > 1) return null;

  const attributes = getNodeAttributes(xml, node);
  const solrefValues = attributes.solref?.trim().split(/\s+/).map(Number) ?? [];
  const stiffness =
    solrefValues.length >= 2 && solrefValues[0] < 0
      ? Math.max(-solrefValues[0], Number.EPSILON)
      : DEFAULT_RESTITUTION_STIFFNESS;
  const dampingRatio =
    restitution <= 0
      ? 1
      : -Math.log(restitution) / Math.sqrt(Math.PI ** 2 + Math.log(restitution) ** 2);
  const damping = 2 * Math.sqrt(stiffness) * dampingRatio;
  return setNodeAttribute(xml, node, 'solref', `-${stiffness} ${-damping}`);
}

/** Pose attributes the backdrop body accepts; everything else about the backdrop is generated. */
const BACKDROP_POSE_ATTRIBUTES = new Set<string>([
  'pos',
  'euler',
  'quat',
  'axisangle',
  'xyaxes',
  'zaxis',
]);

export function renameNode(xml: string, node: SceneNode, name: string): string | null {
  const trimmedName = name.trim();
  if (!trimmedName || isSplatBackdropNode(node)) return null;
  return withElement(xml, node, (element) => element.setAttribute('name', trimmedName));
}

export function setNodeAttribute(
  xml: string,
  node: SceneNode,
  attribute: SupportedAttribute,
  value: string | readonly number[],
): string | null {
  if (
    isSplatBackdropNode(node) &&
    (node.kind !== 'body' || !BACKDROP_POSE_ATTRIBUTES.has(attribute))
  ) {
    return null;
  }
  return withElement(xml, node, (element) => {
    if (['euler', 'quat', 'axisangle', 'xyaxes', 'zaxis'].includes(attribute)) {
      for (const orientation of ['euler', 'quat', 'axisangle', 'xyaxes', 'zaxis']) {
        element.removeAttribute(orientation);
      }
    }
    element.setAttribute(attribute, typeof value === 'string' ? value : numberList(value));
  });
}

/**
 * Marks a rendered geom as hidden in camera images (`group` = `CAMERA_HIDDEN_GEOM_GROUP`) or clears
 * the mark (drops `group`, so a class default applies again). Collision is unchanged. Geoms that
 * never render (collision-only groups 3-4) keep their group.
 */
export function setGeomHiddenInCameras(
  xml: string,
  node: SceneNode,
  hidden: boolean,
): string | null {
  if (node.kind !== 'geom' || isSplatBackdropNode(node) || !isVisibleGeom(node)) return null;
  return withElement(xml, node, (element) => {
    if (hidden) element.setAttribute('group', String(CAMERA_HIDDEN_GEOM_GROUP));
    else if (element.getAttribute('group') === String(CAMERA_HIDDEN_GEOM_GROUP)) {
      element.removeAttribute('group');
    }
  });
}

/**
 * Inserts a runtime-staged asset as an independently movable body with separate
 * visual and collision meshes. The caller commits the returned XML as one edit.
 */
export function insertMeshAsset(
  xml: string,
  placement: AssetPlacement,
): AssetInsertionResult | null {
  if (
    !placement.assetId.trim() ||
    !placement.name.trim() ||
    !hasSafeAssetPath(placement.visualFile) ||
    (placement.collisionFile !== undefined && !hasSafeAssetPath(placement.collisionFile)) ||
    !hasFiniteValues(placement.position) ||
    !hasFiniteValues(placement.rotation)
  ) {
    return null;
  }

  const document = parse(xml);
  const worldbody = document?.querySelector(':scope > worldbody');
  if (!document || !worldbody) return null;

  const assetBase = identifier(placement.assetId, 'asset_mesh');
  const visualMeshName = `${assetBase}_visual`;
  if (!ensureMeshDeclaration(document, visualMeshName, placement.visualFile)) return null;
  const collisionMeshName = `${assetBase}_collision`;
  if (
    placement.collisionFile !== undefined &&
    !ensureMeshDeclaration(document, collisionMeshName, placement.collisionFile)
  )
    return null;

  const bodyName = uniqueName(document, identifier(placement.name, 'asset_object'));
  const body = document.createElement('body');
  body.setAttribute('name', bodyName);
  body.setAttribute('pos', numberList(placement.position));
  body.setAttribute('quat', numberList(placement.rotation));

  const freeJoint = document.createElement('freejoint');
  body.append(freeJoint);

  const visualGeom = document.createElement('geom');
  visualGeom.setAttribute('name', `${bodyName}_visual`);
  visualGeom.setAttribute('type', 'mesh');
  visualGeom.setAttribute('mesh', visualMeshName);
  visualGeom.setAttribute('contype', '0');
  visualGeom.setAttribute('conaffinity', '0');
  body.append(visualGeom);

  if (placement.collisionFile !== undefined) {
    const collisionGeom = document.createElement('geom');
    collisionGeom.setAttribute('name', `${bodyName}_collision`);
    collisionGeom.setAttribute('type', 'mesh');
    collisionGeom.setAttribute('mesh', collisionMeshName);
    collisionGeom.setAttribute('rgba', '0.55 0.55 0.55 0.12');
    collisionGeom.setAttribute('group', '4');
    body.append(collisionGeom);
  }

  worldbody.append(body);
  return { xml: serialize(document), bodyName };
}

function quaternionForDirection(
  position: readonly [number, number, number],
  target: readonly [number, number, number],
): readonly [number, number, number, number] {
  let forward = [target[0] - position[0], target[1] - position[1], target[2] - position[2]];
  const length = Math.hypot(...forward);
  if (!Number.isFinite(length) || length < Number.EPSILON) return [1, 0, 0, 0];
  forward = forward.map((value) => value / length);
  const referenceUp = Math.abs(forward[2]) > 0.98 ? [0, 1, 0] : [0, 0, 1];
  const right = [
    forward[1] * referenceUp[2] - forward[2] * referenceUp[1],
    forward[2] * referenceUp[0] - forward[0] * referenceUp[2],
    forward[0] * referenceUp[1] - forward[1] * referenceUp[0],
  ];
  const rightLength = Math.hypot(...right);
  right.splice(0, right.length, ...right.map((value) => value / rightLength));
  const up = [
    right[1] * forward[2] - right[2] * forward[1],
    right[2] * forward[0] - right[0] * forward[2],
    right[0] * forward[1] - right[1] * forward[0],
  ];
  const zAxis = forward.map((value) => -value);
  const trace = right[0] + up[1] + zAxis[2];
  let w: number;
  let x: number;
  let y: number;
  let z: number;
  if (trace > 0) {
    const factor = 0.5 / Math.sqrt(trace + 1);
    w = 0.25 / factor;
    x = (up[2] - zAxis[1]) * factor;
    y = (zAxis[0] - right[2]) * factor;
    z = (right[1] - up[0]) * factor;
  } else if (right[0] > up[1] && right[0] > zAxis[2]) {
    const factor = 2 * Math.sqrt(1 + right[0] - up[1] - zAxis[2]);
    w = (up[2] - zAxis[1]) / factor;
    x = 0.25 * factor;
    y = (right[1] + up[0]) / factor;
    z = (right[2] + zAxis[0]) / factor;
  } else if (up[1] > zAxis[2]) {
    const factor = 2 * Math.sqrt(1 + up[1] - right[0] - zAxis[2]);
    w = (zAxis[0] - right[2]) / factor;
    x = (right[1] + up[0]) / factor;
    y = 0.25 * factor;
    z = (up[2] + zAxis[1]) / factor;
  } else {
    const factor = 2 * Math.sqrt(1 + zAxis[2] - right[0] - up[1]);
    w = (right[1] - up[0]) / factor;
    x = (right[2] + zAxis[0]) / factor;
    y = (up[2] + zAxis[1]) / factor;
    z = 0.25 * factor;
  }
  return [w, x, y, z];
}

/** Adds a named world camera aimed at a target point. */
export function insertCamera(
  xml: string,
  placement: CameraPlacement,
): CameraInsertionResult | null {
  if (
    !placement.name.trim() ||
    !hasFiniteValues(placement.position) ||
    !hasFiniteValues(placement.target) ||
    !Number.isFinite(placement.fovy) ||
    placement.fovy <= 0 ||
    placement.fovy >= 180
  ) {
    return null;
  }
  const document = parse(xml);
  const worldbody = document?.querySelector(':scope > worldbody');
  if (!document || !worldbody) return null;
  const camera = document.createElement('camera');
  const nodeName = uniqueName(document, placement.name.trim());
  camera.setAttribute('name', nodeName);
  camera.setAttribute('pos', numberList(placement.position));
  camera.setAttribute(
    'quat',
    numberList(quaternionForDirection(placement.position, placement.target)),
  );
  camera.setAttribute('fovy', String(placement.fovy));
  worldbody.append(camera);
  return { xml: serialize(document), nodeName };
}

const CAMERA_ORIENTATION_ATTRIBUTES = ['quat', 'euler', 'axisangle', 'xyaxes', 'zaxis'] as const;

/**
 * Re-aims an existing world camera in place, keeping its name, resolution, and other attributes,
 * so recordings and profiles that reference the camera keep working. Tracking modes are replaced
 * by a fixed pose. Returns null for missing, duplicate, or body-mounted cameras.
 */
export function aimCamera(
  xml: string,
  cameraName: string,
  aim: Omit<CameraPlacement, 'name' | 'fovy'> & { fovy?: number },
): string | null {
  if (
    !hasFiniteValues(aim.position) ||
    !hasFiniteValues(aim.target) ||
    Math.hypot(
      aim.target[0] - aim.position[0],
      aim.target[1] - aim.position[1],
      aim.target[2] - aim.position[2],
    ) < Number.EPSILON ||
    (aim.fovy !== undefined && (!Number.isFinite(aim.fovy) || aim.fovy <= 0 || aim.fovy >= 180))
  ) {
    return null;
  }
  const document = parse(xml);
  if (!document) return null;
  const cameras = [...document.getElementsByTagName('camera')].filter(
    (element) => element.getAttribute('name') === cameraName,
  );
  const camera = cameras.length === 1 ? cameras[0] : undefined;
  if (!camera || camera.parentElement?.tagName !== 'worldbody') return null;
  for (const attribute of CAMERA_ORIENTATION_ATTRIBUTES) camera.removeAttribute(attribute);
  camera.removeAttribute('mode');
  camera.removeAttribute('target');
  camera.setAttribute('pos', numberList(aim.position));
  camera.setAttribute('quat', numberList(quaternionForDirection(aim.position, aim.target)));
  if (aim.fovy !== undefined) camera.setAttribute('fovy', String(aim.fovy));
  return serialize(document);
}

export function insertMountedCamera(
  xml: string,
  placement: MountedCameraPlacement,
): CameraInsertionResult | null {
  const quaternionLength = Math.hypot(...placement.rotation);
  if (
    !placement.name.trim() ||
    placement.parent.mjIndex <= 0 ||
    !hasFiniteValues(placement.position) ||
    !hasFiniteValues(placement.rotation) ||
    !Number.isFinite(quaternionLength) ||
    quaternionLength < Number.EPSILON ||
    !Number.isFinite(placement.fovy) ||
    placement.fovy <= 0 ||
    placement.fovy >= 180
  ) {
    return null;
  }
  const document = parse(xml);
  const body = document ? elementFor(document, placement.parent) : null;
  if (!document || !body || body.tagName !== 'body') return null;

  const camera = document.createElement('camera');
  const nodeName = uniqueName(document, placement.name.trim());
  camera.setAttribute('name', nodeName);
  camera.setAttribute('pos', numberList(placement.position));
  camera.setAttribute('quat', numberList(placement.rotation));
  camera.setAttribute('fovy', String(placement.fovy));
  body.append(camera);
  return { xml: serialize(document), nodeName };
}

/** Adds a named world light with a MuJoCo-compatible directional, point, or spot type. */
export function insertLight(xml: string, placement: LightPlacement): LightInsertionResult | null {
  if (
    !placement.name.trim() ||
    !hasFiniteValues(placement.position) ||
    !hasFiniteValues(placement.direction)
  ) {
    return null;
  }
  const document = parse(xml);
  const worldbody = document?.querySelector(':scope > worldbody');
  if (!document || !worldbody) return null;
  const light = document.createElement('light');
  const nodeName = uniqueName(document, placement.name.trim());
  light.setAttribute('name', nodeName);
  light.setAttribute('pos', numberList(placement.position));
  light.setAttribute('dir', numberList(placement.direction));
  light.setAttribute('diffuse', '1 0.86 0.68');
  light.setAttribute('ambient', '0.08 0.08 0.08');
  light.setAttribute('specular', '0.45 0.45 0.45');
  light.setAttribute('castshadow', 'true');
  if (placement.type === 'directional') {
    light.setAttribute('directional', 'true');
  } else {
    light.setAttribute('directional', 'false');
    light.setAttribute('cutoff', placement.type === 'spot' ? '45' : '180');
    light.setAttribute('exponent', placement.type === 'spot' ? '10' : '0');
  }
  worldbody.append(light);
  return { xml: serialize(document), nodeName };
}

/** The scene's camera clipping distances in meters (see `@mujoco-studio/mujoco` cameraClipping). */
export function getCameraClipping(xml: string): CameraClipping {
  const document = parse(xml);
  const numeric = document ? cameraClippingElement(document) : null;
  const values = numeric?.getAttribute('data')?.trim().split(/\s+/).map(Number);
  return normalizeCameraClipping(values);
}

/** Sets one clipping distance, in meters; null when the value is invalid for the other one. */
export function setCameraClipping(
  xml: string,
  attribute: CameraClippingAttribute,
  value: string,
): string | null {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return null;
  const clipping = { ...getCameraClipping(xml), [attribute]: number };
  if (clipping.far <= clipping.near) return null;
  const document = parse(xml);
  if (!document) return null;
  let numeric = cameraClippingElement(document);
  if (!numeric) {
    let custom = document.querySelector(':scope > custom');
    if (!custom) {
      custom = mjcfElement(document, 'custom');
      document.documentElement.append(custom);
    }
    numeric = mjcfElement(document, 'numeric');
    numeric.setAttribute('name', CAMERA_CLIPPING_NUMERIC);
    custom.append(numeric);
  }
  numeric.setAttribute('data', `${clipping.near} ${clipping.far}`);
  return serialize(document);
}

function cameraClippingElement(document: Document): Element | null {
  return (
    [...document.querySelectorAll(':scope > custom > numeric')].find(
      (element) => element.getAttribute('name') === CAMERA_CLIPPING_NUMERIC,
    ) ?? null
  );
}

export function setLightType(
  xml: string,
  node: SceneNode,
  type: LightInsertionType,
): string | null {
  if (node.kind !== 'light') return null;
  const document = parse(xml);
  const element = document ? elementFor(document, node) : null;
  if (!document || !element) return null;
  if (type === 'directional') {
    element.setAttribute('directional', 'true');
    element.removeAttribute('cutoff');
    element.removeAttribute('exponent');
  } else {
    element.setAttribute('directional', 'false');
    element.setAttribute('cutoff', type === 'spot' ? '45' : '180');
    element.setAttribute('exponent', type === 'spot' ? '10' : '0');
  }
  return serialize(document);
}

const ROBOT_ROOT_CHILDREN = new Set([
  'compiler',
  'default',
  'asset',
  'worldbody',
  'actuator',
  'equality',
  'contact',
  'tendon',
  'sensor',
  'custom',
]);
const ROBOT_REFERENCE_ATTRIBUTES = new Set([
  'actuator',
  'body',
  'body1',
  'body2',
  'camera',
  'geom',
  'geom1',
  'geom2',
  'joint',
  'material',
  'mesh',
  'site',
  'site1',
  'site2',
  'tendon',
  'texture',
  'objname',
  'refname',
]);

type CompilerAngle = 'degree' | 'radian';

function compilerAngleFor(root: Element): CompilerAngle {
  return directChildren(root, 'compiler')[0]?.getAttribute('angle') === 'radian'
    ? 'radian'
    : 'degree';
}

/** Unit of the MJCF's `euler`/`axisangle` values (`<compiler angle>`, MuJoCo default degree). */
export function compilerAngleUnit(xml: string): CompilerAngle {
  const document = parse(xml);
  return document ? compilerAngleFor(document.documentElement) : 'degree';
}

function angleScale(source: CompilerAngle, destination: CompilerAngle): number {
  if (source === destination) return 1;
  return source === 'radian' ? 180 / Math.PI : Math.PI / 180;
}

function scaleAttribute(element: Element, attribute: string, scale: number, index?: number): void {
  const value = element.getAttribute(attribute);
  if (!value) return;
  const values = value.trim().split(/\s+/).map(Number);
  if (!values.length || values.some((entry) => !Number.isFinite(entry))) return;
  if (index === undefined) {
    for (let valueIndex = 0; valueIndex < values.length; valueIndex++) {
      values[valueIndex] *= scale;
    }
  } else if (values[index] !== undefined) {
    values[index] *= scale;
  }
  element.setAttribute(attribute, numberList(values));
}

function scaleRobotAngularAttributes(element: Element, scale: number): void {
  if (scale === 1) return;
  if (element.tagName === 'joint' && element.getAttribute('type') !== 'slide') {
    scaleAttribute(element, 'range', scale);
    scaleAttribute(element, 'ref', scale);
  }
  scaleAttribute(element, 'euler', scale);
  scaleAttribute(element, 'axisangle', scale, 3);
  for (const child of [...element.children]) {
    scaleRobotAngularAttributes(child, scale);
  }
}

function robotNamePart(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^[_-]+|[_-]+$/g, '');
  return normalized || 'so101';
}

function robotFileStem(value: string): string {
  return (
    value
      .replaceAll('\\', '/')
      .split('/')
      .at(-1)
      ?.replace(/\.[^.]+$/, '') || 'mesh'
  );
}

function directChildren(element: Element, tagName: string): Element[] {
  return [...element.children].filter((child) => child.tagName === tagName);
}

function hasRobotPrefix(value: string | null, prefix: string): boolean {
  return Boolean(value?.split(/\s+/).some((part) => part.startsWith(`${prefix}__`)));
}

function uniqueRobotPrefix(document: Document, robotId: string): string {
  const names = new Set(
    [...document.querySelectorAll('[name]')]
      .map((element) => element.getAttribute('name'))
      .filter((name): name is string => Boolean(name)),
  );
  const base = `robot_${robotNamePart(robotId)}`;
  let prefix = base;
  let index = 2;
  while ([...names].some((name) => name === `${prefix}__root` || name.startsWith(`${prefix}__`))) {
    prefix = `${base}_${index++}`;
  }
  return prefix;
}

function robotRootForElement(element: Element): Element | null {
  let current: Element | null = element.tagName === 'body' ? element : element.closest('body');
  while (current) {
    const name = current.getAttribute('name');
    if (name && name.startsWith('robot_') && name.endsWith('__root')) return current;
    current = current.parentElement?.closest('body') ?? null;
  }
  return null;
}

function transformRobotElement(
  element: Element,
  prefix: string,
  names: ReadonlyMap<string, string>,
  classes: ReadonlyMap<string, string>,
  meshes: ReadonlyMap<string, string>,
  meshFiles: ReadonlyMap<string, string>,
): boolean {
  const originalFile = element.getAttribute('file');
  if (element.tagName === 'mesh') {
    if (!originalFile) return false;
    const originalName = element.getAttribute('name') ?? robotFileStem(originalFile);
    const meshName = meshes.get(originalName);
    if (!meshName) return false;
    const runtimeFile = meshFiles.get(originalFile) ?? originalFile;
    if (!hasSafeAssetPath(runtimeFile)) return false;
    element.setAttribute('name', meshName);
    element.setAttribute('file', runtimeFile);
  } else {
    const name = element.getAttribute('name');
    if (name) {
      const replacement = names.get(name);
      if (!replacement) return false;
      element.setAttribute('name', replacement);
    }
  }

  for (const attribute of [...element.attributes]) {
    const value = attribute.value;
    if (attribute.name === 'class' || attribute.name === 'childclass') {
      const replacement = classes.get(value);
      if (!replacement) return false;
      element.setAttribute(attribute.name, replacement);
    } else if (attribute.name === 'file' && element.tagName === 'texture') {
      const runtimeFile = meshFiles.get(value) ?? value;
      if (!hasSafeAssetPath(runtimeFile)) return false;
      element.setAttribute('file', runtimeFile);
    } else if (attribute.name === 'file' && element.tagName !== 'mesh') {
      if (!hasSafeAssetPath(value)) return false;
    } else if (ROBOT_REFERENCE_ATTRIBUTES.has(attribute.name)) {
      const replacement = attribute.name === 'mesh' ? meshes.get(value) : names.get(value);
      if (!replacement) return false;
      element.setAttribute(attribute.name, replacement);
    }
  }

  for (const child of [...element.children]) {
    if (!transformRobotElement(child, prefix, names, classes, meshes, meshFiles)) return false;
  }
  return true;
}

function appendRobotSectionChildren(
  destination: Element,
  source: Element,
  prefix: string,
  names: ReadonlyMap<string, string>,
  classes: ReadonlyMap<string, string>,
  meshes: ReadonlyMap<string, string>,
  meshFiles: ReadonlyMap<string, string>,
): boolean {
  for (const child of [...source.children]) {
    const clone = child.cloneNode(true) as Element;
    if (!transformRobotElement(clone, prefix, names, classes, meshes, meshFiles)) return false;
    destination.append(clone);
  }
  return true;
}

/** Inserts a fixed-base robot model while preserving its defaults, meshes, materials, and actuators. */
export function insertRobotModel(
  xml: string,
  placement: RobotPlacement,
): RobotInsertionResult | null {
  if (
    !placement.robotId.trim() ||
    !placement.name.trim() ||
    !hasFiniteValues(placement.position) ||
    !hasFiniteValues(placement.rotation)
  ) {
    return null;
  }

  const document = parse(xml);
  const robotDocument = parse(placement.mjcf);
  const worldbody = document?.querySelector(':scope > worldbody');
  const robotRoot = robotDocument?.documentElement;
  if (!document || !robotDocument || !worldbody || robotRoot?.tagName !== 'mujoco') return null;

  const unsupported = [...robotRoot.children].filter(
    (child) => !ROBOT_ROOT_CHILDREN.has(child.tagName),
  );
  if (unsupported.length) return null;

  const robotWorldbody = directChildren(robotRoot, 'worldbody')[0];
  const robotAsset = directChildren(robotRoot, 'asset')[0];
  const robotActuator = directChildren(robotRoot, 'actuator')[0];
  const robotDefaults = directChildren(robotRoot, 'default');
  const robotEquality = directChildren(robotRoot, 'equality')[0];
  const robotContact = directChildren(robotRoot, 'contact')[0];
  const robotTendon = directChildren(robotRoot, 'tendon')[0];
  const robotSensor = directChildren(robotRoot, 'sensor')[0];
  const robotCustom = directChildren(robotRoot, 'custom')[0];
  if (!robotWorldbody || !robotAsset || !robotActuator || !robotDefaults.length) {
    return null;
  }

  const sourceAngle = compilerAngleFor(robotRoot);
  const destinationAngle = compilerAngleFor(document.documentElement);
  const robotAngleScale = angleScale(sourceAngle, destinationAngle);

  const prefix = uniqueRobotPrefix(document, placement.robotId);
  const bodyName = `${prefix}__root`;
  const robotBodies = [...robotWorldbody.children];
  if (!robotBodies.length || robotBodies.some((child) => child.tagName !== 'body')) return null;
  const singleFreeBody =
    robotBodies.length === 1 &&
    [...robotBodies[0].children].some(
      (child) =>
        child.tagName === 'freejoint' ||
        (child.tagName === 'joint' && child.getAttribute('type') === 'free'),
    )
      ? robotBodies[0]
      : null;
  const names = new Map<string, string>();
  const classes = new Map<string, string>();
  const meshes = new Map<string, string>();

  for (const element of robotRoot.querySelectorAll('[name]')) {
    const name = element.getAttribute('name');
    if (name) names.set(name, `${prefix}__${name}`);
  }
  const freeBodyName = singleFreeBody?.getAttribute('name');
  if (freeBodyName) names.set(freeBodyName, bodyName);
  for (const element of robotRoot.querySelectorAll('[class], [childclass]')) {
    for (const attributeName of ['class', 'childclass']) {
      const value = element.getAttribute(attributeName);
      if (value) classes.set(value, `${prefix}__${value}`);
    }
  }
  for (const mesh of robotAsset.querySelectorAll(':scope > mesh')) {
    const file = mesh.getAttribute('file');
    if (!file) return null;
    const name = mesh.getAttribute('name') ?? robotFileStem(file);
    if (meshes.has(name)) return null;
    meshes.set(name, `${prefix}__${name}`);
  }
  if (!meshes.size) return null;

  const destinationAsset =
    directChildren(document.documentElement, 'asset')[0] ??
    document.documentElement.appendChild(document.createElement('asset'));
  if (
    !appendRobotSectionChildren(
      destinationAsset,
      robotAsset,
      prefix,
      names,
      classes,
      meshes,
      placement.meshFiles,
    )
  ) {
    return null;
  }
  // <default> can only appear once at the top level; merge the robot's namespaced classes into
  // the destination's existing default section instead of appending a second one.
  const destinationDefault =
    directChildren(document.documentElement, 'default')[0] ??
    document.documentElement.appendChild(document.createElement('default'));
  for (const robotDefault of robotDefaults) {
    const clone = robotDefault.cloneNode(true) as Element;
    scaleRobotAngularAttributes(clone, robotAngleScale);
    if (!transformRobotElement(clone, prefix, names, classes, meshes, placement.meshFiles)) {
      return null;
    }
    for (const nestedDefault of [...clone.children]) destinationDefault.append(nestedDefault);
  }

  const destinationActuator =
    directChildren(document.documentElement, 'actuator')[0] ??
    document.documentElement.appendChild(document.createElement('actuator'));
  for (const actuator of [...robotActuator.children]) {
    scaleRobotAngularAttributes(actuator, robotAngleScale);
  }
  if (
    !appendRobotSectionChildren(
      destinationActuator,
      robotActuator,
      prefix,
      names,
      classes,
      meshes,
      placement.meshFiles,
    )
  ) {
    return null;
  }

  for (const [sectionName, source] of [
    ['equality', robotEquality],
    ['contact', robotContact],
    ['tendon', robotTendon],
    ['sensor', robotSensor],
    ['custom', robotCustom],
  ] as const) {
    if (!source || source.children.length === 0) continue;
    const destination =
      directChildren(document.documentElement, sectionName)[0] ??
      document.documentElement.appendChild(document.createElement(sectionName));
    for (const child of [...source.children]) scaleRobotAngularAttributes(child, robotAngleScale);
    if (
      !appendRobotSectionChildren(
        destination,
        source,
        prefix,
        names,
        classes,
        meshes,
        placement.meshFiles,
      )
    ) {
      return null;
    }
  }

  // A body with its own <freejoint> must be a direct child of <worldbody>; the wrapper below
  // would nest it one level deeper and MuJoCo would reject the free joint.
  if (singleFreeBody) {
    const clone = singleFreeBody.cloneNode(true) as Element;
    scaleRobotAngularAttributes(clone, robotAngleScale);
    if (!transformRobotElement(clone, prefix, names, classes, meshes, placement.meshFiles)) {
      return null;
    }
    clone.setAttribute('name', bodyName);
    clone.setAttribute('pos', numberList(placement.position));
    clone.setAttribute('quat', numberList(placement.rotation));
    worldbody.append(clone);
    return { xml: serialize(document), bodyName, instancePrefix: prefix };
  }

  const wrapper = document.createElement('body');
  wrapper.setAttribute('name', bodyName);
  wrapper.setAttribute('pos', numberList(placement.position));
  wrapper.setAttribute('quat', numberList(placement.rotation));
  for (const robotBody of robotBodies) {
    const clone = robotBody.cloneNode(true) as Element;
    scaleRobotAngularAttributes(clone, robotAngleScale);
    if (!transformRobotElement(clone, prefix, names, classes, meshes, placement.meshFiles)) {
      return null;
    }
    wrapper.append(clone);
  }
  worldbody.append(wrapper);
  return { xml: serialize(document), bodyName, instancePrefix: prefix };
}

/** Returns the robot instance prefix owning a scene node, if the node belongs to one. */
export function robotInstancePrefixForNode(xml: string, node: SceneNode): string | null {
  const document = parse(xml);
  const element = document ? elementFor(document, node) : null;
  const root = element ? robotRootForElement(element) : null;
  const name = root?.getAttribute('name');
  return name && name.endsWith('__root') ? name.slice(0, -'__root'.length) : null;
}

/** Removes a complete robot instance and its namespaced global declarations. */
export function deleteRobotInstance(xml: string, node: SceneNode): string | null {
  const document = parse(xml);
  const element = document ? elementFor(document, node) : null;
  const root = element ? robotRootForElement(element) : null;
  const rootName = root?.getAttribute('name');
  if (!document || !root || !rootName || !rootName.endsWith('__root')) return null;
  const prefix = rootName.slice(0, -'__root'.length);
  root.remove();

  for (const defaultSection of document.querySelectorAll('default[class]')) {
    if (hasRobotPrefix(defaultSection.getAttribute('class'), prefix)) {
      defaultSection.remove();
    }
  }
  const assetSection = directChildren(document.documentElement, 'asset')[0];
  for (const child of assetSection ? [...assetSection.children] : []) {
    if (hasRobotPrefix(child.getAttribute('name'), prefix)) child.remove();
  }
  const actuatorSection = directChildren(document.documentElement, 'actuator')[0];
  for (const child of actuatorSection ? [...actuatorSection.children] : []) {
    if (
      hasRobotPrefix(child.getAttribute('name'), prefix) ||
      [...child.attributes].some((attribute) => hasRobotPrefix(attribute.value, prefix))
    ) {
      child.remove();
    }
  }
  for (const sectionName of ['contact', 'tendon', 'sensor', 'custom']) {
    const section = directChildren(document.documentElement, sectionName)[0];
    for (const child of section ? [...section.children] : []) {
      if (
        hasRobotPrefix(child.getAttribute('name'), prefix) ||
        [...child.attributes].some((attribute) => hasRobotPrefix(attribute.value, prefix))
      ) {
        child.remove();
      }
    }
    if (section && section.children.length === 0) section.remove();
  }
  return serialize(document);
}

/** Inserts a movable MuJoCo primitive as a new body in the scene. */
export function insertPrimitiveObject(
  xml: string,
  placement: PrimitiveObjectPlacement,
): PrimitiveObjectInsertionResult | null {
  const requiredSizeCount =
    placement.type === 'sphere'
      ? 1
      : placement.type === 'box' || placement.type === 'ellipsoid'
        ? 3
        : 2;
  if (
    !placement.name.trim() ||
    !hasFiniteValues(placement.position) ||
    !hasFiniteValues(placement.rotation) ||
    !hasFiniteValues(placement.size) ||
    placement.size.slice(0, requiredSizeCount).some((value) => value <= 0) ||
    !hasFiniteValues(placement.rgba) ||
    placement.rgba.some((value) => value < 0 || value > 1) ||
    !Number.isFinite(placement.mass) ||
    placement.mass <= 0 ||
    !hasFiniteValues(placement.friction) ||
    placement.friction.some((value) => value < 0)
  ) {
    return null;
  }

  const document = parse(xml);
  const worldbody = document?.querySelector(':scope > worldbody');
  if (!document || !worldbody) return null;

  const bodyName = uniqueName(document, identifier(placement.name, 'primitive_object'));
  const body = document.createElement('body');
  body.setAttribute('name', bodyName);
  body.setAttribute('pos', numberList(placement.position));
  body.setAttribute('euler', numberList(placement.rotation));

  if (!placement.fixed) body.append(document.createElement('freejoint'));

  const geom = document.createElement('geom');
  geom.setAttribute('name', uniqueName(document, `${bodyName}_geom`));
  geom.setAttribute('type', placement.type);
  geom.setAttribute('size', numberList(placement.size.slice(0, requiredSizeCount)));
  geom.setAttribute('rgba', numberList(placement.rgba));
  geom.setAttribute('mass', String(placement.mass));
  geom.setAttribute('friction', numberList(placement.friction));
  body.append(geom);

  worldbody.append(body);
  return { xml: serialize(document), bodyName };
}

export interface TablePlacement {
  name: string;
  dimensions: readonly [number, number, number];
  position: readonly [number, number, number];
  rotation: readonly [number, number, number];
  topThickness: number;
  legWidth: number;
}

export function insertTable(
  xml: string,
  placement: TablePlacement,
): PrimitiveObjectInsertionResult | null {
  const [width, depth, height] = placement.dimensions;
  const { topThickness, legWidth } = placement;
  if (
    !hasFiniteValues(placement.dimensions) ||
    placement.dimensions.some((value) => value <= 0) ||
    !Number.isFinite(topThickness) ||
    topThickness <= 0 ||
    topThickness >= height ||
    !Number.isFinite(legWidth) ||
    legWidth <= 0 ||
    legWidth * 2 >= Math.min(width, depth)
  ) {
    throw new Error(
      'Table dimensions must be positive; topThickness must be less than height and two leg widths must fit within both width and depth.',
    );
  }
  const inserted = insertPrimitiveObject(xml, {
    name: placement.name,
    type: 'box',
    size: [width / 2, depth / 2, topThickness / 2],
    position: placement.position,
    rotation: placement.rotation,
    rgba: [0.6, 0.4, 0.25, 1],
    mass: 1,
    friction: [1, 0.005, 0.0001],
    fixed: true,
  });
  if (!inserted) return null;
  const document = parse(inserted.xml);
  const body = document
    ? [...document.getElementsByTagName('body')].find(
        (element) => element.getAttribute('name') === inserted.bodyName,
      )
    : null;
  const top = body?.querySelector('geom');
  if (!document || !body || !top) return null;
  top.setAttribute('pos', numberList([0, 0, height - topThickness / 2]));
  const legHeight = height - topThickness;
  let index = 0;
  for (const x of [-1, 1]) {
    for (const y of [-1, 1]) {
      const leg = top.cloneNode(true) as Element;
      leg.setAttribute('name', uniqueName(document, `${inserted.bodyName}_leg_${++index}`));
      leg.setAttribute('size', numberList([legWidth / 2, legWidth / 2, legHeight / 2]));
      leg.setAttribute(
        'pos',
        numberList([(x * (width - legWidth)) / 2, (y * (depth - legWidth)) / 2, legHeight / 2]),
      );
      body.append(leg);
    }
  }
  return { xml: serialize(document), bodyName: inserted.bodyName };
}

export interface ContainerPlacement {
  name: string;
  /** Inner width (X) and depth (Y), meters. */
  inner: readonly [number, number];
  wallHeight: number;
  wallThickness: number;
  /** Centre of the container's underside. */
  position: readonly [number, number, number];
  rotation: readonly [number, number, number];
  rgba: readonly [number, number, number, number];
  mass: number;
  fixed: boolean;
}

/**
 * An open-top tray: a floor and four walls in one body, plus the `<body>__generation_interior`
 * site the pick-and-place task uses as the placement target (like the SO-101 sample container).
 */
export function insertContainer(
  xml: string,
  placement: ContainerPlacement,
): PrimitiveObjectInsertionResult | null {
  const [innerWidth, innerDepth] = placement.inner;
  const { wallHeight, wallThickness: wall } = placement;
  if (
    !hasFiniteValues(placement.inner) ||
    placement.inner.some((value) => value <= 0) ||
    !Number.isFinite(wallHeight) ||
    wallHeight <= 0 ||
    !Number.isFinite(wall) ||
    wall <= 0
  ) {
    throw new Error('Container inner size, wallHeight, and wallThickness must be positive.');
  }
  const halfWidth = innerWidth / 2 + wall;
  const halfDepth = innerDepth / 2 + wall;
  const inserted = insertPrimitiveObject(xml, {
    name: placement.name,
    type: 'box',
    size: [halfWidth, halfDepth, wall / 2],
    position: placement.position,
    rotation: placement.rotation,
    rgba: placement.rgba,
    mass: placement.mass / 5,
    friction: [1, 0.005, 0.0001],
    fixed: placement.fixed,
  });
  if (!inserted) return null;
  const document = parse(inserted.xml);
  const body = document
    ? [...document.getElementsByTagName('body')].find(
        (element) => element.getAttribute('name') === inserted.bodyName,
      )
    : null;
  const floor = body?.querySelector('geom');
  if (!document || !body || !floor) return null;
  floor.setAttribute('name', uniqueName(document, `${inserted.bodyName}_bottom`));
  floor.setAttribute('pos', numberList([0, 0, wall / 2]));
  const wallZ = wall + wallHeight / 2;
  const walls: [string, number[], number[]][] = [
    ['front', [0, -(innerDepth + wall) / 2, wallZ], [halfWidth, wall / 2, wallHeight / 2]],
    ['back', [0, (innerDepth + wall) / 2, wallZ], [halfWidth, wall / 2, wallHeight / 2]],
    ['left', [-(innerWidth + wall) / 2, 0, wallZ], [wall / 2, innerDepth / 2, wallHeight / 2]],
    ['right', [(innerWidth + wall) / 2, 0, wallZ], [wall / 2, innerDepth / 2, wallHeight / 2]],
  ];
  for (const [side, pos, size] of walls) {
    const geom = floor.cloneNode(true) as Element;
    geom.setAttribute('name', uniqueName(document, `${inserted.bodyName}_${side}`));
    geom.setAttribute('pos', numberList(pos));
    geom.setAttribute('size', numberList(size));
    body.append(geom);
  }
  const site = mjcfElement(document, 'site');
  site.setAttribute('name', `${inserted.bodyName}__generation_interior`);
  site.setAttribute('pos', numberList([0, 0, wall + wallHeight / 2]));
  site.setAttribute('size', numberList([innerWidth / 2, innerDepth / 2, 0.001]));
  site.setAttribute('rgba', '0 1 0 0');
  body.insertBefore(site, floor);
  return { xml: serialize(document), bodyName: inserted.bodyName };
}

export const SPLAT_BACKDROP_FIELD = `${SPLAT_BACKDROP_BODY}_heightfield`;
export const SPLAT_BACKDROP_GEOM = `${SPLAT_BACKDROP_BODY}_geom`;
/**
 * True for the backdrop body and its generated heightfield geom, which only the Splat panel may
 * change. The backdrop never collides: physics uses ordinary geometry such as splat tables.
 */
export function isSplatBackdropNode(node: Pick<SceneNode, 'kind' | 'name'>): boolean {
  return (
    (node.kind === 'body' && node.name === SPLAT_BACKDROP_BODY) ||
    (node.kind === 'geom' && node.name === SPLAT_BACKDROP_GEOM)
  );
}

/** MJCF element in the document's own namespace (none), not the HTML namespace. */
function mjcfElement(document: Document, name: string): Element {
  return document.createElementNS(document.documentElement.namespaceURI, name);
}

function backdropBody(worldbody: Element): Element | null {
  return (
    directChildren(worldbody, 'body').find(
      (element) => element.getAttribute('name') === SPLAT_BACKDROP_BODY,
    ) ?? null
  );
}

/** Whether the MJCF has the backdrop body with its heightfield geom and asset. */
export function hasSplatBackdrop(xml: string): boolean {
  const document = parse(xml);
  const worldbody = document?.querySelector(':scope > worldbody');
  const body = worldbody ? backdropBody(worldbody) : null;
  return Boolean(
    document &&
    body &&
    body.querySelector(`:scope > geom[hfield="${SPLAT_BACKDROP_FIELD}"]`) &&
    document.querySelector(`:scope > asset > hfield[name="${SPLAT_BACKDROP_FIELD}"]`),
  );
}

/** True when the generated heightfield and its geom already match the saved backdrop. */
export function splatBackdropHeightfieldMatches(xml: string, expectedXml: string): boolean {
  const current = parse(xml);
  const expected = parse(expectedXml);
  const currentWorldbody = current?.querySelector(':scope > worldbody');
  const expectedWorldbody = expected?.querySelector(':scope > worldbody');
  const currentBody = currentWorldbody ? backdropBody(currentWorldbody) : null;
  const expectedBody = expectedWorldbody ? backdropBody(expectedWorldbody) : null;
  const currentGeom = currentBody?.querySelector(':scope > geom');
  const expectedGeom = expectedBody?.querySelector(':scope > geom');
  const currentField = current?.querySelector(
    `:scope > asset > hfield[name="${SPLAT_BACKDROP_FIELD}"]`,
  );
  const expectedField = expected?.querySelector(
    `:scope > asset > hfield[name="${SPLAT_BACKDROP_FIELD}"]`,
  );
  return Boolean(
    currentBody &&
    expectedBody &&
    currentGeom &&
    expectedGeom &&
    currentField &&
    expectedField &&
    ['nrow', 'ncol', 'size', 'elevation'].every(
      (attribute) => currentField.getAttribute(attribute) === expectedField.getAttribute(attribute),
    ) &&
    ['pos', 'contype', 'conaffinity'].every(
      (attribute) => currentGeom.getAttribute(attribute) === expectedGeom.getAttribute(attribute),
    ) &&
    directChildren(currentBody, 'geom').length === directChildren(expectedBody, 'geom').length,
  );
}

/**
 * Raises (or lowers) the named worldbody-level bodies and geoms by `dz` in their authored `pos`,
 * e.g. a splat table whose top moved and the free objects resting on it. Returns the input when
 * nothing changes.
 */
export function shiftWorldElements(xml: string, names: readonly string[], dz: number): string {
  if (!names.length || !Number.isFinite(dz) || dz === 0) return xml;
  const document = parse(xml);
  const worldbody = document?.querySelector(':scope > worldbody');
  if (!document || !worldbody) return xml;
  const wanted = new Set(names);
  let changed = false;
  for (const element of [
    ...directChildren(worldbody, 'body'),
    ...directChildren(worldbody, 'geom'),
  ]) {
    if (!wanted.has(element.getAttribute('name') ?? '')) continue;
    const pos = (element.getAttribute('pos') ?? '0 0 0').trim().split(/\s+/).map(Number);
    if (pos.length !== 3 || !hasFiniteValues(pos)) continue;
    element.setAttribute('pos', numberList([pos[0], pos[1], pos[2] + dz]));
    changed = true;
  }
  return changed ? serialize(document) : xml;
}

/** Authored `pos` of the backdrop body, or null when the body is missing. */
export function splatBackdropBodyPosition(xml: string): Vec3Tuple | null {
  const document = parse(xml);
  const worldbody = document?.querySelector(':scope > worldbody');
  const body = worldbody ? backdropBody(worldbody) : null;
  if (!body) return null;
  const values = (body.getAttribute('pos') ?? '0 0 0').trim().split(/\s+/).map(Number);
  return values.length === 3 && values.every(Number.isFinite)
    ? [values[0], values[1], values[2]]
    : [0, 0, 0];
}

/**
 * Splat tables are the boxes you place over a scan's tables in Build > Splat: worldbody geoms named
 * `scan_table`, `scan_table_2`, ... The Python scene check matches the same names.
 */
export const SPLAT_TABLE_NAME = 'scan_table';
const SPLAT_TABLE_PATTERN = /^scan_table(_\d+)?$/;

/** Default box of a new splat table: 1.2 m x 0.8 m, 4 cm thick. */
export const SPLAT_TABLE_HALF_SIZE: Vec3Tuple = [0.6, 0.4, 0.02];
/** Height of a new splat table's top above the scanned floor. */
export const SPLAT_TABLE_HEIGHT = 0.75;

export function isSplatTableName(name: string): boolean {
  return SPLAT_TABLE_PATTERN.test(name);
}

/** True for a splat table geom; the viewport draws these only on the Splat tab. */
export function isSplatTableNode(node: Pick<SceneNode, 'kind' | 'name'>): boolean {
  return node.kind === 'geom' && isSplatTableName(node.name);
}

/**
 * Adds a splat table: a static box in the worldbody with its top face centered at `top`, hidden
 * from cameras (group `CAMERA_HIDDEN_GEOM_GROUP`) and see-through in the editor, so recorded images
 * show the scanned table while physics uses the box. It gets the next free `scan_table` name.
 */
export function insertSplatTable(
  xml: string,
  top: Vec3Tuple,
  half: Vec3Tuple = SPLAT_TABLE_HALF_SIZE,
  /** Rotation about world Z, radians. */
  yaw = 0,
): { xml: string; name: string } | null {
  if (!isFiniteVec3(top) || !isFiniteVec3(half) || half.some((value) => value <= 0)) return null;
  if (!Number.isFinite(yaw)) return null;
  const document = parse(xml);
  const worldbody = document?.querySelector(':scope > worldbody');
  if (!document || !worldbody) return null;
  const name = uniqueName(document, SPLAT_TABLE_NAME);
  const geom = mjcfElement(document, 'geom');
  geom.setAttribute('name', name);
  geom.setAttribute('type', 'box');
  geom.setAttribute('pos', numberList([top[0], top[1], top[2] - half[2]]));
  geom.setAttribute('size', numberList(half));
  if (yaw) geom.setAttribute('quat', numberList([Math.cos(yaw / 2), 0, 0, Math.sin(yaw / 2)]));
  geom.setAttribute('group', String(CAMERA_HIDDEN_GEOM_GROUP));
  geom.setAttribute('rgba', '0.45 0.7 1 0.3');
  worldbody.append(geom);
  return { xml: serialize(document), name };
}

/** Removes the generated splat backdrop (body and heightfield asset) from the MJCF. */
export function removeSplatBackdrop(xml: string): string {
  const document = parse(xml);
  const worldbody = document?.querySelector(':scope > worldbody');
  if (!document || !worldbody) return xml;
  backdropBody(worldbody)?.remove();
  document.querySelector(`:scope > asset > hfield[name="${SPLAT_BACKDROP_FIELD}"]`)?.remove();
  return serialize(document);
}

export interface SplatBackdropUpdate {
  /**
   * New body position. When the body already exists and this is omitted, its authored pose is
   * kept; a new body defaults to the origin. Orientation is kept unless `resetOrientation`.
   */
  bodyPosition?: Vec3Tuple;
  /** Drop any authored orientation so a newly loaded splat starts axis-aligned. */
  resetOrientation?: boolean;
}

/**
 * Writes the splat backdrop into the MJCF: one static body `rs_backdrop` (no joint) whose frame
 * is the splat's scaled PLY frame, holding an invisible, non-colliding hfield geom positioned in
 * that body frame (used to place things on the scan, never for physics). An existing body keeps
 * its name, pose, and place in the tree; only the hfield asset and geom are replaced.
 */
export function insertSplatBackdrop(
  xml: string,
  heightfield: SplatHeightfield,
  update: SplatBackdropUpdate = {},
): string | null {
  if (
    heightfield.nrow < 2 ||
    heightfield.ncol < 2 ||
    heightfield.data.length !== heightfield.nrow * heightfield.ncol ||
    !hasFiniteValues(heightfield.data) ||
    !hasFiniteValues(heightfield.size) ||
    heightfield.size.some((value) => value <= 0) ||
    !hasFiniteValues(heightfield.position) ||
    (update.bodyPosition && !isFiniteVec3(update.bodyPosition))
  ) {
    return null;
  }
  const document = parse(xml);
  const worldbody = document?.querySelector(':scope > worldbody');
  if (!document || !worldbody) return null;
  let asset = document.querySelector(':scope > asset');
  if (!asset) {
    asset = mjcfElement(document, 'asset');
    document.documentElement.insertBefore(asset, worldbody);
  }

  let field = asset.querySelector(`:scope > hfield[name="${SPLAT_BACKDROP_FIELD}"]`);
  if (!field) {
    field = mjcfElement(document, 'hfield');
    field.setAttribute('name', SPLAT_BACKDROP_FIELD);
    asset.append(field);
  }
  field.setAttribute('nrow', String(heightfield.nrow));
  field.setAttribute('ncol', String(heightfield.ncol));
  field.setAttribute('size', numberList(heightfield.size));
  // MuJoCo reads inline samples from `elevation` (not element text), listing rows from the +y
  // edge down; mjModel and SplatHeightfield.data store rows from the -y edge up.
  const rows: string[] = [];
  for (let row = heightfield.nrow - 1; row >= 0; row--) {
    rows.push(
      heightfield.data.slice(row * heightfield.ncol, (row + 1) * heightfield.ncol).join(' '),
    );
  }
  field.setAttribute('elevation', rows.join(' '));

  let body = backdropBody(worldbody);
  if (!body) {
    body = mjcfElement(document, 'body');
    body.setAttribute('name', SPLAT_BACKDROP_BODY);
    body.setAttribute('pos', numberList(update.bodyPosition ?? [0, 0, 0]));
    worldbody.append(body);
  } else if (update.bodyPosition) {
    body.setAttribute('pos', numberList(update.bodyPosition));
  }
  if (update.resetOrientation) {
    for (const attribute of ['quat', 'euler', 'axisangle', 'xyaxes', 'zaxis']) {
      body.removeAttribute(attribute);
    }
  }
  // The body is static: never a joint, and only the generated geom inside it.
  for (const child of [...body.children]) child.remove();
  const geom = mjcfElement(document, 'geom');
  geom.setAttribute('name', SPLAT_BACKDROP_GEOM);
  geom.setAttribute('type', 'hfield');
  geom.setAttribute('hfield', SPLAT_BACKDROP_FIELD);
  geom.setAttribute('pos', numberList(heightfield.position));
  geom.setAttribute('rgba', '1 1 1 0');
  geom.setAttribute('contype', '0');
  geom.setAttribute('conaffinity', '0');
  body.append(geom);
  return serialize(document);
}

export function insertCustomGeomObject(
  xml: string,
  definition: CustomShapeDefinition,
): CustomGeomInsertionResult | null {
  const document = parse(xml);
  const worldbody = document?.querySelector(':scope > worldbody');
  if (!document || !worldbody) return null;

  if (definition.type === 'body') {
    const sourceName = definition.attributes.name?.trim();
    const bodyName = uniqueName(document, sourceName || 'custom_shape_body');
    const body = document.createElement('body');
    for (const [attribute, value] of Object.entries(definition.attributes)) {
      body.setAttribute(attribute, value);
    }
    body.setAttribute('name', bodyName);
    worldbody.append(body);

    for (const child of definition.children) {
      if (child.kind === 'freejoint') {
        const freejoint = document.createElement('freejoint');
        for (const [attribute, value] of Object.entries(child.attributes)) {
          freejoint.setAttribute(attribute, value);
        }
        if (child.attributes.name) {
          freejoint.setAttribute('name', uniqueName(document, child.attributes.name));
        }
        body.append(freejoint);
        continue;
      }

      const geom = document.createElement('geom');
      for (const [attribute, value] of Object.entries(child.definition.attributes)) {
        geom.setAttribute(attribute, value);
      }
      const geomName = child.definition.attributes.name?.trim() || `${bodyName}_geom`;
      geom.setAttribute('name', uniqueName(document, geomName));
      body.append(geom);
    }

    return { xml: serialize(document), nodeKind: 'body', nodeName: bodyName };
  }

  if (!CUSTOM_GEOM_TYPES.includes(definition.type)) return null;

  const sourceName = definition.attributes.name?.trim() || 'custom_shape';
  const geom = document.createElement('geom');
  for (const [attribute, value] of Object.entries(definition.attributes)) {
    geom.setAttribute(attribute, value);
  }

  if (definition.type === 'plane') {
    const geomName = uniqueName(document, sourceName);
    geom.setAttribute('name', geomName);
    worldbody.append(geom);
    return { xml: serialize(document), nodeKind: 'geom', nodeName: geomName };
  }

  const bodyName = uniqueName(document, identifier(`${sourceName}_body`, 'custom_shape_body'));
  const geomName = uniqueName(
    document,
    sourceName === 'custom_shape' ? `${bodyName}_geom` : sourceName,
  );
  const body = document.createElement('body');
  body.setAttribute('name', bodyName);
  body.append(document.createElement('freejoint'));
  geom.setAttribute('name', geomName);
  body.append(geom);
  worldbody.append(body);

  return { xml: serialize(document), nodeKind: 'body', nodeName: bodyName };
}

/** Assigns a named material to the selected visual geom or all visual geoms in a body. */
export function applyMaterialToNode(
  xml: string,
  node: SceneNode,
  material: SceneMaterial,
): string | null {
  if ((node.kind !== 'body' && node.kind !== 'geom') || isSplatBackdropNode(node)) return null;
  const document = parse(xml);
  const selected = document ? elementFor(document, node) : null;
  if (!document || !selected) return null;

  const materialName = materialNameFor(material);
  if (!ensureMaterialDeclaration(document, materialName, material)) return null;

  const geoms = node.kind === 'geom' ? [selected] : [...selected.querySelectorAll('geom')];
  const visualGeoms = geoms.filter((geom) => geom.getAttribute('group') !== '4');
  if (!visualGeoms.length) return null;
  for (const geom of visualGeoms) {
    geom.setAttribute('material', materialName);
    geom.removeAttribute('rgba');
  }
  return serialize(document);
}

export function duplicateNode(xml: string, node: SceneNode): string | null {
  if (isSplatBackdropNode(node)) return null;
  const document = parse(xml);
  const element = document ? elementFor(document, node) : null;
  if (!document || !element) return null;

  const names = new Set(
    [...document.querySelectorAll('[name]')]
      .map((namedElement) => namedElement.getAttribute('name'))
      .filter((name): name is string => Boolean(name)),
  );
  const copyName = (name: string) => {
    let candidate = `${name}_copy`;
    let index = 2;
    while (names.has(candidate)) candidate = `${name}_copy_${index++}`;
    names.add(candidate);
    return candidate;
  };

  const clone = element.cloneNode(true) as Element;
  for (const namedElement of [clone, ...clone.querySelectorAll('[name]')]) {
    const name = namedElement.getAttribute('name');
    if (name) namedElement.setAttribute('name', copyName(name));
  }
  element.parentElement?.insertBefore(clone, element.nextSibling);
  return serialize(document);
}

/** Deletes a node; the splat backdrop is only removed through `removeSplatBackdrop`. */
export function deleteNode(xml: string, node: SceneNode): string | null {
  if (isSplatBackdropNode(node)) return null;
  return withElement(xml, node, (element) => element.remove());
}

export function reorderSibling(
  xml: string,
  node: SceneNode,
  target: SceneNode,
  placeAfter: boolean,
): string | null {
  if (node.id === target.id || node.parentId !== target.parentId || isSplatBackdropNode(node)) {
    return null;
  }
  const document = parse(xml);
  const element = document ? elementFor(document, node) : null;
  const targetElement = document ? elementFor(document, target) : null;
  if (
    !document ||
    !element ||
    !targetElement ||
    element.parentElement !== targetElement.parentElement
  ) {
    return null;
  }
  targetElement.parentElement?.insertBefore(
    element,
    placeAfter ? targetElement.nextSibling : targetElement,
  );
  return serialize(document);
}

// ---------------------------------------------------------------------------------------------
// Object physics (MCP set_object_physics)
// ---------------------------------------------------------------------------------------------

function topLevelBody(document: Document, name: string): Element | null {
  const worldbody = document.querySelector(':scope > worldbody');
  return worldbody
    ? ([...worldbody.children].find(
        (element) => element.tagName === 'body' && element.getAttribute('name') === name,
      ) ?? null)
    : null;
}

function numbers(value: string | null, fallback: readonly number[]): number[] {
  const parsed = value?.trim().split(/\s+/).map(Number) ?? [];
  return parsed.length === fallback.length && parsed.every(Number.isFinite)
    ? parsed
    : [...fallback];
}

/** Geoms that take part in contacts (the MJCF default), as opposed to visual-only copies. */
function isCollidingGeom(geom: Element): boolean {
  return !(geom.getAttribute('contype') === '0' && geom.getAttribute('conaffinity') === '0');
}

/**
 * Scales a top-level object uniformly: geom sizes and `fromto`, and every position inside it.
 * Mesh geoms get a mesh declaration of their own (`<mesh>__<body>`) with the scaled `scale`, so
 * other objects using the same library mesh keep their size. `raise` moves the body up (meters),
 * so callers can keep its bottom on its support. Null when the body is missing.
 */
export function scaleObject(
  xml: string,
  bodyName: string,
  factor: number,
  raise = 0,
): string | null {
  if (!Number.isFinite(factor) || factor <= 0) return null;
  const document = parse(xml);
  const body = document ? topLevelBody(document, bodyName) : null;
  if (!document || !body) return null;
  const scaled = (element: Element, attribute: string, length: number) => {
    const value = element.getAttribute(attribute);
    if (!value) return;
    const values = numbers(value, Array(length).fill(0));
    element.setAttribute(attribute, numberList(values.map((entry) => entry * factor)));
  };
  for (const element of body.querySelectorAll('body, geom, site, joint, camera, light')) {
    scaled(element, 'pos', 3);
  }
  if (raise) {
    const [x, y, z] = numbers(body.getAttribute('pos'), [0, 0, 0]);
    body.setAttribute('pos', numberList([x, y, z + raise]));
  }
  const asset = document.querySelector(':scope > asset');
  for (const geom of body.querySelectorAll('geom')) {
    scaled(geom, 'fromto', 6);
    const meshName = geom.getAttribute('mesh');
    if (!meshName) {
      const size = geom.getAttribute('size');
      if (size) {
        const values = size.trim().split(/\s+/).map(Number);
        geom.setAttribute('size', numberList(values.map((entry) => entry * factor)));
      }
      continue;
    }
    const suffix = `__${bodyName}`;
    const own = `${meshName.endsWith(suffix) ? meshName.slice(0, -suffix.length) : meshName}${suffix}`;
    const meshes = asset ? [...asset.querySelectorAll(':scope > mesh')] : [];
    let mesh = meshes.find((element) => element.getAttribute('name') === own);
    if (!mesh) {
      const source = meshes.find((element) => element.getAttribute('name') === meshName);
      if (!source || !asset) return null;
      mesh = source.cloneNode(true) as Element;
      mesh.setAttribute('name', own);
      asset.append(mesh);
    }
    const scale = numbers(mesh.getAttribute('scale'), [1, 1, 1]);
    mesh.setAttribute('scale', numberList(scale.map((entry) => entry * factor)));
    geom.setAttribute('mesh', own);
  }
  return serialize(document);
}

/**
 * Gives a top-level object a total mass in kilograms, spread over its colliding geoms; visual-only
 * geoms get zero mass so they no longer add their default density. Null when there is none.
 */
export function setObjectMass(xml: string, bodyName: string, mass: number): string | null {
  if (!Number.isFinite(mass) || mass <= 0) return null;
  const document = parse(xml);
  const body = document ? topLevelBody(document, bodyName) : null;
  if (!document || !body) return null;
  const geoms = [...body.querySelectorAll('geom')];
  const colliding = geoms.filter(isCollidingGeom);
  if (!colliding.length) return null;
  for (const geom of geoms) {
    geom.removeAttribute('density');
    geom.setAttribute('mass', isCollidingGeom(geom) ? numberList([mass / colliding.length]) : '0');
  }
  return serialize(document);
}

/** Sets sliding (and optionally torsional and rolling) friction on an object's colliding geoms. */
export function setObjectFriction(
  xml: string,
  bodyName: string,
  friction: readonly number[],
): string | null {
  if (!friction.length || friction.length > 3 || friction.some((v) => !Number.isFinite(v) || v < 0))
    return null;
  const document = parse(xml);
  const body = document ? topLevelBody(document, bodyName) : null;
  if (!document || !body) return null;
  const colliding = [...body.querySelectorAll('geom')].filter(isCollidingGeom);
  if (!colliding.length) return null;
  for (const geom of colliding) {
    const current = numbers(geom.getAttribute('friction'), [1, 0.005, 0.0001]);
    geom.setAttribute(
      'friction',
      numberList(current.map((value, index) => friction[index] ?? value)),
    );
  }
  return serialize(document);
}
