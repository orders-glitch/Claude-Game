// Grass blades around the camera: instanced clumps in square patches that stream in and out as you move,
// placed by the terrain's grass / forest-floor weights (never on sand, rock or town dirt), swaying in the
// wind. Blade normals lean upward so the grass takes the sky light the way a real sward does.
import * as THREE from 'three';
import { mulberry32 } from '../core/noise.js';
import { windUniforms } from './vegetation.js';

const PATCH = 16;

function clumpGeometry(blades = 9) {
  const pos = [], nrm = [], col = [], idx = [];
  const rnd = mulberry32(99);
  const base = new THREE.Color('#3d5a1c'), tip = new THREE.Color('#9fb04a'), dry = new THREE.Color('#b5a45c');
  for (let b = 0; b < blades; b++) {
    const a = rnd() * Math.PI * 2;
    const r = rnd() * 0.22;
    const ox = Math.cos(a) * r, oz = Math.sin(a) * r;
    const h = 0.25 + rnd() * 0.4, w = 0.012 + rnd() * 0.01;
    const face = rnd() * Math.PI;
    const fx = Math.cos(face), fz = Math.sin(face);
    const lean = (rnd() - 0.5) * 0.35, leanDir = rnd() * Math.PI * 2;
    const tipCol = tip.clone().lerp(dry, rnd() * 0.5);
    const segs = 3;
    const v0 = pos.length / 3;
    for (let s = 0; s <= segs; s++) {
      const t = s / segs;
      const ww = w * (1 - t * 0.85);
      const bend = lean * t * t;
      const cx = ox + Math.cos(leanDir) * bend, cz = oz + Math.sin(leanDir) * bend;
      for (const side of [-1, 1]) {
        pos.push(cx + fx * ww * side, h * t, cz + fz * ww * side);
        nrm.push(-fz * 0.3, 1, fx * 0.3);
        const c = base.clone().lerp(tipCol, t);
        col.push(c.r, c.g, c.b);
      }
    }
    for (let s = 0; s < segs; s++) {
      const a0 = v0 + s * 2;
      idx.push(a0, a0 + 1, a0 + 2, a0 + 1, a0 + 3, a0 + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  return g;
}

export class Grass {
  constructor(scene, terrain, avoid, quality = 'high') {
    this.scene = scene;
    this.terrain = terrain;
    this.avoid = avoid;
    this.radius = quality === 'low' ? 0 : quality === 'medium' ? 2 : 3;
    this.perPatch = quality === 'high' ? 520 : 360;
    this.geo = clumpGeometry();
    this.fadeR = { value: (this.radius + 0.5) * PATCH };
    this.mat = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.85 });
    this.mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = windUniforms.uTime;
      shader.uniforms.uWind = windUniforms.uWind;
      shader.uniforms.uGrassR = this.fadeR;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uWind;\nuniform float uGrassR;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          vec3 ip = instanceMatrix[3].xyz;
          // shrink into the ground towards the edge of the streamed area (no hard border)
          transformed *= 1.0 - smoothstep(uGrassR * 0.55, uGrassR * 0.95, distance(ip.xz, cameraPosition.xz));
          float ph = ip.x * 0.35 + ip.z * 0.21;
          float k = position.y * position.y * 1.6;
          float gust = sin(uTime * 1.7 + ph) * 0.6 + sin(uTime * 3.1 + ph * 1.9) * 0.25 + 0.35;
          transformed.x += gust * uWind * 0.12 * k;
          transformed.z += gust * uWind * 0.07 * k;`);
    };
    this.patches = new Map();
    this.sp = [0, 0, 0, 0];
  }

  build(i, j) {
    const T = this.terrain, n = this.perPatch;
    const rnd = mulberry32((i * 73856093) ^ (j * 19349663));
    const mats = [];
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    for (let k = 0; k < n; k++) {
      const x = (i + rnd()) * PATCH, z = (j + rnd()) * PATCH;
      const h = T.height(x, z);
      if (h < 1.6) continue;
      const is = T.lastIsland;
      const hl = T.height(x - 1, z), hr = T.height(x + 1, z), hd = T.height(x, z - 1), hu = T.height(x, z + 1);
      const slope = Math.hypot(hr - hl, hu - hd) / 2;
      T.surface(x, z, h, slope, is, this.sp, null);
      const w = this.sp[1] + this.sp[2] * 0.55;
      if (rnd() > w * 1.15) continue;
      if (this.avoid && this.avoid(x, z)) continue;
      q.setFromAxisAngle(up, rnd() * 6.28);
      const sc = 0.7 + rnd() * 0.7 * (0.6 + this.sp[1] * 0.6);
      mats.push(m.compose(p.set(x, h - 0.03, z), q, s.set(sc, sc * (0.8 + rnd() * 0.5), sc)).clone());
    }
    if (!mats.length) return null;
    const im = new THREE.InstancedMesh(this.geo, this.mat, mats.length);
    mats.forEach((mm, k) => im.setMatrixAt(k, mm));
    im.computeBoundingSphere();
    im.receiveShadow = true;
    this.scene.add(im);
    return im;
  }

  update(camPos, budgetMs = 3) {
    if (!this.radius) return;
    const ci = Math.floor(camPos.x / PATCH), cj = Math.floor(camPos.z / PATCH);
    // nothing to do far above the ground (sailing at sea, looking at the chart)
    const t0 = performance.now();
    const R = this.radius;
    for (let r = 0; r <= R; r++) {
      for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
        const k = (ci + di) + ',' + (cj + dj);
        if (this.patches.has(k)) continue;
        if (performance.now() - t0 > budgetMs && r > 1) return;
        this.patches.set(k, this.build(ci + di, cj + dj));
      }
    }
    for (const [k, im] of this.patches) {
      const [i, j] = k.split(',').map(Number);
      if (Math.abs(i - ci) > R + 1 || Math.abs(j - cj) > R + 1) {
        if (im) { this.scene.remove(im); im.dispose(); }
        this.patches.delete(k);
      }
    }
  }
}
