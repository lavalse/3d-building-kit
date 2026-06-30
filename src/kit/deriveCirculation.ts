// Circulation layer (vertical): turn the plan + its openings into stairs.
//
// PHILOSOPHY: circulation is DERIVED, not hand-planned. Wherever a building has a
// floor above, the system auto-places a vertical stair CORE — anchored at a door
// (the door thus gains meaning), climbing inward, the same plan position stacked
// on every level (a real "交通核"). It is deterministic in a `seed` so the user
// can "re-roll" to another valid core, and layered with overrides:
//   manual[]     — user-drawn stairs, always kept (locked)
//   suppressed[] — auto cores the user deleted, by stable id
// Same inputs → same output (mirrors the auto window/door + faceOverrides model).

import { occupied, type CellMap } from './massing';
import type { Dir, Stair } from './types';

export interface Circulation {
  auto: boolean;
  seed: number;
  manual: Stair[];
  suppressed: string[];
  platforms: string[]; // "level,ci,cj" outdoor landing platforms the user drew (stair auto-descends below)
  platformModel: Record<string, string>; // platform key → stair pieceId override (default stairs-open)
  platformDir: Record<string, Dir>; // platform key → forced descent direction (straight-descent only)
}

const STEP: Record<Dir, [number, number]> = { N: [0, 1], S: [0, -1], E: [1, 0], W: [-1, 0] };
// Numeric face dir (deriveSkin: W=0,E=1,S=2,N=3) → letter; inward = opposite normal.
const FACE_LETTER: Record<number, Dir> = { 0: 'W', 1: 'E', 2: 'S', 3: 'N' };
const OPP: Record<Dir, Dir> = { N: 'S', S: 'N', E: 'W', W: 'E' };
const DIR_ORDER: Dir[] = ['N', 'E', 'S', 'W'];

const stairKeyOf = (level: number, ci: number, cj: number, dir: Dir) => `${level},${ci},${cj},${dir}`;
export const autoStairId = (level: number, ci: number, cj: number, dir: Dir) =>
  `auto:${stairKeyOf(level, ci, cj, dir)}`;
/** Stable id shared by the descending flights below one drawn platform. */
export const platformStairId = (platformKey: string) => `platform:${platformKey}`;

/** Level bounds present in the cell map. */
function levelRange(cells: CellMap): [number, number] {
  let lo = Infinity, hi = -Infinity;
  for (const k in cells) {
    const lvl = Number(k.slice(0, k.indexOf(',')));
    if (lvl < lo) lo = lvl;
    if (lvl > hi) hi = lvl;
  }
  return lo === Infinity ? [0, 0] : [lo, hi];
}

/** Connected components of the footprint (any (i,j) occupied at any level), 4-neighbour. */
function footprintComponents(cells: CellMap): Map<string, number> {
  const foot = new Set<string>();
  for (const k in cells) {
    const [, i, j] = k.split(',').map(Number);
    foot.add(`${i},${j}`);
  }
  const comp = new Map<string, number>();
  let id = 0;
  for (const start of foot) {
    if (comp.has(start)) continue;
    const queue = [start];
    comp.set(start, id);
    while (queue.length) {
      const cur = queue.pop()!;
      const [ci, cj] = cur.split(',').map(Number);
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nb = `${ci + di},${cj + dj}`;
        if (foot.has(nb) && !comp.has(nb)) {
          comp.set(nb, id);
          queue.push(nb);
        }
      }
    }
    id++;
  }
  return comp;
}

type Candidate = { ci: number; cj: number; dir: Dir; comp: number; stairs: Stair[]; door: boolean };

/** Build a vertical core at (ci,cj) climbing `dir`: a flight on every level L in
 *  [lo, hi-1] where both run cells exist on L and L+1. Empty if it supports none. */
function coreAt(cells: CellMap, ci: number, cj: number, dir: Dir, lo: number, hi: number): Stair[] {
  const [di, dj] = STEP[dir];
  const stairs: Stair[] = [];
  for (let L = lo; L < hi; L++) {
    const validBottom = occupied(cells, L, ci, cj) && occupied(cells, L, ci + di, cj + dj);
    const validLanding = occupied(cells, L + 1, ci, cj) && occupied(cells, L + 1, ci + di, cj + dj);
    if (validBottom && validLanding) {
      stairs.push({ id: autoStairId(L, ci, cj, dir), level: L, ci, cj, dir });
    }
  }
  return stairs;
}

const sortCandidates = (a: Candidate, b: Candidate) =>
  a.ci - b.ci || a.cj - b.cj || DIR_ORDER.indexOf(a.dir) - DIR_ORDER.indexOf(b.dir);

/** Openings that drive the interior auto-core (computed by deriveSkin). */
export interface Openings {
  groundDoors: string[]; // ground-level door faceKeys → interior core anchors
}

/** Resolve interior circulation: manual stairs (always) + one auto interior core
 *  per building (seed-chosen). Exterior towers are handled separately by
 *  expandAttachment (face-attached, not auto). */
export function deriveCirculation(cells: CellMap, openings: Openings, circ: Circulation): Stair[] {
  const manualKeys = new Set(circ.manual.map((s) => stairKeyOf(s.level, s.ci, s.cj, s.dir)));
  const out: Stair[] = [...circ.manual];
  if (!circ.auto) return out;

  const [lo, hi] = levelRange(cells);
  if (hi <= lo) return out; // single level → no vertical circulation
  const comp = footprintComponents(cells);
  const compOf = (i: number, j: number) => comp.get(`${i},${j}`) ?? -1;
  const suppressed = new Set(circ.suppressed);
  const emitted = new Set<string>();

  const tryEmit = (st: Stair) => {
    const pos = stairKeyOf(st.level, st.ci, st.cj, st.dir);
    if (emitted.has(pos)) return;
    emitted.add(pos);
    if (suppressed.has(st.id)) return;
    if (manualKeys.has(pos)) return; // manual wins
    out.push(st);
  };

  // One interior core per building, chosen by seed: ground-door anchored (default,
  // ranked first) + interior perimeter cells (re-roll variety).
  const doorCands: Candidate[] = [];
  for (const f of openings.groundDoors) {
    const [, i, j, d] = f.split(',').map(Number);
    const dir = OPP[FACE_LETTER[d]]; // climb inward, away from the door
    const [di, dj] = STEP[dir];
    // Foot one cell IN from the door, so you step through the door onto a flat
    // approach cell (the door cell) before the stairs start — the stairs-open
    // model has no built-in landing, so without this the first step jams the door.
    let fi = i + di, fj = j + dj;
    let stairs = coreAt(cells, fi, fj, dir, lo, hi);
    if (!stairs.length) {
      // Building too shallow for an approach cell → fall back to foot at the door.
      fi = i; fj = j;
      stairs = coreAt(cells, fi, fj, dir, lo, hi);
    }
    if (stairs.length) doorCands.push({ ci: fi, cj: fj, dir, comp: compOf(i, j), stairs, door: true });
  }
  const isPerimeter = (i: number, j: number) =>
    [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([di, dj]) => !occupied(cells, lo, i + di, j + dj));
  const interiorPerimeter = (component: number): Candidate[] => {
    const cands: Candidate[] = [];
    const seen = new Set<string>();
    for (const k in cells) {
      const [, i, j] = k.split(',').map(Number);
      if (compOf(i, j) !== component || !isPerimeter(i, j) || seen.has(`${i},${j}`)) continue;
      seen.add(`${i},${j}`);
      for (const dir of DIR_ORDER) {
        const stairs = coreAt(cells, i, j, dir, lo, hi);
        if (stairs.length) cands.push({ ci: i, cj: j, dir, comp: component, stairs, door: false });
      }
    }
    return cands;
  };

  const components = new Set<number>();
  for (const v of comp.values()) components.add(v);
  for (const c of components) {
    const seen = new Set<string>();
    const pool: Candidate[] = [];
    for (const cand of [
      ...doorCands.filter((d) => d.comp === c).sort(sortCandidates),
      ...interiorPerimeter(c).sort(sortCandidates),
    ]) {
      const key = `${cand.ci},${cand.cj},${cand.dir}`;
      if (seen.has(key)) continue;
      seen.add(key);
      pool.push(cand);
    }
    if (!pool.length) continue;
    const pick = pool[((circ.seed % pool.length) + pool.length) % pool.length];
    for (const st of pick.stairs) tryEmit(st);
  }
  return out;
}

// Tangent directions (along the wall) for each outward face dir.
const TANGENTS: Record<Dir, [Dir, Dir]> = {
  E: ['N', 'S'],
  W: ['N', 'S'],
  N: ['E', 'W'],
  S: ['E', 'W'],
};

const ALL_DIRS: Dir[] = ['N', 'E', 'S', 'W'];

type FlightSpec = { level: number; ci: number; cj: number; dir: Dir };

/** March a straight descent from platform (F,pi,pj) along `ext`, stopping at the first
 *  WALKABLE SURFACE below — a building roof/terrace, or the ground — whichever comes
 *  first. Returns the flights (no id/model) + whether it landed on a building roof
 *  (a terrace) vs the ground, or null if blocked before reaching any surface.
 *
 *  Flight k (base level L=F-1-k) occupies the high cell (offset 2k+1) and the low cell
 *  (offset 2k+2) between floors L and L+1. The whole air box must be clear — high cell at
 *  L & L+1, low cell at L+1 — EXCEPT the low cell at L, which may be a building roof: that
 *  is the landing (you step onto the terrace), so the run stops there. No wall is ever
 *  crossed (only the landing cell is allowed occupied). */
function descendFlights(
  cells: CellMap, F: number, pi: number, pj: number, g: number, ext: Dir
): { flights: FlightSpec[]; onRoof: boolean } | null {
  const [tx, ty] = STEP[ext];
  const flights: FlightSpec[] = [];
  for (let k = 0; ; k++) {
    const L = F - 1 - k;
    if (L < g) return null; // ran past the ground without landing (shouldn't happen)
    const hci = pi + tx * (2 * k + 1), hcj = pj + ty * (2 * k + 1); // high cell (offset 2k+1)
    const lci = pi + tx * (2 * k + 2), lcj = pj + ty * (2 * k + 2); // low cell  (offset 2k+2)
    if (occupied(cells, L, hci, hcj) || occupied(cells, L + 1, hci, hcj) || occupied(cells, L + 1, lci, lcj))
      return null; // the flight's air box hits the building → this direction can't descend
    flights.push({ level: L, ci: lci, cj: lcj, dir: OPP[ext] });
    if (occupied(cells, L, lci, lcj)) return { flights, onRoof: true }; // landed on a building roof/terrace
    if (L === g) return { flights, onRoof: false }; // landed on the ground
    // else the low cell is mid-air → keep descending
  }
}

/** The building direction a platform faces (its neighbour at level F is occupied), used
 *  to prefer wall-parallel tangents. null if free-standing. */
function inwardDir(cells: CellMap, F: number, pi: number, pj: number): Dir | null {
  for (const dd of ALL_DIRS) {
    const [di, dj] = STEP[dd];
    if (occupied(cells, F, pi + di, pj + dj)) return dd;
  }
  return null;
}

/** Pick the descent direction: an explicit dirOverride wins if it reaches a surface;
 *  otherwise auto-prefer landing on a building TERRACE (onRoof), then the shortest run,
 *  then wall-parallel tangent order. null if every direction is boxed in. */
function pickDescent(
  cells: CellMap, F: number, pi: number, pj: number, g: number, dirOverride?: Dir
): { ext: Dir; flights: FlightSpec[]; onRoof: boolean } | null {
  const valid = ALL_DIRS
    .map((ext) => ({ ext, ...(descendFlights(cells, F, pi, pj, g, ext) ?? {}) }))
    .filter((v): v is { ext: Dir; flights: FlightSpec[]; onRoof: boolean } => 'flights' in v);
  if (!valid.length) return null;
  if (dirOverride) {
    const ov = valid.find((v) => v.ext === dirOverride);
    if (ov) return ov;
  }
  const order = inwardDir(cells, F, pi, pj) ? TANGENTS[inwardDir(cells, F, pi, pj)!] : ALL_DIRS;
  const tIdx = (ext: Dir) => { const i = order.indexOf(ext); return i < 0 ? ALL_DIRS.length : i; };
  return [...valid].sort((a, b) =>
    (a.onRoof ? 0 : 1) - (b.onRoof ? 0 : 1) ||
    a.flights.length - b.flights.length ||
    tIdx(a.ext) - tIdx(b.ext)
  )[0];
}

/** Next descent direction after the platform's current effective one — used by "rotate"
 *  so each press jumps to a direction that actually reaches a surface (skips blocked
 *  ones). undefined if none / boxed in. */
export function cycleDescentDir(cells: CellMap, platformKey: string, current?: Dir): Dir | undefined {
  const { 0: F, 1: pi, 2: pj } = platformKey.split(',').map(Number);
  const g = levelRange(cells)[0];
  if (F - g <= 0) return undefined;
  const dirs = ALL_DIRS.filter((ext) => descendFlights(cells, F, pi, pj, g, ext) !== null);
  if (!dirs.length) return undefined;
  const eff = current && dirs.includes(current) ? current : pickDescent(cells, F, pi, pj, g)?.ext;
  const idx = eff ? dirs.indexOf(eff) : -1;
  return dirs[(idx + 1) % dirs.length];
}

/** Expand a drawn outdoor PLATFORM ("F,pi,pj") into a stair that descends one floor.
 *  The platform IS the landing (drawn by the user, in front of a door); the stair
 *  always stays OUTSIDE the footprint (never crosses a wall).
 *
 *  Platforms chain into ONE system, and the USER's placement decides the shape:
 *  if another platform sits one floor DOWN and exactly 2 cells away in some cardinal
 *  direction, this platform runs a SINGLE flight toward IT (the stair breaks at each
 *  platform; that platform carries on). Place the next platform to the LEFT vs RIGHT
 *  to fold back (switchback) vs go straight. If there is NO platform below, it descends
 *  to the NEAREST walkable surface — a building roof/terrace, or the ground (see
 *  descendFlights). One flight spans 2 cells (model depth = 4 = 2 cells), so the next
 *  platform must be exactly 3 cells over (2 flight cells + the landing). */
export function expandPlatform(
  cells: CellMap,
  platformKey: string,
  platformKeys: Set<string> = new Set(),
  model?: string,
  dirOverride?: Dir
): { stairs: Stair[] } {
  const { 0: F, 1: pi, 2: pj } = platformKey.split(',').map(Number);
  const g = levelRange(cells)[0];
  if (F - g <= 0) return { stairs: [] }; // ground-level platform → no descent
  const id = platformStairId(platformKey);
  const tag = (s: Stair): Stair => (model ? { ...s, model } : s);
  const clear = (ci: number, cj: number, lo: number, hiL: number) => {
    for (let L = lo; L <= hiL; L++) if (occupied(cells, L, ci, cj)) return false;
    return true;
  };

  // (1) CHAIN: the flight model fills 2 cells (both sloped — neither is flat), so the
  // next platform must sit BEYOND the flight, one floor down + exactly 3 cells away in
  // a cardinal direction. Layout along d:  platform[F](0) · flight-high(1) · flight-low(2)
  // · platform[F-1](3). The single flight occupies cells 1 & 2; the platform is the flat
  // landing at cell 3 (so you actually step off onto it, not under the stairs). Direction
  // follows the user's placement (left/right) → switchback or straight, their choice.
  for (const d of ALL_DIRS) {
    const [dx, dy] = STEP[d];
    const px = pi + 3 * dx, py = pj + 3 * dy; // next platform (flat landing, beyond the flight)
    if (!platformKeys.has(`${F - 1},${px},${py}`)) continue;
    // The 2 flight cells (offsets 1 & 2) must stay outside the building, at both levels.
    if (!clear(pi + dx, pj + dy, F - 1, F)) continue; // high end (offset 1, floor F)
    if (!clear(pi + 2 * dx, pj + 2 * dy, F - 1, F)) continue; // low end (offset 2, floor F-1)
    return { stairs: [tag({ id, level: F - 1, ci: pi + 2 * dx, cj: pj + 2 * dy, dir: OPP[d] })] };
  }

  // (2) No drawn platform below → descend to the NEAREST walkable surface: a building
  // roof/terrace, or the ground (whichever the run reaches first). A user dirOverride
  // (from "rotate") wins if it reaches a surface; otherwise auto-prefer landing on a
  // terrace, then the shortest run. (Building roofs are platforms too.)
  const picked = pickDescent(cells, F, pi, pj, g, dirOverride);
  if (!picked) return { stairs: [] }; // boxed in → just the platform
  return { stairs: picked.flights.map((f) => tag({ id, ...f })) };
}

/** The building wall face a platform should turn into a door (so you can step in),
 *  or null if the platform isn't against an enclosed wall. Needs style info, so the
 *  caller passes an `isEnclosed(level,i,j)` predicate. */
export function platformDoorFace(
  cells: CellMap,
  platformKey: string,
  isEnclosed: (level: number, i: number, j: number) => boolean
): string | null {
  const { 0: F, 1: pi, 2: pj } = platformKey.split(',').map(Number);
  // numeric face dir of the delta FROM the neighbour back TO the platform
  const NUM: Record<string, number> = { '-1,0': 0, '1,0': 1, '0,-1': 2, '0,1': 3 };
  for (const dd of ALL_DIRS) {
    const [di, dj] = STEP[dd];
    const ni = pi + di, nj = pj + dj;
    if (occupied(cells, F, ni, nj) && isEnclosed(F, ni, nj)) {
      return `${F},${ni},${nj},${NUM[`${-di},${-dj}`]}`;
    }
  }
  return null;
}
