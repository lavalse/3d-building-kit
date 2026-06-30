import { useRef, useState } from 'react';
import { useBuildStore } from '../store/useBuildStore';
import { PalettePanel } from './PalettePanel';

/** Slim top bar: app title + view / history / file / export. Drawing tools and
 *  the style palette live in the bottom floating ToolDock. */
export function Toolbar({ onExport }: { onExport: () => void }) {
  const abstractView = useBuildStore((s) => s.abstractView);
  const toggleAbstract = useBuildStore((s) => s.toggleAbstract);
  const undo = useBuildStore((s) => s.undo);
  const redo = useBuildStore((s) => s.redo);
  const canUndo = useBuildStore((s) => s.past.length > 0);
  const canRedo = useBuildStore((s) => s.future.length > 0);
  const clearAll = useBuildStore((s) => s.clearAll);
  const exportProject = useBuildStore((s) => s.exportProject);
  const importProject = useBuildStore((s) => s.importProject);

  const fileRef = useRef<HTMLInputElement>(null);
  const [showPalette, setShowPalette] = useState(false);

  const saveProject = () => {
    const blob = new Blob([exportProject()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'building-project.json';
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    f.text().then(importProject);
    e.target.value = '';
  };

  return (
    <div className="topbar">
      <div className="brand">🏠 3D 建筑套件</div>

      <div className="spacer" />

      <div className="group">
        <button className={abstractView ? 'active' : ''} onClick={toggleAbstract} title="切换 体块 / 成品 视图">
          {abstractView ? '体块' : '成品'}
        </button>
      </div>
      <div className="group">
        <button onClick={undo} disabled={!canUndo} title="撤销 (Ctrl+Z)">↶</button>
        <button onClick={redo} disabled={!canRedo} title="重做 (Ctrl+Y)">↷</button>
      </div>
      <div className="group">
        <button className={showPalette ? 'active' : ''} onClick={() => setShowPalette((v) => !v)} title="按大类统一配色">🎨 配色</button>
      </div>
      <div className="group">
        <button onClick={saveProject} title="导出工程 JSON">保存</button>
        <button onClick={() => fileRef.current?.click()} title="导入工程 JSON">读取</button>
        <input ref={fileRef} type="file" accept="application/json" hidden onChange={onFile} />
        <button onClick={() => confirm('清空全部？') && clearAll()}>清空</button>
      </div>
      <button className="export" onClick={onExport} title="导出整栋建筑为 GLB">⬇ 导出 GLB</button>
      {showPalette && <PalettePanel onClose={() => setShowPalette(false)} />}
    </div>
  );
}
