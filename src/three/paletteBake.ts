import * as THREE from 'three';
import { PALETTE_CATS, vertexCategory, colorFor, type PaletteCat } from '../kit/palette';

// Bakes the kit's `colormap` palette texture into per-vertex colours, then recolours by
// SEMANTIC category (wall / trim / column / column-base / stair-tread / stair / floor / door /
// roof / glass). A vertex's category is decided once (its swatch colour + its normal), then
// recolour just looks up the category colour (flat; default ≈ the kit). Applied per-instance on
// the CLONE (shares its source GLB's geometry + materials → one apply propagates to all).
// NOTE: don't apply centrally via useGLTF(arrayOfUrls) — different cached instances than the
// per-piece useGLTF(url), so it won't reach the rendered clones.

const CAT_INDEX: PaletteCat[] = PALETTE_CATS.map((c) => c.id);

let pixels: Uint8ClampedArray | null = null;
let pxW = 0, pxH = 0;

/** Grab the colormap pixels once (from any object still carrying the textured material). */
export function ensurePixels(obj: THREE.Object3D): boolean {
  if (pixels) return true;
  let img: CanvasImageSource | null = null;
  obj.traverse((o) => {
    const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
    if (!img && m && m.name === 'colormap' && m.map && m.map.image) img = m.map.image as CanvasImageSource;
  });
  if (!img) return false;
  const w = (img as { width: number }).width, h = (img as { height: number }).height;
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  if (!ctx) return false;
  ctx.drawImage(img, 0, 0);
  pixels = ctx.getImageData(0, 0, w, h).data;
  pxW = w; pxH = h;
  return true;
}

const sample = (u: number, v: number): [number, number, number] => {
  const x = Math.min(Math.max(Math.floor(u * pxW), 0), pxW - 1);
  const y = Math.min(Math.max(Math.floor(v * pxH), 0), pxH - 1);
  const i = (y * pxW + x) * 4;
  return [pixels![i], pixels![i + 1], pixels![i + 2]];
};

const tmp = new THREE.Color();

/** Bake once per geometry: per vertex → its semantic category index. */
export function bakeGeometry(geom: THREE.BufferGeometry, pieceCat: PaletteCat) {
  if (geom.userData.bakeCat || !pixels) return;
  const uv = geom.getAttribute('uv');
  if (!uv) return;
  const n = uv.count;
  const bakeCat = new Uint8Array(n);
  for (let k = 0; k < n; k++) {
    const [r, g, b] = sample(uv.getX(k), uv.getY(k));
    bakeCat[k] = CAT_INDEX.indexOf(vertexCategory(pieceCat, r, g, b));
  }
  geom.userData.bakeCat = bakeCat;
  geom.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(n * 3), 3));
}

/** Rewrite the colour attribute: each vertex = its category's colour (palette or default). */
export function recolorGeometry(geom: THREE.BufferGeometry, palette: Partial<Record<PaletteCat, string>>) {
  const bakeCat = geom.userData.bakeCat as Uint8Array | undefined;
  const attr = geom.getAttribute('color') as THREE.BufferAttribute | undefined;
  if (!bakeCat || !attr) return;
  const arr = attr.array as Float32Array;
  for (let k = 0; k < bakeCat.length; k++) {
    tmp.set(colorFor(CAT_INDEX[bakeCat[k]], palette));
    arr[k * 3] = tmp.r; arr[k * 3 + 1] = tmp.g; arr[k * 3 + 2] = tmp.b;
  }
  attr.needsUpdate = true;
}
