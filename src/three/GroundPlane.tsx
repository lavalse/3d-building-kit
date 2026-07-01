import { useRef, useState } from 'react';
import * as THREE from 'three';
import type { ThreeEvent } from '@react-three/fiber';
import { useBuildStore } from '../store/useBuildStore';
import { toCell, MAX_SPAN } from '../kit/constants';
import { footprintAt } from '../kit/massing';
import { CellPreview } from './CellPreview';
import { MovePreview, type MoveMode } from './MovePreview';
import { SpaceFieldOverlay } from './SpaceFieldOverlay';

type Drag = { ai: number; aj: number; bi: number; bj: number };
type Move = { cols: string[]; ci: number; cj: number; di: number; dj: number };

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
  const cells = useBuildStore((s) => s.cells);
  const activeLevel = useBuildStore((s) => s.activeLevel);
  const floorHeight = useBuildStore((s) => s.floorHeight);
  const fillSpace = useBuildStore((s) => s.fillSpace);
  const eraseCells = useBuildStore((s) => s.eraseCells);
  const addPlatform = useBuildStore((s) => s.addPlatform);
  const addRoof = useBuildStore((s) => s.addRoof);
  const moveBuilding = useBuildStore((s) => s.moveBuilding);
  const moveOverwrite = useBuildStore((s) => s.moveOverwrite);
  const selectCols = useBuildStore((s) => s.selectCols);
  const clearSelection = useBuildStore((s) => s.clearSelection);

  const y = activeLevel * floorHeight;
  const [drag, setDrag] = useState<Drag | null>(null);
  const [hover, setHover] = useState<{ ci: number; cj: number } | null>(null);
  const [move, setMove] = useState<Move | null>(null);
  const [marquee, setMarquee] = useState<Drag | null>(null); // move tool: rect selecting columns
  const dragRef = useRef<Drag | null>(null); // mirror for handlers (no stale closure)
  const moveRef = useRef<Move | null>(null);
  const marqueeRef = useRef<Drag | null>(null);
  const plane = useRef(new THREE.Plane()).current;
  const hit = useRef(new THREE.Vector3()).current;
  const rect = tool === 'space' || tool === 'erase' || tool === 'roof'; // rectangle (drag) tools
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

  // Is column (ci,cj) occupied on ANY level? (a building column, for the move tool)
  const occupiedCol = (ci: number, cj: number) => {
    for (const k in cells) {
      const [, i, j] = k.split(',').map(Number);
      if (i === ci && j === cj) return true;
    }
    return false;
  };

  const onDown = (e: ThreeEvent<PointerEvent>) => {
    if (e.button !== 0) return;
    const c = rayCell(e);
    if (!c) return;
    // Move tool: press on a building = drag the whole connected footprint (fast path);
    // press on empty ground = start a rectangle marquee to select a subset of columns.
    if (tool === 'move') {
      e.stopPropagation();
      (e.target as Element)?.setPointerCapture?.(e.pointerId);
      if (occupiedCol(c.ci, c.cj)) {
        const cols = footprintAt(cells, c.ci, c.cj);
        const m: Move = { cols: [...cols], ci: c.ci, cj: c.cj, di: 0, dj: 0 };
        moveRef.current = m;
        setMove(m);
      } else {
        const d = { ai: c.ci, aj: c.cj, bi: c.ci, bj: c.cj };
        marqueeRef.current = d;
        setMarquee(d);
      }
      return;
    }
    if (!drawing) return;
    e.stopPropagation();
    (e.target as Element)?.setPointerCapture?.(e.pointerId);
    const d = { ai: c.ci, aj: c.cj, bi: c.ci, bj: c.cj };
    dragRef.current = d;
    setDrag(d);
  };

  const onMove = (e: ThreeEvent<PointerEvent>) => {
    const mv = moveRef.current;
    if (mv && tool === 'move') {
      const c = rayCell(e);
      if (!c) return;
      const di = c.ci - mv.ci;
      const dj = c.cj - mv.cj;
      if (di === mv.di && dj === mv.dj) return;
      e.stopPropagation();
      const m = { ...mv, di, dj };
      moveRef.current = m;
      setMove(m);
      return;
    }
    const mq = marqueeRef.current;
    if (mq && tool === 'move') {
      const c = rayCell(e);
      if (!c) return;
      const bi = clampSpan(mq.ai, c.ci);
      const bj = clampSpan(mq.aj, c.cj);
      if (bi === mq.bi && bj === mq.bj) return;
      e.stopPropagation();
      const d = { ...mq, bi, bj };
      marqueeRef.current = d;
      setMarquee(d);
      return;
    }
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
    const mv = moveRef.current;
    if (mv) {
      e.stopPropagation();
      (e.target as Element)?.releasePointerCapture?.(e.pointerId);
      if (mv.di !== 0 || mv.dj !== 0) moveBuilding(mv.cols, mv.di, mv.dj);
      moveRef.current = null;
      setMove(null);
      return;
    }
    const mq = marqueeRef.current;
    if (mq) {
      e.stopPropagation();
      (e.target as Element)?.releasePointerCapture?.(e.pointerId);
      // Select every occupied column (on any level) inside the rect. Empty rect → clear.
      const ci0 = Math.min(mq.ai, mq.bi), ci1 = Math.max(mq.ai, mq.bi);
      const cj0 = Math.min(mq.aj, mq.bj), cj1 = Math.max(mq.aj, mq.bj);
      const cols = new Set<string>();
      for (const k in cells) {
        const [, i, j] = k.split(',').map(Number);
        if (i >= ci0 && i <= ci1 && j >= cj0 && j <= cj1) cols.add(`${i},${j}`);
      }
      selectCols([...cols]);
      marqueeRef.current = null;
      setMarquee(null);
      return;
    }
    const d = dragRef.current;
    if (!d) return;
    e.stopPropagation();
    (e.target as Element)?.releasePointerCapture?.(e.pointerId);
    if (tool === 'space') fillSpace(d.ai, d.aj, d.bi, d.bj);
    else if (tool === 'erase') eraseCells(d.ai, d.aj, d.bi, d.bj);
    else if (tool === 'roof') addRoof(d.ai, d.aj, d.bi, d.bj); // draw a roof over the rooftop rect
    else addPlatform(d.ai, d.aj); // stair tool: drop a landing platform at the clicked cell
    dragRef.current = null;
    setDrag(null);
  };

  // Cell to preview right now (drag start for rect tools, else the hovered cell).
  const cell = drag ? { ci: drag.ai, cj: drag.aj } : hover;

  // All "i,j" columns inside the current marquee rect (the volume being boxed).
  const marqueeCols: string[] = (() => {
    if (!marquee) return [];
    const ci0 = Math.min(marquee.ai, marquee.bi), ci1 = Math.max(marquee.ai, marquee.bi);
    const cj0 = Math.min(marquee.aj, marquee.bj), cj1 = Math.max(marquee.aj, marquee.bj);
    const out: string[] = [];
    for (let i = ci0; i <= ci1; i++) for (let j = cj0; j <= cj1; j++) out.push(`${i},${j}`);
    return out;
  })();

  // Does the current move drop overlap a non-moving building? → mode for the ghost.
  const moveMode: MoveMode = (() => {
    if (!move || (move.di === 0 && move.dj === 0)) return 'ok';
    const colSet = new Set(move.cols);
    for (const k in cells) {
      const [lvl, i, j] = k.split(',').map(Number);
      if (!colSet.has(`${i},${j}`)) continue;
      const ti = i + move.di, tj = j + move.dj;
      if (cells[`${lvl},${ti},${tj}`] && !colSet.has(`${ti},${tj}`)) return moveOverwrite ? 'overwrite' : 'blocked';
    }
    return 'ok';
  })();

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

      {/* Move tool: ghost of the picked building at its shifted position. */}
      {tool === 'move' && move && (
        <MovePreview
          cells={cells}
          cols={move.cols}
          di={move.di}
          dj={move.dj}
          floorHeight={floorHeight}
          mode={moveMode}
        />
      )}

      {/* Move tool: barrier field over the whole rect while marquee-selecting a volume. */}
      {tool === 'move' && marquee && <SpaceFieldOverlay cols={marqueeCols} />}
    </>
  );
}
