import * as THREE from 'three';
import type { RoofStyle } from '../kit/types';

// Procedural roof geometry, built to fit a w×d footprint (X×Z), base at y=0, apex/ridge
// at y=rise, centered on the origin. The caller positions it at the building's wall-top.
//
// Triangle SOUP (non-indexed) → computeVertexNormals gives crisp per-facet shading, which
// reads as proper roof planes. The dome is the exception (a smooth scaled hemisphere).

const fromTris = (tris: number[]): THREE.BufferGeometry => {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(tris, 3));
  g.computeVertexNormals();
  return g;
};

// Vertex emitter: `swap` maps authored (x,y,z) → world (z,y,x), so the same authored
// shape (built with the ridge along authored-X) can run along world-X or world-Z.
const emitter = (swap: boolean) => {
  const t: number[] = [];
  const v = (x: number, y: number, z: number) => (swap ? t.push(z, y, x) : t.push(x, y, z));
  const tri = (a: number[], b: number[], c: number[]) => { v(a[0], a[1], a[2]); v(b[0], b[1], b[2]); v(c[0], c[1], c[2]); };
  const quad = (a: number[], b: number[], c: number[], d: number[]) => { tri(a, b, c); tri(a, c, d); };
  return { t, tri, quad };
};

export function roofGeometry(style: RoofStyle, w: number, d: number, rise: number, rotated = false): THREE.BufferGeometry {
  const hw = w / 2, hd = d / 2;

  if (style === 'dome') {
    // Upper half-ellipsoid: base ellipse hw×hd at y=0, apex at y=rise.
    const g = new THREE.SphereGeometry(1, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2);
    g.scale(hw, rise, hd);
    return g;
  }

  // Ridge/slope runs along the LONGER world axis by default; `rotated` flips it (hip
  // always uses the longer axis — its inset is half the shorter span, so rotation is moot).
  const swap = style === 'hip' ? d > w : (d > w) !== rotated;
  const hr = swap ? hd : hw; // authored-X half (along the ridge/slope axis)
  const hp = swap ? hw : hd; // authored-Z half (across it)
  const { t, tri, quad } = emitter(swap);

  // Base corners (authored frame), y=0.
  const A = [-hr, 0, -hp], B = [hr, 0, -hp], C = [hr, 0, hp], D = [-hr, 0, hp];

  if (style === 'gable') {
    const R1 = [-hr, rise, 0], R2 = [hr, rise, 0]; // full-length ridge along authored-X
    quad(A, B, R2, R1); // -Z slope
    quad(C, D, R1, R2); // +Z slope
    tri(A, R1, D);      // gable end, -X
    tri(B, C, R2);      // gable end, +X
  } else if (style === 'shed') {
    const Dh = [-hr, rise, hp], Ch = [hr, rise, hp]; // high edge at +Z
    quad(A, B, Ch, Dh); // single slope (low -Z → high +Z)
    tri(A, Dh, D);      // -X side (right triangle)
    tri(B, C, Ch);      // +X side
    quad(D, C, Ch, Dh); // back wall at +Z (vertical, fills under the high edge)
  } else { // hip → ridge inset by hp at both ends; square (hr==hp) collapses to a pyramid apex
    const rl = hr - hp;
    if (rl <= 1e-6) {
      const apex = [0, rise, 0];
      tri(A, B, apex); tri(B, C, apex); tri(C, D, apex); tri(D, A, apex);
    } else {
      const R1 = [-rl, rise, 0], R2 = [rl, rise, 0];
      quad(A, B, R2, R1); // -Z trapezoid slope
      quad(C, D, R1, R2); // +Z trapezoid slope
      tri(B, C, R2);      // +X hip end (triangle)
      tri(D, A, R1);      // -X hip end (triangle)
    }
  }
  return fromTris(t);
}
