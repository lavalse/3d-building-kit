import type { ThreeEvent } from '@react-three/fiber';
import type { Instance, PieceDef } from '../kit/types';
import { useBuildStore } from '../store/useBuildStore';
import { useKitModel } from './useKitModel';

/** One materialized piece. In the select tool, clicking a wall face selects it
 *  (Shift = add/remove from a multi-selection); arrow keys then cycle the whole
 *  selection's style. Only selectable pieces carry handlers, so non-selectable
 *  pieces never block clicks or cause hover flicker. */
export function PieceInstance({ inst, def, y }: { inst: Instance; def: PieceDef; y: number }) {
  const model = useKitModel(def.glb);
  const tool = useBuildStore((s) => s.tool);
  const selectFace = useBuildStore((s) => s.selectFace);
  const setHovered = useBuildStore((s) => s.setHovered);

  const key = inst.faceKey ?? null;
  const selectable = tool === 'select' && key !== null;
  const hovered = useBuildStore((s) => (selectable ? s.hoveredKey === key : false));
  const selected = useBuildStore((s) => (key !== null && tool === 'select' ? s.selectedKeys.includes(key) : false));

  const handlers = selectable
    ? {
        onClick: (e: ThreeEvent<MouseEvent>) => {
          e.stopPropagation();
          selectFace(key!, e.shiftKey);
        },
        onPointerOver: (e: ThreeEvent<PointerEvent>) => {
          e.stopPropagation();
          setHovered(key);
        },
        onPointerOut: () => setHovered(null),
      }
    : {};

  const showBox = selected || hovered;
  const boxColor = selected ? '#ff9d2f' : '#ffe08a';

  return (
    <group position={[inst.x, y, inst.z]} rotation={[0, inst.rotationY, 0]} {...handlers}>
      <primitive object={model} />
      {showBox && (
        <mesh position={[0, def.size[1] / 2, 0]} raycast={() => null}>
          <boxGeometry args={[def.size[0] + 0.12, def.size[1] + 0.12, def.size[2] + 0.12]} />
          <meshBasicMaterial color={boxColor} wireframe />
        </mesh>
      )}
    </group>
  );
}
