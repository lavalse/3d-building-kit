import { useMemo } from 'react';
import { Edges } from '@react-three/drei';
import { useBuildStore } from '../store/useBuildStore';
import { GRID, cellCenter } from '../kit/constants';

// Stable pastel colour per space id.
function colorOf(id: string): string {
  let h = 0;
  for (let k = 0; k < id.length; k++) h = (h * 31 + id.charCodeAt(k)) >>> 0;
  return `hsl(${h % 360}, 65%, 60%)`;
}

/** The "spatial language" view: each occupied cell as a translucent block,
 *  coloured by the space it belongs to. No kit assets. */
export function AbstractView() {
  const cells = useBuildStore((s) => s.cells);
  const floorHeight = useBuildStore((s) => s.floorHeight);

  const boxes = useMemo(
    () =>
      Object.entries(cells).map(([key, spaceId]) => {
        const [level, i, j] = key.split(',').map(Number);
        return {
          key,
          color: colorOf(spaceId),
          pos: [cellCenter(i), level * floorHeight + floorHeight / 2, cellCenter(j)] as [
            number,
            number,
            number,
          ],
        };
      }),
    [cells, floorHeight]
  );

  const size: [number, number, number] = [GRID - 0.06, floorHeight - 0.06, GRID - 0.06];

  return (
    <>
      {boxes.map((b) => (
        <mesh key={b.key} position={b.pos}>
          <boxGeometry args={size} />
          <meshStandardMaterial color={b.color} transparent opacity={0.5} />
          <Edges threshold={15} color="#1b2a44" />
        </mesh>
      ))}
    </>
  );
}
