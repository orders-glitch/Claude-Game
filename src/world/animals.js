// Animals (Sketchfab; credits in public/models/animals/CREDITS.md): goats and donkeys wandering the
// towns, fiddler crabs on the beaches, gulls wheeling over the harbours, dolphins that come to ride the
// bow wave and turtles cruising the shallows. Everything is spawned around the camera and animated with
// its own clips; nothing far away is updated.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

// size: target height (land animals) or length (sea creatures / birds: 'len'); yaw: model forward fix
const SPECIES = {
  goat: { file: 'goat.glb', size: 0.85, walk: /walk_fwd_01/, idle: /rest_pose_scratch|idle_rest/, speed: 0.9 },
  donkey: { file: 'donkey.glb', size: 1.35, walk: /H_Walk$/, idle: /H_Idle_02/, speed: 1.0 },
  crab: { file: 'crab.glb', size: 0.07, idle: /Dance/, walk: /Dance/, speed: 0.35 },
  seagull: { file: 'seagull.glb', len: 0.55, fly: /Armature|Action/ },
  dolphin: { file: 'dolphin.glb', len: 2.6, swim: /Swim/ },
  turtle: { file: 'turtle.glb', len: 0.95, swim: /Swim/ },
};

const _v = new THREE.Vector3();

class Animal {
  constructor(lib, name, pos) {
    const S = lib.species[name];
    this.name = name;
    this.cfg = S.cfg;
    this.root = new THREE.Group();
    const model = SkeletonUtils.clone(S.scene);
    model.scale.setScalar(S.scale);
    model.position.y = S.groundY;
    model.rotation.y = S.yaw;
    model.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; } });
    this.root.add(model);
    this.mixer = new THREE.AnimationMixer(model);
    this.actions = {};
    for (const [k, re] of Object.entries(S.cfg)) {
      if (!(re instanceof RegExp)) continue;
      const clip = S.clips.find((c) => re.test(c.name));
      if (clip) { const a = this.mixer.clipAction(clip); a.play(); a.setEffectiveWeight(0); a.time = Math.random() * clip.duration; this.actions[k] = a; }
    }
    this.pos = pos.clone();
    this.yaw = Math.random() * Math.PI * 2;
    this.target = null;
    this.wait = Math.random() * 4;
    this.t = Math.random() * 100;
    this.w = { walk: 0 };
  }

  blend(dt, moving) {
    const k = 1 - Math.exp(-6 * dt);
    this.w.walk += ((moving ? 1 : 0) - this.w.walk) * k;
    if (this.actions.walk && this.actions.walk !== this.actions.idle) this.actions.walk.setEffectiveWeight(this.w.walk);
    if (this.actions.idle) this.actions.idle.setEffectiveWeight(this.actions.walk === this.actions.idle ? 1 : 1 - this.w.walk);
    for (const k2 of ['fly', 'swim']) if (this.actions[k2]) this.actions[k2].setEffectiveWeight(1);
  }
}

class Animals {
  constructor() { this.species = {}; this.list = []; }

  async load(base = './models/animals/') {
    const loader = new GLTFLoader();
    await Promise.all(Object.entries(SPECIES).map(async ([name, cfg]) => {
      try {
        const gltf = await loader.loadAsync(base + cfg.file);
        const scene = gltf.scene;
        scene.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(scene, true);
        const size = box.getSize(new THREE.Vector3());
        const scale = cfg.len ? cfg.len / Math.max(size.x, size.z) : cfg.size / size.y;
        this.species[name] = { scene, clips: gltf.animations, cfg, scale, groundY: -box.min.y * scale, yaw: cfg.yaw || 0 };
      } catch (e) { /* optional */ }
    }));
    return this;
  }

  init(scene, game) {
    this.scene = scene;
    this.game = game;
    this.town = null;
    this.crabT = 0;
    this.gullT = 0;
    this.seaT = 0;
  }

  spawn(name, pos) {
    if (!this.species[name]) return null;
    const a = new Animal(this, name, pos);
    this.scene.add(a.root);
    this.list.push(a);
    return a;
  }

  remove(a) { this.scene.remove(a.root); a.mixer.stopAllAction(); this.list = this.list.filter((x) => x !== a); }

  update(dt, camPos, focus, ocean, terrain) {
    if (!this.scene) return;
    const g = this.game;
    // --- town animals follow the town the camera is in
    const town = g.townList.find((t) => t.center.distanceTo(camPos) < t.R * 2);
    if (town !== this.town) {
      for (const a of this.list.filter((x) => x.town)) this.remove(a);
      this.town = town;
      if (town && town.streetNodes.length) {
        const kinds = town.port.style === 'shanty' ? ['goat', 'goat', 'goat', 'donkey'] : ['goat', 'goat', 'donkey', 'donkey'];
        for (const k of kinds) {
          const n = town.streetNodes[Math.floor(Math.random() * town.streetNodes.length)];
          const a = this.spawn(k, n);
          if (a) a.town = town;
        }
      }
    }
    // --- crabs on the beach near someone on foot
    this.crabT -= dt;
    if (this.crabT <= 0) {
      this.crabT = 2;
      const crabs = this.list.filter((x) => x.name === 'crab');
      for (const c of crabs) if (c.pos.distanceTo(focus) > 70) this.remove(c);
      if (g.mode === 'foot' && crabs.length < 8) {
        for (let k = 0; k < 6; k++) {
          const ang = Math.random() * Math.PI * 2, r = 12 + Math.random() * 40;
          const x = focus.x + Math.cos(ang) * r, z = focus.z + Math.sin(ang) * r;
          const h = terrain.height(x, z);
          if (h > 0.3 && h < 1.6) { this.spawn('crab', new THREE.Vector3(x, h, z)); break; }
        }
      }
    }
    // --- gulls over the nearest harbour
    this.gullT -= dt;
    if (this.gullT <= 0) {
      this.gullT = 3;
      const near = g.townList.find((t) => t.coast.distanceTo(camPos) < 900);
      const gulls = this.list.filter((x) => x.name === 'seagull');
      if (!near) for (const b of gulls) this.remove(b);
      else if (gulls.length < 9) {
        const c = near.toWorld((Math.random() - 0.5) * 120, -40 - Math.random() * 60, 0);
        const b = this.spawn('seagull', c);
        if (b) { b.orbit = { c, r: 18 + Math.random() * 35, h: 14 + Math.random() * 22, w: (Math.random() < 0.5 ? -1 : 1) * (0.25 + Math.random() * 0.2), a: Math.random() * 6.28 }; }
      }
    }
    // --- dolphins riding the player's bow wave, turtles in the shallows
    this.seaT -= dt;
    if (this.seaT <= 0) {
      this.seaT = 4;
      const ship = g.playerShip;
      const dol = this.list.filter((x) => x.name === 'dolphin');
      if (g.mode === 'sail' && ship && !dol.length && Math.random() < 0.08 && terrain.quickHeight(ship.position.x, ship.position.z) < -15 && Math.abs(ship.speed) > 2) {
        for (let k = 0; k < 3 + Math.floor(Math.random() * 3); k++) {
          const d = this.spawn('dolphin', ship.position.clone());
          if (d) { d.pod = { ship, side: (k % 2 ? 1 : -1) * (3 + Math.random() * 6), ahead: 4 + Math.random() * 18, life: 45 + Math.random() * 40, phase: Math.random() * 6 }; }
        }
      }
      for (const d of dol) if (d.pod && (d.pod.life <= 0 || g.mode !== 'sail')) this.remove(d);
      const tur = this.list.filter((x) => x.name === 'turtle');
      for (const t of tur) if (t.pos.distanceTo(camPos) > 260) this.remove(t);
      if (tur.length < 3) {
        for (let k = 0; k < 8; k++) {
          const ang = Math.random() * Math.PI * 2, r = 40 + Math.random() * 120;
          const x = camPos.x + Math.cos(ang) * r, z = camPos.z + Math.sin(ang) * r;
          const h = terrain.quickHeight(x, z);
          if (h < -2 && h > -12) { const t = this.spawn('turtle', new THREE.Vector3(x, -1.2, z)); if (t) t.depth = Math.min(-0.8, h + 1); break; }
        }
      }
    }

    for (const a of [...this.list]) {
      const d2 = a.pos.distanceToSquared(camPos);
      a.root.visible = d2 < 400 * 400;
      if (d2 > 450 * 450 && !a.pod) continue;
      a.t += dt;
      let moving = false;
      if (a.town || a.name === 'crab') {
        // wander: pick a nearby point, walk there, graze / sit a while
        if (!a.target) {
          a.wait -= dt;
          if (a.wait <= 0) {
            const r = a.name === 'crab' ? 3 : 14;
            const base = a.town && Math.random() < 0.3 ? a.town.streetNodes[Math.floor(Math.random() * a.town.streetNodes.length)] : a.pos;
            a.target = base.clone().add(_v.set((Math.random() - 0.5) * r * 2, 0, (Math.random() - 0.5) * r * 2));
          }
        } else {
          const dx = a.target.x - a.pos.x, dz = a.target.z - a.pos.z, dl = Math.hypot(dx, dz);
          if (dl < 0.4 || g.blockedAt?.(a.pos.x + dx / dl, a.pos.z + dz / dl, 0.3, a.pos.y)) { a.target = null; a.wait = 2 + Math.random() * (a.name === 'crab' ? 3 : 10); }
          else {
            const sp = a.cfg.speed;
            if (a.name === 'crab') { a.pos.x += dx / dl * sp * dt; a.pos.z += dz / dl * sp * dt; a.yaw = Math.atan2(dz, -dx); } // crabs go sideways
            else {
              const want = Math.atan2(dx, dz);
              let dy = want - a.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
              a.yaw += dy * Math.min(1, dt * 3);
              a.pos.x += Math.sin(a.yaw) * sp * dt; a.pos.z += Math.cos(a.yaw) * sp * dt;
            }
            moving = true;
          }
        }
        a.pos.y = g.groundAt(a.pos.x, a.pos.z);
        if (a.name === 'crab' && a.pos.y < 0.2) { a.target = null; a.pos.y = 0.2; }
        a.root.position.copy(a.pos);
        a.root.rotation.set(0, a.yaw, 0);
      } else if (a.orbit) {
        const o = a.orbit;
        o.a += o.w * dt;
        a.pos.set(o.c.x + Math.cos(o.a) * o.r, o.h + Math.sin(a.t * 0.5) * 2, o.c.z + Math.sin(o.a) * o.r);
        a.root.position.copy(a.pos);
        a.root.rotation.set(0, -o.a + (o.w > 0 ? 0 : Math.PI), Math.sign(o.w) * -0.25);
      } else if (a.pod) {
        // ride alongside the bow; porpoise in shallow arcs
        const P = a.pod, s = P.ship;
        P.life -= dt;
        const tgt = s.position.clone().addScaledVector(s.forward, s.cls.length * 0.5 + P.ahead).addScaledVector(s.right, P.side);
        tgt.addScaledVector(s.right, Math.sin(a.t * 0.4 + P.phase) * 2).addScaledVector(s.forward, Math.sin(a.t * 0.3 + P.phase * 2) * 3);
        a.pos.x += (tgt.x - a.pos.x) * (1 - Math.exp(-dt * 2.5));
        a.pos.z += (tgt.z - a.pos.z) * (1 - Math.exp(-dt * 2.5));
        const arc = Math.sin(a.t * 1.6 + P.phase);
        a.pos.y = arc > 0.3 ? (arc - 0.3) * 2.6 - 0.45 : -0.75 + arc * 0.3;
        const heading = Math.atan2(s.forward.x, s.forward.z);
        a.root.position.copy(a.pos);
        a.root.rotation.set(-Math.cos(a.t * 1.6 + P.phase) * (arc > 0.4 ? 0.5 : 0.15), heading, 0, 'YXZ');
      } else if (a.name === 'turtle') {
        if (!a.dir) a.dir = Math.random() * 6.28;
        a.dir += Math.sin(a.t * 0.2) * dt * 0.3;
        a.pos.x += Math.sin(a.dir) * 0.6 * dt; a.pos.z += Math.cos(a.dir) * 0.6 * dt;
        a.pos.y = (a.depth ?? -1.2) + Math.sin(a.t * 0.15) * 0.4;
        a.root.position.copy(a.pos);
        a.root.rotation.set(0, a.dir, 0);
      }
      a.blend(dt, moving);
      a.mixer.update(dt * (a.name === 'crab' && !moving ? 0.3 : 1));
    }
  }
}

export const animals = new Animals();
