export type Category = 'wall' | 'floor' | 'roof' | 'stairs' | 'structure';

/** One piece definition from public/kit/pieces.json */
export interface PieceDef {
  id: string;
  name: string;
  glb: string;
  preview: string;
  category: Category;
  size: [number, number, number];
  center: [number, number, number];
}

/** A materialized piece in the scene. Y is derived from `floor` * floorHeight + yOffset. */
export interface Instance {
  id: string;
  pieceId: string;
  x: number; // world X
  z: number; // world Z
  floor: number; // level index → y = floor * floorHeight + yOffset
  yOffset?: number; // extra Y within the level (roofs sit at wall-top)
  rotationY: number; // radians, multiple of ROT_STEP
  faceKey?: string; // for pickable exterior wall faces: "level,ci,cj,dir"
  roofKey?: string; // for pickable roof cells: "level,ci,cj"
  stairKey?: string; // for pickable stair pieces: the Stair id
}

/** Abstract spatial unit: a rectangular volume on one level. The persisted truth. */
export interface Space {
  id: string;
  level: number;
  ci0: number;
  cj0: number;
  ci1: number;
  cj1: number;
}

// Structural/enclosure typology of a space (not a building program):
//   enclosed = load-bearing walls form the envelope (walls ARE the structure)
//   semi     = post-and-slab frame + a waist-high perimeter parapet (balcony/loggia)
//   open     = post-and-slab frame: a regular column grid carries floor/roof, no walls
export type SkinTheme = 'enclosed' | 'semi' | 'open';

// A drawn roof over a rectangular region of a building's top — materialized as
// procedural geometry (the kit has flat roofs only). Sized to its footprint, so a
// 4×4 region yields a big roof and a 3×3 a small one.
//   gable = twin-pitch (ridge + two slopes + gable ends)
//   hip   = four slopes; a square footprint collapses to a pyramid (攒尖) apex
//   dome  = half-ellipsoid scaled to the footprint
//   shed  = single mono-pitch slope
export type RoofStyle = 'gable' | 'hip' | 'dome' | 'shed';

/** Persisted truth: one drawn roof. Region is a cell rectangle on `level`'s top. */
export interface RoofRegion {
  id: string;
  level: number;
  ci0: number;
  cj0: number;
  ci1: number;
  cj1: number;
  style: RoofStyle;
  rotated?: boolean; // swap the ridge/slope axis (gable & shed)
}

export type Tool = 'select' | 'space' | 'erase' | 'stair' | 'roof' | 'move';

/** Climb direction of a stair (the direction you ascend toward). */
export type Dir = 'N' | 'E' | 'S' | 'W';

/** A stair: a one-flight connector from `level` up to `level+1`.
 *  Bottom cell (ci,cj); the run occupies that cell and the next cell in `dir`. */
export interface Stair {
  id: string;
  level: number;
  ci: number;
  cj: number;
  dir: Dir;
  model?: string; // pieceId of the stair model to emit (default: stairs-open)
}

/** Per-face manual override of the auto-skin (set via the select tool).
 *  Width is emergent: contiguous faces sharing window/door merge into wide pieces. */
export type FaceOverride = 'wall' | 'window' | 'door';
