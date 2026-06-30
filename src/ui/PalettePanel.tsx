import { useBuildStore } from '../store/useBuildStore';
import { PALETTE_CATS } from '../kit/palette';

/** Floating panel: one colour picker per semantic part (wall / frames / glass / door / roof /
 *  column shaft / column base / floor / stair tread / stair body). */
export function PalettePanel({ onClose }: { onClose: () => void }) {
  const palette = useBuildStore((s) => s.palette);
  const setPaletteColor = useBuildStore((s) => s.setPaletteColor);
  const resetPalette = useBuildStore((s) => s.resetPalette);

  return (
    <div className="palette-panel" style={panel}>
      <div style={head}>
        <span>配色</span>
        <button style={x} onClick={onClose} title="关闭">×</button>
      </div>
      {PALETTE_CATS.map((c) => (
        <label key={c.id} style={row}>
          <span>{c.label}</span>
          <input
            type="color"
            value={palette[c.id] ?? c.def}
            onChange={(e) => setPaletteColor(c.id, e.target.value)}
            style={{ ...swatch, outline: palette[c.id] ? '2px solid #2b6cff' : 'none' }}
          />
        </label>
      ))}
      <button style={reset} onClick={resetPalette}>重置为默认</button>
    </div>
  );
}

const panel: React.CSSProperties = {
  position: 'absolute', top: 56, right: 12, zIndex: 20, width: 184,
  background: 'rgba(20,28,40,0.95)', color: '#e8eef7', borderRadius: 10,
  padding: '10px 12px', boxShadow: '0 6px 24px rgba(0,0,0,0.35)', fontSize: 13,
};
const head: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontWeight: 600, marginBottom: 8 };
const x: React.CSSProperties = { background: 'none', border: 'none', color: '#9fb0c8', fontSize: 18, cursor: 'pointer', lineHeight: 1 };
const row: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '3px 0' };
const swatch: React.CSSProperties = { width: 38, height: 24, border: 'none', borderRadius: 4, background: 'none', cursor: 'pointer', padding: 0 };
const reset: React.CSSProperties = { marginTop: 8, width: '100%', padding: '5px 0', borderRadius: 6, border: '1px solid #3a4860', background: '#2a3650', color: '#e8eef7', cursor: 'pointer', fontSize: 12 };
