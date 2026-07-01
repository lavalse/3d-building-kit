import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { GRID, WALL_HEIGHT } from '../kit/constants';

const FIELD_H = WALL_HEIGHT * 8; // "to the sky" — the fade makes the exact top invisible

/** A "barrier"/結界-style volume marking a column selection (move tool): each selected
 *  "i,j" column becomes a light pillar rising from the ground (y=0), fading out toward
 *  the sky, with a slow upward scan band — conveying "you selected a volume of space,
 *  ground to sky," not just the ground floor. Purely visual (non-pickable). */
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

  const group = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    mat.uniforms.uTime.value += dt;
  });

  return (
    <group ref={group}>
      {cols.map((key) => {
        const [i, j] = key.split(',').map(Number);
        const cx = GRID * i + GRID / 2;
        const cz = GRID * j + GRID / 2;
        return (
          <mesh key={key} position={[cx, FIELD_H / 2, cz]} material={mat} raycast={() => null}>
            <boxGeometry args={[GRID - 0.06, FIELD_H, GRID - 0.06]} />
          </mesh>
        );
      })}
    </group>
  );
}
