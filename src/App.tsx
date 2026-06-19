import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { Scene } from './three/Scene';
import { Toolbar } from './ui/Toolbar';
import { FloorStrip } from './ui/FloorStrip';
import { NavWidget } from './ui/NavWidget';
import { exportSceneToGLB } from './three/exportGLB';
import { useManifest } from './kit/useManifest';
import { useBuildStore } from './store/useBuildStore';

export default function App() {
  const { pieces, error } = useManifest();
  const setPieces = useBuildStore((s) => s.setPieces);
  const tool = useBuildStore((s) => s.tool);
  const setTool = useBuildStore((s) => s.setTool);
  const exportRef = useRef<THREE.Group>(null);

  useEffect(() => {
    if (pieces) setPieces(pieces);
  }, [pieces, setPieces]);

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
      // Arrow keys cycle the selected wall faces' style (select tool).
      if (s.tool === 'select' && s.selectedKeys.length) {
        if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
          e.preventDefault();
          s.cycleSelection(1);
          return;
        }
        if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
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
          {pieces && tool !== 'select' && (
            <div className={'draw-banner' + (tool === 'erase' ? ' erase' : '')}>
              {tool === 'space' ? '画空间中' : '擦除中'} · 左键拖动{tool === 'space' ? '画' : '擦'} · 右键转视角 ·
              <button onClick={() => setTool('select')}>完成 (Esc)</button>
            </div>
          )}
        </div>
      </div>
      <div className="hint">
        相机：<b>右键拖</b>转视角 · <b>中键拖</b>平移 · <b>滚轮</b>缩放 · 右下角导航控件（任何工具都一样）｜
        <b>选择</b>点墙切换 实墙/窗/门 ｜ <b>画空间/擦除</b>左键拖动 ｜ 左侧切楼层 · <b>Tab</b> 体块/成品
      </div>
    </div>
  );
}
