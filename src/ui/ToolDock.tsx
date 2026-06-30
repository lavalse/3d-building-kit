import { useBuildStore } from '../store/useBuildStore';
import type { FaceOverride, SkinTheme, Tool } from '../kit/types';

const TOOLS: { id: Tool; label: string; icon: string }[] = [
  { id: 'select', label: '选择', icon: '🖱️' },
  { id: 'space', label: '画空间', icon: '✏️' },
  { id: 'stair', label: '楼梯', icon: '🪜' },
  { id: 'erase', label: '擦除', icon: '🧽' },
];

// Structural/enclosure type of a space (not a building program): full walls →
// waist-high parapet → bare frame.
const STYLES: { id: SkinTheme; label: string; icon: string }[] = [
  { id: 'enclosed', label: '封闭', icon: '🧱' },
  { id: 'semi', label: '半开放', icon: '🚧' },
  { id: 'open', label: '开放', icon: '🏛️' },
];

// Face actions for the selection (select tool). 'auto' clears the override.
const FACE_STYLES: { id: FaceOverride | 'auto'; label: string; icon: string }[] = [
  { id: 'window', label: '窗', icon: '🪟' },
  { id: 'door', label: '门', icon: '🚪' },
  { id: 'wall', label: '实墙', icon: '🧱' },
  { id: 'auto', label: '自动', icon: '↺' },
];

// Swappable stair models for a selected platform tower (all 2-cell, drop-in).
const STAIR_MODELS: { id: string; label: string; icon: string }[] = [
  { id: 'stairs-open', label: '开放', icon: '🪜' },
  { id: 'stairs-center', label: '中柱', icon: '🗼' },
  { id: 'stairs-closed', label: '实心', icon: '🧱' },
];

/** Bottom-center floating dock (game quick-build style). Tools + a context panel:
 *  Draw → style brush (house/pavilion/open); Select(with selection) → face
 *  actions (window/door/wall/auto) applied to the whole selection. */
export function ToolDock() {
  const tool = useBuildStore((s) => s.tool);
  const setTool = useBuildStore((s) => s.setTool);
  const activeStyle = useBuildStore((s) => s.activeStyle);
  const setActiveStyle = useBuildStore((s) => s.setActiveStyle);
  const setSelectionStyle = useBuildStore((s) => s.setSelectionStyle);
  const selCount = useBuildStore((s) => s.selectedKeys.length);
  const selectedStairId = useBuildStore((s) => s.selectedStairId);
  const removeStair = useBuildStore((s) => s.removeStair);
  const setPlatformModel = useBuildStore((s) => s.setPlatformModel);
  const rotatePlatformDir = useBuildStore((s) => s.rotatePlatformDir);
  const autoStairs = useBuildStore((s) => s.circulation.auto);
  const rerollStairs = useBuildStore((s) => s.rerollStairs);
  const toggleAutoStairs = useBuildStore((s) => s.toggleAutoStairs);
  // The selected stair's current model (only platform towers carry one).
  const platformKey = selectedStairId?.startsWith('platform:') ? selectedStairId.slice('platform:'.length) : null;
  const selModel = useBuildStore((s) => (platformKey ? s.circulation.platformModel[platformKey] ?? 'stairs-open' : null));
  // Common face style across the selection (null = mixed / none).
  const selKind = useBuildStore((s) => {
    if (!s.selectedKeys.length) return null;
    const vals = s.selectedKeys.map((k) => s.faceOverrides[k] ?? 'auto');
    return vals.every((v) => v === vals[0]) ? vals[0] : null;
  });

  const hint =
    tool === 'space'
      ? '拖一个矩形 = 一个空间 · 在已有处重画即可改风格'
      : tool === 'stair'
        ? '上到门所在层 · 在门外侧点一块平台 → 楼梯自动贴墙接到地面 · 室内楼梯自动('
          + (autoStairs ? '开·换一个' : '关') + ')'
        : tool === 'erase'
          ? '拖矩形擦掉格子（含其中的楼梯）'
          : selectedStairId
            ? '已选楼梯 · 删除'
            : selCount > 0
              ? `已选 ${selCount} 面 · 选 窗/门/实墙 · 相邻两块设同款 = 自动变宽`
              : '点墙或楼梯选中（墙可 Shift 多选）';

  return (
    <div className="tooldock-wrap">
      <div className="dock-hint">{hint}</div>
      <div className="tooldock">
        <div className="dock-group">
          {TOOLS.map((t) => (
            <button
              key={t.id}
              className={'dock-btn' + (tool === t.id ? ' active' : '')}
              onClick={() => setTool(t.id)}
              title={t.label}
            >
              <span className="dock-icon">{t.icon}</span>
              <span className="dock-label">{t.label}</span>
            </button>
          ))}
        </div>

        {tool === 'space' && (
          <>
            <div className="dock-divider" />
            <div className="dock-group">
              {STYLES.map((s) => (
                <button
                  key={s.id}
                  className={'chip' + (activeStyle === s.id ? ' active' : '')}
                  onClick={() => setActiveStyle(s.id)}
                  title={s.label}
                >
                  <span className="dock-icon">{s.icon}</span>
                  <span className="dock-label">{s.label}</span>
                </button>
              ))}
            </div>
          </>
        )}

        {tool === 'stair' && (
          <>
            <div className="dock-divider" />
            <div className="dock-group">
              <button
                className={'chip' + (autoStairs ? ' active' : '')}
                onClick={toggleAutoStairs}
                title="自动布置楼梯（随门/入口）"
              >
                <span className="dock-icon">🤖</span>
                <span className="dock-label">自动</span>
              </button>
              <button
                className="chip"
                onClick={rerollStairs}
                disabled={!autoStairs}
                title="换一个自动布置方案"
              >
                <span className="dock-icon">🎲</span>
                <span className="dock-label">换一个</span>
              </button>
            </div>
          </>
        )}

        {tool === 'select' && selectedStairId && (
          <>
            <div className="dock-divider" />
            <div className="dock-group">
              {/* Platform towers: swap model + rotate which edge it descends. */}
              {platformKey &&
                STAIR_MODELS.map((m) => (
                  <button
                    key={m.id}
                    className={'chip' + (selModel === m.id ? ' active' : '')}
                    onClick={() => setPlatformModel(platformKey, m.id)}
                    title={`楼梯样式：${m.label}`}
                  >
                    <span className="dock-icon">{m.icon}</span>
                    <span className="dock-label">{m.label}</span>
                  </button>
                ))}
              {platformKey && (
                <button className="chip" onClick={() => rotatePlatformDir(platformKey)} title="旋转下行方向(循环四条边)">
                  <span className="dock-icon">🔄</span>
                  <span className="dock-label">旋转</span>
                </button>
              )}
              <button className="chip" onClick={() => removeStair(selectedStairId)} title="删除这部楼梯">
                <span className="dock-icon">🗑️</span>
                <span className="dock-label">删除</span>
              </button>
            </div>
          </>
        )}

        {tool === 'select' && !selectedStairId && selCount > 0 && (
          <>
            <div className="dock-divider" />
            <div className="dock-group">
              {FACE_STYLES.map((f) => (
                <button
                  key={f.id}
                  className={'chip face' + (selKind === f.id ? ' active' : '')}
                  onClick={() => setSelectionStyle(f.id)}
                  title={f.label}
                >
                  <span className="dock-icon">{f.icon}</span>
                  <span className="dock-label">{f.label}</span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
