import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { useGLTF, useProgress } from '@react-three/drei';
import { Scene } from './three/Scene';
import { Toolbar } from './ui/Toolbar';
import { ToolDock } from './ui/ToolDock';
import { FloorStrip } from './ui/FloorStrip';
import { NavWidget } from './ui/NavWidget';
import { exportSceneToGLB } from './three/exportGLB';
import { useManifest } from './kit/useManifest';
import { useBuildStore } from './store/useBuildStore';

export default function App() {
  const { pieces, error } = useManifest();
  const setPieces = useBuildStore((s) => s.setPieces);
  const exportRef = useRef<THREE.Group>(null);

  useEffect(() => {
    if (pieces) setPieces(pieces);
  }, [pieces, setPieces]);

  // Warm the GLB cache in the background once the manifest loads, so the first time
  // a piece type appears it's already loaded — no mid-edit suspend / black flash.
  useEffect(() => {
    pieces?.forEach((p) => useGLTF.preload(p.glb));
  }, [pieces]);

  useEffect(() => {
    if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).useBuildStore = useBuildStore;
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useBuildStore.getState();
      if ((e.target as HTMLElement)?.tagName?.match(/INPUT|TEXTAREA|SELECT/)) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) s.redo();
        else s.undo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        s.redo();
        return;
      }
      // Delete/Backspace removes the selected stair.
      if (s.selectedStairId && (e.key === 'Delete' || e.key === 'Backspace')) {
        e.preventDefault();
        s.removeStair(s.selectedStairId);
        return;
      }
      // Up/Down = floor navigation (high-frequency); Left/Right = cycle the
      // selected wall faces' style (select tool).
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        s.stepLevel(1);
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        s.stepLevel(-1);
        return;
      }
      if (s.tool === 'select' && s.selectedKeys.length) {
        if (e.key === 'ArrowRight') {
          e.preventDefault();
          s.cycleSelection(1);
          return;
        }
        if (e.key === 'ArrowLeft') {
          e.preventDefault();
          s.cycleSelection(-1);
          return;
        }
      }
      switch (e.key.toLowerCase()) {
        case 'escape':
          s.clearSelection();
          s.setTool('select');
          break;
        case 'v':
          s.setTool('select');
          break;
        case 's':
          s.setTool('space');
          break;
        case 'e':
          s.setTool('erase');
          break;
        case 't':
          s.setTool('stair');
          break;
        case 'tab':
          e.preventDefault();
          s.toggleAbstract();
          break;
        case ']':
          s.setActiveLevel(s.activeLevel + 1);
          break;
        case '[':
          s.setActiveLevel(s.activeLevel - 1);
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const handleExport = () => {
    if (exportRef.current) exportSceneToGLB(exportRef.current);
  };

  if (error) {
    return (
      <div className="loading">
        无法加载素材清单：{error}
        <br />
        请先运行 <code>node scripts/build-kit.mjs</code>
      </div>
    );
  }

  return (
    <div className="app">
      <Toolbar onExport={handleExport} />
      <div className="main">
        <div className="canvas-wrap">
          {pieces ? <Scene ref={exportRef} /> : <div className="loading">加载素材中…</div>}
          {pieces && <FloorStrip />}
          {pieces && <NavWidget />}
          {pieces && <ToolDock />}
          <ModelLoadingBadge />
        </div>
      </div>
    </div>
  );
}

/** Non-blocking corner badge shown while kit models are loading (drei tracks
 *  useGLTF via its loading manager), so a first-load wait reads as progress,
 *  not a frozen/black screen. */
function ModelLoadingBadge() {
  const { active, progress } = useProgress();
  if (!active) return null;
  return <div className="model-loading">加载模型 {Math.round(progress)}%</div>;
}
