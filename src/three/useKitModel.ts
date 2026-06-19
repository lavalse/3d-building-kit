import { useMemo } from 'react';
import { useGLTF } from '@react-three/drei';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import * as THREE from 'three';

/**
 * Loads a kit GLB once (cached by useGLTF) and returns a fresh clone so each
 * placed instance gets its own transform while sharing cached geometry.
 * When `ghost` is true, materials are cloned and made translucent so the
 * preview piece doesn't tint the real placed pieces.
 */
export function useKitModel(url: string, ghost = false): THREE.Object3D {
  const { scene } = useGLTF(url);
  return useMemo(() => {
    const root = cloneSkeleton(scene) as THREE.Object3D;
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      if (ghost) {
        const makeGhost = (m: THREE.Material) => {
          const c = m.clone();
          c.transparent = true;
          c.opacity = 0.55;
          c.depthWrite = false;
          return c;
        };
        mesh.material = Array.isArray(mesh.material)
          ? mesh.material.map(makeGhost)
          : makeGhost(mesh.material);
      }
    });
    return root;
  }, [scene, ghost]);
}
