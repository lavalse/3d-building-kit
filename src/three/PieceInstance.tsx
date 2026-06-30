import type { ThreeEvent } from '@react-three/fiber';
import type { Instance, PieceDef } from '../kit/types';
import { useBuildStore } from '../store/useBuildStore';
import { useKitModel } from './useKitModel';

/** One materialized piece. In the select tool, clicking a wall face selects it
 *  (Shift = add/remove). Only selectable pieces carry handlers, so non-selectable
 *  pieces never block clicks or cause hover flicker. The visual highlight lives in
 *  SelectionOverlay (outside the export group). */
export function PieceInstance({ inst, def, y }: { inst: Instance; def: PieceDef; y: number }) {
  const model = useKitModel(def.glb);
  const tool = useBuildStore((s) => s.tool);
  const selectFace = useBuildStore((s) => s.selectFace);
  const selectStair = useBuildStore((s) => s.selectStair);
  const setHovered = useBuildStore((s) => s.setHovered);

  // A piece is pickable in the select tool if it's a wall face or a stair.
  const faceKey = inst.faceKey ?? null;
  const stairKey = inst.stairKey ?? null;
  const hoverKey = faceKey ?? stairKey;
  const selectable = tool === 'select' && hoverKey !== null;

  const handlers = selectable
    ? {
        onClick: (e: ThreeEvent<MouseEvent>) => {
          e.stopPropagation();
          if (faceKey !== null) selectFace(faceKey, e.shiftKey);
          else selectStair(stairKey!);
        },
        onPointerOver: (e: ThreeEvent<PointerEvent>) => {
          e.stopPropagation();
          setHovered(hoverKey);
        },
        onPointerOut: () => setHovered(null),
      }
    : {};

  return (
    <group position={[inst.x, y, inst.z]} rotation={[0, inst.rotationY, 0]} {...handlers}>
      <primitive object={model} />
    </group>
  );
}
