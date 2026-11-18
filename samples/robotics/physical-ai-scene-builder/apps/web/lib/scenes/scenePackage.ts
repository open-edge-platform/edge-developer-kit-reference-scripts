// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';

import type { RuntimeFile } from '@mujoco-studio/mujoco';
import {
  isSplatPath,
  MAX_SPLAT_BYTES,
  SPLAT_BACKDROP_BODY,
  splatFileProblem,
  splatFilename,
  splatFormatOf,
} from '@mujoco-studio/types';
import { sha256Hex } from './sha256';

import {
  calibrationRotation,
  isFiniteVec3,
  normalizeSplatCalibration,
  type QuaternionTuple,
  type SplatCalibration,
  type Vec3Tuple,
} from '../editor/splatCollision';

// Scene packages are plain ZIP files holding a standard MuJoCo MJCF model: an entry XML (usually
// scene.xml) plus the mesh and texture files it references. Import accepts what people already
// have (a zipped MuJoCo Menagerie folder: <include>, meshdir/texturedir/assetdir, extra files) and
// flattens it into the editor's single canonical MJCF document. Export writes the reverse: a
// scene.xml whose file paths resolve relative to itself, so the unzipped folder opens directly in
// `python -m mujoco.viewer --mjcf scene.xml`. The manifest.json written on export is optional on
// import; when present its sizes and checksums are verified. A Gaussian-splat backdrop travels as
// `splats/<name>.ply` or `.spz` (manifest kind `splat`, stored uncompressed) plus the manifest's `backdrop`
// block; its collision heightfield and body pose are already in scene.xml.

const MANIFEST_VERSION = 1;
const MAX_ARCHIVE_BYTES = 1024 * 1024 * 1024;
/** The splat is the largest entry; meshes and textures are capped lower at upload. */
const MAX_ENTRY_BYTES = MAX_SPLAT_BYTES;
const MAX_ENTRY_COUNT = 5000;
const MAX_INCLUDE_DEPTH = 32;

/** File types the editor can stage for MuJoCo and persist as Payload assets. */
const SUPPORTED_ASSET_EXTENSIONS = new Set(['glb', 'obj', 'stl', 'png', 'jpg', 'jpeg']);
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg']);
const TEXTURE_FILE_ATTRIBUTES = [
  'file',
  'fileright',
  'fileleft',
  'fileup',
  'filedown',
  'filefront',
  'fileback',
] as const;
/** Elements whose `file` MuJoCo resolves against `meshdir`. */
const MESH_DIRECTORY_ELEMENTS = new Set(['mesh', 'hfield', 'skin', 'flexcomp']);
const IGNORED_ENTRY = /(^|\/)(__MACOSX|\.DS_Store|Thumbs\.db)(\/|$)/;

export interface ScenePackageManifestFile {
  path: string;
  kind: 'mesh' | 'texture' | 'splat';
  size: number;
  sha256: string;
}

/** The splat backdrop of an exported scene. */
export interface ScenePackageBackdrop {
  /** Package path of the PLY, listed in `files` with kind `splat`. */
  path: string;
  /** MJCF body that carries the backdrop pose and its collision heightfield. */
  body: string;
  /** Editor calibration of the scan (scale, up axis, tilts, crop, max height, splat size). */
  calibration: SplatCalibration;
  /** Alignment origin the body was created at, used to keep its pose on recalibration. */
  origin: Vec3Tuple | null;
  /** Raw PLY to body transform for other tools: `p_body = scale * R(rotation) * p_raw`. */
  scale: number;
  /** Unit quaternion `[w, x, y, z]`. */
  rotation: QuaternionTuple;
}

export interface ScenePackageManifest {
  version: typeof MANIFEST_VERSION;
  sceneName: string;
  entrypoint: string;
  files: ScenePackageManifestFile[];
  backdrop?: ScenePackageBackdrop;
}

/** Splat backdrop restored from a package. */
export interface ImportedSplatBackdrop {
  filename: string;
  bytes: Uint8Array;
  sha256: string;
  calibration: SplatCalibration;
  origin: Vec3Tuple | null;
}

export interface ImportedScenePackage {
  /** Flattened MJCF: includes inlined, compiler directories removed, file paths package-relative. */
  xml: string;
  sceneName: string;
  /** Package path of the entry XML that was imported. */
  entrypoint: string;
  /** Only the files the model references, keyed by the path written into `xml`. */
  runtimeFiles: RuntimeFile[];
  /**
   * Textures whose image was missing or unreadable, as `path — <texture name="…">` in the ZIP's
   * own layout. Each was replaced by a flat placeholder so the scene still compiles.
   */
  placeholderTextures: string[];
  /** The scene's splat backdrop, when the package carries one. */
  splat: ImportedSplatBackdrop | null;
}

export interface ImportScenePackageOptions {
  /** Original file name; used for the scene name when the package does not provide one. */
  fileName?: string;
  /** Entry XML to import when the package contains several candidate models. */
  entrypoint?: string;
}

/** Thrown when a package holds more than one top-level MJCF model and none is marked as main. */
export class ScenePackageEntrypointError extends Error {
  readonly candidates: string[];

  constructor(candidates: string[]) {
    super(
      `The ZIP contains several MuJoCo models (${candidates.join(', ')}). Choose the one to import, or name it scene.xml.`,
    );
    this.name = 'ScenePackageEntrypointError';
    this.candidates = candidates;
  }
}

export interface ScenePackageErrorDetails {
  /** Itemised specifics (for example each missing file), shown as a list. */
  details?: string[];
  detailsLabel?: string;
  /** What the user can do to fix it. */
  hint?: string;
}

/** A package problem the user can act on. `summary` is the reason without the generic prefix. */
export class ScenePackageError extends Error {
  readonly summary: string;
  readonly details: string[];
  readonly detailsLabel?: string;
  readonly hint?: string;

  constructor(summary: string, extra: ScenePackageErrorDetails = {}) {
    super(`Scene ZIP is invalid: ${summary}`);
    this.name = 'ScenePackageError';
    this.summary = summary;
    this.details = extra.details ?? [];
    this.detailsLabel = extra.detailsLabel;
    this.hint = extra.hint;
  }
}

function packageError(summary: string, extra?: ScenePackageErrorDetails): ScenePackageError {
  return new ScenePackageError(summary, extra);
}

function extensionFor(path: string): string {
  const name = path.split('/').at(-1) ?? '';
  return name.includes('.') ? (name.split('.').at(-1)?.toLowerCase() ?? '') : '';
}

function basename(path: string): string {
  return path.split('/').at(-1) ?? path;
}

function dirname(path: string): string {
  const index = path.lastIndexOf('/');
  return index < 0 ? '' : path.slice(0, index);
}

function isUrlOrAbsolute(path: string): boolean {
  return path.startsWith('/') || /^[a-z][a-z\d+.-]*:/i.test(path);
}

/** Joins package-relative segments, resolving `.` and `..` without leaving the package root. */
export function joinPackagePath(...parts: string[]): string {
  const segments: string[] = [];
  for (const part of parts) {
    for (const segment of part.replaceAll('\\', '/').split('/')) {
      if (!segment || segment === '.') continue;
      if (segment === '..') {
        if (!segments.length) throw packageError(`path "${parts.join('/')}" leaves the package`);
        segments.pop();
      } else {
        segments.push(segment);
      }
    }
  }
  return segments.join('/');
}

function normalizeEntryName(name: string): string {
  const path = name.replaceAll('\\', '/');
  if (isUrlOrAbsolute(path) || path.split('/').includes('..')) {
    throw packageError(`entry "${name}" must be a relative path inside the package`, {
      hint: 'Absolute paths and ".." segments are not allowed in scene ZIPs.',
    });
  }
  return joinPackagePath(path);
}

function parseXml(xml: string, path: string): Document {
  if (typeof DOMParser === 'undefined')
    throw new Error('Scene import requires a browser document.');
  const document = new DOMParser().parseFromString(xml, 'application/xml');
  if (!document?.documentElement || document.querySelector('parsererror')) {
    throw packageError(`${path} is not valid XML`);
  }
  return document;
}

function readEntries(bytes: Uint8Array): Map<string, Uint8Array> {
  if (bytes.byteLength > MAX_ARCHIVE_BYTES) throw packageError('the ZIP file is too large');
  let expanded = 0;
  let count = 0;
  let raw: Record<string, Uint8Array>;
  try {
    raw = unzipSync(bytes, {
      filter: (file) => {
        if (file.name.endsWith('/') || IGNORED_ENTRY.test(file.name)) return false;
        count += 1;
        expanded += file.originalSize;
        if (count > MAX_ENTRY_COUNT) throw packageError('the ZIP contains too many files');
        if (file.originalSize > MAX_ENTRY_BYTES) {
          throw packageError(`"${file.name}" exceeds the ${MAX_ENTRY_BYTES} byte file limit`);
        }
        if (expanded > MAX_ARCHIVE_BYTES) throw packageError('the expanded ZIP is too large');
        return true;
      },
    });
  } catch (reason) {
    if (reason instanceof ScenePackageError) throw reason;
    throw packageError('the file could not be read as a ZIP archive', {
      hint: 'Re-create the ZIP with your system archiver and import it again.',
    });
  }

  const entries = new Map<string, Uint8Array>();
  for (const [name, data] of Object.entries(raw)) {
    const path = normalizeEntryName(name);
    if (!path) continue;
    if (entries.has(path)) throw packageError(`entry "${path}" is duplicated`);
    entries.set(path, data);
  }
  if (!entries.size) throw packageError('the ZIP is empty');
  return entries;
}

/** Drops a single wrapping folder (e.g. `franka_emika_panda/scene.xml`) and returns its name. */
function stripWrappingFolder(entries: Map<string, Uint8Array>): {
  entries: Map<string, Uint8Array>;
  folder: string | null;
} {
  const firstSegments = new Set<string>();
  for (const path of entries.keys()) {
    const segments = path.split('/');
    if (segments.length < 2) return { entries, folder: null };
    firstSegments.add(segments[0]);
  }
  if (firstSegments.size !== 1) return { entries, folder: null };
  const [folder] = firstSegments;
  return {
    entries: new Map([...entries].map(([path, data]) => [path.slice(folder.length + 1), data])),
    folder,
  };
}

async function verifyManifest(
  entries: Map<string, Uint8Array>,
  shown: (path: string) => string,
): Promise<{ sceneName?: string; entrypoint?: string; splat?: ImportedSplatBackdrop }> {
  const bytes = entries.get('manifest.json');
  if (!bytes) return {};
  let manifest: unknown;
  try {
    manifest = JSON.parse(strFromU8(bytes));
  } catch {
    throw packageError('manifest.json is not valid JSON');
  }
  if (!manifest || typeof manifest !== 'object') return {};
  const candidate = manifest as Partial<ScenePackageManifest>;
  // Only verify manifests written by this tool; an unrelated manifest.json is just another file.
  if (!('files' in candidate) && !('entrypoint' in candidate)) return {};
  if (candidate.version !== MANIFEST_VERSION) throw packageError('manifest version is unsupported');
  if (typeof candidate.entrypoint !== 'string' || !candidate.entrypoint.endsWith('.xml')) {
    throw packageError('manifest entrypoint must be an XML file');
  }
  if (!Array.isArray(candidate.files)) throw packageError('manifest.json is missing its file list');
  // Each entry is hashed: a list naming one large file many times would hash it over and over.
  if (candidate.files.length > MAX_ENTRY_COUNT) {
    throw packageError('manifest.json lists too many files');
  }

  const mismatched: string[] = [];
  const seen = new Set<string>();
  for (const file of candidate.files) {
    if (
      !file ||
      typeof file.path !== 'string' ||
      typeof file.size !== 'number' ||
      typeof file.sha256 !== 'string'
    ) {
      throw packageError('manifest.json contains an invalid file entry');
    }
    const path = normalizeEntryName(file.path);
    if (seen.has(path)) throw packageError(`manifest.json lists "${shown(path)}" more than once`);
    seen.add(path);
    const data = entries.get(path);
    if (!data) mismatched.push(`${shown(path)} · listed in manifest but not in ZIP`);
    else if (data.byteLength !== file.size) mismatched.push(`${shown(path)} · size differs`);
    else if ((await sha256Hex(data)) !== file.sha256.toLowerCase()) {
      mismatched.push(`${shown(path)} · checksum differs`);
    }
  }
  if (mismatched.length) {
    throw packageError('files do not match manifest.json (failed checksum validation)', {
      details: mismatched,
      detailsLabel: 'Mismatched files',
      hint: 'The ZIP was changed after export. Re-export it, or delete manifest.json to import the files as they are.',
    });
  }
  return {
    sceneName: typeof candidate.sceneName === 'string' ? candidate.sceneName.trim() : undefined,
    entrypoint: normalizeEntryName(candidate.entrypoint),
    splat: manifestBackdrop(candidate, entries, shown),
  };
}

/**
 * The manifest's splat backdrop. Its PLY must be listed in `files` with kind `splat` (so its size
 * and checksum were verified above), live under `splats/`, and pass the splat PLY checks.
 */
function manifestBackdrop(
  manifest: Partial<ScenePackageManifest>,
  entries: Map<string, Uint8Array>,
  shown: (path: string) => string,
): ImportedSplatBackdrop | undefined {
  const backdrop = manifest.backdrop as Partial<ScenePackageBackdrop> | undefined;
  if (backdrop === undefined) return undefined;
  if (!backdrop || typeof backdrop !== 'object' || typeof backdrop.path !== 'string') {
    throw packageError('manifest.json has an invalid splat backdrop');
  }
  const path = normalizeEntryName(backdrop.path);
  const listed = manifest.files?.find((file) => normalizeEntryName(file.path) === path);
  if (!path.startsWith('splats/') || !isSplatPath(path) || listed?.kind !== 'splat') {
    throw packageError(
      `splat backdrop "${shown(path)}" must be a splats/*.ply or *.spz file of kind splat`,
    );
  }
  const bytes = entries.get(path)!;
  const problem = splatFileProblem(bytes);
  if (problem) {
    throw packageError(`splat backdrop ${shown(path)} is not a usable splat: ${problem}`, {
      hint: 'Re-export the scene, or delete the backdrop from manifest.json to import without it.',
    });
  }
  return {
    filename: basename(path),
    bytes,
    sha256: listed.sha256.toLowerCase(),
    calibration: normalizeSplatCalibration(backdrop.calibration),
    origin: isFiniteVec3(backdrop.origin) ? backdrop.origin : null,
  };
}

function includeTargets(document: Document, path: string, xmlPaths: Set<string>): string[] {
  const targets: string[] = [];
  for (const include of document.getElementsByTagName('include')) {
    const file = include.getAttribute('file');
    if (!file || isUrlOrAbsolute(file)) continue;
    for (const candidate of [joinPackagePath(dirname(path), file), joinPackagePath(file)]) {
      if (xmlPaths.has(candidate)) targets.push(candidate);
    }
  }
  return targets;
}

function chooseEntrypoint(
  entries: Map<string, Uint8Array>,
  requested: string | undefined,
  manifestEntrypoint: string | undefined,
): string {
  const models = new Map<string, Document>();
  for (const [path, data] of entries) {
    if (extensionFor(path) !== 'xml') continue;
    try {
      const document = parseXml(strFromU8(data), path);
      if (document.documentElement.nodeName === 'mujoco') models.set(path, document);
    } catch {
      // Non-MJCF or malformed XML files are simply not entry candidates.
    }
  }
  if (!models.size) {
    throw packageError('it does not contain a MuJoCo MJCF (.xml) model', {
      hint: 'Zip the folder that holds your model XML (a file whose root element is <mujoco>).',
    });
  }

  const explicit = requested ?? manifestEntrypoint;
  if (explicit) {
    const path = joinPackagePath(explicit);
    if (!models.has(path)) throw packageError(`entry model "${explicit}" was not found`);
    return path;
  }
  if (models.has('scene.xml')) return 'scene.xml';

  const xmlPaths = new Set(models.keys());
  const included = new Set<string>();
  for (const [path, document] of models) {
    for (const target of includeTargets(document, path, xmlPaths)) included.add(target);
  }
  const roots = [...models.keys()].filter((path) => !included.has(path)).sort();
  if (roots.length === 1) return roots[0];
  const scenes = roots.filter((path) => basename(path).toLowerCase() === 'scene.xml');
  if (scenes.length === 1) return scenes[0];
  throw new ScenePackageEntrypointError(roots.length ? roots : [...models.keys()].sort());
}

/**
 * Inlines `<include>` elements the way MuJoCo does: the included file's top-level element is
 * dropped and its children replace the include. Paths are relative to the main model directory;
 * as a convenience the including file's directory is tried as well. Missing files are collected
 * in `missing` so every one can be reported at once.
 */
function flattenIncludes(
  document: Document,
  sourcePath: string,
  context: {
    mainDirectory: string;
    entries: Map<string, Uint8Array>;
    included: Set<string>;
    missing: string[];
    shown: (path: string) => string;
  },
  depth: number,
): void {
  if (depth > MAX_INCLUDE_DEPTH) throw packageError('includes are nested too deeply');
  const { mainDirectory, entries, included, missing, shown } = context;
  for (const include of [...document.getElementsByTagName('include')]) {
    const file = include.getAttribute('file');
    if (!file) throw packageError(`${shown(sourcePath)} has an <include> without a file`);
    if (isUrlOrAbsolute(file)) {
      throw packageError(`include "${file}" in ${shown(sourcePath)} must be a relative path`);
    }
    const candidates = [
      joinPackagePath(mainDirectory, file),
      joinPackagePath(dirname(sourcePath), file),
    ];
    const path = candidates.find((candidate) => entries.has(candidate));
    if (!path) {
      missing.push(`${shown(candidates[0])} — <include> in ${shown(sourcePath)}`);
      include.parentNode?.removeChild(include);
      continue;
    }
    if (included.has(path)) {
      throw packageError(`"${shown(path)}" is included more than once`, {
        hint: 'MuJoCo allows each file to be included only once. Remove the duplicate <include>.',
      });
    }
    included.add(path);

    const child = parseXml(strFromU8(entries.get(path)!), shown(path));
    flattenIncludes(child, path, context, depth + 1);
    const parent = include.parentNode;
    if (!parent) continue;
    for (const node of [...child.documentElement.childNodes]) {
      parent.insertBefore(document.importNode(node, true), include);
    }
    parent.removeChild(include);
  }
}

interface CompilerPaths {
  meshdir: string;
  texturedir: string;
  strippath: boolean;
}

/** Reads the effective compiler path settings (later <compiler> attributes win, like MuJoCo). */
function compilerPaths(document: Document): CompilerPaths {
  let assetdir = '';
  let meshdir: string | null = null;
  let texturedir: string | null = null;
  let strippath = false;
  for (const compiler of document.getElementsByTagName('compiler')) {
    assetdir = compiler.getAttribute('assetdir') ?? assetdir;
    meshdir = compiler.getAttribute('meshdir') ?? meshdir;
    texturedir = compiler.getAttribute('texturedir') ?? texturedir;
    const strip = compiler.getAttribute('strippath');
    if (strip !== null) strippath = strip === 'true';
  }
  for (const directory of [assetdir, meshdir, texturedir]) {
    if (directory && isUrlOrAbsolute(directory)) {
      throw packageError(`compiler directory "${directory}" must be relative`);
    }
  }
  return { meshdir: meshdir ?? assetdir, texturedir: texturedir ?? assetdir, strippath };
}

/** Removes compiler settings that only affect path lookup, once every path is explicit. */
function clearCompilerPaths(document: Document): void {
  for (const compiler of [...document.getElementsByTagName('compiler')]) {
    for (const attribute of ['assetdir', 'meshdir', 'texturedir', 'strippath']) {
      compiler.removeAttribute(attribute);
    }
    if (!compiler.attributes.length && !compiler.childNodes.length) compiler.remove();
  }
}

interface FileReference {
  element: Element;
  attribute: string;
  value: string;
  isTexture: boolean;
}

function fileReferences(document: Document): FileReference[] {
  const references: FileReference[] = [];
  for (const element of document.getElementsByTagName('*')) {
    const name = element.nodeName;
    if (name === 'include') continue;
    const attributes = name === 'texture' ? TEXTURE_FILE_ATTRIBUTES : (['file'] as const);
    for (const attribute of attributes) {
      const value = element.getAttribute(attribute);
      if (value === null) continue;
      if (name === 'model') {
        throw packageError('nested <model> assets are not supported; attach the model instead');
      }
      if (!value.trim()) throw packageError(`<${name}> has an empty ${attribute}`);
      if (isUrlOrAbsolute(value)) {
        throw packageError(`asset "${value}" must be a relative path inside the package`);
      }
      references.push({ element, attribute, value, isTexture: name === 'texture' });
    }
  }
  return references;
}

/** Candidate package paths for a reference, most MuJoCo-faithful first. */
function candidatePaths(
  reference: FileReference,
  paths: CompilerPaths,
  baseDirectory: string,
): string[] {
  const file = paths.strippath ? basename(reference.value.replaceAll('\\', '/')) : reference.value;
  const directory = reference.isTexture
    ? paths.texturedir
    : MESH_DIRECTORY_ELEMENTS.has(reference.element.nodeName)
      ? paths.meshdir
      : '';
  const candidates = [
    joinPackagePath(baseDirectory, directory, file),
    joinPackagePath(baseDirectory, file),
  ];
  return [...new Set(candidates)];
}

function sceneNameFromFile(fileName: string | undefined): string | null {
  const name = fileName
    ?.split(/[\\/]/)
    .at(-1)
    ?.replace(/\.(zip|mujoco-scene)$/i, '')
    .trim();
  return name || null;
}

function describeElement(element: Element): string {
  const name = element.getAttribute('name');
  return name ? `<${element.nodeName} name="${name}">` : `<${element.nodeName}>`;
}

/** Turns a texture whose image cannot be loaded into a flat builtin so the model still compiles. */
function replaceWithPlaceholderTexture(texture: Element): void {
  for (const attribute of [...TEXTURE_FILE_ATTRIBUTES, 'gridsize', 'gridlayout', 'content_type']) {
    texture.removeAttribute(attribute);
  }
  texture.setAttribute('builtin', 'flat');
  if (!texture.getAttribute('width')) texture.setAttribute('width', '16');
  if (!texture.getAttribute('height')) texture.setAttribute('height', '16');
}

/**
 * Lists the external files a standalone MJCF XML needs (includes and assets), as
 * `file — <element name="…">`. A single XML import cannot supply them; they need a scene ZIP.
 */
export function externalFileReferences(xml: string): string[] {
  let document: Document;
  try {
    document = parseXml(xml, 'MJCF');
  } catch {
    return [];
  }
  const references: string[] = [];
  for (const element of document.getElementsByTagName('*')) {
    const attributes =
      element.nodeName === 'texture' ? TEXTURE_FILE_ATTRIBUTES : (['file'] as const);
    for (const attribute of attributes) {
      const value = element.getAttribute(attribute)?.trim();
      if (value) references.push(`${value} — ${describeElement(element)}`);
    }
  }
  return [...new Set(references)];
}

const MISSING_HINT =
  'Add the listed files to the ZIP at those paths and import again. Paths follow MuJoCo rules: ' +
  'relative to the main XML, inside the compiler meshdir/texturedir/assetdir when set.';
const UNSUPPORTED_HINT =
  'Convert meshes to STL, OBJ, or GLB and images to PNG or JPG, update the XML, and import again.';

export async function importScenePackage(
  input: File | ArrayBuffer | Uint8Array,
  options: ImportScenePackageOptions = {},
): Promise<ImportedScenePackage> {
  const bytes =
    input instanceof Uint8Array
      ? input
      : input instanceof ArrayBuffer
        ? new Uint8Array(input)
        : new Uint8Array(await input.arrayBuffer());
  const fileName = options.fileName ?? (input instanceof File ? input.name : undefined);

  const { entries, folder } = stripWrappingFolder(readEntries(bytes));
  // Report paths as the user sees them when opening the ZIP, wrapping folder included.
  const shown = (path: string) => (folder ? `${folder}/${path}` : path);
  const manifest = await verifyManifest(entries, shown);
  const entrypoint = chooseEntrypoint(entries, options.entrypoint, manifest.entrypoint);
  const mainDirectory = dirname(entrypoint);

  const document = parseXml(strFromU8(entries.get(entrypoint)!), shown(entrypoint));
  const missingIncludes: string[] = [];
  flattenIncludes(
    document,
    entrypoint,
    { mainDirectory, entries, included: new Set([entrypoint]), missing: missingIncludes, shown },
    0,
  );
  if (missingIncludes.length) {
    throw packageError(
      missingIncludes.length === 1
        ? 'an included XML file is not in the ZIP'
        : `${missingIncludes.length} included XML files are not in the ZIP`,
      { details: missingIncludes, detailsLabel: 'Missing includes', hint: MISSING_HINT },
    );
  }

  const paths = compilerPaths(document);
  const byElement = new Map<Element, FileReference[]>();
  for (const reference of fileReferences(document)) {
    byElement.set(reference.element, [...(byElement.get(reference.element) ?? []), reference]);
  }

  const runtimeFiles = new Map<string, RuntimeFile>();
  const missing: string[] = [];
  const unsupported: string[] = [];
  const placeholderTextures: string[] = [];
  for (const [element, references] of byElement) {
    const resolved: { reference: FileReference; path: string }[] = [];
    const problems: { path: string; reason: 'missing' | 'unsupported' | 'empty' }[] = [];
    for (const reference of references) {
      const candidates = candidatePaths(reference, paths, mainDirectory);
      const path = candidates.find((candidate) => entries.has(candidate));
      if (!path) problems.push({ path: candidates[0], reason: 'missing' });
      else if (!SUPPORTED_ASSET_EXTENSIONS.has(extensionFor(path))) {
        problems.push({ path, reason: 'unsupported' });
      } else if (!entries.get(path)!.byteLength) problems.push({ path, reason: 'empty' });
      else resolved.push({ reference, path });
    }

    const label = describeElement(element);
    if (problems.length && element.nodeName === 'texture') {
      for (const problem of problems) {
        const why =
          problem.reason === 'missing'
            ? 'not in ZIP'
            : problem.reason === 'empty'
              ? 'empty file'
              : `unsupported .${extensionFor(problem.path)}`;
        placeholderTextures.push(`${shown(problem.path)} — ${label} · ${why}`);
      }
      replaceWithPlaceholderTexture(element);
      continue;
    }
    for (const problem of problems) {
      if (problem.reason === 'unsupported') {
        unsupported.push(`${shown(problem.path)} — ${label} · .${extensionFor(problem.path)}`);
      } else {
        missing.push(
          `${shown(problem.path)} — ${label}${problem.reason === 'empty' ? ' · empty file' : ''}`,
        );
      }
    }
    if (problems.length) continue;

    for (const { reference, path } of resolved) {
      reference.element.setAttribute(reference.attribute, path);
      if (!runtimeFiles.has(path)) {
        const data = entries.get(path)!;
        runtimeFiles.set(path, { path, bytes: data, checksum: await sha256Hex(data) });
      }
    }
  }

  if (missing.length || unsupported.length) {
    const summary = [
      missing.length &&
        `${missing.length} referenced file${missing.length === 1 ? ' is' : 's are'} missing from the ZIP`,
      unsupported.length &&
        `${unsupported.length} asset${unsupported.length === 1 ? ' uses' : 's use'} an unsupported file type (supported: ${[...SUPPORTED_ASSET_EXTENSIONS].join(', ')})`,
    ]
      .filter(Boolean)
      .join('; ');
    throw packageError(summary, {
      details: [...new Set([...missing, ...unsupported])],
      detailsLabel: missing.length ? 'Required files' : 'Unsupported files',
      hint: missing.length ? MISSING_HINT : UNSUPPORTED_HINT,
    });
  }
  clearCompilerPaths(document);

  const modelName = document.documentElement.getAttribute('model')?.trim();
  const sceneName =
    manifest.sceneName || folder || sceneNameFromFile(fileName) || modelName || 'Imported scene';
  return {
    xml: new XMLSerializer().serializeToString(document),
    sceneName,
    entrypoint: shown(entrypoint),
    runtimeFiles: [...runtimeFiles.values()],
    placeholderTextures,
    splat: manifest.splat ?? null,
  };
}

function safeFilename(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+/, '');
  return cleaned || 'asset';
}

function uniquePath(directory: string, name: string, used: Set<string>): string {
  const filename = safeFilename(name);
  const dot = filename.lastIndexOf('.');
  const stem = dot > 0 ? filename.slice(0, dot) : filename;
  const extension = dot > 0 ? filename.slice(dot) : '';
  let path = `${directory}/${filename}`;
  for (let index = 2; used.has(path.toLowerCase()); index += 1) {
    path = `${directory}/${stem}-${index}${extension}`;
  }
  used.add(path.toLowerCase());
  return path;
}

/** Splat backdrop to export with a scene. */
export interface ExportSplatBackdrop {
  filename: string;
  bytes: Uint8Array;
  calibration: SplatCalibration;
  origin: Vec3Tuple | null;
}

/**
 * Builds a ZIP that opens directly in native MuJoCo: `scene.xml` at the root, referenced meshes in
 * `meshes/` and textures in `textures/`, every `file=` relative to scene.xml, and no compiler
 * directories. Unreferenced staged files are left out. manifest.json lists every asset with its
 * checksum so the ZIP also re-imports and loads in the Python SDK scene-bundle loader. A splat
 * backdrop is written uncompressed to `splats/` with its calibration in the manifest.
 */
export async function exportScenePackage(
  xml: string,
  sceneName: string,
  runtimeFiles: readonly RuntimeFile[],
  options: { splat?: ExportSplatBackdrop | null } = {},
): Promise<Blob> {
  if (!xml.trim()) throw packageError('the scene MJCF is empty');
  const document = parseXml(xml, 'scene.xml');
  if (document.documentElement.nodeName !== 'mujoco') {
    throw packageError('the scene is not a MuJoCo document');
  }
  if (document.getElementsByTagName('include').length) {
    throw packageError('the scene still contains <include> elements');
  }

  const available = new Map(runtimeFiles.map((file) => [joinPackagePath(file.path), file]));
  const paths = compilerPaths(document);
  const exported = new Map<string, string>();
  const used = new Set(['scene.xml', 'manifest.json']);
  const entries: Zippable = {};
  const files: ScenePackageManifestFile[] = [];

  const unloaded: string[] = [];
  for (const reference of fileReferences(document)) {
    const candidates = candidatePaths(reference, paths, '');
    const source = candidates.find((candidate) => available.has(candidate));
    if (!source) {
      unloaded.push(`${reference.value} — ${describeElement(reference.element)}`);
      continue;
    }
    let target = exported.get(source);
    if (!target) {
      const file = available.get(source)!;
      const isTexture = reference.isTexture || IMAGE_EXTENSIONS.has(extensionFor(source));
      target = uniquePath(isTexture ? 'textures' : 'meshes', basename(source), used);
      exported.set(source, target);
      entries[target] = file.bytes;
      files.push({
        path: target,
        kind: isTexture ? 'texture' : 'mesh',
        size: file.bytes.byteLength,
        sha256: await sha256Hex(file.bytes),
      });
    }
    reference.element.setAttribute(reference.attribute, target);
  }
  if (unloaded.length) {
    throw packageError(
      `the scene references ${unloaded.length === 1 ? 'a file that is' : `${unloaded.length} files that are`} not loaded in the editor`,
      {
        details: unloaded,
        detailsLabel: 'Files not loaded',
        hint: 'Remove these references in the MJCF panel, or re-import the scene with its files, then export again.',
      },
    );
  }
  clearCompilerPaths(document);

  let backdrop: ScenePackageBackdrop | undefined;
  if (options.splat) {
    const { bytes, calibration, origin } = options.splat;
    const problem = splatFileProblem(bytes);
    if (problem) throw packageError(`the splat backdrop cannot be exported: ${problem}`);
    const name = splatFilename(options.splat.filename, splatFormatOf(bytes));
    const path = uniquePath('splats', name, used);
    // PLY floats barely compress and SPZ is already gzipped; storing keeps export fast and the entry directly readable.
    entries[path] = [bytes, { level: 0 }];
    files.push({ path, kind: 'splat', size: bytes.byteLength, sha256: await sha256Hex(bytes) });
    backdrop = {
      path,
      body: SPLAT_BACKDROP_BODY,
      calibration,
      origin,
      scale: calibration.scale,
      rotation: calibrationRotation(calibration),
    };
  }

  const manifest: ScenePackageManifest = {
    version: MANIFEST_VERSION,
    sceneName: sceneName.trim() || 'Untitled scene',
    entrypoint: 'scene.xml',
    files,
    ...(backdrop ? { backdrop } : {}),
  };
  const sceneXml = new XMLSerializer().serializeToString(document);
  entries['scene.xml'] = strToU8(
    sceneXml.startsWith('<?xml') ? sceneXml : `<?xml version="1.0" encoding="utf-8"?>\n${sceneXml}`,
  );
  entries['manifest.json'] = strToU8(`${JSON.stringify(manifest, null, 2)}\n`);
  return new Blob([zipSync(entries)], { type: 'application/zip' });
}

export function scenePackageFilename(sceneName: string): string {
  const normalized = sceneName
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${normalized || 'scene'}.zip`;
}
