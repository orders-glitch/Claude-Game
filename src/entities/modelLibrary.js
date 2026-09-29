// Optional artist-made rigged characters (glTF/GLB). Drop models into public/models/characters/ and list
// them in manifest.json; any role without a model falls back to the procedural CharacterRig.
//
// manifest.json:
// { "roles": { "captain": "Characters_Captain_Barbarossa.gltf",
//              "pirate": ["Characters_Henry.gltf", "Characters_Mako.gltf"],
//              "pirate_female": { "file": "Characters_Anne.gltf", "height": 1.7 } } }
// Role keys used by the game: captain, pirate, pirate_female, soldier_britain, soldier_spain,
// soldier_france, soldier_pirate, townsman, townswoman, sailor, merchant.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { weaponMesh } from './rig.js';

const BASE = './models/characters/';

class ModelLibrary {
  constructor() {
    this.models = {}; // role -> [entry]
    this.ready = false;
  }

  async load() {
    let manifest;
    try {
      const r = await fetch(BASE + 'manifest.json', { cache: 'no-cache' });
      if (!r.ok) return;
      manifest = await r.json();
    } catch (e) { return; }
    const loader = new GLTFLoader();
    const cache = new Map();
    const loadFile = (file) => {
      if (!cache.has(file)) cache.set(file, loader.loadAsync(BASE + file).catch((e) => { console.warn('Character model failed to load:', file, e); return null; }));
      return cache.get(file);
    };
    for (const [role, spec] of Object.entries(manifest.roles || {})) {
      const list = Array.isArray(spec) ? spec : [spec];
      for (const item of list) {
        const opts = typeof item === 'string' ? { file: item } : item;
        const gltf = await loadFile(opts.file);
        if (!gltf) continue;
        (this.models[role] = this.models[role] || []).push(prepare(gltf, opts));
      }
    }
    this.ready = true;
  }

  has(role) { return !!(role && this.models[role]?.length); }
  pick(role) { const l = this.models[role]; return l[Math.floor(Math.random() * l.length)]; }
}

export const modelLibrary = new ModelLibrary();

// ---------------------------------------------------------------- analysis done once per model file
const CLIP_PATTERNS = {
  idle: [/^idle$/i, /^idle[_ ]?a?$/i, /^unarmed_idle$/i, /idle(?!.*(gun|sword|2h|jump|lie|sit|chair|floor))/i],
  walk: [/^walk(ing)?(_a)?$/i, /^walk/i, /walk(?!.*back)/i],
  run: [/^run(ning)?(_a)?$/i, /^run/i, /run(?!.*(strafe|gun))/i],
  slash: [/sword/i, /1h_melee_attack_slice/i, /slash/i, /melee.*(slice|chop)/i, /attack/i, /punch/i],
  aimPistol: [/1h_ranged_aim/i, /gun_?shoot/i, /pistol/i, /aim/i, /shoot/i, /ranged/i],
  aimMusket: [/2h_ranged_aim/i, /rifle/i, /2h_ranged/i, /aim/i, /shoot/i],
  hit: [/hit_?react/i, /hit_a/i, /hit/i, /recieve|receive/i],
  death: [/^death$/i, /death_a$/i, /death(?!.*pose)/i, /die/i],
  dig: [/interact/i, /pick_?up/i, /use_item/i, /dig/i],
};

function findClip(clips, key) {
  for (const re of CLIP_PATTERNS[key]) {
    const c = clips.find((c) => re.test(c.name));
    if (c) return c;
  }
  return null;
}

function prepare(gltf, opts) {
  const scene = gltf.scene;
  scene.updateMatrixWorld(true);
  // normalise height and ground the feet
  const box = new THREE.Box3().setFromObject(scene);
  const h = box.max.y - box.min.y || 1;
  const scale = (opts.height || 1.78) / h * (opts.scale || 1);
  const clips = gltf.animations || [];
  const map = {};
  for (const k of Object.keys(CLIP_PATTERNS)) map[k] = findClip(clips, k);
  // bones for layering and weapon sockets
  let spine = null, handR = null;
  scene.traverse((o) => {
    if (!o.isBone) return;
    if (!spine && /spine|chest|torso/i.test(o.name)) spine = o.name;
    if (!handR && (/hand.*(r\b|right|_r|\.r)|(right|r_|\.r).*hand|handslot\.?r/i.test(o.name))) handR = o.name;
  });
  const upper = new Set();
  if (spine) scene.getObjectByName(spine)?.traverse((o) => upper.add(THREE.PropertyBinding.sanitizeNodeName(o.name)));
  return { scene, scale, groundY: -box.min.y * scale, clips: map, upper, handR, rotateY: opts.rotateY ?? Math.PI, file: opts.file, hideMeshes: opts.hide || [] };
}

function splitClip(clip, upper, keepUpper) {
  if (!clip) return null;
  const tracks = clip.tracks.filter((t) => {
    const node = t.name.split('.')[0];
    return upper.has(node) === keepUpper;
  });
  return new THREE.AnimationClip(clip.name + (keepUpper ? '_upper' : '_lower'), clip.duration, tracks);
}

// ---------------------------------------------------------------- per-character instance
export class GltfRig {
  constructor(entry) {
    this.entry = entry;
    this.root = new THREE.Group();
    this.root.rotation.order = 'YXZ';
    const model = SkeletonUtils.clone(entry.scene);
    model.scale.setScalar(entry.scale);
    model.position.y = entry.groundY;
    model.rotation.y = entry.rotateY; // glTF characters face +Z; the game's characters face -Z
    model.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true; o.receiveShadow = true;
        if (o.isSkinnedMesh) o.frustumCulled = false;
        // hide weapons/props baked into the character so ours can be shown instead
        if (entry.hideMeshes.some((re) => new RegExp(re, 'i').test(o.name))) o.visible = false;
      }
    });
    this.root.add(model);
    this.model = model;

    this.socketR = new THREE.Group();
    const hand = entry.handR ? model.getObjectByName(entry.handR) : null;
    if (hand) {
      // sockets live in hand space; undo the model scale so our metre-sized weapons stay the right size
      this.socketR.scale.setScalar(1 / entry.scale);
      hand.add(this.socketR);
    }
    this.hasHand = !!hand;

    this.mixer = new THREE.AnimationMixer(model);
    this.actions = {};
    const C = entry.clips;
    const add = (name, clip, once = false) => {
      if (!clip) return;
      const a = this.mixer.clipAction(clip);
      if (once) { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; }
      a.setEffectiveWeight(0);
      a.play();
      this.actions[name] = a;
    };
    const up = entry.upper;
    add('idle', C.idle); add('walk', C.walk || C.run); add('run', C.run || C.walk);
    add('idle_lower', splitClip(C.idle, up, false)); add('walk_lower', splitClip(C.walk || C.run, up, false)); add('run_lower', splitClip(C.run || C.walk, up, false));
    add('slash', splitClip(C.slash, up, true), true);
    add('aimPistol', splitClip(C.aimPistol, up, true));
    add('aimMusket', splitClip(C.aimMusket || C.aimPistol, up, true));
    add('dig', C.dig);
    add('hit', splitClip(C.hit, up, true), true);
    add('death', C.death, true);
    if (this.actions.idle) { this.actions.idle.setEffectiveWeight(1); this.actions.idle.time = Math.random() * this.actions.idle.getClip().duration; }
    this.w = { slash: 0, aimP: 0, aimM: 0, dig: 0, dead: 0 };
    this.wasDead = false;
    this.lastHit = 0;
    this.weaponKind = undefined;
  }

  setWeapon(kind) {
    if (this.weaponKind === kind) return;
    this.weaponKind = kind;
    if (this.weapon) this.socketR.remove(this.weapon);
    this.weapon = kind && this.hasHand ? weaponMesh(kind) : null;
    if (this.weapon) {
      // in the socket, point the blade/barrel away from the wrist
      this.weapon.rotation.set(kind === 'musket' ? 0 : Math.PI, 0, 0);
      this.socketR.add(this.weapon);
    }
  }

  update(dt, st) {
    const A = this.actions;
    const k = (rate) => 1 - Math.exp(-rate * dt);
    const towards = (key, target, rate = 10) => { this.w[key] += (target - this.w[key]) * k(rate); return this.w[key]; };
    const setW = (name, w) => A[name]?.setEffectiveWeight(w);

    if (st.dead && A.death) {
      if (!this.wasDead) { A.death.reset(); A.death.play(); this.wasDead = true; }
      const d = towards('dead', 1, 14);
      for (const [n, a] of Object.entries(A)) if (n !== 'death') a.setEffectiveWeight(a.getEffectiveWeight() * (1 - d));
      A.death.setEffectiveWeight(d);
      this.mixer.update(dt);
      return;
    }
    if (this.wasDead) { this.wasDead = false; this.w.dead = 0; setW('death', 0); }

    const slashing = st.attack >= 0 && A.slash;
    const aimP = st.aim && st.weapon !== 'musket' && A.aimPistol;
    const aimM = st.aim && st.weapon === 'musket' && A.aimMusket;
    const wS = towards('slash', slashing ? 1 : 0, 25);
    const wP = towards('aimP', aimP ? 1 : 0, 12);
    const wM = towards('aimM', aimM ? 1 : 0, 10);
    const wD = towards('dig', st.dig && A.dig ? 1 : 0, 8);
    const upper = Math.min(1, wS + wP + wM);
    if (slashing) A.slash.time = Math.min(0.999, st.attack) * A.slash.getClip().duration;
    setW('slash', wS);
    setW('aimPistol', wP * (1 - wS));
    setW('aimMusket', wM * (1 - wS));
    setW('dig', wD);

    const s = st.speed || 0;
    const walkW = Math.max(0, Math.min(1, s / 1.4)) * (1 - Math.max(0, Math.min(1, (s - 2.6) / 2)));
    const runW = Math.max(0, Math.min(1, (s - 2.6) / 2));
    const idleW = Math.max(0, 1 - walkW - runW);
    const loco = 1 - wD;
    if (A.walk) { A.walk.timeScale = s > 0.2 ? Math.max(0.5, s / 1.6) : 1; if (A.walk_lower) { A.walk_lower.timeScale = A.walk.timeScale; A.walk_lower.time = A.walk.time; } }
    if (A.run) { A.run.timeScale = Math.max(0.7, s / 5.5); if (A.run_lower) { A.run_lower.timeScale = A.run.timeScale; A.run_lower.time = A.run.time; } }
    if (A.idle_lower && A.idle) A.idle_lower.time = A.idle.time;
    const full = loco * (1 - upper), low = loco * upper;
    setW('idle', idleW * full); setW('idle_lower', idleW * low);
    setW('walk', walkW * full); setW('walk_lower', walkW * low);
    setW('run', runW * full); setW('run_lower', runW * low);

    if (A.hit) {
      if (st.hitT > 0.95 && performance.now() - this.lastHit > 200) { this.lastHit = performance.now(); A.hit.reset(); A.hit.play(); }
      A.hit.setEffectiveWeight(st.hitT > 0 ? Math.min(0.7, st.hitT) : 0);
    }
    this.mixer.update(dt);
  }

  dispose() {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.model);
  }
}
