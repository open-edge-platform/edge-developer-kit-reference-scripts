// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

export type MeshSourceFormat = 'glb' | 'obj' | 'stl';
export type MeshSourceUnit = 'm' | 'cm' | 'mm';
export type MeshSourceUpAxis = 'y' | 'z';

export interface MeshProcessingOptions {
  unit?: MeshSourceUnit;
  upAxis?: MeshSourceUpAxis;
}

export interface MeshMetadata {
  sourceFormat: MeshSourceFormat;
  unit: MeshSourceUnit;
  upAxis: MeshSourceUpAxis;
  dimensionsMeters: [number, number, number];
  vertexCount: number;
  triangleCount: number;
}

export interface MeshMetadataResult {
  metadata: MeshMetadata | null;
  error: string | null;
}

function meshError(error: unknown, fallback: string): string {
  if (error instanceof TypeError && /utf|encoded|decode/i.test(error.message)) {
    return 'The mesh text must be UTF-8 encoded.';
  }
  return error instanceof Error ? error.message : fallback;
}

interface Bounds {
  min: [number, number, number];
  max: [number, number, number];
}

interface GltfAccessor {
  bufferView?: number;
  byteOffset?: number;
  componentType?: number;
  count?: number;
  max?: number[];
  min?: number[];
  type?: string;
}

interface GltfBufferView {
  buffer?: number;
  byteOffset?: number;
  byteStride?: number;
}

interface GltfPrimitive {
  attributes?: Record<string, number>;
  indices?: number;
  mode?: number;
}

interface GltfDocument {
  accessors?: GltfAccessor[];
  bufferViews?: GltfBufferView[];
  meshes?: { primitives?: GltfPrimitive[] }[];
  nodes?: GltfNode[];
  scene?: number;
  scenes?: GltfScene[];
}

interface GltfNode {
  children?: number[];
  matrix?: number[];
  mesh?: number;
  rotation?: number[];
  scale?: number[];
  translation?: number[];
}

interface GltfScene {
  nodes?: number[];
}

type Vec3 = readonly [number, number, number];

interface MeshTriangle {
  vertices: readonly [Vec3, Vec3, Vec3];
}

interface ParsedGlb {
  document: GltfDocument;
  binary: Uint8Array;
}

const GLB_JSON_CHUNK = 0x4e4f534a;
const GLB_BINARY_CHUNK = 0x004e4942;
const IDENTITY_MATRIX = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const Y_UP_TO_Z_UP = [1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1];

function sourceUnitScale(unit: MeshSourceUnit): number {
  if (unit === 'cm') return 0.01;
  if (unit === 'mm') return 0.001;
  return 1;
}

function defaultUpAxisFor(filename: string): MeshSourceUpAxis {
  return filename.split('.').at(-1)?.toLowerCase() === 'glb' ? 'y' : 'z';
}

function processingOptions(
  filename: string,
  options: MeshProcessingOptions = {},
): Required<MeshProcessingOptions> {
  return {
    unit: options.unit ?? 'm',
    upAxis: options.upAxis ?? defaultUpAxisFor(filename),
  };
}

function sourceAxisMatrix(upAxis: MeshSourceUpAxis): readonly number[] {
  return upAxis === 'y' ? Y_UP_TO_Z_UP : IDENTITY_MATRIX;
}

function createBounds(): Bounds {
  return {
    min: [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY],
    max: [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY],
  };
}

function addPoint(bounds: Bounds, x: number, y: number, z: number): void {
  const point = [x, y, z] as const;
  for (let index = 0; index < 3; index++) {
    bounds.min[index] = Math.min(bounds.min[index], point[index]);
    bounds.max[index] = Math.max(bounds.max[index], point[index]);
  }
}

function dimensionsFromBounds(bounds: Bounds): [number, number, number] | null {
  if (!bounds.min.every(Number.isFinite) || !bounds.max.every(Number.isFinite)) return null;
  return [
    Math.max(0, bounds.max[0] - bounds.min[0]),
    Math.max(0, bounds.max[1] - bounds.min[1]),
    Math.max(0, bounds.max[2] - bounds.min[2]),
  ];
}

function metadataFromBounds(
  sourceFormat: MeshSourceFormat,
  bounds: Bounds,
  vertexCount: number,
  triangleCount: number,
  options: Required<MeshProcessingOptions>,
): MeshMetadata {
  return {
    sourceFormat,
    unit: options.unit,
    upAxis: options.upAxis,
    dimensionsMeters: dimensionsFromBounds(bounds) as [number, number, number],
    vertexCount,
    triangleCount,
  };
}

function viewFor(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function uint32(view: DataView, offset: number): number {
  if (offset < 0 || offset + 4 > view.byteLength) throw new Error('The file ended unexpectedly.');
  return view.getUint32(offset, true);
}

function float32(view: DataView, offset: number): number {
  if (offset < 0 || offset + 4 > view.byteLength) throw new Error('The file ended unexpectedly.');
  const value = view.getFloat32(offset, true);
  if (!Number.isFinite(value)) throw new Error('The mesh contains a non-finite position.');
  return value;
}

function objectRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('The GLB JSON chunk is invalid.');
  }
  return value as Record<string, unknown>;
}

function gltfDocument(value: unknown): GltfDocument {
  const root = objectRecord(value);
  return {
    accessors: Array.isArray(root.accessors) ? (root.accessors as GltfAccessor[]) : [],
    bufferViews: Array.isArray(root.bufferViews) ? (root.bufferViews as GltfBufferView[]) : [],
    meshes: Array.isArray(root.meshes) ? (root.meshes as { primitives?: GltfPrimitive[] }[]) : [],
    nodes: Array.isArray(root.nodes) ? (root.nodes as GltfNode[]) : [],
    scene: typeof root.scene === 'number' ? root.scene : undefined,
    scenes: Array.isArray(root.scenes) ? (root.scenes as GltfScene[]) : [],
  };
}

function matrixProduct(left: readonly number[], right: readonly number[]): number[] {
  const result = new Array<number>(16).fill(0);
  for (let column = 0; column < 4; column++) {
    for (let row = 0; row < 4; row++) {
      for (let inner = 0; inner < 4; inner++) {
        result[column * 4 + row] += left[inner * 4 + row] * right[column * 4 + inner];
      }
    }
  }
  return result;
}

function finiteVector(values: unknown, length: number, fallback: number[]): number[] {
  if (!Array.isArray(values) || values.length !== length) return fallback;
  const result = values.map((value) => (typeof value === 'number' ? value : Number.NaN));
  return result.every(Number.isFinite) ? result : fallback;
}

function gltfNodeMatrix(node: GltfNode): number[] {
  if (node.matrix) {
    const matrix = finiteVector(node.matrix, 16, []);
    if (matrix.length === 16) return matrix;
    throw new Error('The GLB node matrix is invalid.');
  }

  const [tx, ty, tz] = finiteVector(node.translation, 3, [0, 0, 0]);
  const [sx, sy, sz] = finiteVector(node.scale, 3, [1, 1, 1]);
  const [x, y, z, w] = finiteVector(node.rotation, 4, [0, 0, 0, 1]);
  const rotation = [
    (1 - 2 * (y * y + z * z)) * sx,
    2 * (x * y + z * w) * sx,
    2 * (x * z - y * w) * sx,
    0,
    2 * (x * y - z * w) * sy,
    (1 - 2 * (x * x + z * z)) * sy,
    2 * (y * z + x * w) * sy,
    0,
    2 * (x * z + y * w) * sz,
    2 * (y * z - x * w) * sz,
    (1 - 2 * (x * x + y * y)) * sz,
    0,
    tx,
    ty,
    tz,
    1,
  ];
  return rotation;
}

function transformPoint(matrix: readonly number[], point: Vec3): Vec3 {
  const x = matrix[0] * point[0] + matrix[4] * point[1] + matrix[8] * point[2] + matrix[12];
  const y = matrix[1] * point[0] + matrix[5] * point[1] + matrix[9] * point[2] + matrix[13];
  const z = matrix[2] * point[0] + matrix[6] * point[1] + matrix[10] * point[2] + matrix[14];
  const w = matrix[3] * point[0] + matrix[7] * point[1] + matrix[11] * point[2] + matrix[15];
  if (!Number.isFinite(w) || Math.abs(w) < 1e-12) throw new Error('The GLB transform is invalid.');
  return [x / w, y / w, z / w];
}

function gltfRootNodes(document: GltfDocument): number[] {
  const nodes = document.nodes ?? [];
  const scene = document.scene === undefined ? undefined : document.scenes?.[document.scene];
  if (scene?.nodes?.length) return scene.nodes;
  const children = new Set<number>();
  for (const node of nodes) {
    for (const child of node.children ?? []) children.add(child);
  }
  const roots = nodes.map((_, index) => index).filter((index) => !children.has(index));
  return roots.length ? roots : nodes.map((_, index) => index);
}

function accessorCount(accessor: GltfAccessor): number {
  if (!Number.isInteger(accessor.count) || (accessor.count as number) < 0) {
    throw new Error('The GLB contains an invalid accessor count.');
  }
  return accessor.count as number;
}

function readGlb(bytes: Uint8Array): ParsedGlb {
  if (bytes.byteLength < 20) throw new Error('The GLB file is too small.');
  const view = viewFor(bytes);
  if (view.getUint32(0, false) !== 0x676c5446) throw new Error('The GLB header is invalid.');
  if (uint32(view, 4) !== 2) throw new Error('Only GLB version 2 is supported.');
  const declaredLength = uint32(view, 8);
  if (declaredLength > bytes.byteLength) throw new Error('The GLB file is truncated.');

  let json: unknown = null;
  let binary: Uint8Array | null = null;
  for (let offset = 12; offset + 8 <= declaredLength;) {
    const length = uint32(view, offset);
    const type = uint32(view, offset + 4);
    const chunkStart = offset + 8;
    const chunkEnd = chunkStart + length;
    if (chunkEnd > declaredLength) throw new Error('The GLB chunk is truncated.');
    if (type === GLB_JSON_CHUNK) {
      json = JSON.parse(new TextDecoder().decode(bytes.subarray(chunkStart, chunkEnd)));
    } else if (type === GLB_BINARY_CHUNK) {
      binary = bytes.subarray(chunkStart, chunkEnd);
    }
    offset = chunkEnd;
  }
  if (!json || !binary) throw new Error('The GLB must contain JSON and binary chunks.');

  const document = gltfDocument(json);
  return { document, binary };
}

function componentSize(componentType: number): number {
  if (componentType === 5121) return 1;
  if (componentType === 5123) return 2;
  if (componentType === 5125 || componentType === 5126) return 4;
  throw new Error(`The GLB uses unsupported component type ${componentType}.`);
}

function componentCount(type: string | undefined): number {
  if (type === 'SCALAR') return 1;
  if (type === 'VEC3') return 3;
  throw new Error(`The GLB uses unsupported accessor type ${type ?? 'unknown'}.`);
}

function readComponent(view: DataView, offset: number, componentType: number): number {
  if (componentType === 5121) return view.getUint8(offset);
  if (componentType === 5123) return view.getUint16(offset, true);
  if (componentType === 5125) return view.getUint32(offset, true);
  if (componentType === 5126) return view.getFloat32(offset, true);
  throw new Error(`The GLB uses unsupported component type ${componentType}.`);
}

function readGltfAccessor(
  document: GltfDocument,
  accessorIndex: number,
  binary: Uint8Array,
): number[] {
  const accessor = document.accessors?.[accessorIndex];
  if (!accessor || accessor.bufferView === undefined) {
    throw new Error('The GLB accessor has no binary data.');
  }
  const bufferView = document.bufferViews?.[accessor.bufferView];
  if (!bufferView || (bufferView.buffer ?? 0) !== 0) {
    throw new Error('The GLB accessor references an unavailable buffer.');
  }
  const count = accessorCount(accessor);
  const countPerElement = componentCount(accessor.type);
  const size = componentSize(accessor.componentType ?? 0);
  const stride = bufferView.byteStride ?? countPerElement * size;
  const elementSize = countPerElement * size;
  if (stride < elementSize) {
    throw new Error('The GLB accessor stride is smaller than its element size.');
  }
  const start = (bufferView.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const end = start + Math.max(count - 1, 0) * stride + elementSize;
  if (start < 0 || end > binary.byteLength) {
    throw new Error('The GLB accessor points outside its binary buffer.');
  }
  const view = viewFor(binary);
  const values: number[] = [];
  for (let index = 0; index < count; index++) {
    const elementOffset = start + index * stride;
    for (let component = 0; component < countPerElement; component++) {
      const value = readComponent(
        view,
        elementOffset + component * size,
        accessor.componentType ?? 0,
      );
      if (!Number.isFinite(value)) throw new Error('The GLB contains a non-finite value.');
      values.push(value);
    }
  }
  return values;
}

function triangleFor(
  vertices: Vec3[],
  first: number,
  second: number,
  third: number,
): MeshTriangle | null {
  if (
    !vertices[first] ||
    !vertices[second] ||
    !vertices[third] ||
    first === second ||
    first === third ||
    second === third
  ) {
    return null;
  }
  return { vertices: [vertices[first], vertices[second], vertices[third]] };
}

function glbMeshTriangles(
  document: GltfDocument,
  binary: Uint8Array,
  meshIndex: number,
  transform: readonly number[],
): MeshTriangle[] {
  const mesh = document.meshes?.[meshIndex];
  if (!mesh) throw new Error('The GLB node references an unavailable mesh.');
  const triangles: MeshTriangle[] = [];
  for (const primitive of mesh.primitives ?? []) {
    const positionIndex = primitive.attributes?.POSITION;
    if (positionIndex === undefined)
      throw new Error('The GLB contains a primitive without positions.');
    const positionValues = readGltfAccessor(document, positionIndex, binary);
    const vertices: Vec3[] = [];
    for (let index = 0; index < positionValues.length; index += 3) {
      vertices.push(
        transformPoint(transform, [
          positionValues[index],
          positionValues[index + 1],
          positionValues[index + 2],
        ]),
      );
    }
    const indices =
      primitive.indices === undefined
        ? vertices.map((_, index) => index)
        : readGltfAccessor(document, primitive.indices, binary);
    const mode = primitive.mode ?? 4;
    if (mode === 4) {
      for (let index = 0; index + 2 < indices.length; index += 3) {
        const triangle = triangleFor(
          vertices,
          indices[index],
          indices[index + 1],
          indices[index + 2],
        );
        if (triangle) triangles.push(triangle);
      }
    } else if (mode === 5 || mode === 6) {
      for (let index = 0; index + 2 < indices.length; index++) {
        let first = mode === 6 ? 0 : index;
        let second = index + 1;
        const third = index + 2;
        if (mode === 5 && index % 2 === 1) [first, second] = [second, first];
        const triangle = triangleFor(vertices, indices[first], indices[second], indices[third]);
        if (triangle) triangles.push(triangle);
      }
    }
  }
  return triangles;
}

function glbTriangles(
  bytes: Uint8Array,
  sourceTransform: readonly number[] = Y_UP_TO_Z_UP,
): MeshTriangle[] {
  const { document, binary } = readGlb(bytes);
  const triangles: MeshTriangle[] = [];
  const nodes = document.nodes ?? [];
  if (!nodes.length) {
    for (let meshIndex = 0; meshIndex < (document.meshes ?? []).length; meshIndex++) {
      triangles.push(...glbMeshTriangles(document, binary, meshIndex, sourceTransform));
    }
  } else {
    const visiting = new Set<number>();
    const visit = (nodeIndex: number, parentTransform: readonly number[]) => {
      const node = nodes[nodeIndex];
      if (!node) throw new Error('The GLB scene references an unavailable node.');
      if (visiting.has(nodeIndex)) throw new Error('The GLB node graph contains a cycle.');
      visiting.add(nodeIndex);
      const transform = matrixProduct(parentTransform, gltfNodeMatrix(node));
      if (node.mesh !== undefined) {
        triangles.push(...glbMeshTriangles(document, binary, node.mesh, transform));
      }
      for (const child of node.children ?? []) visit(child, transform);
      visiting.delete(nodeIndex);
    };
    for (const root of gltfRootNodes(document)) visit(root, sourceTransform);
  }
  if (!triangles.length) throw new Error('The GLB contains no complete triangles.');
  return triangles;
}

function scaleTriangles(triangles: readonly MeshTriangle[], scale: number): MeshTriangle[] {
  const scaleVertex = ([x, y, z]: Vec3): Vec3 => [x * scale, y * scale, z * scale];
  return triangles.map((triangle) => ({
    vertices: [
      scaleVertex(triangle.vertices[0]),
      scaleVertex(triangle.vertices[1]),
      scaleVertex(triangle.vertices[2]),
    ],
  }));
}

function transformTriangles(
  triangles: readonly MeshTriangle[],
  options: Required<MeshProcessingOptions>,
): MeshTriangle[] {
  const matrix = sourceAxisMatrix(options.upAxis);
  const scale = sourceUnitScale(options.unit);
  const transform = ([x, y, z]: Vec3): Vec3 => [
    (matrix[0] * x + matrix[4] * y + matrix[8] * z) * scale,
    (matrix[1] * x + matrix[5] * y + matrix[9] * z) * scale,
    (matrix[2] * x + matrix[6] * y + matrix[10] * z) * scale,
  ];
  return triangles.map((triangle) => ({
    vertices: [
      transform(triangle.vertices[0]),
      transform(triangle.vertices[1]),
      transform(triangle.vertices[2]),
    ],
  }));
}

function parseGlb(bytes: Uint8Array, options: Required<MeshProcessingOptions>): MeshMetadata {
  const { document } = readGlb(bytes);
  const triangles = scaleTriangles(
    glbTriangles(bytes, sourceAxisMatrix(options.upAxis)),
    sourceUnitScale(options.unit),
  );
  const vertexCount = (document.meshes ?? []).reduce(
    (count, mesh) =>
      count +
      (mesh.primitives ?? []).reduce((primitiveCount, primitive) => {
        const positionIndex = primitive.attributes?.POSITION;
        const position =
          positionIndex === undefined ? undefined : document.accessors?.[positionIndex];
        return primitiveCount + (position ? accessorCount(position) : 0);
      }, 0),
    0,
  );
  if (vertexCount === 0) throw new Error('The GLB contains no mesh positions.');
  return metadataFromBounds(
    'glb',
    boundsFromTriangles(triangles),
    vertexCount,
    triangles.length,
    options,
  );
}

function parseObjGeometry(bytes: Uint8Array): {
  bounds: Bounds;
  vertices: Vec3[];
  triangles: MeshTriangle[];
} {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const bounds = createBounds();
  const vertices: Vec3[] = [];
  const triangles: MeshTriangle[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const fields = line.split(/\s+/);
    if (fields[0] === 'v') {
      if (fields.length < 4) throw new Error('The OBJ contains an invalid vertex.');
      const position = fields.slice(1, 4).map(Number);
      if (!position.every(Number.isFinite)) throw new Error('The OBJ contains an invalid vertex.');
      const vertex: Vec3 = [position[0], position[1], position[2]];
      addPoint(bounds, vertex[0], vertex[1], vertex[2]);
      vertices.push(vertex);
    } else if (fields[0] === 'f' && fields.length >= 4) {
      const indices = fields.slice(1).map((field) => {
        const value = Number(field.split('/')[0]);
        if (!Number.isInteger(value) || value === 0)
          throw new Error('The OBJ contains an invalid face.');
        return value > 0 ? value - 1 : vertices.length + value;
      });
      for (let index = 1; index + 1 < indices.length; index++) {
        const triangle = triangleFor(vertices, indices[0], indices[index], indices[index + 1]);
        if (triangle) triangles.push(triangle);
      }
    }
  }
  if (vertices.length === 0) throw new Error('The OBJ contains no vertices.');
  return { bounds, vertices, triangles };
}

function parseObj(bytes: Uint8Array, options: Required<MeshProcessingOptions>): MeshMetadata {
  const geometry = parseObjGeometry(bytes);
  const triangles = transformTriangles(geometry.triangles, options);
  return metadataFromBounds(
    'obj',
    boundsFromTriangles(triangles),
    geometry.vertices.length,
    triangles.length,
    options,
  );
}

function parseBinaryStlTriangles(bytes: Uint8Array): MeshTriangle[] | null {
  if (bytes.byteLength < 84) return null;
  const view = viewFor(bytes);
  const triangleCount = uint32(view, 80);
  if (84 + triangleCount * 50 !== bytes.byteLength) return null;

  const triangles: MeshTriangle[] = [];
  for (let triangle = 0; triangle < triangleCount; triangle++) {
    const triangleOffset = 84 + triangle * 50;
    const vertices: Vec3[] = [];
    for (let vertex = 0; vertex < 3; vertex++) {
      const offset = triangleOffset + 12 + vertex * 12;
      vertices.push([float32(view, offset), float32(view, offset + 4), float32(view, offset + 8)]);
    }
    triangles.push({ vertices: [vertices[0], vertices[1], vertices[2]] });
  }
  if (!triangles.length) throw new Error('The STL contains no triangles.');
  return triangles;
}

function parseAsciiStlTriangles(bytes: Uint8Array): MeshTriangle[] {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const vertices: Vec3[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const fields = rawLine.trim().split(/\s+/);
    if (fields[0]?.toLowerCase() !== 'vertex' || fields.length < 4) continue;
    const position = fields.slice(1, 4).map(Number);
    if (!position.every(Number.isFinite))
      throw new Error('The ASCII STL contains an invalid vertex.');
    vertices.push([position[0], position[1], position[2]]);
  }
  if (vertices.length === 0 || vertices.length % 3 !== 0) {
    throw new Error('The STL contains no complete triangles.');
  }
  const triangles: MeshTriangle[] = [];
  for (let index = 0; index < vertices.length; index += 3) {
    triangles.push({ vertices: [vertices[index], vertices[index + 1], vertices[index + 2]] });
  }
  return triangles;
}

function stlTriangles(bytes: Uint8Array): MeshTriangle[] {
  return parseBinaryStlTriangles(bytes) ?? parseAsciiStlTriangles(bytes);
}

function boundsFromTriangles(triangles: readonly MeshTriangle[]): Bounds {
  const bounds = createBounds();
  for (const triangle of triangles) {
    for (const vertex of triangle.vertices) addPoint(bounds, vertex[0], vertex[1], vertex[2]);
  }
  return bounds;
}

function recenterTriangles(triangles: readonly MeshTriangle[]): MeshTriangle[] {
  const bounds = boundsFromTriangles(triangles);
  const center: Vec3 = [
    (bounds.min[0] + bounds.max[0]) / 2,
    (bounds.min[1] + bounds.max[1]) / 2,
    (bounds.min[2] + bounds.max[2]) / 2,
  ];
  return triangles.map((triangle) => ({
    vertices: [
      [
        triangle.vertices[0][0] - center[0],
        triangle.vertices[0][1] - center[1],
        triangle.vertices[0][2] - center[2],
      ],
      [
        triangle.vertices[1][0] - center[0],
        triangle.vertices[1][1] - center[1],
        triangle.vertices[1][2] - center[2],
      ],
      [
        triangle.vertices[2][0] - center[0],
        triangle.vertices[2][1] - center[1],
        triangle.vertices[2][2] - center[2],
      ],
    ],
  }));
}

function parseStl(bytes: Uint8Array, options: Required<MeshProcessingOptions>): MeshMetadata {
  const triangles = transformTriangles(stlTriangles(bytes), options);
  return metadataFromBounds(
    'stl',
    boundsFromTriangles(triangles),
    triangles.length * 3,
    triangles.length,
    options,
  );
}

function sourceTriangles(
  bytes: Uint8Array,
  filename: string,
  options: Required<MeshProcessingOptions>,
): MeshTriangle[] | null {
  const extension = filename.split('.').at(-1)?.toLowerCase();
  if (extension === 'glb') {
    return scaleTriangles(
      glbTriangles(bytes, sourceAxisMatrix(options.upAxis)),
      sourceUnitScale(options.unit),
    );
  }
  if (extension === 'obj') return transformTriangles(parseObjGeometry(bytes).triangles, options);
  if (extension === 'stl') return transformTriangles(stlTriangles(bytes), options);
  return null;
}

export interface MeshTrianglesResult {
  triangles: MeshTriangle[] | null;
  error: string | null;
}

export function extractMeshTriangles(bytes: Uint8Array, filename: string): MeshTrianglesResult {
  const extension = filename.split('.').at(-1)?.toLowerCase();
  try {
    const triangles =
      extension === 'glb'
        ? glbTriangles(bytes)
        : extension === 'obj'
          ? parseObjGeometry(bytes).triangles
          : extension === 'stl'
            ? stlTriangles(bytes)
            : null;
    if (!triangles)
      return { triangles: null, error: 'Only GLB, OBJ, and STL meshes are supported.' };
    return { triangles, error: null };
  } catch (error) {
    return {
      triangles: null,
      error: meshError(error, 'The mesh triangles could not be extracted.'),
    };
  }
}

function dot(first: Vec3, second: Vec3): number {
  return first[0] * second[0] + first[1] * second[1] + first[2] * second[2];
}

function normalized(vector: Vec3): Vec3 {
  const length = Math.hypot(vector[0], vector[1], vector[2]);
  if (length < 1e-12) return [0, 1, 0];
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}

function cross(first: Vec3, second: Vec3): Vec3 {
  return [
    first[1] * second[2] - first[2] * second[1],
    first[2] * second[0] - first[0] * second[2],
    first[0] * second[1] - first[1] * second[0],
  ];
}

interface ProjectedVertex {
  x: number;
  y: number;
  depth: number;
}

interface ProjectedTriangle {
  vertices: [ProjectedVertex, ProjectedVertex, ProjectedVertex];
  normal: Vec3;
  depth: number;
}

export interface MeshThumbnailResult {
  svg: string | null;
  error: string | null;
}

export function createMeshThumbnailSvg(bytes: Uint8Array, filename: string): MeshThumbnailResult {
  const result = extractMeshTriangles(bytes, filename);
  if (!result.triangles) return { svg: null, error: result.error };

  const triangles = result.triangles;
  const bounds = boundsFromTriangles(triangles);
  const center: Vec3 = [
    (bounds.min[0] + bounds.max[0]) / 2,
    (bounds.min[1] + bounds.max[1]) / 2,
    (bounds.min[2] + bounds.max[2]) / 2,
  ];
  const view = normalized([0.72, 0.58, 0.92]);
  const right = normalized([view[2], 0, -view[0]]);
  const up = normalized(cross(view, right));
  const projected = triangles.slice(0, 2_500).map((triangle) => {
    const normal = normalForTriangle(triangle.vertices);
    if (!normal) return null;
    const vertices = triangle.vertices.map((vertex) => {
      const local: Vec3 = [vertex[0] - center[0], vertex[1] - center[1], vertex[2] - center[2]];
      return { x: dot(local, right), y: dot(local, up), depth: dot(local, view) };
    }) as [ProjectedVertex, ProjectedVertex, ProjectedVertex];
    return {
      vertices,
      normal,
      depth: vertices.reduce((sum, vertex) => sum + vertex.depth, 0) / vertices.length,
    } satisfies ProjectedTriangle;
  });
  const projectedTriangles = projected.filter((triangle): triangle is ProjectedTriangle =>
    Boolean(triangle),
  );
  if (!projectedTriangles.length) {
    return { svg: null, error: 'The mesh contains no drawable triangles.' };
  }

  const allVertices = projectedTriangles.flatMap((triangle) => triangle.vertices);
  const minX = Math.min(...allVertices.map((vertex) => vertex.x));
  const maxX = Math.max(...allVertices.map((vertex) => vertex.x));
  const minY = Math.min(...allVertices.map((vertex) => vertex.y));
  const maxY = Math.max(...allVertices.map((vertex) => vertex.y));
  const scale = 238 / Math.max(maxX - minX, maxY - minY, 0.001);
  const offsetX = 160 - ((minX + maxX) / 2) * scale;
  const offsetY = 160 + ((minY + maxY) / 2) * scale;
  const light = normalized([-0.45, 0.85, 0.35]);

  projectedTriangles.sort((first, second) => first.depth - second.depth);
  const polygons = projectedTriangles
    .map((triangle) => {
      const shade = 0.28 + 0.72 * Math.max(0, dot(triangle.normal, light));
      const color = [72, 156, 190].map((channel) => Math.round(channel * shade));
      const points = triangle.vertices
        .map(
          (vertex) =>
            `${(vertex.x * scale + offsetX).toFixed(2)},${(offsetY - vertex.y * scale).toFixed(2)}`,
        )
        .join(' ');
      return `<polygon points="${points}" fill="rgb(${color.join(',')})" stroke="#d7edf2" stroke-opacity="0.2" stroke-width="0.7"/>`;
    })
    .join('');

  return {
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="320" viewBox="0 0 320 320"><rect width="320" height="320" fill="#111821"/><ellipse cx="160" cy="275" rx="92" ry="18" fill="#05070a" fill-opacity="0.5"/>${polygons}</svg>`,
    error: null,
  };
}

function normalForTriangle([first, second, third]: readonly [Vec3, Vec3, Vec3]): Vec3 | null {
  const ab: Vec3 = [second[0] - first[0], second[1] - first[1], second[2] - first[2]];
  const ac: Vec3 = [third[0] - first[0], third[1] - first[1], third[2] - first[2]];
  const normal: Vec3 = [
    ab[1] * ac[2] - ab[2] * ac[1],
    ab[2] * ac[0] - ab[0] * ac[2],
    ab[0] * ac[1] - ab[1] * ac[0],
  ];
  const length = Math.hypot(normal[0], normal[1], normal[2]);
  if (length < 1e-12) return null;
  return [normal[0] / length, normal[1] / length, normal[2] / length];
}

function binaryStlFromTriangles(triangles: readonly MeshTriangle[], name: string): Uint8Array {
  const validTriangles = triangles
    .map((triangle) => ({ triangle, normal: normalForTriangle(triangle.vertices) }))
    .filter((entry): entry is { triangle: MeshTriangle; normal: Vec3 } => Boolean(entry.normal));
  if (!validTriangles.length) throw new Error('The mesh contains no non-degenerate triangles.');

  const bytes = new Uint8Array(84 + validTriangles.length * 50);
  const header = new TextEncoder().encode(name.slice(0, 80));
  bytes.set(header, 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(80, validTriangles.length, true);
  for (const [index, entry] of validTriangles.entries()) {
    const offset = 84 + index * 50;
    const values = [
      ...entry.normal,
      ...entry.triangle.vertices[0],
      ...entry.triangle.vertices[1],
      ...entry.triangle.vertices[2],
    ];
    values.forEach((value, valueIndex) => view.setFloat32(offset + valueIndex * 4, value, true));
    view.setUint16(offset + 48, 0, true);
  }
  return bytes;
}

function stlFromTriangles(triangles: readonly MeshTriangle[]): Uint8Array {
  return binaryStlFromTriangles(triangles, 'mujoco_canonical_mesh');
}

function collisionTriangles(faces: readonly { vertices: readonly Vec3[] }[]): MeshTriangle[] {
  const triangles: MeshTriangle[] = [];
  for (const face of faces) {
    triangles.push(
      { vertices: [face.vertices[0], face.vertices[1], face.vertices[2]] },
      { vertices: [face.vertices[0], face.vertices[2], face.vertices[3]] },
    );
  }
  return triangles;
}

export interface MeshConversionResult {
  bytes: Uint8Array | null;
  error: string | null;
}

export function convertMeshToCanonicalStl(
  bytes: Uint8Array,
  filename: string,
  options?: MeshProcessingOptions,
): MeshConversionResult {
  try {
    const triangles = sourceTriangles(bytes, filename, processingOptions(filename, options));
    if (!triangles) return { bytes: null, error: 'Only GLB, OBJ, and STL meshes are supported.' };
    return { bytes: stlFromTriangles(recenterTriangles(triangles)), error: null };
  } catch (error) {
    return {
      bytes: null,
      error: meshError(error, 'The mesh could not be converted.'),
    };
  }
}

export function extractMeshMetadataWithOptions(
  bytes: Uint8Array,
  filename: string,
  options?: MeshProcessingOptions,
): MeshMetadataResult {
  const resolved = processingOptions(filename, options);
  try {
    const extension = filename.split('.').at(-1)?.toLowerCase();
    const metadata =
      extension === 'glb'
        ? parseGlb(bytes, resolved)
        : extension === 'obj'
          ? parseObj(bytes, resolved)
          : extension === 'stl'
            ? parseStl(bytes, resolved)
            : null;
    if (!metadata) return { metadata: null, error: 'Only GLB, OBJ, and STL meshes are supported.' };
    return { metadata, error: null };
  } catch (error) {
    return {
      metadata: null,
      error: meshError(error, 'The mesh could not be analyzed.'),
    };
  }
}

export function createBoxCollisionStl(dimensions: readonly number[]): Uint8Array {
  if (dimensions.length !== 3 || !dimensions.every(Number.isFinite)) {
    throw new Error('Collision dimensions must contain three finite values.');
  }
  if (!dimensions.every((dimension) => dimension >= 0)) {
    throw new Error('Collision dimensions cannot be negative.');
  }

  const half: Vec3 = [
    Math.max(dimensions[0], 0.001) / 2,
    Math.max(dimensions[1], 0.001) / 2,
    Math.max(dimensions[2], 0.001) / 2,
  ];
  const [halfX, halfY, halfZ] = half;
  const faces: readonly { vertices: readonly Vec3[] }[] = [
    {
      vertices: [
        [halfX, -halfY, -halfZ],
        [halfX, halfY, -halfZ],
        [halfX, halfY, halfZ],
        [halfX, -halfY, halfZ],
      ],
    },
    {
      vertices: [
        [-halfX, -halfY, halfZ],
        [-halfX, halfY, halfZ],
        [-halfX, halfY, -halfZ],
        [-halfX, -halfY, -halfZ],
      ],
    },
    {
      vertices: [
        [-halfX, halfY, -halfZ],
        [-halfX, halfY, halfZ],
        [halfX, halfY, halfZ],
        [halfX, halfY, -halfZ],
      ],
    },
    {
      vertices: [
        [-halfX, -halfY, halfZ],
        [-halfX, -halfY, -halfZ],
        [halfX, -halfY, -halfZ],
        [halfX, -halfY, halfZ],
      ],
    },
    {
      vertices: [
        [-halfX, -halfY, halfZ],
        [halfX, -halfY, halfZ],
        [halfX, halfY, halfZ],
        [-halfX, halfY, halfZ],
      ],
    },
    {
      vertices: [
        [halfX, -halfY, -halfZ],
        [-halfX, -halfY, -halfZ],
        [-halfX, halfY, -halfZ],
        [halfX, halfY, -halfZ],
      ],
    },
  ];
  return binaryStlFromTriangles(collisionTriangles(faces), 'mujoco_collision_box');
}
