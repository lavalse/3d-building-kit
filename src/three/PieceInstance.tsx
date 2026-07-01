import { useLayoutEffect } from 'react';
import * as THREE from 'three';
import type { ThreeEvent } from '@react-three/fiber';
import type { Instance, PieceDef } from '../kit/types';
import { useBuildStore } from '../store/useBuildStore';
import { useKitModel } from './useKitModel';
import { pieceCategory } from '../kit/palette';
import { surfaceEdgeLanding } from '../kit/pickLevel';
import { ensurePixels, bakeGeometry, recolorGeometry } from './paletteBake';

/** One materialized piece. In the select tool, clicking a wall face selects it
 *  (Shift = add/remove). Only selectable pieces carry handlers, so non-selectable
 *  pieces never block clicks or cause hover flicker. The visual highlight lives in
 *  SelectionOverlay (outside the export group). */
export function PieceInstance({ inst, def, y }: { inst: Instance; def: PieceDef; y: number }) {
  const model = useKitModel(def.glb);
  const tool = useBuildStore((s) => s.tool);
  const palette = useBuildStore((s) => s.palette);
  const selectFace = useBuildStore((s) => s.selectFace);
  const selectStair = useBuildStore((s) => s.selectStair);
  const addPlatformAtFace = useBuildStore((s) => s.addPlatformAtFace);
  const addPlatformAtSurfaceEdge = useBuildStore((s) => s.addPlatformAtSurfaceEdge);
  const setStairLanding = useBuildStore((s) => s.setStairLanding);
  const setHovered = useBuildStore((s) => s.setHovered);

  // Recolour: bake the palette texture into per-vertex semantic categories (once per shared
  // geometry), switch the colormap material to vertex-colour mode (in place → all clones
  // follow), then recolour by category. The clone shares its source GLB's geometry + materials,
  // so this applies uniformly; a geometry signature dedupes the recolour work. The `glass`
  // material is recoloured in place (restores its original kit colour when unset).
  useLayoutEffect(() => {
    if (!ensurePixels(model)) return;
    const cat = pieceCategory(inst.pieceId);
    const sig = JSON.stringify(palette);
    model.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mat = mesh.material as THREE.MeshStandardMaterial;
      if (!mat) return;
      if (mat.name === 'glass') {
        if (!mat.userData.og) mat.userData.og = mat.color.clone();
        if (palette.glass) mat.color.set(palette.glass);
        else mat.color.copy(mat.userData.og as THREE.Color);
        return;
      }
      if (!mat.userData.vc) { mat.vertexColors = true; mat.map = null; mat.color.set('#ffffff'); mat.needsUpdate = true; mat.userData.vc = true; }
      bakeGeometry(mesh.geometry, cat);
      if (mesh.geometry.userData.coloredFor !== sig) {
        recolorGeometry(mesh.geometry, palette);
        mesh.geometry.userData.coloredFor = sig;
      }
    });
  }, [model, palette, inst.pieceId]);

  // Pickable in the select tool (wall face or stair); in the stair tool an exterior
  // wall face OR a walkable surface (floor/roof) is pickable → snaps a landing platform.
  const faceKey = inst.faceKey ?? null;
  const stairKey = inst.stairKey ?? null;
  const surfaceKey = inst.surfaceKey ?? null;
  const hoverKey = faceKey ?? stairKey;
  const selectable = tool === 'select' && hoverKey !== null;
  const stairFacePick = tool === 'stair' && faceKey !== null;
  const stairSurfacePick = tool === 'stair' && faceKey === null && surfaceKey !== null;

  const handlers =
    selectable || stairFacePick || stairSurfacePick
      ? {
          // Consume the left-button press so it doesn't fall through to the GroundPlane
          // behind this piece. Without this, in the stair tool pressing on a wall/surface
          // ALSO triggers GroundPlane's pointerdown → a second platform on the ground
          // behind the wall (onClick's stopPropagation can't stop pointerdown/up).
          onPointerDown: (e: ThreeEvent<PointerEvent>) => { if (e.button === 0) e.stopPropagation(); },
          onClick: (e: ThreeEvent<MouseEvent>) => {
            e.stopPropagation();
            if (stairSurfacePick) addPlatformAtSurfaceEdge(surfaceKey!, e.point.x, e.point.z);
            else if (stairFacePick) addPlatformAtFace(faceKey!);
            else if (faceKey !== null) selectFace(faceKey, e.shiftKey);
            else selectStair(stairKey!);
          },
          onPointerMove: stairSurfacePick
            ? (e: ThreeEvent<PointerEvent>) => {
                e.stopPropagation();
                setStairLanding(surfaceEdgeLanding(useBuildStore.getState().cells, surfaceKey!, e.point.x, e.point.z));
              }
            : undefined,
          onPointerOver: (e: ThreeEvent<PointerEvent>) => {
            e.stopPropagation();
            if (stairSurfacePick) setStairLanding(surfaceEdgeLanding(useBuildStore.getState().cells, surfaceKey!, e.point.x, e.point.z));
            else setHovered(stairFacePick ? faceKey : hoverKey);
          },
          onPointerOut: () => { setHovered(null); if (stairSurfacePick) setStairLanding(null); },
        }
      : {};

  return (
    <group position={[inst.x, y, inst.z]} rotation={[0, inst.rotationY, 0]} {...handlers}>
      <primitive object={model} />
    </group>
  );
}
