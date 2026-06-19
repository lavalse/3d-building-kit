// The abstract massing layer: Spaces (rectangular volumes per level) and the
// owned cell map derived from them. Pure — no Three.js, no store.

import type { Space } from './types';

/** Map of "level,ci,cj" → owning spaceId. Value is the space id (not a bool) so
 *  the skinner can tell "inside one space" from "between two spaces". */
export type CellMap = Record<string, string>;

export const cellKey = (level: number, ci: number, cj: number) => `${level},${ci},${cj}`;

export function parseKey(k: string): { level: number; ci: number; cj: number } {
  const [level, ci, cj] = k.split(',').map(Number);
  return { level, ci, cj };
}

/** Normalize two dragged cell indices into an ordered inclusive rect. */
export function normalizeRect(ai: number, aj: number, bi: number, bj: number) {
  return {
    ci0: Math.min(ai, bi),
    cj0: Math.min(aj, bj),
    ci1: Math.max(ai, bi),
    cj1: Math.max(aj, bj),
  };
}

/** Build the owned cell map from the list of spaces. Later spaces overwrite
 *  earlier ones on overlap (last-drawn wins). */
export function spacesToCells(spaces: Space[]): CellMap {
  const cells: CellMap = {};
  for (const s of spaces) {
    for (let i = s.ci0; i <= s.ci1; i++) {
      for (let j = s.cj0; j <= s.cj1; j++) {
        cells[cellKey(s.level, i, j)] = s.id;
      }
    }
  }
  return cells;
}

/** spaceId owning cell (level,ci,cj), or null if empty. */
export const ownerAt = (cells: CellMap, level: number, ci: number, cj: number): string | null =>
  cells[cellKey(level, ci, cj)] ?? null;

export const occupied = (cells: CellMap, level: number, ci: number, cj: number): boolean =>
  cellKey(level, ci, cj) in cells;

/** Lowest (ground) level among all spaces, or 0 when empty. */
export function groundLevel(spaces: Space[]): number {
  if (spaces.length === 0) return 0;
  return spaces.reduce((m, s) => Math.min(m, s.level), Infinity);
}

/** Lowest level present in a cell map, or 0 when empty. */
export function groundLevelOfCells(cells: CellMap): number {
  let m = Infinity;
  for (const k in cells) {
    const lvl = Number(k.slice(0, k.indexOf(',')));
    if (lvl < m) m = lvl;
  }
  return m === Infinity ? 0 : m;
}

/** Stamp every cell of a rectangle on `level` with `spaceId` (mutates a copy). */
export function fillRect(
  cells: CellMap,
  level: number,
  ai: number,
  aj: number,
  bi: number,
  bj: number,
  spaceId: string
): CellMap {
  const next = { ...cells };
  const r = normalizeRect(ai, aj, bi, bj);
  for (let i = r.ci0; i <= r.ci1; i++)
    for (let j = r.cj0; j <= r.cj1; j++) next[cellKey(level, i, j)] = spaceId;
  return next;
}

/** Delete every cell of a rectangle on `level` (mutates a copy). */
export function eraseRect(
  cells: CellMap,
  level: number,
  ai: number,
  aj: number,
  bi: number,
  bj: number
): CellMap {
  const next = { ...cells };
  const r = normalizeRect(ai, aj, bi, bj);
  for (let i = r.ci0; i <= r.ci1; i++)
    for (let j = r.cj0; j <= r.cj1; j++) delete next[cellKey(level, i, j)];
  return next;
}
