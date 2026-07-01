import { Edges } from '@react-three/drei';
import { GRID } from '../kit/constants';
import type { CellMap } from '../kit/massing';

/** Ghost of a building being dragged with the move tool: one translucent box per
 *  moving column, spanning that column's vertical extent, shifted by (di,dj).
 *  Green = clear drop, amber = will overwrite the target (overwrite toggle on),
 *  red = would collide (blocked). */
export type MoveMode = 'ok' | 'overwrite' | 'blocked';

export function MovePreview({
  cells,
  cols,
  di,
  dj,
  floorHeight,
  mode,
}: {
  cells: CellMap;
  cols: string[];
  di: number;
  dj: number;
  floorHeight: number;
  mode: MoveMode;
}) {
  // Per-column vertical extent (min/max occupied level) across all floors.
  const ext: Record<string, { lo: number; hi: number }> = {};
  for (const k in cells) {
    const [lvl, i, j] = k.split(',').map(Number);
    const key = `${i},${j}`;
    if (!cols.includes(key)) continue;
    const e = ext[key];
    if (!e) ext[key] = { lo: lvl, hi: lvl };
    else { e.lo = Math.min(e.lo, lvl); e.hi = Math.max(e.hi, lvl); }
  }

  const color = mode === 'blocked' ? '#f6492f' : mode === 'overwrite' ? '#f2a33c' : '#22c55e';

  return (
    <>
      {Object.entries(ext).map(([key, e]) => {
        const [i, j] = key.split(',').map(Number);
        const ci = i + di;
        const cj = j + dj;
        const h = floorHeight * (e.hi - e.lo + 1);
        const y = floorHeight * e.lo;
        const cx = GRID * ci + GRID / 2;
        const cz = GRID * cj + GRID / 2;
        return (
          <mesh key={key} position={[cx, y + h / 2, cz]} raycast={() => null}>
            <boxGeometry args={[GRID - 0.04, h - 0.04, GRID - 0.04]} />
            <meshBasicMaterial color={color} transparent opacity={0.22} depthWrite={false} />
            <Edges threshold={15} color={color} />
          </mesh>
        );
      })}
    </>
  );
}
