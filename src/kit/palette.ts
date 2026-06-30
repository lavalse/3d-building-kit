// Per-element recolouring by SEMANTIC PART. The Kenney kit shares one palette-texture material
// (`colormap`, colour from UV swatches) + a `glass` material. We bake the swatches into
// per-vertex colours and recolour by category. A vertex's category is decided by its piece +
// its swatch colour (near-white = frame/base) + its normal (up-facing stair face = tread), so
// each named part below recolours as a unit. Default = a flat colour approximating the kit.

export type PaletteCat =
  | 'wall' | 'trim' | 'glass' | 'door' | 'door-metal' | 'roof' | 'column' | 'column-base' | 'floor' | 'stair';

/** UI order + label + default flat colour (≈ the kit, flat — used when a category isn't set). */
export const PALETTE_CATS: { id: PaletteCat; label: string; def: string }[] = [
  { id: 'wall', label: '墙面', def: '#8f96b4' },
  { id: 'trim', label: '门窗框', def: '#e3e3ef' },
  { id: 'glass', label: '玻璃', def: '#bcd3f0' },
  { id: 'door', label: '门', def: '#d65a43' },
  { id: 'door-metal', label: '门五金', def: '#7a7e88' },
  { id: 'roof', label: '屋顶', def: '#3b424f' },
  { id: 'column', label: '柱身', def: '#9aa1c2' },
  { id: 'column-base', label: '柱础', def: '#dfdfea' },
  { id: 'floor', label: '地面', def: '#c7cbdc' },
  { id: 'stair', label: '楼梯', def: '#8a90ad' },
];

export const DEFAULT_COLOR: Record<PaletteCat, string> = Object.fromEntries(
  PALETTE_CATS.map((c) => [c.id, c.def])
) as Record<PaletteCat, string>;

export const colorFor = (cat: PaletteCat, palette: Partial<Record<PaletteCat, string>>): string =>
  palette[cat] ?? DEFAULT_COLOR[cat];

/** Which piece a GLB id belongs to (coarse). Sub-parts are resolved per-vertex below. */
export function pieceCategory(pieceId: string): PaletteCat {
  if (pieceId.includes('column')) return 'column';
  // The eave rail / cornice (收边) follows the COLUMN colour; the flat-roof top SURFACE follows
  // the WALL colour. ('roof' is reserved for the DRAWN pitched/dome roofs, via palette.roof.)
  if (/^(border|gutter)/.test(pieceId)) return 'column';
  if (/^roof-flat/.test(pieceId)) return 'wall';
  if (pieceId.startsWith('roof')) return 'roof'; // (the kit has no real pitched-roof pieces)
  if (pieceId.startsWith('floor')) return 'floor';
  if (pieceId.startsWith('door-rotate')) return 'door';
  if (pieceId.startsWith('stairs')) return 'stair';
  if (pieceId.startsWith('wall')) return 'wall';
  return 'wall';
}

/** A near-white swatch = a frame (in wall pieces) or a column base. r,g,b in 0..255. */
export function isFrameColor(r: number, g: number, b: number): boolean {
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  const sat = mx === 0 ? 0 : (mx - mn) / mx;
  return lum > 0.78 && sat < 0.15;
}

/** The recolour category of one VERTEX: piece + swatch (near-white = frame / column base). */
export function vertexCategory(pieceCat: PaletteCat, r: number, g: number, b: number): PaletteCat {
  if (pieceCat === 'wall') return isFrameColor(r, g, b) ? 'trim' : 'wall';
  if (pieceCat === 'column') return isFrameColor(r, g, b) ? 'column-base' : 'column';
  // Door leaf is warm/red; its hardware (handle, kickplate, hinges) is cool/grey → metal.
  if (pieceCat === 'door') return r - Math.max(g, b) > 20 ? 'door' : 'door-metal';
  return pieceCat; // floor / roof / stair — one colour each
}
