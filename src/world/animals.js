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
  rooster: { file: 'rooster.glb', size: 0.42, walk: /chikWalk/, idle: /eat/, speed: 0.7 },
  pig: { file: 'pig.glb', size: 0.72, walk: /Take 001/, idle: /Take 001/, speed: 0.6 },
  cow: { file: 'cow.glb', size: 1.4, idle: /idle1/, speed: 0 },
  dog: { file: 'dog.glb', size: 0.55, walk: /walking_cycle/, idle: /standing_idle|sitting_idle/, speed: 1.3 },
  pelican: { file: 'pelican.glb', len: 1.15, idle: /idle_A/, speed: 0 },
  seagull: { file: 'seagull.glb', len: 0.55, fly: /Armature|Action/ },
  dolphin: { file: 'dolphin.glb', len: 2.6, swim: /Swim/ },
  turtle: { file: 'turtle.glb', len: 0.95, swim: /Swim/ },
};

const _v = new THREE.Vector3();

// who roams each town's streets (counts at high quality)
const TOWN_ANIMALS = {
  havana: { rooster: 12, dog: 5, pig: 3, goat: 3, donkey: 3, cow: 2 },
  portroyal: { rooster: 9, dog: 5, goat: 4, pig: 3, donkey: 2 },
  nassau: { pig: 8, goat: 6, rooster: 10, dog: 5, donkey: 1 },
  tortuga: { pig: 6, dog: 7, rooster: 8, goat: 4, cow: 2 },
};
const CARTS = { havana: 6, portroyal: 4, nassau: 1, tortuga: 2 };

// a two-wheeled mule cart with its load (the first child is the axle, which turns)
const _cartMats = {};
function cartMesh(i) {
  const M = (c) => _cartMats[c] || (_cartMats[c] = new THREE.MeshStandardMaterial({ color: c, roughness: 0.9 }));
  const g = new THREE.Group();
  const axle = new THREE.Group();
  axle.position.set(0, 0.62, 0.2);
  for (const s of [-1, 1]) {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.12, 14), M('#5a4028'));
    w.rotation.z = Math.PI / 2; w.position.x = s * 1.05;
    axle.add(w);
    for (let k = 0; k < 4; k++) { const sp = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.15, 0.06), M('#6a4a30')); sp.position.x = s * 1.05; sp.rotation.x = (k / 4) * Math.PI; axle.add(sp); }
  }
  g.add(axle);
  const bed = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.12, 2.6), M('#7a5a3a')); bed.position.set(0, 1.0, 0.1); g.add(bed);
  for (const s of [-1, 1]) { const side = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.45, 2.6), M('#6a4a30')); side.position.set(s * 0.9, 1.25, 0.1); g.add(side); }
  for (const s of [-0.45, 0.45]) { const sh = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 2.6), M('#6a4a30')); sh.position.set(s, 0.95, 2.4); sh.rotation.x = 0.12; g.add(sh); }
  const loads = [['#8a6a48', 'barrel'], ['#c8b58a', 'sack'], ['#8a5a3a', 'log']];
  const [col, kind] = loads[i % loads.length];
  for (let k = 0; k < 5; k++) {
    let m;
    if (kind === 'barrel') m = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.7, 10), M(col));
    else if (kind === 'sack') { m = new THREE.Mesh(new THREE.SphereGeometry(0.36, 8, 6), M(col)); m.scale.set(1.1, 0.7, 1.4); }
    else { m = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 2.4, 6), M(col)); m.rotation.x = Math.PI / 2; }
    m.position.set(-0.45 + (k % 3) * 0.45, 1.45 + (k > 2 ? 0.35 : 0), kind === 'log' ? 0.1 : -0.6 + (k % 2) * 1.1);
    g.add(m);
  }
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}

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

  remove(a) { this.scene.remove(a.root); if (a.cart) this.scene.remove(a.cart); a.mixer.stopAllAction(); this.list = this.list.filter((x) => x !== a); }

  update(dt, camPos, focus, ocean, terrain) {
    if (!this.scene) return;
    const g = this.game;
    // --- town animals follow the town the camera is in
    const town = g.townList.find((t) => t.center.distanceTo(camPos) < t.R * 2);
    if (town !== this.town) {
      for (const a of this.list.filter((x) => x.town)) this.remove(a);
      this.town = town;
      if (town && town.streetNodes.length) {
        const q = g.quality === 'low' ? 0.4 : g.quality === 'medium' ? 0.7 : 1;
        const mix = TOWN_ANIMALS[town.port.id] || TOWN_ANIMALS.havana;
        const near = town.streetNodes.filter((n) => n.distanceTo(focus) < 140);
        for (const [k, n0] of Object.entries(mix)) {
          for (let i = 0; i < Math.round(n0 * q); i++) {
            const pool = near.length && Math.random() < 0.7 ? near : town.streetNodes;
            const n = pool[Math.floor(Math.random() * pool.length)];
            const a = this.spawn(k, n.clone().add(_v.set((Math.random() - 0.5) * 6, 0, (Math.random() - 0.5) * 6)));
            if (!a) continue;
            a.town = town;
            if (k === 'rooster') { a.flock = true; a.cfg = { ...a.cfg, speed: 0.5 + Math.random() * 0.4 }; }
          }
        }
        // pelicans on the wharf heads
        for (const pl of town.platforms.slice(0, 6)) {
          if (Math.random() < 0.4) continue;
          const a = this.spawn('pelican', new THREE.Vector3(pl.x + (Math.random() - 0.5) * pl.hw, pl.y + 0.05, pl.z + (Math.random() - 0.5) * pl.hd));
          if (a) { a.perch = true; a.town = town; a.yaw = Math.random() * 6.28; }
        }
        // mule carts on the streets
        this.carts = [];
        const G = town.crowdGraph || g.crowd?.graph(town);
        if (G) for (let i = 0; i < Math.round((CARTS[town.port.id] ?? 3) * q); i++) {
          const live = G.adj.map((x, k) => k).filter((k) => G.adj[k].length);
          if (!live.length) break;
          const from = live[Math.floor(Math.random() * live.length)];
          const mule = this.spawn('donkey', G.nodes[from].clone());
          if (!mule) break;
          mule.town = town; mule.cartOf = { G, from, to: G.adj[from][0], t: 0 };
          mule.cart = cartMesh(i);
          this.scene.add(mule.cart);
          this.carts.push(mule);
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
      if (a.cartOf) {
        // a mule plodding its cart along the streets
        const C = a.cartOf, A = C.G.nodes[C.from], B = C.G.nodes[C.to];
        const L = Math.hypot(B.x - A.x, B.z - A.z) || 1;
        C.t += (0.95 * dt) / L;
        if (C.t >= 1) {
          const nb = C.G.adj[C.to].filter((k) => k !== C.from);
          C.from = C.to; C.to = nb.length ? nb[Math.floor(Math.random() * nb.length)] : C.G.adj[C.to][0]; C.t = 0;
        }
        const tx = A.x + (B.x - A.x) * C.t, tz = A.z + (B.z - A.z) * C.t;
        const want = Math.atan2(B.x - A.x, B.z - A.z);
        let dy = want - a.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        a.yaw += dy * Math.min(1, dt * 2.5);
        a.pos.set(tx + Math.cos(a.yaw) * 1.2, 0, tz - Math.sin(a.yaw) * 1.2);
        a.pos.y = g.groundAt(a.pos.x, a.pos.z);
        a.root.position.copy(a.pos);
        a.root.rotation.set(0, a.yaw, 0);
        const cx = a.pos.x - Math.sin(a.yaw) * 2.9, cz = a.pos.z - Math.cos(a.yaw) * 2.9;
        a.cart.position.set(cx, g.groundAt(cx, cz), cz);
        a.cart.rotation.set(0, a.yaw, 0);
        a.cart.children[0].rotation.x += dt * 1.6; // wheels
        a.cart.visible = a.root.visible;
        moving = true;
      } else if (a.perch) {
        a.root.position.copy(a.pos);
        a.root.rotation.set(0, a.yaw, 0);
      } else if (a.name === 'cow') {
        a.pos.y = g.groundAt(a.pos.x, a.pos.z);
        a.root.position.copy(a.pos);
        a.root.rotation.set(0, a.yaw, 0);
      } else if (a.town || a.name === 'crab') {
        // wander: pick a nearby point, walk there, graze / sit a while
        if (!a.target) {
          a.wait -= dt;
          if (a.wait <= 0) {
            const r = a.name === 'crab' ? 3 : a.flock ? 4 : 14;
            const base = a.town && Math.random() < 0.3 ? a.town.streetNodes[Math.floor(Math.random() * a.town.streetNodes.length)] : a.pos;
            a.target = base.clone().add(_v.set((Math.random() - 0.5) * r * 2, 0, (Math.random() - 0.5) * r * 2));
          }
        } else {
          const dx = a.target.x - a.pos.x, dz = a.target.z - a.pos.z, dl = Math.hypot(dx, dz);
          if (dl < 0.4 || g.blockedAt?.(a.pos.x + dx / dl, a.pos.z + dz / dl, 0.3, a.pos.y)) { a.target = null; a.wait = (a.flock ? 0.5 : 2) + Math.random() * (a.name === 'crab' || a.flock ? 3 : 10); }
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
