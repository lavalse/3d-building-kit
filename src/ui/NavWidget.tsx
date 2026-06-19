import { useBuildStore } from '../store/useBuildStore';

/** On-screen camera controls (Tinkercad-style): zoom in/out + back to home view.
 *  Orbit is the gizmo (bottom-right) / right-drag. */
export function NavWidget() {
  const camera = useBuildStore((s) => s.camera);
  return (
    <div className="navwidget">
      <button onClick={() => camera.zoomIn?.()} title="放大">＋</button>
      <button onClick={() => camera.zoomOut?.()} title="缩小">－</button>
      <button onClick={() => camera.home?.()} title="回到主视角">⌂</button>
    </div>
  );
}
