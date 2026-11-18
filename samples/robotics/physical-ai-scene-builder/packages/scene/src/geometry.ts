// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import type { Simulation } from '@mujoco-studio/mujoco';
import { GeomType, type GeomNode } from '@mujoco-studio/types';
import * as THREE from 'three';

/** Extent used for MJCF planes declared with size 0 (infinite). */
const INFINITE_PLANE_EXTENT = 40;

/**
 * Builds the Three.js geometry for a MuJoCo geom.
 *
 * Primitives are generated in MuJoCo's convention (capsules and cylinders run
 * along +Z), so they can be driven directly by `geom_xmat`.
 */
export function createGeomGeometry(sim: Simulation, node: GeomNode): THREE.BufferGeometry | null {
  const [sx, sy, sz] = node.size;

  switch (node.geomType) {
    case GeomType.Plane: {
      const width = sx > 0 ? sx * 2 : INFINITE_PLANE_EXTENT;
      const depth = sy > 0 ? sy * 2 : INFINITE_PLANE_EXTENT;
      return new THREE.PlaneGeometry(width, depth);
    }
    case GeomType.Sphere:
      return new THREE.SphereGeometry(sx, 32, 20);
    case GeomType.Ellipsoid: {
      const geometry = new THREE.SphereGeometry(1, 32, 20);
      geometry.scale(sx, sy, sz);
      return geometry;
    }
    case GeomType.Capsule: {
      const geometry = new THREE.CapsuleGeometry(sx, sy * 2, 8, 24);
      geometry.rotateX(Math.PI / 2);
      return geometry;
    }
    case GeomType.Cylinder: {
      const geometry = new THREE.CylinderGeometry(sx, sx, sy * 2, 32);
      geometry.rotateX(Math.PI / 2);
      return geometry;
    }
    case GeomType.Box:
      return new THREE.BoxGeometry(sx * 2, sy * 2, sz * 2);
    case GeomType.Mesh:
      return createMeshGeometry(sim, node.meshId);
    case GeomType.HeightField:
      return createHeightFieldGeometry(sim, node.mjIndex);
    default:
      return null;
  }
}

/**
 * Surface of a compiled heightfield in its geom frame: samples span [-size0, size0] x
 * [-size1, size1], row 0 at -y as stored in mjModel, elevation `data * size2` above the geom
 * origin. The solid base below z = 0 is omitted; the surface is what picking and outlines need.
 */
function createHeightFieldGeometry(
  sim: Simulation,
  geomIndex: number,
): THREE.BufferGeometry | null {
  const model = sim.model;
  const fieldId = (model.geom_dataid as Int32Array)[geomIndex];
  if (fieldId === undefined || fieldId < 0) return null;
  const nrow = (model.hfield_nrow as Int32Array)[fieldId];
  const ncol = (model.hfield_ncol as Int32Array)[fieldId];
  const address = (model.hfield_adr as Int32Array)[fieldId];
  const size = (model.hfield_size as Float64Array).subarray(fieldId * 4, fieldId * 4 + 4);
  const data = model.hfield_data as Float32Array;
  if (nrow < 2 || ncol < 2) return null;

  const positions = new Float32Array(nrow * ncol * 3);
  for (let row = 0; row < nrow; row++) {
    for (let col = 0; col < ncol; col++) {
      const vertex = (row * ncol + col) * 3;
      positions[vertex] = -size[0] + (2 * size[0] * col) / (ncol - 1);
      positions[vertex + 1] = -size[1] + (2 * size[1] * row) / (nrow - 1);
      positions[vertex + 2] = data[address + row * ncol + col] * size[2];
    }
  }
  const indices = new Uint32Array((nrow - 1) * (ncol - 1) * 6);
  let offset = 0;
  for (let row = 0; row < nrow - 1; row++) {
    for (let col = 0; col < ncol - 1; col++) {
      const a = row * ncol + col;
      const b = a + 1;
      const c = a + ncol;
      const d = c + 1;
      indices.set([a, b, d, a, d, c], offset);
      offset += 6;
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeVertexNormals();
  return geometry;
}

function createMeshGeometry(sim: Simulation, meshId: number): THREE.BufferGeometry | null {
  if (meshId < 0) return null;

  const model = sim.model;
  const vertAdr = (model.mesh_vertadr as Int32Array)[meshId];
  const vertNum = (model.mesh_vertnum as Int32Array)[meshId];
  const faceAdr = (model.mesh_faceadr as Int32Array)[meshId];
  const faceNum = (model.mesh_facenum as Int32Array)[meshId];
  const verts = model.mesh_vert as Float32Array;
  const faces = model.mesh_face as Int32Array;

  const texcoordAdr = (model.mesh_texcoordadr as Int32Array | undefined)?.[meshId];
  const texcoordNum = (model.mesh_texcoordnum as Int32Array | undefined)?.[meshId];
  const texcoords = model.mesh_texcoord as Float32Array | undefined;
  const faceTexcoords = model.mesh_facetexcoord as Int32Array | undefined;

  const positions = new Float32Array(vertNum * 3);
  positions.set(verts.subarray(vertAdr * 3, (vertAdr + vertNum) * 3));

  const indices = new Uint32Array(faceNum * 3);
  for (let i = 0; i < indices.length; i++) {
    indices[i] = faces[faceAdr * 3 + i];
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeVertexNormals();
  if (
    texcoords &&
    faceTexcoords &&
    typeof texcoordAdr === 'number' &&
    Number.isInteger(texcoordAdr) &&
    typeof texcoordNum === 'number' &&
    Number.isInteger(texcoordNum) &&
    texcoordNum > 0 &&
    faceTexcoords.length >= (faceAdr + faceNum) * 3
  ) {
    const normals = geometry.getAttribute('normal');
    const remappedPositions: number[] = [];
    const remappedNormals: number[] = [];
    const remappedUvs: number[] = [];
    const remappedIndices = new Uint32Array(faceNum * 3);
    const vertexByCorner = new Map<string, number>();
    let usableUvs = true;

    for (let corner = 0; corner < remappedIndices.length; corner++) {
      const vertexIndex = faces[faceAdr * 3 + corner];
      const texcoordIndex = faceTexcoords[faceAdr * 3 + corner];
      if (
        vertexIndex < 0 ||
        vertexIndex >= vertNum ||
        texcoordIndex < 0 ||
        texcoordIndex >= texcoordNum ||
        (texcoordAdr + texcoordIndex) * 2 + 1 >= texcoords.length
      ) {
        usableUvs = false;
        break;
      }

      const key = `${vertexIndex}:${texcoordIndex}`;
      let remappedIndex = vertexByCorner.get(key);
      if (remappedIndex === undefined) {
        remappedIndex = vertexByCorner.size;
        vertexByCorner.set(key, remappedIndex);
        remappedPositions.push(
          positions[vertexIndex * 3],
          positions[vertexIndex * 3 + 1],
          positions[vertexIndex * 3 + 2],
        );
        remappedNormals.push(
          normals.getX(vertexIndex),
          normals.getY(vertexIndex),
          normals.getZ(vertexIndex),
        );
        remappedUvs.push(
          texcoords[(texcoordAdr + texcoordIndex) * 2],
          1 - texcoords[(texcoordAdr + texcoordIndex) * 2 + 1],
        );
      }
      remappedIndices[corner] = remappedIndex;
    }

    if (usableUvs) {
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(remappedPositions, 3));
      geometry.setAttribute('normal', new THREE.Float32BufferAttribute(remappedNormals, 3));
      geometry.setAttribute('uv', new THREE.Float32BufferAttribute(remappedUvs, 2));
      geometry.setIndex(new THREE.BufferAttribute(remappedIndices, 1));
    } else {
      addBoxProjectionUvs(geometry);
    }
  } else {
    addBoxProjectionUvs(geometry);
  }
  return geometry;
}

function addBoxProjectionUvs(geometry: THREE.BufferGeometry): void {
  geometry.computeBoundingBox();
  const bounds = geometry.boundingBox;
  const positions = geometry.getAttribute('position');
  const normals = geometry.getAttribute('normal');
  if (!bounds || !positions || !normals) return;

  const width = Math.max(bounds.max.x - bounds.min.x, Number.EPSILON);
  const depth = Math.max(bounds.max.y - bounds.min.y, Number.EPSILON);
  const height = Math.max(bounds.max.z - bounds.min.z, Number.EPSILON);
  const uvs = new Float32Array(positions.count * 2);
  for (let index = 0; index < positions.count; index++) {
    const x = (positions.getX(index) - bounds.min.x) / width;
    const y = (positions.getY(index) - bounds.min.y) / depth;
    const z = (positions.getZ(index) - bounds.min.z) / height;
    const nx = Math.abs(normals.getX(index));
    const ny = Math.abs(normals.getY(index));
    const nz = Math.abs(normals.getZ(index));

    if (nx >= ny && nx >= nz) {
      uvs[index * 2] = z;
      uvs[index * 2 + 1] = y;
    } else if (ny >= nz) {
      uvs[index * 2] = x;
      uvs[index * 2 + 1] = z;
    } else {
      uvs[index * 2] = x;
      uvs[index * 2 + 1] = y;
    }
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
}
