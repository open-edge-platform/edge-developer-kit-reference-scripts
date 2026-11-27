// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import * as THREE from 'three';

/**
 * MuJoCo's renderer shades with classic Phong: `albedo * (ambient + diffuse * cos) + specular *
 * lightSpecular * max(n.h, 0)^(shininess * 128) + emission * albedo`, with no energy conservation
 * or Fresnel term. three.js PBR materials (roughness and metalness) light flat areas about 13%
 * brighter, so the camera preview, which must match recorded images, uses a three.js Phong material
 * patched to MuJoCo's specular term. Lights already carry intensity pi (three.js divides diffuse by
 * pi), so the diffuse term matches as is.
 */

/** A geom's MuJoCo material values (`mat_*`, or MuJoCo's defaults without a material). */
export interface MujocoGeomShading {
  specular: number;
  shininess: number;
  emission: number;
}

/** MuJoCo's defaults for a geom without a material (mjsMaterial defaults). */
export const DEFAULT_GEOM_SHADING: MujocoGeomShading = {
  specular: 0.5,
  shininess: 0.5,
  emission: 0,
};

interface ShadingModel {
  ngeom: number;
  geom_matid: ArrayLike<number>;
  mat_specular: ArrayLike<number>;
  mat_shininess: ArrayLike<number>;
  mat_emission: ArrayLike<number>;
}

export function geomShading(model: ShadingModel, geomIndex: number): MujocoGeomShading {
  if (geomIndex < 0 || geomIndex >= model.ngeom) return DEFAULT_GEOM_SHADING;
  const material = model.geom_matid[geomIndex];
  if (material < 0) return DEFAULT_GEOM_SHADING;
  return {
    specular: model.mat_specular[material],
    shininess: model.mat_shininess[material],
    emission: model.mat_emission[material],
  };
}

/** `mjLIGHT_POINT`: the native renderer ignores point lights (see ViewportLighting). */
export const MUJOCO_POINT_LIGHT = 2;

interface LightModel {
  nlight: number;
  light_type: ArrayLike<number>;
  light_diffuse: ArrayLike<number>;
  light_specular: ArrayLike<number>;
  vis: {
    headlight: {
      active: number;
      diffuse: ArrayLike<number>;
      specular: ArrayLike<number>;
    };
  };
}

const mean3 = (values: ArrayLike<number>, offset = 0) =>
  (values[offset] + values[offset + 1] + values[offset + 2]) / 3;

/**
 * three.js lights have one color, which the preview sets to the MuJoCo light's diffuse color.
 * MuJoCo lights also have a separate specular color. The preview scales every highlight by the
 * scene's specular-to-diffuse ratio over its lights and headlight. That is exact when all
 * lights share the ratio, as MuJoCo's defaults do for authored lights (0.3 / 0.7).
 */
export function sceneSpecularScale(model: LightModel): number {
  let diffuse = 0;
  let specular = 0;
  for (let index = 0; index < model.nlight; index++) {
    if (model.light_type[index] === MUJOCO_POINT_LIGHT) continue;
    diffuse += mean3(model.light_diffuse, index * 3);
    specular += mean3(model.light_specular, index * 3);
  }
  const headlight = model.vis.headlight;
  if (headlight.active) {
    diffuse += mean3(headlight.diffuse);
    specular += mean3(headlight.specular);
  }
  return diffuse > 0 ? specular / diffuse : 0;
}

/** Shared by every MuJoCo-shaded material; the camera preview sets it per scene. */
export const mujocoSpecularScale = { value: 0.3 / 0.7 };

const DIRECT_SPECULAR =
  /reflectedLight\.directSpecular \+= irradiance \* BRDF_BlinnPhong\( directLight\.direction, geometryViewDir, geometryNormal, material\.specularColor, material\.specularShininess \) \* material\.specularStrength;/;

const MUJOCO_SPECULAR = `if ( dotNL > 0.0 ) {
		vec3 mujocoHalf = normalize( directLight.direction + geometryViewDir );
		reflectedLight.directSpecular += directLight.color * RECIPROCAL_PI * mujocoSpecularScale
			* material.specularColor
			* pow( max( dot( geometryNormal, mujocoHalf ), 0.0 ), max( material.specularShininess, 1e-4 ) );
	}`;

/** Patches a Phong material's shader to MuJoCo's specular term (see the module comment). */
export function applyMujocoPhong(material: THREE.MeshPhongMaterial): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.mujocoSpecularScale = mujocoSpecularScale;
    const chunk = THREE.ShaderChunk.lights_phong_pars_fragment;
    if (!DIRECT_SPECULAR.test(chunk)) {
      console.warn('three.js Phong shader changed; MuJoCo specular shading is not applied.');
      return;
    }
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <lights_phong_pars_fragment>',
      `uniform float mujocoSpecularScale;\n${chunk.replace(DIRECT_SPECULAR, MUJOCO_SPECULAR)}`,
    );
  };
  material.customProgramCacheKey = () => 'mujoco-phong';
}

/** three.js Phong settings for a MuJoCo geom with this albedo color. */
export function mujocoPhongSettings(shading: MujocoGeomShading, color: THREE.Color) {
  return {
    specular: new THREE.Color(shading.specular, shading.specular, shading.specular),
    // MuJoCo maps shininess in [0, 1] to an OpenGL exponent in [0, 128].
    shininess: shading.shininess * 128,
    emissive: color.clone().multiplyScalar(shading.emission),
  };
}
