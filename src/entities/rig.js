// Fully rigged, skinned period characters.
//
// Every character is ONE SkinnedMesh bound to a 21-bone humanoid skeleton. The body and each clothing
// layer (shirt, waistcoat, long coat with skirts, breeches, stockings, boots, sash, baldric, hats, hair,
// beards, dresses) are lofted along the bones in bind pose and auto-skinned with smooth distance-based
// weights, so coat skirts swing with the thighs and sleeves bend at the elbow. Animation is keyframed
// into THREE.AnimationClips and blended by an AnimationMixer with separate upper/lower-body layers.
import * as THREE from 'three';

// ---------------------------------------------------------------- skeleton (bind pose, metres, facing -Z)
// Character's right side is +X (viewed from behind, as the camera sees them).
const J = {
  hips: [0, 0.97, 0], spine: [0, 1.08, 0], chest: [0, 1.24, 0], neck: [0, 1.45, 0], head: [0, 1.56, 0], headTop: [0, 1.81, 0],
  clavR: [0.03, 1.41, 0], shoulderR: [0.19, 1.415, 0.005], elbowR: [0.235, 1.14, 0.025], wristR: [0.262, 0.895, 0.0], fingerR: [0.27, 0.72, -0.012],
  clavL: [-0.03, 1.41, 0], shoulderL: [-0.19, 1.415, 0.005], elbowL: [-0.235, 1.14, 0.025], wristL: [-0.262, 0.895, 0.0], fingerL: [-0.27, 0.72, -0.012],
  hipR: [0.095, 0.93, 0], kneeR: [0.1, 0.52, -0.012], ankleR: [0.1, 0.095, 0.03], toeR: [0.1, 0.03, -0.14],
  hipL: [-0.095, 0.93, 0], kneeL: [-0.1, 0.52, -0.012], ankleL: [-0.1, 0.095, 0.03], toeL: [-0.1, 0.03, -0.14],
};
const V = (k) => new THREE.Vector3(...J[k]);

// bone: [name, parent, head joint, tail joint]
const BONES = [
  ['hips', null, 'hips', 'spine'],
  ['spine', 'hips', 'spine', 'chest'],
  ['chest', 'spine', 'chest', 'neck'],
  ['neck', 'chest', 'neck', 'head'],
  ['head', 'neck', 'head', 'headTop'],
  ['clavicle_R', 'chest', 'clavR', 'shoulderR'],
  ['upperArm_R', 'clavicle_R', 'shoulderR', 'elbowR'],
  ['foreArm_R', 'upperArm_R', 'elbowR', 'wristR'],
  ['hand_R', 'foreArm_R', 'wristR', 'fingerR'],
  ['clavicle_L', 'chest', 'clavL', 'shoulderL'],
  ['upperArm_L', 'clavicle_L', 'shoulderL', 'elbowL'],
  ['foreArm_L', 'upperArm_L', 'elbowL', 'wristL'],
  ['hand_L', 'foreArm_L', 'wristL', 'fingerL'],
  ['upperLeg_R', 'hips', 'hipR', 'kneeR'],
  ['lowerLeg_R', 'upperLeg_R', 'kneeR', 'ankleR'],
  ['foot_R', 'lowerLeg_R', 'ankleR', 'toeR'],
  ['upperLeg_L', 'hips', 'hipL', 'kneeL'],
  ['lowerLeg_L', 'upperLeg_L', 'kneeL', 'ankleL'],
  ['foot_L', 'lowerLeg_L', 'ankleL', 'toeL'],
];
const BI = Object.fromEntries(BONES.map((b, i) => [b[0], i]));
const SEGS = BONES.map(([, , h, t]) => [V(h), V(t)]);

function makeSkeleton() {
  const bones = [];
  for (const [name, parent, head] of BONES) {
    const b = new THREE.Bone();
    b.name = name;
    const p = V(head);
    if (parent) {
      const pp = V(BONES[BI[parent]][2]);
      b.position.copy(p.sub(pp));
      bones[BI[parent]].add(b);
    } else b.position.copy(p);
    bones.push(b);
  }
  return bones;
}

// ---------------------------------------------------------------- auto skinning
const _ab = new THREE.Vector3(), _ap = new THREE.Vector3();
function segDist(p, a, b) {
  _ab.subVectors(b, a);
  _ap.subVectors(p, a);
  const t = Math.max(0, Math.min(1, _ap.dot(_ab) / _ab.lengthSq()));
  return Math.sqrt(_ap.sub(_ab.multiplyScalar(t)).lengthSq());
}
function weightsFor(p, allowed, out) {
  const cand = [];
  for (const name of allowed) {
    const i = BI[name];
    const d = segDist(p, SEGS[i][0], SEGS[i][1]);
    cand.push([i, 1 / Math.pow(d + 0.012, 5)]);
  }
  cand.sort((a, b) => b[1] - a[1]);
  const top = cand.slice(0, 4);
  let sum = 0;
  for (const c of top) sum += c[1];
  for (let k = 0; k < 4; k++) {
    out.idx[k] = top[k] ? top[k][0] : 0;
    out.w[k] = top[k] ? top[k][1] / sum : 0;
  }
  return out;
}

// ---------------------------------------------------------------- mesh builder
class Parts {
  constructor() { this.pos = []; this.col = []; this.si = []; this.sw = []; this.idx = []; this.nrm = []; }

  // Append an indexed geometry (already in bind-pose model space) with a colour function and skinning.
  add(geo, color, allowed, rigid = null) {
    if (!geo.index) geo = mergeVertices(geo);
    geo.computeVertexNormals();
    const p = geo.attributes.position, n = geo.attributes.normal;
    const base = this.pos.length / 3;
    const c = new THREE.Color();
    const tmp = { idx: [0, 0, 0, 0], w: [0, 0, 0, 0] };
    const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      this.pos.push(v.x, v.y, v.z);
      this.nrm.push(n.getX(i), n.getY(i), n.getZ(i));
      if (typeof color === 'function') c.set(color(v, i)); else c.set(color);
      this.col.push(c.r, c.g, c.b);
      if (rigid) { this.si.push(BI[rigid], 0, 0, 0); this.sw.push(1, 0, 0, 0); }
      else {
        weightsFor(v, allowed, tmp);
        this.si.push(...tmp.idx); this.sw.push(...tmp.w);
      }
    }
    const ix = geo.index.array;
    for (let i = 0; i < ix.length; i++) this.idx.push(ix[i] + base);
  }

  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(this.si, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(this.sw, 4));
    g.setIndex(this.idx);
    return g;
  }
}

function mergeVertices(geo) {
  // minimal weld for primitive geometries that arrive non-indexed
  const g = geo.index ? geo : geo;
  if (g.index) return g;
  const n = g.attributes.position.count;
  const idx = [];
  for (let i = 0; i < n; i++) idx.push(i);
  g.setIndex(idx);
  return g;
}

// Tube lofted through stations: [{c: Vector3, rx, rz}] with optional arc (skirt openings) and caps.
function loft(stations, { seg = 14, arc = [0, Math.PI * 2], capStart = false, capEnd = false, shift = null } = {}) {
  const pos = [], idx = [];
  const closed = arc[1] - arc[0] >= Math.PI * 2 - 1e-6;
  const ringN = closed ? seg : seg + 1;
  const Z = new THREE.Vector3(0, 0, 1), X = new THREE.Vector3(1, 0, 0);
  const t = new THREE.Vector3(), side = new THREE.Vector3(), front = new THREE.Vector3(), q = new THREE.Vector3();
  stations.forEach((s, i) => {
    const a = stations[Math.max(0, i - 1)].c, b = stations[Math.min(stations.length - 1, i + 1)].c;
    t.subVectors(b, a).normalize();
    if (Math.abs(t.z) < 0.9) side.crossVectors(t, Z).normalize(); else side.copy(X);
    if (side.x < 0) side.negate();
    front.crossVectors(side, t).normalize();
    if (Math.abs(t.z) < 0.9 && front.z > 0) front.negate(); // keep "front" pointing -Z (character forward)
    for (let k = 0; k < ringN; k++) {
      const th = arc[0] + (k / seg) * (arc[1] - arc[0]);
      // th=0 → character's right (+X), th=PI/2 → front (-Z)
      const rx = s.rx * (s.fx ? s.fx(th) : 1), rz = s.rz * (s.fz ? s.fz(th) : 1);
      q.copy(s.c).addScaledVector(side, Math.cos(th) * rx).addScaledVector(front, Math.sin(th) * rz);
      if (shift) shift(q, th, i);
      pos.push(q.x, q.y, q.z);
    }
  });
  for (let i = 0; i < stations.length - 1; i++) {
    for (let k = 0; k < seg; k++) {
      const a = i * ringN + k, b = i * ringN + ((k + 1) % ringN), c = a + ringN, d = b + ringN;
      idx.push(a, c, b, b, c, d);
    }
  }
  const addCap = (ringStart, center, flip) => {
    const ci = pos.length / 3;
    pos.push(center.x, center.y, center.z);
    for (let k = 0; k < seg; k++) {
      const a = ringStart + k, b = ringStart + ((k + 1) % ringN);
      if (flip) idx.push(ci, b, a); else idx.push(ci, a, b);
    }
  };
  if (capStart) addCap(0, stations[0].c.clone().add(stations[0].capOff || new THREE.Vector3()), true);
  if (capEnd) addCap((stations.length - 1) * ringN, stations[stations.length - 1].c.clone().add(stations[stations.length - 1].capOff || new THREE.Vector3()), false);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

const lerpV = (a, b, t) => a.clone().lerp(b, t);
const st = (c, rx, rz, extra = {}) => ({ c, rx, rz, ...extra });

function limbStations(a, b, c, radii, n = 4) {
  // radii: [start, mid1, joint, mid2, end]
  const out = [];
  const A = V(a), B = V(b), C = V(c);
  for (let i = 0; i <= n; i++) { const t = i / n; const r = radii[0] + (radii[1] - radii[0]) * t; out.push(st(lerpV(A, B, t), r, r * 0.92)); }
  for (let i = 1; i <= n; i++) { const t = i / n; const r = radii[1] + (radii[2] - radii[1]) * t; out.push(st(lerpV(B, C, t), r, r * 0.92)); }
  return out;
}

const ARM_R = ['clavicle_R', 'upperArm_R', 'foreArm_R', 'hand_R', 'chest'];
const ARM_L = ['clavicle_L', 'upperArm_L', 'foreArm_L', 'hand_L', 'chest'];
const LEG_R = ['hips', 'upperLeg_R', 'lowerLeg_R', 'foot_R'];
const LEG_L = ['hips', 'upperLeg_L', 'lowerLeg_L', 'foot_L'];
const TORSO = ['hips', 'spine', 'chest', 'neck', 'clavicle_R', 'clavicle_L', 'upperArm_R', 'upperArm_L', 'upperLeg_R', 'upperLeg_L'];

function torsoStations(inflate = 0, top = 1.43, bottom = 0.84, female = false) {
  const rows = [
    [0.84, 0.165, 0.115, 0.0], [0.93, 0.16, 0.11, 0.0], [1.02, 0.145, 0.1, -0.005], [1.1, 0.148, 0.102, -0.01],
    [1.2, female ? 0.155 : 0.168, female ? 0.118 : 0.112, -0.015], [1.3, 0.178, 0.112, -0.012], [1.37, 0.175, 0.1, -0.005],
    [1.42, 0.13, 0.085, 0.0], [1.46, 0.065, 0.06, 0.01],
  ].filter((r) => r[0] >= bottom - 1e-6 && r[0] <= top + 1e-6);
  return rows.map(([y, rx, rz, dz]) => st(new THREE.Vector3(0, y, dz), rx + inflate, rz + inflate));
}

// ---------------------------------------------------------------- building one character
function buildGeometry(L) {
  const P = new Parts();
  const skin = L.skin;
  const female = !!L.dress;

  // --- head (rigid to head bone): skull, jaw, nose, ears, eyes, brows
  const head = new THREE.SphereGeometry(1, 22, 18);
  {
    const p = head.attributes.position;
    const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      let sx = 0.092, sy = 0.118, sz = 0.105;
      if (v.y < 0) { const k = 1 + v.y * 0.28; sx *= k; sz *= 1 + v.y * 0.05; } // jaw narrows
      if (v.z < 0 && v.y < 0.2 && v.y > -0.7) sz *= 1.04; // face plane
      p.setXYZ(i, v.x * sx, 1.665 + v.y * sy, v.z * sz - 0.005);
    }
  }
  P.add(head, skin, null, 'head');
  const nose = new THREE.ConeGeometry(0.018, 0.05, 6); nose.rotateX(-Math.PI / 2 - 0.35); nose.translate(0, 1.655, -0.112);
  P.add(nose, skin, null, 'head');
  for (const s of [-1, 1]) {
    const ear = new THREE.SphereGeometry(0.022, 8, 6); ear.scale(0.5, 1.2, 0.9); ear.translate(s * 0.093, 1.665, 0.005);
    P.add(ear, skin, null, 'head');
    const eye = new THREE.SphereGeometry(0.014, 8, 6); eye.translate(s * 0.036, 1.685, -0.093);
    P.add(eye, '#f2efe8', null, 'head');
    const iris = new THREE.SphereGeometry(0.0085, 8, 6); iris.translate(s * 0.036, 1.685, -0.105);
    P.add(iris, '#2a1c12', null, 'head');
    const brow = new THREE.BoxGeometry(0.038, 0.008, 0.012); brow.rotateZ(s * -0.12); brow.translate(s * 0.037, 1.708, -0.1);
    P.add(brow, L.hair, null, 'head');
  }
  const mouth = new THREE.BoxGeometry(0.036, 0.006, 0.01); mouth.translate(0, 1.617, -0.1);
  P.add(mouth, '#6a3a2e', null, 'head');

  // hair
  if (L.hat !== 'bonnet' && L.hat !== 'headwrap') {
    const hair = new THREE.SphereGeometry(0.103, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.52);
    hair.scale(1, 1.08, 1.06); hair.translate(0, 1.672, 0.006);
    P.add(hair, L.hair, null, 'head');
  }
  if (!female && L.queue !== false) {
    const q = new THREE.CylinderGeometry(0.018, 0.012, 0.2, 6); q.rotateX(0.25); q.translate(0, 1.56, 0.1);
    P.add(q, L.hair, null, 'head');
  }
  if (female) {
    const long = new THREE.CylinderGeometry(0.09, 0.075, 0.22, 12, 1, true, Math.PI * 0.25, Math.PI * 1.5); long.translate(0, 1.6, 0.015);
    P.add(long, L.hair, ['head', 'neck', 'chest'], null);
  }
  if (L.beard) {
    const b = new THREE.SphereGeometry(0.075, 12, 8, 0, Math.PI * 2, Math.PI * 0.5, Math.PI * 0.5);
    b.scale(1.05, 0.9, 1.05); b.translate(0, 1.64, -0.02);
    P.add(b, L.beard, null, 'head');
    const m = new THREE.BoxGeometry(0.06, 0.012, 0.02); m.translate(0, 1.628, -0.105);
    P.add(m, L.beard, null, 'head');
  }

  // hats
  const hc = L.hatColor;
  if (L.hat === 'tricorne') {
    // brim cocked up on three sides
    const brim = new THREE.CylinderGeometry(0.2, 0.2, 0.012, 36, 1);
    const p = brim.attributes.position; const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      const r = Math.hypot(v.x, v.z), a = Math.atan2(v.x, -v.z);
      const cock = Math.pow(Math.abs(Math.cos(a * 1.5)), 0.6) * Math.max(0, (r - 0.08) / 0.12);
      p.setXYZ(i, v.x, v.y + cock * 0.085, v.z);
    }
    brim.translate(0, 1.765, 0.01);
    P.add(brim, hc, null, 'head');
    const crown = new THREE.SphereGeometry(0.1, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.5); crown.scale(1.02, 0.85, 1.06); crown.translate(0, 1.765, 0.01);
    P.add(crown, hc, null, 'head');
    if (L.trim) {
      const band = new THREE.TorusGeometry(0.1, 0.006, 4, 24); band.rotateX(Math.PI / 2); band.translate(0, 1.775, 0.01);
      P.add(band, L.trim, null, 'head');
    }
  } else if (L.hat === 'bandana' || L.hat === 'headwrap') {
    const band = new THREE.SphereGeometry(0.108, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.55); band.scale(1, 1.05, 1.07); band.translate(0, 1.668, 0.004);
    P.add(band, hc, null, 'head');
    const knot = new THREE.ConeGeometry(0.03, 0.12, 5); knot.rotateX(Math.PI * 0.62); knot.translate(0.02, 1.64, 0.12);
    P.add(knot, hc, null, 'head');
  } else if (L.hat === 'straw') {
    const brim = new THREE.CylinderGeometry(0.24, 0.26, 0.012, 24); brim.translate(0, 1.75, 0.01);
    P.add(brim, hc, null, 'head');
    const crown = new THREE.CylinderGeometry(0.085, 0.1, 0.1, 16); crown.translate(0, 1.8, 0.01);
    P.add(crown, hc, null, 'head');
  } else if (L.hat === 'bonnet') {
    const b = new THREE.SphereGeometry(0.115, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.62); b.scale(1, 1.02, 1.1); b.translate(0, 1.672, 0.012);
    P.add(b, hc, null, 'head');
  }

  // --- neck
  P.add(loft([st(new THREE.Vector3(0, 1.4, 0.005), 0.052, 0.05), st(new THREE.Vector3(0, 1.6, 0.012), 0.047, 0.047)], { seg: 10 }), skin, ['neck', 'head', 'chest']);

  // --- torso: shirt (or bodice) with a waistcoat front and cravat
  const shirt = L.shirt, vest = L.vest || L.shirt;
  const torsoCol = (v) => {
    if (female) return L.bodice;
    const front = -v.z > Math.abs(v.x) * 0.9;
    if (L.coat && front && v.y < 1.36) return vest;
    return shirt;
  };
  P.add(loft(torsoStations(0, 1.46, 0.84, female), { seg: 18 }), torsoCol, TORSO);
  // cravat / neckcloth
  const crav = new THREE.BoxGeometry(0.07, 0.07, 0.03); crav.translate(0, 1.4, -0.085);
  P.add(crav, female ? L.shirt : '#f1ece0', ['chest', 'neck']);
  // waistcoat buttons
  if (L.coat && !female) for (let i = 0; i < 6; i++) {
    const b = new THREE.SphereGeometry(0.008, 5, 4); b.translate(0, 1.02 + i * 0.055, -0.114 + i * 0.001);
    P.add(b, L.trim || '#b8942a', ['spine', 'chest']);
  }

  // --- long coat: shell over the torso, open at the front, with skirts to the knee
  if (L.coat && !female) {
    const openFront = [Math.PI * 0.5 + 0.32, Math.PI * 2.5 - 0.32]; // leave the front open to show the waistcoat
    P.add(loft(torsoStations(0.014, 1.43, 0.93), { seg: 18, arc: openFront }), L.coat, TORSO);
    if (L.coatLong) {
      const skirt = [];
      for (let i = 0; i <= 5; i++) {
        const t = i / 5; const y = 0.95 - t * 0.43;
        skirt.push(st(new THREE.Vector3(0, y, 0.01 + t * 0.03), 0.178 + t * 0.09, 0.128 + t * 0.07));
      }
      // skirts: weight to the thigh on each side so they swing as the character strides
      P.add(loft(skirt, { seg: 18, arc: openFront }), L.coat, ['hips', 'upperLeg_R', 'upperLeg_L']);
      // lapels / facings
      if (L.trim) for (const s of [-1, 1]) {
        const lap = new THREE.BoxGeometry(0.035, 0.45, 0.012); lap.translate(s * 0.07, 1.2, -0.118);
        P.add(lap, L.trim, ['spine', 'chest']);
      }
    }
    // coat buttons along the openings
    for (let i = 0; i < 5; i++) for (const s of [-1, 1]) {
      const b = new THREE.SphereGeometry(0.009, 5, 4); b.translate(s * 0.052, 1.0 + i * 0.075, -0.118);
      P.add(b, '#c9a13a', ['spine', 'chest']);
    }
  }

  // --- belt / sash / baldric
  if (!female) {
    P.add(loft([st(new THREE.Vector3(0, 0.95, 0), 0.165, 0.115), st(new THREE.Vector3(0, 1.0, -0.002), 0.158, 0.11)], { seg: 18 }), L.sash || '#3a2a1a', ['hips', 'spine']);
    const buckle = new THREE.BoxGeometry(0.05, 0.045, 0.01); buckle.translate(0, 0.975, -0.117);
    P.add(buckle, '#c9a13a', ['hips']);
  }
  if (L.crossbelt || L.baldric) {
    for (const s of L.crossbelt ? [-1, 1] : [1]) {
      const strap = new THREE.BoxGeometry(0.05, 0.62, 0.012);
      strap.rotateZ(s * 0.62); strap.translate(0, 1.18, -0.123);
      P.add(strap, L.crossbelt ? '#f0ece0' : '#4a3020', ['spine', 'chest']);
      const back = strap.clone(); back.translate(0, 0, 0.246);
      P.add(back, L.crossbelt ? '#f0ece0' : '#4a3020', ['spine', 'chest']);
    }
  }

  // --- arms: sleeves, cuffs and hands
  for (const s of ['R', 'L']) {
    const sx = s === 'R' ? 1 : -1;
    const sleeve = L.coat && !female ? L.coat : female ? L.shirt : L.shirt;
    const rolled = L.sleeves === 'rolled';
    const armSt = limbStations('shoulder' + s, 'elbow' + s, 'wrist' + s, [0.06, 0.047, 0.04], 4);
    armSt[0].c.x -= sx * 0.02; // tuck the shoulder into the torso
    const armCol = (v) => (rolled && v.y < 1.1 ? L.skin : sleeve);
    P.add(loft(armSt, { seg: 12 }), armCol, s === 'R' ? ARM_R : ARM_L);
    if (L.coat && !female) {
      // turned-back cuff
      const w = V('wrist' + s), e = V('elbow' + s);
      const cuff = loft([st(lerpV(e, w, 0.62), 0.058, 0.054), st(lerpV(e, w, 0.92), 0.062, 0.057)], { seg: 12 });
      P.add(cuff, L.trim || L.coat, s === 'R' ? ARM_R : ARM_L);
    } else if (!rolled) {
      const w = V('wrist' + s), e = V('elbow' + s);
      P.add(loft([st(lerpV(e, w, 0.85), 0.043, 0.041), st(lerpV(e, w, 1.02), 0.05, 0.047)], { seg: 10 }), '#f1ece0', s === 'R' ? ARM_R : ARM_L);
    }
    // hand: flattened palm/fingers and a thumb
    const W = V('wrist' + s), F = V('finger' + s);
    const handSt = [st(W.clone(), 0.033, 0.022), st(lerpV(W, F, 0.45), 0.045, 0.02), st(lerpV(W, F, 0.8), 0.04, 0.017), st(F.clone(), 0.02, 0.012)];
    P.add(loft(handSt, { seg: 10, capEnd: true }), L.skin, ['foreArm_' + s, 'hand_' + s]);
    const th = loft([st(lerpV(W, F, 0.15).add(new THREE.Vector3(0, 0, -0.025)), 0.014, 0.013), st(lerpV(W, F, 0.55).add(new THREE.Vector3(-sx * 0.01, 0, -0.045)), 0.01, 0.01)], { seg: 6, capEnd: true });
    P.add(th, L.skin, ['hand_' + s]);
  }

  // --- legs
  for (const s of ['R', 'L']) {
    const sx = s === 'R' ? 1 : -1;
    const legBones = s === 'R' ? LEG_R : LEG_L;
    const legSt = limbStations('hip' + s, 'knee' + s, 'ankle' + s, [0.092, 0.058, 0.04], 5);
    legSt[0].c.y += 0.03;
    legSt[0].c.x -= sx * 0.01;
    const knee = J['knee' + s][1];
    const bootTop = L.boots ? knee + 0.05 : -1;
    const legCol = (v) => {
      if (female) return '#e8e0d0';
      if (v.y > knee - 0.02) return L.breeches;
      if (v.y < bootTop) return L.shoes || '#2a1c12';
      return L.stockings || (L.slops ? L.breeches : L.skin);
    };
    if (L.slops) { legSt.forEach((q, i) => { if (i > 1) { q.rx *= 1.35; q.rz *= 1.35; } }); }
    if (L.boots) legSt.forEach((q) => { if (q.c.y < bootTop) { q.rx += 0.012; q.rz += 0.012; } });
    P.add(loft(legSt, { seg: 12 }), legCol, legBones);
    if (L.boots) {
      // folded boot tops, period "bucket" style
      const K = V('knee' + s);
      P.add(loft([st(K.clone().add(new THREE.Vector3(0, 0.02, 0)), 0.062, 0.062), st(K.clone().add(new THREE.Vector3(0, 0.1, 0.005)), 0.072, 0.07)], { seg: 12 }), L.shoes || '#2a1c12', legBones);
    } else if (!female && L.stockings) {
      // garter below the knee
      const K = V('knee' + s);
      P.add(loft([st(K.clone().add(new THREE.Vector3(0, -0.03, 0)), 0.056, 0.056), st(K.clone().add(new THREE.Vector3(0, -0.055, 0)), 0.055, 0.055)], { seg: 10 }), L.breeches, legBones);
    }
    // shoe
    const A = V('ankle' + s), T = V('toe' + s);
    const shoeSt = [
      st(A.clone().add(new THREE.Vector3(0, 0.02, 0.05)), 0.042, 0.045),
      st(lerpV(A, T, 0.3).setY(0.05), 0.046, 0.045),
      st(lerpV(A, T, 0.75).setY(0.035), 0.042, 0.03),
      st(T.clone().setY(0.03), 0.028, 0.022),
    ];
    const shoeCol = L.slops && !L.shoes ? L.skin : (L.shoes || '#2a1c12');
    P.add(loft(shoeSt, { seg: 10, capStart: true, capEnd: true }), shoeCol, [...legBones.slice(2)]);
    if (L.shoes && !L.boots && !L.slops) {
      const b = new THREE.BoxGeometry(0.045, 0.012, 0.03); b.translate(J['ankle' + s][0], 0.075, -0.055);
      P.add(b, '#c9b060', ['foot_' + s]);
    }
  }

  // --- dresses: petticoat skirt from the waist to the ankles, apron
  if (female) {
    const skirt = [];
    for (let i = 0; i <= 6; i++) {
      const t = i / 6; const y = 1.02 - t * 0.95;
      skirt.push(st(new THREE.Vector3(0, y, 0.01), 0.16 + t * 0.2 + Math.sin(t * Math.PI) * 0.02, 0.12 + t * 0.18));
    }
    P.add(loft(skirt, { seg: 22 }), L.dress, ['hips', 'upperLeg_R', 'upperLeg_L', 'lowerLeg_R', 'lowerLeg_L']);
    if (L.apron !== false) {
      const ap = [];
      for (let i = 0; i <= 4; i++) { const t = i / 4; ap.push(st(new THREE.Vector3(0, 1.0 - t * 0.6, 0.0), 0.172 + t * 0.14, 0.128 + t * 0.12)); }
      P.add(loft(ap, { seg: 10, arc: [Math.PI * 0.5 - 0.7, Math.PI * 0.5 + 0.7], shift: (q) => { q.z -= 0.012; } }), L.apron || '#ece6d8', ['hips', 'upperLeg_R', 'upperLeg_L']);
    }
  }
  return P.geometry();
}

// ---------------------------------------------------------------- animation clips
const E = (x = 0, y = 0, z = 0) => [x, y, z];
function clip(name, duration, keys, { hipsPos = null, loop = true } = {}) {
  // keys: array of [time, {bone: [x,y,z]}]
  const tracks = [];
  const bones = new Set();
  for (const [, pose] of keys) for (const b in pose) bones.add(b);
  const q = new THREE.Quaternion(), e = new THREE.Euler();
  for (const b of bones) {
    const times = [], vals = [];
    for (const [t, pose] of keys) {
      const r = pose[b] || [0, 0, 0];
      e.set(r[0], r[1], r[2], 'YXZ');
      q.setFromEuler(e);
      times.push(t); vals.push(q.x, q.y, q.z, q.w);
    }
    tracks.push(new THREE.QuaternionKeyframeTrack(`${b}.quaternion`, times, vals));
  }
  if (hipsPos) {
    const times = [], vals = [];
    for (const [t, off] of hipsPos) { times.push(t); vals.push(J.hips[0] + off[0], J.hips[1] + off[1], J.hips[2] + off[2]); }
    tracks.push(new THREE.VectorKeyframeTrack('hips.position', times, vals));
  }
  const c = new THREE.AnimationClip(name, duration, tracks);
  c.userData = { loop };
  return c;
}

const UPPER = new Set(['spine', 'chest', 'neck', 'head', 'clavicle_R', 'clavicle_L', 'upperArm_R', 'foreArm_R', 'hand_R', 'upperArm_L', 'foreArm_L', 'hand_L']);
function lowerOnly(c) {
  const tracks = c.tracks.filter((t) => !UPPER.has(t.name.split('.')[0]));
  return new THREE.AnimationClip(c.name + '_lower', c.duration, tracks);
}

// Arms hang at the sides slightly abducted: z on the right arm is +, left arm −.
function gaitKeys(amp, lean, bounce, armAmp, elbow) {
  // four keys of a stride: contact R, passing, contact L, passing
  const k = [];
  const legs = (s) => ({
    upperLeg_R: E(amp * s), upperLeg_L: E(-amp * s),
    lowerLeg_R: E(s > 0 ? -0.12 : -amp * 1.6), lowerLeg_L: E(s < 0 ? -0.12 : -amp * 1.6),
    foot_R: E(s > 0 ? -0.15 : 0.35 * amp), foot_L: E(s < 0 ? -0.15 : 0.35 * amp),
  });
  const pose = (s, passing) => {
    const base = passing ? {
      upperLeg_R: E(-0.08 * s), upperLeg_L: E(0.08 * s),
      lowerLeg_R: E(s > 0 ? -0.1 : -amp * 2.1), lowerLeg_L: E(s < 0 ? -0.1 : -amp * 2.1),
      foot_R: E(0.1), foot_L: E(0.1),
    } : legs(s);
    return {
      ...base,
      hips: E(0, 0.08 * s * (passing ? 0.3 : 1), 0),
      spine: E(-lean, -0.06 * s, 0),
      chest: E(0, -0.08 * s * (passing ? 0.3 : 1), 0),
      head: E(lean * 0.6, 0.1 * s * (passing ? 0.3 : 1), 0),
      upperArm_R: E(-armAmp * s * (passing ? 0.1 : 1), 0, 0.09), upperArm_L: E(armAmp * s * (passing ? 0.1 : 1), 0, -0.09),
      foreArm_R: E(elbow + (s < 0 ? elbow * 0.8 : 0)), foreArm_L: E(elbow + (s > 0 ? elbow * 0.8 : 0)),
    };
  };
  k.push([0, pose(1, false)], [0.25, pose(1, true)], [0.5, pose(-1, false)], [0.75, pose(-1, true)], [1, pose(1, false)]);
  return k;
}

let CLIPS = null;
export function characterClips() {
  if (CLIPS) return CLIPS;
  const scale = (keys, d) => keys.map(([t, p]) => [t * d, p]);
  const idle = clip('idle', 3.2, [
    [0, { spine: E(0.01), chest: E(0.0), upperArm_R: E(0.05, 0, 0.1), upperArm_L: E(0.05, 0, -0.1), foreArm_R: E(0.18), foreArm_L: E(0.18), head: E(0, 0.05) }],
    [1.6, { spine: E(-0.015), chest: E(0.035), upperArm_R: E(0.02, 0, 0.12), upperArm_L: E(0.02, 0, -0.12), foreArm_R: E(0.22), foreArm_L: E(0.22), head: E(0.03, -0.12) }],
    [3.2, { spine: E(0.01), chest: E(0.0), upperArm_R: E(0.05, 0, 0.1), upperArm_L: E(0.05, 0, -0.1), foreArm_R: E(0.18), foreArm_L: E(0.18), head: E(0, 0.05) }],
  ], { hipsPos: [[0, [0, 0, 0]], [1.6, [0.012, -0.008, 0]], [3.2, [0, 0, 0]]] });
  const walk = clip('walk', 1.05, scale(gaitKeys(0.42, 0.04, 0.03, 0.35, 0.2), 1.05), {
    hipsPos: [[0, [0, -0.02, 0]], [0.2625, [0, 0.015, 0]], [0.525, [0, -0.02, 0]], [0.7875, [0, 0.015, 0]], [1.05, [0, -0.02, 0]]],
  });
  const run = clip('run', 0.68, scale(gaitKeys(0.8, 0.22, 0.07, 0.8, 1.1), 0.68), {
    hipsPos: [[0, [0, -0.06, 0]], [0.17, [0, 0.03, 0]], [0.34, [0, -0.06, 0]], [0.51, [0, 0.03, 0]], [0.68, [0, -0.06, 0]]],
  });
  // overhead-to-cross cutlass slash (upper body only)
  const slash = clip('slash', 0.6, [
    [0, { chest: E(0, 0.1), upperArm_R: E(0.3, 0, 0.2), foreArm_R: E(0.6) }],
    [0.2, { chest: E(0.05, 0.5), spine: E(0, 0.15), upperArm_R: E(2.7, 0, 0.35), foreArm_R: E(0.9), upperArm_L: E(0.4, 0, -0.3), foreArm_L: E(0.6) }],
    [0.34, { chest: E(-0.12, -0.55), spine: E(-0.1, -0.2), upperArm_R: E(1.1, 0, -0.55), foreArm_R: E(0.15), upperArm_L: E(-0.2, 0, -0.35), foreArm_L: E(0.4) }],
    [0.6, { chest: E(0, 0.05), upperArm_R: E(0.35, 0, 0.15), foreArm_R: E(0.5), upperArm_L: E(0.05, 0, -0.12), foreArm_L: E(0.25) }],
  ], { loop: false });
  const aimPistol = clip('aimPistol', 1, [
    [0, { chest: E(0, 0.25), head: E(0, -0.2), upperArm_R: E(1.5, 0, 0.12), foreArm_R: E(0.05), upperArm_L: E(0.15, 0, -0.15), foreArm_L: E(0.9) }],
    [1, { chest: E(0.01, 0.25), head: E(0, -0.2), upperArm_R: E(1.5, 0, 0.12), foreArm_R: E(0.05), upperArm_L: E(0.15, 0, -0.15), foreArm_L: E(0.9) }],
  ]);
  const aimMusket = clip('aimMusket', 1, [
    [0, { chest: E(0, 0.35), head: E(0.1, -0.3), upperArm_R: E(1.25, 0, 0.55), foreArm_R: E(1.4), upperArm_L: E(1.35, 0, 0.1), foreArm_L: E(0.35) }],
    [1, { chest: E(0, 0.35), head: E(0.1, -0.3), upperArm_R: E(1.25, 0, 0.55), foreArm_R: E(1.4), upperArm_L: E(1.35, 0, 0.1), foreArm_L: E(0.35) }],
  ]);
  const carryMusket = clip('carryMusket', 1, [
    [0, { upperArm_R: E(0.15, 0, 0.08), foreArm_R: E(1.45), upperArm_L: E(0.1, 0, -0.08), foreArm_L: E(0.3) }],
    [1, { upperArm_R: E(0.15, 0, 0.08), foreArm_R: E(1.45), upperArm_L: E(0.1, 0, -0.08), foreArm_L: E(0.3) }],
  ]);
  const dig = clip('dig', 1.1, [
    [0, { spine: E(-0.1), chest: E(-0.1), upperArm_R: E(2.2, 0, -0.2), upperArm_L: E(2.2, 0, 0.2), foreArm_R: E(0.4), foreArm_L: E(0.4), upperLeg_R: E(0.3), upperLeg_L: E(0.3), lowerLeg_R: E(-0.5), lowerLeg_L: E(-0.5) }],
    [0.45, { spine: E(-0.55), chest: E(-0.3), upperArm_R: E(0.6, 0, -0.3), upperArm_L: E(0.6, 0, 0.3), foreArm_R: E(0.2), foreArm_L: E(0.2), upperLeg_R: E(0.55), upperLeg_L: E(0.55), lowerLeg_R: E(-0.9), lowerLeg_L: E(-0.9), foot_R: E(0.35), foot_L: E(0.35) }],
    [1.1, { spine: E(-0.1), chest: E(-0.1), upperArm_R: E(2.2, 0, -0.2), upperArm_L: E(2.2, 0, 0.2), foreArm_R: E(0.4), foreArm_L: E(0.4), upperLeg_R: E(0.3), upperLeg_L: E(0.3), lowerLeg_R: E(-0.5), lowerLeg_L: E(-0.5) }],
  ], { hipsPos: [[0, [0, -0.08, 0.02]], [0.45, [0, -0.2, 0.06]], [1.1, [0, -0.08, 0.02]]] });
  const hit = clip('hit', 0.4, [
    [0, {}],
    [0.1, { spine: E(0.25), chest: E(0.2, 0.2), head: E(0.3, -0.2), upperArm_R: E(0.6, 0, 0.5), upperArm_L: E(0.5, 0, -0.5) }],
    [0.4, {}],
  ], { loop: false });
  const death = clip('death', 1.3, [
    [0, {}],
    [0.25, { hips: E(0.1), spine: E(0.3), chest: E(0.2, 0.3), head: E(0.4), upperLeg_R: E(0.4), upperLeg_L: E(0.2), lowerLeg_R: E(-1.1), lowerLeg_L: E(-0.9), upperArm_R: E(0.9, 0, 0.6), upperArm_L: E(0.7, 0, -0.6) }],
    [0.7, { hips: E(0.9), spine: E(0.3), chest: E(0.1, 0.2), head: E(0.3, 0.3), upperLeg_R: E(0.7), upperLeg_L: E(0.3), lowerLeg_R: E(-0.9), lowerLeg_L: E(-0.4), upperArm_R: E(2.2, 0, 0.9), upperArm_L: E(1.8, 0, -1.0) }],
    [1.3, { hips: E(1.52), spine: E(0.05), chest: E(0, 0.15), head: E(-0.2, 0.6), upperLeg_R: E(0.35), upperLeg_L: E(0.1), lowerLeg_R: E(-0.5), lowerLeg_L: E(-0.1), upperArm_R: E(2.8, 0, 1.1), upperArm_L: E(2.5, 0, -1.2), foreArm_R: E(0.3), foreArm_L: E(0.5) }],
  ], { loop: false, hipsPos: [[0, [0, 0, 0]], [0.25, [0, -0.25, 0.05]], [0.7, [0, -0.6, 0.35]], [1.3, [0, -0.82, 0.55]]] });
  CLIPS = { idle, walk, run, slash, aimPistol, aimMusket, carryMusket, dig, hit, death };
  CLIPS.idle_lower = lowerOnly(idle);
  CLIPS.walk_lower = lowerOnly(walk);
  CLIPS.run_lower = lowerOnly(run);
  return CLIPS;
}

// ---------------------------------------------------------------- weapons (attached to the hand bones)
const weaponMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.75 });
function colorGeo(g, c) {
  g = g.index ? g.toNonIndexed() : g;
  const col = new THREE.Color(c); const n = g.attributes.position.count;
  const a = new Float32Array(n * 3); for (let i = 0; i < n; i++) { a[i * 3] = col.r; a[i * 3 + 1] = col.g; a[i * 3 + 2] = col.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  if (g.attributes.uv) g.deleteAttribute('uv');
  return g;
}
const weaponCache = {};
export function weaponMesh(kind) {
  if (!weaponCache[kind]) {
    const parts = [];
    if (kind === 'cutlass') {
      // curved blade, brass hilt with a shell guard — the sailor's weapon of the age
      const blade = new THREE.BoxGeometry(0.032, 0.66, 0.006, 1, 8);
      const p = blade.attributes.position;
      for (let i = 0; i < p.count; i++) { const y = p.getY(i) + 0.33; p.setX(i, p.getX(i) + y * y * 0.12 - (y > 0.6 ? (p.getX(i) > 0 ? 0.012 : 0) : 0)); }
      blade.translate(0, -0.42, 0);
      parts.push(colorGeo(blade, '#cfd3d6'));
      const guard = new THREE.SphereGeometry(0.045, 8, 6, 0, Math.PI * 2, 0, Math.PI * 0.5); guard.rotateX(Math.PI); guard.scale(1, 0.5, 0.8); guard.translate(0, -0.075, 0);
      parts.push(colorGeo(guard, '#b8942a'));
      const grip = new THREE.CylinderGeometry(0.016, 0.018, 0.11, 6); grip.translate(0, -0.01, 0);
      parts.push(colorGeo(grip, '#2a1d12'));
    } else if (kind === 'pistol') {
      const barrel = new THREE.CylinderGeometry(0.012, 0.015, 0.3, 8); barrel.translate(0, -0.2, 0);
      parts.push(colorGeo(barrel, '#2e2e30'));
      const stock = new THREE.BoxGeometry(0.035, 0.16, 0.05); stock.rotateX(-0.5); stock.translate(0, -0.02, 0.03);
      parts.push(colorGeo(stock, '#5a3a22'));
      const lock = new THREE.BoxGeometry(0.02, 0.05, 0.03); lock.translate(0.02, -0.07, 0.0);
      parts.push(colorGeo(lock, '#8a8a8a'));
    } else if (kind === 'musket') {
      const barrel = new THREE.CylinderGeometry(0.012, 0.014, 1.05, 8); barrel.translate(0, -0.55, 0);
      parts.push(colorGeo(barrel, '#3a3a3c'));
      const stock = new THREE.BoxGeometry(0.045, 0.75, 0.07); stock.translate(0, -0.1, 0.012);
      parts.push(colorGeo(stock, '#5a3a22'));
      const butt = new THREE.BoxGeometry(0.05, 0.2, 0.12); butt.translate(0, 0.33, 0.03);
      parts.push(colorGeo(butt, '#5a3a22'));
      const bayonet = new THREE.BoxGeometry(0.01, 0.3, 0.01); bayonet.translate(0.018, -1.2, 0);
      parts.push(colorGeo(bayonet, '#cfd3d6'));
    } else if (kind === 'spade') {
      const shaft = new THREE.CylinderGeometry(0.015, 0.015, 0.9, 6); shaft.translate(0, -0.3, 0);
      parts.push(colorGeo(shaft, '#6a4a2a'));
      const blade = new THREE.BoxGeometry(0.16, 0.22, 0.01); blade.translate(0, -0.85, 0);
      parts.push(colorGeo(blade, '#7a7a7a'));
    }
    const g = new THREE.BufferGeometry();
    const merged = parts.length ? mergeGeos(parts) : g;
    weaponCache[kind] = merged;
  }
  const m = new THREE.Mesh(weaponCache[kind], weaponMat);
  m.castShadow = true;
  return m;
}
function mergeGeos(list) {
  let n = 0; for (const g of list) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3), col = new Float32Array(n * 3);
  let o = 0;
  for (const g of list) {
    if (!g.attributes.normal) g.computeVertexNormals();
    pos.set(g.attributes.position.array, o * 3); nrm.set(g.attributes.normal.array, o * 3); col.set(g.attributes.color.array, o * 3);
    o += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return out;
}

// ---------------------------------------------------------------- the rig instance
const bodyMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0.02 });
const geoCache = new Map();

export class CharacterRig {
  constructor(look) {
    const key = JSON.stringify(look);
    if (!geoCache.has(key)) geoCache.set(key, buildGeometry(look));
    const geo = geoCache.get(key);
    this.root = new THREE.Group();
    this.root.rotation.order = 'YXZ';
    const bones = makeSkeleton();
    this.bones = Object.fromEntries(bones.map((b) => [b.name, b]));
    this.mesh = new THREE.SkinnedMesh(geo, bodyMat);
    this.mesh.add(bones[0]);
    this.mesh.updateMatrixWorld(true);
    this.mesh.bind(new THREE.Skeleton(bones));
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.9, 0), 1.7);
    this.mesh.frustumCulled = true;
    this.root.add(this.mesh);

    // weapon sockets: grips sit in the palm, blade/barrel pointing along the fingers
    this.socketR = new THREE.Group();
    this.socketR.position.set(0, -0.085, -0.02);
    this.bones.hand_R.add(this.socketR);
    this.weapon = null;
    this.setWeapon(look.weapon);

    const C = characterClips();
    this.mixer = new THREE.AnimationMixer(this.root);
    this.actions = {};
    for (const [name, c] of Object.entries(C)) {
      const a = this.mixer.clipAction(c);
      if (c.userData?.loop === false) { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; }
      a.enabled = true;
      a.setEffectiveWeight(0);
      a.play();
      this.actions[name] = a;
    }
    this.actions.idle.setEffectiveWeight(1);
    this.actions.idle.time = Math.random() * 3;
    this.phase = Math.random();
    this.w = { upper: 0, aimP: 0, aimM: 0, carry: 0, slash: 0, dig: 0, dead: 0, hit: 0 };
    this.wasDead = false;
    this.lastHit = 0;
  }

  setWeapon(kind) {
    if (this.weaponKind === kind) return;
    this.weaponKind = kind;
    if (this.weapon) this.socketR.remove(this.weapon);
    this.weapon = kind ? weaponMesh(kind) : null;
    if (this.weapon) {
      this.weapon.rotation.set(kind === 'cutlass' ? 0.9 : kind === 'musket' ? Math.PI : 0.15, 0, 0);
      this.socketR.add(this.weapon);
    }
  }

  // st: { speed, attack (0..1 or -1), aim, weapon, dead, hitT, dig }
  update(dt, st) {
    const A = this.actions;
    const k = (rate) => 1 - Math.exp(-rate * dt);
    const towards = (key, target, rate = 10) => { this.w[key] += (target - this.w[key]) * k(rate); return this.w[key]; };

    // death takes over everything
    if (st.dead) {
      if (!this.wasDead) { A.death.reset(); A.death.play(); this.wasDead = true; }
      const d = towards('dead', 1, 14);
      for (const [n, a] of Object.entries(A)) if (n !== 'death') a.setEffectiveWeight(a.getEffectiveWeight() * (1 - d));
      A.death.setEffectiveWeight(d);
      this.mixer.update(dt);
      return;
    }
    if (this.wasDead) { this.wasDead = false; this.w.dead = 0; A.death.setEffectiveWeight(0); }

    // upper-body layer requests
    const slashing = st.attack >= 0;
    const aimP = st.aim && st.weapon !== 'musket';
    const aimM = st.aim && st.weapon === 'musket';
    const carry = !st.aim && st.weapon === 'musket';
    const dig = !!st.dig;
    const wSlash = towards('slash', slashing ? 1 : 0, 25);
    const wAimP = towards('aimP', aimP ? 1 : 0, 12);
    const wAimM = towards('aimM', aimM ? 1 : 0, 10);
    const wCarry = towards('carry', carry ? 1 : 0, 8);
    const wDig = towards('dig', dig ? 1 : 0, 8);
    const upper = Math.min(1, wSlash + wAimP + wAimM + wCarry);
    if (slashing) A.slash.time = Math.min(0.999, st.attack) * A.slash.getClip().duration;
    A.slash.setEffectiveWeight(wSlash);
    A.aimPistol.setEffectiveWeight(wAimP * (1 - wSlash));
    A.aimMusket.setEffectiveWeight(wAimM * (1 - wSlash));
    A.carryMusket.setEffectiveWeight(wCarry * (1 - wSlash) * (1 - wAimM));
    A.dig.setEffectiveWeight(wDig);

    // locomotion: idle / walk / run blended by speed, time-scaled to match the ground speed (no foot sliding)
    const s = st.speed || 0;
    const walkW = Math.max(0, Math.min(1, s / 1.4)) * (1 - Math.max(0, Math.min(1, (s - 2.6) / 2)));
    const runW = Math.max(0, Math.min(1, (s - 2.6) / 2));
    const idleW = Math.max(0, 1 - walkW - runW);
    const loco = 1 - wDig;
    A.walk.timeScale = s > 0.2 ? Math.max(0.5, s / 1.5) : 1;
    A.run.timeScale = Math.max(0.7, s / 5.2);
    A.walk_lower.timeScale = A.walk.timeScale;
    A.run_lower.timeScale = A.run.timeScale;
    // keep the lower-body copies in phase with the full clips
    A.walk_lower.time = A.walk.time; A.run_lower.time = A.run.time; A.idle_lower.time = A.idle.time;
    const full = loco * (1 - upper), low = loco * upper;
    A.idle.setEffectiveWeight(idleW * full); A.idle_lower.setEffectiveWeight(idleW * low);
    A.walk.setEffectiveWeight(walkW * full); A.walk_lower.setEffectiveWeight(walkW * low);
    A.run.setEffectiveWeight(runW * full); A.run_lower.setEffectiveWeight(runW * low);

    // hit flinch (additive-ish: brief blend)
    if (st.hitT > 0.95 && performance.now() - this.lastHit > 200) { this.lastHit = performance.now(); A.hit.reset(); A.hit.play(); }
    A.hit.setEffectiveWeight(st.hitT > 0 ? Math.min(0.6, st.hitT) : 0);

    this.mixer.update(dt);
    // aim pitch: tilt the aiming arm up/down
    if (st.aim && st.aimPitch) {
      this.bones.upperArm_R.rotateX(-st.aimPitch * 0.8);
      if (aimM) this.bones.upperArm_L.rotateX(-st.aimPitch * 0.8);
    }
  }

  dispose() {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.root);
    this.mesh.skeleton.dispose();
  }
}
