import { useMemo } from 'react';
import { Edges } from '@react-three/drei';
import { useBuildStore, pieceY } from '../store/useBuildStore';

/** Selection / hover highlight for wall faces. Rendered OUTSIDE the export group
 *  (so it never goes into the GLB) as a translucent box + clean edges — no raw
 *  wireframe triangulation. */
export function SelectionOverlay() {
  const tool = useBuildStore((s) => s.tool);
  const instances = useBuildStore((s) => s.instances);
  const pieces = useBuildStore((s) => s.pieces);
  const floorHeight = useBuildStore((s) => s.floorHeight);
  const hoveredKey = useBuildStore((s) => s.hoveredKey);
  const selectedKeys = useBuildStore((s) => s.selectedKeys);
  const selectedStairId = useBuildStore((s) => s.selectedStairId);

  const byId = useMemo(() => new Map(pieces.map((p) => [p.id, p])), [pieces]);
  const selectedSet = useMemo(() => new Set(selectedKeys), [selectedKeys]);

  // Shown in the select tool (selection + hover) and the stair tool (hover only, to
  // highlight the wall face a click would snap a landing platform to).
  if (tool !== 'select' && tool !== 'stair') return null;

  return (
    <>
      {instances.map((inst) => {
        // Pickable pieces: wall faces (faceKey) and stairs (stairKey).
        const key = inst.faceKey ?? inst.stairKey ?? null;
        if (!key) return null;
        const sel = inst.faceKey ? selectedSet.has(inst.faceKey) : inst.stairKey === selectedStairId;
        const hov = !sel && key === hoveredKey;
        if (!sel && !hov) return null;
        const def = byId.get(inst.pieceId);
        if (!def) return null;
        const [sx, sy, sz] = def.size;
        const m = 0.08;
        return (
          <mesh
            key={inst.id}
            position={[inst.x, pieceY(inst, floorHeight) + sy / 2, inst.z]}
            rotation={[0, inst.rotationY, 0]}
            raycast={() => null}
          >
            <boxGeometry args={[sx + m, sy + m, sz + m]} />
            <meshBasicMaterial
              color="#2f7df6"
              transparent
              opacity={sel ? 0.22 : 0}
              depthWrite={false}
            />
            <Edges threshold={15} color={sel ? '#7db4ff' : '#9fc4ff'} />
          </mesh>
        );
      })}
    </>
  );
}
