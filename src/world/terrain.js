// Island terrain: analytic height function shared by rendering, physics, AI and the chart.
import * as THREE from 'three';
import { Simplex, smoothstep, lerp, clamp } from '../core/noise.js';
import { makeTerrainMaterial } from './terrainMaterial.js';
import { COASTLINES } from '../game/coastlines.js';

export const SEA_FLOOR = -40;
export const WORLD_HALF = 9000;

// ---------------------------------------------------------------- coastline distance fields
// Squared Euclidean distance transform (Felzenszwalb & Huttenlocher) along one line.
function edt1d(f, n, d, v, zz) {
  let k = 0; v[0] = 0; zz[0] = -Infinity; zz[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= zz[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
    k++; v[k] = q; zz[k] = s; zz[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) { while (zz[k + 1] < q) k++; d[q] = (q - v[k]) ** 2 + f[v[k]]; }
}
function edt2d(grid, W, H) {
  const n = Math.max(W, H), f = new Float64Array(n), d = new Float64Array(n), v = new Int32Array(n), zz = new Float64Array(n + 1);
  for (let x = 0; x < W; x++) { for (let y = 0; y < H; y++) f[y] = grid[y * W + x]; edt1d(f, H, d, v, zz); for (let y = 0; y < H; y++) grid[y * W + x] = d[y]; }
  for (let y = 0; y < H; y++) { for (let x = 0; x < W; x++) f[x] = grid[y * W + x]; edt1d(f, W, d, v, zz); for (let x = 0; x < W; x++) grid[y * W + x] = d[x]; }
}

// Rasterise a coastline polygon and build a signed distance field (metres, positive inland).
function buildCoast(is, pts) {
  // principal axes -> the island's box (used by meshing, scattering and culling)
  let cx = 0, cz = 0;
  for (const [x, z] of pts) { cx += x; cz += z; }
  cx /= pts.length; cz /= pts.length;
  let sxx = 0, szz = 0, sxz = 0;
  for (const [x, z] of pts) { sxx += (x - cx) ** 2; szz += (z - cz) ** 2; sxz += (x - cx) * (z - cz); }
  const ang = 0.5 * Math.atan2(2 * sxz, sxx - szz), ux = Math.cos(ang), uz = Math.sin(ang);
  let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity, x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const [x, z] of pts) {
    const a = (x - cx) * ux + (z - cz) * uz, b = -(x - cx) * uz + (z - cz) * ux;
    a0 = Math.min(a0, a); a1 = Math.max(a1, a); b0 = Math.min(b0, b); b1 = Math.max(b1, b);
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z);
  }
  is.x = cx + ((a0 + a1) / 2) * ux - ((b0 + b1) / 2) * uz;
  is.z = cz + ((a0 + a1) / 2) * uz + ((b0 + b1) / 2) * ux;
  is.rx = (a1 - a0) / 2; is.rz = (b1 - b0) / 2;
  is.rot = -ang; is.cos = Math.cos(is.rot); is.sin = Math.sin(is.rot);
  is.minR = Math.min(is.rx, is.rz); is.maxR = Math.max(is.rx, is.rz);
  is.warpAmp = Math.min(22, is.minR * 0.08); // the real outline already carries the detail
  is.hillRange = Math.max(40, is.minR * 0.85);
  is.boundR = is.maxR + 420;
  // raster
  const pad = 360, cell = Math.min(8, Math.max(2.5, (is.maxR * 2) / 1100));
  const W = Math.ceil((x1 - x0 + pad * 2) / cell), H = Math.ceil((z1 - z0 + pad * 2) / cell);
  const gx0 = x0 - pad, gz0 = z0 - pad;
  const inside = new Uint8Array(W * H);
  const xs = [];
  for (let j = 0; j < H; j++) {
    const z = gz0 + (j + 0.5) * cell;
    xs.length = 0;
    for (let i = 0, k = pts.length - 1; i < pts.length; k = i++) {
      const [xi, zi] = pts[i], [xk, zk] = pts[k];
      if ((zi > z) !== (zk > z)) xs.push(xi + ((z - zi) / (zk - zi)) * (xk - xi));
    }
    xs.sort((p, q) => p - q);
    for (let t = 0; t + 1 < xs.length; t += 2) {
      const i0 = Math.max(0, Math.ceil((xs[t] - gx0) / cell - 0.5)), i1 = Math.min(W - 1, Math.floor((xs[t + 1] - gx0) / cell - 0.5));
      for (let i = i0; i <= i1; i++) inside[j * W + i] = 1;
    }
  }
  const BIG = 1e12;
  const din = new Float64Array(W * H), dout = new Float64Array(W * H);
  for (let k = 0; k < W * H; k++) { din[k] = inside[k] ? BIG : 0; dout[k] = inside[k] ? 0 : BIG; }
  edt2d(din, W, H); // inside cells: distance to nearest outside cell
  edt2d(dout, W, H); // outside cells: distance to nearest inside cell
  const data = new Float32Array(W * H);
  for (let k = 0; k < W * H; k++) data[k] = inside[k] ? (Math.sqrt(din[k]) - 0.5) * cell : -(Math.sqrt(dout[k]) - 0.5) * cell;
  is.sdf = { x0: gx0, z0: gz0, cell, W, H, data };
}

function sampleSDF(s, x, z) {
  const fx = (x - s.x0) / s.cell - 0.5, fz = (z - s.z0) / s.cell - 0.5;
  if (fx < 0 || fz < 0 || fx >= s.W - 1 || fz >= s.H - 1) {
    // beyond the raster: keep falling away from the island
    const ex = Math.max(-fx, fx - (s.W - 1), 0), ez = Math.max(-fz, fz - (s.H - 1), 0);
    const cx = Math.min(Math.max(fx, 0), s.W - 1) | 0, cz = Math.min(Math.max(fz, 0), s.H - 1) | 0;
    return s.data[cz * s.W + cx] - Math.hypot(ex, ez) * s.cell;
  }
  const i = fx | 0, j = fz | 0, tx = fx - i, tz = fz - j, W = s.W, D = s.data;
  const a = D[j * W + i], b = D[j * W + i + 1], c = D[(j + 1) * W + i], d = D[(j + 1) * W + i + 1];
  return (a + (b - a) * tx) + ((c + (d - c) * tx) - (a + (b - a) * tx)) * tz;
}

// Shallow banks in game coordinates (ellipses with noisy edges); `cays`: sandy islets scattered on each
const BANKS = [
  { x: 1150, z: -4350, rx: 1500, rz: 820, rot: 0.25, cays: 14 }, // Andros – New Providence (Great Bahama Bank)
  { x: 3150, z: -4050, rx: 1650, rz: 380, rot: -0.85, cays: 16 }, // Exuma Cays
  { x: 3450, z: -5300, rx: 1050, rz: 300, rot: 0.55, cays: 6 }, // Eleuthera
  { x: -2800, z: -4850, rx: 1900, rz: 330, rot: -0.3, cays: 18 }, // Florida Keys reef tract
  { x: -1850, z: 880, rx: 420, rz: 170, rot: 0.1, cays: 3 }, // Grand Cayman
  { x: 900, z: 2300, rx: 900, rz: 380, rot: 0.15, cays: 9 }, // Pedro Bank
  { x: 2700, z: 1650, rx: 300, rz: 180, rot: -0.3, cays: 4 }, // Morant Cays
];

export class Terrain {
  constructor(islands) {
    this.noise = new Simplex(1716);
    this.islands = islands.map((is) => {
      const minR = Math.min(is.rx, is.rz);
      const maxR = Math.max(is.rx, is.rz);
      return {
        ...is,
        cos: Math.cos(is.rot), sin: Math.sin(is.rot),
        minR, maxR,
        warpAmp: Math.min(120, minR * 0.35),
        hillRange: Math.max(40, minR * 0.85),
        boundR: maxR + Math.min(120, minR * 0.35) + 420,
      };
    });
    // real coastlines: a signed-distance field per island replaces the ellipse (and redefines its box)
    for (const is of this.islands) if (COASTLINES[is.id]) buildCoast(is, COASTLINES[is.id]);
    // shallow banks (the Great Bahama Bank, the Florida reef tract): wide turquoise shallows, deep enough to
    // sail over, scattered with sandy cays
    this.banks = BANKS.map((b) => ({ ...b, cos: Math.cos(b.rot), sin: Math.sin(b.rot) }));
    const rnd = (() => { let t = 1716; return () => ((t = (t * 1664525 + 1013904223) >>> 0) / 4294967296); })();
    this.cays = [];
    for (const b of this.banks) {
      for (let k = 0; k < b.cays; k++) {
        const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * 0.8;
        const lx = Math.cos(a) * r * b.rx, lz = Math.sin(a) * r * b.rz;
        this.cays.push({ x: b.x + lx * b.cos + lz * b.sin, z: b.z - lx * b.sin + lz * b.cos, r: 18 + rnd() * 45, e: 0.4 + rnd() * 0.6, rot: rnd() * 3 });
      }
    }
    this.zones = []; // flattened town areas
    this.lastD = 0;
    this.lastIsland = null;
  }

  // Signed approximate distance to coast (positive inland) + height for one island.
  _island(is, x, z) {
    const dx = x - is.x, dz = z - is.z;
    const lx = dx * is.cos - dz * is.sin;
    const lz = dx * is.sin + dz * is.cos;
    let d;
    if (is.sdf) d = sampleSDF(is.sdf, x, z);
    else {
      const u = lx / is.rx, v = lz / is.rz;
      const nd = Math.sqrt(u * u + v * v);
      const g = Math.sqrt((u / is.rx) ** 2 + (v / is.rz) ** 2) / Math.max(nd, 1e-4);
      d = nd < 1 ? Math.min((1 - nd) / g, (1 - nd) * is.minR) : (1 - nd) / g;
    }
    const n = this.noise;
    d += n.fbm(x * 0.0032 + is.seed * 31.7, z * 0.0032 - is.seed * 7.3, 3) * is.warpAmp
       + n.noise2(x * 0.03 + is.seed, z * 0.03) * Math.min(6, is.minR * 0.08);
    let h;
    if (d > 0) {
      const beach = 0.3 + 1.9 * smoothstep(0, 22, d);
      const hillT = smoothstep(16, is.hillRange, d);
      let hills = 0;
      if (hillT > 0) {
        const ridge = n.ridged(x * 0.0036 + is.seed * 3.1, z * 0.0036, 4);
        const roll = n.fbm(x * 0.0022 - is.seed, z * 0.0022, 3) * 0.5 + 0.5;
        hills = is.peak * Math.pow(hillT, 1.3) * (0.3 + 0.55 * ridge * 0.8 + 0.55 * roll);
      }
      const bumps = n.noise2(x * 0.021, z * 0.021) * 1.4 * smoothstep(12, 40, d);
      h = beach + hills + bumps;
    } else {
      const dd = -d;
      h = 0.3 - 4.5 * smoothstep(0, 26, dd) - 35 * smoothstep(34, 330, dd)
        + n.noise2(x * 0.012, z * 0.012) * 1.5 * (1 - smoothstep(30, 200, dd));
    }
    return { h, d };
  }

  // height of the bank floor (and its cays) at (x, z), or SEA_FLOOR outside every bank
  bankHeight(x, z) {
    let h = SEA_FLOOR;
    for (const b of this.banks) {
      const dx = x - b.x, dz = z - b.z;
      if (Math.abs(dx) > b.rx + b.rz + 400 || Math.abs(dz) > b.rx + b.rz + 400) continue;
      const lx = dx * b.cos - dz * b.sin, lz = dx * b.sin + dz * b.cos;
      const nd = Math.hypot(lx / b.rx, lz / b.rz) + this.noise.fbm(x * 0.0011 + b.x, z * 0.0011, 3) * 0.28;
      if (nd > 1.35) continue;
      const floor = -5.2 + this.noise.noise2(x * 0.004, z * 0.004) * 1.3 + this.noise.noise2(x * 0.03, z * 0.03) * 0.35;
      h = Math.max(h, lerp(floor, SEA_FLOOR, smoothstep(0.85, 1.35, nd)));
    }
    if (h > -9) {
      for (const c of this.cays) {
        const dx = x - c.x, dz = z - c.z;
        if (dx * dx + dz * dz > (c.r * 3.5) ** 2) continue;
        const cs = Math.cos(c.rot), sn = Math.sin(c.rot);
        const u = (dx * cs - dz * sn) / c.r, v = (dx * sn + dz * cs) / (c.r * c.e);
        const dd = Math.sqrt(u * u + v * v) + this.noise.noise2(x * 0.05, z * 0.05) * 0.2;
        h = Math.max(h, 1.3 - dd * 1.6 - Math.max(0, dd - 1) * 2.2);
      }
    }
    return h;
  }

  baseHeight(x, z) {
    let best = this.bankHeight(x, z);
    let bestD = -1e9;
    let bestIs = null;
    for (let i = 0; i < this.islands.length; i++) {
      const is = this.islands[i];
      const dx = x - is.x, dz = z - is.z;
      if (dx * dx + dz * dz > is.boundR * is.boundR) continue;
      const r = this._island(is, x, z);
      if (r.h > best) { best = r.h; bestD = r.d; bestIs = is; }
    }
    this.lastD = bestD;
    this.lastIsland = bestIs;
    return best;
  }

  height(x, z) {
    let h = this.baseHeight(x, z);
    const d = this.lastD, is = this.lastIsland;
    for (let i = 0; i < this.zones.length; i++) {
      const zn = this.zones[i];
      const dx = x - zn.x, dz = z - zn.z;
      const dist2 = dx * dx + dz * dz;
      if (dist2 > zn.r * zn.r) continue;
      if (h <= -0.2 && !zn.raise) continue;
      const w = 1 - smoothstep(zn.r * zn.inner, zn.r, Math.sqrt(dist2));
      if (zn.raise && h < zn.level) {
        h = lerp(h, zn.level, w);
      } else if (!zn.raise) {
        h = lerp(h, zn.level, w);
      }
    }
    this.lastD = d; this.lastIsland = is;
    return h;
  }

  addZone(z) { this.zones.push({ inner: 0.72, ...z }); }

  normal(x, z, out = new THREE.Vector3(), e = 1.5) {
    const hl = this.height(x - e, z), hr = this.height(x + e, z);
    const hd = this.height(x, z - e), hu = this.height(x, z + e);
    return out.set(hl - hr, 2 * e, hd - hu).normalize();
  }

  // Walk from a point along a direction to find the coastline (height crossing 0).
  findCoast(x, z, dirx, dirz) {
    let h = this.baseHeight(x, z);
    const step = 3;
    let px = x, pz = z;
    if (h > 0) {
      for (let i = 0; i < 600 && h > 0; i++) { px += dirx * step; pz += dirz * step; h = this.baseHeight(px, pz); }
    } else {
      for (let i = 0; i < 600 && h <= 0; i++) { px -= dirx * step; pz -= dirz * step; h = this.baseHeight(px, pz); }
      px += dirx * step; pz += dirz * step;
    }
    return { x: px, z: pz };
  }

  islandAt(x, z) {
    this.baseHeight(x, z);
    return this.lastIsland;
  }

  nearestIsland(x, z) {
    let best = null, bd = Infinity;
    for (const is of this.islands) {
      const d = Math.hypot(x - is.x, z - is.z) - (is.rx + is.rz) * 0.5;
      if (d < bd) { bd = d; best = is; }
    }
    return best;
  }

  // Find a walkable beach point on land close to (x,z).
  findLanding(x, z, maxR = 400) {
    let best = null, bd = Infinity;
    for (let r = 10; r <= maxR; r += 10) {
      const steps = Math.ceil(r / 6);
      for (let i = 0; i < steps; i++) {
        const a = (i / steps) * Math.PI * 2;
        const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
        const h = this.height(px, pz);
        if (h > 0.8 && h < 6) {
          const n = this.normal(px, pz);
          if (n.y > 0.85 && r < bd) { bd = r; best = { x: px, z: pz, y: h }; }
        }
      }
      if (best) return best;
    }
    return best;
  }

  // ------------------------------------------------------------------ rendering
  // Surface weights for one vertex: [sand, grass, forest floor, rock] (+ dirt = remainder), plus a tint
  // colour used when photo textures are unavailable.
  surface(x, z, h, slope, is, splat, col) {
    const n1 = this.noise.noise2(x * 0.01, z * 0.01);
    const n2 = this.noise.noise2(x * 0.07 + 40, z * 0.07);
    const jun = clamp((is ? is.jungle : 0.4) + n1 * 0.35, 0, 1);
    const sandT = 1 - smoothstep(1.7 + n1 * 0.8, 3.0 + n1 * 0.8, h);
    let forest = smoothstep(0.38, 0.7, jun + n2 * 0.12);
    let grass = 1 - forest;
    grass *= 1 - sandT; forest *= 1 - sandT;
    let rock = smoothstep(1.2, 2.0, slope + n2 * 0.15);
    if (is && h > is.peak * 0.8 && is.peak > 60) rock = Math.max(rock, 0.3);
    if (h < -2) rock = Math.max(rock, smoothstep(0.35, 0.7, slope)); // reef shelves
    let dirt = 0;
    for (const zn of this.zones) {
      if (!zn.dirt || h < 0.5) continue;
      const dd = Math.hypot(x - zn.x, z - zn.z) / zn.r;
      if (dd < 1) dirt = Math.max(dirt, clamp((1 - dd) * 2.4, 0, 0.9) * (0.75 + n2 * 0.25));
    }
    const keep = (1 - rock) * (1 - dirt);
    splat[0] = sandT * keep; splat[1] = grass * keep; splat[2] = forest * keep; splat[3] = rock * (1 - dirt);
    if (col) {
      const c = TINTS;
      const s0 = h < 0.7 ? c.wetSand : c.sand, k = 0.92 + n2 * 0.08;
      col.setRGB(
        (s0.r * splat[0] + c.grass.r * splat[1] + c.jungle.r * splat[2] + c.rock.r * splat[3] + c.dirt.r * dirt) * k,
        (s0.g * splat[0] + c.grass.g * splat[1] + c.jungle.g * splat[2] + c.rock.g * splat[3] + c.dirt.g * dirt) * k,
        (s0.b * splat[0] + c.grass.b * splat[1] + c.jungle.b * splat[2] + c.rock.b * splat[3] + c.dirt.b * dirt) * k);
    }
  }

  // Far terrain: one coarse mesh per island (the near field is covered by TerrainDetail tiles)
  buildMeshes(scene, quality = 'high') {
    this.material = makeTerrainMaterial({ cutFine: true });
    this.meshes = [];
    const budget = quality === 'low' ? 45000 : quality === 'medium' ? 80000 : 140000;
    const col = new THREE.Color();
    const sp = [0, 0, 0, 0];
    for (const is of this.islands) {
      const margin = 90;
      const ex = Math.sqrt((is.rx * is.cos) ** 2 + (is.rz * is.sin) ** 2) + is.warpAmp + margin;
      const ez = Math.sqrt((is.rx * is.sin) ** 2 + (is.rz * is.cos) ** 2) + is.warpAmp + margin;
      let cell = clamp(is.minR / 16, 3, 9);
      cell = Math.max(cell, Math.sqrt((ex * 2 * ez * 2) / budget));
      const nx = Math.ceil((ex * 2) / cell) + 1;
      const nz = Math.ceil((ez * 2) / cell) + 1;
      const pos = new Float32Array(nx * nz * 3);
      const colors = new Float32Array(nx * nz * 3);
      const splat = new Float32Array(nx * nz * 4);
      const hs = new Float32Array(nx * nz);
      for (let j = 0; j < nz; j++) {
        for (let i = 0; i < nx; i++) {
          const x = is.x - ex + i * cell, z = is.z - ez + j * cell;
          const h = Math.max(this.height(x, z), -30);
          const k = j * nx + i;
          hs[k] = h;
          pos[k * 3] = x; pos[k * 3 + 1] = h; pos[k * 3 + 2] = z;
        }
      }
      for (let j = 0; j < nz; j++) {
        for (let i = 0; i < nx; i++) {
          const k = j * nx + i;
          const hl = hs[j * nx + Math.max(0, i - 1)], hr = hs[j * nx + Math.min(nx - 1, i + 1)];
          const hd = hs[Math.max(0, j - 1) * nx + i], hu = hs[Math.min(nz - 1, j + 1) * nx + i];
          const slope = Math.hypot(hr - hl, hu - hd) / (2 * cell);
          this.surface(pos[k * 3], pos[k * 3 + 2], hs[k], slope, is, sp, col);
          splat.set(sp, k * 4);
          colors[k * 3] = col.r; colors[k * 3 + 1] = col.g; colors[k * 3 + 2] = col.b;
        }
      }
      const idx = [];
      for (let j = 0; j < nz - 1; j++) {
        for (let i = 0; i < nx - 1; i++) {
          const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
          if (hs[a] < -12 && hs[b] < -12 && hs[c] < -12 && hs[d] < -12) continue;
          idx.push(a, c, b, b, c, d);
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      geo.setAttribute('splat', new THREE.BufferAttribute(splat, 4));
      geo.setIndex(idx);
      geo.computeVertexNormals();
      geo.computeBoundingSphere();
      const mesh = new THREE.Mesh(geo, this.material);
      mesh.receiveShadow = true;
      mesh.castShadow = is.peak > 30;
      mesh.name = 'terrain_' + is.id;
      scene.add(mesh);
      this.meshes.push(mesh);
    }
  }

  // Low-res heightmap texture used by the ocean shader (shallows/foam) and the chart.
  bakeHeightmap(size = 512) {
    const data = new Float32Array(size * size);
    data.fill(SEA_FLOOR);
    const scale = (WORLD_HALF * 2) / size;
    for (const is of this.islands) {
      const r = is.boundR;
      const i0 = Math.max(0, Math.floor((is.x - r + WORLD_HALF) / scale));
      const i1 = Math.min(size - 1, Math.ceil((is.x + r + WORLD_HALF) / scale));
      const j0 = Math.max(0, Math.floor((is.z - r + WORLD_HALF) / scale));
      const j1 = Math.min(size - 1, Math.ceil((is.z + r + WORLD_HALF) / scale));
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const x = -WORLD_HALF + (i + 0.5) * scale, z = -WORLD_HALF + (j + 0.5) * scale;
          const k = j * size + i;
          if (data[k] > SEA_FLOOR) continue;
          data[k] = this.height(x, z);
        }
      }
    }
    this.heightData = data;
    this.heightSize = size;
    // Half-float so linear filtering works on every WebGL2 device.
    const half = new Uint16Array(size * size);
    for (let i = 0; i < half.length; i++) half[i] = THREE.DataUtils.toHalfFloat(data[i]);
    const tex = new THREE.DataTexture(half, size, size, THREE.RedFormat, THREE.HalfFloatType);
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.needsUpdate = true;
    this.heightTexture = tex;
    return tex;
  }

  // Fast approximate height from the baked map (for AI look-ahead).
  quickHeight(x, z) {
    if (!this.heightData) return this.height(x, z);
    const size = this.heightSize;
    const i = Math.floor(((x + WORLD_HALF) / (WORLD_HALF * 2)) * size);
    const j = Math.floor(((z + WORLD_HALF) / (WORLD_HALF * 2)) * size);
    if (i < 0 || j < 0 || i >= size || j >= size) return SEA_FLOOR;
    return this.heightData[j * size + i];
  }
}

const TINTS = {
  sand: new THREE.Color('#e3d3a4'), wetSand: new THREE.Color('#b8a47a'), grass: new THREE.Color('#5f7d2f'),
  jungle: new THREE.Color('#34521f'), rock: new THREE.Color('#7d7465'), dirt: new THREE.Color('#9a8766'),
};

// High-resolution terrain around the camera: square tiles with 2 m cells, built a few per frame, so what you
// see near you matches the ground characters walk on. The coarse island meshes skip the covered rectangle.
export class TerrainDetail {
  constructor(terrain, scene, { tile = 128, cell = 2, radius = 2 } = {}) {
    this.terrain = terrain;
    this.scene = scene;
    this.tile = tile;
    this.cell = cell;
    this.radius = radius;
    this.material = makeTerrainMaterial();
    this.tiles = new Map(); // "i,j" -> mesh | null (all deep water)
    this.active = null; // centre tile of the rectangle currently cut from the coarse meshes
  }

  key(i, j) { return i + ',' + j; }

  wanted(ci, cj) {
    const out = [];
    for (let dj = -this.radius; dj <= this.radius; dj++) for (let di = -this.radius; di <= this.radius; di++) out.push([ci + di, cj + dj]);
    // nearest first
    return out.sort((a, b) => Math.hypot(a[0] - ci, a[1] - cj) - Math.hypot(b[0] - ci, b[1] - cj));
  }

  build(i, j) {
    const T = this.terrain, n = Math.round(this.tile / this.cell), c = this.cell;
    const x0 = i * this.tile, z0 = j * this.tile;
    // quick reject: nowhere near an island
    let near = false;
    const cx = x0 + this.tile / 2, cz = z0 + this.tile / 2;
    for (const is of T.islands) if (Math.hypot(cx - is.x, cz - is.z) < is.boundR + this.tile) { near = true; break; }
    if (!near) return null;
    const W = n + 3; // heights with a one-cell border for normals
    const hs = new Float32Array(W * W);
    const isl = new Array(W * W);
    let maxH = -1e9;
    for (let b = 0; b < W; b++) for (let a = 0; a < W; a++) {
      const h = Math.max(T.height(x0 + (a - 1) * c, z0 + (b - 1) * c), -30);
      hs[b * W + a] = h; isl[b * W + a] = T.lastIsland;
      if (h > maxH) maxH = h;
    }
    if (maxH < -12) return null;
    const V = n + 1;
    const skirt = 4 * V;
    const pos = new Float32Array((V * V + skirt) * 3), nrm = new Float32Array((V * V + skirt) * 3);
    const splat = new Float32Array((V * V + skirt) * 4), colors = new Float32Array((V * V + skirt) * 3);
    const sp = [0, 0, 0, 0], col = new THREE.Color();
    for (let b = 0; b < V; b++) for (let a = 0; a < V; a++) {
      const k = b * V + a, g = (b + 1) * W + (a + 1);
      const hl = hs[g - 1], hr = hs[g + 1], hd = hs[g - W], hu = hs[g + W];
      const x = x0 + a * c, z = z0 + b * c;
      pos[k * 3] = x; pos[k * 3 + 1] = hs[g]; pos[k * 3 + 2] = z;
      const nx = hl - hr, ny = 2 * c, nz = hd - hu, L = Math.hypot(nx, ny, nz);
      nrm[k * 3] = nx / L; nrm[k * 3 + 1] = ny / L; nrm[k * 3 + 2] = nz / L;
      T.surface(x, z, hs[g], Math.hypot(hr - hl, hu - hd) / (2 * c), isl[g], sp, col);
      splat.set(sp, k * 4);
      colors[k * 3] = col.r; colors[k * 3 + 1] = col.g; colors[k * 3 + 2] = col.b;
    }
    const idx = [];
    for (let b = 0; b < n; b++) for (let a = 0; a < n; a++) {
      const p = b * V + a, q = p + 1, r = p + V, t = r + 1;
      idx.push(p, r, q, q, r, t);
    }
    // skirts hanging 3 m below each edge hide any crack against neighbouring tiles or the coarse mesh
    const edges = [[0, 0, 1, 0], [0, n, 1, 0], [0, 0, 0, 1], [n, 0, 0, 1]];
    let s = V * V;
    for (const [ea, eb, da, db] of edges) {
      const first = s;
      for (let t = 0; t < V; t++, s++) {
        const src = (eb + db * t) * V + (ea + da * t);
        pos[s * 3] = pos[src * 3]; pos[s * 3 + 1] = pos[src * 3 + 1] - 3; pos[s * 3 + 2] = pos[src * 3 + 2];
        nrm.copyWithin(s * 3, src * 3, src * 3 + 3);
        splat.copyWithin(s * 4, src * 4, src * 4 + 4);
        colors.copyWithin(s * 3, src * 3, src * 3 + 3);
        if (t > 0) {
          const a0 = (eb + db * (t - 1)) * V + (ea + da * (t - 1)), a1 = src, b0 = first + t - 1, b1 = first + t;
          idx.push(a0, b0, a1, a1, b0, b1, a0, a1, b0, a1, b1, b0); // both windings: skirts are seen from either side
        }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    geo.setAttribute('splat', new THREE.BufferAttribute(splat, 4));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setIndex(idx);
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, this.material);
    mesh.receiveShadow = true;
    mesh.castShadow = maxH > 6;
    mesh.name = 'terrainTile';
    return mesh;
  }

  update(camPos, budgetMs = 5) {
    const ci = Math.floor(camPos.x / this.tile), cj = Math.floor(camPos.z / this.tile);
    const want = this.wanted(ci, cj);
    // a jump (teleport, docking) builds everything at once
    const jump = !this.active || Math.abs(this.active[0] - ci) > 2 || Math.abs(this.active[1] - cj) > 2;
    const t0 = performance.now();
    for (const [i, j] of want) {
      const k = this.key(i, j);
      if (this.tiles.has(k)) continue;
      if (!jump && performance.now() - t0 > budgetMs) break;
      const m = this.build(i, j);
      this.tiles.set(k, m);
      if (m) { m.visible = false; this.scene.add(m); } // shown once the whole square is ready
    }
    const ready = want.every(([i, j]) => this.tiles.has(this.key(i, j)));
    if (ready && (!this.active || this.active[0] !== ci || this.active[1] !== cj)) {
      this.active = [ci, cj];
      const r = this.radius, t = this.tile;
      this.terrain.material.userData.fineRect.value.set((ci - r) * t + 0.5, (cj - r) * t + 0.5, (ci + r + 1) * t - 0.5, (cj + r + 1) * t - 0.5);
      // drop tiles well outside the active square
      for (const [k, m] of this.tiles) {
        const [i, j] = k.split(',').map(Number);
        if (Math.abs(i - ci) > r + 1 || Math.abs(j - cj) > r + 1) {
          if (m) { this.scene.remove(m); m.geometry.dispose(); }
          this.tiles.delete(k);
        } else if (m) m.visible = Math.abs(i - ci) <= r && Math.abs(j - cj) <= r;
      }
    }
  }
}
