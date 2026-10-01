// Keeping the sea out of open boats. The ocean is one surface: wherever a boat's hull dips below the waves,
// the water would be drawn inside it. Each open boat gets an invisible lid stretched across its gunwales that
// writes only depth; it is drawn after the boat and its crew but before the sea, so the sea can't be seen
// through the opening, while everything already drawn inside the boat stays visible.
import * as THREE from 'three';

const MASK_MAT = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: true });
export const MASK_ORDER = 0.5; // after the opaque scene (0), before the ocean (1)

// Build the lid from the boat's own vertices: slice it along its length, and in each slice take the rim's
// height and half-breadth from the vertices near the top of that slice.
export function addWaterMask(object, { slices = 18, inset = 0.93, drop = 0.04 } = {}) {
  object.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(object.matrixWorld).invert();
  const pts = [];
  const v = new THREE.Vector3();
  object.traverse((o) => {
    if (!o.isMesh || o.userData.waterMask) return;
    const m = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
    const p = o.geometry.attributes.position;
    const step = Math.max(1, Math.floor(p.count / 6000));
    for (let i = 0; i < p.count; i += step) { v.fromBufferAttribute(p, i).applyMatrix4(m); pts.push(v.x, v.y, v.z); }
  });
  if (pts.length < 30) return null;
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i < pts.length; i += 3) {
    x0 = Math.min(x0, pts[i]); x1 = Math.max(x1, pts[i]);
    y0 = Math.min(y0, pts[i + 1]); y1 = Math.max(y1, pts[i + 1]);
    z0 = Math.min(z0, pts[i + 2]); z1 = Math.max(z1, pts[i + 2]);
  }
  // the long axis is the boat's length
  const alongZ = z1 - z0 >= x1 - x0;
  const L0 = alongZ ? z0 : x0, L1 = alongZ ? z1 : x1;
  const cAcross = alongZ ? (x0 + x1) / 2 : (z0 + z1) / 2;
  const H = y1 - y0;
  const rim = new Array(slices + 1).fill(null).map(() => ({ y: -Infinity, w: 0 }));
  const sliceOf = (s) => Math.round(((s - L0) / (L1 - L0)) * slices);
  // the rim height in each slice: the highest point of the hull there (ignoring tall posts and oars by using
  // only points within the hull's own breadth)
  for (let i = 0; i < pts.length; i += 3) {
    const s = alongZ ? pts[i + 2] : pts[i], a = (alongZ ? pts[i] : pts[i + 2]) - cAcross;
    const k = sliceOf(s), r = rim[k];
    if (Math.abs(a) > (alongZ ? x1 - x0 : z1 - z0) * 0.6) continue;
    r.y = Math.max(r.y, pts[i + 1]);
  }
  for (let i = 0; i < pts.length; i += 3) {
    const s = alongZ ? pts[i + 2] : pts[i], a = (alongZ ? pts[i] : pts[i + 2]) - cAcross;
    const r = rim[sliceOf(s)];
    if (pts[i + 1] > r.y - H * 0.18) r.w = Math.max(r.w, Math.abs(a));
  }
  // fill any empty slices from their neighbours; close the ends
  for (let k = 0; k <= slices; k++) if (!isFinite(rim[k].y)) { const n = rim[k - 1] || rim[k + 1]; rim[k] = { y: n && isFinite(n.y) ? n.y : y1, w: 0 }; }
  rim[0].w = 0; rim[slices].w = 0;
  const pos = [], idx = [];
  for (let k = 0; k <= slices; k++) {
    const s = L0 + ((L1 - L0) * k) / slices, r = rim[k], w = r.w * inset, y = r.y - drop;
    if (alongZ) pos.push(cAcross - w, y, s, cAcross + w, y, s);
    else pos.push(s, y, cAcross - w, s, y, cAcross + w);
    if (k < slices) { const a = k * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  const lid = new THREE.Mesh(g, MASK_MAT);
  lid.material.side = THREE.DoubleSide;
  lid.renderOrder = MASK_ORDER;
  lid.castShadow = false;
  lid.receiveShadow = false;
  lid.userData.waterMask = true;
  lid.raycast = () => {};
  object.add(lid);
  return lid;
}
