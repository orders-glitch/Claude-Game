// Island terrain: analytic height function shared by rendering, physics, AI and the chart.
import * as THREE from 'three';
import { Simplex, smoothstep, lerp, clamp } from '../core/noise.js';
import { makeTerrainMaterial } from './terrainMaterial.js';
import { DEEP } from '../game/coastlines.js';
import { geo, lonLat } from '../game/geo.js';
import { HARBOURS } from '../game/harbours.js';

export const SEA_FLOOR = -40;
export const WORLD_HALF = 15000;

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

// Signed distance field of a polygon (metres, positive inside) on a raster around it.
function polySDF(pts, cell, pad) {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const [x, z] of pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
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
  return { x0: gx0, z0: gz0, x1: gx0 + W * cell, z1: gz0 + H * cell, cell, W, H, data, pad };
}

// An island's real coastline as a distance field; also sets its box (used by meshing, scattering and culling).
function buildCoast(is, pts) {
  let cx = 0, cz = 0;
  for (const [x, z] of pts) { cx += x; cz += z; }
  cx /= pts.length; cz /= pts.length;
  let sxx = 0, szz = 0, sxz = 0;
  for (const [x, z] of pts) { sxx += (x - cx) ** 2; szz += (z - cz) ** 2; sxz += (x - cx) * (z - cz); }
  const ang = 0.5 * Math.atan2(2 * sxz, sxx - szz), ux = Math.cos(ang), uz = Math.sin(ang);
  let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
  for (const [x, z] of pts) {
    const a = (x - cx) * ux + (z - cz) * uz, b = -(x - cx) * uz + (z - cz) * ux;
    a0 = Math.min(a0, a); a1 = Math.max(a1, a); b0 = Math.min(b0, b); b1 = Math.max(b1, b);
  }
  is.x = cx + ((a0 + a1) / 2) * ux - ((b0 + b1) / 2) * uz;
  is.z = cz + ((a0 + a1) / 2) * uz + ((b0 + b1) / 2) * ux;
  is.rx = (a1 - a0) / 2; is.rz = (b1 - b0) / 2;
  is.rot = -ang; is.cos = Math.cos(is.rot); is.sin = Math.sin(is.rot);
  is.minR = Math.min(is.rx, is.rz); is.maxR = Math.max(is.rx, is.rz);
  is.warpAmp = Math.min(22, is.minR * 0.08); // the real outline already carries the detail
  is.hillRange = Math.min(600, Math.max(40, is.minR * 0.85));
  const pad = Math.min(140, Math.max(60, is.maxR * 0.5)); // beyond the raster the distance is extrapolated
  is.sdf = polySDF(pts, clamp((is.maxR * 2) / 520, 3, 10), pad);
}

const EMPTY = [];
// polynomial smooth max / min (k: blend width in metres)
function smax(a, b, k) { const h = clamp(0.5 + 0.5 * (a - b) / k, 0, 1); return lerp(b, a, h) + k * h * (1 - h); }
function smin(a, b, k) { const h = clamp(0.5 + 0.5 * (b - a) / k, 0, 1); return lerp(b, a, h) - k * h * (1 - h); }

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

export class Terrain {
  constructor(islands) {
    this.noise = new Simplex(1716);
    this._dredge = 0;
    this.islands = islands.map((is) => ({ ...is, cos: Math.cos(is.rot), sin: Math.sin(is.rot) }));
    for (const is of this.islands) {
      buildCoast(is, is.pts);
      // mountain ranges where they really are: [x, z, radius, relative height]
      is.ranges = (is.ranges || []).map(([lon, lat, km, h]) => { const p = geo(lon, lat); return [p.x, p.z, (km * 1000) / 60, h]; });
      is.edits = [];
    }
    // harbours: hand-shaped land and water (at a larger scale than the chart) around each port
    for (const hb of HARBOURS) {
      const is = this.islands.find((i) => i.id === hb.island);
      if (!is) continue;
      const o = geo(...hb.anchor);
      const w = (pts) => pts.map(([a, b]) => [o.x + a, o.z + b]);
      for (const p of hb.water || []) is.edits.push({ kind: 'water', sdf: polySDF(w(p), 2.5, 60) });
      for (const p of hb.land || []) is.edits.push({ kind: 'land', sdf: polySDF(w(p), 2.5, 60) });
      is.hills = (is.hills || []).concat((hb.hills || []).map(([a, b, r, h]) => [o.x + a, o.z + b, r, h]));
    }
    for (const is of this.islands) {
      // world-space box of everything this island can put above the sea floor
      // the coast's extent plus the ~330 m underwater slope (beyond the raster the distance is extrapolated)
      const P = is.sdf.pad - 360;
      let x0 = is.sdf.x0 + P, x1 = is.sdf.x1 - P, z0 = is.sdf.z0 + P, z1 = is.sdf.z1 - P;
      for (const e of is.edits) if (e.kind === 'land') { x0 = Math.min(x0, e.sdf.x0 - 300); x1 = Math.max(x1, e.sdf.x1 + 300); z0 = Math.min(z0, e.sdf.z0 - 300); z1 = Math.max(z1, e.sdf.z1 + 300); }
      is.box = { x0, x1, z0, z1 };
      is.boundR = Math.hypot(x1 - x0, z1 - z0) / 2;
      is.cx = (x0 + x1) / 2; is.cz = (z0 + z1) / 2;
    }
    // coarse grid of which islands can touch each 500 m cell
    this.G = 500; this.GN = Math.ceil((WORLD_HALF * 2) / this.G);
    this.grid = Array.from({ length: this.GN * this.GN }, () => []);
    for (const is of this.islands) {
      const g = (v) => clamp(Math.floor((v + WORLD_HALF) / this.G), 0, this.GN - 1);
      for (let j = g(is.box.z0); j <= g(is.box.z1); j++) for (let i = g(is.box.x0); i <= g(is.box.x1); i++) this.grid[j * this.GN + i].push(is);
    }
    this.buildBanks();
    this.zones = []; // flattened town areas
    this.lastD = 0;
    this.lastIsland = null;
  }

  islandsNear(x, z) {
    const i = Math.floor((x + WORLD_HALF) / this.G), j = Math.floor((z + WORLD_HALF) / this.G);
    if (i < 0 || j < 0 || i >= this.GN || j >= this.GN) return EMPTY;
    return this.grid[j * this.GN + i];
  }

  // The sea floor from the real 200 m depth contour: shelves and banks rise from the deep water to a few
  // metres (the Bahama Banks stay sand-shallow right across; other shelves deepen away from land).
  buildBanks() {
    const C = 40, N = Math.ceil((WORLD_HALF * 2) / C);
    const deep = new Uint8Array(N * N);
    // outside the charted window everything is open ocean
    const nw = geo(-85.2, 30.4), se = geo(-68.0, 16.0);
    const xs = [];
    for (let j = 0; j < N; j++) {
      const z = -WORLD_HALF + (j + 0.5) * C;
      xs.length = 0;
      for (const ring of DEEP) {
        for (let i = 0, k = ring.length - 1; i < ring.length; k = i++) {
          const [xi, zi] = ring[i], [xk, zk] = ring[k];
          if ((zi > z) !== (zk > z)) xs.push(xi + ((z - zi) / (zk - zi)) * (xk - xi));
        }
      }
      xs.sort((p, q) => p - q);
      for (let t = 0; t + 1 < xs.length; t += 2) {
        const i0 = Math.max(0, Math.ceil((xs[t] + WORLD_HALF) / C - 0.5)), i1 = Math.min(N - 1, Math.floor((xs[t + 1] + WORLD_HALF) / C - 0.5));
        for (let i = i0; i <= i1; i++) deep[j * N + i] = 1;
      }
      for (let i = 0; i < N; i++) {
        const x = -WORLD_HALF + (i + 0.5) * C;
        if (x < nw.x || x > se.x || z < nw.z || z > se.z) deep[j * N + i] = 1;
      }
    }
    // distance from each shelf cell to deep water, and to the nearest land
    const BIG = 1e12, dDeep = new Float64Array(N * N), dLand = new Float64Array(N * N);
    for (let k = 0; k < N * N; k++) { dDeep[k] = deep[k] ? 0 : BIG; dLand[k] = BIG; }
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const x = -WORLD_HALF + (i + 0.5) * C, z = -WORLD_HALF + (j + 0.5) * C;
      for (const is of this.islandsNear(x, z)) if (sampleSDF(is.sdf, x, z) > 0) { dLand[j * N + i] = 0; break; }
    }
    edt2d(dDeep, N, N);
    edt2d(dLand, N, N);
    const floor = new Float32Array(N * N);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const k = j * N + i;
      if (deep[k]) { floor[k] = SEA_FLOOR; continue; }
      const x = -WORLD_HALF + (i + 0.5) * C, z = -WORLD_HALF + (j + 0.5) * C;
      const { lon, lat } = lonLat(x, z);
      const bahamas = lon > -79.95 && lat > 20.8;
      const dl = Math.sqrt(dLand[k]) * C, dd = Math.sqrt(dDeep[k]) * C;
      const base = bahamas ? -4.2 : -5 - 9 * smoothstep(250, 1300, dl);
      // fade shelves out toward the edge of the charted window, so they never end in a straight line
      const edge = Math.min(x - nw.x, se.x - x, z - nw.z, se.z - z);
      floor[k] = lerp(SEA_FLOOR, base, smoothstep(0, 160, dd) * smoothstep(0, 900, edge));
    }
    this.bank = { C, N, floor };
  }

  // Signed approximate distance to coast (positive inland) + height for one island.
  _island(is, x, z) {
    const n = this.noise;
    let d = sampleSDF(is.sdf, x, z)
      + n.fbm(x * 0.0032 + is.seed * 31.7, z * 0.0032 - is.seed * 7.3, 3) * is.warpAmp
      + n.noise2(x * 0.03 + is.seed, z * 0.03) * Math.min(6, is.minR * 0.08);
    // harbour shaping is exact: no noise on top of it
    let dw = -1e9;
    for (const e of is.edits) {
      // (evaluated everywhere in the island's box: beyond its raster the distance is extrapolated)
      const v = sampleSDF(e.sdf, x, z) + n.noise2(x * 0.045 + 7, z * 0.045) * 2.2;
      if (e.kind === 'land') d = smax(d, v, 4);
      else { d = smin(d, -v, 4); dw = Math.max(dw, v); }
    }
    let h;
    if (d > 0) {
      const beach = 0.3 + 1.9 * smoothstep(0, 22, d);
      const hillT = smoothstep(16, is.hillRange, d);
      let hills = 0;
      if (hillT > 0) {
        const ridge = n.ridged(x * 0.0036 + is.seed * 3.1, z * 0.0036, 4);
        const roll = n.fbm(x * 0.0022 - is.seed, z * 0.0022, 3) * 0.5 + 0.5;
        hills = is.peak * Math.pow(hillT, 1.3) * (0.3 + 0.55 * ridge * 0.8 + 0.55 * roll);
        if (is.ranges.length) {
          let r = 0.2;
          for (const [rx, rz, rr, rh] of is.ranges) r += rh * Math.exp(-((x - rx) ** 2 + (z - rz) ** 2) / (rr * rr));
          hills *= Math.min(1.15, r);
        }
      }
      if (is.hills) for (const [hx, hz, hr, hh] of is.hills) {
        const q = ((x - hx) ** 2 + (z - hz) ** 2) / (hr * hr);
        if (q < 4) hills += hh * Math.exp(-q * 1.6) * smoothstep(0, 6, d);
      }
      const bumps = n.noise2(x * 0.021, z * 0.021) * 1.4 * smoothstep(12, 40, d);
      h = beach + hills + bumps;
    } else {
      const dd = -d;
      h = 0.3 - 4.5 * smoothstep(0, 26, dd) - 42 * smoothstep(34, 330, dd)
        + n.noise2(x * 0.012, z * 0.012) * 1.5 * (1 - smoothstep(30, 200, dd));
      // dredged harbours and channels: deep enough for a galleon a few metres from the quay
      if (dw > 0) h = Math.min(h, -1.2 - 8 * smoothstep(3, 28, dw));
    }
    this._dredge = dw > 0 ? smoothstep(0, 25, dw) : 0; // harbours are dug deeper than the bank around them
    return { h, d };
  }

  // height of the sea floor from the bank raster (SEA_FLOOR in deep water)
  bankHeight(x, z) {
    const { C, N, floor } = this.bank;
    const fx = (x + WORLD_HALF) / C - 0.5, fz = (z + WORLD_HALF) / C - 0.5;
    if (fx < 0 || fz < 0 || fx >= N - 1 || fz >= N - 1) return SEA_FLOOR;
    const i = fx | 0, j = fz | 0, tx = fx - i, tz = fz - j;
    const a = floor[j * N + i], b = floor[j * N + i + 1], c = floor[(j + 1) * N + i], d = floor[(j + 1) * N + i + 1];
    const h = (a + (b - a) * tx) + ((c + (d - c) * tx) - (a + (b - a) * tx)) * tz;
    if (h <= SEA_FLOOR + 0.01) return SEA_FLOOR;
    return h + (this.noise.noise2(x * 0.004, z * 0.004) * 1.3 + this.noise.noise2(x * 0.03, z * 0.03) * 0.35) * smoothstep(SEA_FLOOR, -12, h);
  }

  baseHeight(x, z) {
    let best = this.bankHeight(x, z);
    let bestD = -1e9;
    let bestIs = null;
    const list = this.islandsNear(x, z);
    for (let i = 0; i < list.length; i++) {
      const is = list[i], b = is.box;
      if (x < b.x0 || x > b.x1 || z < b.z0 || z > b.z1) continue;
      const r = this._island(is, x, z);
      if (r.h > best) { best = r.h; bestD = r.d; bestIs = is; }
      if (this._dredge > 0 && r.h < best) best = lerp(best, r.h, this._dredge);
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

  // Far terrain: one coarse mesh per island in two levels of detail (the near field is covered by
  // TerrainDetail tiles)
  buildMeshes(scene, quality = 'high') {
    this.material = makeTerrainMaterial({ cutFine: true });
    this.meshes = [];
    const budget = quality === 'low' ? 30000 : quality === 'medium' ? 55000 : 90000;
    for (const is of this.islands) {
      const small = is.maxR < 120;
      const margin = small ? is.maxR * 0.6 + 25 : Math.min(150, is.maxR + 90);
      const b = is.box;
      const x0 = Math.max(b.x0, is.x - is.maxR - margin), x1 = Math.min(b.x1, is.x + is.maxR + margin);
      const z0 = Math.max(b.z0, is.z - is.maxR - margin), z1 = Math.min(b.z1, is.z + is.maxR + margin);
      const area = (x1 - x0) * (z1 - z0);
      const cell = Math.max(small ? 5 : clamp(is.maxR / 12, 4, 9), Math.sqrt(area / budget));
      const lod = new THREE.LOD();
      lod.name = 'terrain_' + is.id;
      lod.position.set((x0 + x1) / 2, 0, (z0 + z1) / 2); // LOD distances are measured from here
      const near = this.islandMesh(is, x0, x1, z0, z1, cell);
      lod.addLevel(near, 0);
      // small islands are cheap enough to keep whole; big ones drop to a much coarser mesh in the distance
      if (area / (cell * cell) > 6000) lod.addLevel(this.islandMesh(is, x0, x1, z0, z1, Math.max(cell * 2.6, Math.sqrt(area / (budget / 6)))), 2600);
      else if (small) lod.addLevel(new THREE.Object3D(), 7000); // cays are lost in the haze beyond this
      near.castShadow = is.peak > 30;
      scene.add(lod);
      this.meshes.push(lod);
    }
  }

  islandMesh(is, x0, x1, z0, z1, cell) {
    const col = new THREE.Color();
    const sp = [0, 0, 0, 0];
    const nx = Math.ceil((x1 - x0) / cell) + 1;
    const nz = Math.ceil((z1 - z0) / cell) + 1;
    const pos = new Float32Array(nx * nz * 3);
    const colors = new Float32Array(nx * nz * 3);
    const splat = new Float32Array(nx * nz * 4);
    const hs = new Float32Array(nx * nz);
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const x = x0 + i * cell, z = z0 + j * cell;
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
    geo.translate(-(x0 + x1) / 2, 0, -(z0 + z1) / 2);
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, this.material);
    mesh.receiveShadow = true;
    mesh.name = 'terrain_' + is.id;
    return mesh;
  }

  // Low-res heightmap texture used by the ocean shader (shallows/foam) and the chart.
  bakeHeightmap(size = 1024) {
    const data = new Float32Array(size * size);
    const scale = (WORLD_HALF * 2) / size;
    for (let j = 0; j < size; j++) {
      for (let i = 0; i < size; i++) {
        const x = -WORLD_HALF + (i + 0.5) * scale, z = -WORLD_HALF + (j + 0.5) * scale;
        data[j * size + i] = this.islandsNear(x, z).length ? this.height(x, z) : this.bankHeight(x, z);
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
    for (const [px, pz] of [[x0, z0], [x0 + this.tile, z0], [x0, z0 + this.tile], [x0 + this.tile, z0 + this.tile]]) if (T.islandsNear(px, pz).length) near = true;
    if (!near && T.bankHeight(x0 + this.tile / 2, z0 + this.tile / 2) < -12) return null;
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
