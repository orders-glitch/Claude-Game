// Town crowds: hundreds of townsfolk drawn as instanced meshes whose animation is baked into textures
// ("vertex animation textures"). Each look (peasant with a straw hat, woman in a headwrap, merchant in a coat
// and tricorne, …) is one draw call however many people wear it; per-person colours (coat, linen, skin,
// hair, hat) and the walk / idle / talk / sit / work cycles are chosen per instance. They walk a graph of
// the town's streets, stop to talk in knots on the corners, sit on benches and work the waterfront.
import * as THREE from 'three';
import { MeshoptSimplifier } from 'meshoptimizer';
import { humans } from './humans.js';

const CLIPS = [['walk', 20], ['idle', 12], ['talk', 16], ['sit', 10], ['work', 14]];
const TEX_W = 1024;

const LOOKS = [
  { id: 'm_straw', sex: 'male', outfit: 'outfit_male_peasant', hair: 'hair_buzzed', beard: true, hat: 'straw' },
  { id: 'm_bare', sex: 'male', outfit: 'outfit_male_peasant', hair: 'hair_long', beard: false, hat: null },
  { id: 'm_bandana', sex: 'male', outfit: 'outfit_male_peasant', hair: 'hair_buzzed', beard: true, hat: 'bandana' },
  { id: 'f_wrap', sex: 'female', outfit: 'outfit_female_peasant', hair: 'hair_buns', hat: 'headwrap' },
  { id: 'f_bonnet', sex: 'female', outfit: 'outfit_female_peasant', hair: 'hair_buns', hat: 'bonnet' },
  { id: 'm_coat', sex: 'male', outfit: 'outfit_male_ranger', hair: 'hair_simpleparted', beard: false, hat: 'tricorne' },
  { id: 'f_lady', sex: 'female', outfit: 'outfit_female_ranger', hair: 'hair_long', hat: null },
  { id: 'm_coat_bare', sex: 'male', outfit: 'outfit_male_ranger', hair: 'hair_long', beard: true, hat: null },
  { id: 'f_basket', sex: 'female', outfit: 'outfit_female_peasant', hair: 'hair_buns', hat: 'basket' }, // market women
  { id: 'm_porter', sex: 'male', outfit: 'outfit_male_peasant', hair: 'hair_buzzed', beard: false, hat: 'bundle' }, // porters
];

// who is on the streets of each port: [look, weight, palette]
const SKIN = { light: ['#f0cdb4', '#e2b594', '#d8a888'], mid: ['#c99670', '#b98460', '#a8744e'], dark: ['#7c5034', '#5a3624', '#6a4430', '#8a5a3c'] };
const HAIRC = ['#2a1a10', '#4a2e1a', '#1a1410', '#6a4a2a', '#8a6a4a', '#b89a70', '#1a1410'];
const LINEN = ['#efe6d6', '#e2d6c0', '#d6c8ae', '#c9b79a', '#b8ab94', '#dcd4c2'];
const EARTH = ['#6a5a44', '#4a3a2a', '#5a4a5a', '#3a4a3a', '#7a6a4a', '#5a4632', '#8a7a5a', '#4a4a52'];
const POP = {
  havana: [
    ['f_basket', 2.2, { coat: ['#8a4a5a', '#5a6a8a', '#a86a4a', '#e6dcc8', '#b8442a', '#6a8a9a'], skin: [...SKIN.dark, ...SKIN.mid], hat: ['#e6dcc8', '#b8442a'] }], // vendors with head baskets
    ['m_porter', 1.4, { coat: EARTH, skin: [...SKIN.dark, ...SKIN.mid], hat: ['#8a7a58', '#7a6a4a', '#9a8a68', '#6a5a40'] }], // porters from the quays
    ['m_straw', 3, { coat: EARTH, skin: [...SKIN.mid, ...SKIN.dark], hat: ['#c8b078', '#b8a068'] }],
    ['m_bare', 2, { coat: EARTH, skin: [...SKIN.dark, ...SKIN.mid] }], // porters, stevedores, water carriers
    ['f_wrap', 3, { coat: ['#8a4a5a', '#5a6a8a', '#a86a4a', '#e6dcc8', '#b8442a', '#6a8a9a'], skin: [...SKIN.dark, ...SKIN.mid], hat: ['#d9d0bd', '#b8442a', '#e0c060', '#6a8a9a', '#dcd4c2'] }],
    ['f_bonnet', 1.5, { coat: ['#2a2a3a', '#5a3a4a', '#3a4a6a', '#6a5a4a'], skin: [...SKIN.light, ...SKIN.mid], hat: ['#1a1a1a', '#d9d0bd'] }],
    ['m_coat', 2, { coat: ['#2a3a5a', '#3a2a2a', '#1a1a1a', '#4a3a2a', '#27408a', '#5a2a1a'], skin: [...SKIN.light, ...SKIN.mid], hat: ['#15110e'] }], // merchants, officers, soldiers
    ['f_lady', 0.6, { coat: ['#5a2a3a', '#2a3a5a', '#1a1a1a'], skin: SKIN.light }],
    ['m_coat_bare', 1, { coat: ['#6a6a6a', '#5a4632', '#e6e2d6'], skin: SKIN.mid }], // friars in grey, clerks
  ],
  portroyal: [
    ['f_basket', 1.5, { coat: ['#a86a4a', '#5a6a8a', '#e6dcc8', '#8a4a5a'], skin: [...SKIN.dark, ...SKIN.mid], hat: ['#e6dcc8'] }],
    ['m_porter', 1.2, { coat: EARTH, skin: [...SKIN.dark, ...SKIN.mid, ...SKIN.light], hat: ['#8a7a58', '#7a6a4a', '#9a8a68', '#6a5a40'] }],
    ['m_bandana', 3, { coat: ['#2a3450', '#3a3a3a', '#6a4a2a', '#e6e2d6', '#5a1e2a'], skin: [...SKIN.light, ...SKIN.mid, ...SKIN.dark], hat: ['#8a2a1a', '#2a3a5a', '#1a1a1a', '#e6dcc8'] }], // seamen
    ['m_straw', 2, { coat: EARTH, skin: [...SKIN.dark, ...SKIN.mid], hat: ['#c8b078'] }],
    ['m_coat', 2.5, { coat: ['#c8281f', '#c8281f', '#1f2f5a', '#2a2a2a', '#4a3a2a'], skin: SKIN.light, hat: ['#15110e'] }], // redcoats, naval officers, merchants
    ['f_wrap', 2, { coat: ['#a86a4a', '#5a6a8a', '#e6dcc8', '#8a4a5a'], skin: [...SKIN.dark, ...SKIN.mid], hat: ['#d9d0bd', '#b8442a', '#e0c060'] }],
    ['f_bonnet', 1.5, { coat: ['#3a4a6a', '#5a3a4a', '#6a5a4a', '#2a2a3a'], skin: SKIN.light, hat: ['#d9d0bd', '#dcd4c2'] }],
    ['m_bare', 1.5, { coat: EARTH, skin: [...SKIN.dark, ...SKIN.mid] }],
    ['f_lady', 0.5, { coat: ['#5a2a3a', '#2a3a5a'], skin: SKIN.light }],
  ],
  nassau: [
    ['m_porter', 0.6, { coat: ['#5a2a1a', '#2a3450', '#6a4a2a'], skin: [...SKIN.light, ...SKIN.mid, ...SKIN.dark], hat: ['#8a7a58', '#7a6a4a', '#9a8a68', '#6a5a40'] }], // plunder carried up the beach
    ['m_bandana', 4, { coat: ['#5a2a1a', '#2a3450', '#3a3a3a', '#6a4a2a', '#5a1e2a', '#2e4a3a', '#8a2a1a'], skin: [...SKIN.light, ...SKIN.mid, ...SKIN.dark], hat: ['#8a2a1a', '#2a3a5a', '#1a1a1a', '#6a5a2a', '#7a1d1d'] }],
    ['m_bare', 3, { coat: ['#5a2a1a', '#2a3450', '#3a3a3a', '#6a4a2a', '#7a6a4a'], skin: [...SKIN.light, ...SKIN.mid, ...SKIN.dark] }],
    ['m_straw', 2, { coat: EARTH, skin: [...SKIN.mid, ...SKIN.dark], hat: ['#c8b078'] }],
    ['m_coat_bare', 1.5, { coat: ['#5a1e2a', '#2a3a5a', '#7a1c1c', '#1a1a1a'], skin: [...SKIN.light, ...SKIN.mid] }], // captains in prize coats
    ['m_coat', 1, { coat: ['#7a1c1c', '#1a1a1a', '#2a3a5a'], skin: SKIN.light, hat: ['#15110e'] }],
    ['f_wrap', 0.8, { coat: ['#8a4a5a', '#a86a4a', '#e6dcc8'], skin: [...SKIN.dark, ...SKIN.mid], hat: ['#b8442a', '#d9d0bd'] }],
  ],
  tortuga: [
    ['f_basket', 1, { coat: ['#5a6a8a', '#e6dcc8', '#7a2e24'], skin: [...SKIN.dark, ...SKIN.mid], hat: ['#e6dcc8'] }],
    ['m_porter', 1, { coat: ['#7a2e24', '#5a4632', '#4a3a2a'], skin: [...SKIN.light, ...SKIN.mid, ...SKIN.dark], hat: ['#8a7a58', '#7a6a4a', '#9a8a68', '#6a5a40'] }],
    ['m_straw', 3, { coat: ['#e6e2d6', '#c9b79a', '#8a7a5a', '#5e7482'], skin: [...SKIN.light, ...SKIN.mid], hat: ['#c8b078'] }], // habitants, engagés
    ['m_bare', 2, { coat: ['#7a2e24', '#5a4632', '#4a3a2a', '#8a6a4a'], skin: [...SKIN.light, ...SKIN.mid, ...SKIN.dark] }], // boucaniers in stained smocks
    ['m_bandana', 1.5, { coat: ['#2a3450', '#3a3a3a', '#6a4a2a'], skin: [...SKIN.light, ...SKIN.mid], hat: ['#8a2a1a', '#1a1a1a'] }],
    ['f_wrap', 1.5, { coat: ['#5a6a8a', '#e6dcc8', '#7a2e24'], skin: [...SKIN.dark, ...SKIN.mid], hat: ['#d9d0bd', '#b8442a'] }],
    ['f_bonnet', 1, { coat: ['#3a4a6a', '#6a5a4a'], skin: SKIN.light, hat: ['#d9d0bd'] }],
    ['m_coat', 0.8, { coat: ['#e6e2d6', '#1f3d78', '#2a2a2a'], skin: SKIN.light, hat: ['#15110e'] }],
  ],
};
// the garrisons: coats of the Spanish, English and French foot
const SOLDIERS = {
  havana: { patrols: 9, coat: ['#e6e2d6', '#e6e2d6', '#27408a'], skin: [...SKIN.light, ...SKIN.mid] },
  portroyal: { patrols: 8, coat: ['#c8281f'], skin: SKIN.light },
  tortuga: { patrols: 3, coat: ['#e6e2d6', '#2a3a6a'], skin: [...SKIN.light, ...SKIN.mid] },
};
const COUNT = { havana: 540, portroyal: 400, nassau: 300, tortuga: 150 };

const pick = (a) => a[Math.floor(Math.random() * a.length)];
const rand = (a, b) => a + Math.random() * (b - a);

// ---------------------------------------------------------------- baking
function imageData(tex) {
  if (!tex || !tex.image) return null;
  if (tex.userData.px) return tex.userData.px;
  const img = tex.image, w = Math.min(512, img.width), h = Math.min(512, img.height);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);
  tex.userData.px = { w, h, d: ctx.getImageData(0, 0, w, h).data };
  return tex.userData.px;
}
const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };

function hueOf(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  if (d < 1e-5) return [0, 0, mx];
  let h;
  if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4;
  return [((h / 6) + 1) % 1, d / Math.max(mx, 1e-5), mx];
}

// flags: 0 keep, 1 coat cloth (recoloured), 2 skin, 3 hair, 4 linen (tinted), 5 hat
async function bakeLook(look) {
  const model = humans.assemble({ sex: look.sex, brows: look.sex === 'male' ? 'eyebrows_regular' : 'eyebrows_female', outfit: look.outfit, coat: '#3a6a3a', tint: '#ffffff', hair: look.hair, beard: look.beard, hat: look.hat, hatColor: '#ffffff', skin: '#c99670', hairColor: '#ffffff' });
  const E = humans.entry();
  model.scale.setScalar(E.scale);
  model.position.y = E.groundY;
  model.rotation.y = Math.PI; // the models face +Z; the game's people face -Z at yaw 0
  const root = new THREE.Group();
  root.add(model);
  root.updateMatrixWorld(true);
  // gather parts: skinned meshes (simplified) and the static hat
  const parts = [];
  const seen = new Set();
  model.traverse((o) => {
    if (!o.isMesh || !o.visible) return;
    const mat = Array.isArray(o.material) ? o.material[0] : o.material;
    const key = o.geometry.uuid + (o.isSkinnedMesh ? '' : o.uuid);
    if (seen.has(key)) return; // (the brows come twice)
    seen.add(key);
    parts.push({ o, mat });
  });
  // build the merged, simplified geometry: per part keep a vertex subset
  const vtx = []; // { part, i }
  const idx = [];
  for (const P of parts) {
    const g = P.o.geometry;
    const pa = g.attributes.position;
    const pos = new Float32Array(pa.count * 3);
    for (let i = 0; i < pa.count; i++) { pos[i * 3] = pa.getX(i); pos[i * 3 + 1] = pa.getY(i); pos[i * 3 + 2] = pa.getZ(i); }
    let index = g.index ? g.index.array : null;
    if (!index) { index = new Uint32Array(g.attributes.position.count); for (let i = 0; i < index.length; i++) index[i] = i; }
    let keep = new Uint32Array(index);
    if (P.o.isSkinnedMesh && index.length > 900) {
      // faces keep most of their detail; clothes and hair are simplified harder
      const ratio = /Regular|Superhero/.test(P.mat.name) ? 0.6 : /Hair|Eyebrows/.test(P.o.name + P.mat.name) ? 0.5 : /Ranger/.test(P.mat.name) ? 0.32 : 0.45;
      const [out] = MeshoptSimplifier.simplify(new Uint32Array(index), pos, 3, Math.floor((index.length * ratio) / 3) * 3, 0.06, []);
      keep = out;
    }
    const remap = new Map();
    for (const vi of keep) {
      if (!remap.has(vi)) { remap.set(vi, vtx.length); vtx.push({ P, i: vi }); }
      idx.push(remap.get(vi));
    }
  }
  const N = vtx.length;
  // colours and flags from the textures
  const col = new Float32Array(N * 3), flag = new Float32Array(N), vid = new Float32Array(N);
  // the characters' own textures (up to four per look), sampled in the shader for close-up detail
  const maps = [];
  for (const P of parts) if (P.mat.map && P.o.geometry.attributes.uv && !maps.includes(P.mat.map) && maps.length < 4) maps.push(P.mat.map);
  const buv = new Float32Array(N * 2), bmap = new Float32Array(N).fill(-1);
  let skinSum = [0, 0, 0], skinN = 0;
  for (let k = 0; k < N; k++) {
    const { P, i } = vtx[k];
    vid[k] = k;
    const mat = P.mat, name = mat.name || '';
    let r = 1, g = 1, b = 1;
    const uv = P.o.geometry.attributes.uv;
    const px = mat.map && uv ? imageData(mat.map) : null;
    if (px) {
      const u = uv.getX(i), v = uv.getY(i);
      const x = Math.min(px.w - 1, Math.max(0, Math.floor((u - Math.floor(u)) * px.w))), y = Math.min(px.h - 1, Math.max(0, Math.floor((v - Math.floor(v)) * px.h)));
      const o = (y * px.w + x) * 4;
      r = lin(px.d[o]); g = lin(px.d[o + 1]); b = lin(px.d[o + 2]);
    }
    if (uv && maps.includes(mat.map)) { buv[k * 2] = uv.getX(i); buv[k * 2 + 1] = uv.getY(i); bmap[k] = maps.indexOf(mat.map); }
    let f = 0;
    if (!P.o.isSkinnedMesh && mat.userData.keep) { f = 0; r = mat.color.r; g = mat.color.g; b = mat.color.b; } // wicker and fruit keep their own colours
    else if (!P.o.isSkinnedMesh) {
      // hats carry no texture: shade their folds and brims from the shape so a cap doesn't read as a helmet
      f = 5;
      const nm = P.o.geometry.attributes.normal;
      const ny = nm ? nm.getY(i) : 1, pa = P.o.geometry.attributes.position;
      const wob = 0.5 + 0.5 * Math.sin(pa.getX(i) * 90 + pa.getZ(i) * 60) * Math.sin(pa.getY(i) * 120);
      r = g = b = 0.62 + 0.22 * Math.max(0, ny) + 0.12 * wob;
    }
    else if (/Regular|Superhero/.test(name)) { f = 2; skinSum[0] += r; skinSum[1] += g; skinSum[2] += b; skinN++; }
    else if (/Hair/.test(name)) f = 3;
    else if (/Ranger|Peasant/.test(name)) {
      const [h, s] = hueOf(Math.sqrt(r), Math.sqrt(g), Math.sqrt(b));
      const [h2, s2, v2] = hueOf(Math.sqrt(r), Math.sqrt(g), Math.sqrt(b));
      // dyed cloth (olive greens and browns) takes the person's colours; pale linen is tinted; dark leather stays
      f = bmap[k] >= 0 ? 6 : v2 < 0.14 ? 0 : h2 > 0.06 && h2 < 0.5 && s2 > 0.25 ? 1 : 4; // 6: decided per texel
      void h; void s;
    }
    col[k * 3] = r; col[k * 3 + 1] = g; col[k * 3 + 2] = b; flag[k] = f;
  }
  const skinAvg = skinN ? new THREE.Vector3(skinSum[0] / skinN, skinSum[1] / skinN, skinSum[2] / skinN) : new THREE.Vector3(0.5, 0.35, 0.25);
  // animation frames -> textures
  const mixer = new THREE.AnimationMixer(model);
  const totalFrames = CLIPS.reduce((s, c) => s + c[1], 0);
  const rows = Math.ceil(N / TEX_W);
  const posData = new Float32Array(TEX_W * rows * totalFrames * 4);
  const nrmData = new Uint8Array(TEX_W * rows * totalFrames * 4);
  const clipInfo = {};
  const tmpGeo = new THREE.BufferGeometry();
  const tmpPos = new Float32Array(N * 3);
  tmpGeo.setAttribute('position', new THREE.BufferAttribute(tmpPos, 3));
  tmpGeo.setIndex(idx);
  const v = new THREE.Vector3();
  // per-part caches
  for (const P of parts) {
    P.skin = P.o.isSkinnedMesh;
    if (P.skin) {
      P.si = P.o.geometry.attributes.skinIndex; P.sw = P.o.geometry.attributes.skinWeight;
      P.bm = new Array(P.o.skeleton.bones.length);
      for (let q = 0; q < P.bm.length; q++) P.bm[q] = new THREE.Matrix4();
    }
  }
  const tmp = new THREE.Matrix4(), acc = new THREE.Vector3(), base = new THREE.Vector3(), part = new THREE.Vector3();
  let frame = 0;
  for (const [name, n] of CLIPS) {
    const clip = humans.clips[name] || humans.clips.idle;
    mixer.stopAllAction();
    const action = mixer.clipAction(clip);
    action.reset().play();
    clipInfo[name] = { start: frame, n, dur: clip.duration };
    for (let f = 0; f < n; f++, frame++) {
      action.time = (f / n) * clip.duration;
      mixer.update(0);
      root.updateMatrixWorld(true);
      for (const P of parts) {
        if (!P.skin) continue;
        const sk = P.o.skeleton;
        for (let q = 0; q < sk.bones.length; q++) P.bm[q].multiplyMatrices(sk.bones[q].matrixWorld, sk.boneInverses[q]);
        P.world = new THREE.Matrix4().copy(P.o.matrixWorld).multiply(P.o.bindMatrixInverse);
        // bone matrices already give world space: M_bone * inverse * bind * p
        P.wm = P.o.matrixWorld;
      }
      for (let k = 0; k < N; k++) {
        const { P, i } = vtx[k];
        const g = P.o.geometry.attributes.position;
        v.fromBufferAttribute(g, i);
        if (P.skin) {
          base.copy(v).applyMatrix4(P.o.bindMatrix);
          acc.set(0, 0, 0);
          for (let w = 0; w < 4; w++) {
            const wt = P.sw.getComponent(i, w);
            if (wt === 0) continue;
            part.copy(base).applyMatrix4(P.bm[P.si.getComponent(i, w)]);
            acc.addScaledVector(part, wt);
          }
          // acc is in world space already (bones carry the model's world transform)
          v.copy(acc);
        } else v.applyMatrix4(P.o.matrixWorld);
        tmpPos[k * 3] = v.x; tmpPos[k * 3 + 1] = v.y; tmpPos[k * 3 + 2] = v.z;
      }
      tmpGeo.attributes.position.needsUpdate = true;
      tmpGeo.computeVertexNormals();
      const nr = tmpGeo.attributes.normal.array;
      const off = frame * rows * TEX_W;
      for (let k = 0; k < N; k++) {
        const t = (off + k) * 4;
        posData[t] = tmpPos[k * 3]; posData[t + 1] = tmpPos[k * 3 + 1]; posData[t + 2] = tmpPos[k * 3 + 2]; posData[t + 3] = 1;
        nrmData[t] = (nr[k * 3] * 0.5 + 0.5) * 255; nrmData[t + 1] = (nr[k * 3 + 1] * 0.5 + 0.5) * 255; nrmData[t + 2] = (nr[k * 3 + 2] * 0.5 + 0.5) * 255; nrmData[t + 3] = 255;
      }
      void tmp;
    }
    await new Promise((r) => setTimeout(r, 0)); // keep the loading screen alive
  }
  const half = new Uint16Array(posData.length);
  for (let i = 0; i < half.length; i++) half[i] = THREE.DataUtils.toHalfFloat(posData[i]);
  const posTex = new THREE.DataTexture(half, TEX_W, rows * totalFrames, THREE.RGBAFormat, THREE.HalfFloatType);
  const nrmTex = new THREE.DataTexture(nrmData, TEX_W, rows * totalFrames, THREE.RGBAFormat, THREE.UnsignedByteType);
  for (const t of [posTex, nrmTex]) { t.magFilter = t.minFilter = THREE.NearestFilter; t.needsUpdate = true; }
  // the instanced geometry: rest positions only matter for bounds; the shader reads the textures
  const geo = new THREE.BufferGeometry();
  const rest = new Float32Array(N * 3);
  for (let k = 0; k < N; k++) { rest[k * 3] = posData[k * 4]; rest[k * 3 + 1] = posData[k * 4 + 1]; rest[k * 3 + 2] = posData[k * 4 + 2]; }
  geo.setAttribute('position', new THREE.BufferAttribute(rest, 3));
  // packed to stay under the 16 vertex attributes (the instanced colours and matrix take ten)
  const bcol = new Float32Array(N * 4), btex = new Float32Array(N * 3);
  for (let k = 0; k < N; k++) {
    bcol[k * 4] = col[k * 3]; bcol[k * 4 + 1] = col[k * 3 + 1]; bcol[k * 4 + 2] = col[k * 3 + 2]; bcol[k * 4 + 3] = flag[k];
    btex[k * 3] = buv[k * 2]; btex[k * 3 + 1] = buv[k * 2 + 1]; btex[k * 3 + 2] = bmap[k];
  }
  geo.setAttribute('bcol', new THREE.BufferAttribute(bcol, 4));
  geo.setAttribute('vid', new THREE.BufferAttribute(vid, 1));
  geo.setAttribute('btex', new THREE.BufferAttribute(btex, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  // pack the look's textures into one 2 x 2 atlas (one sampler: shadowed materials are short of texture units)
  let atlas = null;
  if (maps.length) {
    const c = document.createElement('canvas'); c.width = c.height = 1024;
    const ctx = c.getContext('2d');
    maps.forEach((m, k) => { if (m.image) ctx.drawImage(m.image, (k % 2) * 512, Math.floor(k / 2) * 512, 512, 512); });
    atlas = new THREE.CanvasTexture(c);
    atlas.colorSpace = THREE.SRGBColorSpace;
    atlas.flipY = false;
    atlas.anisotropy = 4;
  }
  return { look, geo, posTex, nrmTex, rows, clipInfo, skinAvg, verts: N, atlas };
}

// shader chunks shared by the colour and shadow materials
const VERT_HEAD = `
  uniform sampler2D uVatPos; uniform sampler2D uVatNrm; uniform float uRows;
  attribute float vid; attribute vec4 bcol; // rgb + colour flag
  attribute vec4 iAnim; // frame start, frame count, phase 0..1, blend to next frame
  attribute vec3 iCoat; attribute vec3 iSkin; attribute vec3 iHair; attribute vec3 iLinen; attribute vec3 iHat;
  varying vec3 vCrowdCol;
  ivec2 vatUV(float frame) {
    float i = vid;
    float row = floor(i / ${TEX_W}.0);
    return ivec2(int(i - row * ${TEX_W}.0), int(frame * uRows + row));
  }
  vec3 vatPos(float f0, float f1, float t) { return mix(texelFetch(uVatPos, vatUV(f0), 0).xyz, texelFetch(uVatPos, vatUV(f1), 0).xyz, t); }
`;
const VERT_BODY = `
  float fp = iAnim.z * iAnim.y;
  float fa = floor(fp), ft = fp - fa;
  float f0 = iAnim.x + mod(fa, iAnim.y), f1 = iAnim.x + mod(fa + 1.0, iAnim.y);
  vec3 transformed = vatPos(f0, f1, ft);
`;

function crowdMaterial(v) {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0 });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uVatPos = { value: v.posTex };
    shader.uniforms.uVatNrm = { value: v.nrmTex };
    shader.uniforms.uRows = { value: v.rows };
    shader.uniforms.uSkinAvg = { value: v.skinAvg };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + VERT_HEAD + '\nuniform vec3 uSkinAvg;')
      .replace('#include <beginnormal_vertex>', `
        float fpN = iAnim.z * iAnim.y; float faN = floor(fpN);
        float n0 = iAnim.x + mod(faN, iAnim.y), n1 = iAnim.x + mod(faN + 1.0, iAnim.y);
        vec3 objectNormal = normalize(mix(texelFetch(uVatNrm, vatUV(n0), 0).xyz, texelFetch(uVatNrm, vatUV(n1), 0).xyz, fpN - faN) * 2.0 - 1.0);
        #ifdef USE_TANGENT
          vec3 objectTangent = vec3(1.0, 0.0, 0.0);
        #endif`)
      .replace('#include <begin_vertex>', VERT_BODY + `
        vec3 c = bcol.rgb; float bflag = bcol.a;
        float l = dot(c, vec3(0.299, 0.587, 0.114));
        if (bflag < 0.5) {}
        else if (bflag < 1.5) c = iCoat * clamp(l * 2.2, 0.3, 1.0 + (1.0 - dot(iCoat, vec3(0.33))) * 0.4);
        else if (bflag < 2.5) c = c * iSkin / max(uSkinAvg, vec3(0.02));
        else if (bflag < 3.5) c = iHair * clamp(l * 3.0, 0.4, 1.6);
        else if (bflag < 4.5) c = c * iLinen;
        else if (bflag < 5.5) c = iHat * c.r * 1.2;
        vCrowdCol = c;
        vUv2 = btex.xy; vMap = btex.z; vFlag = bflag;
        vCoat = iCoat; vSkin = iSkin; vHair = iHair; vLinen = iLinen;`);
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nattribute vec3 btex;\nvarying vec2 vUv2; varying float vMap; varying float vFlag; varying vec3 vCoat; varying vec3 vSkin; varying vec3 vHair; varying vec3 vLinen;');
    shader.uniforms.uAtlas = { value: v.atlas };
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vCrowdCol; varying vec2 vUv2; varying float vMap; varying float vFlag;
        varying vec3 vCoat; varying vec3 vSkin; varying vec3 vHair; varying vec3 vLinen;
        uniform sampler2D uAtlas; uniform vec3 uSkinAvg;`)
      .replace('#include <color_fragment>', `
        vec3 cc = vCrowdCol;
        if (vMap > -0.5) {
          float cell = floor(vMap + 0.5);
          vec2 auv = (clamp(fract(vUv2), 0.002, 0.998) + vec2(mod(cell, 2.0), floor(cell / 2.0))) * 0.5;
          vec3 tex = texture2D(uAtlas, auv).rgb;
          float l = dot(tex, vec3(0.299, 0.587, 0.114));
          if (vFlag > 1.5 && vFlag < 2.5) cc = tex * vSkin / max(uSkinAvg, vec3(0.02));
          else if (vFlag > 2.5 && vFlag < 3.5) cc = vHair * clamp(l * 3.0, 0.3, 1.6);
          else if (vFlag > 4.5 && vFlag < 5.5) cc = vCrowdCol * clamp(l * 2.4, 0.45, 1.15); // hats: their weave and folds, in this person's colour
          else if (vFlag > 5.5) {
            // outfit: the dyed (olive) cloth takes this person's colour, linen is tinted, leather stays
            // classify on a blurred sample so the dye follows whole panels of cloth, not single texels
            vec3 sr = sqrt(max(texture2D(uAtlas, auv, 3.0).rgb, vec3(0.0)));
            float mx = max(sr.r, max(sr.g, sr.b)), mn = min(sr.r, min(sr.g, sr.b)), d = mx - mn;
            float h = 0.0;
            if (d > 1e-4) {
              if (mx == sr.r) h = mod((sr.g - sr.b) / d, 6.0); else if (mx == sr.g) h = (sr.b - sr.r) / d + 2.0; else h = (sr.r - sr.g) / d + 4.0;
              h /= 6.0;
            }
            float cloth = smoothstep(0.03, 0.08, h) * smoothstep(0.55, 0.45, h) * smoothstep(0.15, 0.3, d / max(mx, 1e-4)) * smoothstep(0.08, 0.18, mx);
            cc = mix(tex * mix(vec3(1.0), vLinen, step(0.45, mx)), vCoat * clamp(l * 2.2, 0.3, 1.0 + (1.0 - dot(vCoat, vec3(0.33))) * 0.4), cloth);
          }
          else cc = tex;
        }
        diffuseColor.rgb *= cc;`);
  };
  mat.customProgramCacheKey = () => 'crowd';
  return mat;
}

function crowdDepthMaterial(v) {
  const mat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uVatPos = { value: v.posTex };
    shader.uniforms.uVatNrm = { value: v.nrmTex };
    shader.uniforms.uRows = { value: v.rows };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + VERT_HEAD)
      .replace('#include <begin_vertex>', VERT_BODY);
  };
  mat.customProgramCacheKey = () => 'crowdDepth';
  return mat;
}

// ---------------------------------------------------------------- the crowd
export class Crowd {
  constructor(scene, quality) {
    this.scene = scene;
    this.quality = quality;
    this.looks = {};
    this.meshes = {};
    this.meshesLo = {};
    this.agents = [];
    this.crewAgents = [];
    this.town = null;
    this.ready = false;
  }

  async bake() {
    if (!humans.has()) return;
    await MeshoptSimplifier.ready;
    const cap = Math.ceil(Math.max(...Object.values(COUNT)) * 0.75);
    for (const look of LOOKS) {
      const v = await bakeLook(look);
      this.looks[look.id] = v;
      const mesh = new THREE.InstancedMesh(v.geo, crowdMaterial(v), cap);
      mesh.customDepthMaterial = crowdDepthMaterial(v);
      mesh.castShadow = this.quality !== 'low';
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      mesh.count = 0;
      const ia = (n) => new THREE.InstancedBufferAttribute(new Float32Array(cap * n), n).setUsage(THREE.DynamicDrawUsage);
      // far LOD: the same vertices (so the same animation texture), a much coarser index
      const geoLo = new THREE.BufferGeometry();
      for (const [k, at] of Object.entries(v.geo.attributes)) geoLo.setAttribute(k, at);
      const idx = new Uint32Array(v.geo.index.array);
      const [lo] = MeshoptSimplifier.simplify(idx, new Float32Array(v.geo.attributes.position.array), 3, Math.min(idx.length, 1300 * 3), 0.2, []);
      geoLo.setIndex(new THREE.BufferAttribute(lo, 1));
      geoLo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
      for (const [k, n] of [['iAnim', 4], ['iCoat', 3], ['iSkin', 3], ['iHair', 3], ['iLinen', 3], ['iHat', 3]]) { v.geo.setAttribute(k, ia(n)); geoLo.setAttribute(k, ia(n)); }
      const meshLo = new THREE.InstancedMesh(geoLo, mesh.material, cap);
      meshLo.customDepthMaterial = mesh.customDepthMaterial;
      Object.assign(meshLo, { castShadow: mesh.castShadow, receiveShadow: true, frustumCulled: false, count: 0, name: 'crowdLo_' + look.id });
      mesh.name = 'crowd_' + look.id;
      this.scene.add(mesh, meshLo);
      this.meshes[look.id] = mesh;
      this.meshesLo[look.id] = meshLo;
    }
    this.ready = true;
  }

  // Street graph: nodes joined where the way between them is clear of buildings
  graph(town) {
    if (town.crowdGraph) return town.crowdGraph;
    const nodes = town.streetNodes;
    const adj = nodes.map(() => []);
    for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i], b = nodes[j];
      const d = Math.hypot(a.x - b.x, a.z - b.z);
      if (d > 19 || d < 1) continue;
      let clear = true;
      for (let s = 1; s < d; s += 1.5) {
        const f = s / d;
        if (town.blocked(a.x + (b.x - a.x) * f, a.z + (b.z - a.z) * f, 0.5)) { clear = false; break; }
      }
      if (clear) { adj[i].push(j); adj[j].push(i); }
    }
    town.crowdGraph = { nodes, adj };
    return town.crowdGraph;
  }

  setTown(town, game) {
    if (!this.ready || this.town === town) return;
    this.town = town;
    this.agents = [];
    for (const m of [...Object.values(this.meshes), ...Object.values(this.meshesLo)]) m.count = 0;
    if (!town) return;
    const G = this.graph(town);
    const live = G.nodes.map((_, i) => i).filter((i) => G.adj[i].length);
    if (!live.length) return;
    const f = game?.walker && game.mode === 'foot' ? game.walker.pos : game?.camera.position || town.center;
    const focusNear = live.filter((k) => G.nodes[k].distanceTo(f) < 110);
    const pop = POP[town.port.id] || POP.havana;
    const total = pop.reduce((s, p) => s + p[1], 0);
    const q = this.quality === 'low' ? 0.3 : this.quality === 'medium' ? 0.6 : 1;
    const n = Math.round((COUNT[town.port.id] || 150) * q);
    const counts = {};
    for (let k = 0; k < n; k++) {
      let r = Math.random() * total, entry = pop[0];
      for (const p of pop) { r -= p[1]; if (r <= 0) { entry = p; break; } }
      const [lookId, , pal] = entry;
      const look = this.looks[lookId];
      if (!look || (counts[lookId] || 0) >= this.meshes[lookId].instanceMatrix.count) continue;
      const slot = (counts[lookId] = (counts[lookId] || 0) + 1) - 1;
      const a = {
        look: lookId, slot, pal,
        coat: new THREE.Color(pick(pal.coat)), skin: new THREE.Color(pick(pal.skin)), hair: new THREE.Color(pick(HAIRC)),
        linen: new THREE.Color(pick(LINEN)), hat: new THREE.Color(pick(pal.hat || ['#2a241c'])),
        pos: new THREE.Vector3(), yaw: 0, speed: rand(1.05, 1.55), phase: Math.random(), anim: 'walk',
        from: 0, to: 0, t: 0, side: rand(-2.6, 2.6), wait: 0, mode: 'walk', spot: null, modeT: rand(20, 120),
      };
      // start somewhere on the graph, most of them around whoever is looking
      const i = focusNear.length && Math.random() < 0.75 ? pick(focusNear) : pick(live);
      a.from = i; a.to = pick(G.adj[i]); a.t = Math.random();
      if (Math.random() < 0.35) this.startStanding(a, G, town);
      this.place(a, G);
      this.agents.push(a);
    }
    // patrols: soldiers of the garrison walking the streets in twos and threes, day and night
    const troops = SOLDIERS[town.port.id];
    if (troops && this.looks.m_coat) {
      for (let k = 0; k < Math.round(troops.patrols * q + 0.4); k++) {
        const i = focusNear.length && Math.random() < 0.6 ? pick(focusNear) : pick(live);
        const size = Math.random() < 0.5 ? 2 : 3;
        let lead = null;
        for (let m = 0; m < size; m++) {
          if ((counts.m_coat || 0) >= this.meshes.m_coat.instanceMatrix.count) break;
          const slot = (counts.m_coat = (counts.m_coat || 0) + 1) - 1;
          const a = {
            look: 'm_coat', slot, pal: { coat: troops.coat }, coat: new THREE.Color(pick(troops.coat)), skin: new THREE.Color(pick(troops.skin)), hair: new THREE.Color(pick(HAIRC)),
            linen: new THREE.Color('#efe8da'), hat: new THREE.Color('#15110e'), pos: new THREE.Vector3(), yaw: 0, speed: 1.15, phase: Math.random() * 0.2, anim: 'walk',
            from: i, to: pick(G.adj[i]), t: Math.random(), side: rand(-1, 1), wait: 0, mode: 'walk', spot: null, modeT: rand(60, 200), patrol: true, night: true,
          };
          if (lead) { a.mode = 'follow'; a.lead = lead; a.off = size === 2 ? { x: 0.8, z: 0 } : { x: m === 1 ? 0.65 : -0.65, z: 1.4 }; } // two abreast, or a corporal leading a file of two
          else lead = a;
          this.place(a, G);
          this.agents.push(a);
        }
      }
    }
    // friends and couples walking together
    const walkers = this.agents.filter((a) => a.mode === 'walk' && !a.patrol);
    for (let k = 0; k + 1 < walkers.length; k += 2) {
      if (Math.random() > 0.14) continue;
      const lead = walkers[k], b = walkers[k + 1];
      b.mode = 'follow'; b.lead = lead; b.off = { x: 0.7, z: 0.15 }; b.speed = lead.speed; lead.company = true;
    }
    // oarsmen and fishermen in the harbour boats
    for (const bt of (game?.harbour?.boats || []).filter((b) => b.town === town)) {
      for (const seat of bt.seats) {
        const lookId = pick(['m_bare', 'm_straw', 'm_bandana']);
        if (!this.looks[lookId] || (counts[lookId] || 0) >= this.meshes[lookId].instanceMatrix.count) continue;
        const slot = (counts[lookId] = (counts[lookId] || 0) + 1) - 1;
        const pal = (pop.find((p) => p[0] === lookId) || pop[0])[2];
        this.agents.push({
          look: lookId, slot, pal, coat: new THREE.Color(pick(pal.coat)), skin: new THREE.Color(pick(pal.skin)), hair: new THREE.Color(pick(HAIRC)),
          linen: new THREE.Color(pick(LINEN)), hat: new THREE.Color(pick(pal.hat || ['#2a241c'])),
          pos: new THREE.Vector3(), yaw: 0, speed: 1, phase: Math.random(), anim: 'sit', mode: 'ride', ride: { bt, seat },
        });
      }
    }
  }

  writeColors(a, M, s) {
    const g = M.geometry.attributes;
    g.iCoat.setXYZ(s, a.coat.r, a.coat.g, a.coat.b);
    g.iSkin.setXYZ(s, a.skin.r, a.skin.g, a.skin.b);
    g.iHair.setXYZ(s, a.hair.r, a.hair.g, a.hair.b);
    g.iLinen.setXYZ(s, a.linen.r, a.linen.g, a.linen.b);
    g.iHat.setXYZ(s, a.hat.r, a.hat.g, a.hat.b);
  }

  // stop to talk with whoever is near, sit on a free bench, or lend a hand at the cargo
  startStanding(a, G, town) {
    if (a.patrol || a.company) {
      // a patrol halts a moment; friends stop to talk in the street
      a.mode = 'stand'; a.anim = a.patrol ? 'idle' : 'talk'; a.modeT = a.patrol ? rand(4, 12) : rand(10, 40);
      return;
    }
    const free = town.spots.filter((s) => !s.taken && (s.type === 'sit' || s.type === 'sitTalk' || s.type === 'work' || s.type === 'talk'));
    const here = G.nodes[a.from];
    const near = free.filter((s) => Math.abs(s.pos.x - here.x) < 60 && Math.abs(s.pos.z - here.z) < 60);
    if (near.length && Math.random() < 0.6) {
      const s = pick(near);
      s.taken = a;
      a.spot = s; a.mode = 'spot';
      a.anim = s.type === 'sit' || s.type === 'sitTalk' ? 'sit' : s.type === 'work' ? (Math.random() < 0.5 ? 'work' : 'idle') : 'talk';
      a.pos.copy(s.pos); a.yaw = s.yaw;
    } else {
      a.mode = 'stand';
      a.anim = Math.random() < 0.6 ? 'talk' : 'idle';
      a.yaw = Math.random() * Math.PI * 2;
    }
    a.modeT = rand(15, 70);
  }

  place(a, G) {
    if (a.mode === 'spot') return;
    const A = G.nodes[a.from], B = G.nodes[a.to];
    const dx = B.x - A.x, dz = B.z - A.z, L = Math.hypot(dx, dz) || 1;
    // walk a little to one side of the street's centre line
    const sx = -dz / L, sz = dx / L;
    a.pos.set(A.x + dx * a.t + sx * a.side, 0, A.z + dz * a.t + sz * a.side);
    if (a.mode === 'walk') a.targetYaw = Math.atan2(-dx, -dz);
  }

  update(dt, camPos, player, hours) {
    if (!this.ready) return;
    const town = this.town;
    const far = !town || town.center.distanceTo(camPos) > town.R * 3;
    const all = [...Object.values(this.meshes), ...Object.values(this.meshesLo)];
    for (const m of all) { m.visible = true; m._n = 0; }
    const G = town?.crowdGraph;
    const T = town?.terrain;
    const night = hours < 5.5 || hours > 21.5;
    const dim = { m4: new THREE.Matrix4(), q: new THREE.Quaternion(), up: new THREE.Vector3(0, 1, 0), s: new THREE.Vector3(1, 1, 1), p: new THREE.Vector3() };
    let i = 0;
    // the townsfolk when the town is near, and your own crew aboard wherever she is
    const list = far ? this.crewAgents : this.agents.concat(this.crewAgents);
    if (this.crewAgents.length) this.crewAgents[0].crew.ship.group.updateMatrixWorld(true); // this frame's deck, not the last one drawn
    for (const a of list) {
      i++;
      // at night most people are indoors
      const hidden = a.mode !== 'crew' && night && !(a.night || a.lead?.night) && (i % (town.port.style === 'shanty' ? 5 : 4) !== 0) && !(town.port.style === 'shanty' && i % 5 < 3); // the Brethren carouse till dawn
      if (a.mode === 'crew') {
        // standing to their station on deck, riding the ship's motion
        const S = a.crew.ship;
        if (S.sunk) continue;
        const p = a.crew.local.clone().applyMatrix4(S.model.group.matrixWorld);
        a.pos.copy(p); a.yaw = S.heading + a.crew.face; a.rideY = p.y;
        a.anim = a.crew.anim || 'idle';
      } else if (a.mode === 'ride') {
        const g = a.ride.bt.group;
        const p = a.ride.seat.clone().applyMatrix4(g.matrixWorld);
        a.pos.copy(p); a.yaw = a.ride.bt.yaw; a.rideY = p.y - 0.05;
        a.anim = 'sit';
      } else if (a.mode === 'follow') {
        // keep station on the leader: in step while walking, turned toward them when stopped
        const L = a.lead, c = Math.cos(L.yaw), sn = Math.sin(L.yaw);
        a.pos.set(L.pos.x + c * a.off.x + sn * a.off.z, 0, L.pos.z - sn * a.off.x + c * a.off.z);
        if (L.mode === 'walk') { a.targetYaw = L.yaw; a.anim = 'walk'; a.speed = L.speed; }
        else { a.targetYaw = Math.atan2(-(L.pos.x - a.pos.x), -(L.pos.z - a.pos.z)); a.anim = L.patrol ? 'idle' : 'talk'; }
        let dy = a.targetYaw - a.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        a.yaw += dy * Math.min(1, dt * 5);
      } else if (a.mode === 'walk') {
        const A = G.nodes[a.from], B = G.nodes[a.to];
        const L = Math.hypot(B.x - A.x, B.z - A.z) || 1;
        a.t += (a.speed * dt) / L;
        if (a.t >= 1) {
          a.t = 0;
          const nb = G.adj[a.to].filter((k) => k !== a.from);
          a.from = a.to;
          a.to = nb.length ? pick(nb) : pick(G.adj[a.to]);
          a.modeT -= L / a.speed;
          if (a.modeT <= 0) this.startStanding(a, G, town);
        }
        a.side += Math.sin(a.phase * 6.283 + a.slot) * dt * 0.25; // meander a little
        a.side = Math.max(-3, Math.min(3, a.side));
        this.place(a, G);
        a.anim = 'walk';
      } else {
        a.modeT -= dt;
        if (a.modeT <= 0) {
          if (a.spot) { a.spot.taken = null; a.spot = null; }
          a.mode = 'walk'; a.anim = 'walk'; a.modeT = rand(30, 150);
          a.side = rand(-2.6, 2.6);
        }
      }
      // step aside for the player
      if (player && a.mode === 'walk') {
        const dx = a.pos.x - player.x, dz = a.pos.z - player.z, d = Math.hypot(dx, dz);
        if (d < 1.4) { a.side += (dx * -Math.sin(a.yaw) < 0 ? 1 : -1) * dt * 2; a.side = Math.max(-3, Math.min(3, a.side)); }
      }
      if (a.targetYaw !== undefined && a.mode === 'walk') {
        let dy = a.targetYaw - a.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        a.yaw += dy * Math.min(1, dt * 6);
      }
      const clip = this.looks[a.look].clipInfo[a.anim];
      const rate = a.anim === 'walk' ? (a.speed / 1.3) / clip.dur : 1 / clip.dur;
      a.phase = (a.phase + dt * rate) % 1;
      if (hidden) continue;
      // full detail close by, the coarse mesh beyond
      const d2 = (a.pos.x - camPos.x) ** 2 + (a.pos.z - camPos.z) ** 2;
      const mesh = d2 < 28 * 28 ? this.meshes[a.look] : this.meshesLo[a.look];
      if (mesh._n >= mesh.instanceMatrix.count) continue;
      const k = mesh._n++;
      const y = a.mode === 'ride' || a.mode === 'crew' ? a.rideY : a.spot ? a.spot.pos.y : T.height(a.pos.x, a.pos.z);
      dim.q.setFromAxisAngle(dim.up, a.yaw);
      dim.m4.compose(dim.p.set(a.pos.x, y, a.pos.z), dim.q, dim.s);
      mesh.setMatrixAt(k, dim.m4);
      mesh.geometry.attributes.iAnim.setXYZW(k, clip.start, clip.n, a.phase, 0);
      this.writeColors(a, mesh, k);
    }
    for (const m of all) {
      m.count = m._n;
      m.instanceMatrix.needsUpdate = true;
      for (const k of ['iAnim', 'iCoat', 'iSkin', 'iHair', 'iLinen', 'iHat']) m.geometry.attributes[k].needsUpdate = true;
    }
    if (!far) this.recycle(dt, player || camPos, camPos);
  }

  // Your ship's company, at their stations on deck: gun crews by the guns, the helmsman aft, a lookout in the
  // bows, hands at the rails for the sheets and braces, and the watch below taking the air amidships.
  setShipCrew(ship, n) {
    this.crewAgents = [];
    if (!this.ready || !ship) return;
    // the deck as it really is on this hull: its half-breadth at the rail and the length inside the stem and stern
    const M = ship.model, dy = M.deckY;
    const B = (M.deckHalf || ship.cls.beam * 0.4) * 2.2, L = M.deckLen || ship.cls.length * 0.9;
    const pal = POP.nassau[0][2];
    const looks = ['m_bandana', 'm_bare', 'm_straw', 'm_bandana', 'm_coat_bare'].filter((k) => this.looks[k]);
    const add = (role, x, z, face, anim) => {
      const look = looks[this.crewAgents.length % looks.length];
      // keep inside the hull: not out on the bowsprit or over the counter, and closer in where she narrows
      z = Math.max(-L * 0.36, Math.min(L * 0.38, z));
      x *= 1 - Math.min(0.6, Math.max(0, (Math.abs(z) - L * 0.15) / (L * 0.35)));
      z += M.deckMid || 0;
      this.crewAgents.push({
        look, slot: 900 + this.crewAgents.length, mode: 'crew', crew: { ship, role, local: new THREE.Vector3(x, dy, z), face, anim, base: anim },
        coat: new THREE.Color(pick(pal.coat)), skin: new THREE.Color(pick(pal.skin)), hair: new THREE.Color(pick(HAIRC)), linen: new THREE.Color(pick(LINEN)), hat: new THREE.Color(pick(pal.hat || ['#2a241c'])),
        pos: new THREE.Vector3(), yaw: 0, speed: 1, phase: Math.random(), anim,
      });
    };
    add('helm', 0, L * 0.3, 0, 'idle');
    add('lookout', 0, -L * 0.28, 0, 'idle');
    // gun crews: one by every other gun
    const guns = M.gunPositions || [];
    guns.forEach((g, k) => { if (k % 2 === 0 && this.crewAgents.length < n) add('gun', Math.sign(g.x) * B * 0.3, g.z * 0.9, g.x > 0 ? -Math.PI / 2 : Math.PI / 2, 'idle'); });
    // hands at the rails for the sheets and braces, facing inboard
    for (let k = 0; this.crewAgents.length < n && k < 6; k++) {
      const sd = k % 2 ? 1 : -1;
      add('rail', sd * B * 0.36, (k / 6 - 0.4) * L * 0.6, sd > 0 ? Math.PI / 2 : -Math.PI / 2, 'idle');
    }
    // the watch below, taking the air amidships
    for (let k = 0; this.crewAgents.length < n; k++) add('idle', (Math.random() - 0.5) * B * 0.4, (Math.random() - 0.5) * L * 0.4, Math.random() * 6.28, pick(['talk', 'sit', 'idle']));
  }

  // what the crew are about: hauling when sail is made or shortened, at the guns in action
  crewState(st) {
    for (const a of this.crewAgents) {
      const r = a.crew.role;
      if (r === 'rail') a.crew.anim = st.hauling ? 'work' : 'idle';
      else if (r === 'gun') a.crew.anim = st.combat ? (st.reloading[a.crew.local.x > 0 ? 'starboard' : 'port'] ? 'work' : 'idle') : (st.hauling ? 'idle' : 'sit');
      else if (r === 'idle') a.crew.anim = st.combat ? 'idle' : st.hauling ? 'work' : a.crew.base;
    }
  }

  nearCount(p, r) {
    let n = 0;
    for (const a of this.agents) if (Math.abs(a.pos.x - p.x) < r && Math.abs(a.pos.z - p.z) < r) n++;
    return n;
  }

  // Keep the people where they're seen: walkers who have wandered far off reappear on streets near the
  // player, out of sight behind the camera or far enough away to fade in unnoticed.
  recycle(dt, focus, camPos) {
    this.recT = (this.recT || 0) - dt;
    if (this.recT > 0) return;
    this.recT = 0.4;
    const G = this.town.crowdGraph;
    const fwdX = focus.x - camPos.x, fwdZ = focus.z - camPos.z;
    let moved = 0;
    for (const a of this.agents) {
      if (moved >= 8) break;
      if (a.mode !== 'walk' || a.pos.distanceTo(focus) < 150) continue; // (boat crews stay aboard)
      for (let tries = 0; tries < 12; tries++) {
        const i = Math.floor(Math.random() * G.nodes.length);
        if (!G.adj[i].length) continue;
        const n = G.nodes[i];
        const d = Math.hypot(n.x - focus.x, n.z - focus.z);
        if (d < 25 || d > 115) continue;
        const behind = (n.x - camPos.x) * fwdX + (n.z - camPos.z) * fwdZ < 0;
        if (!behind && d < 70) continue;
        a.from = i; a.to = pick(G.adj[i]); a.t = Math.random();
        this.place(a, G);
        moved++;
        break;
      }
    }
  }
}
