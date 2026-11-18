// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import * as THREE from 'three';

/**
 * MuJoCo spot lights (a light without `type` or `directional` compiles as one) scale brightness by
 * cos(angle off the axis)^exponent inside `cutoff` and are dark outside it, with no distance
 * falloff by default. three.js spot lights only fade across a penumbra at the cone edge, so off-axis
 * surfaces render several times brighter than native recordings.
 *
 * A negative `decay` is never valid for three.js lights, so it marks a spot light that should shade
 * the MuJoCo way: `decay = -exponent`, `angle = cutoff`. Every other light keeps three.js shading,
 * which leaves the main viewport (non-parity lights) unchanged.
 */
const ORIGINAL =
  /float spotAttenuation = getSpotAttenuation\( spotLight\.coneCos, spotLight\.penumbraCos, angleCos \);\s*if \( spotAttenuation > 0\.0 \) \{\s*float lightDistance = length\( lVector \);\s*light\.color = spotLight\.color \* spotAttenuation;\s*light\.color \*= getDistanceAttenuation\( lightDistance, spotLight\.distance, spotLight\.decay \);/;

const MUJOCO = `float spotAttenuation = spotLight.decay < 0.0
			? ( angleCos > spotLight.coneCos ? pow( max( angleCos, 0.0 ), - spotLight.decay ) : 0.0 )
			: getSpotAttenuation( spotLight.coneCos, spotLight.penumbraCos, angleCos );

		if ( spotAttenuation > 0.0 ) {

			float lightDistance = length( lVector );

			light.color = spotLight.color * spotAttenuation;
			if ( spotLight.decay >= 0.0 ) light.color *= getDistanceAttenuation( lightDistance, spotLight.distance, spotLight.decay );`;

let installed: boolean | null = null;

/** Patches three.js spot shading once; returns false (and leaves it alone) if three changed. */
export function installMujocoSpotLights(): boolean {
  if (installed !== null) return installed;
  const chunk = THREE.ShaderChunk.lights_pars_begin;
  if (chunk.includes('spotLight.decay < 0.0')) return (installed = true);
  if (!ORIGINAL.test(chunk)) {
    console.warn('three.js spot light shader changed; MuJoCo spot falloff is not applied.');
    return (installed = false);
  }
  THREE.ShaderChunk.lights_pars_begin = chunk.replace(ORIGINAL, MUJOCO);
  return (installed = true);
}

/** three.js SpotLight settings that shade like a MuJoCo spot with this cutoff and exponent. */
export function mujocoSpotSettings(cutoffDegrees: number, exponent: number) {
  const cutoff = Number.isFinite(cutoffDegrees) && cutoffDegrees > 0 ? cutoffDegrees : 45;
  return {
    angle: (Math.min(cutoff, 89.9) * Math.PI) / 180,
    penumbra: 0,
    // A zero exponent is a hard cone without distance falloff, which three.js already draws.
    decay: Number.isFinite(exponent) && exponent > 0 ? -exponent : 0,
  };
}
