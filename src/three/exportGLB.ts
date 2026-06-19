import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';

/** Export the given group (the placed-pieces group) to a single binary GLB and
 *  trigger a browser download. Helper/grid/ghost objects live outside this group
 *  so they are never included. */
export function exportSceneToGLB(group: THREE.Object3D, filename = 'building.glb') {
  const exporter = new GLTFExporter();
  // The group may be hidden (abstract view); export the finished building regardless.
  const wasVisible = group.visible;
  group.visible = true;

  // Recenter on X/Z so the exported model's pivot is at its center (rotation in
  // other apps stays on-axis). Keep Y so the bottom rests at the ground (y≈0).
  const prevPos = group.position.clone();
  const box = new THREE.Box3().setFromObject(group);
  if (!box.isEmpty()) {
    const c = box.getCenter(new THREE.Vector3());
    group.position.set(prevPos.x - c.x, prevPos.y, prevPos.z - c.z);
    group.updateMatrixWorld(true);
  }

  const restore = () => {
    group.visible = wasVisible;
    group.position.copy(prevPos);
    group.updateMatrixWorld(true);
  };
  exporter.parse(
    group,
    (result) => {
      restore();
      const blob = new Blob([result as ArrayBuffer], { type: 'model/gltf-binary' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    },
    (err) => {
      restore();
      console.error('GLB export failed', err);
      alert('Export failed — see console.');
    },
    { binary: true, onlyVisible: true }
  );
}
