// Over the side: the jolly boat, wrecks on the bottom, and what swims around them.
// - The jolly boat: lowered from your ship at anchor, rowed (WASD) to any beach or cove, left on the sand while
//   you go ashore, and rowed back out to climb aboard again.
// - Wrecks: hulls lying on the bottom in the shallows off the islands (the 1715 Plate Fleet off Florida among
//   them), masts broken off, with sea chests in the sand beside them to be dived for.
// - Sharks: they come to a swimmer out of his depth, circle, and strike. A cutlass stroke sends one off.
// - Under water: the light goes green, the far side of the wreck fades into the murk, and your breath runs out.
import * as THREE from 'three';
import { clamp, damp, dampAngle, rand, randInt } from '../core/noise.js';
import { ISLANDS, PORTS, SALVAGE_CAMP, SHIP_CLASSES } from './data.js';
import { shipLibrary } from '../entities/shipLibrary.js';

const WOOD = () => new THREE.MeshStandardMaterial({ color: '#6b4c30', roughness: 0.85, side: THREE.DoubleSide });

// a clinker-built rowing boat about 5 m long, bow toward -z
function boatMesh() {
  const g = new THREE.Group();
  const L = 5.2, B = 0.95, D = 0.62, NU = 18, NV = 9;
  const pos = [], idx = [];
  for (let i = 0; i <= NU; i++) {
    const u = i / NU * 2 - 1; // -1 bow .. 1 stern
    const w = B * Math.pow(Math.max(0, 1 - Math.pow(Math.abs(u < 0 ? u * 1.02 : u * 0.9), 2.2)), 0.55) + (u > 0.85 ? 0.25 : 0);
    const sheer = 0.12 * u * u;
    for (let j = 0; j <= NV; j++) {
      const v = (j / NV) * Math.PI; // round the bilge from one gunwale to the other
      pos.push(Math.cos(v) * w, D + sheer - Math.sin(v) * D * (1 - 0.25 * u * u), u * L / 2);
    }
  }
  for (let i = 0; i < NU; i++) for (let j = 0; j < NV; j++) { const a = i * (NV + 1) + j, b = a + NV + 1; idx.push(a, b, a + 1, b, b + 1, a + 1); }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const M = WOOD();
  g.add(new THREE.Mesh(geo, M));
  // transom, thwarts, gunwales
  const dark = new THREE.MeshStandardMaterial({ color: '#4a3220', roughness: 0.9 });
  for (const z of [-1.2, 0, 1.2]) { const t = new THREE.Mesh(new THREE.BoxGeometry(B * 1.7, 0.06, 0.28), dark); t.position.set(0, D * 0.72, z); g.add(t); }
  // oars, pivoting at the rowlocks
  const oars = [];
  for (const sd of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(sd * B * 0.95, D + 0.08, 0.1);
    const loom = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 3.2, 6).rotateZ(Math.PI / 2).translate(sd * 1.0, 0, 0), dark);
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.02, 0.16).translate(sd * 2.4, 0, 0), dark);
    pivot.add(loom, blade);
    g.add(pivot);
    oars.push({ pivot, sd });
  }
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return { group: g, oars, seatY: D * 0.72 };
}

// a sea chest: iron-bound, half sunk in the sand
function chestMesh() {
  const g = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: '#3f2d1c', roughness: 0.9 });
  const iron = new THREE.MeshStandardMaterial({ color: '#3a3833', roughness: 0.6, metalness: 0.6 });
  g.add(new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.55, 0.62), wood));
  const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.31, 0.31, 1.0, 10, 1, false, 0, Math.PI).rotateZ(Math.PI / 2), wood);
  lid.position.y = 0.27; g.add(lid);
  for (const x of [-0.35, 0, 0.35]) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.62, 0.66), iron); b.position.set(x, 0.1, 0); g.add(b); }
  return g;
}

// a shark: a lathed body with fins; the tail sweeps from side to side as it swims (bow toward -z)
function sharkMesh(len) {
  const g = new THREE.Group();
  const prof = [];
  for (let i = 0; i <= 16; i++) { const t = i / 16; prof.push(new THREE.Vector2(Math.max(0.01, Math.sin(Math.pow(t, 1.25) * Math.PI) * (0.55 + t * 0.45) * 0.19 * len), t * len)); } // (t = 1 at the snout)
  const body = new THREE.LatheGeometry(prof, 14).rotateX(-Math.PI / 2).translate(0, 0, len * 0.5).scale(1, 0.85, 1); // tail at +z, snout at -z
  // grey above, pale beneath
  const col = [], p = body.attributes.position;
  for (let i = 0; i < p.count; i++) { const k = p.getY(i) > -0.03 * len ? 0.22 : 0.78; col.push(k, k * 1.02, k * 1.08); }
  body.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const M = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, side: THREE.DoubleSide });
  const front = new THREE.Mesh(body, M);
  g.add(front);
  const fin = (pts) => { const s = new THREE.Shape(); s.moveTo(pts[0], pts[1]); for (let i = 2; i < pts.length; i += 2) s.lineTo(pts[i], pts[i + 1]); return new THREE.ShapeGeometry(s); };
  const finM = new THREE.MeshStandardMaterial({ color: '#5c646b', roughness: 0.6, side: THREE.DoubleSide });
  const dorsal = new THREE.Mesh(fin([0, 0, 0.22 * len, 0, 0.1 * len, 0.2 * len]).rotateY(Math.PI / 2).translate(0, 0.13 * len, -0.08 * len), finM);
  g.add(dorsal);
  for (const sd of [-1, 1]) { const pf = new THREE.Mesh(fin([0, 0, 0.16 * len, 0, 0.2 * len, 0.03 * len]).rotateX(-Math.PI / 2).rotateY(sd > 0 ? -Math.PI / 2 - 0.5 : Math.PI / 2 + 0.5).translate(sd * 0.1 * len, -0.06 * len, -0.18 * len), finM); g.add(pf); }
  const tail = new THREE.Group();
  tail.position.z = len * 0.46;
  tail.add(new THREE.Mesh(fin([0, 0, 0.2 * len, 0.26 * len, 0.1 * len, 0, 0.2 * len, -0.14 * len]).rotateY(Math.PI / 2), finM));
  g.add(tail);
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return { group: g, tail };
}

export class Seaside {
  constructor(game) {
    this.g = game;
    this.boat = null;
    this.rowing = false;
    this.wrecks = [];
    this.sharks = [];
    this.sharkT = 25;
    this.under = false;
    // under-water tint and the breath gauge
    this.tint = document.createElement('div');
    this.tint.className = 'underwater';
    document.body.appendChild(this.tint);
    this.gauge = document.createElement('div');
    this.gauge.className = 'breath';
    this.gauge.innerHTML = '<i></i><span>Breath</span>';
    document.body.appendChild(this.gauge);
  }

  // ------------------------------------------------------------------ wrecks
  placeWrecks() {
    const g = this.g, T = g.terrain;
    if (this.wrecks.length) return;
    const sites = [];
    const near = ([cx, cz], n, seed) => {
      let s = seed;
      const R = () => ((s = (s * 16807) % 2147483647) / 2147483647);
      for (let k = 0, found = 0; k < 400 && found < n; k++) {
        const a = R() * Math.PI * 2, r = 300 + R() * 900;
        const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
        const h = T.height(x, z);
        if (h < -16 || h > -7) continue;
        if (sites.some((w) => Math.hypot(w.x - x, w.z - z) < 400)) continue;
        if (PORTS.some((p) => Math.hypot(p.coast[0] - x, p.coast[1] - z) < 280)) continue;
        sites.push({ x, z, h, seed: s });
        found++;
      }
    };
    PORTS.forEach((p, i) => near(p.coast, 1, 7919 * (i + 3)));
    near(SALVAGE_CAMP.coast, 2, 104729); // the Plate Fleet, lost in the hurricane of July 1715
    const looted = g.state.wrecksLooted || (g.state.wrecksLooted = {});
    const classes = ['galleon', 'fluyt', 'brigantine', 'frigate'];
    sites.forEach((s, i) => {
      const cls = i >= PORTS.length ? 'galleon' : classes[i % classes.length]; // (the Plate Fleet: treasure galleons)
      const w = { id: `w${i}`, x: s.x, z: s.z, cls, chests: [], seen: false };
      w.group = this.wreckModel(cls, s);
      if (w.group) g.scene.add(w.group);
      // two or three chests in the sand beside her
      const n = 2 + (i % 2);
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2 + i, r = SHIP_CLASSES[cls].beam * 0.9 + 2 + k;
        const cx = s.x + Math.cos(a) * r, cz = s.z + Math.sin(a) * r;
        const key = `${w.id}c${k}`;
        const m = chestMesh();
        m.position.set(cx, T.height(cx, cz) + 0.12, cz);
        m.rotation.set(rand(-0.15, 0.15), rand(0, 6), rand(-0.2, 0.2));
        if (!looted[key]) g.scene.add(m);
        w.chests.push({ key, mesh: m, pos: m.position.clone(), taken: !!looted[key] });
      }
      this.wrecks.push(w);
    });
  }

  wreckModel(cls, s) {
    const g = this.g;
    if (!shipLibrary.has(cls)) return null;
    const C = SHIP_CLASSES[cls];
    const S = shipLibrary.create(cls, C.length, '#6d6a5c');
    if (S.sails) S.sails.visible = false; // rotted away long since
    // weed and silt: every surface darkened and greened
    S.group.traverse((o) => {
      if (!o.isMesh) return;
      o.material.color?.multiply(new THREE.Color(0.42, 0.5, 0.44));
      o.castShadow = false;
    });
    // her masts broken off a little above the deck
    S.masts.forEach((m, i) => { if (i < 3) S.uniforms.uCut.value[i].set(m.z0 - 50, m.z1 + 50, S.cfg.deck + 1.2 + i * 0.6, 1); });
    const grp = S.group;
    const T = g.terrain;
    // settled on the bottom, listing to one side, part buried
    grp.position.set(s.x, T.height(s.x, s.z) - S.cfg.draft * S.scale * 0.55, s.z);
    grp.rotation.set(rand(-0.06, 0.06), rand(0, Math.PI * 2), (s.seed % 2 ? 1 : -1) * rand(0.25, 0.45));
    grp.traverse((o) => { if (o.isMesh) o.frustumCulled = true; });
    return grp;
  }

  // ------------------------------------------------------------------ the jolly boat
  lowerBoat() {
    const g = this.g, p = g.playerShip;
    g.transition(600, () => {
      p.speed = 0; p.sailTarget = 0; p.anchored = true;
      g.syncStateFromPlayerShip();
      if (!this.boat) {
        const B = boatMesh();
        this.boat = { ...B, pos: new THREE.Vector3(), heading: 0, speed: 0, turn: 0, stroke: 0, beached: false };
        g.scene.add(B.group);
      }
      const b = this.boat;
      // alongside, on the side away from the wind
      const sd = (g.wind.x * p.right.x + g.wind.z * p.right.z) >= 0 ? 1 : -1;
      b.pos.copy(p.position).addScaledVector(p.right, sd * (p.cls.beam * 0.5 + 3));
      b.heading = p.heading;
      b.speed = 0; b.beached = false;
      b.group.visible = true;
      g.enterFoot(b.pos.clone(), null);
      this.embark();
      g.ui.toast('The jolly boat is lowered and you take the oars. [W]/[S] row · [A]/[D] turn · [E] step out on a beach · [Space] over the side for a swim.', 'info', 6000);
    });
  }

  embark() {
    const w = this.g.walker;
    this.rowing = true;
    w.mode = 'boat';
    w.root.rotation.x = 0;
    w.leaveWater?.();
  }

  // stepping out: onto the beach (or into the sea)
  disembark(swim) {
    const g = this.g, w = g.walker, b = this.boat;
    this.rowing = false;
    w.animState.activity = null;
    const fx = -Math.sin(b.heading), fz = -Math.cos(b.heading);
    if (swim) {
      const rx = Math.cos(b.heading), rz = -Math.sin(b.heading);
      w.pos.set(b.pos.x + rx * 1.6, g.ocean.heightAt(b.pos.x, b.pos.z) - 1.3, b.pos.z + rz * 1.6);
      w.startSwim(4);
    } else {
      const x = b.pos.x + fx * 3.4, z = b.pos.z + fz * 3.4;
      w.pos.set(x, g.surfaceAt(x, z, 50), z);
      w.mode = 'ground';
    }
    w.vel.set(0, 0, 0); w.vy = 0;
  }

  // row: the boat has way on it and carries it; the oars sweep; a beach stops her
  row(dt, input) {
    const g = this.g, b = this.boat, w = g.walker;
    const fwd = (input.down('KeyW') ? 1 : 0) - (input.down('KeyS') ? 0.6 : 0);
    const turn = (input.down('KeyA') ? 1 : 0) - (input.down('KeyD') ? 1 : 0);
    b.speed = damp(b.speed, fwd * 2.9, 0.6, dt);
    b.turn = damp(b.turn, turn * 0.55, 2, dt);
    b.heading += b.turn * dt * (0.4 + Math.min(1, Math.abs(b.speed) / 2));
    const fx = -Math.sin(b.heading), fz = -Math.cos(b.heading);
    const nx = b.pos.x + fx * b.speed * dt, nz = b.pos.z + fz * b.speed * dt;
    // running her up the beach: stop when the bow takes the ground
    const bowH = g.terrain.height(nx + fx * 2.4, nz + fz * 2.4);
    const blocked = g.shipBlockers?.some((c) => { const dx = nx - c.x, dz = nz - c.z; const lx = dx * c.cos - dz * c.sin, lz = dx * c.sin + dz * c.cos; return Math.abs(lx) < c.hw + 1 && Math.abs(lz) < c.hd + 1; });
    if (bowH > -0.35 && b.speed > 0) { if (!b.beached) { b.beached = true; g.audio.crunch?.(b.pos); } b.speed = 0; }
    else if (blocked) b.speed = 0;
    else { b.pos.x = nx; b.pos.z = nz; if (bowH < -0.6) b.beached = false; }
    // she keeps off your ship's side
    const p = g.playerShip;
    if (p) {
      const dx = b.pos.x - p.position.x, dz = b.pos.z - p.position.z;
      const lx = dx * p.right.x + dz * p.right.z, lz = dx * p.forward.x + dz * p.forward.z;
      const hw = p.cls.beam * 0.55 + 1.2, hl = p.cls.length * 0.5;
      if (Math.abs(lx) < hw && Math.abs(lz) < hl) { const push = (hw - Math.abs(lx)) * Math.sign(lx || 1); b.pos.x += p.right.x * push; b.pos.z += p.right.z * push; }
    }
    // oars: a stroke cycle while pulling
    b.stroke += dt * (Math.abs(fwd) > 0 || turn ? 5.5 : 0);
    for (const o of b.oars) {
      const pull = Math.abs(fwd) > 0 || turn ? 1 : 0;
      o.pivot.rotation.y = pull * Math.sin(b.stroke) * 0.5 * o.sd;
      o.pivot.rotation.z = (pull ? 0.12 + Math.cos(b.stroke) * 0.12 : 0.18) * o.sd;
    }
    // afloat on the swell
    const wy = g.ocean.heightAt(b.pos.x, b.pos.z);
    const gy = g.terrain.height(b.pos.x, b.pos.z);
    const y = Math.max(wy - 0.28, gy + 0.05);
    b.group.position.set(b.pos.x, y, b.pos.z);
    b.group.rotation.set(Math.sin(performance.now() * 0.0011) * 0.04, b.heading, Math.sin(performance.now() * 0.0009 + 1) * 0.05, 'YXZ');
    // the rower sits on the middle thwart, facing aft as oarsmen do
    w.pos.set(b.pos.x, y + b.seatY - 0.45, b.pos.z);
    w.yaw = b.heading + Math.PI;
    w.vel.set(0, 0, 0); w.vy = 0;
    w.animState.activity = 'sit';
    w.moveAnim = null;
    const m = g.input.consumeMouse();
    w.camYaw -= m.dx;
    w.camPitch = clamp(w.camPitch + m.dy, -0.3, 1.1);
    if (m.wheel) w.camDist = clamp(w.camDist + m.wheel * 0.6, 3, 14);
    w.animate(dt);
  }

  // prompts while in or near the boat, or swimming beside your ship
  context() {
    const g = this.g, w = g.walker, b = this.boat, p = g.playerShip;
    if (!w || w.dead) return null;
    if (this.rowing) {
      if (p && b.pos.distanceTo(p.position) < p.cls.beam * 0.5 + 7) return { text: '[E] Climb aboard your ship', act: () => this.climbAboard() };
      if (b.beached) return { text: '[E] Step ashore', act: () => this.disembark(false) };
      return null;
    }
    if (b && b.group.visible && Math.hypot(b.pos.x - w.pos.x, b.pos.z - w.pos.z) < 3.4) return { text: '[E] Take the oars', act: () => this.embark() };
    if (w.mode === 'swim' && p && Math.hypot(p.position.x - w.pos.x, p.position.z - w.pos.z) < p.cls.beam * 0.5 + 4 && Math.abs(p.position.x - w.pos.x) + Math.abs(p.position.z - w.pos.z) < p.cls.length) return { text: '[E] Climb the side and come aboard', act: () => this.climbAboard() };
    // sea chests on the bottom
    if (w.mode === 'swim') for (const wr of this.wrecks) {
      if (Math.hypot(wr.x - w.pos.x, wr.z - w.pos.z) > 60) continue;
      for (const c of wr.chests) if (!c.taken && c.pos.distanceTo(w.pos) < 2.6) return { text: '[E] Prise open the sea chest', act: () => this.openChest(wr, c) };
    }
    return null;
  }

  climbAboard() {
    const g = this.g;
    this.rowing = false;
    if (this.boat) this.boat.group.visible = false; // hoisted in
    g.boardOwnShip(true);
  }

  openChest(wr, c) {
    const g = this.g, s = g.state;
    c.taken = true;
    s.wrecksLooted[c.key] = true;
    g.scene.remove(c.mesh);
    g.effects.dust?.(c.pos.clone());
    const gold = randInt(120, 420) * (wr.cls === 'galleon' ? 2 : 1);
    s.gold += gold;
    g.audio.coins();
    let extra = '';
    // now and then a chart in an oilskin: somebody's buried hoard
    if (Math.random() < 0.35) {
      const wild = ISLANDS.filter((i) => !PORTS.some((p) => p.island === i.id) && i.id !== 'florida' && i.rx < 1000 && /^[A-Z]/.test(i.name || ''));
      const isl = wild[randInt(0, wild.length - 1)];
      const spot = isl && g.findTreasureSpot(isl.id);
      if (spot) { s.treasureMaps.push({ island: isl.id, x: spot.x, z: spot.z, value: 800 + randInt(0, 1400), found: false }); g.spawnTreasureMarkers?.(); extra = ` — and wrapped in oilskin, a chart of ${isl.name} with a mark on it!`; }
    }
    g.ui.toast(`The chest gives way: ${gold} pieces of eight${extra}`, 'good', 4500);
  }

  // ------------------------------------------------------------------ sharks
  spawnShark(w) {
    const g = this.g;
    const len = rand(2.6, 3.6);
    const S = sharkMesh(len);
    const a = rand(0, Math.PI * 2), r = 38;
    const sh = { ...S, len, pos: new THREE.Vector3(w.pos.x + Math.cos(a) * r, w.pos.y - rand(0, 3), w.pos.z + Math.sin(a) * r), yaw: a, speed: 2, phase: 0, mode: 'circle', t: rand(8, 14), dir: Math.random() < 0.5 ? 1 : -1, health: 70, dead: false, sinkT: 0 };
    g.scene.add(S.group);
    this.sharks.push(sh);
    if (!this.warned) { this.warned = true; g.ui.toast('A fin cuts the water… Shark! Keep your cutlass ready — or get out of the water.', 'warn', 4000); }
  }

  updateSharks(dt) {
    const g = this.g, w = g.walker;
    const swimming = w && !w.dead && w.mode === 'swim';
    if (swimming) {
      const depth = g.ocean.heightAt(w.pos.x, w.pos.z) - g.terrain.height(w.pos.x, w.pos.z);
      const atWreck = this.wrecks.some((wr) => Math.hypot(wr.x - w.pos.x, wr.z - w.pos.z) < 60);
      this.sharkT -= dt * (depth > 5 ? 1 : 0) * (atWreck ? 1.6 : 1);
      if (this.sharkT <= 0 && this.sharks.filter((s) => !s.dead).length < (atWreck ? 2 : 1)) { this.sharkT = rand(35, 70); this.spawnShark(w); }
    }
    for (let i = this.sharks.length - 1; i >= 0; i--) {
      const s = this.sharks[i];
      s.phase += dt * (3 + s.speed * 1.4);
      s.tail.rotation.y = Math.sin(s.phase) * 0.45;
      const sea = g.ocean.heightAt(s.pos.x, s.pos.z);
      const floor = g.terrain.height(s.pos.x, s.pos.z);
      if (s.dead) {
        // rolls over and sinks, trailing blood
        s.sinkT += dt;
        s.group.rotation.z = damp(s.group.rotation.z, Math.PI, 1, dt);
        s.pos.y = Math.max(floor + 0.4, s.pos.y - dt * 0.6);
        if (s.sinkT > 12) { g.scene.remove(s.group); this.sharks.splice(i, 1); continue; }
      } else {
        let tx, tz, ty;
        if (!swimming) s.mode = 'leave';
        const dx = w.pos.x - s.pos.x, dz = w.pos.z - s.pos.z, d = Math.hypot(dx, dz);
        s.t -= dt;
        if (s.mode === 'circle') {
          // a ring around the swimmer, closing in
          const a = Math.atan2(s.pos.z - w.pos.z, s.pos.x - w.pos.x) + s.dir * 0.35;
          const R = 9 + Math.max(0, s.t) * 0.4;
          tx = w.pos.x + Math.cos(a) * R; tz = w.pos.z + Math.sin(a) * R; ty = w.pos.y + 0.6;
          s.speed = damp(s.speed, 3.2, 1, dt);
          if (s.t <= 0) { s.mode = 'charge'; s.t = 4; g.audio.swoosh?.(s.pos); }
        } else if (s.mode === 'charge') {
          tx = w.pos.x; tz = w.pos.z; ty = w.pos.y + 0.8;
          s.speed = damp(s.speed, 8.5, 3, dt);
          if (Math.hypot(d, (w.pos.y + 0.8) - s.pos.y) < 1.7) {
            w.takeDamage(22, null);
            g.effects.blood?.(w.pos.clone().add(new THREE.Vector3(0, 0.8, 0)));
            g.audio.grunt?.(w.pos);
            s.mode = 'retreat'; s.t = rand(3, 5);
          } else if (s.t <= 0) { s.mode = 'circle'; s.t = rand(5, 9); }
        } else if (s.mode === 'retreat' || s.mode === 'leave') {
          tx = s.pos.x - dx; tz = s.pos.z - dz; ty = s.pos.y;
          s.speed = damp(s.speed, 6, 2, dt);
          if (s.mode === 'retreat' && s.t <= 0) { s.mode = 'circle'; s.t = rand(6, 10); }
          if (s.mode === 'leave' && d > 70) { g.scene.remove(s.group); this.sharks.splice(i, 1); continue; }
        }
        const want = Math.atan2(-(tx - s.pos.x), -(tz - s.pos.z));
        s.yaw = dampAngle(s.yaw, want, s.mode === 'charge' ? 3 : 1.6, dt);
        s.pos.x += -Math.sin(s.yaw) * s.speed * dt;
        s.pos.z += -Math.cos(s.yaw) * s.speed * dt;
        s.pos.y = damp(s.pos.y, clamp(ty, floor + 0.6, sea - 0.35), 1.5, dt);
        s.group.rotation.set(0, s.yaw, 0);
      }
      s.group.position.copy(s.pos);
    }
  }

  // a cutlass stroke in the water (from playerMelee)
  meleeSharks(w, fwd) {
    let hit = false;
    for (const s of this.sharks) {
      if (s.dead) continue;
      const to = s.pos.clone().sub(w.pos); to.y -= 0.8;
      const d = to.length();
      if (d > 2.8 + s.len * 0.3) continue;
      if (to.setY(0).normalize().dot(fwd) < 0.2) continue;
      s.health -= 34;
      hit = true;
      this.g.effects.blood?.(s.pos.clone());
      if (s.health <= 0) { s.dead = true; this.g.ui.toast('The shark rolls over and sinks, trailing blood.', 'good', 2500); }
      else { s.mode = 'retreat'; s.t = rand(4, 7); }
    }
    return hit;
  }

  clear() {
    for (const s of this.sharks) this.g.scene.remove(s.group);
    this.sharks = [];
  }

  // ------------------------------------------------------------------ per frame
  update(dt) {
    const g = this.g, w = g.walker;
    if (this.boat && this.boat.group.visible && !this.rowing) {
      // lying on the beach or drifting where she was left
      const b = this.boat, wy = g.ocean.heightAt(b.pos.x, b.pos.z), gy = g.terrain.height(b.pos.x, b.pos.z);
      b.group.position.set(b.pos.x, Math.max(wy - 0.28, gy + 0.05), b.pos.z);
    }
    if (g.mode === 'foot') this.updateSharks(dt); else if (this.sharks.length) this.clear();
    // under water: green murk, no sky, the breath gauge
    const cam = g.camera.position;
    const under = cam.y < g.ocean.heightAt(cam.x, cam.z) - 0.1;
    if (under !== this.under) {
      this.under = under;
      this.tint.style.opacity = under ? '1' : '0';
      g.sky.dome.visible = !under;
    }
    if (under) {
      const depth = g.ocean.heightAt(cam.x, cam.z) - cam.y;
      g.weather.fog.color.setRGB(0.05, 0.22 + 0.1 * Math.exp(-depth * 0.1), 0.24 + 0.08 * Math.exp(-depth * 0.1)).multiplyScalar(1 - g.sky.nightFactor * 0.85);
      g.weather.fog.density = 0.045 + depth * 0.002;
      g.renderer.setClearColor(g.weather.fog.color);
      if (w && Math.random() < dt * 2.5) g.effects.bubbles?.(w.pos.clone().add(new THREE.Vector3(0, 1.6, 0)));
    }
    const showBreath = w && w.mode === 'swim' && (w.underwater || w.breath < 0.99);
    this.gauge.style.display = showBreath ? 'block' : 'none';
    if (showBreath) { this.gauge.firstChild.style.width = `${Math.round(w.breath * 100)}%`; this.gauge.classList.toggle('low', w.breath < 0.3); }
    // the mate points out a wreck on the bottom as you sail over it
    const p = g.playerShip;
    if (g.mode === 'sail' && p) for (const wr of this.wrecks) {
      if (wr.seen || Math.hypot(wr.x - p.position.x, wr.z - p.position.z) > 90) continue;
      wr.seen = true;
      g.ui.toast('“There\'s a wreck on the bottom here, Captain — you can see her timbers through the water. Let go the anchor [R], lower the boat [F] and go over the side for a look.” — Mr. Ward, first mate', 'mate', 6000);
    }
  }
}
