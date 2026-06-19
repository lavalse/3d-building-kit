// Geometry constants for the Kenney Building Kit, measured directly from the GLBs.
// All floor/wall/roof pieces are bottom-aligned (minY≈0) and X/Z-centered on a
// 2-unit module.
//
// COORDINATE MODEL: a cell (i,j) occupies the SQUARE between grid lines —
//   x ∈ [GRID*i, GRID*(i+1)],  z ∈ [GRID*j, GRID*(j+1)],  center at +HALF.
// Walls and columns live ON the grid lines (cell boundaries), so the rectangle
// the user drags out becomes the building's real outer wall line.
// drei <Grid cellSize=GRID> draws lines at 0,GRID,2·GRID… = exactly the cell
// boundaries, so floors fill the squares the user encloses.

export const GRID = 2.0; // module size (one floor tile is 2x2)
export const WALL_HEIGHT = 2.4; // measured height of a standard `wall`
export const DEFAULT_FLOOR_HEIGHT = 2.4; // vertical spacing between levels (editable)
export const ROT_STEP = Math.PI / 2; // rotation snaps to 90°
export const HALF = GRID / 2;
export const MAX_SPAN = 64; // max cells a single drag rectangle can extend (safety clamp)

// Piece ids used by the auto-skinner.
export const PIECE_FLOOR = 'floor';
export const PIECE_WALL = 'wall';
export const PIECE_WINDOW = 'wall-window-square';
export const PIECE_DOORWAY = 'wall-doorway-square';
export const PIECE_WINDOW_WIDE = 'wall-window-wide-square'; // spans 2 cells (Z=4)
export const PIECE_DOORWAY_WIDE = 'wall-doorway-wide-square'; // spans 2 cells (garage)
export const PIECE_DOOR_LEAF = 'door-rotate-square-a';
// Measured geometry center.z of the door leaf — its panel hangs off the hinge,
// so shift it back by this much to sit centered in the doorway opening.
export const DOOR_LEAF_OFFSET = 0.387;
export const PIECE_COLUMN = 'column';
export const PIECE_ROOF_CENTER = 'roof-flat-center';
export const PIECE_BORDER = 'border'; // low perimeter rail (parapet) along the roof outline

// World coordinate helpers for the square-cell model.
export const cellCenter = (i: number) => GRID * i + HALF; // center of cell i (X or Z)
export const line = (i: number) => GRID * i; // grid line / cell boundary i

/** World coordinate → cell index of the square it lies in. */
export const toCell = (v: number) => Math.floor(v / GRID);

/** Snap a world coordinate to the nearest grid line (used by free/manual tools). */
export const snap = (v: number) => Math.round(v / GRID) * GRID;
