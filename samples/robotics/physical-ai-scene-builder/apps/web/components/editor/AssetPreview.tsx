// Copyright (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

'use client';

import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';

import { Button } from '@mujoco-studio/ui';

export interface PreviewableAsset {
  id: number;
  name: string;
  filename: string | null;
  mimeType: string | null;
  url: string | null;
  canonicalMesh?:
    | number
    | {
        filename?: string | null;
        url?: string | null;
      }
    | null;
}

function sourceFor(asset: PreviewableAsset): string | null {
  if (
    asset.canonicalMesh &&
    typeof asset.canonicalMesh === 'object' &&
    asset.canonicalMesh.filename
  ) {
    return `/api/asset-artifacts/file/${encodeURIComponent(asset.canonicalMesh.filename)}`;
  }
  if (asset.filename) return `/api/assets/file/${encodeURIComponent(asset.filename)}`;
  return asset.url;
}

export function AssetPreview({ asset, onClose }: { asset: PreviewableAsset; onClose: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const source = sourceFor(asset);
  const previewFilename =
    asset.canonicalMesh && typeof asset.canonicalMesh === 'object'
      ? (asset.canonicalMesh.filename ?? asset.filename)
      : asset.filename;
  const isStl = previewFilename?.toLowerCase().endsWith('.stl');

  useEffect(() => {
    if (!source || !isStl) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    let frame = 0;
    let disposed = false;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    } catch {
      const failureFrame = requestAnimationFrame(() => {
        if (!disposed) setState('error');
      });
      return () => {
        disposed = true;
        cancelAnimationFrame(failureFrame);
      };
    }

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, 1, 0.01, 10_000);
    const controls = new OrbitControls(camera, canvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enablePan = false;
    controls.target.set(0, 0, 0);

    scene.add(new THREE.HemisphereLight('#dce7f2', '#202a35', 2.2));
    const keyLight = new THREE.DirectionalLight('#ffffff', 2.6);
    keyLight.position.set(3, 5, 4);
    scene.add(keyLight);
    const grid = new THREE.GridHelper(10, 10, '#344455', '#202b36');
    grid.position.y = -0.001;
    scene.add(grid);

    const resize = () => {
      const { width, height } = canvas.getBoundingClientRect();
      if (!width || !height) return;
      renderer.setSize(width, height, false);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();

    const render = () => {
      controls.update();
      renderer.render(scene, camera);
      frame = requestAnimationFrame(render);
    };

    const loader = new STLLoader();
    loader.load(
      source,
      (geometry) => {
        if (disposed) {
          geometry.dispose();
          return;
        }
        geometry.computeVertexNormals();
        geometry.computeBoundingBox();
        geometry.computeBoundingSphere();
        const bounds = geometry.boundingBox;
        const sphere = geometry.boundingSphere;
        if (!bounds || !sphere || sphere.radius <= 0) {
          geometry.dispose();
          setState('error');
          return;
        }

        geometry.translate(
          -bounds.getCenter(new THREE.Vector3()).x,
          -bounds.min.y,
          -bounds.getCenter(new THREE.Vector3()).z,
        );
        const material = new THREE.MeshStandardMaterial({
          color: '#9eb4c8',
          roughness: 0.62,
          metalness: 0.08,
        });
        const mesh = new THREE.Mesh(geometry, material);
        scene.add(mesh);
        const distance = Math.max(sphere.radius * 2.8, 0.2);
        camera.position.set(distance, distance * 0.8, distance);
        controls.update();
        grid.scale.setScalar(Math.max(sphere.radius * 4, 0.2));
        setState('ready');
        render();
      },
      undefined,
      () => setState('error'),
    );

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      controls.dispose();
      scene.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        object.geometry.dispose();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) material.dispose();
      });
      renderer.dispose();
    };
  }, [isStl, source]);

  const message =
    !source || !isStl
      ? 'Preview is available for STL objects.'
      : state === 'error'
        ? '3D preview is unavailable in this browser.'
        : null;

  return (
    <section className="absolute left-3 top-3 z-20 flex h-64 w-80 max-w-[calc(100%-1.5rem)] flex-col border border-border bg-surface shadow-2xl">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="min-w-0 px-3 pt-2">
          <span className="block truncate text-xs font-medium text-foreground">{asset.name}</span>
          <span className="text-[10px] uppercase tracking-[0.12em] text-muted">Asset preview</span>
        </div>
        <Button
          size="icon"
          variant="ghost"
          className="mr-2 mt-1 shrink-0"
          onClick={onClose}
          title="Close asset preview"
        >
          <X />
        </Button>
      </div>
      <div className="relative min-h-0 flex-1 overflow-hidden border-t border-border bg-[#111821]">
        <canvas
          ref={canvasRef}
          className="size-full touch-none"
          aria-label={`${asset.name} 3D preview`}
        />
        {state === 'loading' && (
          <div className="absolute inset-0 flex items-center justify-center text-[11px] text-muted">
            Loading preview…
          </div>
        )}
        {message && (
          <div className="absolute inset-0 flex items-center justify-center px-5 text-center text-[11px] leading-4 text-muted">
            {message}
          </div>
        )}
      </div>
    </section>
  );
}
