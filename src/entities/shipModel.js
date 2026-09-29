// Procedural period sailing ships: lofted hull with gunports, decks, castles, masts, yards, rigging,
// animated square & fore-and-aft sails (with bracing, furling and battle damage), flags and crew.
import * as THREE from 'three';
import { Builder, T } from '../world/builder.js';
import { woodTexture, canvasSailTexture, flagTexture } from '../core/textures.js';
import { lerp, smoothstep } from '../core/noise.js';

export const shipTime = { value: 0 };

let MATS = null;
function materials() {
  if (MATS) return MATS;
  const std = (o) => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0, ...o });
  MATS = {
    hull: std({ map: woodTexture('#d2b690', 'hullwood'), side: THREE.DoubleSide, roughness: 0.75 }),
    deck: std({ map: woodTexture('#c8ad86', 'deckwood'), roughness: 0.85 }),
    wood: std({ map: woodTexture('#9a7a58', 'sparwood') }),
    metal: std({ roughness: 0.45, metalness: 0.7 }),
    crew: std({ roughness: 0.9 }),
    window: std({ roughness: 0.2, emissive: new THREE.Color('#ffae55'), emissiveIntensity: 0 }),
    glow: new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffd28a').multiplyScalar(4) }),
    rope: new THREE.LineBasicMaterial({ color: '#2a2218', transparent: true, opacity: 0.85 }),
  };
  return MATS;
}
export function shipMaterials() { return materials(); }

function sailMaterial(tint) {
  const uniforms = {
    uFill: { value: 1 }, uFurl: { value: 1 }, uBrace: { value: 0 }, uBoom: { value: 0 }, uSide: { value: 1 },
    uDamage: { value: 0 }, uTime: shipTime,
  };
  const mat = new THREE.MeshStandardMaterial({
    map: canvasSailTexture(tint, 'sail'), side: THREE.DoubleSide, roughness: 0.95, vertexColors: true,
  });
  mat.userData.uniforms = uniforms;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute float aBillow; attribute float aTop; attribute vec2 aMast; attribute float aType;
        uniform float uFill; uniform float uFurl; uniform float uBrace; uniform float uBoom; uniform float uSide; uniform float uTime;
        varying vec2 vSailUv;`)
      .replace('#include <begin_vertex>', `
        vec3 transformed = position;
        vSailUv = uv;
        if (aBillow >= 0.0) {
          float f = max(uFurl, 0.05);
          transformed.y = aTop - (aTop - transformed.y) * f;
          if (aType > 0.5) transformed.z = aMast.y + (transformed.z - aMast.y) * f;
          float flutter = sin(uTime * 7.0 + position.y * 1.3 + position.x) * 0.08 * (1.0 - uFill);
          float bel = aBillow * (uFill * 0.9 + 0.1) * (0.35 + 0.65 * f);
          if (aType < 0.5) transformed.z -= bel * 2.4 + flutter;
          else transformed.x += (bel * 2.0 + flutter) * uSide;
        }
        float ang = aType < 0.5 ? uBrace : (aType < 1.5 ? uBoom : 0.0);
        vec2 rel = transformed.xz - aMast;
        float ca = cos(ang), sa = sin(ang);
        transformed.xz = aMast + vec2(ca * rel.x - sa * rel.y, sa * rel.x + ca * rel.y);
      `);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uDamage; varying vec2 vSailUv;
        float sh(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
        float sn(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.0-2.0*f);
          return mix(mix(sh(i),sh(i+vec2(1,0)),u.x), mix(sh(i+vec2(0,1)),sh(i+vec2(1,1)),u.x), u.y); }`)
      .replace('#include <alphatest_fragment>', `#include <alphatest_fragment>
        if (uDamage > 0.02) {
          float hn = sn(vSailUv * 7.0) * 0.6 + sn(vSailUv * 19.0) * 0.4;
          if (hn < uDamage * 0.55) discard;
        }`);
  };
  return mat;
}

const flagMats = new Map();
function flagMaterial(kind) {
  if (flagMats.has(kind)) return flagMats.get(kind);
  const mat = new THREE.MeshStandardMaterial({ map: flagTexture(kind), side: THREE.DoubleSide, roughness: 0.9 });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = shipTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        float fx = uv.x;
        transformed.z += sin(fx * 5.0 - uTime * 7.0 + position.y * 0.5) * 0.35 * fx;
        transformed.y -= fx * fx * 0.25;`);
  };
  flagMats.set(kind, mat);
  return mat;
}

// ---------------------------------------------------------------- hull loft
function halfBeam(t, beam) {
  // t: 0 = stern, 1 = bow
  if (t < 0.45) return (beam / 2) * lerp(0.74, 1, smoothstep(0, 0.45, t));
  const k = (t - 0.45) / 0.55;
  return (beam / 2) * Math.pow(Math.cos(k * Math.PI / 2), 0.75);
}

function buildHull(cls, colors, B) {
  const L = cls.length, beam = cls.beam, depth = cls.depth;
  const draft = depth * 0.62;
  const free = depth * 0.55; // main deck height above waterline
  const rig = cls.rig;
  const tall = rig === 'ship';
  const sheer = (t) => free + 0.9 * Math.pow(1 - t, 3) * (tall ? 2.2 : 1) + 0.9 * Math.pow(t, 4);
  const bulwark = 1.1;
  const NS = 30, NP = 12;
  const pos = [], uv = [], col = [], idx = [];
  const cBottom = new THREE.Color('#d6ccb0'), cWood = new THREE.Color(colors.hull), cStripe = new THREE.Color(colors.stripe), cWale = new THREE.Color('#141210');
  const cc = new THREE.Color();
  const rows = [];
  for (let i = 0; i <= NS; i++) {
    const t = i / NS;
    const z = L / 2 - t * L;
    const bw = Math.max(halfBeam(t, beam), 0.05);
    const top = sheer(t) + bulwark;
    const keel = -draft * (t > 0.86 ? lerp(1, 0.05, smoothstep(0.86, 1, t)) : t < 0.05 ? lerp(0.85, 1, t / 0.05) : 1);
    const row = [];
    for (let s = -NP; s <= NP; s++) {
      const a = Math.abs(s) / NP; // 0 keel -> 1 top
      const side = Math.sign(s) || 1;
      const y = lerp(keel, top, Math.pow(a, 1.25));
      // fullness: sections are U shaped; above the waterline tumblehome narrows toward the rail
      const fill = Math.pow(Math.sin(Math.min(1, a * 1.55) * Math.PI / 2), 0.55);
      const tumble = 1 - 0.1 * smoothstep(0.2, 1, (y) / (top));
      const x = side * bw * fill * tumble;
      const vi = pos.length / 3;
      // bow stem: pull to a point
      pos.push(x, y, z);
      uv.push(z * 0.25, y * 0.28);
      if (y < 0.25) cc.copy(cBottom);
      else if (Math.abs(y - free * 0.5) < 0.18 || Math.abs(y - (free + 0.3)) < 0.12) cc.copy(cWale);
      else if (y > free * 0.6 && y < free + 0.2) cc.copy(cStripe);
      else if (y > top - 0.25) cc.copy(cWale);
      else cc.copy(cWood);
      col.push(cc.r, cc.g, cc.b);
      row.push(vi);
    }
    rows.push(row);
  }
  for (let i = 0; i < NS; i++) {
    for (let s = 0; s < NP * 2; s++) {
      const a = rows[i][s], b = rows[i][s + 1], c = rows[i + 1][s], d = rows[i + 1][s + 1];
      idx.push(a, b, c, b, d, c);
    }
  }
  // transom (stern) cap
  const sternRow = rows[0];
  const cIdx = pos.length / 3;
  const st0 = sheer(0);
  pos.push(0, st0 * 0.3, L / 2 + 0.02);
  uv.push(0, 0);
  col.push(cWood.r * 0.8, cWood.g * 0.8, cWood.b * 0.8);
  for (let s = 0; s < sternRow.length - 1; s++) idx.push(cIdx, sternRow[s + 1], sternRow[s]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  B.buckets.hull = B.buckets.hull || [];
  B.buckets.hull.push(g.toNonIndexed());

  // deck surface following the sheer
  const dpos = [], duv = [], dcol = [], didx = [];
  const dc = new THREE.Color('#ffffff');
  for (let i = 0; i <= NS; i++) {
    const t = i / NS;
    const z = L / 2 - t * L;
    const bw = Math.max(halfBeam(t, beam) * 0.92 * (1 - 0.1), 0.02);
    const y = sheer(t);
    dpos.push(-bw, y, z, bw, y, z);
    duv.push(-bw * 0.25, z * 0.25, bw * 0.25, z * 0.25);
    dcol.push(dc.r, dc.g, dc.b, dc.r, dc.g, dc.b);
    if (i < NS) { const a = i * 2; didx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  }
  const dg = new THREE.BufferGeometry();
  dg.setAttribute('position', new THREE.Float32BufferAttribute(dpos, 3));
  dg.setAttribute('uv', new THREE.Float32BufferAttribute(duv, 2));
  dg.setAttribute('color', new THREE.Float32BufferAttribute(dcol, 3));
  dg.setIndex(didx);
  dg.computeVertexNormals();
  B.buckets.deck = B.buckets.deck || [];
  B.buckets.deck.push(dg.toNonIndexed());

  return { draft, free, sheer, bulwark };
}

// ---------------------------------------------------------------- sails
class SailBuilder {
  constructor() { this.pos = []; this.uv = []; this.col = []; this.billow = []; this.top = []; this.mast = []; this.type = []; this.idx = []; }
  pushV(x, y, z, u, v, b, top, mx, mz, type, c) {
    this.pos.push(x, y, z); this.uv.push(u, v); this.billow.push(b); this.top.push(top); this.mast.push(mx, mz); this.type.push(type);
    this.col.push(c.r, c.g, c.b);
    return this.pos.length / 3 - 1;
  }
  // square sail hanging from a yard at yTop, foot at yBot, centred at mast (mx, mz)
  square(mx, mz, yTop, yBot, wTop, wBot) {
    const nu = 6, nv = 5, base = this.pos.length / 3;
    const white = new THREE.Color('#ffffff');
    for (let j = 0; j <= nv; j++) {
      const v = j / nv; // 0 top -> 1 bottom
      const w = lerp(wTop, wBot, v);
      for (let i = 0; i <= nu; i++) {
        const u = i / nu;
        const b = Math.sin(Math.PI * u) * Math.sin(Math.PI * (0.15 + v * 0.7));
        this.pushV((u - 0.5) * w, lerp(yTop, yBot, v), mz - 0.35, u, 1 - v, b, yTop, mx, mz, 0, white);
      }
    }
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
      const a = base + j * (nu + 1) + i, b = a + 1, c = a + nu + 1, d = c + 1;
      this.idx.push(a, c, b, b, c, d);
    }
    this.spar(mx, mz, yTop + 0.1, wTop * 1.08, 0, 0.14);
  }
  // spar (yard) as a thin box that rotates with the sails
  spar(mx, mz, y, len, type, r) {
    const c = new THREE.Color('#3a2a1c');
    const base = this.pos.length / 3;
    const hx = len / 2;
    const corners = [[-hx, -r, -r], [hx, -r, -r], [hx, r, -r], [-hx, r, -r], [-hx, -r, r], [hx, -r, r], [hx, r, r], [-hx, r, r]];
    for (const [x, yy, z] of corners) this.pushV(mx + x, y + yy, mz + z, 0, 0, -1, y, mx, mz, type, c);
    const f = [[0, 1, 2, 0, 2, 3], [4, 6, 5, 4, 7, 6], [0, 4, 5, 0, 5, 1], [3, 2, 6, 3, 6, 7], [0, 3, 7, 0, 7, 4], [1, 5, 6, 1, 6, 2]];
    for (const q of f) for (const k of q) this.idx.push(base + k);
  }
  // generic quad / triangle fore-and-aft sail in the x=0 plane: corners [z,y]
  quad(corners, type, mx, mz) {
    const [p0, p1, p2, p3] = corners; // tack, head/throat, peak, clew
    const nu = 5, nv = 5, base = this.pos.length / 3;
    const white = new THREE.Color('#ffffff');
    for (let j = 0; j <= nv; j++) {
      const v = j / nv;
      for (let i = 0; i <= nu; i++) {
        const u = i / nu;
        // bilinear: u from luff (p0-p1) to leech (p3-p2), v from foot to head
        const zl = lerp(p0[0], p1[0], v), yl = lerp(p0[1], p1[1], v);
        const zr = lerp(p3[0], p2[0], v), yr = lerp(p3[1], p2[1], v);
        const z = lerp(zl, zr, u), y = lerp(yl, yr, u);
        const b = Math.sin(Math.PI * u) * Math.sin(Math.PI * (0.1 + v * 0.8));
        this.pushV(0, y, z, u, v, b, Math.max(p1[1], p2[1]), mx, mz, type, white);
      }
    }
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
      const a = base + j * (nu + 1) + i, b = a + 1, c = a + nu + 1, d = c + 1;
      this.idx.push(a, b, c, b, d, c);
    }
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aBillow', new THREE.Float32BufferAttribute(this.billow, 1));
    g.setAttribute('aTop', new THREE.Float32BufferAttribute(this.top, 1));
    g.setAttribute('aMast', new THREE.Float32BufferAttribute(this.mast, 2));
    g.setAttribute('aType', new THREE.Float32BufferAttribute(this.type, 1));
    g.setIndex(this.idx);
    g.computeVertexNormals();
    return g;
  }
}

function crewFigure(B, x, y, z, ry, coat, rnd) {
  const skin = ['#c68c5a', '#8d5a3a', '#e0b48c', '#6a4028'][Math.floor(rnd() * 4)];
  B.box('crew', 0.34, 0.8, 0.26, T(x - 0.1, y + 0.4, z, ry), '#3a3228');
  B.box('crew', 0.34, 0.8, 0.26, T(x + 0.1, y + 0.4, z, ry), '#3a3228');
  B.box('crew', 0.55, 0.75, 0.32, T(x, y + 1.18, z, ry), coat);
  B.add('crew', new THREE.SphereGeometry(0.17, 8, 6), T(x, y + 1.72, z), skin);
  if (rnd() < 0.5) B.add('crew', new THREE.CylinderGeometry(0.2, 0.2, 0.08, 8), T(x, y + 1.86, z), '#1a1612');
}

// Build a ship visual. Returns an object with the group and handles for animation.
export function buildShipModel(cls, nation, opts = {}) {
  const M = materials();
  const B = new Builder();
  const colors = { hull: opts.hullColor || nation.hull, stripe: opts.stripeColor || nation.stripe };
  const rnd = (() => { let s = (opts.seed || 1) * 9301; return () => ((s = (s * 9301 + 49297) % 233280) / 233280); })();
  const h = buildHull(cls, colors, B);
  const L = cls.length, beam = cls.beam;
  const { sheer, free, bulwark } = h;
  const rig = cls.rig;

  // gunports & cannons
  const perSide = Math.floor(cls.guns / 2);
  const rowsN = perSide > 14 ? 2 : 1;
  const perRow = Math.ceil(perSide / rowsN);
  const gunPositions = [];
  for (let r = 0; r < rowsN; r++) {
    for (let i = 0; i < perRow; i++) {
      const t = 0.18 + (i / Math.max(1, perRow - 1)) * 0.6;
      const z = L / 2 - t * L;
      const y = r === 0 ? free * 0.78 : free * 0.78 - 1.7;
      if (y < 0.7) continue;
      const bw = halfBeam(t, beam);
      for (const s of [-1, 1]) {
        const x = s * (bw * 0.98);
        B.box('hull', 0.2, 0.7, 0.8, T(x + s * 0.02, y, z), '#0c0a08');
        B.box('hull', 0.12, 0.8, 0.95, T(x + s * 0.06, y + 0.55, z, 0, 1, 1, 1, 0, s * 0.3), colors.stripe);
        B.cyl('metal', 0.12, 0.17, 1.3, 7, T(x + s * 0.5, y, z, 0, 1, 1, 1, 0, Math.PI / 2), '#1a1a1c');
        gunPositions.push(new THREE.Vector3(x + s * 1.1, y, z));
      }
    }
  }

  // stern: windows & lanterns & castle
  const sternY = sheer(0);
  const sternBw = halfBeam(0, beam);
  if (rig !== 'sloop') {
    for (let i = -2; i <= 2; i++) B.box('window', 0.9, 1.0, 0.1, T(i * sternBw * 0.35, sternY - 0.4, L / 2 + 0.08), '#1b1510');
    if (cls.length > 32) for (let i = -2; i <= 2; i++) B.box('window', 0.9, 0.9, 0.1, T(i * sternBw * 0.35, sternY - 1.9, L / 2 + 0.06), '#1b1510');
    // quarter gallery rail
    B.box('wood', sternBw * 2, 0.25, 0.8, T(0, sternY - 1.1, L / 2 + 0.3), '#6a4a2c');
    // quarterdeck bulkhead
    B.box('hull', beam * 0.8, 1.5, 0.3, T(0, sheer(0.3) + 0.4, L / 2 - L * 0.28), colors.hull);
  } else {
    B.box('window', 0.6, 0.5, 0.1, T(-0.8, sternY - 0.3, L / 2 + 0.05), '#1b1510');
    B.box('window', 0.6, 0.5, 0.1, T(0.8, sternY - 0.3, L / 2 + 0.05), '#1b1510');
  }
  const lanternN = cls.length > 32 ? 3 : 1;
  const lanterns = [];
  for (let i = 0; i < lanternN; i++) {
    const lx = (i - (lanternN - 1) / 2) * sternBw * 0.9;
    B.box('metal', 0.5, 0.8, 0.5, T(lx, sternY + bulwark + 0.8, L / 2 + 0.2), '#2a2218');
    B.box('glow', 0.32, 0.5, 0.32, T(lx, sternY + bulwark + 0.8, L / 2 + 0.2), '#ffd28a');
    lanterns.push(new THREE.Vector3(lx, sternY + bulwark + 0.8, L / 2 + 0.2));
  }
  // rudder & tiller/wheel (ship's wheel came into use c. 1710s; sloops keep the tiller)
  B.box('wood', 0.3, h.draft + sternY * 0.7, 1.4, T(0, (sternY * 0.7 - h.draft) / 2, L / 2 + 0.5), '#3a2a1c');
  if (rig === 'sloop') B.box('wood', 0.15, 0.15, 3, T(0, sheer(0.05) + 0.9, L / 2 - 2, 0, 1, 1, 1, -0.2), '#5a4230');
  else {
    const wz = L / 2 - L * 0.16, wy = sheer(0.16) + 1.3;
    B.add('wood', new THREE.TorusGeometry(0.7, 0.07, 6, 16), T(0, wy, wz), '#5a4230');
    B.box('wood', 0.3, 1.3, 0.5, T(0, wy - 0.7, wz), '#4a3424');
  }
  // hatches, capstan, deck clutter
  B.box('deck', beam * 0.35, 0.35, L * 0.08, T(0, sheer(0.45) + 0.18, L / 2 - L * 0.45), '#8a6a48');
  B.box('deck', beam * 0.3, 0.35, L * 0.07, T(0, sheer(0.62) + 0.18, L / 2 - L * 0.62), '#8a6a48');
  B.cyl('wood', 0.5, 0.6, 1.0, 8, T(0, sheer(0.3) + 0.5, L / 2 - L * 0.3), '#5a4230');
  for (let i = 0; i < 3; i++) B.cyl('wood', 0.35, 0.35, 0.9, 8, T(-beam * 0.25 + i * 0.4, sheer(0.55) + 0.45, L / 2 - L * 0.55 - 1.2), '#6a4a2e');
  // ship's boat on the waist (larger ships)
  if (L > 26) {
    const boat = new THREE.SphereGeometry(1, 10, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
    B.add('hull', boat, T(beam * 0.1, sheer(0.5) + 1.2, L / 2 - L * 0.52, 0, 1.0, 0.6, 3.2), '#6b5a3e');
  }
  // forecastle for ships
  if (rig === 'ship') B.box('hull', beam * 0.7, 0.9, 0.25, T(0, sheer(0.82) + 0.45, L / 2 - L * 0.82), colors.hull);
  // head / beakhead & bowsprit
  const bowY = sheer(1);
  const bowspritLen = rig === 'sloop' ? L * 0.62 : L * 0.42;
  const bsAng = rig === 'sloop' ? 0.12 : 0.28;
  const bsBaseZ = -L / 2 + 1.5;
  B.cyl('wood', 0.14, 0.3, bowspritLen, 8, T(0, bowY + 0.3 + Math.sin(bsAng) * bowspritLen / 2, bsBaseZ - Math.cos(bsAng) * bowspritLen / 2, 0, 1, 1, 1, -Math.PI / 2 + bsAng), '#4a3424');
  const bsTip = new THREE.Vector3(0, bowY + 0.3 + Math.sin(bsAng) * bowspritLen, bsBaseZ - Math.cos(bsAng) * bowspritLen);
  if (rig !== 'sloop') {
    // beakhead & figurehead
    B.add('hull', new THREE.ConeGeometry(0.6, 3, 6), T(0, bowY - 0.6, -L / 2 - 1.1, 0, 1, 1, 1, -Math.PI / 2 + 0.35), colors.stripe);
    B.add('crew', new THREE.SphereGeometry(0.35, 8, 6), T(0, bowY + 0.1, -L / 2 - 2.1), '#c9a13a');
  }

  // masts & sails
  const S = new SailBuilder();
  const mastDefs = [];
  if (rig === 'sloop') mastDefs.push({ t: 0.58, H: L * 1.2, square: false, gaff: true, topsail: true });
  else if (rig === 'brigantine') {
    mastDefs.push({ t: 0.72, H: L * 0.98, square: true, levels: 3 });
    mastDefs.push({ t: 0.38, H: L * 1.02, square: false, gaff: true, topsail: true });
  } else {
    mastDefs.push({ t: 0.78, H: L * 0.82, square: true, levels: 3 });
    mastDefs.push({ t: 0.5, H: L * 0.95, square: true, levels: 3 });
    mastDefs.push({ t: 0.18, H: L * 0.62, square: false, lateen: true, topsail: true });
  }
  const mastTops = [];
  const rigging = [];
  for (const md of mastDefs) {
    const z = L / 2 - md.t * L;
    const baseY = sheer(md.t);
    const H = md.H;
    const topY = baseY + H;
    B.cyl('wood', 0.16, 0.42, H, 8, T(0, baseY + H / 2 - 0.5, z), '#5a4028');
    // tops (platforms)
    B.cyl('wood', 1.2, 1.2, 0.18, 8, T(0, baseY + H * 0.55, z), '#4a3424');
    if (H > 25) B.cyl('wood', 0.8, 0.8, 0.14, 8, T(0, baseY + H * 0.8, z), '#4a3424');
    mastTops.push(new THREE.Vector3(0, topY, z));
    const bw = halfBeam(md.t, beam);
    // shrouds
    for (let k = -2; k <= 2; k++) {
      for (const s of [-1, 1]) {
        rigging.push(new THREE.Vector3(0, baseY + H * 0.55, z), new THREE.Vector3(s * (bw + 0.3), baseY + bulwark * 0.6, z + k * 0.7));
        rigging.push(new THREE.Vector3(0, baseY + H * 0.82, z), new THREE.Vector3(s * 1.2, baseY + H * 0.55, z + k * 0.2));
      }
    }
    if (md.square) {
      const levels = [
        [0.46, 0.14, beam * 2.0, beam * 2.2],
        [0.72, 0.48, beam * 1.55, beam * 1.85],
        [0.92, 0.74, beam * 1.05, beam * 1.3],
      ];
      for (let lv = 0; lv < (md.levels || 3); lv++) {
        const [a, b, wt, wb] = levels[lv];
        S.square(0, z, baseY + H * a, baseY + H * b, wt, wb);
      }
    }
    if (md.gaff) {
      const boomLen = rig === 'sloop' ? L * 0.62 : L * 0.4;
      const tackY = baseY + 2.2, throatY = baseY + H * 0.58, peakY = baseY + H * 0.8;
      S.quad([[z, tackY], [z, throatY], [z + boomLen * 0.9, peakY], [z + boomLen, tackY + 0.5]], 1, 0, z);
      S.spar(0, z + boomLen / 2, tackY, 0.2, 1, 0.14);
      if (md.topsail) S.square(0, z - 0.6, baseY + H * 0.94, baseY + H * 0.72, beam * 1.1, beam * 1.5);
    }
    if (md.lateen) {
      const yl = baseY + H * 0.3;
      S.quad([[z + 3, yl], [z - L * 0.08, yl - 0.5], [z + L * 0.2, baseY + H * 0.85], [z + L * 0.2, baseY + H * 0.85]], 1, 0, z);
      if (md.topsail) S.square(0, z - 0.4, baseY + H * 0.95, baseY + H * 0.62, beam * 0.9, beam * 1.1);
    }
  }
  // headsails: jibs to the bowsprit
  const foreTop = mastTops[0];
  const foreZ = foreTop.z;
  if (rig === 'sloop' || rig === 'brigantine') {
    const headY = sheer(mastDefs[0].t) + mastDefs[0].H * (rig === 'sloop' ? 0.72 : 0.6);
    S.quad([[bsTip.z + 0.5, bsTip.y], [foreZ - 0.3, headY], [foreZ - 0.3, headY], [foreZ - 2.5, sheer(0.9) + 2]], 2, 0, foreZ - 0.3);
    S.quad([[lerp(bsTip.z, -L / 2, 0.5), lerp(bsTip.y, bowY, 0.5)], [foreZ - 0.3, headY * 0.85], [foreZ - 0.3, headY * 0.85], [foreZ - 3.2, sheer(0.8) + 1.6]], 2, 0, foreZ - 0.3);
  } else {
    // spritsail beneath the bowsprit (period-correct for 1716)
    const sz = lerp(bsBaseZ, bsTip.z, 0.72);
    S.square(0, sz, lerp(bowY, bsTip.y, 0.72) - 0.3, lerp(bowY, bsTip.y, 0.72) - 4.5, beam * 1.1, beam * 1.3);
    const headY = sheer(mastDefs[0].t) + mastDefs[0].H * 0.55;
    S.quad([[bsTip.z + 0.5, bsTip.y], [foreZ - 0.3, headY], [foreZ - 0.3, headY], [foreZ - 3, sheer(0.9) + 2]], 2, 0, foreZ - 0.3);
  }
  // stays
  rigging.push(bsTip.clone(), foreTop.clone().setY(foreTop.y * 0.8));
  for (let i = 0; i < mastTops.length - 1; i++) rigging.push(mastTops[i].clone(), mastTops[i + 1].clone().setY(mastTops[i + 1].y * 0.7));
  rigging.push(mastTops[mastTops.length - 1].clone(), new THREE.Vector3(0, sternY + 1, L / 2 - 0.5));

  // crew on deck
  const crewN = opts.crewFigures ?? Math.min(12, Math.floor(cls.crewMax / 12) + 2);
  for (let i = 0; i < crewN; i++) {
    const t = 0.12 + rnd() * 0.72;
    const bw = halfBeam(t, beam) * 0.7;
    crewFigure(B, (rnd() * 2 - 1) * bw, sheer(t), L / 2 - t * L, rnd() * 6, rnd() < 0.3 ? nation.coat : ['#d8ccb0', '#8a3a2a', '#4a5a6a', '#b0a080'][Math.floor(rnd() * 4)], rnd);
  }

  const group = B.build({ ...M, default: M.hull });
  const sailGeo = S.geometry();
  const sailMat = sailMaterial(opts.sailTint || (nation.id === 'pirate' ? '#d9ccb0' : '#ebe2cc'));
  const sails = new THREE.Mesh(sailGeo, sailMat);
  sails.castShadow = true;
  sails.receiveShadow = true;
  group.add(sails);
  const ropeGeo = new THREE.BufferGeometry().setFromPoints(rigging);
  const ropes = new THREE.LineSegments(ropeGeo, M.rope);
  group.add(ropes);

  // flags: ensign at the stern, pennant/Jolly Roger at the main masthead
  const ensignKind = opts.flag || nation.flag;
  const fsize = Math.max(2.5, L * 0.12);
  const ensign = new THREE.Mesh(new THREE.PlaneGeometry(fsize * 1.6, fsize, 10, 4).translate(fsize * 0.8, 0, 0), flagMaterial(ensignKind));
  ensign.rotation.y = Math.PI / 2;
  ensign.position.set(0, sternY + bulwark + (rig === 'sloop' ? 5 : 3.5), L / 2 + 0.6);
  const staff = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, 6, 5), M.wood);
  staff.position.set(0, sternY + bulwark + 2.5, L / 2 + 0.6);
  group.add(staff);
  group.add(ensign);
  const mainTop = mastTops[rig === 'ship' ? 1 : 0];
  const masthead = new THREE.Mesh(new THREE.PlaneGeometry(fsize * 1.3, fsize * 0.8, 10, 4).translate(fsize * 0.65, 0, 0), flagMaterial(ensignKind));
  masthead.rotation.y = Math.PI / 2;
  masthead.position.copy(mainTop).add(new THREE.Vector3(0, 0.5, 0));
  group.add(masthead);

  group.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });

  return {
    group, sails, sailUniforms: sailMat.userData.uniforms, gunPositions, lanterns, mastTops, bsTip,
    ensign, masthead, draft: h.draft, deckY: free, sheer, length: L, beam,
    setFlag(kind) { ensign.material = flagMaterial(kind); masthead.material = flagMaterial(kind); },
  };
}
