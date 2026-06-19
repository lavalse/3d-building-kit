import { useRef } from 'react';
import { useBuildStore } from '../store/useBuildStore';
import type { SkinTheme, Tool } from '../kit/types';

const TOOLS: { id: Tool; label: string; icon: string }[] = [
  { id: 'select', label: '选择', icon: '➦' },
  { id: 'space', label: '画空间', icon: '▦' },
  { id: 'erase', label: '擦除', icon: '⌫' },
];

const THEMES: { id: SkinTheme; label: string }[] = [
  { id: 'house', label: '住宅' },
  { id: 'pavilion', label: '亭子(柱+顶)' },
  { id: 'open', label: '开放(只地板+顶)' },
];

export function Toolbar({ onExport }: { onExport: () => void }) {
  const tool = useBuildStore((s) => s.tool);
  const setTool = useBuildStore((s) => s.setTool);
  const activeLevel = useBuildStore((s) => s.activeLevel);
  const theme = useBuildStore((s) => s.themeByLevel[activeLevel] ?? 'house');
  const setTheme = useBuildStore((s) => s.setTheme);
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
    <div className="toolbar">
      <div className="group modes">
        {TOOLS.map((t) => (
          <button key={t.id} className={tool === t.id ? 'active' : ''} onClick={() => setTool(t.id)}>
            <span className="icon">{t.icon}</span>
            {t.label}
          </button>
        ))}
      </div>

      <div className="group">
        <label>{activeLevel + 1}层风格</label>
        <select value={theme} onChange={(e) => setTheme(e.target.value as SkinTheme)}>
          {THEMES.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
      </div>

      <div className="group">
        <button className={abstractView ? 'active' : ''} onClick={toggleAbstract} title="切换抽象体块/成品">
          {abstractView ? '体块' : '成品'}
        </button>
      </div>

      <div className="group">
        <button onClick={undo} disabled={!canUndo} title="撤销 (Ctrl+Z)">↶</button>
        <button onClick={redo} disabled={!canRedo} title="重做 (Ctrl+Y)">↷</button>
      </div>

      <div className="spacer" />

      <div className="group">
        <button onClick={saveProject} title="导出工程 JSON">保存</button>
        <button onClick={() => fileRef.current?.click()} title="导入工程 JSON">读取</button>
        <input ref={fileRef} type="file" accept="application/json" hidden onChange={onFile} />
        <button onClick={() => confirm('清空全部？') && clearAll()}>清空</button>
      </div>

      <button className="export" onClick={onExport} title="导出整栋建筑为 GLB">⬇ 导出 GLB</button>
    </div>
  );
}
