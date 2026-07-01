import { Canvas, useThree } from '@react-three/fiber';
import { Grid, OrbitControls, GizmoHelper, GizmoViewport } from '@react-three/drei';
import * as THREE from 'three';
import { forwardRef, Suspense, useEffect } from 'react';
import { useBuildStore } from '../store/useBuildStore';
import { GRID } from '../kit/constants';
import { GroundPlane } from './GroundPlane';
import { PlacedPieces } from './PlacedPieces';
import { ProceduralRoofs } from './ProceduralRoofs';
import { AbstractView } from './AbstractView';
import { SelectionOverlay } from './SelectionOverlay';
import { SpaceFieldOverlay } from './SpaceFieldOverlay';
import { MoveGizmo } from './MoveGizmo';

/** Bridges the on-screen NavWidget buttons to the live OrbitControls.
 *  Zoom uses only stable public state (camera.position + controls.target),
 *  not the version-private _dollyIn/_dollyOut. */
function CameraBridge() {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as
    | (THREE.EventDispatcher & { target?: THREE.Vector3; update?: () => void; reset?: () => void })
    | null;
  const setCamera = useBuildStore((s) => s.setCamera);
  useEffect(() => {
    if (!controls) return;
    const zoom = (factor: number) => {
      const t = controls.target ?? new THREE.Vector3();
      camera.position.sub(t).multiplyScalar(factor).add(t);
      controls.update?.();
    };
    setCamera({
      zoomIn: () => zoom(0.8), // 20% closer
      zoomOut: () => zoom(1.25), // 25% farther
      home: () => controls.reset?.(),
    });
    return () => setCamera({});
  }, [camera, controls, setCamera]);
  return null;
}

/** The 3D viewport: camera, controls, lights, grid, build surface, building. */
export const Scene = forwardRef<THREE.Group>(function Scene(_props, exportRef) {
  const activeLevel = useBuildStore((s) => s.activeLevel);
  const floorHeight = useBuildStore((s) => s.floorHeight);
  const abstractView = useBuildStore((s) => s.abstractView);

  const tool = useBuildStore((s) => s.tool);
  const cells = useBuildStore((s) => s.cells);
  const selectedCols = useBuildStore((s) => s.selectedCols);
  const hoverLevel = useBuildStore((s) => s.hoverLevel);
  // The space/roof/erase tools resolve their level from the surface under the cursor, so
  // the floating grid follows that resolved level; other tools stay on the active level.
  const gridLevel = (tool === 'space' || tool === 'roof' || tool === 'erase') && hoverLevel != null ? hoverLevel : activeLevel;
  const gridY = gridLevel * floorHeight;

  // Fixed Tinkercad/builder convention — SAME in every tool, never swaps:
  // left = the active tool (drawing, handled by GroundPlane; disabled for orbit),
  // right-drag = orbit, middle-drag = pan, wheel = zoom.
  const mouseButtons = {
    LEFT: undefined as unknown as THREE.MOUSE,
    MIDDLE: THREE.MOUSE.PAN,
    RIGHT: THREE.MOUSE.ROTATE,
  };

  return (
    <Canvas
      shadows
      camera={{ position: [18, 16, 18], fov: 45, near: 0.5, far: 400 }}
      style={{ cursor: tool === 'select' ? 'default' : 'crosshair' }}
      onPointerMissed={() => useBuildStore.getState().clearSelection()}
    >
      <color attach="background" args={['#dce6f2']} />
      <hemisphereLight args={['#ffffff', '#8d99ae', 0.9]} />
      {/* Sun */}
      <directionalLight
        position={[28, 40, 16]}
        intensity={2.0}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0004}
        shadow-camera-left={-60}
        shadow-camera-right={60}
        shadow-camera-top={60}
        shadow-camera-bottom={-60}
      />

      {/* Fixed ground — a constant reference + catches the building's shadow.
          Sits just below the floor tiles and uses polygonOffset so the grid drawn
          on top of it never z-fights (CAD-style "ground carries the grid"). */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.1, 0]} receiveShadow>
        <planeGeometry args={[600, 600]} />
        <meshStandardMaterial color="#c4cedd" polygonOffset polygonOffsetFactor={2} polygonOffsetUnits={2} />
      </mesh>

      {/* Ground grid (always at y=0, faint) — the world baseline. */}
      <Grid
        position={[0, 0, 0]}
        args={[200, 200]}
        cellSize={GRID}
        cellThickness={0.6}
        cellColor="#aab6c9"
        sectionSize={GRID * 5}
        sectionThickness={1}
        sectionColor="#8190a8"
        fadeDistance={160}
        fadeStrength={1}
        infiniteGrid
        followCamera={false}
      />

      {/* Active drawing grid — accent colour, floating at the active level so it's clear
          which height you're building on. Only a DRAWING aid: hidden on the ground floor,
          and hidden in select mode (where it just clutters picking — selection is per-object,
          not per-level). The faint ground baseline grid above stays as a reference. */}
      {gridLevel > 0 && tool !== 'select' && tool !== 'move' && (
        <Grid
          position={[0, gridY + 0.02, 0]}
          args={[200, 200]}
          cellSize={GRID}
          cellThickness={1}
          cellColor="#2f7df6"
          sectionSize={GRID * 5}
          sectionThickness={1.6}
          sectionColor="#2f7df6"
          fadeDistance={120}
          fadeStrength={1}
          infiniteGrid
          followCamera={false}
        />
      )}

      <GroundPlane />

      {/* Finished building — always mounted (export reads this group); hidden in abstract view.
          Wrapped in Suspense so a GLB still loading only blanks the building subtree (the
          ground/grid/lights/camera stay) — never the whole canvas. */}
      <Suspense fallback={null}>
        <group ref={exportRef} visible={!abstractView}>
          <PlacedPieces />
          <ProceduralRoofs />
        </group>
      </Suspense>
      {abstractView && <AbstractView />}

      {/* Selection/hover highlight — OUTSIDE the export group so it never goes into the GLB. */}
      {!abstractView && <SelectionOverlay />}

      {/* Move tool: barrier-field highlight of the marquee column-selection + its 3D handle. */}
      {tool === 'move' && selectedCols.length > 0 && (
        <>
          <SpaceFieldOverlay cols={selectedCols} />
          <MoveGizmo cells={cells} cols={selectedCols} floorHeight={floorHeight} />
        </>
      )}

      <OrbitControls
        makeDefault
        mouseButtons={mouseButtons}
        maxPolarAngle={Math.PI / 2.05}
        keyEvents={false} /* arrow keys cycle the selection, not pan the camera */
      />
      <CameraBridge />
      <GizmoHelper alignment="bottom-right" margin={[72, 88]}>
        <GizmoViewport axisColors={['#e0564f', '#4caf50', '#2f7df6']} labelColor="#fff" />
      </GizmoHelper>
    </Canvas>
  );
});
