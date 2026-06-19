import { Edges } from '@react-three/drei';
import { GRID } from '../kit/constants';

/** Translucent volume box previewing the space being defined (hover or drag).
 *  Cells are squares between grid lines; the box spans the rect in X/Z and one
 *  floor in height, sitting on the active level. */
export function CellPreview({
  ai,
  aj,
  bi,
  bj,
  y,
  height,
  mode,
}: {
  ai: number;
  aj: number;
  bi: number;
  bj: number;
  y: number;
  height: number;
  mode: 'space' | 'erase';
}) {
  const ci0 = Math.min(ai, bi);
  const ci1 = Math.max(ai, bi);
  const cj0 = Math.min(aj, bj);
  const cj1 = Math.max(aj, bj);

  const w = GRID * (ci1 - ci0 + 1);
  const d = GRID * (cj1 - cj0 + 1);
  const cx = GRID * ci0 + w / 2;
  const cz = GRID * cj0 + d / 2;
  const color = mode === 'erase' ? '#f6492f' : '#2f7df6';

  return (
    <mesh position={[cx, y + height / 2, cz]} raycast={() => null}>
      <boxGeometry args={[w - 0.04, height - 0.04, d - 0.04]} />
      <meshBasicMaterial color={color} transparent opacity={0.18} depthWrite={false} />
      <Edges threshold={15} color={color} />
    </mesh>
  );
}
