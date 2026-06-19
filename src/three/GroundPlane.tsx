import { useRef, useState } from 'react';
import * as THREE from 'three';
import type { ThreeEvent } from '@react-three/fiber';
import { useBuildStore } from '../store/useBuildStore';
import { toCell, MAX_SPAN } from '../kit/constants';
import { CellPreview } from './CellPreview';

type Drag = { ai: number; aj: number; bi: number; bj: number };

const GRAZE_EPS = 0.08; // skip when the view ray is nearly parallel to the ground

/** Invisible plane at the active level. Left-drag a rectangle of cells to draw
 *  a space (or erase it). Right-drag orbits (configured in Scene).
 *
 *  Cells are computed by intersecting the pointer ray with a *math* plane (not a
 *  giant mesh), skipping grazing rays and clamping the span, so the rectangle can
 *  never explode/flicker near the horizon. State updates only when the cell
 *  actually changes. */
export function GroundPlane() {
  const tool = useBuildStore((s) => s.tool);
  const activeLevel = useBuildStore((s) => s.activeLevel);
  const floorHeight = useBuildStore((s) => s.floorHeight);
  const fillSpace = useBuildStore((s) => s.fillSpace);
  const eraseCells = useBuildStore((s) => s.eraseCells);

  const y = activeLevel * floorHeight;
  const [drag, setDrag] = useState<Drag | null>(null);
  const [hover, setHover] = useState<{ ci: number; cj: number } | null>(null);
  const dragRef = useRef<Drag | null>(null); // mirror for handlers (no stale closure)
  const plane = useRef(new THREE.Plane()).current;
  const hit = useRef(new THREE.Vector3()).current;
  const drawing = tool === 'space' || tool === 'erase';

  // Resolve the pointer ray to a cell on the active-level plane, or null.
  const rayCell = (e: ThreeEvent<PointerEvent>): { ci: number; cj: number } | null => {
    const ray = e.ray;
    if (Math.abs(ray.direction.y) < GRAZE_EPS) return null; // too grazing → ignore
    plane.set(new THREE.Vector3(0, 1, 0), -y);
    if (!ray.intersectPlane(plane, hit)) return null;
    return { ci: toCell(hit.x), cj: toCell(hit.z) };
  };

  const clampSpan = (a: number, b: number) =>
    Math.max(a - MAX_SPAN, Math.min(a + MAX_SPAN, b));

  const onDown = (e: ThreeEvent<PointerEvent>) => {
    if (e.button !== 0 || (tool !== 'space' && tool !== 'erase')) return; // only draw tools use the ground
    const c = rayCell(e);
    if (!c) return;
    e.stopPropagation();
    (e.target as Element)?.setPointerCapture?.(e.pointerId);
    const d = { ai: c.ci, aj: c.cj, bi: c.ci, bj: c.cj };
    dragRef.current = d;
    setDrag(d);
  };

  const onMove = (e: ThreeEvent<PointerEvent>) => {
    const cur = dragRef.current;
    if (cur) {
      const c = rayCell(e);
      if (!c) return; // grazing / miss → keep last valid rect
      const bi = clampSpan(cur.ai, c.ci);
      const bj = clampSpan(cur.aj, c.cj);
      if (bi === cur.bi && bj === cur.bj) return; // only update when the cell changes
      e.stopPropagation();
      const d = { ...cur, bi, bj };
      dragRef.current = d;
      setDrag(d);
      return;
    }
    // Not dragging: live hover-cell preview while a draw tool is active.
    if (!drawing) return;
    const c = rayCell(e);
    if (!c) return;
    if (!hover || hover.ci !== c.ci || hover.cj !== c.cj) setHover(c);
  };

  const finish = (e: ThreeEvent<PointerEvent>) => {
    const d = dragRef.current;
    if (!d) return;
    e.stopPropagation();
    (e.target as Element)?.releasePointerCapture?.(e.pointerId);
    if (tool === 'space') fillSpace(d.ai, d.aj, d.bi, d.bj);
    else eraseCells(d.ai, d.aj, d.bi, d.bj);
    dragRef.current = null;
    setDrag(null);
  };

  return (
    <>
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, y, 0]}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={finish}
        onPointerLeave={() => setHover(null)}
      >
        <planeGeometry args={[4000, 4000]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      {drawing && drag && (
        <CellPreview
          ai={drag.ai}
          aj={drag.aj}
          bi={drag.bi}
          bj={drag.bj}
          y={y}
          height={floorHeight}
          mode={tool === 'erase' ? 'erase' : 'space'}
        />
      )}
      {drawing && !drag && hover && (
        <CellPreview
          ai={hover.ci}
          aj={hover.cj}
          bi={hover.ci}
          bj={hover.cj}
          y={y}
          height={floorHeight}
          mode={tool === 'erase' ? 'erase' : 'space'}
        />
      )}
    </>
  );
}
