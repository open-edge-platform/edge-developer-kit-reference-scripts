// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

export interface SampleScene {
  id: string;
  name: string;
  description: string;
  xml: string;
  sourceSceneId?: number;
}

const EMPTY_SCENE: SampleScene = {
  id: 'empty',
  name: 'New scene',
  description: 'An empty scene with a floor plane.',
  xml: `<mujoco model="new-scene">
  <option timestep="0.002" gravity="0 0 -9.81"/>

  <asset>
    <material name="floor" rgba="0.22 0.24 0.28 1"/>
  </asset>

  <worldbody>
    <light name="key" pos="0 0 3" dir="0 0 -1" diffuse="1 1 1"/>
    <geom name="floor" type="plane" size="4 4 0.1" material="floor"/>
  </worldbody>
</mujoco>
`,
};

const SO101_TEMPLATE: SampleScene = {
  id: 'so101',
  name: 'so101',
  description: 'SO101 evaluation setup with its table, task objects, and cameras.',
  xml: '',
  sourceSceneId: 1,
};

export const SAMPLE_SCENES: SampleScene[] = [EMPTY_SCENE, SO101_TEMPLATE];

export const DEFAULT_SCENE = SAMPLE_SCENES[0];
