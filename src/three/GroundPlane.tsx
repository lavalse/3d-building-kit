import { useRef, useState } from 'react';
import * as THREE from 'three';
import type { ThreeEvent } from '@react-three/fiber';
import { useBuildStore } from '../store/useBuildStore';
import { toCell, MAX_SPAN } from '../kit/constants';
import { CellPreview } from './CellPreview';

type Drag = { ai: number; aj: number; bi: number; bj: number };

const GRAZE_EPS = 0.08; // skip when the view ray is nearly parallel to the ground

/** Invisible plane at the active level. Left-drag a rectangle to draw/erase a space;
 *  in the stair tool, left-click an empty outdoor cell to drop a landing PLATFORM
 *  (the stair auto-descends below it). Right-drag orbits (configured in Scene).
 *
 *  Cells come from intersecting the pointer ray with a *math* plane (not a giant
 *  mesh), skipping grazing rays and clamping the span, so the rect can never explode
 *  near the horizon. State updates only when the cell actually changes. */
export function GroundPlane() {
  const tool = useBuildStore((s) => s.tool);
  const activeLevel = useBuildStore((s) => s.activeLevel);
  const floorHeight = useBuildStore((s) => s.floorHeight);
  const fillSpace = useBuildStore((s) => s.fillSpace);
  const eraseCells = useBuildStore((s) => s.eraseCells);
  const addPlatform = useBuildStore((s) => s.addPlatform);
  const clearSelection = useBuildStore((s) => s.clearSelection);

  const y = activeLevel * floorHeight;
  const [drag, setDrag] = useState<Drag | null>(null);
  const [hover, setHover] = useState<{ ci: number; cj: number } | null>(null);
  const dragRef = useRef<Drag | null>(null); // mirror for handlers (no stale closure)
  const plane = useRef(new THREE.Plane()).current;
  const hit = useRef(new THREE.Vector3()).current;
  const rect = tool === 'space' || tool === 'erase'; // rectangle (drag) tools
  const drawing = rect || tool === 'stair';

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
    if (e.button !== 0 || !drawing) return;
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
    if (cur && rect) {
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
    else if (tool === 'erase') eraseCells(d.ai, d.aj, d.bi, d.bj);
    else addPlatform(d.ai, d.aj); // stair tool: drop a landing platform at the clicked cell
    dragRef.current = null;
    setDrag(null);
  };

  // Cell to preview right now (drag start for rect tools, else the hovered cell).
  const cell = drag ? { ci: drag.ai, cj: drag.aj } : hover;

  return (
    <>
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, y, 0]}
        onClick={() => { if (tool === 'select') clearSelection(); }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={finish}
        onPointerLeave={() => setHover(null)}
      >
        <planeGeometry args={[4000, 4000]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>

      {/* Space/erase: the dragged (or hovered) rectangle volume. */}
      {rect && (drag || hover) && (
        <CellPreview
          ai={drag ? drag.ai : hover!.ci}
          aj={drag ? drag.aj : hover!.cj}
          bi={drag ? drag.bi : hover!.ci}
          bj={drag ? drag.bj : hover!.cj}
          y={y}
          height={floorHeight}
          mode={tool === 'erase' ? 'erase' : 'space'}
        />
      )}

      {/* Stair tool: a flat platform-tile preview at the cell under the cursor. */}
      {tool === 'stair' && cell && (
        <CellPreview ai={cell.ci} aj={cell.cj} bi={cell.ci} bj={cell.cj} y={y} height={0.12} mode="space" />
      )}
    </>
  );
}
