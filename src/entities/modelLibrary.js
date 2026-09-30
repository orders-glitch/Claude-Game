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
import { props } from '../world/props.js';
import { weapons } from './weapons.js';

const BASE = './models/characters/';
const ACTIVITIES = ['sit', 'sitTalk', 'talk', 'dance', 'work'];
const _v0 = new THREE.Vector3(), _v1 = new THREE.Vector3();
const _q0 = new THREE.Quaternion(), _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion(), _q4 = new THREE.Quaternion();

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
  // bones for layering, weapon sockets and procedural aiming
  let spine = null, handR = null;
  const bones = [];
  scene.traverse((o) => { if (o.isBone) bones.push(o); });
  const byName = (re) => bones.find((b) => re.test(b.name));
  spine = (byName(/abdomen|spine/i) || byName(/chest|torso/i))?.name || null;
  const handBone = byName(/^hand[._ ]?r$|hand.*(right|_r\b|\.r\b)|right.*hand|handslot\.?r/i);
  // rigs without a hand bone: the fingers hang off the forearm
  const finger = byName(/(index|middle)1?[._ ]?r$/i);
  handR = handBone?.name || finger?.parent?.name || null;
  const armR = byName(/^upper_?arm[._ ]?r$|upperarm.*r$|arm[._ ]?r$/i)?.name || null;
  const foreR = byName(/^lower_?arm[._ ]?r$|forearm.*r$|lowerarm.*r$/i)?.name || null;
  const armL = byName(/^upper_?arm[._ ]?l$|upperarm.*l$|arm[._ ]?l$/i)?.name || null;
  const foreL = byName(/^lower_?arm[._ ]?l$|forearm.*l$|lowerarm.*l$/i)?.name || null;
  const upper = new Set();
  if (spine) scene.getObjectByName(spine)?.traverse((o) => upper.add(THREE.PropertyBinding.sanitizeNodeName(o.name)));
  return { scene, scale, groundY: -box.min.y * scale, clips: map, upper, handR, armR, foreR, armL, foreL, rotateY: opts.rotateY ?? Math.PI, file: opts.file, hideMeshes: opts.hide || ['^weapon', 'lute', 'crossbow', 'mug', 'throwable'] };
}

function splitClip(clip, upper, keepUpper) {
  if (!clip) return null;
  const tracks = clip.tracks.filter((t) => {
    const node = t.name.split('.')[0];
    return upper.has(node) === keepUpper;
  });
  return new THREE.AnimationClip(clip.name + (keepUpper ? '_upper' : '_lower'), clip.duration, tracks);
}

// ---------------------------------------------------------------- hand grips
// Hand-local frame from the finger bones: A runs across the knuckles towards the index finger, F from the
// wrist towards the knuckles, P out of the palm. Works for any rig with index/middle/pinky bones.
function handFrame(hand) {
  const find = (re) => hand.children.find((c) => c.isBone && re.test(c.name));
  const idx = find(/index/i), pk = find(/pinky|little/i), mid = find(/middle/i), th = find(/thumb/i);
  if (!idx || !pk || !mid) return null;
  const A = idx.position.clone().sub(pk.position).normalize();
  const K = mid.position.clone();
  const F = K.clone().normalize();
  F.addScaledVector(A, -F.dot(A)).normalize();
  const P = new THREE.Vector3().crossVectors(A, F).normalize();
  if (th && P.dot(th.position) < 0) P.negate();
  // centre of the closed fist: short of the knuckles, a little towards the palm
  const center = K.clone().multiplyScalar(0.62).addScaledVector(P, K.length() * 0.22);
  return { A, F, P, center };
}

// quaternion whose X/Y/Z axes are the given (orthonormalised) hand-space vectors
function basis(x, y) {
  const Y = y.clone().normalize();
  const X = x.clone().addScaledVector(Y, -x.dot(Y)).normalize();
  const Z = new THREE.Vector3().crossVectors(X, Y);
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, Y, Z));
}

const GRIPS = {
  // blade leaves the fist on the index side, edge towards the knuckles
  cutlass: { frame: (f) => basis(f.F, f.A.clone().addScaledVector(f.F, 0.25).negate()), offset: [0, 0, 0] },
  spade: { frame: (f) => basis(f.F, f.A.clone().addScaledVector(f.F, 0.1).negate()), offset: [0, 0.25, 0] },
  // guns: barrel forward along the knuckles, the grip (+Z) runs down through the fist
  pistol: { frame: (f) => basis(new THREE.Vector3().crossVectors(f.F, f.A), f.F.clone().negate()), offset: [0, 0, 0] },
  musket: { frame: (f) => basis(new THREE.Vector3().crossVectors(f.F, f.A), f.F.clone().negate()), offset: [0, 0, 0] },
};

// ---------------------------------------------------------------- per-character instance
export class GltfRig {
  // entry: prepared model description; prebuilt: an already-assembled unique model (skips cloning)
  constructor(entry, prebuilt = null) {
    this.entry = entry;
    this.root = new THREE.Group();
    this.root.rotation.order = 'YXZ';
    const model = prebuilt || SkeletonUtils.clone(entry.scene);
    model.scale.setScalar(entry.scale);
    model.position.y = entry.groundY;
    model.rotation.y = entry.rotateY; // glTF characters face +Z; the game's characters face -Z
    model.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true; o.receiveShadow = true;
        if (o.isSkinnedMesh) o.frustumCulled = false;
        // hide weapons/props baked into the character so ours can be shown instead
      }
      if (!o.isBone && entry.hideMeshes.some((re) => new RegExp(re, 'i').test(o.name))) o.visible = false;
    });
    this.root.add(model);
    this.model = model;

    this.socketR = new THREE.Group();
    const hand = entry.handR ? model.getObjectByName(entry.handR) : null;
    if (hand) {
      // sockets live in hand space; undo the model (and bone) scale so our metre-sized weapons stay the right size
      hand.updateWorldMatrix(true, false);
      const ws = new THREE.Vector3(); hand.getWorldScale(ws);
      this.socketR.scale.setScalar(1 / (ws.x * entry.scale || 1));
      if (entry.socket) { this.socketR.position.fromArray(entry.socket.pos || [0, 0, 0]); this.socketR.rotation.fromArray(entry.socket.rot || [0, 0, 0]); }
      hand.add(this.socketR);
      if (!entry.socket && !entry.weaponRot) this.grip = handFrame(hand);
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
    const cache = entry._split || (entry._split = new Map());
    const split = (clip, u, keep) => {
      if (!clip) return null;
      const key = clip.uuid + keep;
      if (!cache.has(key)) cache.set(key, splitClip(clip, u, keep));
      return cache.get(key);
    };
    const splitClipC = split;
    add('idle', C.idle); add('walk', C.walk || C.run); add('run', C.run || C.walk);
    add('idle_lower', splitClipC(C.idle, up, false)); add('walk_lower', splitClipC(C.walk || C.run, up, false)); add('run_lower', splitClipC(C.run || C.walk, up, false));
    add('slash', splitClipC(C.slash, up, true), true);
    add('aimPistol', splitClipC(C.aimPistol, up, true));
    add('aimMusket', splitClipC(C.aimMusket || C.aimPistol, up, true));
    add('dig', C.dig);
    add('hit', splitClipC(C.hit, up, true), true);
    add('death', C.death, true);
    for (const k of ACTIVITIES) if (C[k]) add('act_' + k, C[k]);
    if (this.actions.idle) { this.actions.idle.setEffectiveWeight(1); this.actions.idle.time = Math.random() * this.actions.idle.getClip().duration; }
    this.w = { slash: 0, aimP: 0, aimM: 0, dig: 0, dead: 0, act: 0 };
    this.wasDead = false;
    this.lastHit = 0;
    this.weaponKind = undefined;
  }

  setWeapon(kind) {
    if (this.weaponKind === kind) return;
    this.weaponKind = kind;
    if (this.weapon) this.socketR.remove(this.weapon);
    // scanned blades where available (a cutlass may be carried as a saber, machete or boarding hatchet)
    // museum scans first (cutlass, officer's sword, pistol, musket), then Poly Haven blades, then procedural
    const museum = kind === 'cutlass' ? (this.blade && this.blade !== 'cutlass' ? null : weapons.create(this.blade === 'basket_sword' ? 'basket_sword' : 'cutlass'))
      : kind === 'pistol' || kind === 'musket' ? weapons.create(kind) : null;
    const scanned = museum || (kind === 'cutlass' ? props.weapon(this.blade || 'wooden_handle_saber') : null);
    if (scanned) scanned.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    this.weapon = kind && this.hasHand ? (scanned || weaponMesh(kind)) : null;
    if (this.weapon && this.grip) {
      // a real fist grip derived from the knuckle bones (weapons are modelled blade/barrel along -Y)
      const G = GRIPS[kind] || GRIPS.cutlass;
      const f = this.grip;
      this.socketR.position.copy(f.center);
      this.socketR.quaternion.copy(G.frame(f));
      this.weapon.position.fromArray(G.offset);
      this.weapon.rotation.set(0, 0, 0);
      this.socketR.add(this.weapon);
    } else if (this.weapon) {
      // in the socket, point the blade/barrel away from the wrist
      const r = this.entry.weaponRot?.[kind];
      if (r) this.weapon.rotation.fromArray(r); else this.weapon.rotation.set(kind === 'musket' ? 0 : Math.PI, 0, 0);
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
    // everyday activity (sitting, talking, dancing, working): a full-body layer over the locomotion
    const act = st.activity && A['act_' + st.activity] ? st.activity : null;
    if (act && act !== this.curAct) { if (this.curAct) setW('act_' + this.curAct, 0); this.curAct = act; this.w.act = 0; }
    const wA = towards('act', act ? 1 : 0, 3.5);
    if (this.curAct) setW('act_' + this.curAct, wA * (1 - wS));
    const upper = Math.min(1, wS + wP + wM);
    if (slashing) A.slash.time = Math.min(0.999, st.attack) * A.slash.getClip().duration;
    setW('slash', wS);
    // both aims may share one clip (and therefore one action): set it once with the combined weight
    if (A.aimMusket === A.aimPistol) setW('aimPistol', Math.min(1, wP + wM) * (1 - wS));
    else { setW('aimPistol', wP * (1 - wS)); setW('aimMusket', wM * (1 - wS)); }
    setW('dig', wD);

    const s = st.speed || 0;
    const walkW = Math.max(0, Math.min(1, s / 1.4)) * (1 - Math.max(0, Math.min(1, (s - 2.6) / 2)));
    const runW = Math.max(0, Math.min(1, (s - 2.6) / 2));
    const idleW = Math.max(0, 1 - walkW - runW);
    const loco = (1 - wD) * (1 - (this.w.act || 0));
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

    // no aim animation in the model: swing the arm(s) to point where the character is looking
    const needP = st.aim && st.weapon !== 'musket' && !A.aimPistol;
    const needM = st.aim && st.weapon === 'musket' && !A.aimMusket;
    this.aimBlend = (this.aimBlend || 0) + ((needP || needM ? 1 : 0) - (this.aimBlend || 0)) * k(12);
    if (this.aimBlend > 0.01) {
      this.root.updateMatrixWorld(true);
      const pitch = -(st.aimPitch || 0) * 0.8;
      const fwd = new THREE.Vector3(0, Math.sin(pitch), -Math.cos(pitch)).applyQuaternion(this.root.getWorldQuaternion(_q0));
      this.pointBone(this.entry.armR, fwd, this.aimBlend);
      this.pointBone(this.entry.foreR, fwd, this.aimBlend);
      if (needM || this.weaponKind === 'musket') {
        const side = new THREE.Vector3(-0.35, 0, 0).applyQuaternion(this.root.getWorldQuaternion(_q0));
        this.pointBone(this.entry.armL, fwd.clone().add(side).normalize(), this.aimBlend);
        this.pointBone(this.entry.foreL, fwd, this.aimBlend);
      }
    }
  }

  // rotate a bone (in world space) so the direction to its child points along dir
  pointBone(name, dir, weight) {
    const b = name && this.model.getObjectByName(name);
    if (!b || !b.children.length) return;
    const child = b.children.find((c) => c.isBone) || b.children[0];
    b.updateWorldMatrix(true, true);
    const p0 = b.getWorldPosition(_v0), p1 = child.getWorldPosition(_v1);
    const cur = p1.sub(p0).normalize();
    const delta = _q1.setFromUnitVectors(cur, dir);
    const wq = b.getWorldQuaternion(_q2);
    const target = _q3.copy(delta).multiply(wq);
    const parentQ = b.parent.getWorldQuaternion(_q4).invert();
    const local = parentQ.multiply(target);
    b.quaternion.slerp(local, weight);
    b.updateWorldMatrix(false, true);
  }

  dispose() {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.model);
  }
}
