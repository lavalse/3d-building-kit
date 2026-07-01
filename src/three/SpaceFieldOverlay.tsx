import { useMemo } from 'react';
import * as THREE from 'three';
import { Edges } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { GRID, WALL_HEIGHT } from '../kit/constants';

const FIELD_H = WALL_HEIGHT * 8; // "to the sky" — the fade makes the exact top invisible

/** A "barrier"/結界-style volume marking a column selection (move tool): ONE light box
 *  over the selection's bounding rectangle, rising from the ground (y=0) and fading toward
 *  the sky with a slow upward scan band — so it reads as a single framed RANGE (ground to
 *  sky), not a clutter of per-cell pillars. A crisp outline at the base defines the framed
 *  grid rectangle. Purely visual (non-pickable). */
export function SpaceFieldOverlay({ cols, color = '#49c5ff' }: { cols: string[]; color?: string }) {
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        uniforms: {
          uColor: { value: new THREE.Color(color) },
          uTime: { value: 0 },
          uHeight: { value: FIELD_H },
          uOpacity: { value: 0.28 },
        },
        vertexShader: /* glsl */ `
          uniform float uHeight;
          varying float vY;
          void main() {
            vY = position.y + uHeight * 0.5; // local [-H/2,H/2] → world [0,H]
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          uniform vec3 uColor;
          uniform float uTime;
          uniform float uHeight;
          uniform float uOpacity;
          varying float vY;
          void main() {
            float t = clamp(vY / uHeight, 0.0, 1.0);
            float fade = pow(1.0 - t, 1.6);                       // bright at the ground, gone at the sky
            float band = smoothstep(0.82, 1.0, sin(vY * 0.9 - uTime * 2.0) * 0.5 + 0.5);
            float a = uOpacity * fade + band * 0.22 * (1.0 - t);  // rising scan band
            gl_FragColor = vec4(uColor, a);
          }
        `,
      }),
    // color rarely changes; rebuild the material if it does
    [color]
  );

  useFrame((_, dt) => {
    mat.uniforms.uTime.value += dt;
  });

  // Bounding rectangle of the selected columns → one framed range (not per-cell).
  let ci0 = Infinity, cj0 = Infinity, ci1 = -Infinity, cj1 = -Infinity;
  for (const key of cols) {
    const [i, j] = key.split(',').map(Number);
    ci0 = Math.min(ci0, i); cj0 = Math.min(cj0, j); ci1 = Math.max(ci1, i); cj1 = Math.max(cj1, j);
  }
  if (!Number.isFinite(ci0)) return null;

  const w = GRID * (ci1 - ci0 + 1);
  const d = GRID * (cj1 - cj0 + 1);
  const cx = GRID * ci0 + w / 2;
  const cz = GRID * cj0 + d / 2;

  return (
    <group>
      {/* One barrier volume over the whole framed rectangle. */}
      <mesh position={[cx, FIELD_H / 2, cz]} material={mat} raycast={() => null}>
        <boxGeometry args={[w - 0.06, FIELD_H, d - 0.06]} />
      </mesh>
      {/* Crisp outline at the base → the framed grid rectangle. */}
      <mesh position={[cx, 0.06, cz]} raycast={() => null}>
        <boxGeometry args={[w, 0.12, d]} />
        <meshBasicMaterial color={color} transparent opacity={0.12} depthWrite={false} />
        <Edges threshold={15} color={color} />
      </mesh>
    </group>
  );
}
