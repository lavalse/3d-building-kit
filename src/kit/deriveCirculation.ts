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
    const dir = OPP[FACE_LETTER[d]];
    const stairs = coreAt(cells, i, j, dir, lo, hi);
    if (stairs.length) doorCands.push({ ci: i, cj: j, dir, comp: compOf(i, j), stairs, door: true });
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

/** Expand a drawn outdoor PLATFORM ("F,pi,pj") into a wall-parallel stair that
 *  auto-descends to the ground. The platform IS the top landing (drawn by the user,
 *  in front of a door). The run is rotated 90° to hug the wall: it leaves the platform
 *  along a clear tangent (perpendicular to the adjacent building) and steps down,
 *  continuous, to the ground — staying entirely OUTSIDE the footprint (never crossing
 *  a wall, no central well). Returns the descending flights; empty (platform only) if
 *  on the ground or boxed in. */
export function expandPlatform(cells: CellMap, platformKey: string): { stairs: Stair[] } {
  const { 0: F, 1: pi, 2: pj } = platformKey.split(',').map(Number);
  const g = levelRange(cells)[0];
  const flights = F - g;
  if (flights <= 0) return { stairs: [] }; // ground-level platform → no descent

  // Which side is the building? (so the run goes ALONG it, not into it.)
  let inward: Dir | null = null;
  for (const dd of ALL_DIRS) {
    const [di, dj] = STEP[dd];
    if (occupied(cells, F, pi + di, pj + dj)) { inward = dd; break; }
  }
  // Tangents: perpendicular to the building side; if free-standing, any direction.
  const cands = inward ? TANGENTS[inward] : ALL_DIRS;
  const id = platformStairId(platformKey);

  for (const ext of cands) {
    const te = STEP[ext]; // run extends away from the platform along `ext`
    const dir = OPP[ext]; // each flight climbs back toward the platform
    const cellN = (n: number): [number, number] => [pi + te[0] * n, pj + te[1] * n];
    // Flight cells = offsets 1 .. 2·flights (offset 0 is the platform itself);
    // all must be clear at every spanned level so the run hugs the wall, never crossing it.
    let clear = true;
    for (let n = 1; n <= 2 * flights && clear; n++) {
      const [ci, cj] = cellN(n);
      for (let L = g; L <= F; L++) if (occupied(cells, L, ci, cj)) { clear = false; break; }
    }
    if (!clear) continue;

    const stairs: Stair[] = [];
    for (let k = 0; k < flights; k++) {
      const L = F - 1 - k; // rises L → L+1; high end at offset 2k+1 (next to platform), low end at 2k+2
      const [ci, cj] = cellN(2 * k + 2);
      stairs.push({ id, level: L, ci, cj, dir });
    }
    return { stairs };
  }
  return { stairs: [] }; // boxed in on every tangent → just the platform
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
