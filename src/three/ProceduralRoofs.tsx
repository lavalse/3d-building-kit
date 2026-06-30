import { useEffect, useLayoutEffect, useMemo } from 'react';
import * as THREE from 'three';
import type { ThreeEvent } from '@react-three/fiber';
import { useBuildStore } from '../store/useBuildStore';
import { GRID, ROOF_RISE, ROOF_EAVE, ROOF_CORNICE, ROOF_COLOR, cellCenter } from '../kit/constants';
import type { RoofRegion } from '../kit/types';
import { roofGeometry } from './roofGeometry';

// Shared materials — drawn roofs read as the kit's dark slate; selected ones glow.
const MAT = new THREE.MeshStandardMaterial({ color: ROOF_COLOR, roughness: 0.92, metalness: 0, side: THREE.DoubleSide });
const SEL_MAT = new THREE.MeshStandardMaterial({ color: ROOF_COLOR, roughness: 0.92, metalness: 0, side: THREE.DoubleSide, emissive: '#2b6cff', emissiveIntensity: 0.55 });

/** All drawn (procedural) roofs. Rendered INSIDE the export group so GLTFExporter
 *  serializes them alongside the GLB pieces. */
export function ProceduralRoofs() {
  const roofs = useBuildStore((s) => s.roofs);
  const tool = useBuildStore((s) => s.tool);
  const floorHeight = useBuildStore((s) => s.floorHeight);
  const selectedRoofId = useBuildStore((s) => s.selectedRoofId);
  const selectRoof = useBuildStore((s) => s.selectRoof);
  // Drawn roofs follow the 'roof' category colour (so they recolour with the kit roof tiles).
  const roofColor = useBuildStore((s) => s.palette.roof) ?? ROOF_COLOR;
  useLayoutEffect(() => { MAT.color.set(roofColor); SEL_MAT.color.set(roofColor); }, [roofColor]);
  return (
    <>
      {roofs.map((r) => (
        <RoofMesh
          key={r.id}
          r={r}
          floorHeight={floorHeight}
          selectable={tool === 'select'}
          selected={selectedRoofId === r.id}
          onSelect={() => selectRoof(r.id)}
        />
      ))}
    </>
  );
}

function RoofMesh({
  r, floorHeight, selectable, selected, onSelect,
}: {
  r: RoofRegion;
  floorHeight: number;
  selectable: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  const ci0 = Math.min(r.ci0, r.ci1), ci1 = Math.max(r.ci0, r.ci1);
  const cj0 = Math.min(r.cj0, r.cj1), cj1 = Math.max(r.cj0, r.cj1);
  const w = GRID * (ci1 - ci0 + 1);
  const d = GRID * (cj1 - cj0 + 1);
  const cx = (cellCenter(ci0) + cellCenter(ci1)) / 2;
  const cz = (cellCenter(cj0) + cellCenter(cj1)) / 2;
  const y0 = (r.level + 1) * floorHeight; // wall-top of the roofed level

  // Oversail the walls slightly (eave) so the pitch overhangs the kit cornice; it sits ON
  // TOP of the kit's `border` eave (kept by deriveSkin), which stays as the visible cornice.
  const W = w + 2 * ROOF_EAVE;
  const D = d + 2 * ROOF_EAVE;
  const span = Math.min(w, d); // pitch follows the real footprint, not the overhang
  const rise = r.style === 'dome' ? span / 2 : (ROOF_RISE * span) / 2;

  const cap = useMemo(
    () => roofGeometry(r.style, W, D, rise, !!r.rotated),
    [r.style, W, D, rise, r.rotated]
  );
  useEffect(() => () => cap.dispose(), [cap]);

  const mat = selected ? SEL_MAT : MAT;
  const onClick = selectable
    ? (e: ThreeEvent<MouseEvent>) => { e.stopPropagation(); onSelect(); }
    : undefined;

  // Cap base sits at the top of the kit cornice (clear of the wall plane → no z-fight).
  return (
    <group position={[cx, y0 + ROOF_CORNICE, cz]} onClick={onClick}>
      <mesh geometry={cap} material={mat} castShadow receiveShadow />
    </group>
  );
}
