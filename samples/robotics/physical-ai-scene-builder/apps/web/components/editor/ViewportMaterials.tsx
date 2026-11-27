// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client';

import { GeomType } from '@mujoco-studio/types';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';

import type { BoxFace } from '@/lib/editor/document';
import {
  applyMujocoPhong,
  mujocoPhongSettings,
  type MujocoGeomShading,
} from '@/lib/editor/mujocoShading';
import { viewportTextures } from '@/lib/editor/viewportTextures';

const BOX_FACE_GROUPS: readonly BoxFace[] = ['right', 'left', 'top', 'bottom', 'front', 'back'];

/** A Phong material shaded like MuJoCo's renderer (camera preview; see mujocoShading.ts). */
function MujocoPhongMaterial({
  attach,
  color,
  shading,
  map = null,
  opacity,
  side,
}: {
  attach?: string;
  color: THREE.Color;
  shading: MujocoGeomShading;
  map?: THREE.Texture | null;
  opacity: number;
  side: THREE.Side;
}) {
  const settings = mujocoPhongSettings(shading, color);
  return (
    <meshPhongMaterial
      ref={(material) => {
        if (material && !material.userData.mujocoPhong) {
          material.userData.mujocoPhong = true;
          applyMujocoPhong(material);
          material.needsUpdate = true;
        }
      }}
      attach={attach}
      color={color}
      map={map}
      specular={settings.specular}
      shininess={settings.shininess}
      emissive={settings.emissive}
      transparent={opacity < 1}
      opacity={opacity}
      side={side}
    />
  );
}

export function TexturedGeomMaterial({
  attach,
  color,
  emissive,
  opacity,
  side,
  textureUrl,
  rawTexture = false,
  mujoco,
}: {
  attach?: string;
  color: THREE.Color;
  emissive: THREE.Color;
  opacity: number;
  side: THREE.Side;
  textureUrl: string;
  /** Use texel values as stored, like MuJoCo, instead of decoding them as sRGB. */
  rawTexture?: boolean;
  /** Shade like MuJoCo's renderer with these material values (camera preview). */
  mujoco?: MujocoGeomShading;
}) {
  const [loaded, setLoaded] = useState<{ url: string; texture: THREE.Texture } | null>(null);
  const sharedTexture = loaded && loaded.url === textureUrl ? loaded.texture : null;
  // The shared texture is decoded as sRGB for the viewport; a raw view needs its own copy.
  const rawCopy = useMemo(() => {
    if (!rawTexture || !sharedTexture) return null;
    const copy = sharedTexture.clone();
    copy.colorSpace = THREE.NoColorSpace;
    copy.needsUpdate = true;
    return copy;
  }, [rawTexture, sharedTexture]);
  useEffect(() => () => rawCopy?.dispose(), [rawCopy]);
  const texture = rawCopy ?? sharedTexture;
  const materialRef = useRef<THREE.MeshStandardMaterial>(null);

  useEffect(() => {
    let disposed = false;
    const lease = viewportTextures.acquire(textureUrl);
    lease.ready.then(
      (nextTexture) => {
        if (!disposed) setLoaded({ url: textureUrl, texture: nextTexture });
      },
      (error: unknown) => {
        console.error(`Could not load scene texture "${textureUrl}".`, error);
        if (!disposed) setLoaded(null);
      },
    );
    return () => {
      disposed = true;
      lease.release();
    };
  }, [textureUrl]);

  useEffect(() => {
    if (texture && materialRef.current) materialRef.current.needsUpdate = true;
  }, [texture]);

  if (mujoco) {
    return (
      <MujocoPhongMaterial
        key={texture ? 'textured' : 'plain'}
        attach={attach}
        color={color}
        shading={mujoco}
        map={texture}
        opacity={opacity}
        side={side}
      />
    );
  }

  return (
    <meshStandardMaterial
      ref={materialRef}
      attach={attach}
      color={color}
      emissive={emissive}
      emissiveIntensity={0.08}
      map={texture}
      transparent={opacity < 1}
      opacity={opacity}
      roughness={0.62}
      metalness={0.08}
      side={side}
    />
  );
}

export function GeomMaterials({
  color,
  emissive,
  opacity,
  side,
  geomType,
  textureUrl,
  textureFace,
  rawTexture = false,
  mujoco,
}: {
  color: THREE.Color;
  emissive: THREE.Color;
  opacity: number;
  side: THREE.Side;
  geomType: GeomType;
  textureUrl: string | null;
  textureFace: BoxFace | null;
  /** See TexturedGeomMaterial: MuJoCo-parity camera views use stored texel values. */
  rawTexture?: boolean;
  /** See TexturedGeomMaterial: MuJoCo-parity camera views shade like MuJoCo. */
  mujoco?: MujocoGeomShading;
}) {
  const standardMaterial = (key: string, attach?: string) =>
    mujoco ? (
      <MujocoPhongMaterial
        key={key}
        attach={attach}
        color={color}
        shading={mujoco}
        opacity={opacity}
        side={side}
      />
    ) : (
      <meshStandardMaterial
        key={key}
        attach={attach}
        color={color}
        emissive={emissive}
        transparent={opacity < 1}
        opacity={opacity}
        roughness={0.62}
        metalness={0.08}
        side={side}
      />
    );

  if (geomType === GeomType.Box && textureUrl && textureFace) {
    return (
      <>
        {BOX_FACE_GROUPS.map((face, groupIndex) =>
          textureUrl && (!textureFace || face === textureFace) ? (
            <TexturedGeomMaterial
              key={face}
              attach={`material-${groupIndex}`}
              color={new THREE.Color(1, 1, 1)}
              emissive={emissive}
              opacity={opacity}
              side={side}
              textureUrl={textureUrl}
              rawTexture={rawTexture}
              mujoco={mujoco}
            />
          ) : (
            standardMaterial(face, `material-${groupIndex}`)
          ),
        )}
      </>
    );
  }

  return textureUrl ? (
    <TexturedGeomMaterial
      color={new THREE.Color(1, 1, 1)}
      emissive={emissive}
      opacity={opacity}
      side={side}
      textureUrl={textureUrl}
      rawTexture={rawTexture}
      mujoco={mujoco}
    />
  ) : (
    standardMaterial('standard')
  );
}
