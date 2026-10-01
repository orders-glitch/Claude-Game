// Solid shapes from what you see. A collider's box says where a building stands; what you walk on and run into
// is its real outline from above: the pitch of each roof, hips and gables, towers and chimneys, a parapet round
// an azotea and the floor inside it. After a town is built, its visible geometry is rasterised from above into
// a fine height map (the highest surface over each 0.4 m cell), and every collider keeps the patch over its own
// footprint. colliderSurface() reads it; cells with nothing standing in them (a breach, a courtyard) are open.
import * as THREE from 'three';

const CELL = 0.4;

export function bakeShapes(town, terrain) {
  const cols = town.colliders.filter((c) => !c.rope && c.bottom === undefined && !c.hmap);
  if (!cols.length || !town.group) return;
  // the area the colliders cover
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const c of cols) {
    const r = Math.hypot(c.hw, c.hd);
    x0 = Math.min(x0, c.x - r); x1 = Math.max(x1, c.x + r); z0 = Math.min(z0, c.z - r); z1 = Math.max(z1, c.z + r);
  }
  const NX = Math.ceil((x1 - x0) / CELL) + 1, NZ = Math.ceil((z1 - z0) / CELL) + 1;
  if (NX * NZ > 40e6) return; // (far too big: leave the boxes as they are)
  const H = new Float32Array(NX * NZ).fill(-Infinity);
  // rasterise every triangle of the town's own meshes from above, keeping the highest point in each cell
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c3 = new THREE.Vector3();
  town.group.updateMatrixWorld(true);
  town.group.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh || !o.visible || o.userData.noShape) return;
    const pos = o.geometry.attributes.position, idx = o.geometry.index, mw = o.matrixWorld;
    const tris = (idx ? idx.count : pos.count) / 3;
    for (let i = 0; i < tris; i++) {
      const i0 = idx ? idx.getX(i * 3) : i * 3, i1 = idx ? idx.getX(i * 3 + 1) : i * 3 + 1, i2 = idx ? idx.getX(i * 3 + 2) : i * 3 + 2;
      a.fromBufferAttribute(pos, i0).applyMatrix4(mw); b.fromBufferAttribute(pos, i1).applyMatrix4(mw); c3.fromBufferAttribute(pos, i2).applyMatrix4(mw);
      const mnx = Math.max(0, Math.floor((Math.min(a.x, b.x, c3.x) - x0) / CELL)), mxx = Math.min(NX - 1, Math.floor((Math.max(a.x, b.x, c3.x) - x0) / CELL));
      const mnz = Math.max(0, Math.floor((Math.min(a.z, b.z, c3.z) - z0) / CELL)), mxz = Math.min(NZ - 1, Math.floor((Math.max(a.z, b.z, c3.z) - z0) / CELL));
      if (mnx > mxx || mnz > mxz) continue;
      const d = (b.z - c3.z) * (a.x - c3.x) + (c3.x - b.x) * (a.z - c3.z);
      if (Math.abs(d) < 1e-6) {
        // a vertical face: it stands as high as its top edge along its line
        const top = Math.max(a.y, b.y, c3.y);
        // along the line it makes seen from above (between its two farthest-apart corners)
        const P = [a, b, c3];
        let p = P[0], q = P[1], best = -1;
        for (let m = 0; m < 3; m++) for (let n = m + 1; n < 3; n++) { const dd = (P[m].x - P[n].x) ** 2 + (P[m].z - P[n].z) ** 2; if (dd > best) { best = dd; p = P[m]; q = P[n]; } }
        const steps = Math.max(1, Math.ceil(Math.sqrt(best) / (CELL * 0.5)));
        for (let k = 0; k <= steps; k++) {
          const t = k / steps, ix = Math.floor((p.x + (q.x - p.x) * t - x0) / CELL), iz = Math.floor((p.z + (q.z - p.z) * t - z0) / CELL);
          if (ix < 0 || iz < 0 || ix >= NX || iz >= NZ) continue;
          const kk = ix * NZ + iz; if (top > H[kk]) H[kk] = top;
        }
        continue;
      }
      for (let ix = mnx; ix <= mxx; ix++) {
        const px = x0 + (ix + 0.5) * CELL;
        for (let iz = mnz; iz <= mxz; iz++) {
          const pz = z0 + (iz + 0.5) * CELL;
          const l1 = ((b.z - c3.z) * (px - c3.x) + (c3.x - b.x) * (pz - c3.z)) / d;
          const l2 = ((c3.z - a.z) * (px - c3.x) + (a.x - c3.x) * (pz - c3.z)) / d;
          const l3 = 1 - l1 - l2;
          // (a little slack at the edges, so thin walls seen edge-on still register)
          if (l1 < -0.02 || l2 < -0.02 || l3 < -0.02) continue;
          const y = l1 * a.y + l2 * b.y + l3 * c3.y;
          const k = ix * NZ + iz;
          if (y > H[k]) H[k] = y;
        }
      }
    }
  });
  // each collider's own patch, in its local frame
  for (const c of cols) {
    const nx = Math.max(2, Math.ceil((c.hw * 2) / CELL) + 1), nz = Math.max(2, Math.ceil((c.hd * 2) / CELL) + 1);
    const data = new Float32Array(nx * nz);
    let solid = 0;
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
      const lx = -c.hw + (i / (nx - 1)) * c.hw * 2, lz = -c.hd + (j / (nz - 1)) * c.hd * 2;
      const wx = c.x + lx * c.cos + lz * c.sin, wz = c.z - lx * c.sin + lz * c.cos;
      const ix = Math.floor((wx - x0) / CELL), iz = Math.floor((wz - z0) / CELL);
      let h = ix >= 0 && iz >= 0 && ix < NX && iz < NZ ? H[ix * NZ + iz] : -Infinity;
      // nothing standing here but the street or the floor: open
      if (h < terrain.height(wx, wz) + 0.35) h = -Infinity; else solid++;
      data[i * nz + j] = h;
    }
    // a box with (almost) nothing of the town's geometry in it holds something else (a ship, a prop): keep it
    if (solid < nx * nz * 0.08) continue;
    c.hmap = { nx, nz, data };
    let top = -Infinity; for (const v of data) if (v > top) top = v;
    c.boxTop = c.top; c.top = top; // (its highest point, for the checks that only want a height)
  }
}

// the solid height at (lx, lz) in a collider's frame; -Infinity where it is open
export function sampleShape(c, lx, lz) {
  const M = c.hmap, nx = M.nx, nz = M.nz;
  const fi = ((lx + c.hw) / (c.hw * 2)) * (nx - 1), fj = ((lz + c.hd) / (c.hd * 2)) * (nz - 1);
  const i = Math.max(0, Math.min(nx - 1, Math.round(fi))), j = Math.max(0, Math.min(nz - 1, Math.round(fj)));
  let h = M.data[i * nz + j];
  if (h === -Infinity) {
    // at the foot of a wall (the box is a little bigger than the building): stand on what's beside
    for (let r = 1; r <= 1 && h === -Infinity; r++) {
      for (let di = -r; di <= r; di++) for (let dj = -r; dj <= r; dj++) {
        const ii = i + di, jj = j + dj;
        if (ii < 0 || jj < 0 || ii >= nx || jj >= nz) continue;
        const v = M.data[ii * nz + jj];
        if (v > h) h = v;
      }
    }
  }
  return h;
}
