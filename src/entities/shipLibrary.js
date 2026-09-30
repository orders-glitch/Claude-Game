// Detailed ship models (Sketchfab, CC-BY; see public/models/ships/CREDITS.md), built by tools/build-ships.mjs
// with the bow towards -Z, deck up and the waterline at y = 0. Their own canvas is animated by a shader that
// shares the procedural sails' uniforms: sails furl up to their yards, fill and belly with the wind, and show
// shot damage.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { shipTime } from './shipModel.js';

// which model each class uses, and per-model facts the game needs
export const SHIP_MODELS = {
  sloop: { file: 'sloop.glb', bow: -1, deck: 1.2, draft: 1.6 },
  pinnace: { file: 'pinnace.glb', bow: -1, deck: 2.2, draft: 2.4 },
  galleon: { file: 'galleon.glb', bow: -1, deck: 3.2, draft: 3.3 },
};
export const CLASS_MODEL = { sloop: 'sloop', brigantine: 'pinnace', fluyt: 'pinnace', frigate: 'pinnace', galleon: 'galleon', manowar: 'galleon' };

// quantized glTF attributes can't hold baked transforms: convert to float
function toFloat(geo) {
  for (const [name, attr] of Object.entries(geo.attributes)) {
    if (!attr.isInterleavedBufferAttribute && attr.array instanceof Float32Array) continue;
    const out = new Float32Array(attr.count * attr.itemSize);
    const get = [attr.getX, attr.getY, attr.getZ, attr.getW];
    for (let i = 0; i < attr.count; i++) for (let c = 0; c < attr.itemSize; c++) out[i * attr.itemSize + c] = get[c].call(attr, i);
    geo.setAttribute(name, new THREE.BufferAttribute(out, attr.itemSize));
  }
  return geo;
}

// For every connected piece of canvas, record its top (the yard), bottom and horizontal centre / half width,
// so the shader can furl and billow each sail about its own yard.
function sailAttributes(geo) {
  const pos = geo.attributes.position, idx = geo.index;
  const n = pos.count;
  const parent = new Int32Array(n);
  for (let i = 0; i < n; i++) parent[i] = i;
  const find = (a) => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
  const unite = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[a] = b; };
  if (idx) for (let t = 0; t < idx.count; t += 3) { unite(idx.getX(t), idx.getX(t + 1)); unite(idx.getX(t), idx.getX(t + 2)); }
  // also join vertices that share a position (split UV seams)
  const key = new Map();
  for (let i = 0; i < n; i++) {
    const k = Math.round(pos.getX(i) * 200) + ',' + Math.round(pos.getY(i) * 200) + ',' + Math.round(pos.getZ(i) * 200);
    if (key.has(k)) unite(i, key.get(k)); else key.set(k, i);
  }
  const box = new Map();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    let b = box.get(r);
    if (!b) box.set(r, (b = [Infinity, -Infinity, Infinity, -Infinity, Infinity, -Infinity]));
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    b[0] = Math.min(b[0], x); b[1] = Math.max(b[1], x); b[2] = Math.min(b[2], y); b[3] = Math.max(b[3], y); b[4] = Math.min(b[4], z); b[5] = Math.max(b[5], z);
  }
  const a = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const b = box.get(find(i));
    a[i * 4] = b[3]; // top
    a[i * 4 + 1] = b[2]; // bottom
    a[i * 4 + 2] = (b[0] + b[1]) / 2; // centre x
    a[i * 4 + 3] = Math.max(0.3, (b[1] - b[0]) / 2); // half width
  }
  geo.setAttribute('sailBox', new THREE.BufferAttribute(a, 4));
  return [...box.values()];
}

// Each sail swings about its mast with the crew's trim: a fore-and-aft sail (thin across the ship, long fore and
// aft) about its luff, a square sail with its yard about the mast. The spars inside a sail's outline (booms,
// gaffs, yards) swing with it. sailPivot = (pivot x, pivot z, kind: 0 fixed / 1 square / 2 fore-and-aft).
function sailPivots(parts, bowZ) {
  const comps = [];
  for (const p of parts) if (p.sail) for (const b of p.comps) {
    const [x0, x1, y0, y1, z0, z1] = b;
    const fa = x1 - x0 < (z1 - z0) * 0.45;
    comps.push({ b: [b[0], b[1], b[2], b[3], b[4], b[5]], fa, px: fa ? (x0 + x1) / 2 : (x0 + x1) / 2, pz: fa ? (bowZ > 0 ? z1 : z0) : (z0 + z1) / 2 });
  }
  // sails: each vertex belongs to its own sail; spars: a connected piece swings only if it lies wholly within a
  // sail's outline (booms, gaffs, yards), never the hull, masts or deck
  const within = (b, c, m) => {
    const [x0, x1, y0, y1, z0, z1] = c.b;
    const sx = x1 - x0, sy = y1 - y0, sz = z1 - z0;
    const mx = c.fa ? Math.max(sz * 0.08, 0.2) : sx * 0.1, my = sy * 0.1, mz = c.fa ? sz * 0.08 : Math.max(sy * 0.12, 0.2);
    return b[0] >= x0 - mx * m && b[1] <= x1 + mx * m && b[2] >= y0 - my * m && b[3] <= y1 + my * m && b[4] >= z0 - mz * m && b[5] <= z1 + mz * m;
  };
  for (const p of parts) {
    const pos = p.geometry.attributes.position, n = pos.count;
    const a = new Float32Array(n * 4);
    let any = false;
    const { root, boxes } = pieces(p.geometry);
    const assign = new Map();
    for (const [r, b] of boxes) {
      for (const c of comps) {
        if (p.sail ? within(b, c, 0.02) : within(b, c, 1)) { assign.set(r, c); break; }
      }
    }
    for (let i = 0; i < n; i++) {
      const c = assign.get(root[i]);
      if (!c) continue;
      a[i * 4] = c.px; a[i * 4 + 1] = c.pz; a[i * 4 + 2] = c.fa ? 2 : 1; any = true;
    }
    if (any) { p.geometry.setAttribute('sailPivot', new THREE.BufferAttribute(a, 4)); p.swing = true; }
  }
}

// connected pieces of a mesh (vertices sharing triangles or positions) and their boxes
function pieces(geo) {
  const pos = geo.attributes.position, idx = geo.index;
  const n = pos.count;
  const parent = new Int32Array(n);
  for (let i = 0; i < n; i++) parent[i] = i;
  const find = (a) => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
  const unite = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[a] = b; };
  if (idx) for (let t = 0; t < idx.count; t += 3) { unite(idx.getX(t), idx.getX(t + 1)); unite(idx.getX(t), idx.getX(t + 2)); }
  else for (let t = 0; t < n; t += 3) { unite(t, t + 1); unite(t, t + 2); }
  const key = new Map();
  for (let i = 0; i < n; i++) {
    const k = Math.round(pos.getX(i) * 200) + ',' + Math.round(pos.getY(i) * 200) + ',' + Math.round(pos.getZ(i) * 200);
    if (key.has(k)) unite(i, key.get(k)); else key.set(k, i);
  }
  const root = new Int32Array(n), boxes = new Map();
  for (let i = 0; i < n; i++) {
    const r = find(i); root[i] = r;
    let b = boxes.get(r);
    if (!b) boxes.set(r, (b = [Infinity, -Infinity, Infinity, -Infinity, Infinity, -Infinity]));
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    b[0] = Math.min(b[0], x); b[1] = Math.max(b[1], x); b[2] = Math.min(b[2], y); b[3] = Math.max(b[3], y); b[4] = Math.min(b[4], z); b[5] = Math.max(b[5], z);
  }
  return { root, boxes };
}

// vertex chunk: swing a sail / spar vertex about its mast (model space)
const SWING = `
  if (sailPivot.z > 0.5) {
    float leeX = uLee * (uBowZ > 0.0 ? -1.0 : 1.0);
    float ang = sailPivot.z > 1.5 ? uTrimFA * leeX * -uBowZ : -(1.5708 - uTrimSq) * leeX * uBowZ;
    float c = cos(ang), s = sin(ang);
    vec2 d = transformed.xz - sailPivot.xy;
    transformed.x = sailPivot.x + d.x * c + d.y * s;
    transformed.z = sailPivot.y - d.x * s + d.y * c;
  }`;
const SWING_N = `
  if (sailPivot.z > 0.5) {
    float leeXn = uLee * (uBowZ > 0.0 ? -1.0 : 1.0);
    float angN = sailPivot.z > 1.5 ? uTrimFA * leeXn * -uBowZ : -(1.5708 - uTrimSq) * leeXn * uBowZ;
    objectNormal = vec3(objectNormal.x * cos(angN) + objectNormal.z * sin(angN), objectNormal.y, -objectNormal.x * sin(angN) + objectNormal.z * cos(angN));
  }`;
const SWING_HEAD = 'attribute vec4 sailPivot; uniform float uLee; uniform float uBowZ; uniform float uTrimFA; uniform float uTrimSq;';

// spars that swing with their sails (each ship gets its own copy of the material for its own trim)
function sparShader(mat, uniforms) {
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + SWING_HEAD)
      .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\n' + SWING_N)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + SWING);
  };
  mat.customProgramCacheKey = () => 'sparSwing';
}

function sailShader(mat, uniforms) {
  mat.side = THREE.DoubleSide;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms, { uShipTime: shipTime });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec4 sailBox;
        uniform float uFurl; uniform float uFill; uniform float uDamage; uniform float uShipTime; uniform float uLuff;
        ${SWING_HEAD}
        varying vec2 vSailP;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          float top = sailBox.x, bot = sailBox.y, span = max(top - bot, 0.3);
          float t = clamp((top - transformed.y) / span, 0.0, 1.0);    // 0 at the yard, 1 at the foot
          float u = clamp((transformed.x - sailBox.z) / sailBox.w, -1.0, 1.0);
          vSailP = vec2(u, t);
          // furl: gather the canvas up to its yard
          float furl = clamp(uFurl, 0.02, 1.0);
          transformed.y = top - (top - transformed.y) * furl;
          // fill: the belly pushes forward (towards the bow, -Z), strongest mid-sail
          // (negative fill: taken aback, the canvas pressed back against the mast)
          float belly = sin(t * 3.14159) * (1.0 - u * u) * span * 0.12 * uFill * furl;
          belly += sin(uShipTime * 2.3 + transformed.y * 0.8 + transformed.x) * 0.03 * (0.3 + abs(uFill));
          // luffing: the pinched canvas shivers and flogs in travelling waves from the luff
          belly += sin(uShipTime * 13.0 + t * 7.0 + u * 5.0) * sin(t * 3.14159) * span * 0.045 * uLuff * furl;
          transformed.z -= belly;
        }
        ${SWING}`)
      .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\n' + SWING_N);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uDamage;\nuniform vec3 uCanvas;\nvarying vec2 vSailP;')
      .replace('#include <map_fragment>', `#include <map_fragment>
        // sailcloth: keep the texture's weave and stains, re-light it to the canvas colour
        float l = dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11));
        diffuseColor.rgb = uCanvas * (0.45 + l * 1.5);
        // shot holes and scorching as the canvas is shot through
        {
          vec2 q = vSailP * vec2(7.0, 9.0);
          float h = fract(sin(dot(floor(q), vec2(12.9898, 78.233))) * 43758.5453);
          float hole = step(1.0 - uDamage * 0.55, h) * step(length(fract(q) - 0.5), 0.2 + h * 0.2);
          if (hole > 0.5) discard;
          diffuseColor.rgb *= 1.0 - uDamage * 0.35 * h;
        }`);
  };
  mat.customProgramCacheKey = () => 'scannedSail';
}

class ShipLibrary {
  constructor() { this.models = {}; }

  async load(base = './models/ships/') {
    const loader = new GLTFLoader();
    await Promise.all(Object.entries(SHIP_MODELS).map(async ([name, cfg]) => {
      try {
        const gltf = await loader.loadAsync(base + cfg.file);
        const parts = [];
        gltf.scene.updateMatrixWorld(true);
        gltf.scene.traverse((o) => {
          if (!o.isMesh) return;
          const geometry = toFloat(o.geometry.clone()).applyMatrix4(o.matrixWorld);
          const sail = /sail|canvas/i.test(o.material.name || '');
          const comps = sail ? sailAttributes(geometry) : null;
          if (o.material.map) o.material.map.anisotropy = 8;
          parts.push({ geometry, material: o.material, sail, comps });
        });
        const box = new THREE.Box3();
        for (const p of parts) { p.geometry.computeBoundingBox(); box.union(p.geometry.boundingBox); }
        sailPivots(parts, cfg.bow < 0 ? 1 : -1);
        this.models[name] = { parts, box, cfg };
      } catch (e) { /* optional: procedural ships are used instead */ }
    }));
    return this;
  }

  has(cls) { return !!this.models[CLASS_MODEL[cls]]; }

  // A ship's visual group plus its own sail uniforms (each ship gets its own sail material)
  create(clsId, length, canvas = '#e9dfc6') {
    const M = this.models[CLASS_MODEL[clsId]];
    const group = new THREE.Group();
    const inner = new THREE.Group();
    const s = length / (M.box.max.z - M.box.min.z);
    inner.scale.setScalar(s);
    if (M.cfg.bow < 0) inner.rotation.y = Math.PI;
    group.add(inner);
    const uniforms = { uFurl: { value: 1 }, uFill: { value: 0 }, uLuff: { value: 0 }, uDamage: { value: 0 }, uBrace: { value: 0 }, uBoom: { value: 0 }, uSide: { value: 1 }, uCanvas: { value: new THREE.Color(canvas) },
      uLee: { value: 1 }, uBowZ: { value: M.cfg.bow < 0 ? 1 : -1 }, uTrimFA: { value: 0.1 }, uTrimSq: { value: 1.57 } };
    let sails = null;
    for (const p of M.parts) {
      let material = p.material;
      if (p.sail) { material = p.material.clone(); sailShader(material, uniforms); }
      else if (p.swing) { material = p.material.clone(); sparShader(material, uniforms); }
      const mesh = new THREE.Mesh(p.geometry, material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      inner.add(mesh);
      if (p.sail) sails = mesh;
    }
    return { group, sails, uniforms, scale: s, box: M.box.clone().applyMatrix4(new THREE.Matrix4().makeScale(s, s, s)), cfg: M.cfg };
  }
}

export const shipLibrary = new ShipLibrary();
