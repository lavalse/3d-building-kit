// Surface-aware draw-level picking for the space tool: point at a building's
// rooftop → draw the floor on top of it; point at empty ground → draw on the
// current level. Pure & deterministic (no three.js), so it's unit-testable.

import { toCell, GRID } from './constants';
import { occupied, type CellMap } from './massing';

type Vec3 = { x: number; y: number; z: number };

const GRAZE_EPS = 0.08; // near-parallel rays don't meaningfully hit a horizontal plane

/** Intersect a ray with the horizontal plane y = planeY → the cell (ci,cj) there,
 *  or null if the ray is too grazing / points away from it. */
function cellOnPlane(origin: Vec3, dir: Vec3, planeY: number): { ci: number; cj: number } | null {
  if (Math.abs(dir.y) < GRAZE_EPS) return null;
  const t = (planeY - origin.y) / dir.y;
  if (t <= 0) return null; // plane is behind the ray
  return { ci: toCell(origin.x + t * dir.x), cj: toCell(origin.z + t * dir.z) };
}

/** Resolve which level the space tool should draw on for this pointer ray.
 *  Scans building rooftops from the top down: the highest surface the ray crosses
 *  that is a rooftop (occupied just below, empty at that level) → that level (stack
 *  on top). Otherwise falls back to `activeLevel` (empty ground / manual). */
export function resolveDrawTarget(
  cells: CellMap,
  activeLevel: number,
  floorHeight: number,
  origin: Vec3,
  dir: Vec3
): { level: number; ci: number; cj: number } | null {
  let maxLvl = 0;
  for (const k in cells) {
    const lvl = Number(k.slice(0, k.indexOf(',')));
    if (lvl > maxLvl) maxLvl = lvl;
  }
  for (let lt = maxLvl + 1; lt >= 1; lt--) {
    const c = cellOnPlane(origin, dir, lt * floorHeight);
    if (!c) continue;
    if (occupied(cells, lt - 1, c.ci, c.cj) && !occupied(cells, lt, c.ci, c.cj)) {
      return { level: lt, ci: c.ci, cj: c.cj };
    }
  }
  const g = cellOnPlane(origin, dir, activeLevel * floorHeight);
  return g ? { level: activeLevel, ci: g.ci, cj: g.cj } : null;
}

/** Stair tool: given a hit on a walkable surface (`surfaceKey = "landLevel,cellLevel,ci,cj"`)
 *  and the world XZ of the hit, snap a landing to the NEAREST exterior edge of that cell —
 *  the empty outdoor neighbour (empty at `cellLevel`), placed at `landLevel`. Returns null
 *  if the cell has no exterior edge (interior → no stair in the middle of a surface). */
export function surfaceEdgeLanding(
  cells: CellMap,
  surfaceKey: string,
  hitX: number,
  hitZ: number
): { ci: number; cj: number; level: number } | null {
  const [landLevel, cellLevel, ci, cj] = surfaceKey.split(',').map(Number);
  // Fractional position within the cell (0..GRID from its min corner).
  const fx = hitX - GRID * ci;
  const fz = hitZ - GRID * cj;
  // Distance to each edge with its outward neighbour delta: W E S N.
  const edges: { dist: number; di: number; dj: number }[] = [
    { dist: fx, di: -1, dj: 0 },        // W
    { dist: GRID - fx, di: 1, dj: 0 },  // E
    { dist: fz, di: 0, dj: -1 },        // S
    { dist: GRID - fz, di: 0, dj: 1 },  // N
  ].sort((a, b) => a.dist - b.dist);
  for (const e of edges) {
    const ni = ci + e.di, nj = cj + e.dj;
    if (!occupied(cells, cellLevel, ni, nj)) return { ci: ni, cj: nj, level: landLevel };
  }
  return null; // fully interior cell → no edge
}
