// Geometry batching helper: collects primitives into per-material buckets and merges them, giving
// towns and ships a handful of draw calls regardless of how many parts they contain.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { woodTexture, stuccoTexture, roofTileTexture, thatchTexture, stoneTexture, plasterClapboardTexture } from '../core/textures.js';

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _p = new THREE.Vector3();

export function T(x = 0, y = 0, z = 0, ry = 0, sx = 1, sy = 1, sz = 1, rx = 0, rz = 0) {
  _e.set(rx, ry, rz, 'YXZ');
  _q.setFromEuler(_e);
  _s.set(sx, sy, sz);
  _p.set(x, y, z);
  return new THREE.Matrix4().compose(_p, _q, _s);
}

export const UV_SCALE = { wall: 0.18, wood: 0.25, roof: 0.2, thatch: 0.18, stone: 0.16, clap: 0.2, default: 0.25 };

export class Builder {
  constructor() { this.buckets = {}; this.col = new THREE.Color(); }

  add(bucket, geo, matrix, color = '#ffffff', uvMode = 'world') {
    let g = geo.index ? geo.toNonIndexed() : geo.clone();
    if (!g.attributes.normal) g.computeVertexNormals();
    if (matrix) g.applyMatrix4(matrix);
    const p = g.attributes.position, n = g.attributes.normal;
    const count = p.count;
    if (uvMode === 'world' || !g.attributes.uv) {
      const sc = UV_SCALE[bucket] ?? UV_SCALE.default;
      const uv = new Float32Array(count * 2);
      for (let i = 0; i < count; i++) {
        const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
        let u, v;
        if (ay > ax && ay > az) { u = p.getX(i); v = p.getZ(i); }
        else if (ax > az) { u = p.getZ(i); v = p.getY(i); }
        else { u = p.getX(i); v = p.getY(i); }
        uv[i * 2] = u * sc; uv[i * 2 + 1] = v * sc;
      }
      g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    }
    const c = this.col.set(color);
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) { colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) g.deleteAttribute(k);
    (this.buckets[bucket] || (this.buckets[bucket] = [])).push(g);
    return g;
  }

  box(bucket, w, h, d, matrix, color) { return this.add(bucket, new THREE.BoxGeometry(w, h, d), matrix, color); }
  cyl(bucket, rt, rb, h, seg, matrix, color) { return this.add(bucket, new THREE.CylinderGeometry(rt, rb, h, seg), matrix, color); }

  build(materials, { castShadow = true, receiveShadow = true } = {}) {
    const group = new THREE.Group();
    for (const [name, list] of Object.entries(this.buckets)) {
      if (!list.length) continue;
      const merged = mergeGeometries(list, false);
      merged.computeBoundingSphere();
      const mat = materials[name] || materials.default;
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = castShadow && name !== 'window' && name !== 'windowLit' && name !== 'glow';
      mesh.receiveShadow = receiveShadow;
      mesh.name = name;
      group.add(mesh);
    }
    this.buckets = {};
    return group;
  }
}

// Gable roof: ridge along X. width w (x), depth d (z), rise h, overhang o.
export function gableRoofGeometry(w, d, h, o = 0.6) {
  const x0 = -w / 2 - o, x1 = w / 2 + o, zf = d / 2 + o, zb = -d / 2 - o;
  const v = [
    x0, 0, zf, x1, 0, zf, x1, h, 0,
    x0, 0, zf, x1, h, 0, x0, h, 0,
    x1, 0, zb, x0, 0, zb, x0, h, 0,
    x1, 0, zb, x0, h, 0, x1, h, 0,
  ];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.computeVertexNormals();
  return g;
}

export function gableEndGeometry(d, h) {
  // triangle in the YZ plane at x=0, facing +X (use two to close both ends)
  const v = [0, 0, d / 2, 0, 0, -d / 2, 0, h, 0];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.computeVertexNormals();
  return g;
}

export function hipRoofGeometry(w, d, h, o = 0.6) {
  const g = new THREE.ConeGeometry(Math.SQRT1_2, 1, 4, 1, true);
  g.rotateY(Math.PI / 4);
  g.translate(0, 0.5, 0);
  g.scale(w + o * 2, h, d + o * 2);
  return g;
}

// Photographic building materials (Poly Haven, CC0; tools/build-textures.mjs). Each photo is normalised to a
// neutral average so the per-building vertex colours still paint the town's palette on top of it.
const PHOTO = { wall: 'clay_plaster', clap: 'brown_planks_03', wood: 'brown_planks_09', roof: 'clay_roof_tiles_02', stone: 'coral_fort_wall_01' };
const PHOTO_SCALE = { wall: 0.42, clap: 0.4, wood: 0.5, roof: 0.45, stone: 0.3 };
const photo = {};
export async function loadTownTextures(base = './textures/town/') {
  const loader = new THREE.TextureLoader();
  const load = (url, srgb) => new Promise((res) => loader.load(url, (t) => { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; if (srgb) t.colorSpace = THREE.SRGBColorSpace; res(t); }, undefined, () => res(null)));
  await Promise.all(Object.entries(PHOTO).map(async ([bucket, id]) => {
    const [map, normalMap, arm] = await Promise.all([load(base + id + '_d.webp', true), load(base + id + '_n.webp'), load(base + id + '_arm.webp')]);
    if (!map) return;
    // mean colour (linear) -> neutralising multiplier
    const c = document.createElement('canvas'); c.width = c.height = 32;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(map.image, 0, 0, 32, 32);
    const d = ctx.getImageData(0, 0, 32, 32).data;
    const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    let r = 0, g = 0, b = 0;
    for (let i = 0; i < d.length; i += 4) { r += lin(d[i]); g += lin(d[i + 1]); b += lin(d[i + 2]); }
    const n = d.length / 4, k = 0.72;
    photo[bucket] = { map, normalMap, arm, gain: new THREE.Color(k * n / Math.max(r, 1e-3), k * n / Math.max(g, 1e-3), k * n / Math.max(b, 1e-3)) };
    UV_SCALE[bucket] = PHOTO_SCALE[bucket];
  }));
}

let _materials = null;
export function sharedMaterials() {
  if (_materials) return _materials;
  const std = (o) => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0, ...o });
  const ph = (bucket, fallback, o = {}) => {
    const P = photo[bucket];
    if (!P) return std({ map: fallback(), ...o });
    return std({ map: P.map, normalMap: P.normalMap, roughnessMap: P.arm, aoMap: P.arm, aoMapIntensity: 0.6, color: P.gain, normalScale: new THREE.Vector2(1, 1), ...o, roughness: 1 });
  };
  _materials = {
    wall: ph('wall', stuccoTexture),
    clap: ph('clap', plasterClapboardTexture),
    wood: ph('wood', () => woodTexture('#b08a62', 'neutralwood'), { roughness: 0.85 }),
    roof: ph('roof', roofTileTexture, { roughness: 0.8, side: THREE.DoubleSide }),
    thatch: std({ map: thatchTexture(), roughness: 1, side: THREE.DoubleSide }),
    stone: ph('stone', stoneTexture, { roughness: 0.95 }),
    cloth: std({ roughness: 1, side: THREE.DoubleSide }),
    metal: std({ roughness: 0.5, metalness: 0.6 }),
    plain: std({}),
    // crown glass: dark panes that catch the sky
    window: std({ roughness: 0.12, metalness: 0.6, color: '#b8c6d0', envMapIntensity: 1.6 }),
    windowLit: std({ roughness: 0.15, metalness: 0.5, color: '#b8c6d0', envMapIntensity: 1.4, emissive: new THREE.Color('#ffae55'), emissiveIntensity: 0 }),
    glow: new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffcf80').multiplyScalar(4) }),
    default: std({}),
  };
  return _materials;
}
