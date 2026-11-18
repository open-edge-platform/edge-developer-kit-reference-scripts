// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import {
  GeomType,
  type BodyNode,
  type CameraNode,
  type GeomNode,
  type JointNode,
  type LightNode,
  type Rgba,
  type SceneGraph,
  type SceneNode,
  type SensorNode,
  type SensorType,
  type SiteNode,
  type Vec3,
} from '@mujoco-studio/types';

import { loadMujoco, type Mujoco, type RuntimeOptions } from './runtime';
import { Simulation } from './simulation';

export interface LoadedScene {
  simulation: Simulation;
  graph: SceneGraph;
}

/**
 * Compiles MJCF into a live simulation and derives the editor scene graph from
 * the compiled model.
 */
export class SceneLoader {
  constructor(private readonly mujoco: Mujoco) {}

  static async create(options?: RuntimeOptions): Promise<SceneLoader> {
    return new SceneLoader(await loadMujoco(options));
  }

  loadFromXml(xml: string, name = 'scene'): LoadedScene {
    const simulation = new Simulation(this.mujoco, xml, name);
    return { simulation, graph: buildSceneGraph(simulation) };
  }
}

/** Derives a body-rooted tree of geoms, joints, lights, cameras and sites. */
export function buildSceneGraph(sim: Simulation): SceneGraph {
  const model = sim.model;
  const nodes: Record<string, SceneNode> = {};

  const bodyParent = model.body_parentid as Int32Array;
  const bodyMass = model.body_mass as Float64Array;
  const nameBodyAdr = model.name_bodyadr as Int32Array;

  const bodyIdOf = (index: number) => `body:${index}`;

  for (let b = 0; b < model.nbody; b++) {
    const node: BodyNode = {
      id: bodyIdOf(b),
      kind: 'body',
      name: sim.nameAt(nameBodyAdr[b]) || (b === 0 ? 'world' : `body_${b}`),
      mjIndex: b,
      parentId: b === 0 ? null : bodyIdOf(bodyParent[b]),
      childIds: [],
      mass: bodyMass[b],
    };
    nodes[node.id] = node;
  }
  for (let b = 1; b < model.nbody; b++) {
    nodes[bodyIdOf(bodyParent[b])].childIds.push(bodyIdOf(b));
  }

  attachGeoms(sim, nodes, bodyIdOf);
  attachJoints(sim, nodes, bodyIdOf);
  attachLights(sim, nodes, bodyIdOf);
  attachCameras(sim, nodes, bodyIdOf);
  attachSites(sim, nodes, bodyIdOf);
  attachSensors(sim, nodes, bodyIdOf);

  const order: string[] = [];
  const visit = (id: string) => {
    order.push(id);
    for (const child of nodes[id].childIds) visit(child);
  };
  visit(bodyIdOf(0));

  return { rootId: bodyIdOf(0), nodes, order };
}

function attachGeoms(
  sim: Simulation,
  nodes: Record<string, SceneNode>,
  bodyIdOf: (i: number) => string,
): void {
  const model = sim.model;
  const geomBodyId = model.geom_bodyid as Int32Array;
  const geomType = model.geom_type as Int32Array;
  const geomSize = model.geom_size as Float64Array;
  const geomRgba = model.geom_rgba as Float32Array;
  const geomGroup = model.geom_group as Int32Array;
  const geomMatId = model.geom_matid as Int32Array;
  const geomDataId = model.geom_dataid as Int32Array;
  const matRgba = model.mat_rgba as Float32Array;
  const nameMatAdr = model.name_matadr as Int32Array;
  const nameGeomAdr = model.name_geomadr as Int32Array;

  for (let g = 0; g < model.ngeom; g++) {
    const matId = geomMatId[g];
    const rgba: Rgba =
      matId >= 0
        ? [
            matRgba[matId * 4],
            matRgba[matId * 4 + 1],
            matRgba[matId * 4 + 2],
            matRgba[matId * 4 + 3],
          ]
        : [geomRgba[g * 4], geomRgba[g * 4 + 1], geomRgba[g * 4 + 2], geomRgba[g * 4 + 3]];

    const parentId = bodyIdOf(geomBodyId[g]);
    const node: GeomNode = {
      id: `geom:${g}`,
      kind: 'geom',
      name: sim.nameAt(nameGeomAdr[g]) || `geom_${g}`,
      mjIndex: g,
      parentId,
      childIds: [],
      geomType: geomType[g] as GeomType,
      size: [geomSize[g * 3], geomSize[g * 3 + 1], geomSize[g * 3 + 2]] as Vec3,
      rgba,
      group: geomGroup[g],
      materialName: matId >= 0 ? sim.nameAt(nameMatAdr[matId]) || null : null,
      meshId: geomType[g] === GeomType.Mesh ? geomDataId[g] : -1,
    };
    nodes[node.id] = node;
    nodes[parentId].childIds.push(node.id);
  }
}

function attachJoints(
  sim: Simulation,
  nodes: Record<string, SceneNode>,
  bodyIdOf: (i: number) => string,
): void {
  const model = sim.model;
  const jntBodyId = model.jnt_bodyid as Int32Array;
  const jntType = model.jnt_type as Int32Array;
  const jntAxis = model.jnt_axis as Float64Array;
  const jntRange = model.jnt_range as Float64Array;
  const nameJntAdr = model.name_jntadr as Int32Array;

  for (let j = 0; j < model.njnt; j++) {
    const parentId = bodyIdOf(jntBodyId[j]);
    const lower = jntRange[j * 2];
    const upper = jntRange[j * 2 + 1];
    const node: JointNode = {
      id: `joint:${j}`,
      kind: 'joint',
      name: sim.nameAt(nameJntAdr[j]) || `joint_${j}`,
      mjIndex: j,
      parentId,
      childIds: [],
      jointType: jntType[j] as JointNode['jointType'],
      axis: [jntAxis[j * 3], jntAxis[j * 3 + 1], jntAxis[j * 3 + 2]] as Vec3,
      range: [lower, upper] as const,
      // `jnt_limited` is an mjtByte array that embind cannot marshal, so the
      // limit is inferred from a non-degenerate range instead.
      limited: lower !== upper,
    };
    nodes[node.id] = node;
    nodes[parentId].childIds.push(node.id);
  }
}

function attachLights(
  sim: Simulation,
  nodes: Record<string, SceneNode>,
  bodyIdOf: (i: number) => string,
): void {
  const model = sim.model;
  const lightBodyId = model.light_bodyid as Int32Array;
  const lightType = model.light_type as Int32Array;
  const lightCutoff = model.light_cutoff as Float32Array | Float64Array;
  const lightExponent = model.light_exponent as Float32Array | Float64Array;
  const nameLightAdr = model.name_lightadr as Int32Array;

  for (let l = 0; l < model.nlight; l++) {
    const parentId = bodyIdOf(Math.max(lightBodyId[l], 0));
    const node: LightNode = {
      id: `light:${l}`,
      kind: 'light',
      name: sim.nameAt(nameLightAdr[l]) || `light_${l}`,
      mjIndex: l,
      parentId,
      childIds: [],
      lightType: lightType[l] as LightNode['lightType'],
      cutoff: lightCutoff[l],
      exponent: lightExponent[l],
    };
    nodes[node.id] = node;
    nodes[parentId].childIds.push(node.id);
  }
}

function attachCameras(
  sim: Simulation,
  nodes: Record<string, SceneNode>,
  bodyIdOf: (i: number) => string,
): void {
  const model = sim.model;
  const camBodyId = model.cam_bodyid as Int32Array;
  const camFovy = model.cam_fovy as Float64Array;
  const nameCamAdr = model.name_camadr as Int32Array;

  for (let c = 0; c < model.ncam; c++) {
    const parentId = bodyIdOf(Math.max(camBodyId[c], 0));
    const node: CameraNode = {
      id: `camera:${c}`,
      kind: 'camera',
      name: sim.nameAt(nameCamAdr[c]) || `camera_${c}`,
      mjIndex: c,
      parentId,
      childIds: [],
      fovy: camFovy[c],
    };
    nodes[node.id] = node;
    nodes[parentId].childIds.push(node.id);
  }
}

function attachSites(
  sim: Simulation,
  nodes: Record<string, SceneNode>,
  bodyIdOf: (i: number) => string,
): void {
  const model = sim.model;
  const siteBodyId = model.site_bodyid as Int32Array;
  const nameSiteAdr = model.name_siteadr as Int32Array;

  for (let s = 0; s < model.nsite; s++) {
    const parentId = bodyIdOf(siteBodyId[s]);
    const node: SiteNode = {
      id: `site:${s}`,
      kind: 'site',
      name: sim.nameAt(nameSiteAdr[s]) || `site_${s}`,
      mjIndex: s,
      parentId,
      childIds: [],
    };
    nodes[node.id] = node;
    nodes[parentId].childIds.push(node.id);
  }
}

function sensorParentId(
  objectType: number,
  objectId: number,
  nodes: Record<string, SceneNode>,
  bodyIdOf: (i: number) => string,
): string {
  const targetId =
    objectType === 1 || objectType === 2
      ? bodyIdOf(objectId)
      : objectType === 3
        ? `joint:${objectId}`
        : objectType === 5
          ? `geom:${objectId}`
          : objectType === 6
            ? `site:${objectId}`
            : objectType === 7
              ? `camera:${objectId}`
              : objectType === 8
                ? `light:${objectId}`
                : bodyIdOf(0);
  return nodes[targetId] ? targetId : bodyIdOf(0);
}

function attachSensors(
  sim: Simulation,
  nodes: Record<string, SceneNode>,
  bodyIdOf: (i: number) => string,
): void {
  const model = sim.model;
  const sensorType = model.sensor_type as Int32Array;
  const sensorObjectType = model.sensor_objtype as Int32Array;
  const sensorObjectId = model.sensor_objid as Int32Array;
  const sensorDimension = model.sensor_dim as Int32Array;
  const nameSensorAdr = model.name_sensoradr as Int32Array;

  for (let s = 0; s < model.nsensor; s++) {
    const objectType = sensorObjectType[s];
    const objectId = sensorObjectId[s];
    const parentId = sensorParentId(objectType, objectId, nodes, bodyIdOf);
    const node: SensorNode = {
      id: `sensor:${s}`,
      kind: 'sensor',
      name: sim.nameAt(nameSensorAdr[s]) || `sensor_${s}`,
      mjIndex: s,
      parentId,
      childIds: [],
      sensorType: sensorType[s] as SensorType,
      objectType,
      objectId,
      dimension: sensorDimension[s],
    };
    nodes[node.id] = node;
    nodes[parentId].childIds.push(node.id);
  }
}
