import { useBuildStore } from '../store/useBuildStore';

/** On-screen camera controls (Tinkercad-style): zoom in/out + back to home view.
 *  Orbit is the gizmo (bottom-right) / right-drag. */
export function NavWidget() {
  const camera = useBuildStore((s) => s.camera);
  return (
    <div className="navwidget">
      <button onClick={() => camera.zoomIn?.()} title="ズームイン">＋</button>
      <button onClick={() => camera.zoomOut?.()} title="ズームアウト">－</button>
      <button onClick={() => camera.home?.()} title="初期視点に戻す">⌂</button>
    </div>
  );
}
