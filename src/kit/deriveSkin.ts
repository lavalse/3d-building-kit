// Auto-materialization: turn the occupied-cell map into a full building skin
// (floors, exterior walls with deterministic windows + one ground door, corner
// columns, and ONE continuous flat roof with a low rail only along the outer
// boundary). All connected occupied cells form a single building — interior
// cell boundaries get no wall, so corridors/L-shapes read as one open space.
//
// PURE & DETERMINISTIC: same cells → same skin. Every piece's identity is a
// function of cell coordinates only (no RNG, no time, no iteration order), so
// editing one cell never changes unrelated faces.

import {
  WALL_HEIGHT,
  ROT_STEP,
  cellCenter,
  line,
  PIECE_FLOOR,
  PIECE_WALL,
  PIECE_WINDOW,
  PIECE_DOORWAY,
  PIECE_WINDOW_WIDE,
  PIECE_DOORWAY_WIDE,
  PIECE_DOOR_LEAF,
  HALF,
  PIECE_COLUMN,
  PIECE_ROOF_CENTER,
  PIECE_BORDER,
  PIECE_STAIRS,
  DOOR_LEAF_OFFSET,
  BAY,
} from './constants';
import { occupied, ownerAt, type CellMap } from './massing';
import { deriveCirculation, expandPlatform, type Circulation } from './deriveCirculation';
import type { Dir, FaceOverride, Instance, SkinTheme } from './types';

/** Per-space style map: spaceId → style. */
export type StyleBySpace = Record<string, SkinTheme>;

// Stair climb step (cell delta) and the rotation that points its high end that way.
// MUST-VERIFY rotations on screen (like the roof tables).
const STAIR_STEP: Record<Dir, [number, number]> = { N: [0, 1], S: [0, -1], E: [1, 0], W: [-1, 0] };
const STAIR_ROT: Record<Dir, number> = { N: 0, E: ROT_STEP, S: 2 * ROT_STEP, W: 3 * ROT_STEP };

export type PieceSpec = Omit<Instance, 'id'>;

// Directions, fixed order. dx/dz are cell-index deltas.
const W = 0, E = 1, S = 2, N = 3;
const DIRS = [W, E, S, N];
const DELTA: Record<number, [number, number]> = {
  [W]: [-1, 0],
  [E]: [1, 0],
  [S]: [0, -1],
  [N]: [0, 1],
};
// Along-the-wall run direction (where a wide opening grabs its neighbour):
// W/E walls run along Z (+j); S/N walls run along X (+i).
const RUN: Record<number, [number, number]> = {
  [W]: [0, 1],
  [E]: [0, 1],
  [S]: [1, 0],
  [N]: [1, 0],
};

type ColumnMode = 'corner' | 'grid' | 'none';
interface ThemeRules {
  walls: boolean;
  door: boolean;
  columns: ColumnMode;
  roof: boolean;
}
const THEMES: Record<SkinTheme, ThemeRules> = {
  // Load-bearing walls = structure; decorative corner posts at convex corners.
  enclosed: { walls: true, door: true, columns: 'corner', roof: true },
  // Post-and-slab frame: a regular column grid (incl. interior) carries the slabs.
  open: { walls: false, door: false, columns: 'grid', roof: true },
};

/** Stable 32-bit hash of a face identity. */
function faceHash(ci: number, cj: number, level: number, dir: number): number {
  let h = 2166136261 >>> 0;
  for (const v of [ci, cj, level, dir]) {
    h ^= ((v | 0) + 0x9e3779b9 + (h << 6) + (h >>> 2)) >>> 0;
    h = h >>> 0;
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

/** World transform of a wall/opening on a given face of cell (i,j). */
function faceTransform(i: number, j: number, dir: number) {
  switch (dir) {
    case W:
      return { x: line(i), z: cellCenter(j), rotationY: 0 };
    case E:
      return { x: line(i + 1), z: cellCenter(j), rotationY: 0 };
    case S:
      return { x: cellCenter(i), z: line(j), rotationY: ROT_STEP };
    default: // N
      return { x: cellCenter(i), z: line(j + 1), rotationY: ROT_STEP };
  }
}

const roofCellKey = (level: number, i: number, j: number) => `${level},${i},${j}`;

// A roof cell = occupied here, empty directly above, and not opened to the sky.
const isRoof = (cells: CellMap, ro: RoofOverrides, level: number, i: number, j: number) =>
  occupied(cells, level, i, j) &&
  !occupied(cells, level + 1, i, j) &&
  ro[roofCellKey(level, i, j)] !== 'open';

// A roof edge is exposed (gets a perimeter rail) if the neighbour isn't a roof cell.
const roofEdgeExposed = (cells: CellMap, ro: RoofOverrides, level: number, i: number, j: number, dir: number) => {
  const [di, dj] = DELTA[dir];
  return !isRoof(cells, ro, level, i + di, j + dj);
};

export type RoofOverrides = Record<string, 'open'>;

export function deriveSkin(
  cells: CellMap,
  groundLvl: number,
  styleBySpace: StyleBySpace = {},
  faceOverrides: Record<string, FaceOverride> = {},
  roofOverrides: RoofOverrides = {},
  roofFallbackCenter = false,
  circulation: Circulation = { auto: true, seed: 0, manual: [], suppressed: [], platforms: [] }
): PieceSpec[] {
  const out: PieceSpec[] = [];

  // Per-cell style comes from the cell's owning space (region), not the level.
  const styleAt = (level: number, i: number, j: number): SkinTheme | null => {
    const id = ownerAt(cells, level, i, j);
    return id ? styleBySpace[id] ?? 'enclosed' : null;
  };
  // "enclosed" = the cell's style uses walls. Empty / open-frame cells = false.
  const enc = (level: number, i: number, j: number): boolean => {
    const s = styleAt(level, i, j);
    return s ? THEMES[s].walls : false;
  };
  const columnMode = (level: number, i: number, j: number): ColumnMode => {
    const s = styleAt(level, i, j);
    return s ? THEMES[s].columns : 'none';
  };
  // Corner posts (enclosed) hug convex corners; grid columns (open frame) below.
  const usesCorner = (level: number, i: number, j: number) => columnMode(level, i, j) === 'corner';
  const usesGrid = (level: number, i: number, j: number) => columnMode(level, i, j) === 'grid';
  // A wall sits on a face iff this (enclosed) cell's neighbour is NOT enclosed
  // (empty or an open region). One-sided emit → automatic dedup; same-enclosure
  // neighbours merge into one open room.
  const wallFace = (level: number, i: number, j: number, dir: number): boolean => {
    if (!enc(level, i, j)) return false;
    const [di, dj] = DELTA[dir];
    return !enc(level, i + di, j + dj);
  };

  // Main entrance: one door on the ground floor's front (−Z) of an enclosed region.
  const pickEntrance = (): string | null => {
    type Cand = { i: number; j: number; dir: number; south: boolean };
    const cands: Cand[] = [];
    let sumI = 0, nGround = 0;
    for (const k of Object.keys(cells)) {
      const { 0: lvl, 1: i } = k.split(',').map(Number);
      if (lvl === groundLvl) {
        sumI += i;
        nGround++;
      }
    }
    if (!nGround) return null;
    const centroidI = sumI / nGround;
    for (const k of Object.keys(cells)) {
      const { 0: lvl, 1: i, 2: j } = k.split(',').map(Number);
      if (lvl !== groundLvl) continue;
      for (const dir of DIRS) {
        if (wallFace(groundLvl, i, j, dir)) cands.push({ i, j, dir, south: dir === S });
      }
    }
    if (!cands.length) return null;
    cands.sort((a, b) => {
      if (a.south !== b.south) return a.south ? -1 : 1;
      if (a.j !== b.j) return a.j - b.j;
      const da = Math.abs(a.i - centroidI);
      const db = Math.abs(b.i - centroidI);
      if (da !== db) return da - db;
      return a.i - b.i;
    });
    const e = cands[0];
    return `${groundLvl},${e.i},${e.j},${e.dir}`;
  };
  const entrance = pickEntrance();

  // Circulation. Ground doors anchor the interior auto-core; face-attached exterior
  // stair-towers (circulation.attachments) are expanded separately.
  const groundDoors: string[] = [];
  if (entrance) groundDoors.push(entrance);
  for (const fk in faceOverrides) {
    if (faceOverrides[fk] !== 'door') continue;
    const { 0: lvl, 1: i, 2: j, 3: d } = fk.split(',').map(Number);
    if (lvl === groundLvl && fk !== entrance && wallFace(lvl, i, j, d)) groundDoors.push(fk);
  }
  const stairs = deriveCirculation(cells, { groundDoors }, circulation);

  // Drawn outdoor platforms: each emits its platform tile + an auto stair that
  // descends to the next platform below it (chaining into one system) or the ground.
  const landingTiles: string[] = []; // "floor,ci,cj" outdoor platform cells
  const platformSet = new Set(circulation.platforms);
  for (const pk of circulation.platforms) {
    landingTiles.push(pk); // the platform itself ("F,pi,pj")
    stairs.push(...expandPlatform(cells, pk, platformSet).stairs);
  }

  // Stairwell openings: cut the floor above ONLY for interior stairs (bottom cell
  // inside the footprint). Exterior stairs land on the edge → no hole.
  const floorHoles = new Set<string>();
  for (const st of stairs) {
    if (!occupied(cells, st.level, st.ci, st.cj)) continue; // exterior → no stairwell
    const [di, dj] = STAIR_STEP[st.dir];
    floorHoles.add(`${st.level + 1},${st.ci},${st.cj}`);
    floorHoles.add(`${st.level + 1},${st.ci + di},${st.cj + dj}`);
  }

  // Seat the hinged door leaf centered in the opening (offset baked in its pivot).
  // The leaf carries the doorway's faceKey so clicking it cycles that face.
  const pushDoorLeaf = (t: { x: number; z: number; rotationY: number }, level: number, faceKey: string) =>
    out.push({
      pieceId: PIECE_DOOR_LEAF,
      x: t.x - DOOR_LEAF_OFFSET * Math.sin(t.rotationY),
      z: t.z - DOOR_LEAF_OFFSET * Math.cos(t.rotationY),
      floor: level,
      rotationY: t.rotationY,
      faceKey,
    });

  // Collect every exterior wall face with its resolved "kind"; walls are emitted
  // in a second pass so contiguous same-kind openings can merge into wide pieces.
  type Face = { level: number; i: number; j: number; dir: number; kind: FaceOverride; merge: boolean };
  const faces: Face[] = [];

  for (const key of Object.keys(cells)) {
    const { 0: level, 1: i, 2: j } = key.split(',').map(Number);

    // Floor tile for every occupied cell (all styles have a floor), except where
    // a stair below opens a stairwell through this floor.
    if (!floorHoles.has(`${level},${i},${j}`)) {
      out.push({ pieceId: PIECE_FLOOR, x: cellCenter(i), z: cellCenter(j), floor: level, rotationY: 0 });
    }

    // Walls only on faces where this enclosed cell meets a non-enclosed neighbour.
    for (const dir of DIRS) {
      if (!wallFace(level, i, j, dir)) continue;
      const faceKey = `${level},${i},${j},${dir}`;
      const ov = faceOverrides[faceKey];
      let kind: FaceOverride;
      if (ov) kind = ov; // explicit window/door/wall — mergeable for window/door
      else if (entrance && faceKey === entrance) kind = 'door'; // auto entrance, single
      else kind = faceHash(i, j, level, dir) % 100 < 70 ? 'window' : 'wall'; // auto, single
      faces.push({ level, i, j, dir, kind, merge: ov === 'window' || ov === 'door' });
    }

    // Roof: one flat tile per roof cell → continuous flat roof for any shape.
    if (isRoof(cells, roofOverrides, level, i, j)) {
      out.push({
        pieceId: PIECE_ROOF_CENTER,
        x: cellCenter(i),
        z: cellCenter(j),
        floor: level,
        yOffset: WALL_HEIGHT + 0.002, // lift a hair off the wall-top plane (anti z-fight)
        rotationY: 0,
      });
      // Low rail along the outer boundary only (skip if fallback = plain flat).
      // Sits ON TOP of the roof tile (not coplanar with it) to avoid z-fighting.
      if (!roofFallbackCenter) {
        for (const dir of DIRS) {
          if (!roofEdgeExposed(cells, roofOverrides, level, i, j, dir)) continue;
          const t = faceTransform(i, j, dir);
          out.push({
            pieceId: PIECE_BORDER,
            x: t.x,
            z: t.z,
            floor: level,
            yOffset: WALL_HEIGHT + 0.1, // roof tile is 0.1 thick → rail rests on its top
            rotationY: t.rotationY,
          });
        }
      }
    }
  }

  // Wall pass: group exterior faces into runs along each edge line; merge
  // contiguous same-kind (window/door) faces into wide (2-cell) pieces.
  const runVar = (f: Face) => (f.dir === W || f.dir === E ? f.j : f.i);
  const runs = new Map<string, Face[]>();
  for (const f of faces) {
    const lineKey = f.dir === W || f.dir === E ? `${f.level},${f.dir},${f.i}` : `${f.level},${f.dir},${f.j}`;
    (runs.get(lineKey) ?? runs.set(lineKey, []).get(lineKey)!).push(f);
  }
  const emitSingle = (f: Face) => {
    const t = faceTransform(f.i, f.j, f.dir);
    const faceKey = `${f.level},${f.i},${f.j},${f.dir}`;
    const pieceId = f.kind === 'window' ? PIECE_WINDOW : f.kind === 'door' ? PIECE_DOORWAY : PIECE_WALL;
    if (f.kind === 'door') pushDoorLeaf(t, f.level, faceKey);
    out.push({ pieceId, x: t.x, z: t.z, floor: f.level, rotationY: t.rotationY, faceKey });
  };
  const emitWide = (a: Face) => {
    const t = faceTransform(a.i, a.j, a.dir);
    const [ri, rj] = RUN[a.dir];
    out.push({
      pieceId: a.kind === 'door' ? PIECE_DOORWAY_WIDE : PIECE_WINDOW_WIDE,
      x: t.x + ri * HALF,
      z: t.z + rj * HALF,
      floor: a.level,
      rotationY: t.rotationY,
      faceKey: `${a.level},${a.i},${a.j},${a.dir}`,
    });
  };
  for (const run of runs.values()) {
    run.sort((p, q) => runVar(p) - runVar(q));
    let k = 0;
    while (k < run.length) {
      const f = run[k];
      if (f.merge) {
        // maximal segment of consecutive, same-kind, mergeable faces
        const seg = [f];
        let m = k + 1;
        while (m < run.length && run[m].merge && run[m].kind === f.kind && runVar(run[m]) === runVar(run[m - 1]) + 1) {
          seg.push(run[m]);
          m++;
        }
        let p = 0;
        while (p + 1 < seg.length) {
          emitWide(seg[p]); // covers seg[p] & seg[p+1]
          p += 2;
        }
        if (p < seg.length) emitSingle(seg[p]); // odd leftover
        k = m;
      } else {
        emitSingle(f);
        k++;
      }
    }
  }

  // Columns. A column sits on a grid-line intersection (post). Two structural modes:
  //  • enclosed (corner posts): a post at the CONVEX corners of the walled region.
  //  • open (frame): a regular column GRID at BAY spacing (world-aligned) over the
  //    region, INCLUDING interior posts, UNION the region's convex corners so every
  //    slab edge/corner is supported. This is the post-and-slab frame.
  {
    type Mode = (level: number, i: number, j: number) => boolean;
    // Convex-corner posts of whichever cells `pred` selects (the old logic).
    const convexPosts = (pred: Mode): Set<string> => {
      const posts = new Set<string>();
      const candidates = new Set<string>();
      for (const key of Object.keys(cells)) {
        const { 0: level, 1: i, 2: j } = key.split(',').map(Number);
        if (!pred(level, i, j)) continue;
        candidates.add(`${level},${i},${j}`);
        candidates.add(`${level},${i + 1},${j}`);
        candidates.add(`${level},${i},${j + 1}`);
        candidates.add(`${level},${i + 1},${j + 1}`);
      }
      for (const p of candidates) {
        const { 0: level, 1: pi, 2: pj } = p.split(',').map(Number);
        const a = pred(level, pi - 1, pj - 1);
        const b = pred(level, pi, pj - 1);
        const c = pred(level, pi - 1, pj);
        const d = pred(level, pi, pj);
        const n = (a ? 1 : 0) + (b ? 1 : 0) + (c ? 1 : 0) + (d ? 1 : 0);
        const diagonal = (a && d && !b && !c) || (b && c && !a && !d);
        if (n === 1 || n === 3 || (n === 2 && diagonal)) posts.add(p);
      }
      return posts;
    };

    const colPosts = new Set<string>();
    // Enclosed: corner posts only.
    for (const p of convexPosts(usesCorner)) colPosts.add(p);
    // Open frame: convex corners (edges/corners supported) ∪ interior BAY grid.
    for (const p of convexPosts(usesGrid)) colPosts.add(p);
    for (const key of Object.keys(cells)) {
      const { 0: level, 1: i, 2: j } = key.split(',').map(Number);
      if (!usesGrid(level, i, j)) continue;
      // Any of this cell's 4 corner intersections that land on the BAY grid get a post.
      for (const [pi, pj] of [
        [i, j],
        [i + 1, j],
        [i, j + 1],
        [i + 1, j + 1],
      ]) {
        if (pi % BAY === 0 && pj % BAY === 0) colPosts.add(`${level},${pi},${pj}`);
      }
    }
    for (const p of colPosts) {
      const { 0: level, 1: pi, 2: pj } = p.split(',').map(Number);
      out.push({ pieceId: PIECE_COLUMN, x: line(pi), z: line(pj), floor: level, rotationY: 0 });
    }
  }

  // Exterior-tower landing platforms (outdoor floor tiles at the flight junctions).
  for (const lt of landingTiles) {
    const { 0: level, 1: i, 2: j } = lt.split(',').map(Number);
    out.push({ pieceId: PIECE_FLOOR, x: cellCenter(i), z: cellCenter(j), floor: level, rotationY: 0 });
  }

  // Stairs (circulation layer): one flight per stair, rising level → level+1,
  // centered on its 2-cell run, high end pointing along `dir`.
  for (const st of stairs) {
    const [di, dj] = STAIR_STEP[st.dir];
    out.push({
      pieceId: PIECE_STAIRS,
      x: (cellCenter(st.ci) + cellCenter(st.ci + di)) / 2,
      z: (cellCenter(st.cj) + cellCenter(st.cj + dj)) / 2,
      floor: st.level,
      rotationY: STAIR_ROT[st.dir],
      stairKey: st.id,
    });
  }

  return out;
}
