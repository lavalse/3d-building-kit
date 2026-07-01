import { useRef, useState } from 'react';
import * as THREE from 'three';
import type { ThreeEvent } from '@react-three/fiber';
import { GRID, toCell } from '../kit/constants';
import type { CellMap } from '../kit/massing';
import { useBuildStore } from '../store/useBuildStore';
import { MovePreview, type MoveMode } from './MovePreview';

/** In-scene 3D move handle for the marquee column-selection. It floats above the
 *  centre of the selected columns; drag it to slide the selection across the grid
 *  (green/red ghost via MovePreview), release → moveBuilding. The selection follows
 *  to the new spot (moveBuilding shifts selectedCols), so the handle re-centres. */
export function MoveGizmo({
  cells,
  cols,
  floorHeight,
}: {
  cells: CellMap;
  cols: string[];
  floorHeight: number;
}) {
  const moveBuilding = useBuildStore((s) => s.moveBuilding);
  const moveOverwrite = useBuildStore((s) => s.moveOverwrite);
  const [drag, setDrag] = useState<{ ci: number; cj: number; di: number; dj: number } | null>(null);
  const dragRef = useRef<{ ci: number; cj: number; di: number; dj: number } | null>(null);
  const plane = useRef(new THREE.Plane()).current;
  const hit = useRef(new THREE.Vector3()).current;

  // Bounding box of the selected columns + the tallest occupied level among them.
  let ci0 = Infinity, cj0 = Infinity, ci1 = -Infinity, cj1 = -Infinity, maxLvl = 0;
  const set = new Set(cols);
  for (const k in cells) {
    const [lvl, i, j] = k.split(',').map(Number);
    if (!set.has(`${i},${j}`)) continue;
    ci0 = Math.min(ci0, i); cj0 = Math.min(cj0, j);
    ci1 = Math.max(ci1, i); cj1 = Math.max(cj1, j);
    if (lvl > maxLvl) maxLvl = lvl;
  }
  if (!Number.isFinite(ci0)) return null; // selection no longer occupies any cell

  const cx = (GRID * ci0 + GRID * (ci1 + 1)) / 2;
  const cz = (GRID * cj0 + GRID * (cj1 + 1)) / 2;
  const handleY = (maxLvl + 1) * floorHeight + 0.9; // floats above the roof

  // Pointer ray → grid cell on the horizontal plane at the handle's height.
  const rayCell = (e: ThreeEvent<PointerEvent>) => {
    plane.set(new THREE.Vector3(0, 1, 0), -handleY);
    if (!e.ray.intersectPlane(plane, hit)) return null;
    return { ci: toCell(hit.x), cj: toCell(hit.z) };
  };

  const onDown = (e: ThreeEvent<PointerEvent>) => {
    if (e.button !== 0) return;
    const c = rayCell(e);
    if (!c) return;
    e.stopPropagation();
    (e.target as Element)?.setPointerCapture?.(e.pointerId);
    const d = { ci: c.ci, cj: c.cj, di: 0, dj: 0 };
    dragRef.current = d;
    setDrag(d);
  };

  const onMove = (e: ThreeEvent<PointerEvent>) => {
    const cur = dragRef.current;
    if (!cur) return;
    const c = rayCell(e);
    if (!c) return;
    const di = c.ci - cur.ci;
    const dj = c.cj - cur.cj;
    if (di === cur.di && dj === cur.dj) return;
    e.stopPropagation();
    const d = { ...cur, di, dj };
    dragRef.current = d;
    setDrag(d);
  };

  const onUp = (e: ThreeEvent<PointerEvent>) => {
    const d = dragRef.current;
    if (!d) return;
    e.stopPropagation();
    (e.target as Element)?.releasePointerCapture?.(e.pointerId);
    if (d.di !== 0 || d.dj !== 0) moveBuilding(cols, d.di, d.dj);
    dragRef.current = null;
    setDrag(null);
  };

  // Preview mode: does the current drag land on a non-moving occupied cell?
  const mode: MoveMode = (() => {
    if (!drag || (drag.di === 0 && drag.dj === 0)) return 'ok';
    for (const k in cells) {
      const [lvl, i, j] = k.split(',').map(Number);
      if (!set.has(`${i},${j}`)) continue;
      const ti = i + drag.di, tj = j + drag.dj;
      if (cells[`${lvl},${ti},${tj}`] && !set.has(`${ti},${tj}`)) return moveOverwrite ? 'overwrite' : 'blocked';
    }
    return 'ok';
  })();

  const active = !!drag && (drag.di !== 0 || drag.dj !== 0);
  const knobColor = !active ? '#f2a33c' : mode === 'blocked' ? '#f6492f' : mode === 'overwrite' ? '#f2a33c' : '#22c55e';

  return (
    <>
      <group position={[cx, handleY, cz]}>
        {/* Grabbable knob */}
        <mesh onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp}>
          <octahedronGeometry args={[0.6, 0]} />
          <meshStandardMaterial
            color={knobColor}
            emissive={knobColor}
            emissiveIntensity={0.35}
            depthTest={false}
          />
        </mesh>
        {/* Stalk down toward the roof, for a clear "this belongs to the selection" cue */}
        <mesh position={[0, -0.55, 0]} raycast={() => null}>
          <cylinderGeometry args={[0.05, 0.05, 0.9, 8]} />
          <meshBasicMaterial color="#f2a33c" depthTest={false} transparent opacity={0.9} />
        </mesh>
      </group>

      {active && (
        <MovePreview cells={cells} cols={cols} di={drag!.di} dj={drag!.dj} floorHeight={floorHeight} mode={mode} />
      )}
    </>
  );
}
