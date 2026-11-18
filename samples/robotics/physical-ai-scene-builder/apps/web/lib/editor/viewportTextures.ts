// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import * as THREE from 'three';

interface TextureEntry {
  ready: Promise<THREE.Texture>;
  state: { users: number; texture: THREE.Texture | null };
}

export class ViewportTextureRegistry {
  private readonly entries = new Map<string, TextureEntry>();

  /** Resolves once every texture requested so far has loaded or failed (camera captures). */
  async settled(): Promise<void> {
    await Promise.allSettled([...this.entries.values()].map((entry) => entry.ready));
  }

  constructor(
    private readonly loader: Pick<THREE.TextureLoader, 'load'> = new THREE.TextureLoader(),
  ) {}

  acquire(url: string): { ready: Promise<THREE.Texture>; release: () => void } {
    let entry = this.entries.get(url);
    if (!entry) {
      const state: TextureEntry['state'] = { users: 0, texture: null };
      const ready = new Promise<THREE.Texture>((resolve, reject) => {
        state.texture = this.loader.load(
          url,
          (texture) => {
            texture.colorSpace = THREE.SRGBColorSpace;
            texture.wrapS = THREE.RepeatWrapping;
            texture.wrapT = THREE.RepeatWrapping;
            texture.anisotropy = 8;
            texture.needsUpdate = true;
            resolve(texture);
          },
          undefined,
          reject,
        );
      });
      entry = { ready, state };
      this.entries.set(url, entry);
    }
    entry.state.users++;
    const retained = entry;
    let released = false;
    return {
      ready: retained.ready,
      release: () => {
        if (released) return;
        released = true;
        retained.state.users--;
        if (retained.state.users) return;
        retained.state.texture?.dispose();
        if (this.entries.get(url) === retained) this.entries.delete(url);
      },
    };
  }
}

export const viewportTextures = new ViewportTextureRegistry();
