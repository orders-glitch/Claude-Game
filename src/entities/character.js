// Period-dressed humanoids built from primitives and animated procedurally.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { clamp, damp, lerp } from '../core/noise.js';

const charMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0.05 });
const metalMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.85 });

function colored(geo, color, m) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  if (m) g.applyMatrix4(m);
  const c = new THREE.Color(color);
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  if (g.attributes.uv) g.deleteAttribute('uv');
  return g;
}
const M4 = (x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) => new THREE.Matrix4().compose(
  new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));

function part(list, mat = charMat) {
  const g = mergeGeometries(list, false);
  const mesh = new THREE.Mesh(g, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

export const LOOKS = {
  captain: { skin: '#c89468', coat: '#5a1f1a', coatLong: true, shirt: '#ece4d0', vest: '#8a6a2a', breeches: '#2a2320', stockings: '#d8d0c0', shoes: '#1a1410', hat: 'tricorne', hatColor: '#1c1814', hair: '#2a1a10', sash: '#8a1d1d', weapon: 'cutlass', trim: '#c9a13a', boots: true, shoes: '#2a1a10', beard: '#2a1a10', baldric: true },
  pirate: { skin: '#b07850', coat: null, shirt: '#d8ccb0', vest: '#5a4630', breeches: '#4a4034', stockings: '#6a5a44', shoes: '#2a2018', hat: 'bandana', hatColor: '#8a2a1a', hair: '#1a1410', sash: '#3a5a7a', weapon: 'cutlass', sleeves: 'rolled', slops: true },
  redcoat: { skin: '#e0b090', coat: '#a4221e', coatLong: true, shirt: '#ece4d0', vest: '#d8ccb0', breeches: '#d8ccb0', stockings: '#e8e0d0', shoes: '#141210', hat: 'tricorne', hatColor: '#141210', hair: '#e8e4dc', weapon: 'musket', trim: '#e8dcc0', crossbelt: true },
  spanishSoldier: { skin: '#c08a60', coat: '#2b3f7a', coatLong: true, shirt: '#ece4d0', vest: '#c9372c', breeches: '#2b3f7a', stockings: '#c9372c', shoes: '#141210', hat: 'tricorne', hatColor: '#141210', hair: '#1a1410', weapon: 'musket', trim: '#e8dcc0', crossbelt: true },
  frenchSoldier: { skin: '#d8a882', coat: '#d9d4c6', coatLong: true, shirt: '#ece4d0', vest: '#1f3d78', breeches: '#d9d4c6', stockings: '#e8e0d0', shoes: '#141210', hat: 'tricorne', hatColor: '#141210', hair: '#e8e4dc', weapon: 'musket', trim: '#1f3d78', crossbelt: true },
  townsman: { skin: '#d0a078', coat: '#6a5a44', coatLong: true, shirt: '#e8e0cc', vest: '#8a7a5a', breeches: '#4a4238', stockings: '#b8b0a0', shoes: '#241c14', hat: 'tricorne', hatColor: '#2a241c', hair: '#5a3a20', weapon: null },
  sailor: { skin: '#a87048', coat: null, shirt: '#e0d8c4', vest: null, breeches: '#8a8a7a', stockings: null, shoes: null, hat: 'straw', hatColor: '#c8b078', hair: '#2a1a10', weapon: null, slops: true },
  woman: { skin: '#d8a882', dress: '#8a4a5a', bodice: '#5a3a3a', shirt: '#eee6d6', hat: 'bonnet', hatColor: '#eee6d6', hair: '#5a3018', weapon: null },
  woman2: { skin: '#8a5a3a', dress: '#c9a060', bodice: '#6a4a2a', shirt: '#eee6d6', hat: 'headwrap', hatColor: '#b8442a', hair: '#1a1410', weapon: null },
  merchant: { skin: '#e0b090', coat: '#2a3a5a', coatLong: true, shirt: '#f0e8d8', vest: '#c9a13a', breeches: '#2a2a2a', stockings: '#e8e0d0', shoes: '#141210', hat: 'tricorne', hatColor: '#1a1a1a', hair: '#e8e4dc', weapon: null, trim: '#c9a13a' },
};

export function buildCharacter(look) {
  const L = look;
  const root = new THREE.Group();
  root.rotation.order = 'YXZ';
  const hips = new THREE.Group(); hips.position.y = 0.95; root.add(hips);
  const torso = new THREE.Group(); torso.position.y = 0.08; hips.add(torso);
  const bones = { root, hips, torso };

  // --- hips/pelvis
  const hipParts = [];
  if (L.dress) {
    hipParts.push(colored(new THREE.CylinderGeometry(0.2, 0.46, 0.95, 12, 1), L.dress, M4(0, -0.42, 0)));
  } else {
    hipParts.push(colored(new THREE.BoxGeometry(0.36, 0.22, 0.22), L.breeches, M4(0, -0.02, 0)));
    if (L.coat && L.coatLong) {
      // coat skirts flare below the waist
      hipParts.push(colored(new THREE.CylinderGeometry(0.21, 0.3, 0.55, 10, 1, true), L.coat, M4(0, -0.24, 0.01)));
    }
    if (L.sash) hipParts.push(colored(new THREE.CylinderGeometry(0.2, 0.2, 0.09, 10), L.sash, M4(0, 0.1, 0)));
  }
  hips.add(part(hipParts));

  // --- torso + head
  const tp = [];
  const bodyCol = L.dress ? L.bodice : L.coat || L.vest || L.shirt;
  tp.push(colored(new THREE.CylinderGeometry(0.2, 0.17, 0.55, 10), bodyCol, M4(0, 0.28, 0, 0, 0, 0, 1.12, 1, 0.8)));
  if (L.coat && L.vest) tp.push(colored(new THREE.BoxGeometry(0.18, 0.5, 0.05), L.vest, M4(0, 0.27, -0.14)));
  if (L.trim) {
    tp.push(colored(new THREE.BoxGeometry(0.03, 0.52, 0.04), L.trim, M4(-0.1, 0.27, -0.155)));
    tp.push(colored(new THREE.BoxGeometry(0.03, 0.52, 0.04), L.trim, M4(0.1, 0.27, -0.155)));
  }
  if (L.crossbelt) {
    tp.push(colored(new THREE.BoxGeometry(0.06, 0.7, 0.03), '#f0ece0', M4(0, 0.27, -0.155, 0, 0, 0.6)));
    tp.push(colored(new THREE.BoxGeometry(0.06, 0.7, 0.03), '#f0ece0', M4(0, 0.27, -0.155, 0, 0, -0.6)));
  }
  tp.push(colored(new THREE.CylinderGeometry(0.06, 0.07, 0.1, 8), L.skin, M4(0, 0.6, 0)));
  // neck cloth / cravat
  tp.push(colored(new THREE.BoxGeometry(0.12, 0.1, 0.05), L.shirt, M4(0, 0.52, -0.12)));
  // head
  tp.push(colored(new THREE.SphereGeometry(0.13, 12, 10), L.skin, M4(0, 0.76, 0, 0, 0, 0, 0.95, 1.1, 1)));
  tp.push(colored(new THREE.BoxGeometry(0.035, 0.05, 0.05), L.skin, M4(0, 0.75, -0.135)));
  // eyes
  tp.push(colored(new THREE.SphereGeometry(0.018, 6, 4), '#1a1410', M4(-0.045, 0.79, -0.118)));
  tp.push(colored(new THREE.SphereGeometry(0.018, 6, 4), '#1a1410', M4(0.045, 0.79, -0.118)));
  // hair / queue
  tp.push(colored(new THREE.SphereGeometry(0.135, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), L.hair, M4(0, 0.78, 0.015)));
  if (!L.dress) tp.push(colored(new THREE.CylinderGeometry(0.03, 0.02, 0.22, 5), L.hair, M4(0, 0.63, 0.14, 0.3)));
  // hats
  const hc = L.hatColor;
  if (L.hat === 'tricorne') {
    tp.push(colored(new THREE.CylinderGeometry(0.2, 0.2, 0.03, 3), hc, M4(0, 0.89, 0, 0, Math.PI, 0)));
    tp.push(colored(new THREE.CylinderGeometry(0.2, 0.22, 0.09, 3, 1, true), hc, M4(0, 0.93, 0, 0, Math.PI, 0)));
    tp.push(colored(new THREE.SphereGeometry(0.12, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), hc, M4(0, 0.89, 0)));
    if (L.trim) tp.push(colored(new THREE.CylinderGeometry(0.205, 0.205, 0.015, 3, 1, true), L.trim, M4(0, 0.975, 0, 0, Math.PI, 0)));
  } else if (L.hat === 'bandana' || L.hat === 'headwrap') {
    tp.push(colored(new THREE.SphereGeometry(0.14, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), hc, M4(0, 0.79, 0.005)));
    tp.push(colored(new THREE.BoxGeometry(0.05, 0.14, 0.03), hc, M4(0.04, 0.69, 0.14, 0.3, 0, 0.3)));
  } else if (L.hat === 'straw') {
    tp.push(colored(new THREE.CylinderGeometry(0.26, 0.26, 0.02, 12), hc, M4(0, 0.87, 0)));
    tp.push(colored(new THREE.CylinderGeometry(0.1, 0.13, 0.1, 10), hc, M4(0, 0.92, 0)));
  } else if (L.hat === 'bonnet') {
    tp.push(colored(new THREE.SphereGeometry(0.15, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.6), hc, M4(0, 0.79, 0.02)));
  }
  if (L.dress) tp.push(colored(new THREE.BoxGeometry(0.3, 0.05, 0.12), L.shirt, M4(0, 0.5, -0.08)));
  torso.add(part(tp));

  // --- arms
  const armCol = L.dress ? L.shirt : L.coat || L.shirt;
  for (const s of [-1, 1]) {
    const upper = new THREE.Group(); upper.position.set(s * 0.25, 0.5, 0); torso.add(upper);
    upper.add(part([colored(new THREE.CylinderGeometry(0.06, 0.055, 0.3, 8), armCol, M4(0, -0.15, 0))]));
    const lower = new THREE.Group(); lower.position.y = -0.3; upper.add(lower);
    const lp = [colored(new THREE.CylinderGeometry(0.055, 0.045, 0.27, 8), armCol, M4(0, -0.13, 0))];
    if (L.coat) lp.push(colored(new THREE.CylinderGeometry(0.07, 0.07, 0.08, 8), L.trim || L.coat, M4(0, -0.23, 0)));
    lp.push(colored(new THREE.SphereGeometry(0.05, 8, 6), L.skin, M4(0, -0.31, 0)));
    lower.add(part(lp));
    bones[s < 0 ? 'armL' : 'armR'] = upper;
    bones[s < 0 ? 'foreL' : 'foreR'] = lower;
  }
  // weapon in the right hand
  const hand = new THREE.Group(); hand.position.y = -0.31; bones.foreR.add(hand); bones.handR = hand;
  const handL = new THREE.Group(); handL.position.y = -0.31; bones.foreL.add(handL); bones.handL = handL;
  setWeapon(bones, L.weapon);

  // --- legs
  for (const s of [-1, 1]) {
    const thigh = new THREE.Group(); thigh.position.set(s * 0.1, -0.05, 0); hips.add(thigh);
    const legCol = L.dress ? L.dress : L.slops ? L.breeches : L.breeches;
    if (!L.dress) thigh.add(part([colored(new THREE.CylinderGeometry(0.075, 0.06, 0.45, 8), legCol, M4(0, -0.22, 0))]));
    const shin = new THREE.Group(); shin.position.y = -0.44; thigh.add(shin);
    const sp = [];
    if (!L.dress) sp.push(colored(new THREE.CylinderGeometry(0.058, 0.045, 0.44, 8), L.stockings || (L.slops ? L.breeches : L.skin), M4(0, -0.22, 0)));
    else sp.push(colored(new THREE.CylinderGeometry(0.04, 0.035, 0.3, 6), '#e8e0d0', M4(0, -0.28, 0)));
    sp.push(colored(new THREE.BoxGeometry(0.1, 0.07, 0.24), L.shoes || L.skin, M4(0, -0.47, -0.04)));
    if (L.shoes && !L.slops) sp.push(colored(new THREE.BoxGeometry(0.06, 0.02, 0.05), '#b8a060', M4(0, -0.43, -0.12)));
    shin.add(part(sp));
    bones[s < 0 ? 'thighL' : 'thighR'] = thigh;
    bones[s < 0 ? 'shinL' : 'shinR'] = shin;
  }
  return bones;
}

export function setWeapon(bones, weapon) {
  const hand = bones.handR;
  while (hand.children.length) hand.remove(hand.children[0]);
  bones.weapon = weapon;
  if (weapon === 'cutlass') {
    const g = [
      colored(new THREE.BoxGeometry(0.035, 0.72, 0.012), '#c8ccd0', M4(0, -0.46, 0)),
      colored(new THREE.BoxGeometry(0.12, 0.04, 0.05), '#b8942a', M4(0, -0.08, 0)),
      colored(new THREE.CylinderGeometry(0.02, 0.02, 0.12, 6), '#3a2a1a', M4(0, 0.0, 0)),
    ];
    const holder = new THREE.Group();
    holder.add(part(g, metalMat));
    holder.rotation.set(1.1, 0, 0);
    hand.add(holder);
  } else if (weapon === 'musket') {
    const g = [
      colored(new THREE.CylinderGeometry(0.018, 0.02, 1.2, 6), '#2a2a2a', M4(0, 0.35, 0)),
      colored(new THREE.BoxGeometry(0.06, 0.55, 0.09), '#5a3a22', M4(0, -0.35, 0.015)),
      colored(new THREE.BoxGeometry(0.012, 0.25, 0.012), '#c8ccd0', M4(0, 1.05, 0)),
    ];
    const m = part(g, metalMat);
    const holder = new THREE.Group(); holder.add(m);
    holder.rotation.set(Math.PI, 0, 0);
    hand.add(holder);
  } else if (weapon === 'pistol') {
    const g = [
      colored(new THREE.CylinderGeometry(0.02, 0.016, 0.34, 6), '#2a2a2a', M4(0, -0.2, 0)),
      colored(new THREE.BoxGeometry(0.05, 0.16, 0.07), '#5a3a22', M4(0, 0.0, 0.05, -0.5)),
    ];
    const holder = new THREE.Group(); holder.add(part(g, metalMat)); holder.rotation.set(0.15, 0, 0);
    hand.add(holder);
  }
}

// Animation driver. state: { speed (m/s), attack (0..1 progress or -1), aim (bool), dead (0..1), carry }
export class Animator {
  constructor(bones) {
    this.b = bones;
    this.phase = Math.random() * 10;
    this.blend = 0;
    this.deadT = 0;
    this.breath = Math.random() * 6;
  }

  update(dt, st) {
    const b = this.b;
    const spd = st.speed || 0;
    const run = clamp((spd - 2.2) / 3, 0, 1);
    const moving = clamp(spd / 1.5, 0, 1);
    this.blend = damp(this.blend, moving, 8, dt);
    this.phase += dt * (spd * 1.9 + 0.001) * (1 - run * 0.25);
    this.breath += dt;
    const p = this.phase;
    const amp = this.blend * lerp(0.5, 0.85, run);
    const sw = Math.sin(p) * amp;
    // legs
    b.thighL.rotation.x = sw;
    b.thighR.rotation.x = -sw;
    b.shinL.rotation.x = -Math.max(0, -Math.cos(p)) * amp * 1.4 - 0.02;
    b.shinR.rotation.x = -Math.max(0, Math.cos(p)) * amp * 1.4 - 0.02;
    // bob & lean
    b.hips.position.y = 0.95 + Math.abs(Math.cos(p)) * 0.05 * this.blend - run * 0.03;
    b.torso.rotation.x = -run * 0.22 * this.blend + Math.sin(this.breath * 1.6) * 0.012;
    b.torso.rotation.y = Math.sin(p) * 0.08 * amp;
    // arms
    b.armL.rotation.x = -sw * 0.8;
    b.armL.rotation.z = -0.08;
    b.foreL.rotation.x = 0.25 + run * 0.8 * this.blend;
    let ax = sw * 0.8, az = 0.08, fx = 0.25 + run * 0.8 * this.blend;
    b.handR.rotation.x = 0;
    if (st.weapon === 'musket' && !st.aim) { ax = 0.2; fx = 1.3; az = 0.15; }
    if (st.aim) {
      ax = Math.PI / 2 - (st.aimPitch || 0); fx = 0; az = 0.05;
      if (st.weapon === 'musket') {
        b.armL.rotation.x = Math.PI / 2 - 0.25; b.armL.rotation.z = 0.5; b.foreL.rotation.x = 0.4;
      }
    }
    if (st.attack >= 0 && st.attack !== undefined) {
      // overhead-to-cross slash
      const t = st.attack;
      const wind = t < 0.35 ? t / 0.35 : 1;
      const strike = t < 0.35 ? 0 : clamp((t - 0.35) / 0.3, 0, 1);
      ax = lerp(lerp(0.2, 2.7, wind), 0.7, strike);
      az = lerp(0.1, 0.5, wind) - strike * 0.9;
      fx = lerp(0.4, 0.1, strike);
      b.torso.rotation.y = lerp(0.4 * wind, -0.5, strike);
    }
    if (st.block) { ax = 1.2; az = -0.6; fx = 1.0; }
    b.armR.rotation.x = ax;
    b.armR.rotation.z = az;
    b.foreR.rotation.x = fx;
    // death
    if (st.dead) {
      this.deadT = Math.min(1, this.deadT + dt * 1.8);
      const t = this.deadT;
      b.root.rotation.x = -t * t * Math.PI / 2 * (st.deadDir || 1);
      b.hips.position.y = lerp(0.95, 0.25, t);
      b.thighL.rotation.x = b.thighR.rotation.x = 0.3 * t;
    } else if (this.deadT > 0) {
      this.deadT = 0; b.root.rotation.x = 0;
    }
    if (st.hitT > 0) b.torso.rotation.x += st.hitT * 0.8;
  }
}
