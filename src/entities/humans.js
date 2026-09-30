// Realistic, fully rigged human characters assembled at runtime from Quaternius' CC0 Universal Base
// Characters (heads), Modular Outfits, hairstyles and the Universal Animation Library — all on one
// 65-bone skeleton. Outfits are tinted per role and period hats are fitted to the head bone.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { GltfRig } from './modelLibrary.js';
import { pick } from '../core/noise.js';

const BASE = './models/humans/';
const FILES = {
  head_male: 'head_male.glb', head_female: 'head_female.glb',
  outfit_male_peasant: 'outfit_male_peasant.glb', outfit_female_peasant: 'outfit_female_peasant.glb',
  outfit_male_ranger: 'outfit_male_ranger.glb', outfit_female_ranger: 'outfit_female_ranger.glb',
  hair_beard: 'hair_beard.glb', hair_simpleparted: 'hair_simpleparted.glb', hair_long: 'hair_long.glb',
  hair_buns: 'hair_buns.glb', hair_buzzed: 'hair_buzzed.glb', hair_buzzedfemale: 'hair_buzzedfemale.glb',
  eyebrows_regular: 'eyebrows_regular.glb', eyebrows_female: 'eyebrows_female.glb',
  anims: 'anims.glb',
};

// ---------------------------------------------------------------- looks per role
const EARTH = ['#ffffff', '#e8d8c0', '#c9b79a', '#b8c4c8', '#d8c0a8', '#bfae8e'];
const SKIN_TONES = ['#f0cdb4', '#e2b594', '#c99670', '#a8744e', '#7c5034', '#5a3624'];
const HAIR = ['#2a1a10', '#4a2e1a', '#1a1410', '#6a4a2a', '#8a6a4a', '#b89a70'];
function spec(role) {
  const r = Math.random;
  const male = { sex: 'male', brows: 'eyebrows_regular' };
  const female = { sex: 'female', brows: 'eyebrows_female' };
  switch (role) {
    case 'captain':
      return { ...male, outfit: 'outfit_male_ranger', coat: '#7a1c1c', tint: '#ffffff', hair: 'hair_long', beard: true, hat: 'tricorne', hatColor: '#15110e', trim: '#c9a13a', skin: '#e8c8a8', hairColor: '#2a1a10' };
    case 'pirate':
    case 'soldier_pirate':
      return { ...male, outfit: r() < 0.55 ? 'outfit_male_peasant' : 'outfit_male_ranger', coat: pick(['#5a2a1a', '#2a3450', '#3a3a3a', '#6a4a2a', '#5a1e2a', '#2e4a3a']), tint: pick(['#ffffff', '#f0e0d0', '#e8dccc']), hair: pick(['hair_long', 'hair_buzzed', 'hair_simpleparted']), beard: r() < 0.65, hat: r() < 0.45 ? 'bandana' : r() < 0.45 ? 'tricorne' : null, hatColor: pick(['#8a2a1a', '#2a3a5a', '#1a1a1a', '#6a5a2a', '#7a1d1d']), skin: pick(SKIN_TONES), hairColor: pick(HAIR) };
    case 'pirate_female':
      return { ...female, outfit: r() < 0.6 ? 'outfit_female_ranger' : 'outfit_female_peasant', coat: pick(['#6a1e2a', '#2a3450', '#4a3a2a', '#3a4a3a']), tint: '#ffffff', hair: pick(['hair_long', 'hair_buns']), hat: r() < 0.5 ? 'bandana' : null, hatColor: pick(['#8a2a1a', '#2a3a5a', '#1a1a1a']), skin: pick(SKIN_TONES), hairColor: pick(HAIR) };
    case 'soldier_britain':
      return { ...male, outfit: 'outfit_male_ranger', coat: '#c8281f', tint: '#ffffff', hair: 'hair_simpleparted', hat: 'tricorne', hatColor: '#141210', trim: '#e8dcc0', skin: pick(SKIN_TONES.slice(0, 3)), hairColor: '#e8e4dc' };
    case 'soldier_spain':
      return { ...male, outfit: 'outfit_male_ranger', coat: '#27408a', tint: '#ffffff', hair: 'hair_simpleparted', beard: r() < 0.4, hat: 'tricorne', hatColor: '#141210', trim: '#c9372c', skin: pick(SKIN_TONES.slice(1, 4)), hairColor: '#1a1410' };
    case 'soldier_france':
      return { ...male, outfit: 'outfit_male_ranger', coat: '#e6e2d6', tint: '#ffffff', hair: 'hair_simpleparted', hat: 'tricorne', hatColor: '#141210', trim: '#1f3d78', skin: pick(SKIN_TONES.slice(0, 3)), hairColor: '#e8e4dc' };
    case 'townswoman':
      return { ...female, outfit: 'outfit_female_peasant', coat: pick(['#8a4a5a', '#5a6a8a', '#8a7a4a', '#6a4a3a', '#a86a4a']), tint: pick(EARTH), hair: pick(['hair_buns', 'hair_long', 'hair_buns']), hat: r() < 0.5 ? (r() < 0.5 ? 'bonnet' : 'headwrap') : null, hatColor: pick(['#d9d0bd', '#b8442a', '#e0d0b0', '#6a8a9a']), skin: pick(SKIN_TONES), hairColor: pick(HAIR) };
    case 'merchant':
      return { ...male, outfit: 'outfit_male_ranger', coat: '#2a3a5a', tint: '#ffffff', hair: 'hair_simpleparted', hat: 'tricorne', hatColor: '#1a1a1a', trim: '#c9a13a', skin: pick(SKIN_TONES.slice(0, 3)), hairColor: '#e8e4dc' };
    case 'sailor':
    case 'townsman':
    default:
      return { ...male, outfit: 'outfit_male_peasant', coat: pick(['#6a5a44', '#4a3a2a', '#5a4a5a', '#3a4a3a', '#7a6a4a']), tint: pick(EARTH), hair: pick(['hair_buzzed', 'hair_simpleparted', 'hair_long']), beard: r() < 0.4, hat: r() < 0.5 ? (role === 'sailor' ? 'straw' : pick(['tricorne', 'straw'])) : null, hatColor: pick(['#2a241c', '#c8b078', '#3a3028']), skin: pick(SKIN_TONES), hairColor: pick(HAIR) };
  }
}

// ---------------------------------------------------------------- skin tone normalisation
const avgCache = new Map();
function averageColor(tex) {
  if (!tex || !tex.image) return new THREE.Color(1, 1, 1);
  if (avgCache.has(tex.uuid)) return avgCache.get(tex.uuid);
  const c = document.createElement('canvas'); c.width = c.height = 32;
  const ctx = c.getContext('2d');
  ctx.drawImage(tex.image, 0, 0, 32, 32);
  const d = ctx.getImageData(0, 0, 32, 32).data;
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 128) continue;
    // ignore near-black/near-white texels (seams, eyes, padding)
    const l = (d[i] + d[i + 1] + d[i + 2]) / 3;
    if (l < 12 || l > 245) continue;
    r += d[i]; g += d[i + 1]; b += d[i + 2]; n++;
  }
  const col = new THREE.Color().setRGB(r / n / 255, g / n / 255, b / n / 255, THREE.SRGBColorSpace);
  avgCache.set(tex.uuid, col);
  return col;
}
// material colour that turns a skin texture's average tone into the wanted skin tone
function skinColor(mat, target) {
  const avg = averageColor(mat.map);
  const t = new THREE.Color(target);
  return new THREE.Color(t.r / Math.max(avg.r, 0.02), t.g / Math.max(avg.g, 0.02), t.b / Math.max(avg.b, 0.02));
}

// ---------------------------------------------------------------- cloth recolouring
// Swap the hue of the outfit's green cloth for a uniform colour, leaving leather, linen and skin alone.
function recolor(mat, target) {
  const to = new THREE.Color(target);
  const hsl = {}; to.getHSL(hsl);
  mat.userData.recolor = true;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uToHue = { value: hsl.h };
    shader.uniforms.uToSat = { value: hsl.s };
    shader.uniforms.uToLum = { value: hsl.l };
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uToHue; uniform float uToSat; uniform float uToLum;
        vec3 rgb2hsv(vec3 c){ vec4 K=vec4(0.,-1./3.,2./3.,-1.); vec4 p=mix(vec4(c.bg,K.wz),vec4(c.gb,K.xy),step(c.b,c.g)); vec4 q=mix(vec4(p.xyw,c.r),vec4(c.r,p.yzx),step(p.x,c.r)); float d=q.x-min(q.w,q.y); float e=1.0e-10; return vec3(abs(q.z+(q.w-q.y)/(6.*d+e)),d/(q.x+e),q.x); }
        vec3 hsv2rgb(vec3 c){ vec3 p=abs(fract(c.xxx+vec3(1.,2./3.,1./3.))*6.-3.); return c.z*mix(vec3(1.),clamp(p-1.,0.,1.),c.y); }`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        {
          vec3 srgb = pow(max(diffuseColor.rgb, 0.0), vec3(1.0/2.2));
          vec3 hsv = rgb2hsv(srgb);
          float green = smoothstep(0.17, 0.22, hsv.x) * (1.0 - smoothstep(0.45, 0.52, hsv.x)) * smoothstep(0.12, 0.25, hsv.y);
          if (green > 0.0) {
            float lum = mix(hsv.z, uToLum * 1.6 * (0.55 + hsv.z), 0.85);
            vec3 tgt = hsv2rgb(vec3(uToHue, uToSat * 0.9, clamp(lum, 0.0, 1.0)));
            srgb = mix(srgb, tgt, green);
            diffuseColor.rgb = pow(srgb, vec3(2.2));
          }
        }`);
  };
  mat.customProgramCacheKey = () => 'recolor';
  mat.needsUpdate = true;
}

// ---------------------------------------------------------------- hats (built in head space, metres)
function hatMesh(kind, color, trim) {
  const g = new THREE.Group();
  const m = new THREE.MeshStandardMaterial({ color, roughness: 0.85 });
  if (kind === 'tricorne') {
    const brim = new THREE.CylinderGeometry(0.21, 0.21, 0.012, 36, 1);
    const p = brim.attributes.position, v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      const r = Math.hypot(v.x, v.z), a = Math.atan2(v.x, -v.z);
      const cock = Math.pow(Math.abs(Math.cos(a * 1.5)), 0.6) * Math.max(0, (r - 0.09) / 0.12);
      p.setXYZ(i, v.x, v.y + cock * 0.09, v.z);
    }
    brim.computeVertexNormals();
    g.add(new THREE.Mesh(brim, m));
    const crown = new THREE.Mesh(new THREE.SphereGeometry(0.105, 18, 9, 0, Math.PI * 2, 0, Math.PI * 0.5), m);
    crown.scale.set(1, 0.85, 1.08);
    g.add(crown);
    if (trim) {
      const t = new THREE.Mesh(new THREE.TorusGeometry(0.106, 0.006, 4, 28), new THREE.MeshStandardMaterial({ color: trim, roughness: 0.5, metalness: 0.4 }));
      t.rotation.x = Math.PI / 2; t.position.y = 0.012;
      g.add(t);
    }
    g.position.y = 0;
  } else if (kind === 'bandana' || kind === 'headwrap') {
    // a wrapped cloth: the turns of the wrap stand out in bands that spiral round the head
    const cg = new THREE.SphereGeometry(0.108, 32, 14, 0, Math.PI * 2, 0, Math.PI * 0.55);
    if (kind === 'headwrap') {
      const p = cg.attributes.position, v = new THREE.Vector3();
      for (let i = 0; i < p.count; i++) {
        v.fromBufferAttribute(p, i);
        const a = Math.atan2(v.x, v.z), el = v.y / 0.108;
        const band = Math.sin((el * 3.2 + a / Math.PI * 0.9) * Math.PI);
        const k = 1 + 0.07 * Math.abs(band) + 0.12 * Math.max(0, el - 0.55); // ridged turns, piled up on top
        // the front edge rides up over the forehead, clear of the eyes
        const front = Math.max(0, -v.z / 0.108) ** 1.5;
        p.setXYZ(i, v.x * k, Math.max(v.y * (1 + 0.18 * Math.max(0, el - 0.3)), front * 0.07), v.z * k);
      }
      cg.computeVertexNormals();
    }
    const cap = new THREE.Mesh(cg, m);
    cap.scale.set(1.02, 1.0, 1.08);
    g.add(cap);
    const knot = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.12, 5), m);
    knot.rotation.x = Math.PI * 0.62; knot.position.set(0.02, -0.03, 0.115);
    g.add(knot);
    g.position.y = 0;
  } else if (kind === 'straw') {
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.27, 0.012, 28), m);
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.105, 0.1, 18), m);
    crown.position.y = 0.05;
    g.add(brim, crown);
    g.position.y = 0;
  } else if (kind === 'bonnet') {
    // a linen coif gathered round its rim
    const bg = new THREE.SphereGeometry(0.118, 32, 12, 0, Math.PI * 2, 0, Math.PI * 0.62);
    const p = bg.attributes.position, v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      const a = Math.atan2(v.x, v.z), el = v.y / 0.118;
      const gather = 1 + 0.035 * Math.sin(a * 14) * (1 - el); // gathers toward the rim
      const front = Math.max(0, -v.z / 0.118) ** 1.5; // worn back off the forehead
      p.setXYZ(i, v.x * gather, Math.max(v.y, front * 0.075), v.z * gather);
    }
    bg.computeVertexNormals();
    const b = new THREE.Mesh(bg, m);
    b.scale.set(1, 1.02, 1.12);
    g.add(b);
    g.position.set(0, 0, 0.01);
  }
  else if (kind === 'basket') {
    // a flat market basket carried on the head on a rolled-cloth pad, heaped with fruit
    const pad = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.025, 5, 12), m);
    pad.rotation.x = Math.PI / 2; pad.position.y = 0.02;
    const wick = new THREE.MeshStandardMaterial({ color: '#b08a50', roughness: 0.95 }); wick.userData.keep = true;
    const bk = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.13, 0.16, 14, 1, true), wick);
    bk.position.y = 0.12;
    const floor = new THREE.Mesh(new THREE.CircleGeometry(0.13, 12), wick); floor.rotation.x = -Math.PI / 2; floor.position.y = 0.045;
    g.add(pad, bk, floor);
    const fruit = [['#e08a2a', '#d87a20'], ['#c8b030', '#9aa83a'], ['#8a3a2a', '#b84a2a'], ['#6a8a3a', '#4a7a2a']][Math.floor(Math.random() * 4)];
    // heaped up in a mound above the rim
    for (let k = 0; k < 13; k++) {
      const fm = new THREE.MeshStandardMaterial({ color: fruit[k % 2], roughness: 0.6 }); fm.userData.keep = true;
      const f = new THREE.Mesh(new THREE.SphereGeometry(0.062, 7, 5), fm);
      const ring = k < 7 ? 0 : k < 11 ? 1 : 2, a = k * 2.4, r = [0.12, 0.07, 0.02][ring];
      f.position.set(Math.cos(a) * r, 0.2 + ring * 0.06, Math.sin(a) * r);
      g.add(f);
    }
  } else if (kind === 'bundle') {
    // a sack or a bale in sailcloth, balanced on the head
    const pad = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.025, 5, 12), m);
    pad.rotation.x = Math.PI / 2; pad.position.y = 0.02;
    const sack = new THREE.Mesh(new THREE.CapsuleGeometry(0.13, 0.36, 4, 10), m); // lying across the head, tied at the ends
    sack.rotation.z = Math.PI / 2; sack.scale.set(1, 1, 0.85); sack.position.y = 0.14;
    g.add(pad, sack);
  }
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}

// ---------------------------------------------------------------- library
class Humans {
  constructor() { this.parts = {}; this.ready = false; }

  async load() {
    try {
      const probe = await fetch(BASE + 'anims.glb', { method: 'HEAD' });
      if (!probe.ok) return;
    } catch (e) { return; }
    const loader = new GLTFLoader();
    await Promise.all(Object.entries(FILES).map(async ([k, f]) => {
      try { this.parts[k] = await loader.loadAsync(BASE + f); } catch (e) { console.warn('human part failed', f, e); }
    }));
    if (!this.parts.anims || !this.parts.head_male) return;
    const clips = this.parts.anims.animations;
    const c = (n) => clips.find((a) => a.name === n) || null;
    this.clips = {
      idle: c('Idle_Loop'), walk: c('Walk_Loop'), run: c('Jog_Fwd_Loop'), slash: c('Sword_Attack'),
      aimPistol: c('Pistol_Aim_Neutral'), aimMusket: c('Pistol_Aim_Neutral'), hit: c('Hit_Chest'),
      death: c('Death01'), dig: c('Fixing_Kneeling'),
      // everyday activities for townsfolk
      sit: c('Sitting_Idle_Loop'), sitTalk: c('Sitting_Talking_Loop'), talk: c('Idle_Talking_Loop'), dance: c('Dance_Loop'), work: c('Fixing_Kneeling'),
    };
    // strip root motion so the game controls position
    for (const clip of Object.values(this.clips)) {
      if (!clip) continue;
      clip.tracks = clip.tracks.filter((t) => !/^root\.position/.test(t.name));
      for (const t of clip.tracks) {
        if (/^pelvis\.position$/.test(t.name)) {
          // keep vertical bob, remove horizontal drift
          const v = t.values, x0 = v[0], z0 = v[2];
          for (let i = 0; i < v.length; i += 3) { v[i] = x0; v[i + 2] = z0; }
        }
      }
    }
    // measure the standing height of a dressed character once (model units → metres)
    this.ready = true;
    const probe = this.assemble({ ...spec('townsman'), hat: null });
    probe.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(probe, true);
    this.rawFeet = box.min.y;
    this.rawHeight = box.max.y - box.min.y;
    this.unit = this.rawHeight / 1.76;
    this.headTop = {};
    for (const sex of ['male', 'female']) {
      const h = this.parts['head_' + sex].scene;
      h.updateMatrixWorld(true);
      let top = -Infinity;
      const v = new THREE.Vector3();
      h.traverse((o) => {
        if (!o.isSkinnedMesh || !/Superhero|Regular/.test(o.material.name)) return;
        const p = o.geometry.attributes.position;
        for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld); if (v.y > top) top = v.y; }
      });
      this.headTop[sex] = top;
    }
  }

  has() { return this.ready; }

  assemble(sp) {
    const P = this.parts;
    const model = SkeletonUtils.clone(P['head_' + sp.sex].scene);
    const bones = {};
    model.traverse((o) => { if (o.isBone) bones[o.name] = o; });
    model.updateMatrixWorld(true);
    const skinTarget = sp.skin || '#c99670';
    // head: skin tone on the face material
    model.traverse((o) => {
      if (o.isMesh) {
        o.material = o.material.clone();
        if (/Superhero|Regular/.test(o.material.name)) o.material.color.copy(skinColor(o.material, skinTarget));
        if (/Hair/.test(o.material.name)) o.material.color.set(sp.hairColor || '#2a1a10');
      }
    });
    const attach = (key, tint, isSkin = false) => {
      const gltf = P[key];
      if (!gltf) return;
      gltf.scene.updateMatrixWorld(true);
      gltf.scene.traverse((m) => {
        if (!m.isSkinnedMesh) return;
        const newBones = m.skeleton.bones.map((b) => bones[b.name]);
        if (newBones.some((b) => !b)) return;
        const mat = Array.isArray(m.material) ? m.material.map((x) => x.clone()) : m.material.clone();
        for (const mm of Array.isArray(mat) ? mat : [mat]) {
          if (/Regular|Superhero/.test(mm.name)) mm.color.copy(skinColor(mm, skinTarget));
          else if (/Hair/.test(mm.name)) mm.color.set(sp.hairColor || '#2a1a10');
          else if (sp.coat && /Ranger|Peasant/.test(mm.name)) { recolor(mm, sp.coat); if (tint) mm.color.set(tint); }
          else if (tint) mm.color.set(tint);
          mm.roughness = Math.max(mm.roughness ?? 0.8, 0.6);
        }
        const sm = new THREE.SkinnedMesh(m.geometry, mat);
        sm.name = m.name;
        sm.matrixAutoUpdate = true;
        m.matrixWorld.decompose(sm.position, sm.quaternion, sm.scale);
        model.add(sm);
        sm.updateMatrixWorld(true);
        sm.bind(new THREE.Skeleton(newBones, m.skeleton.boneInverses), m.bindMatrix);
        sm.castShadow = true; sm.receiveShadow = true; sm.frustumCulled = false;
      });
    };
    attach(sp.outfit, sp.tint);
    if (sp.hair && !(sp.hat === 'bonnet' || sp.hat === 'headwrap' || (sp.hat === 'bandana' && sp.hair !== 'hair_long'))) attach(sp.hair);
    else if (sp.hair === 'hair_long') attach(sp.hair);
    if (sp.beard) attach('hair_beard');
    attach(sp.brows);
    // hat on the head bone, aligned to the character (not the bone's own axes)
    if (sp.hat && bones.Head) {
      const head = bones.Head;
      const hat = hatMesh(sp.hat, sp.hatColor, sp.trim);
      const holder = new THREE.Group();
      const hw = new THREE.Vector3(), hq = new THREE.Quaternion(), hs = new THREE.Vector3();
      head.matrixWorld.decompose(hw, hq, hs);
      // model units: find the metre scale from the head bone's world scale & the rig height
      const unit = this.unit || 1;
      // world-space placement at the measured top of the skull, facing the model's forward axis
      const top = (this.headTop && this.headTop[sp.sex]) ?? (hw.y + 0.18 * unit);
      const drop = { tricorne: 0.05, bandana: 0.1, headwrap: 0.1, straw: 0.06, bonnet: 0.1, basket: 0.02, bundle: 0.02 }[sp.hat] ?? 0.08;
      const worldM = new THREE.Matrix4().compose(new THREE.Vector3(hw.x, top - drop * unit, hw.z + 0.005 * unit), new THREE.Quaternion(), new THREE.Vector3(unit, unit, unit));
      const local = new THREE.Matrix4().copy(head.matrixWorld).invert().multiply(worldM);
      local.decompose(holder.position, holder.quaternion, holder.scale);
      hat.rotation.y = Math.PI; // hats are built facing -Z; the model faces +Z
      holder.add(hat);
      head.add(holder);
    }
    return model;
  }

  entry() {
    if (!this._entry) {
      const up = new Set();
      const probe = this.assemble(spec('townsman'));
      probe.getObjectByName('spine_01')?.traverse((o) => up.add(THREE.PropertyBinding.sanitizeNodeName(o.name)));
      const scale = 1.76 / this.rawHeight;
      this._entry = {
        scale, groundY: -this.rawFeet * scale, clips: this.clips, upper: up, handR: 'hand_r',
        armR: 'upperarm_r', foreR: 'lowerarm_r', armL: 'upperarm_l', foreL: 'lowerarm_l',
        rotateY: Math.PI, hideMeshes: [], file: 'humans',
      };
    }
    return this._entry;
  }

  // assemble a character for a game role and wrap it in the shared rig controller
  create(role) {
    const model = this.assemble(spec(role));
    return new GltfRig(this.entry(), model);
  }
}

export const humans = new Humans();
