// The four ports laid out after period maps, views and archaeology (see the research notes in the repo
// history): positions are metres from each harbour's anchor (src/game/harbours.js), x east and z south, at a
// compressed town scale; buildings keep their real sizes.
import * as THREE from 'three';
import { T, gableRoofGeometry, hipRoofGeometry } from './builder.js';
import { mulberry32 } from '../core/noise.js';
import { props } from './props.js';
import { spanishHouse, portales, englishHouse, frenchCase, tent, leanTo, palmettoHut, ruin, warehouse, church, footing, PALETTE } from './architecture.js';

const CANNON_YAW = Math.PI; // cannon_01 is modelled muzzle to +Z
const rad = (deg) => (deg * Math.PI) / 180;

// ---------------------------------------------------------------- the kit
export class CityKit {
  constructor(t, B, seed) {
    this.t = t; this.B = B;
    this.rnd = mulberry32(seed);
    this.buildings = []; // { a, b, w, d, rot, info } of houses on the streets, for the dressing pass
    this.paths = []; // paved street segments { a0, b0, a1, b1, width, kind }
    this.blocks = []; this.plazas = [];
  }

  // anchor metres -> town-local (a, b)
  L(x, z) { return this.t.fromAnchor(x, z); }
  // local yaw for a building whose front faces a compass bearing (degrees, 0 = north)
  rot(bearing) { return -rad(bearing) - this.t.dir; }
  // local unit vector for a compass bearing
  dir(bearing) {
    const vx = Math.sin(rad(bearing)), vz = -Math.cos(rad(bearing));
    const t = this.t;
    return { a: vx * t.right.x + vz * t.right.y, b: -(vx * t.sea.x + vz * t.sea.y) };
  }

  // is this oriented footprint on dry, fairly level land and clear of everything placed so far?
  free(a, b, hw, hd, rot, { maxSlope = 3.5, pad = 0.4 } = {}) {
    const t = this.t;
    const c = Math.cos(rot), s = Math.sin(rot);
    let lo = Infinity, hi = -Infinity;
    for (const [x, z] of [[-hw, -hd], [hw, -hd], [-hw, hd], [hw, hd], [0, 0]]) {
      const la = a + x * c + z * s, lb = b - x * s + z * c;
      const w = t.toWorld(la, lb);
      const h0 = t.terrain.baseHeight(w.x, w.z);
      if (h0 < 0.9) return false;
      const h = t.terrain.height(w.x, w.z);
      lo = Math.min(lo, h); hi = Math.max(hi, h);
    }
    if (hi - lo > maxSlope) return false;
    return !t.overlapsRect(a, b, hw + pad, hd + pad, rot);
  }

  claim(a, b, hw, hd, rot) { this.t.reserveRect(a, b, hw, hd, rot); }

  // place a building if its footprint is free; `fn(B, t, rnd, a, b, rot, w, d, opts)`
  put(fn, a, b, rot, w, d, opts, check = {}) {
    if (!this.free(a, b, w / 2, d / 2, rot, check)) return false;
    this.claim(a, b, w / 2, d / 2, rot);
    const info = fn(this.B, this.t, this.rnd, a, b, rot, w, d, opts);
    this.buildings.push({ a, b, w, d, rot, info: info || {} });
    return true;
  }

  // a building that players can enter: door on its front, label and guard post
  special(type, fn, x, z, bearing, w, d, opts = {}) {
    const t = this.t;
    const { a, b } = this.L(x, z);
    const r = this.rot(bearing);
    this.claim(a, b, w / 2, d / 2, r);
    const info = fn(this.B, t, this.rnd, a, b, r, w, d, opts);
    this.buildings.push({ a, b, w, d, rot: r, info: { ...(info || {}), special: type } });
    const f = this.dir(bearing);
    const da = a + f.a * (d / 2 + 1.1), db = b + f.b * (d / 2 + 1.1);
    const y = t.groundAt(da, db);
    t.doors.push({ type, label: opts.label || type, pos: t.toWorld(da, db, y + 0.2) });
    if (type === 'tavern') {
      // a fiddle, a jig and a drink outside the tavern
      const side = { a: -f.b, b: f.a };
      for (let k = 0; k < 3; k++) {
        const o = (k - 1) * 2.4;
        t.spot('dance', da + f.a * (4 + (k % 2)) + side.a * o, db + f.b * (4 + (k % 2)) + side.b * o, r + Math.PI + (k - 1) * 0.5);
      }
    }
    if (type === 'tavern' || type === 'governor') t.guardPosts.push(t.toWorld(da + f.a * 2 + f.b * 3, db + f.b * 2 - f.a * 3, y));
    return { a, b, rot: r, door: { a: da, b: db } };
  }

  // Terraced blocks on a rotated street grid. g: { x, z (anchor origin), bearing (of the "u" streets),
  // bu, bv (block size), su, sv (street widths), i: [i0, i1], j: [j0, j1], depth: [min, max], front: [min, max],
  // house(B, t, rnd, a, b, rot, w, d), skip(i, j) }
  grid(g) {
    const t = this.t, rnd = this.rnd;
    const o = this.L(g.x, g.z);
    const U = this.dir(g.bearing), V = this.dir(g.bearing + 90);
    const blocks = [];
    for (let i = g.i[0]; i <= g.i[1]; i++) for (let j = g.j[0]; j <= g.j[1]; j++) {
      if (g.skip && g.skip(i, j)) continue;
      const cu = i * (g.bu + g.su), cv = j * (g.bv + g.sv);
      const ca = o.a + U.a * cu + V.a * cv, cb = o.b + U.b * cu + V.b * cv;
      blocks.push({ i, j, ca, cb });
      this.blocks.push({ ca, cb });
      if (g.bollards) for (const [su, sv] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        // stone guardacantones on the corners, against cart wheels
        const ba = ca + U.a * su * (g.bu / 2 + 0.3) + V.a * sv * (g.bv / 2 + 0.3), bb = cb + U.b * su * (g.bu / 2 + 0.3) + V.b * sv * (g.bv / 2 + 0.3);
        const w = t.toWorld(ba, bb);
        if (t.terrain.baseHeight(w.x, w.z) < 1) continue;
        this.B.cyl('stone', 0.22, 0.3, 0.9, 8, T(ba, t.groundAt(ba, bb) + 0.35, bb), '#b8ab8c');
      }
      const hu = g.bu / 2, hv = g.bv / 2;
      const d = Math.min(hv, g.depth[0] + rnd() * (g.depth[1] - g.depth[0]));
      // the four sides: [outward normal, run vector, half length, offset of the row centre]
      const sides = [
        [V, U, hu, -1], [V, U, hu, 1], // long sides
        [U, V, hv - d, -1], [U, V, hv - d, 1], // short sides between the corner houses
      ];
      for (const [N, R, half, sgn] of sides) {
        const out = sgn < 0 ? { a: -N.a, b: -N.b } : N; // outward normal of this side
        const off = (N === V ? hv : hu) - d / 2;
        let u = -half;
        while (u < half - 3) {
          const w = Math.min(half - u, g.front[0] + rnd() * (g.front[1] - g.front[0]));
          if (w < 3.5) break;
          const along = u + w / 2;
          const a = ca + out.a * off + R.a * along, b = cb + out.b * off + R.b * along;
          const rot = Math.atan2(-out.a, -out.b);
          if (g.gap && rnd() < g.gap) { u += w; continue; } // burnt or empty lot
          if (this.put(g.house, a, b, rot, w - 0.05, d, g.opts ? g.opts(i, j, a, b) : undefined, { maxSlope: 2.5, pad: -0.3 })) this.doorstep(a, b, rot, d);
          u += w;
        }
      }
    }
    // the street surfaces between the blocks
    if (g.pave) {
      const [kind, col, litter] = g.pave;
      const u0 = g.i[0] * (g.bu + g.su) - (g.bu + g.su) / 2, u1 = (g.i[1] + 1) * (g.bu + g.su) - (g.bu + g.su) / 2;
      const v0 = g.j[0] * (g.bv + g.sv) - (g.bv + g.sv) / 2, v1 = (g.j[1] + 1) * (g.bv + g.sv) - (g.bv + g.sv) / 2;
      const P = (u, v) => [o.a + U.a * u + V.a * v, o.b + U.b * u + V.b * v];
      for (let i = g.i[0]; i <= g.i[1] + 1; i++) {
        const cu = i * (g.bu + g.su) - (g.bu + g.su) / 2;
        this.pave(...P(cu, v0 - g.sv / 2), ...P(cu, v1 + g.sv / 2), g.su + 0.6, kind, col, litter);
      }
      for (let j = g.j[0]; j <= g.j[1] + 1; j++) {
        const cv = j * (g.bv + g.sv) - (g.bv + g.sv) / 2;
        this.pave(...P(u0 - g.su / 2, cv), ...P(u1 + g.su / 2, cv), g.sv + 0.6, kind, col, litter);
      }
    }
    // pedestrians walk the streets between the blocks
    const step = 14;
    for (let i = g.i[0]; i <= g.i[1] + 1; i++) {
      const cu = i * (g.bu + g.su) - (g.bu + g.su) / 2;
      for (let v = g.j[0] * (g.bv + g.sv) - g.bv / 2; v <= g.j[1] * (g.bv + g.sv) + g.bv / 2; v += step) this.node(o.a + U.a * cu + V.a * v, o.b + U.b * cu + V.b * v);
    }
    for (let j = g.j[0]; j <= g.j[1] + 1; j++) {
      const cv = j * (g.bv + g.sv) - (g.bv + g.sv) / 2;
      for (let u = g.i[0] * (g.bu + g.su) - g.bu / 2; u <= g.i[1] * (g.bu + g.su) + g.bu / 2; u += step) this.node(o.a + U.a * u + V.a * cv, o.b + U.b * u + V.b * cv);
    }
    return blocks;
  }

  // life on the doorsteps: a bench against the wall, or neighbours stopped to talk
  doorstep(a, b, rot, d) {
    const t = this.t, rnd = this.rnd;
    const fa = -Math.sin(rot), fb = -Math.cos(rot);
    const r = rnd();
    if (r < 0.07) t.bench(this.B, a + fa * (d / 2 + 0.55), b + fb * (d / 2 + 0.55), rot + Math.PI);
    else if (r < 0.12) {
      const pa = a + fa * (d / 2 + 2.2), pb = b + fb * (d / 2 + 2.2), sa = -fb, sb = fa;
      t.spot('talk', pa + sa * 0.6, pb + sb * 0.6, Math.atan2(sa, sb) + Math.PI);
      t.spot('talk', pa - sa * 0.6, pb - sb * 0.6, Math.atan2(sa, sb));
    }
  }

  // a handcart or mule cart standing loaded, shafts down (a light two-wheeler, about 1.5 m across)
  cart(x, z, bearing, load = 'barrels') {
    const t = this.t, B = this.B, rnd = this.rnd;
    const { a, b } = this.L(x, z);
    const r = this.rot(bearing);
    if (!this.free(a, b, 1.0, 2.1, r)) return;
    // not in the middle of a street where it would block the way
    for (const n of t.streetNodes) if ((n.x - t.toWorld(a, b).x) ** 2 + (n.z - t.toWorld(a, b).z) ** 2 < 2.5 * 2.5) return;
    const c = Math.cos(r), s = Math.sin(r);
    const P = (u, v) => [a + u * c + v * s, b - u * s + v * c];
    const y = t.groundAt(a, b);
    B.box('wood', 1.45, 0.11, 2.3, T(a, y + 0.84, b, r, 1, 1, 1, 0.06), '#7a5a3a');
    for (const u of [-1, 1]) { const [pa, pb] = P(u * 0.72, 0); B.box('wood', 0.07, 0.34, 2.3, T(pa, y + 1.04, pb, r, 1, 1, 1, 0.06), '#6a4a30'); }
    for (const u of [-0.84, 0.84]) { const [pa, pb] = P(u, 0.25); B.cyl('wood', 0.5, 0.5, 0.11, 12, T(pa, y + 0.5, pb, r, 1, 1, 1, 0, Math.PI / 2), '#5a4028'); }
    for (const u of [-0.36, 0.36]) { const [pa, pb] = P(u, -1.9); B.box('wood', 0.08, 0.08, 1.9, T(pa, y + 0.36, pb, r, 1, 1, 1, -0.3), '#6a4a30'); }
    if (load === 'barrels') for (const [u, v] of [[-0.36, -0.5], [0.36, 0.5]]) { const [pa, pb] = P(u, v); t.barrel(B, pa, y + 0.9, pb); }
    else if (load === 'sacks') for (let k = 0; k < 4; k++) { const [pa, pb] = P((k % 2 - 0.5) * 0.7, (k < 2 ? -0.5 : 0.5)); B.add('cloth', new THREE.SphereGeometry(0.33, 8, 6), T(pa, y + 1.08, pb, rnd() * 3, 1.1, 0.6, 1.4), pick2(['#c8b58a', '#b8a47a', '#d6c9a8'], rnd)); }
    else for (let k = 0; k < 4; k++) { const [pa, pb] = P(-0.4 + (k % 3) * 0.4, 0); B.cyl('wood', 0.12, 0.12, 2.0, 6, T(pa, y + 1.02 + (k === 3 ? 0.22 : 0), pb, r, 1, 1, 1, Math.PI / 2), '#8a5a3a'); } // logwood / timber
    t.addCollider(a, b, 0.9, 1.9, r, 1.4);
    this.claim(a, b, 1.0, 2.1, r);
  }

  // a washing line of linen, or sails spread to dry
  laundry(x, z, bearing, len = 7) {
    const t = this.t, B = this.B, rnd = this.rnd;
    const { a, b } = this.L(x, z);
    const r = this.rot(bearing);
    if (!this.free(a, b, len / 2, 0.8, r)) return;
    const c = Math.cos(r), s = Math.sin(r);
    const y = t.groundAt(a, b);
    for (const u of [-len / 2, len / 2]) B.cyl('wood', 0.06, 0.07, 2.4, 5, T(a + u * c, y + 1.2, b - u * s), '#5a4632');
    B.box('wood', len, 0.02, 0.02, T(a, y + 2.3, b, r), '#d8d0bc');
    for (let u = -len / 2 + 0.7; u < len / 2 - 0.5; u += 0.9 + rnd() * 0.5) {
      const w = 0.5 + rnd() * 0.5, h = 0.5 + rnd() * 0.6;
      B.box('cloth', w, h, 0.02, T(a + u * c, y + 2.3 - h / 2, b - u * s, r + (rnd() - 0.5) * 0.2), pick2(['#efe8da', '#e6dcc4', '#c9b48a', '#9fb3c4', '#b5462e', '#efe8da'], rnd));
    }
    this.claim(a, b, len / 2, 0.8, r);
  }

  // A street surface draped over the ground from (a0, b0) to (a1, b1): `kind` 'paving' (cobbles with a
  // central gutter, as in Havana) or 'road' (packed earth, worn in two wheel ruts, damp along the edges), then
  // the street's litter: puddles, straw, dung and loose stones.
  pave(a0, b0, a1, b1, width, kind = 'road', col = '#b09a7c', litter = 1) {
    const t = this.t, B = this.B, rnd = this.rnd;
    const len = Math.hypot(a1 - a0, b1 - b0);
    if (len < 1) return;
    this.paths.push({ a0, b0, a1, b1, width, kind });
    const ua = (a1 - a0) / len, ub = (b1 - b0) / len, na = -ub, nb = ua; // along, across
    const nu = Math.max(1, Math.ceil(len / 2)), nv = 8;
    const base = new THREE.Color(col), tmp = new THREE.Color();
    const pos = [], cols = [];
    const vert = (i, j) => {
      const u = (i / nu) * len, v = (j / nv - 0.5) * width;
      const a = a0 + ua * u + na * v, b = b0 + ub * u + nb * v;
      const w = t.toWorld(a, b);
      const land = t.terrain.baseHeight(w.x, w.z) > 0.9;
      const x = Math.abs(v) / (width / 2);
      let k;
      if (kind === 'paving') k = 1 - 0.28 * Math.exp(-((v / 0.35) ** 2)) - 0.12 * x * x - 0.3 * x ** 8; // gutter down the middle; dark in the lee of the walls
      else k = 1 - 0.14 * Math.exp(-(((Math.abs(v) - 0.8) / 0.25) ** 2)) - 0.18 * x ** 3 - 0.2 * x ** 8; // ruts; damp, trodden edges
      k *= 0.92 + 0.16 * Math.sin(a * 0.37 + b * 0.21) * Math.sin(a * 0.13 - b * 0.29);
      tmp.copy(base).multiplyScalar(k);
      return { p: [a, t.groundAt(a, b) + (kind === 'paving' ? 0.05 : 0.035) - (kind === 'paving' ? 0.04 * Math.exp(-((v / 0.35) ** 2)) : 0), b], c: [tmp.r, tmp.g, tmp.b], land };
    };
    const grid = [];
    for (let i = 0; i <= nu; i++) { const row = []; for (let j = 0; j <= nv; j++) row.push(vert(i, j)); grid.push(row); }
    for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
      const q = [grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]];
      if (!q.every((v) => v.land)) continue;
      for (const k of [0, 2, 1, 0, 3, 2]) { pos.push(...q[k].p); cols.push(...q[k].c); }
    }
    if (!pos.length) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    const out = B.add(kind, g, null, '#ffffff');
    out.attributes.color.array.set(cols);
    // litter
    const n = Math.round(len / 9 * litter);
    for (let k = 0; k < n; k++) {
      const u = rnd() * len, v = (rnd() - 0.5) * width * 0.85;
      const a = a0 + ua * u + na * v, b = b0 + ub * u + nb * v;
      const w = t.toWorld(a, b);
      if (t.terrain.baseHeight(w.x, w.z) < 1 || t.overlapsRect(a, b, 0.5, 0.5, 0)) continue;
      const y = t.groundAt(a, b) + 0.05;
      const r = rnd();
      if (r < 0.2 && kind === 'road') {
        // a puddle in a hollow: still water reflecting the sky
        B.add('window', new THREE.CircleGeometry(0.5 + rnd() * 0.9, 9), T(a, y + 0.01, b, rnd() * 3, 1, 0.45 + rnd() * 0.4, 1, -Math.PI / 2), '#5a5e58');
      } else if (r < 0.45) {
        for (let q = 0; q < 14; q++) B.box('cloth', 0.12 + rnd() * 0.2, 0.008, 0.012, T(a + (rnd() - 0.5) * 0.9, y + 0.005, b + (rnd() - 0.5) * 0.9, rnd() * 3), pick2(['#a08850', '#8a7648', '#b09a60'], rnd)); // spilt straw and fodder
      } else if (r < 0.65) {
        for (let q = 0; q < 3; q++) B.add('plain', new THREE.SphereGeometry(0.09, 5, 3), T(a + (rnd() - 0.5) * 0.4, y, b + (rnd() - 0.5) * 0.4, 0, 1.3, 0.45, 1), '#4a3a26'); // dung
      } else if (r < 0.85) {
        for (let q = 0; q < 4; q++) B.add('stone', new THREE.DodecahedronGeometry(0.08 + rnd() * 0.1, 0), T(a + (rnd() - 0.5) * 1.2, y, b + (rnd() - 0.5) * 1.2, rnd() * 3, 1, 0.6, 1), '#9a8f7c'); // loose stones
      } else {
        // a broken crate board or a gnawed cob
        B.box('wood', 0.7 + rnd() * 0.4, 0.03, 0.14, T(a, y + 0.01, b, rnd() * 3), '#7a6448');
      }
    }
  }

  node(a, b) {
    const t = this.t;
    const w = t.toWorld(a, b);
    const h = t.terrain.height(w.x, w.z);
    if (h > 0.8 && !t.overlapsRect(a, b, 0.6, 0.6, 0)) t.streetNodes.push(new THREE.Vector3(w.x, h, w.z));
  }

  // a street (list of anchor points) with pedestrians along it; `pave`: bucket and colour, or null
  street(pts, width, pave) {
    const L = pts.map(([x, z]) => this.L(x, z));
    for (let k = 0; k + 1 < L.length; k++) {
      const p = L[k], q = L[k + 1];
      const len = Math.hypot(q.a - p.a, q.b - p.b);
      for (let s = 0; s < len; s += 6) {
        const f = (s + 3) / len, a = p.a + (q.a - p.a) * Math.min(f, 1), b = p.b + (q.b - p.b) * Math.min(f, 1);
        if (s % 12 === 0) this.node(a, b);
      }
      // overlap the joints a little so the segments meet without a gap
      const ex = 0.5 / Math.max(len, 1);
      if (pave) this.pave(p.a - (q.a - p.a) * ex, p.b - (q.b - p.b) * ex, q.a + (q.a - p.a) * ex, q.b + (q.b - p.b) * ex, width, pave[0], pave[1], pave[2] ?? 1);
    }
  }

  // paved square with a stone basin, benches and people talking; `market`: awninged stalls round it
  plaza(x, z, bearing, w, d, o = {}) {
    const t = this.t, B = this.B, rnd = this.rnd;
    const { a, b } = this.L(x, z);
    const r = this.rot(bearing);
    const c = Math.cos(r), s = Math.sin(r);
    const P = (u, v) => ({ a: a + u * c + v * s, b: b - u * s + v * c });
    const y = t.groundAt(a, b);
    this.plazas.push({ a, b, r, w, d });
    if (o.pave !== false) B.box(o.pave?.[0] || 'cobble', w, 0.16, d, T(a, y + 0.02, b, r), o.pave?.[1] || '#c9bda4');
    this.claim(a, b, w / 2, d / 2, r);
    if (o.fountain !== false) {
      B.cyl('stone', 2.2, 2.4, 0.8, 16, T(a, y + 0.4, b), '#cfc3a8');
      B.cyl('stone', 0.35, 0.45, 2, 8, T(a, y + 1, b), '#cfc3a8');
      B.cyl('window', 2.0, 2.0, 0.05, 16, T(a, y + 0.72, b), '#6a8a8a');
      t.addCollider(a, b, 2.3, 2.3, 0, 1.5);
    }
    if (o.tree) {
      // a great ceiba shading one corner (the Templete tree)
      const p = P(w * 0.32, -d * 0.3);
      B.cyl('wood', 0.9, 1.3, 7, 10, T(p.a, y + 3.5, p.b), '#6b5d4c');
      for (let k = 0; k < 7; k++) B.add('plain', new THREE.IcosahedronGeometry(3.6 + rnd() * 1.5, 1), T(p.a + (rnd() - 0.5) * 7, y + 8 + rnd() * 3, p.b + (rnd() - 0.5) * 7), pick2(['#3f5f2a', '#4a6a30', '#36552a'], rnd));
      t.addCollider(p.a, p.b, 1.3, 1.3, 0, 8);
    }
    for (let k = 0; k < (o.benches ?? 4); k++) {
      const u = (k % 2 ? 1 : -1) * w * 0.3, v = (k < 2 ? -1 : 1) * d * 0.22;
      const p = P(u, v);
      t.bench(B, p.a, p.b, Math.atan2(a - p.a, b - p.b) + Math.PI);
    }
    for (let k = 0; k < Math.round((w * d) / 250); k++) {
      const p = P((rnd() - 0.5) * w * 0.7, (rnd() - 0.5) * d * 0.7);
      const f = rnd() * Math.PI * 2;
      t.spot('talk', p.a + Math.sin(f) * 0.6, p.b + Math.cos(f) * 0.6, f + Math.PI);
      t.spot('talk', p.a - Math.sin(f) * 0.6, p.b - Math.cos(f) * 0.6, f);
    }
    if (o.market) for (let k = 0; k < o.market; k++) {
      const u = -w / 2 + 3 + ((k % Math.ceil(o.market / 2)) + 0.5) * ((w - 6) / Math.ceil(o.market / 2));
      const v = (k < o.market / 2 ? -1 : 1) * (d / 2 - 3.2);
      const p = P(u, v);
      this.stall(p.a, p.b, r + (v < 0 ? 0 : Math.PI));
    }
    for (let u = -w / 2; u <= w / 2; u += 12) for (const v of [-d / 2 + 1, d / 2 - 1]) { const p = P(u, v); this.node(p.a, p.b); }
    return { a, b, r };
  }

  // a market stall: posts, a counter of goods and a striped awning, with the stallholder at work
  stall(a, b, r) {
    const t = this.t, B = this.B, rnd = this.rnd;
    const y = t.groundAt(a, b);
    const c = Math.cos(r), s = Math.sin(r);
    for (const px of [-1.4, 1.4]) for (const pz of [-0.9, 0.9]) B.cyl('wood', 0.07, 0.07, 2.4, 4, T(a + px * c + pz * s, y + 1.2, b - px * s + pz * c), '#4a3a2a');
    B.box('wood', 3, 0.15, 1.9, T(a, y + 0.95, b, r), '#7a5a3a');
    B.box('cloth', 3.4, 0.06, 2.4, T(a, y + 2.45, b, r, 1, 1, 1, 0.12), pick2(['#b5462e', '#d9c7a0', '#3d6a8a', '#c9a13a', '#6f8a4a', '#e8e0cc'], rnd));
    if (props.has('wicker_basket_01')) {
      const goods = ['wicker_basket_01', 'jug_01', 'wicker_basket_01', 'wooden_bucket_01', 'jug_01'];
      for (let k = 0; k < 4; k++) {
        const g = goods[Math.floor(rnd() * goods.length)];
        t.prop(g, a + (k - 1.5) * 0.7 * c, y + 1.03, b - (k - 1.5) * 0.7 * s, rnd() * 6, g === 'wooden_bucket_01' ? 0.8 : 1.8);
      }
    } else for (let k = 0; k < 4; k++) B.box('plain', 0.5, 0.35, 0.5, T(a + (k - 1.5) * 0.65 * c, y + 1.2, b - (k - 1.5) * 0.65 * s, rnd()), pick2(['#c9a24a', '#8a3a2a', '#6a8a3a', '#d8c8a0'], rnd));
    t.addCollider(a, b, 1.7, 1.1, r, 2.5);
    this.claim(a, b, 1.8, 1.2, r);
    // the stallholder stands behind the counter; customers haggle in front of it
    t.spot('work', a + Math.sin(r) * 1.4, b + Math.cos(r) * 1.4, r + Math.PI);
    for (const k of [-0.8, 0.8]) t.spot('talk', a - Math.sin(r) * 2.1 + Math.cos(r) * k, b - Math.cos(r) * 2.1 - Math.sin(r) * k, r);
  }

  // a square fort with arrowhead bastions; `ruined` knocks it about; returns centre and gun line
  fort(x, z, bearing, size, o = {}) {
    const t = this.t, B = this.B, rnd = this.rnd;
    const { a, b } = this.L(x, z);
    const r = this.rot(bearing);
    const c = Math.cos(r), s = Math.sin(r);
    const P = (u, v) => ({ a: a + u * c + v * s, b: b - u * s + v * c });
    const { lo } = footing(t, a, b, size * 2, size * 2, r);
    const y = o.y ?? lo;
    const wallH = o.wallH ?? 7, col = o.col || '#c2b69b', bucket = o.bucket || 'stone';
    this.claim(a, b, size + 5, size + 5, r);
    const half = size;
    for (const [u, v, len, along] of [[0, -half, half * 2, true], [0, half, half * 2, true], [-half, 0, half * 2, false], [half, 0, half * 2, false]]) {
      const segs = o.ruined ? 5 : 1;
      for (let k = 0; k < segs; k++) {
        if (o.ruined && rnd() < 0.2) continue;
        if (!o.ruined && o.gate && v > 0 && along) { // gate in the landward curtain
          for (const g of [-1, 1]) { const p = P(g * (half / 2 + 1.5), v); B.box(bucket, half - 3, wallH, 2.6, T(p.a, y + wallH / 2 - 0.5, p.b, r), col); t.addCollider(p.a, p.b, (half - 3) / 2, 1.4, r, wallH); }
          break;
        }
        const l = len / segs, off = -len / 2 + l * (k + 0.5);
        const h = o.ruined ? wallH * (0.45 + rnd() * 0.55) : wallH;
        const p = P(u + (along ? off : 0), v + (along ? 0 : off));
        B.box(bucket, along ? l : 2.6, h, along ? 2.6 : l, T(p.a, y + h / 2 - 0.5, p.b, r), col);
        t.addCollider(p.a, p.b, along ? l / 2 : 1.4, along ? 1.4 : l / 2, r, h);
      }
    }
    // parapet cap
    if (!o.ruined) for (const [u, v, len, along] of [[0, -half, half * 2, true], [-half, 0, half * 2, false], [half, 0, half * 2, false]]) { const p = P(u, v); B.box(bucket, along ? len : 3, 0.5, along ? 3 : len, T(p.a, y + wallH - 0.25, p.b, r), o.cap || '#b0a58c'); }
    // bastions: diamonds at the corners, with a gun each and a sentry box (garita) on the seaward pair
    for (const [cu, cv] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const p = P(cu * half, cv * half);
      const bh = o.ruined ? wallH * (0.5 + rnd() * 0.4) : wallH + 0.6;
      B.box(bucket, 8, bh, 8, T(p.a, y + bh / 2 - 0.5, p.b, r + Math.PI / 4), col);
      t.addCollider(p.a, p.b, 4.2, 4.2, r + Math.PI / 4, bh);
      if (o.ruined && rnd() < 0.5) continue;
      const g = P(cu * (half + 1.6), cv * half - 2.2);
      if (!t.prop('cannon_01', g.a, y + bh - 0.1, g.b, r + CANNON_YAW + (cv > 0 ? Math.PI : 0), 1.35)) B.cyl('metal', 0.22, 0.34, 3, 8, T(g.a, y + bh + 0.6, g.b, r, 1, 1, 1, Math.PI / 2), '#1c1c1e');
      if (cv < 0) t.cannons.push(t.toWorld(g.a, g.b, y + bh + 0.6));
      if (cv < 0 && !o.ruined) {
        const gp = P(cu * (half + 2.2), cv * (half + 2.2)); // on the bastion's salient
        B.cyl(bucket, 0.8, 0.8, 2.4, 8, T(gp.a, y + bh + 1.2, gp.b), col);
        B.add(bucket, new THREE.ConeGeometry(1.0, 1.2, 8), T(gp.a, y + bh + 3, gp.b), o.cap || '#b0a58c');
      }
    }
    // seaward gun line
    for (let k = -2; k <= 2; k++) {
      if (o.ruined && rnd() < 0.6) continue;
      const g = P(k * (half / 3), -half - 1.2);
      if (!t.prop('cannon_01', g.a, y + wallH - 0.5, g.b + 0, r + CANNON_YAW, 1.25)) B.cyl('metal', 0.2, 0.3, 2.6, 8, T(g.a, y + wallH + 0.2, g.b, r, 1, 1, 1, Math.PI / 2), '#1c1c1e');
      t.cannons.push(t.toWorld(g.a, g.b, y + wallH + 0.2));
    }
    if (o.moat) {
      const m = half + 9;
      for (const [u, v, len, along] of [[0, -m, m * 2, true], [0, m, m * 2, true], [-m, 0, m * 2, false], [m, 0, m * 2, false]]) { const p = P(u, v); B.box('stone', along ? len : 6, 0.3, along ? 6 : len, T(p.a, y - 2.2, p.b, r), '#8a8270'); }
    }
    // flagstaff and barracks
    const fp = P(0, 0);
    B.cyl('wood', 0.14, 0.2, 16, 6, T(fp.a, y + 8, fp.b), '#3a2a1a');
    t.flagPos = t.toWorld(fp.a, fp.b, y + 15);
    if (!o.ruined) {
      // two-storey barrack: louvred shutters above, barred windows below, a hipped roof
      const bp = P(0, half * 0.35), bw = half * 1.1, bh = 6.4;
      B.box(o.barrackB || 'wall', bw, bh, 6.5, T(bp.a, y + bh / 2, bp.b, r), o.barrackCol || '#efe9dc');
      B.add(o.barrackRoof || 'roof', hipRoofGeometry(bw, 6.5, 2.6, 0.5), T(bp.a, y + bh, bp.b, r), o.barrackRoofCol || '#8a5a40');
      const nwin = Math.max(3, Math.round(bw / 3.2));
      for (let k = 0; k < nwin; k++) {
        const u = -bw / 2 + (k + 0.5) * (bw / nwin);
        for (const side of [-1, 1]) {
          const q = P(u, half * 0.35 + side * 3.27);
          B.box('plain', 1.0, 1.1, 0.08, T(q.a, y + 1.6, q.b, r), '#161310');
          if (k === Math.floor(nwin / 2) && side < 0) { B.box('wood', 1.3, 2.4, 0.1, T(q.a, y + 1.2, q.b, r), '#2a2622'); continue; }
          B.box('window', 0.9, 1.4, 0.08, T(q.a, y + 4.4, q.b, r), '#1d1812');
          for (const sh of [-1, 1]) { const w2 = P(u + sh * 0.75, half * 0.35 + side * 3.3); B.box('wood', 0.5, 1.5, 0.06, T(w2.a, y + 4.4, w2.b, r), o.shutter || '#4d6a4a'); }
        }
      }
      t.addCollider(bp.a, bp.b, bw / 2 + 0.2, 3.4, r, bh);
    }
    t.guardPosts.push(t.toWorld(fp.a - 4 * s, fp.b - 4 * c, y), t.toWorld(P(0, half + 4).a, P(0, half + 4).b, y));
    t.fortPos = t.toWorld(fp.a, fp.b, y);
    return { a, b, y };
  }

  // a low battery: a parapet with embrasures and guns facing `bearing`
  battery(x, z, bearing, len, guns, o = {}) {
    const t = this.t, B = this.B;
    const { a, b } = this.L(x, z);
    const r = this.rot(bearing);
    const c = Math.cos(r), s = Math.sin(r);
    const y = t.groundAt(a, b);
    const col = o.col || '#cfc8b6', bucket = o.bucket || 'stone';
    const P = (u, v) => ({ a: a + u * c + v * s, b: b - u * s + v * c });
    for (let k = 0; k < guns; k++) {
      const u = -len / 2 + (k + 0.5) * (len / guns);
      const g = P(u, 0.8);
      if (!t.prop('cannon_01', g.a, y + 0.1, g.b, r + CANNON_YAW, 1.25)) B.cyl('metal', 0.2, 0.3, 2.6, 8, T(g.a, y + 0.8, g.b, r, 1, 1, 1, Math.PI / 2), '#1c1c1e');
      t.cannons.push(t.toWorld(g.a, g.b, y + 1));
      const m = P(u + len / guns / 2, -1);
      if (k < guns - 1) B.box(bucket, len / guns - 1.6, 1.6, 2, T(m.a, y + 0.5, m.b, r), col); // merlon
    }
    for (const e of [-1, 1]) { const m = P(e * (len / 2), -1); B.box(bucket, 1.6, 1.6, 2, T(m.a, y + 0.5, m.b, r), col); }
    const p = P(0, -1);
    t.addCollider(p.a, p.b, len / 2, 1.1, r, 1.6);
    this.claim(a, b, len / 2 + 1, 3, r);
  }

  // a city wall along anchor points, with pointed bastions at the corners and gaps for gates
  wall(pts, o = {}) {
    const t = this.t, B = this.B;
    const H = o.h ?? 8, th = o.thick ?? 3.2, col = o.col || '#c9b78f';
    const L = pts.map(([x, z]) => this.L(x, z));
    const gates = (o.gates || []).map(([x, z]) => this.L(x, z));
    for (let k = 0; k + 1 < L.length; k++) {
      const p = L[k], q = L[k + 1];
      const len = Math.hypot(q.a - p.a, q.b - p.b), ang = Math.atan2(q.a - p.a, q.b - p.b);
      const n = Math.ceil(len / 12);
      for (let i = 0; i < n; i++) {
        const f = (i + 0.5) / n, a = p.a + (q.a - p.a) * f, b = p.b + (q.b - p.b) * f;
        if (gates.some((g) => Math.hypot(g.a - a, g.b - b) < 7)) continue;
        const w = t.toWorld(a, b);
        if (t.terrain.baseHeight(w.x, w.z) < 0.5) continue;
        const y = t.groundAt(a, b);
        B.box('stone', th, H + 1.5, len / n + 0.3, T(a, y + H / 2 - 0.75, b, ang, 1, 1, 1, 0, 0), col);
        B.box('stone', th + 0.6, 0.5, len / n + 0.3, T(a, y + H - 0.2, b, ang), '#b3a582');
        t.addCollider(a, b, th / 2 + 0.2, len / n / 2 + 0.2, ang - Math.PI / 2 + Math.PI / 2, H);
        this.claim(a, b, th, len / n / 2, ang);
      }
    }
    for (let k = 1; k + 1 < L.length; k++) {
      const p = L[k];
      const y = t.groundAt(p.a, p.b);
      B.add('stone', new THREE.CylinderGeometry(9, 10, H + 2, 5), T(p.a, y + H / 2 - 1, p.b, k * 0.7), col);
      t.addCollider(p.a, p.b, 7, 7, 0, H);
      this.claim(p.a, p.b, 10, 10, 0);
      if (!t.prop('cannon_01', p.a, y + H + 0.9, p.b, k * 0.7, 1.3)) B.cyl('metal', 0.2, 0.3, 2.6, 8, T(p.a, y + H + 1.6, p.b, 0, 1, 1, 1, Math.PI / 2), '#1c1c1e');
    }
    // gate towers
    for (const g of gates) {
      const y = t.groundAt(g.a, g.b);
      for (const s of [-1, 1]) B.box('stone', 4, H + 3, 4, T(g.a + s * 5.5, y + (H + 3) / 2 - 1, g.b), col);
      B.box('stone', 15, 3, 4.2, T(g.a, y + H + 0.5, g.b), col);
    }
  }

  // timber wharf running out from the shore toward `bearing`
  wharf(x, z, bearing, len, width = 5) {
    const t = this.t, B = this.B;
    const { a, b } = this.L(x, z);
    const f = this.dir(bearing);
    const r = Math.atan2(f.a, f.b);
    const deck = 2.2;
    const ma = a + f.a * len / 2, mb = b + f.b * len / 2;
    B.box('wood', width, 0.35, len, T(ma, deck, mb, r), '#8d6c49');
    for (let s = 2; s < len; s += 4.5) for (const k of [-1, 1]) {
      const pa = a + f.a * s + Math.cos(r) * k * (width / 2 - 0.2), pb = b + f.b * s - Math.sin(r) * k * (width / 2 - 0.2);
      B.cyl('wood', 0.26, 0.3, 9, 6, T(pa, deck - 4.3, pb), '#4d3a28');
    }
    const w = t.toWorld(ma, mb);
    const rect = { x: w.x, z: w.z, hw: width / 2, hd: len / 2, cos: Math.cos(t.dir + r), sin: Math.sin(t.dir + r), y: deck + 0.18 };
    t.platforms.push(rect);
    t.shipBlockers.push({ ...rect, hw: rect.hw + 1 });
    t.barrel(B, a + f.a * (len - 3), deck + 0.17, b + f.b * (len - 3));
    return { a, b };
  }

  // stone quay edge along the shore (anchor points), with bollards
  quay(pts, h = 2.6) {
    const t = this.t, B = this.B;
    const L = pts.map(([x, z]) => this.L(x, z));
    for (let k = 0; k + 1 < L.length; k++) {
      const p = L[k], q = L[k + 1];
      const len = Math.hypot(q.a - p.a, q.b - p.b), ang = Math.atan2(q.a - p.a, q.b - p.b);
      B.box('stone', 2.4, h + 4, len + 0.4, T((p.a + q.a) / 2, h / 2 - 2.6, (p.b + q.b) / 2, ang), '#b9ab8c');
      for (let s = 4; s < len; s += 9) {
        const f = s / len;
        B.cyl('metal', 0.2, 0.25, 0.7, 8, T(p.a + (q.a - p.a) * f, h + 0.35, p.b + (q.b - p.b) * f), '#2a2a2a');
      }
    }
  }

  // cargo, barrels and the odd bit of plunder along a waterfront strip
  clutter(pts, n) {
    const t = this.t, rnd = this.rnd;
    const L = pts.map(([x, z]) => this.L(x, z));
    for (let i = 0; i < n; i++) {
      const k = Math.floor(rnd() * (L.length - 1)), f = rnd();
      const a = L[k].a + (L[k + 1].a - L[k].a) * f + (rnd() - 0.5) * 3, b = L[k].b + (L[k + 1].b - L[k].b) * f + (rnd() - 0.5) * 3;
      if (!this.free(a, b, 1.2, 1.2, 0, { pad: 0.2 })) continue;
      const y = t.groundAt(a, b);
      if (rnd() < 0.5) {
        const m = 1 + Math.floor(rnd() * 4);
        for (let q = 0; q < m; q++) t.barrel(this.B, a + (q % 2) * 1.1, y, b + Math.floor(q / 2) * 1.1);
        t.addCollider(a + 0.5, b + 0.5, 1.3, 1.3, 0, 1.2);
      } else { t.cargo(a, y, b); t.addCollider(a, b, 1, 1, 0, 1.4); }
      this.claim(a, b, 1.3, 1.3, 0);
      if (rnd() < 0.35) t.spot('work', a + 1.8, b, rnd() * 6);
    }
  }

  // a well with its stone kerb, windlass and bucket: somebody is always drawing water
  well(x, z) {
    const t = this.t, B = this.B;
    const { a, b } = this.L(x, z);
    if (!this.free(a, b, 2, 2, 0)) return;
    const y = t.groundAt(a, b);
    B.cyl('stone', 1.2, 1.3, 0.9, 12, T(a, y + 0.45, b), '#b8ae98');
    B.cyl('window', 0.95, 0.95, 0.05, 12, T(a, y + 0.6, b), '#2a3a3a');
    for (const k of [-1, 1]) B.box('wood', 0.14, 1.9, 0.14, T(a + k * 1.05, y + 1.3, b), '#4a3a2a');
    B.cyl('wood', 0.1, 0.1, 2.3, 6, T(a, y + 2, b, 0, 1, 1, 1, 0, Math.PI / 2), '#5a4632');
    t.prop('wooden_bucket_01', a + 1.6, y, b + 0.4, 0.5, 1);
    t.addCollider(a, b, 1.3, 1.3, 0, 1);
    t.spot('work', a, b + 1.8, Math.PI);
    t.spot('talk', a + 1.7, b - 1.2, -2.2);
    t.spot('talk', a - 1.7, b - 1.2, 2.2);
    this.claim(a, b, 2, 2, 0);
  }

  // a cook fire with logs to sit on
  fire(x, z) {
    const t = this.t, B = this.B;
    const { a, b } = this.L(x, z);
    if (!this.free(a, b, 2.5, 2.5, 0)) return;
    const y = t.groundAt(a, b);
    for (let k = 0; k < 6; k++) B.box('wood', 1.2, 0.18, 0.18, T(a, y + 0.12, b, (k / 6) * Math.PI), '#3a2a1a');
    B.box('stone', 1.6, 0.2, 1.6, T(a, y + 0.05, b, 0.4), '#5a5048');
    B.box('glow', 0.7, 0.12, 0.7, T(a, y + 0.2, b, 0.7), '#ff7a30'); // embers
    t.fires.push(t.toWorld(a, b, y + 0.4));
    t.lanterns.push(t.toWorld(a, b, y + 0.8));
    for (let k = 0; k < 3; k++) {
      const ang = (k / 3) * Math.PI * 2 + 0.4, la = a + Math.sin(ang) * 2.4, lb = b + Math.cos(ang) * 2.4;
      B.cyl('wood', 0.22, 0.22, 1.8, 6, T(la, y + 0.22, lb, ang + Math.PI / 2, 1, 1, 1, 0, Math.PI / 2), '#5a4632');
      t.spot(k === 0 ? 'sitTalk' : 'sit', la - Math.sin(ang) * 0.2, lb - Math.cos(ang) * 0.2, ang + Math.PI);
    }
    this.claim(a, b, 3, 3, 0);
  }
}

function pick2(arr, rnd) { return arr[Math.floor(rnd() * arr.length) % arr.length]; }
const R = (rnd, lo, hi) => lo + rnd() * (hi - lo);

// ---------------------------------------------------------------- Nassau, 1716
// A beach camp of the Brethren under a scrubby ridge: sailcloth tents, driftwood lean-tos and palmetto huts
// strung along the one real street (Bay Street), the ruined Fort Nassau at the west end, a handful of stone
// houses gutted in 1703, plunder being sold off the beach, and careened sloops at the east end.
function nassau(K) {
  const t = K.t, rnd = K.rnd;
  // Bay Street along the shore
  K.street([[-190, 2], [-60, 0], [0, 2], [120, 6], [240, 10]], 9, ['road', '#cdbb98', 1.4]); // sand and crushed shell
  // the ruined fort at the west end, its seaward bastions over the water's edge
  K.fort(-118, 6, 0, 17, { ruined: true, wallH: 4.5, col: '#b8b09c' });
  t.pier(0, { len: 34 });
  K.wharf(95, -4, 0, 22, 3.5);
  // the Council of Captains meets in the least ruinous stone house; Christ Church is a shell
  K.special('governor', (B, t2, r, a, b, rot, w, d) => { ruin(B, t2, r, a, b, rot, w, d, '#e0d8c6'); roofedRuin(B, t2, a, b, rot, w, d); }, -62, 34, 0, 14, 8, { label: 'Council of Captains' });
  K.put(ruin, ...Object.values(K.L(-28, 58)), K.rot(0), 18, 9);
  K.special('tavern', tavernShack, 38, 20, 0, 12, 8, { label: 'Tavern' });
  K.special('merchant', (B, t2, r, a, b, rot, w, d) => warehouse(B, t2, r, a, b, rot, w, d, { bucket: 'clap', col: '#8b7355', roof: 'thatch', roofCol: '#a8955f', h: 3.6 }), 78, 22, 0, 14, 9, { label: 'Fence & Trader' });
  K.special('shipwright', careening, 205, 4, 0, 14, 10, { label: 'Careening Beach' });
  // plunder sold off the beach
  K.clutter([[50, -6], [150, -2]], 18);
  K.clutter([[-60, -8], [-10, -6]], 6);
  // the camp: denser east of the landing
  for (let i = 0; i < 320; i++) {
    const x = R(rnd, -170, 235), z = 8 + Math.pow(rnd(), 1.4) * 85; // thickest near the beach
    const { a, b } = K.L(x, z);
    const face = K.rot(R(rnd, -40, 40) + (rnd() < 0.2 ? 180 : 0));
    const k = rnd();
    if (k < 0.5) K.put(tent, a, b, face, R(rnd, 3, 4.5), R(rnd, 3.5, 5.5), undefined, { maxSlope: 2.5 });
    else if (k < 0.7) K.put(leanTo, a, b, face, R(rnd, 3, 4), R(rnd, 2.5, 3.5), undefined, { maxSlope: 2.5 });
    else if (k < 0.93) K.put(palmettoHut, a, b, face, R(rnd, 4, 6), R(rnd, 5, 7.5), undefined, { maxSlope: 3 });
    else K.put(ruin, a, b, face, R(rnd, 7, 10), R(rnd, 5, 6));
  }
  for (const [x, z] of [[-40, 20], [60, 45], [130, 30], [185, 60], [-150, 60], [10, 80], [100, 75]]) K.fire(x, z);
  // turtle crawl in the shallows
  crawl(K, 150, -22);
  for (const [x, z] of [[-30, 40], [150, 50]]) K.well(x, z);
  // sails spread to dry and washing between the huts
  for (const [x, z, br] of [[-90, 70, 80], [70, 60, 100], [160, 45, 90], [-20, 85, 70], [200, 75, 95]]) K.laundry(x, z, br, 6 + rnd() * 3);
  K.cart(20, 14, 90, 'barrels');
  // lanes up toward the ridge
  K.street([[0, 2], [0, 90]], 5, ['road', '#c8b694', 1]);
  K.street([[120, 6], [115, 90]], 5, ['road', '#c8b694', 1]);
}

// ---------------------------------------------------------------- La Habana, c.1716
// The walled city on its peninsula: the Castillo de la Real Fuerza and the Plaza de Armas with the Parroquial
// Mayor by the channel; the Plaza de San Francisco open to the harbour with its convent church and tall tower;
// the arcaded Plaza Vieja market; a grid of limewashed one- and two-storey houses; the landward wall with its
// bastions and the Puerta de Tierra; La Punta at the mouth and the Morro on its rock across the channel.
function havana(K) {
  const t = K.t, rnd = K.rnd;
  // the castles
  K.fort(-50, 30, 80, 17, { moat: true, wallH: 8.5, col: '#c9b78f', cap: '#b3a582', barrackCol: '#efe6d0' }); // Real Fuerza
  giraldilla(K, -50 - 15, 30 - 16);
  K.fort(-68, -30, 10, 12, { wallH: 7, col: '#c2b08a', cap: '#b3a582' }); // La Punta
  morro(K);
  // plazas and their churches
  K.plaza(-92, 82, 260, 40, 34, { tree: true, fountain: false });
  K.special('governor', (B, t2, r, a, b, rot, w, d) => spanishHouse(B, t2, r, a, b, rot, w, d, { storeys: 2, balcony: true, wall: '#f3eee2' }), -96, 108, 0, 26, 12, { label: 'Casa del Gobernador' });
  church(K.B, t, rnd, ...Object.values(K.L(-58, 86)), K.rot(260), { len: 34, wid: 13, towerH: 24, tower: 'side' });
  K.claim(...Object.values(K.L(-58, 86)), 10, 20, K.rot(260));
  K.plaza(-112, 186, 80, 34, 30, { fountain: true, pave: ['cobble', '#cfc3a8'] }); // San Francisco, open to the bay
  const sf = K.L(-118, 232);
  church(K.B, t, rnd, sf.a, sf.b, K.rot(80), { len: 44, wid: 16, h: 12, towerH: 38, tower: 'side', dome: true, tiers: 3 });
  K.claim(sf.a, sf.b, 14, 24, K.rot(80));
  cloister(K, -158, 240, 80);
  K.plaza(-196, 222, 0, 40, 36, { market: 8, fountain: true, pave: ['cobble', '#c9bda4'] }); // Plaza Vieja
  // arcaded houses round the Plaza Vieja
  for (const [x, z, br] of [[-196, 196, 180], [-196, 248, 0], [-224, 222, 90], [-168, 222, 270]]) {
    const { a, b } = K.L(x, z);
    const f = K.dir(br);
    const side = { a: -f.b, b: f.a };
    for (let k = -1; k <= 1; k++) K.put(portales, a + side.a * k * 12.2 - f.a * 2, b + side.b * k * 12.2 - f.b * 2, K.rot(br), 12, 13);
  }
  // the other churches and convents that give the skyline its towers (Espíritu Santo, Santa Clara, Paula,
  // Santo Domingo, Santo Cristo)
  for (const [x, z, br, len, tw] of [[-250, 330, 80, 26, 22], [-236, 120, 170, 30, 26], [-150, 418, 60, 24, 20], [-190, 40, 80, 28, 24], [-270, 220, 350, 24, 20]]) {
    const c = K.L(x, z);
    if (!K.free(c.a, c.b, 7, len / 2 + 2, K.rot(br))) continue;
    church(K.B, t, rnd, c.a, c.b, K.rot(br), { len, wid: 11, h: 9, towerH: tw, tower: 'side', tiers: 2 });
    K.claim(c.a, c.b, 9, len / 2 + 3, K.rot(br));
  }
  K.special('tavern', (B, t2, r, a, b, rot, w, d) => spanishHouse(B, t2, r, a, b, rot, w, d, { storeys: 2, balcony: true }), -62, 150, 80, 13, 11, { label: 'Taberna' });
  K.special('merchant', (B, t2, r, a, b, rot, w, d) => warehouse(B, t2, r, a, b, rot, w, d, { col: '#e8dcc0', roofCol: '#a85e3a', h: 7 }), -128, 290, 60, 24, 12, { label: 'Almacén (Merchant)' });
  K.special('shipwright', shipyard, -162, 392, 60, 16, 22, { label: 'Astillero (Shipwright)' });
  // the city wall on the landward side, with the Puerta de Tierra
  K.wall([[-300, -72], [-318, 60], [-310, 200], [-270, 330], [-205, 420], [-150, 448]], { gates: [[-316, 150]] });
  // the grid, aligned with the channel (the real one runs 17° off north, like the channel)
  const houseFor = (B, t2, r, a, b, rot, w, d, o) => spanishHouse(B, t2, r, a, b, rot, w, d, o);
  K.grid({
    x: -150, z: 120, bearing: 350, bu: 34, bv: 30, su: 6.5, sv: 6, i: [-5, 6], j: [-3, 5], depth: [9, 13], front: [6.5, 11],
    house: houseFor, opts: () => ({ storeys: rnd() < 0.5 ? 2 : 1 }), bollards: true, pave: ['paving', '#b4a68e', 0.8],
  });
  // waterfront: quays along the channel and bay, jetties, cargo
  K.quay([[-14, 10], [-4, 60], [6, 110], [-20, 150], [-45, 165], [-75, 190], [-95, 215], [-112, 245], [-135, 290], [-155, 335]]);
  t.pier(0, { len: 30 });
  for (const [x, z, br] of [[-30, 160, 80], [-120, 262, 70], [-145, 318, 70]]) K.wharf(x, z, br, 22, 4.5);
  K.clutter([[-10, 40], [0, 100], [-40, 165], [-95, 212], [-140, 300]], 26);
  // carts of sugar, tobacco and timber on the quays and at the market
  for (const [x, z, br, l] of [[-30, 120, 170, 'barrels'], [-78, 205, 80, 'sacks'], [-150, 360, 60, 'timber'], [-180, 250, 0, 'sacks'], [-120, 150, 170, 'barrels']]) K.cart(x, z, br, l);
  for (const [x, z, br] of [[-360, 60, 10], [-380, 250, 5], [-350, 330, 30]]) K.laundry(x, z, br, 6);
  // bohíos beyond the walls
  for (let i = 0; i < 26; i++) {
    const { a, b } = K.L(R(rnd, -420, -330), R(rnd, -40, 380));
    K.put(palmettoHut, a, b, K.rot(R(rnd, 0, 360)), R(rnd, 4, 5.5), R(rnd, 5, 6.5));
  }
}

// ---------------------------------------------------------------- Port Royal, c.1716
// What the earthquake and the fire of 1703 left: a compact brick town on the tip of the Palisadoes, Fort Charles
// at the point, Thames Street along the harbour lined with wharves, Queen and High Streets behind it, St Peter's
// church, the naval careening wharf at the east end and a battery along the sea front. Burnt lots gape between
// the terraces.
function portRoyal(K) {
  const t = K.t, rnd = K.rnd;
  // Fort Charles: brick on stone, a two-storey barrack with a hipped roof inside (as it stands today)
  K.fort(-690, 172, 270, 20, { wallH: 6, bucket: 'brick', col: '#a5563a', cap: '#8f4a33', barrackCol: '#f2ede2', barrackRoof: 'shingle', barrackRoofCol: '#4a4038' });
  K.special('governor', (B, t2, r, a, b, rot, w, d) => englishHouse(B, t2, r, a, b, rot, w, d, { storeys: 2, piazza: true }), -638, 150, 0, 12, 9, { label: 'Commandant\'s House' });
  const sp = K.L(-500, 158);
  church(K.B, t, rnd, sp.a, sp.b, K.rot(270), { len: 26, wid: 11, h: 8, towerH: 18, tower: 'front', bucket: 'brick', wall: '#a0522d', roofB: 'shingle', roofCol: '#5c4a3c', spire: true });
  K.claim(sp.a, sp.b, 9, 17, K.rot(270));
  K.special('tavern', (B, t2, r, a, b, rot, w, d) => englishHouse(B, t2, r, a, b, rot, w, d, { storeys: 2, piazza: true }), -585, 118, 0, 12, 10, { label: 'Tavern' });
  K.special('merchant', (B, t2, r, a, b, rot, w, d) => warehouse(B, t2, r, a, b, rot, w, d, { bucket: 'brick', col: '#a8583e', roof: 'shingle', roofCol: '#5c4a3c', h: 6.4 }), -470, 116, 0, 20, 10, { label: 'Merchant\'s Warehouse' });
  K.special('shipwright', shipyard, -405, 128, 0, 16, 22, { label: 'Naval Careening Wharf' });
  K.well(-545, 168);
  // Thames, Queen and High Streets with their terraces
  K.grid({
    x: -560, z: 150, bearing: 90, bu: 30, bv: 26, su: 9, sv: 8, i: [-3, 4], j: [-1, 1], depth: [9, 12], front: [5.5, 8],
    house: (B, t2, r, a, b, rot, w, d, o) => englishHouse(B, t2, r, a, b, rot, w, d, o), gap: 0.12, pave: ['road', '#c2ae8c', 1.2],
  });
  // the sea-front battery and a palisade across the spit
  K.battery(-610, 222, 180, 40, 6, { bucket: 'brick', col: '#a5563a' });
  K.battery(-470, 208, 180, 34, 5, { bucket: 'brick', col: '#a5563a' });
  // harbour front: the main pier and merchant wharves along Thames Street
  t.pier(0, { len: 30 });
  for (const x of [-640, -600, -500, -440]) K.wharf(x, 98, 0, 20, 4.5);
  K.clutter([[-660, 104], [-560, 100], [-420, 106]], 22);
  for (const [x, z, br, l] of [[-620, 108, 90, 'barrels'], [-520, 106, 90, 'sacks'], [-455, 110, 90, 'timber']]) K.cart(x, z, br, l);
  // a few frame shanties out along the spit
  for (let i = 0; i < 10; i++) {
    const { a, b } = K.L(R(rnd, -380, -200), R(rnd, 150, 175));
    K.put(englishHouse, a, b, K.rot(0), R(rnd, 5, 7), R(rnd, 6, 8), { frame: true, storeys: 1 });
  }
}

// ---------------------------------------------------------------- Cayona (Basse-Terre), Tortuga
// A single street of cases along the beach under steep hills, a battery at each end, the chapel and the
// commandant's house in the middle, Blondel's battery and round tower on the slope above, and the old Fort de
// la Roche on its crag. Buccaneers smoke meat on boucans at the west end.
function cayona(K) {
  const t = K.t, rnd = K.rnd;
  K.street([[-215, 56], [-100, 54], [0, 52], [100, 50], [215, 52]], 7, ['road', '#b89c7c', 1.2]);
  for (const x of [-70, 50, 130]) K.street([[x, 52], [x + 6, 5]], 4, ['road', '#b89c7c', 1]);
  K.battery(-212, 64, 180, 26, 4);
  K.battery(212, 60, 180, 26, 4);
  t.pier(0, { len: 32 });
  K.special('governor', (B, t2, r, a, b, rot, w, d) => frenchCase(B, t2, r, a, b, rot, w, d, { tall: true, gallery: true, thatch: false }), 8, 36, 180, 16, 8, { label: 'Maison du Gouverneur' });
  const ch = K.L(-18, 38);
  church(K.B, t, rnd, ch.a, ch.b, K.rot(180), { len: 15, wid: 7, h: 5, towerH: 0, cote: true, roofB: 'shingle', roofCol: '#6d5a48', wall: '#efeae0' });
  K.claim(ch.a, ch.b, 4.5, 8.5, K.rot(180));
  K.special('tavern', (B, t2, r, a, b, rot, w, d) => frenchCase(B, t2, r, a, b, rot, w, d, { gallery: true }), -48, 40, 180, 12, 8, { label: 'Cabaret' });
  K.special('merchant', (B, t2, r, a, b, rot, w, d) => warehouse(B, t2, r, a, b, rot, w, d, { bucket: 'clap', col: '#8a7a62', roof: 'shingle', roofCol: '#6d5a48', h: 4 }), 70, 38, 180, 14, 9, { label: 'Négociant (Merchant)' });
  K.special('shipwright', careening, -150, 72, 180, 14, 10, { label: 'Charpentier (Shipwright)' });
  // cases along both sides of the street, then scattered up the slope among gardens
  for (let x = -205; x < 205; x += R(rnd, 9, 14)) {
    for (const side of [-1, 1]) {
      const z = side < 0 ? R(rnd, 38, 44) : R(rnd, 64, 68);
      const { a, b } = K.L(x, z);
      K.put(frenchCase, a, b, K.rot(side < 0 ? 180 : 0), R(rnd, 5, 7), R(rnd, 7, 9), undefined, { maxSlope: 3.5 });
    }
  }
  for (let i = 0; i < 26; i++) {
    const { a, b } = K.L(R(rnd, -200, 200), R(rnd, -10, 32));
    K.put(frenchCase, a, b, K.rot(R(rnd, 160, 200)), R(rnd, 5, 6.5), R(rnd, 6.5, 8), undefined, { maxSlope: 4.5 });
  }
  // Blondel's battery and round tower on the slope; the old Fort de la Roche on its crag
  blondel(K, 60, 8);
  laRoche(K, -70, -20);
  // buccaneers' boucans at the west end
  for (const [x, z] of [[-175, 40], [-130, 30], [-190, 24]]) boucan(K, x, z);
  K.clutter([[-120, 68], [120, 66]], 12);
  for (const [x, z, br] of [[-110, 30, 95], [150, 32, 85], [-160, 50, 100]]) K.laundry(x, z, br, 5 + rnd() * 2);
  K.cart(95, 60, 100, 'sacks');
  K.well(-100, 48); K.well(110, 46);
}

// ---------------------------------------------------------------- landmarks and set pieces
function roofedRuin(B, t, a, b, rot, w, d) {
  // a sailcloth roof thrown over the best-kept ruin: the pirates' council house
  B.add('cloth', gableRoofGeometry(w, d, 2.2, 0.3), T(a, t.groundAt(a, b) + 3.8, b, rot), '#cfc1a2');
}

function tavernShack(B, t, rnd, a, b, rot, w, d) {
  // a plank grog shop with a sail awning over barrels and benches
  warehouse(B, t, rnd, a, b, rot, w, d, { bucket: 'clap', col: '#8b7355', roof: 'thatch', roofCol: '#9c8b5e', h: 3.4 });
  const c = Math.cos(rot), s = Math.sin(rot);
  const fa = a - s * (d / 2 + 2), fb = b - c * (d / 2 + 2);
  const y = t.groundAt(fa, fb);
  B.box('cloth', w, 0.05, 4, T(fa, y + 3, fb, rot, 1, 1, 1, 0.12), '#d8cbb0');
  for (const k of [-1, 1]) B.cyl('wood', 0.08, 0.08, 3, 5, T(fa + c * k * (w / 2 - 0.3) - s * 1.8, y + 1.5, fb - s * k * (w / 2 - 0.3) - c * 1.8), '#4a3a2a');
  t.barrel(B, fa + c * (w / 2 - 1), y, fb - s * (w / 2 - 1));
  t.barrel(B, fa + c * (w / 2 - 2.1), y, fb - s * (w / 2 - 2.1));
}

function careening(B, t, rnd, a, b, rot, w, d) {
  // a sloop hove down on the beach, tar kettle smoking, spars and planks about
  const y = t.groundAt(a, b);
  const hull = new THREE.SphereGeometry(1, 16, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
  B.add('wood', hull, T(a, y + 1.2, b, rot + Math.PI / 2, 2.6, 2.4, 9, 0, 1.0), '#3a2c22');
  B.cyl('wood', 0.16, 0.2, 13, 6, T(a + Math.cos(rot) * 2, y + 3.4, b - Math.sin(rot) * 2, rot, 1, 1, 1, 0, 1.25), '#5a4632');
  for (let k = 0; k < 6; k++) B.box('wood', 0.3, 0.25, 5, T(a + Math.cos(rot) * (w / 2 - 1) + k * 0.35, y + 0.15 + (k % 2) * 0.25, b + 3, rot + 0.1), '#9a7a52');
  B.cyl('metal', 0.55, 0.45, 0.7, 10, T(a - Math.cos(rot) * 4, y + 0.5, b + 2), '#1c1c1c');
  t.fires.push(t.toWorld(a - Math.cos(rot) * 4, b + 2, y + 0.9));
  t.addCollider(a, b, 2.5, 5, rot + Math.PI / 2, 3);
  t.spot('work', a + Math.cos(rot) * 3.5, b - Math.sin(rot) * 3.5, rot + Math.PI / 2);
  t.spot('work', a - Math.cos(rot) * 3, b + Math.sin(rot) * 3 + 1, rot - Math.PI / 2);
}

function shipyard(B, t, rnd, a, b, rot, w, d) {
  // an open timber shed over a hull on the stocks
  const c = Math.cos(rot), s = Math.sin(rot);
  const P = (u, v) => [a + u * c + v * s, b - u * s + v * c];
  const y = t.groundAt(a, b);
  for (const su of [-1, 1]) for (const sv of [-1, 0, 1]) { const [pa, pb] = P(su * w / 2, sv * d / 2); B.box('wood', 0.5, 8, 0.5, T(pa, y + 4, pb), '#5a4330'); }
  B.add('roof', gableRoofGeometry(d, w, 3.2, 0.8), T(a, y + 8, b, rot + Math.PI / 2), '#a85e3a');
  const hull = new THREE.SphereGeometry(1, 16, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
  B.add('wood', hull, T(a, y + 3.4, b, rot, 2.6, 2.8, d * 0.42), '#6b4a2e');
  for (let k = -3; k <= 3; k++) { const [pa, pb] = P(0, k * d * 0.12); B.box('wood', 6, 0.14, 0.22, T(pa, y + 2.5 + Math.abs(k) * 0.12, pb, rot), '#8a6a48'); }
  for (let k = 0; k < 7; k++) { const [pa, pb] = P(w / 2 + 2 + k * 0.45, 0); B.box('wood', 0.4, 0.4, 8, T(pa, y + 0.2 + (k % 2) * 0.4, pb, rot + 0.05), '#9a7a52'); }
  t.addCollider(a, b, 3, d * 0.44, rot, 5);
  t.spot('work', ...P(-3.6, d * 0.2), rot + Math.PI / 2);
  t.spot('work', ...P(3.6, -d * 0.2), rot - Math.PI / 2);
}

function giraldilla(K, x, z) {
  // the watchtower on the Real Fuerza's bastion, topped by the bronze Giraldilla weathervane
  const t = K.t, B = K.B;
  const { a, b } = K.L(x, z);
  const y = t.groundAt(a, b);
  B.box('stone', 5, 12, 5, T(a, y + 8, b, 0.3), '#c9b78f');
  B.box('stone', 5.8, 0.5, 5.8, T(a, y + 14, b, 0.3), '#b3a582');
  B.cyl('stone', 1.8, 2.2, 4, 8, T(a, y + 16, b), '#c9b78f');
  B.add('stone', new THREE.ConeGeometry(2.1, 2.5, 8), T(a, y + 19.2, b), '#b3a582');
  B.cyl('metal', 0.08, 0.08, 2, 5, T(a, y + 21.4, b), '#6b5a3a');
  B.box('metal', 0.5, 1.1, 0.12, T(a, y + 22.6, b), '#9a7a40');
}

function morro(K) {
  // Castillo de los Tres Reyes del Morro: curtain walls wrapped round the headland, its seaward bastions over
  // the cliffs, and the stone watchtower and beacon at the point
  const t = K.t, B = K.B;
  const pts = [[100, -92], [135, -110], [185, -106], [222, -78], [218, -30], [180, 12], [120, 22], [100, -20]];
  const L = pts.map(([x, z]) => K.L(x, z));
  let top = 0;
  for (const p of L) top = Math.max(top, t.groundAt(p.a, p.b));
  for (let k = 0; k < L.length; k++) {
    const p = L[k], q = L[(k + 1) % L.length];
    const len = Math.hypot(q.a - p.a, q.b - p.b), ang = Math.atan2(q.a - p.a, q.b - p.b);
    const n = Math.ceil(len / 10);
    for (let i = 0; i < n; i++) {
      const f = (i + 0.5) / n, a = p.a + (q.a - p.a) * f, b = p.b + (q.b - p.b) * f;
      const g = t.groundAt(a, b);
      const h = Math.max(6, top + 8 - g);
      B.box('stone', 3.6, h + 4, len / n + 0.4, T(a, g + h / 2 - 2, b, ang), '#bba880');
      B.box('stone', 4.2, 0.6, len / n + 0.4, T(a, g + h - 0.3, b, ang), '#a89872');
      t.addCollider(a, b, 1.9, len / n / 2, ang, h);
      if (k < 4 && i % 2 === 0) {
        const out = K.dir(0);
        if (!t.prop('cannon_01', a, g + h + 0.1, b, ang + Math.PI / 2 + CANNON_YAW, 1.3)) B.cyl('metal', 0.2, 0.3, 2.6, 8, T(a, g + h + 0.8, b, ang, 1, 1, 1, Math.PI / 2), '#1c1c1e');
        t.cannons.push(t.toWorld(a + out.a * 2, b + out.b * 2, g + h + 0.8));
      }
    }
  }
  // the tower and beacon at the northern tip
  const tp = K.L(150, -100);
  const g = t.groundAt(tp.a, tp.b);
  B.cyl('stone', 3, 3.6, top + 22 - g, 10, T(tp.a, (g + top + 22) / 2, tp.b), '#c9b78f');
  B.cyl('stone', 3.6, 3.6, 0.6, 10, T(tp.a, top + 22.3, tp.b), '#a89872');
  B.box('glow', 1.4, 1.4, 1.4, T(tp.a, top + 23.4, tp.b), '#ffcf80');
  t.lanterns.push(t.toWorld(tp.a, tp.b, top + 23.4));
  K.claim(...Object.values(K.L(160, -40)), 70, 70, 0);
}

function cloister(K, x, z, bearing) {
  // the Franciscan convent: a two-storey range round a cloister garth
  const t = K.t, B = K.B, rnd = K.rnd;
  const { a, b } = K.L(x, z);
  const r = K.rot(bearing);
  const c = Math.cos(r), s = Math.sin(r);
  const y = t.groundAt(a, b);
  const S = 30, W = 7;
  for (const [u, v, len, along] of [[0, -S / 2, S, true], [0, S / 2, S, true], [-S / 2, 0, S, false], [S / 2, 0, S, false]]) {
    const pa = a + u * c + v * s, pb = b - u * s + v * c;
    B.box('wall', along ? len : W, 9, along ? W : len, T(pa, y + 4.3, pb, r), '#efe6d2');
    B.add('roof', gableRoofGeometry(along ? len + W : W, along ? W : len + W, 2.2, 0.4), T(pa, y + 8.8, pb, r + (along ? 0 : Math.PI / 2)), '#a5593a');
    t.addCollider(pa, pb, along ? len / 2 : W / 2, along ? W / 2 : len / 2, r, 9);
  }
  // cloister garden
  B.box('plain', S - W * 2, 0.1, S - W * 2, T(a, y + 0.05, b, r), '#5f7a3a');
  for (let k = 0; k < 4; k++) B.add('plain', new THREE.IcosahedronGeometry(1.6, 1), T(a + (rnd() - 0.5) * 8, y + 2, b + (rnd() - 0.5) * 8), '#3f6a2a');
  K.claim(a, b, S / 2 + 1, S / 2 + 1, r);
}

function blondel(K, x, z) {
  // Blondel's battery wall of 1667 with its embrasures, and the round tower at its east end
  const t = K.t, B = K.B;
  K.battery(x - 8, z, 180, 40, 6, { col: '#d2cab5' });
  const { a, b } = K.L(x + 18, z - 4);
  const y = t.groundAt(a, b);
  B.cyl('stone', 4.75, 5, 10, 16, T(a, y + 4.5, b), '#d2cab5');
  for (let k = 0; k < 10; k++) { const ang = (k / 10) * Math.PI * 2; B.box('stone', 1.2, 1.1, 0.8, T(a + Math.sin(ang) * 4.5, y + 10, b + Math.cos(ang) * 4.5, ang), '#c8bfa8'); }
  t.addCollider(a, b, 4.8, 4.8, 0, 10);
  K.claim(a, b, 6, 6, 0);
  B.cyl('wood', 0.12, 0.16, 12, 6, T(a, y + 15, b), '#3a2a1a');
  t.flagPos = t.toWorld(a, b, y + 20);
  t.fortPos = t.toWorld(a, b, y);
}

function laRoche(K, x, z) {
  // the bare crag the fort was built on, with the stumps of its walls and a ruined gate
  const t = K.t, B = K.B, rnd = K.rnd;
  const { a, b } = K.L(x, z);
  const y = t.groundAt(a, b);
  B.add('stone', new THREE.DodecahedronGeometry(6, 0), T(a, y + 3, b, 0.4, 1, 1.2, 1), '#b8ae98');
  t.addCollider(a, b, 5.5, 5.5, 0, 9);
  for (let k = 0; k < 14; k++) {
    const ang = (k / 14) * Math.PI * 2, rr = 16 + rnd() * 3;
    if (rnd() < 0.3) continue;
    const pa = a + Math.sin(ang) * rr, pb = b + Math.cos(ang) * rr;
    const h = 1 + rnd() * 2.6;
    B.box('stone', 7, h, 1.6, T(pa, t.groundAt(pa, pb) + h / 2 - 0.3, pb, ang + Math.PI / 2), '#c8bfa8');
  }
  K.claim(a, b, 20, 20, 0);
}

function boucan(K, x, z) {
  // a buccaneer's smoking grill: a rack of green sticks over a slow fire, hides stretched on frames
  const t = K.t, B = K.B;
  const { a, b } = K.L(x, z);
  if (!K.free(a, b, 3, 3, 0)) return;
  const y = t.groundAt(a, b);
  for (const [u, v] of [[-1, -0.8], [1, -0.8], [-1, 0.8], [1, 0.8]]) B.cyl('wood', 0.06, 0.07, 1.2, 5, T(a + u, y + 0.6, b + v), '#5a4632');
  for (let k = 0; k < 7; k++) B.box('wood', 2.2, 0.05, 0.05, T(a, y + 1.2, b - 0.75 + k * 0.25), '#6a5a42');
  B.box('plain', 1.6, 0.12, 1.0, T(a, y + 1.3, b), '#7a3a2a'); // meat
  t.fires.push(t.toWorld(a, b, y + 0.3));
  for (const k of [-1, 1]) {
    B.cyl('wood', 0.05, 0.05, 2.2, 4, T(a + 3.2, y + 1.1, b + k * 1.1), '#5a4632');
    B.box('plain', 0.06, 1.5, 1.8, T(a + 3.2, y + 1.3, b + k * 1.1), '#8a6a48'); // hide
  }
  t.addCollider(a, b, 1.3, 1.1, 0, 1.4);
  t.spot('work', a - 1.8, b, Math.PI / 2);
  K.claim(a, b, 4, 3, 0);
}

function crawl(K, x, z) {
  // a turtle crawl: a pen of stakes in the shallows
  const t = K.t, B = K.B;
  const { a, b } = K.L(x, z);
  for (let k = 0; k < 28; k++) {
    const ang = (k / 28) * Math.PI * 2;
    const pa = a + Math.sin(ang) * 7, pb = b + Math.cos(ang) * 5;
    B.cyl('wood', 0.07, 0.08, 2.6, 4, T(pa, 0.4, pb), '#5a4632');
  }
}

export const PLANS = {
  nassau: { build: nassau, seed: 1716, zones: [[-150, 20, 60, 2.4], [-60, 30, 70, 2.4], [30, 30, 80, 2.4], [130, 34, 80, 2.3], [210, 30, 55, 2.2]], center: [30, 40], R: 230 },
  havana: { build: havana, seed: 1519, zones: [[-150, 180, 250, 3.0], [-60, 40, 90, 3.0], [-230, 60, 120, 3.0], [-250, 320, 110, 3.0]], center: [-170, 180], R: 290 },
  portroyal: { build: portRoyal, seed: 1692, zones: [[-560, 165, 190, 2.1]], center: [-560, 165], R: 200 },
  tortuga: { build: cayona, seed: 1640, zones: [[-150, 60, 48, 2.6], [-75, 58, 48, 2.6], [0, 58, 48, 2.6], [75, 58, 48, 2.6], [150, 60, 48, 2.6]], center: [0, 40], R: 230 },
};
