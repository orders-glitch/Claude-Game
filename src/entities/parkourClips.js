// Free-running clips the animation libraries don't have, posed here on the same 65-bone skeleton: climbing a
// wall hand over hand, hanging from a ledge, and shimmying along it. Each key pose is written as directions
// for the limbs in the character's own frame (x to its left, y up, z forward, toward the wall); a probe
// skeleton is set to the idle pose, each limb is swung to point that way, and the resulting local rotations
// of every bone become the keyframes. No bone axis conventions needed.
import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

const _v0 = new THREE.Vector3(), _v1 = new THREE.Vector3(), _q0 = new THREE.Quaternion(), _q1 = new THREE.Quaternion();

// key poses: bone -> direction toward its child, in the character frame [left, up, forward]
const ARM = (side, upper, lower) => ({ ['upperarm_' + side]: upper, ['lowerarm_' + side]: lower });
const LEG = (side, thigh, calf, foot) => ({ ['thigh_' + side]: thigh, ['calf_' + side]: calf, ...(foot ? { ['foot_' + side]: foot } : {}) });
const POSES = {
  // left hand high, right hand at the face; right knee up on a foothold, left leg pushing
  climbA: { spine_01: [0, 1, 0.12], ...ARM('l', [0.25, 0.9, 0.35], [0.05, 1, 0.3]), ...ARM('r', [-0.45, 0.35, 0.8], [-0.15, 0.9, 0.45]), ...LEG('r', [-0.12, -0.25, 0.95], [0, -1, 0.05], [0, -0.3, 1]), ...LEG('l', [0.1, -1, 0.12], [0, -1, 0.25], [0, -0.3, 1]), neck_01: [0, 0.75, 0.65] },
  // the mirror: right hand high, left knee up
  climbB: { spine_01: [0, 1, 0.12], ...ARM('r', [-0.25, 0.9, 0.35], [-0.05, 1, 0.3]), ...ARM('l', [0.45, 0.35, 0.8], [0.15, 0.9, 0.45]), ...LEG('l', [0.12, -0.25, 0.95], [0, -1, 0.05], [0, -0.3, 1]), ...LEG('r', [-0.1, -1, 0.12], [0, -1, 0.25], [0, -0.3, 1]), neck_01: [0, 0.75, 0.65] },
  // hanging from the ledge by both hands, legs hanging, a slight swing
  hangA: { spine_01: [0, 1, 0.05], ...ARM('l', [0.2, 1, 0.25], [0.1, 1, 0.2]), ...ARM('r', [-0.2, 1, 0.25], [-0.1, 1, 0.2]), ...LEG('l', [0.08, -1, 0.18], [0, -1, 0.05]), ...LEG('r', [-0.08, -1, 0.1], [0, -1, 0.12]), neck_01: [0, 0.6, 0.8] },
  hangB: { spine_01: [0, 1, 0.08], ...ARM('l', [0.2, 1, 0.28], [0.1, 1, 0.22]), ...ARM('r', [-0.2, 1, 0.28], [-0.1, 1, 0.22]), ...LEG('l', [0.08, -1, 0.26], [0, -1, 0.1]), ...LEG('r', [-0.08, -1, 0.2], [0, -1, 0.18]), neck_01: [0, 0.6, 0.8] },
  // shimmying to the left: hands apart, then together
  shimA: { spine_01: [0, 1, 0.05], ...ARM('l', [0.55, 0.85, 0.25], [0.3, 1, 0.2]), ...ARM('r', [-0.1, 1, 0.25], [0, 1, 0.2]), ...LEG('l', [0.2, -1, 0.15], [0.05, -1, 0.05]), ...LEG('r', [-0.02, -1, 0.15], [0, -1, 0.1]), neck_01: [0.25, 0.6, 0.75] },
  shimB: { spine_01: [0, 1, 0.05], ...ARM('l', [0.25, 1, 0.25], [0.1, 1, 0.2]), ...ARM('r', [0.05, 1, 0.25], [0.05, 1, 0.2]), ...LEG('l', [0.08, -1, 0.15], [0, -1, 0.1]), ...LEG('r', [0.02, -1, 0.15], [0, -1, 0.05]), neck_01: [0.25, 0.6, 0.75] },
};
// shimmying right is the mirror image of shimmying left
const mirror = (spec) => Object.fromEntries(Object.entries(spec).map(([k, [x, y, z]]) => [k.replace(/_l$/, '_R').replace(/_r$/, '_l').replace(/_R$/, '_r'), [-x, y, z]]));
POSES.shimRA = mirror(POSES.shimA);
POSES.shimRB = mirror(POSES.shimB);
// parents before children, so each limb is swung after the one it hangs from
const ORDER = ['spine_01', 'upperarm_l', 'lowerarm_l', 'upperarm_r', 'lowerarm_r', 'thigh_l', 'calf_l', 'foot_l', 'thigh_r', 'calf_r', 'foot_r', 'neck_01'];

export function buildParkourClips(skeletonScene, baseClip) {
  const probe = SkeletonUtils.clone(skeletonScene);
  // the joints: every node the idle clip animates (the skeleton file carries plain nodes, not Bones)
  const animated = new Set(baseClip.tracks.map((t) => t.name.split('.')[0]));
  const bones = [];
  probe.traverse((o) => { if (animated.has(o.name)) bones.push(o); });
  const get = (n) => probe.getObjectByName(n);
  // the idle pose's first frame is the base every key starts from
  const mixer = new THREE.AnimationMixer(probe);
  mixer.clipAction(baseClip).play();
  mixer.update(0);
  probe.updateMatrixWorld(true);
  const base = bones.map((b) => b.quaternion.clone());
  // the character's frame, read off the skeleton itself
  const w = (n) => get(n).getWorldPosition(new THREE.Vector3());
  const left = w('thigh_l').sub(w('thigh_r')).setY(0).normalize();
  const up = new THREE.Vector3(0, 1, 0);
  const fwd = new THREE.Vector3().crossVectors(left, up).normalize(); // left x up points forward for a +Y-up, right-handed frame
  if (w('ball_l').sub(w('foot_l')).dot(fwd) < 0) fwd.negate();
  const toWorld = ([x, y, z]) => new THREE.Vector3().addScaledVector(left, x).addScaledVector(up, y).addScaledVector(fwd, z).normalize();

  const point = (b, dir) => {
    const child = b.children.find((c) => animated.has(c.name) && !/leaf/.test(c.name)) || b.children.find((c) => animated.has(c.name));
    if (!child) return;
    b.updateWorldMatrix(true, true);
    const cur = child.getWorldPosition(_v1).sub(b.getWorldPosition(_v0)).normalize();
    const delta = _q0.setFromUnitVectors(cur, dir);
    const wq = b.getWorldQuaternion(_q1);
    const target = delta.multiply(wq);
    const parentQ = b.parent.getWorldQuaternion(new THREE.Quaternion()).invert();
    b.quaternion.copy(parentQ.multiply(target));
    b.updateWorldMatrix(false, true);
  };
  const pose = (spec) => {
    bones.forEach((b, i) => b.quaternion.copy(base[i]));
    probe.updateMatrixWorld(true);
    for (const n of ORDER) if (spec[n]) { const b = get(n); if (b) point(b, toWorld(spec[n])); }
    return bones.map((b) => b.quaternion.clone());
  };
  const clip = (name, keys, dur) => {
    const poses = keys.map((k) => pose(POSES[k]));
    poses.push(poses[0]); // loop back to the first key
    const times = poses.map((_, i) => (i / (poses.length - 1)) * dur);
    const tracks = bones.map((b, bi) => {
      const v = [];
      for (const p of poses) v.push(p[bi].x, p[bi].y, p[bi].z, p[bi].w);
      return new THREE.QuaternionKeyframeTrack(b.name + '.quaternion', times, v);
    });
    return new THREE.AnimationClip(name, dur, tracks);
  };
  const out = {
    climb: clip('Climb_Loop', ['climbA', 'climbB'], 1.1),
    hang: clip('Hang_Loop', ['hangA', 'hangB'], 2.4),
    shimmyL: clip('ShimmyL_Loop', ['shimA', 'shimB'], 0.9),
    shimmyR: clip('ShimmyR_Loop', ['shimRA', 'shimRB'], 0.9),
  };
  mixer.stopAllAction();
  return out;
}
