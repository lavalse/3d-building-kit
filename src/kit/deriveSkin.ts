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
  DOOR_LEAF_OFFSET,
} from './constants';
import { occupied, type CellMap } from './massing';
import type { FaceOverride, Instance, SkinTheme } from './types';

/** level → theme resolver (per-level styles). */
export type ThemeAt = (level: number) => SkinTheme;

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

// A face (level,i,j,dir) is an exterior wall if the cell is occupied and the
// cell just outside it is empty.
const faceExterior = (cells: CellMap, level: number, i: number, j: number, dir: number) => {
  const [di, dj] = DELTA[dir];
  return occupied(cells, level, i, j) && !occupied(cells, level, i + di, j + dj);
};

interface ThemeRules {
  walls: boolean;
  door: boolean;
  columns: boolean;
  roof: boolean;
}
const THEMES: Record<SkinTheme, ThemeRules> = {
  house: { walls: true, door: true, columns: true, roof: true },
  pavilion: { walls: false, door: false, columns: true, roof: true },
  open: { walls: false, door: false, columns: false, roof: true },
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

/** Pick the single main-entrance face (ground level, prefer the south/-Z side). */
function pickEntrance(cells: CellMap, groundLvl: number): string | null {
  const ground: { i: number; j: number }[] = [];
  for (const k of Object.keys(cells)) {
    const [lvl, i, j] = k.split(',').map(Number);
    if (lvl === groundLvl) ground.push({ i, j });
  }
  if (ground.length === 0) return null;
  const centroidI = ground.reduce((s, c) => s + c.i, 0) / ground.length;

  type Cand = { i: number; j: number; dir: number; south: boolean };
  const cands: Cand[] = [];
  for (const { i, j } of ground) {
    for (const dir of DIRS) {
      const [di, dj] = DELTA[dir];
      if (!occupied(cells, groundLvl, i + di, j + dj)) {
        cands.push({ i, j, dir, south: dir === S });
      }
    }
  }
  if (cands.length === 0) return null;
  cands.sort((a, b) => {
    if (a.south !== b.south) return a.south ? -1 : 1; // south faces first
    if (a.j !== b.j) return a.j - b.j; // nearer the front (lower j)
    const da = Math.abs(a.i - centroidI);
    const db = Math.abs(b.i - centroidI);
    if (da !== db) return da - db; // nearer the centre
    return a.i - b.i;
  });
  const e = cands[0];
  return `${groundLvl},${e.i},${e.j},${e.dir}`; // matches faceKey
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
  themeAt: ThemeAt = () => 'house',
  faceOverrides: Record<string, FaceOverride> = {},
  roofOverrides: RoofOverrides = {},
  roofFallbackCenter = false
): PieceSpec[] {
  const out: PieceSpec[] = [];
  const entrance = THEMES[themeAt(groundLvl)].door ? pickEntrance(cells, groundLvl) : null;

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
    const rules = THEMES[themeAt(level)];

    // Floor tile for every occupied cell.
    out.push({ pieceId: PIECE_FLOOR, x: cellCenter(i), z: cellCenter(j), floor: level, rotationY: 0 });

    if (rules.walls) {
      for (const dir of DIRS) {
        if (!faceExterior(cells, level, i, j, dir)) continue;
        const faceKey = `${level},${i},${j},${dir}`;
        const ov = faceOverrides[faceKey];
        let kind: FaceOverride;
        if (ov) kind = ov; // explicit window/door/wall — mergeable for window/door
        else if (entrance && faceKey === entrance) kind = 'door'; // auto entrance, single
        else kind = faceHash(i, j, level, dir) % 100 < 70 ? 'window' : 'wall'; // auto, single
        faces.push({ level, i, j, dir, kind, merge: ov === 'window' || ov === 'door' });
      }
    }

    // Roof: one flat tile per roof cell → continuous flat roof for any shape.
    if (rules.roof && isRoof(cells, roofOverrides, level, i, j)) {
      out.push({
        pieceId: PIECE_ROOF_CENTER,
        x: cellCenter(i),
        z: cellCenter(j),
        floor: level,
        yOffset: WALL_HEIGHT,
        rotationY: 0,
      });
      // Low rail along the outer boundary only (skip if fallback = plain flat).
      if (!roofFallbackCenter) {
        for (const dir of DIRS) {
          if (!roofEdgeExposed(cells, roofOverrides, level, i, j, dir)) continue;
          const t = faceTransform(i, j, dir);
          out.push({
            pieceId: PIECE_BORDER,
            x: t.x,
            z: t.z,
            floor: level,
            yOffset: WALL_HEIGHT,
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

  // Corner columns at convex posts — per level, only where that level's theme uses columns.
  {
    const posts = new Set<string>();
    for (const key of Object.keys(cells)) {
      const { 0: level, 1: i, 2: j } = key.split(',').map(Number);
      posts.add(`${level},${i},${j}`);
      posts.add(`${level},${i + 1},${j}`);
      posts.add(`${level},${i},${j + 1}`);
      posts.add(`${level},${i + 1},${j + 1}`);
    }
    for (const p of posts) {
      const { 0: level, 1: pi, 2: pj } = p.split(',').map(Number);
      if (!THEMES[themeAt(level)].columns) continue;
      const a = occupied(cells, level, pi - 1, pj - 1);
      const b = occupied(cells, level, pi, pj - 1);
      const c = occupied(cells, level, pi - 1, pj);
      const d = occupied(cells, level, pi, pj);
      const n = (a ? 1 : 0) + (b ? 1 : 0) + (c ? 1 : 0) + (d ? 1 : 0);
      const diagonal = (a && d && !b && !c) || (b && c && !a && !d);
      if (n === 1 || n === 3 || (n === 2 && diagonal)) {
        out.push({ pieceId: PIECE_COLUMN, x: line(pi), z: line(pj), floor: level, rotationY: 0 });
      }
    }
  }

  return out;
}
