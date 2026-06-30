import { useBuildStore } from '../store/useBuildStore';
import type { FaceOverride, RoofStyle, SkinTheme, Tool } from '../kit/types';

const TOOLS: { id: Tool; label: string; icon: string }[] = [
  { id: 'select', label: '選択', icon: '🖱️' },
  { id: 'space', label: '空間', icon: '✏️' },
  { id: 'stair', label: '階段', icon: '🪜' },
  { id: 'roof', label: '屋根', icon: '🛖' },
  { id: 'erase', label: '消去', icon: '🧽' },
];

// Procedural roof styles for the roof tool / a selected roof.
const ROOF_STYLES: { id: RoofStyle; label: string; icon: string }[] = [
  { id: 'gable', label: '切妻', icon: '🔺' },
  { id: 'hip', label: '寄棟', icon: '⛰️' },
  { id: 'dome', label: 'ドーム', icon: '🔵' },
  { id: 'shed', label: '片流れ', icon: '📐' },
];

// Structural/enclosure type of a space (not a building program): full walls →
// waist-high parapet → bare frame.
const STYLES: { id: SkinTheme; label: string; icon: string }[] = [
  { id: 'enclosed', label: '閉鎖', icon: '🧱' },
  { id: 'semi', label: '半開放', icon: '🚧' },
  { id: 'open', label: '開放', icon: '🏛️' },
];

// Face actions for the selection (select tool). 'auto' clears the override.
const FACE_STYLES: { id: FaceOverride | 'auto'; label: string; icon: string }[] = [
  { id: 'window', label: '窓', icon: '🪟' },
  { id: 'door', label: 'ドア', icon: '🚪' },
  { id: 'wall', label: '壁', icon: '🧱' },
  { id: 'auto', label: '自動', icon: '↺' },
];

// Swappable stair models for a selected platform tower (all 2-cell, drop-in).
const STAIR_MODELS: { id: string; label: string; icon: string }[] = [
  { id: 'stairs-open', label: 'オープン', icon: '🪜' },
  { id: 'stairs-center', label: '中柱', icon: '🗼' },
  { id: 'stairs-closed', label: 'ソリッド', icon: '🧱' },
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
  const activeRoofStyle = useBuildStore((s) => s.activeRoofStyle);
  const setActiveRoofStyle = useBuildStore((s) => s.setActiveRoofStyle);
  const selectedRoofId = useBuildStore((s) => s.selectedRoofId);
  const setRoofStyle = useBuildStore((s) => s.setRoofStyle);
  const rotateRoof = useBuildStore((s) => s.rotateRoof);
  const removeRoof = useBuildStore((s) => s.removeRoof);
  const selRoofStyle = useBuildStore((s) =>
    selectedRoofId ? s.roofs.find((r) => r.id === selectedRoofId)?.style ?? null : null
  );
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
      ? 'ドラッグした矩形 = 1つの空間 · 既存の上に描き直すとスタイル変更'
      : tool === 'stair'
        ? 'ドアのある階へ · ドアの外側にプラットフォームを置くと階段が壁沿いに地面まで降りる · 室内階段は自動('
          + (autoStairs ? 'オン・別案' : 'オフ') + ')'
        : tool === 'roof'
          ? '建物の最上階(またはその上の階)で屋根の範囲をドラッグ → 屋根を生成 · 右でスタイル選択(切妻/寄棟/ドーム/片流れ)'
          : tool === 'erase'
            ? 'ドラッグした矩形のセルを消去(中の階段も)'
            : selectedStairId
              ? '階段を選択中 · 削除'
              : selectedRoofId
                ? '屋根を選択中 · スタイル変更 / 回転 / 削除'
                : selCount > 0
                  ? `${selCount} 面を選択中 · 窓/ドア/壁を選択 · 隣り合う2面を同じにすると自動で横長に`
                  : '壁/階段/屋根をクリックで選択(壁は Shift で複数選択)';

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
                title="ドア/入口に合わせて階段を自動配置"
              >
                <span className="dock-icon">🤖</span>
                <span className="dock-label">自動</span>
              </button>
              <button
                className="chip"
                onClick={rerollStairs}
                disabled={!autoStairs}
                title="別の自動配置にする"
              >
                <span className="dock-icon">🎲</span>
                <span className="dock-label">別案</span>
              </button>
            </div>
          </>
        )}

        {tool === 'roof' && (
          <>
            <div className="dock-divider" />
            <div className="dock-group">
              {ROOF_STYLES.map((r) => (
                <button
                  key={r.id}
                  className={'chip' + (activeRoofStyle === r.id ? ' active' : '')}
                  onClick={() => setActiveRoofStyle(r.id)}
                  title={`屋根スタイル:${r.label}`}
                >
                  <span className="dock-icon">{r.icon}</span>
                  <span className="dock-label">{r.label}</span>
                </button>
              ))}
            </div>
          </>
        )}

        {tool === 'select' && selectedRoofId && (
          <>
            <div className="dock-divider" />
            <div className="dock-group">
              {ROOF_STYLES.map((r) => (
                <button
                  key={r.id}
                  className={'chip' + (selRoofStyle === r.id ? ' active' : '')}
                  onClick={() => setRoofStyle(selectedRoofId, r.id)}
                  title={`屋根スタイル:${r.label}`}
                >
                  <span className="dock-icon">{r.icon}</span>
                  <span className="dock-label">{r.label}</span>
                </button>
              ))}
              <button className="chip" onClick={() => rotateRoof(selectedRoofId)} title="棟/勾配の向きを回転(切妻・片流れ)">
                <span className="dock-icon">🔄</span>
                <span className="dock-label">回転</span>
              </button>
              <button className="chip" onClick={() => removeRoof(selectedRoofId)} title="この屋根を削除">
                <span className="dock-icon">🗑️</span>
                <span className="dock-label">削除</span>
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
                    title={`階段スタイル:${m.label}`}
                  >
                    <span className="dock-icon">{m.icon}</span>
                    <span className="dock-label">{m.label}</span>
                  </button>
                ))}
              {platformKey && (
                <button className="chip" onClick={() => rotatePlatformDir(platformKey)} title="下り方向を回転(4辺を循環)">
                  <span className="dock-icon">🔄</span>
                  <span className="dock-label">回転</span>
                </button>
              )}
              <button className="chip" onClick={() => removeStair(selectedStairId)} title="この階段を削除">
                <span className="dock-icon">🗑️</span>
                <span className="dock-label">削除</span>
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
