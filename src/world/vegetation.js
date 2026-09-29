// Instanced palms, jungle trees, bushes and rocks, chunked for culling, with wind sway in the shader.
import * as THREE from 'three';
import { mulberry32, clamp } from '../core/noise.js';
import { props } from './props.js';
import { flora, TREE_TYPES } from './flora.js';

const CHUNK = 700;
const DETAIL_CHUNK = 120; // ground detail (ferns, shells, stumps) is culled much closer
export const windUniforms = { uTime: { value: 0 }, uWind: { value: 1 } };

function addSway(mat, amount) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = windUniforms.uTime;
    shader.uniforms.uWind = windUniforms.uWind;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uWind;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec3 ip = instanceMatrix[3].xyz;
        #else
          vec3 ip = vec3(0.0);
        #endif
        float ph = ip.x * 0.13 + ip.z * 0.07;
        float hgt = max(position.y, 0.0);
        float sway = (sin(uTime * 1.3 + ph) * 0.6 + sin(uTime * 2.7 + ph * 1.7) * 0.25) * uWind * ${amount.toFixed(4)} * hgt * hgt;
        transformed.x += sway;
        transformed.z += sway * 0.6;`);
  };
  return mat;
}

function palmLeafTexture() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 512;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 128, 512);
  // rachis
  ctx.strokeStyle = '#6f7a2c';
  ctx.lineWidth = 5;
  ctx.beginPath(); ctx.moveTo(64, 0); ctx.lineTo(64, 512); ctx.stroke();
  // leaflets
  for (let y = 10; y < 500; y += 9) {
    const t = y / 512;
    const len = 58 * Math.sin(Math.PI * Math.min(1, t * 1.1 + 0.05));
    for (const s of [-1, 1]) {
      const g = 90 + Math.random() * 50;
      ctx.strokeStyle = `rgb(${50 + Math.random() * 30},${g},${30 + Math.random() * 15})`;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(64, y);
      ctx.quadraticCurveTo(64 + s * len * 0.5, y + 6, 64 + s * len, y + 22);
      ctx.stroke();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function buildPalmTrunk() {
  // curved, tapered trunk with ring segments
  const seg = 10, radial = 7, height = 11;
  const pos = [], idx = [], nrm = [];
  for (let i = 0; i <= seg; i++) {
    const t = i / seg;
    const y = t * height;
    const bend = t * t * 2.2;
    const r = 0.42 - t * 0.2 + (i % 2 ? 0.03 : 0);
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      pos.push(Math.cos(a) * r + bend, y, Math.sin(a) * r);
      nrm.push(Math.cos(a), 0, Math.sin(a));
    }
  }
  for (let i = 0; i < seg; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * (radial + 1) + j, b = a + 1, c = a + radial + 1, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setIndex(idx);
  return g;
}

function buildPalmCrown() {
  const geos = [];
  const leaves = 9;
  for (let i = 0; i < leaves; i++) {
    const g = new THREE.PlaneGeometry(1.8, 5.5, 1, 6);
    // bend the leaf downward along its length
    const p = g.attributes.position;
    for (let v = 0; v < p.count; v++) {
      const y = p.getY(v) + 2.75; // 0..5.5 along leaf
      const t = y / 5.5;
      p.setXYZ(v, p.getX(v) * (1 - t * 0.3), -t * t * 2.6 + t * 0.9, y);
      // slight V fold
    }
    g.computeVertexNormals();
    g.rotateY((i / leaves) * Math.PI * 2 + (i % 2) * 0.3);
    g.rotateX(0);
    g.translate(2.2, 11, 0);
    geos.push(g);
  }
  // coconuts
  const nut = new THREE.SphereGeometry(0.28, 6, 5);
  const merged = mergeSimple(geos);
  return { leaves: merged, nut };
}

function mergeSimple(geos) {
  let total = 0, totalIdx = 0;
  for (const g of geos) { total += g.attributes.position.count; totalIdx += g.index.count; }
  const pos = new Float32Array(total * 3), nrm = new Float32Array(total * 3), uv = new Float32Array(total * 2);
  const idx = new Uint32Array(totalIdx);
  let vo = 0, io = 0;
  for (const g of geos) {
    pos.set(g.attributes.position.array, vo * 3);
    nrm.set(g.attributes.normal.array, vo * 3);
    if (g.attributes.uv) uv.set(g.attributes.uv.array, vo * 2);
    const gi = g.index.array;
    for (let i = 0; i < gi.length; i++) idx[io + i] = gi[i] + vo;
    vo += g.attributes.position.count;
    io += gi.length;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}

function blob(radius, detail, seed, squash = 1) {
  const g = new THREE.IcosahedronGeometry(radius, detail);
  const p = g.attributes.position;
  const rnd = mulberry32(seed);
  const offs = [];
  for (let i = 0; i < 6; i++) offs.push([rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 0.25]);
  for (let i = 0; i < p.count; i++) {
    const v = new THREE.Vector3(p.getX(i), p.getY(i), p.getZ(i));
    const n = v.clone().normalize();
    let d = 1;
    for (const o of offs) d += Math.sin(n.x * 3 * o[0] + n.y * 3 * o[1] + n.z * 3 * o[2]) * o[3];
    v.multiplyScalar(d);
    v.y *= squash;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

function buildTree() {
  const trunk = new THREE.CylinderGeometry(0.25, 0.5, 7, 6, 1);
  trunk.translate(0, 3.5, 0);
  const parts = [];
  const rnd = mulberry32(5);
  for (let i = 0; i < 3; i++) {
    const b = blob(2.9 + rnd() * 1.2, 1, 10 + i, 0.75);
    b.translate((rnd() - 0.5) * 3, 7 + rnd() * 2.5, (rnd() - 0.5) * 3);
    parts.push(b.index ? b : b);
  }
  const canopy = mergeNonIndexed(parts);
  return { trunk, canopy };
}

function mergeNonIndexed(geos) {
  const arr = geos.map((g) => (g.index ? g.toNonIndexed() : g));
  let total = 0;
  for (const g of arr) total += g.attributes.position.count;
  const pos = new Float32Array(total * 3), nrm = new Float32Array(total * 3);
  let o = 0;
  for (const g of arr) {
    pos.set(g.attributes.position.array, o * 3);
    nrm.set(g.attributes.normal.array, o * 3);
    o += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  return out;
}

export class Vegetation {
  constructor(scene, terrain, avoid, quality = 'high') {
    this.scene = scene;
    this.chunks = new Map();
    const density = quality === 'low' ? 0.45 : quality === 'medium' ? 0.7 : 1.0;
    this.viewDist = quality === 'low' ? 1600 : quality === 'medium' ? 2200 : 2900;

    const palmTrunk = buildPalmTrunk();
    const crown = buildPalmCrown();
    const tree = buildTree();
    const bush = blob(1.6, 1, 77, 0.7);
    bush.translate(0, 0.6, 0);
    const rock = new THREE.DodecahedronGeometry(1.4, 1);
    {
      const p = rock.attributes.position;
      const rnd = mulberry32(8);
      for (let i = 0; i < p.count; i++) p.setXYZ(i, p.getX(i) * (0.8 + rnd() * 0.4), p.getY(i) * (0.55 + rnd() * 0.2), p.getZ(i) * (0.8 + rnd() * 0.4));
      rock.computeVertexNormals();
    }

    const leafTex = palmLeafTexture();
    this.types = {
      palmTrunk: { geo: palmTrunk, mat: addSway(new THREE.MeshStandardMaterial({ color: '#7c6a52', roughness: 0.95 }), 0.0035), shadow: true },
      palmCrown: { geo: crown.leaves, mat: addSway(new THREE.MeshStandardMaterial({ map: leafTex, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.8, color: '#dfe8c0' }), 0.0035), shadow: true },
      treeTrunk: { geo: tree.trunk, mat: new THREE.MeshStandardMaterial({ color: '#5a4632', roughness: 1 }), shadow: true },
      treeCanopy: { geo: tree.canopy, mat: addSway(new THREE.MeshStandardMaterial({ color: '#3d6128', roughness: 0.9, flatShading: true }), 0.0012), shadow: true },
      bush: { geo: bush, mat: addSway(new THREE.MeshStandardMaterial({ color: '#4c6e2c', roughness: 0.95, flatShading: true }), 0.01), shadow: false },
      rock: { geo: rock, mat: new THREE.MeshStandardMaterial({ color: '#8a8272', roughness: 0.95, flatShading: true }), shadow: true },
    };

    // scanned ground detail from Poly Haven, when available
    const scanned = { fern: 'fern_02', sorrel: 'shrub_sorrel_01', stump: 'tree_stump_01', shell: 'lambis_shell', shelf: 'coast_rocks_01' };
    const sway = { fern: 0.06, sorrel: 0.12 };
    const typeMap = { palm: ['palmTrunk', 'palmCrown'], tree: ['treeTrunk', 'treeCanopy'], bush: ['bush'], rock: ['rock'] };
    const detail = new Set();
    for (const [kind, file] of Object.entries(scanned)) {
      if (!props.has(file)) continue;
      typeMap[kind] = props.parts[file].map((p, i) => {
        const name = kind + i;
        const mat = sway[kind] ? addSway(p.material, sway[kind]) : p.material;
        this.types[name] = { geo: p.geometry, mat, shadow: kind === 'stump' || kind === 'shelf' };
        return name;
      });
      if (kind !== 'shelf') detail.add(kind);
    }
    this.detailDist = quality === 'low' ? 110 : quality === 'medium' ? 170 : 230;

    const buckets = new Map(); // chunkKey -> type -> [matrices]
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), pv = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0), tiltAxis = new THREE.Vector3();
    const species = TREE_TYPES.filter((t) => flora.has(t));
    this.trees = {}; // species -> [[x,y,z,yaw,scale]] for the flora near-field
    const push = (type, x, y, z, rotY, scale, tilt = 0) => {
      if (type === 'tree' && species.length) {
        const sp = species[Math.floor(((x * 12.9898 + z * 78.233) % 1 + 1) % 1 * species.length) % species.length];
        const entry = [x, y + 0.25, z, rotY, 0.7 + (scale - 0.75) / 0.75 * 0.5];
        (this.trees[sp] || (this.trees[sp] = [])).push(entry);
        type = 'tree:' + sp;
        const key = Math.floor(x / CHUNK) + ',' + Math.floor(z / CHUNK);
        if (!buckets.has(key)) buckets.set(key, {});
        const b = buckets.get(key);
        (b[type] || (b[type] = [])).push(entry);
        return;
      }
      if (!typeMap[type]) return;
      const d = detail.has(type);
      const key = (d ? 'd' : '') + Math.floor(x / (d ? DETAIL_CHUNK : CHUNK)) + ',' + Math.floor(z / (d ? DETAIL_CHUNK : CHUNK));
      if (!buckets.has(key)) buckets.set(key, {});
      const b = buckets.get(key);
      (b[type] || (b[type] = [])).push([x, y, z, rotY, scale, tilt]);
    };

    const rnd = mulberry32(2024);
    for (const is of terrain.islands) {
      const area = Math.PI * is.rx * is.rz;
      // big islands get a slightly thinner scatter so the triangle budget stays sane
      const per = area > 2e6 ? 520 : area > 5e5 ? 430 : 360;
      const n = Math.floor(area / per * density);
      const ax = is.rx + is.warpAmp, az = is.rz + is.warpAmp;
      for (let i = 0; i < n; i++) {
        // sample in the island's rotated bounding box
        const lx = (rnd() * 2 - 1) * ax, lz = (rnd() * 2 - 1) * az;
        const x = is.x + lx * is.cos + lz * is.sin;
        const z = is.z - lx * is.sin + lz * is.cos;
        const h = terrain.height(x, z);
        if (h < 1.2) continue;
        if (avoid(x, z)) continue;
        const nrm = terrain.normal(x, z);
        const slope = 1 - nrm.y;
        const r = rnd();
        const jun = clamp(is.jungle + terrain.noise.noise2(x * 0.01, z * 0.01) * 0.35, 0, 1);
        if (h < 6.5 && slope < 0.2) {
          // beach & lowland: palms
          if (r < 0.28) {
            const sc = 0.75 + rnd() * 0.55;
            push('palm', x, h - 0.2, z, rnd() * Math.PI * 2, sc, 0);
          } else if (r < 0.34) push('bush', x, h, z, rnd() * 6, 0.6 + rnd() * 0.7);
        } else if (slope < 0.62) {
          if (r < 0.16 + jun * 0.5) push('tree', x, h - 0.3, z, rnd() * 6, 0.75 + rnd() * 0.75);
          else if (r < 0.24 + jun * 0.55) push('bush', x, h, z, rnd() * 6, 0.7 + rnd() * 1.1);
          else if (r < 0.25 + jun * 0.4 && h < 30) push('palm', x, h - 0.2, z, rnd() * 6, 0.8 + rnd() * 0.5);
          else if (r > 0.97) push('rock', x, h - 0.2, z, rnd() * 6, 0.6 + rnd() * 1.6);
        } else if (r < 0.2) {
          push('rock', x, h - 0.4, z, rnd() * 6, 0.8 + rnd() * 2.2);
        }
      }
    }

    // understory and shoreline detail
    if (detail.size || typeMap.shelf) {
      for (const is of terrain.islands) {
        const area = Math.PI * is.rx * is.rz;
        const n = Math.floor(area / 55 * density);
        const ax = is.rx + is.warpAmp, az = is.rz + is.warpAmp;
        for (let i = 0; i < n; i++) {
          const lx = (rnd() * 2 - 1) * ax, lz = (rnd() * 2 - 1) * az;
          const x = is.x + lx * is.cos + lz * is.sin;
          const z = is.z - lx * is.sin + lz * is.cos;
          const h = terrain.height(x, z);
          if (h < -1.5 || h > 70) continue;
          if (avoid(x, z)) continue;
          const r = rnd();
          if (h < 1.1) {
            // rock shelves breaking the surf line
            if (r < 0.003 && h > -0.8) push('shelf', x, Math.max(h, -0.3) - 0.1, z, rnd() * 6, 0.2 + rnd() * 0.25);
            continue;
          }
          const slope = 1 - terrain.normal(x, z).y;
          if (slope > 0.5) continue;
          if (h < 2.4) {
            if (r < 0.03) push('shell', x, h - 0.01, z, rnd() * 6, 2.6 + rnd() * 1.4);
            continue;
          }
          const jun = clamp(is.jungle + terrain.noise.noise2(x * 0.01, z * 0.01) * 0.35, 0, 1);
          if (r < 0.22 + jun * 0.4) push('fern', x, h - 0.05, z, rnd() * 6, 1.7 + rnd() * 1.5);
          else if (r < 0.3 + jun * 0.45) push('sorrel', x, h - 0.02, z, rnd() * 6, 5 + rnd() * 5);
          else if (r < 0.315 + jun * 0.46) push('stump', x, h - 0.1, z, rnd() * 6, 0.9 + rnd() * 0.7);
        }
      }
    }

    if (species.length) flora.initNear(scene, this.trees, quality !== 'low');
    this.counts = {};
    for (const b of buckets.values()) for (const k in b) this.counts[k] = (this.counts[k] || 0) + b[k].length;
    // build instanced meshes per chunk
    for (const [key, b] of buckets) {
      const group = new THREE.Group();
      const d = key[0] === 'd';
      const size = d ? DETAIL_CHUNK : CHUNK;
      const [cx, cz] = key.replace('d', '').split(',').map(Number);
      group.userData.center = new THREE.Vector3((cx + 0.5) * size, 0, (cz + 0.5) * size);
      group.userData.detail = d;
      for (const kind in b) {
        const list = b[kind];
        if (kind.startsWith('tree:')) { group.add(flora.impostorMesh(kind.slice(5), list)); continue; }
        for (const tName of typeMap[kind]) {
          const t = this.types[tName];
          const im = new THREE.InstancedMesh(t.geo, t.mat, list.length);
          im.castShadow = t.shadow && quality !== 'low';
          im.receiveShadow = true;
          for (let i = 0; i < list.length; i++) {
            const [x, y, z, ry, sc] = list[i];
            q.setFromAxisAngle(up, ry);
            s.setScalar(sc);
            pv.set(x, y, z);
            m.compose(pv, q, s);
            im.setMatrixAt(i, m);
          }
          im.computeBoundingSphere();
          group.add(im);
        }
      }
      scene.add(group);
      this.chunks.set(key, group);
    }
  }

  update(dt, camPos, wind = 1) {
    windUniforms.uTime.value += dt;
    windUniforms.uWind.value = wind;
    const vd2 = this.viewDist * this.viewDist, dd2 = this.detailDist * this.detailDist;
    for (const g of this.chunks.values()) {
      const c = g.userData.center;
      const dx = c.x - camPos.x, dz = c.z - camPos.z;
      g.visible = dx * dx + dz * dz < (g.userData.detail ? dd2 : vd2);
    }
  }
}
