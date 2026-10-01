// Boarding by force. Grapples bring the prize alongside and the two ships are lashed together; the captain
// and a party of the crew swing across on lines from the yards and the fight is carried on her deck, cutlass
// and pistol, your men against hers, until her crew is cut down or strikes. Then she's yours to plunder.
import * as THREE from 'three';
import { NPC, lookFor } from '../entities/actors.js';
import { clamp, rand } from '../core/noise.js';

const _v = new THREE.Vector3();

export class Boarding {
  constructor(game, enemy) {
    this.g = game;
    this.enemy = enemy;
    this.own = game.playerShip;
    this.t = 0;
    this.phase = 'grapple';
    this.allies = [];
    this.foes = [];
    this.colliders = [];
    this.flights = [];
    this.lines = [];
    this.surrendered = false;
  }

  // ---------------------------------------------------------------- setup
  start() {
    const g = this.g, p = this.own, e = this.enemy;
    // which side she lies on, and lay her alongside, head to head
    const toE = e.position.clone().sub(p.position);
    this.side = toE.dot(p.right) >= 0 ? 1 : -1;
    e.heading = p.heading;
    e.updateAxes();
    const gap = p.cls.beam * 0.5 + e.cls.beam * 0.5 + 0.6;
    e.position.copy(p.position).addScaledVector(p.right, this.side * gap);
    for (const s of [p, e]) {
      s.lashed = true; s.speed = 0; s.sway = 0; s.yawRate = 0; s.sailTarget = 0;
      // bring her model to where she now lies before anyone is put aboard
      s.group.position.set(s.position.x, s.y ?? s.group.position.y, s.position.z);
      s.group.rotation.set(s.pitch || 0, s.heading, s.roll || 0);
      s.group.updateMatrixWorld(true);
    }
    if (e.ai) e.ai.mode = 'idle';
    g.audio.clang(p.position);
    g.ui.toast('Grapples away! Lay her alongside!', 'warn', 2500);
    // grapple lines between the rails
    const mat = new THREE.LineBasicMaterial({ color: 0x3a2a1a });
    for (let k = 0; k < 4; k++) {
      const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
      const line = new THREE.Line(geo, mat);
      line.frustumCulled = false;
      g.scene.add(line);
      this.lines.push({ line, u: -0.3 + k * 0.2 });
    }
    this.buildDecks();
    // her crew, mustered on deck
    const navy = e.role === 'navy' || e.role === 'hunter';
    // swivels sweep her deck as you close; your armoury arms more of your people
    if (p.refit?.swivels) { const lost = Math.round(e.crew * 0.15); e.crew = Math.max(2, e.crew - lost); if (lost) g.ui.toast(`Your swivels sweep her deck as you close — ${lost} of her people down.`, 'good', 3000); }
    const nFoes = clamp(Math.round(e.crew / 6), 4, 14);
    for (let i = 0; i < nFoes; i++) {
      const at = this.deckPoint(e, rand(-0.7, 0.7), rand(-0.75, 0.75));
      const kind = navy && i % 3 !== 2 ? 'soldier' : 'pirate';
      const look = kind === 'soldier' ? lookFor('soldier', e.nationId) : lookFor('pirate', 'pirate');
      const n = new NPC(g, look, { x: at.x, y: at.y, z: at.z, kind, nation: e.nationId, health: kind === 'soldier' ? 80 : 65 });
      n.side = 'enemy'; n.hostile = true;
      if (kind === 'pirate') n.weapon = 'cutlass';
      g.npcs.push(n);
      this.foes.push(n);
    }
    this.nFoes = nFoes;
    // your boarding party, on your own deck, ready to swing
    const nAllies = clamp(Math.round(p.crew / 8) + (p.refit?.armoury ? 3 : 0), 3, p.refit?.armoury ? 13 : 10);
    for (let i = 0; i < nAllies; i++) {
      const at = this.deckPoint(p, this.side * 0.6, rand(-0.7, 0.7));
      const n = new NPC(g, lookFor('pirate', 'pirate'), { x: at.x, y: at.y, z: at.z, kind: 'pirate', nation: 'pirate', health: p.refit?.armoury ? 85 : 70 });
      n.side = 'ally'; n.weapon = 'cutlass';
      g.npcs.push(n);
      this.allies.push(n);
    }
    this.nAllies = nAllies;
    // the captain on the rail
    const at = this.deckPoint(p, this.side * 0.55, 0);
    g.enterFoot(at, null);
    g.walker.yaw = Math.atan2(-p.right.x * this.side, -p.right.z * this.side);
    g.walker.camYaw = g.walker.yaw;
    g.walker.camPitch = 0.3;
    g.ui.hint('[Space] swing across · [WASD] move · [Left Click] cutlass · hold [Right Click] aim a pistol · cut them down or make them strike', true);
  }

  // walkable decks and the bulwarks round them (open on the side where the ships touch)
  buildDecks() {
    this.colliders = [];
    for (const [s, sgn] of [[this.own, this.side], [this.enemy, -this.side]]) {
      const hw = s.cls.beam * 0.44, hd = s.cls.length * 0.42;
      const y = this.deckY(s, 0, 0) + 1.1;
      const h = s.heading, cos = Math.cos(h), sin = Math.sin(h);
      const wall = (lx, lz, whw, whd) => {
        const x = s.position.x + lx * cos + lz * sin, z = s.position.z - lx * sin + lz * cos;
        this.colliders.push({ x, z, hw: whw, hd: whd, cos, sin, top: y, deck: true });
      };
      wall(-sgn * (hw + 0.2), 0, 0.2, hd); // the far rail
      wall(0, hd + 0.2, hw + 0.4, 0.2); // stern and bow
      wall(0, -hd - 0.2, hw + 0.4, 0.2);
    }
  }

  // world height of a ship's deck at local (lx across, lz along)
  deckY(s, lx, lz) {
    return s.localToWorld(_v.set(lx, s.model.deckY, lz)).y;
  }

  // a point on deck from fractions of the half beam (across) and half length (along)
  deckPoint(s, fx, fz) {
    const lx = fx * s.cls.beam * 0.4, lz = fz * s.cls.length * 0.4;
    return s.localToWorld(new THREE.Vector3(lx, s.model.deckY, lz));
  }

  // height of whichever deck is under (x, z), or null (the two decks meet across the gap between the hulls)
  deckAt(x, z) {
    let best = null;
    for (const [s, sgn] of [[this.own, this.side], [this.enemy, -this.side]]) {
      const dx = x - s.position.x, dz = z - s.position.z, h = s.heading;
      const lx = dx * Math.cos(h) - dz * Math.sin(h), lz = dx * Math.sin(h) + dz * Math.cos(h);
      const hw = s.cls.beam * 0.44, hd = s.cls.length * 0.42;
      const inner = lx * sgn > 0 ? hw + 0.8 : hw; // reach over to the other rail on the side they touch
      if (Math.abs(lx) > inner || Math.abs(lz) > hd) continue;
      const y = this.deckY(s, clamp(lx, -hw, hw), lz);
      if (best === null || y > best) best = y;
    }
    return best;
  }

  // who a fighter goes for: her crew for the captain and his men, the nearest of her crew for yours
  // (no more than two of hers go for the captain at once; the rest take on his men, as in any real melee)
  foeFor(n) {
    if (this.surrendered) return null;
    const w = this.g.walker;
    const onCaptain = n.side === 'enemy' ? this.foes.filter((f) => f !== n && !f.dead && f.curTarget === w).length : 0;
    const list = n.side === 'ally' ? this.foes : onCaptain >= 2 && n.curTarget !== w ? this.allies : [w, ...this.allies];
    let best = null, bd = Infinity;
    for (const f of list) {
      if (!f || f.dead || f.flying || f.surrendered) continue;
      const d = f.pos.distanceToSquared(n.pos);
      if (d < bd) { bd = d; best = f; }
    }
    if (!best && n.side === 'enemy' && w && !w.dead && !w.flying) best = w;
    n.curTarget = best;
    return best;
  }

  // ---------------------------------------------------------------- update
  update(dt) {
    const g = this.g, w = g.walker;
    this.t += dt;
    // grapple lines stay taut between the rails
    for (const L of this.lines) {
      const a = this.deckPoint(this.own, this.side * 1.05, L.u).add(new THREE.Vector3(0, 1, 0));
      const b = this.deckPoint(this.enemy, -this.side * 1.05, L.u).add(new THREE.Vector3(0, 1, 0));
      L.line.geometry.setFromPoints([a, b]);
    }
    // the boarders swing across
    if (this.phase === 'grapple') {
      if ((g.input.hit('Space') || this.t > 6) && w && !w.dead) this.swing();
    }
    for (const f of this.flights) this.fly(f, dt);
    this.flights = this.flights.filter((f) => f.t < 1);
    if (this.phase === 'fight') {
      const alive = this.foes.filter((f) => !f.dead && !f.surrendered);
      // they strike when there's no fight left in them
      if (!this.surrendered && alive.length <= Math.max(1, Math.floor(this.nFoes * 0.25)) && Math.random() < dt * 0.5) {
        this.surrendered = true;
        for (const f of alive) { f.surrendered = true; f.hostile = false; f.side = null; f.kind = 'civilian'; f.animState.activity = 'sit'; f.fleeT = 0; }
        g.ui.toast(`The ${this.enemy.name} strikes her colours!`, 'good', 3000);
      }
      if (!alive.length || this.surrendered) { this.phase = 'won'; this.wonT = 0; if (!this.surrendered) g.ui.toast(`The ${this.enemy.name}'s deck is yours!`, 'good', 3000); }
    }
    if (this.phase === 'won') {
      this.wonT += dt;
      if (this.wonT > 2.5 && !this.done) { this.done = true; this.finish(); }
    }
  }

  // everyone swings across on lines from the yards: the captain first
  swing() {
    const g = this.g;
    this.phase = 'fight';
    g.ui.toast('Away boarders!', 'warn', 2000);
    g.audio.grunt(g.walker.pos);
    const land = (i) => this.deckPoint(this.enemy, -this.side * rand(0.1, 0.6), rand(-0.6, 0.6));
    const mast = this.enemy.position.clone().add(new THREE.Vector3(0, this.deckY(this.enemy, 0, 0) - this.enemy.position.y + 12, 0));
    this.flights.push({ who: g.walker, from: g.walker.pos.clone(), to: land(0), t: 0, dur: 1.3, pivot: mast, line: this.ropeLine() });
    g.walker.flying = true;
    this.allies.forEach((a, i) => {
      a.flying = true;
      this.flights.push({ who: a, from: a.pos.clone(), to: land(i + 1), t: -0.2 - i * 0.18, dur: 1.2, pivot: mast.clone().add(new THREE.Vector3(rand(-3, 3), 0, rand(-3, 3))), line: this.ropeLine() });
    });
  }

  ropeLine() {
    const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0x2a1e12 }));
    line.frustumCulled = false;
    this.g.scene.add(line);
    return line;
  }

  fly(f, dt) {
    f.t += dt / f.dur;
    const k = clamp(f.t, 0, 1);
    const w = f.who;
    if (f.t < 0) return;
    // an arc under the swinging line: out and up, across, and down onto her deck
    const p = f.from.clone().lerp(f.to, k);
    p.y += Math.sin(Math.PI * k) * 3.2;
    w.pos.copy(p);
    w.vel.set(0, 0, 0); w.vy = 0;
    const d = f.to.clone().sub(f.from);
    w.yaw = Math.atan2(-d.x, -d.z);
    if (w.isPlayer) { w.mode = 'air'; w.leaping = true; w.leapT = 0.5; w.fallTop = p.y; }
    f.line.visible = k < 0.95;
    f.line.geometry.setFromPoints([f.pivot, p.clone().add(new THREE.Vector3(0, 2, 0))]);
    if (f.t >= 1) {
      w.flying = false;
      this.g.scene.remove(f.line);
      if (w.isPlayer) { w.mode = 'ground'; w.leaping = false; w.fallTop = w.pos.y; this.g.ui.hint('[WASD] move · [Left Click] cutlass · hold [Right Click] aim a pistol · cut them down or make them strike', true); }
    }
  }

  // ---------------------------------------------------------------- the end of it
  finish() {
    const g = this.g, p = this.own;
    const fallen = this.allies.filter((a) => a.dead).length;
    const losses = Math.min(p.crew - 1, Math.round(fallen * (p.crew / Math.max(1, this.nAllies)) * 0.5 * (p.refit?.surgeon ? 0.6 : 1)));
    p.crew = Math.max(1, p.crew - losses);
    this.enemy.crew = Math.max(2, Math.round(this.enemy.crew * (this.foes.filter((f) => !f.dead).length / this.nFoes)));
    g.plunderPrize(this.enemy, losses, () => this.cleanup());
  }

  // cut the lashings, bring everyone home
  cleanup() {
    const g = this.g;
    for (const L of this.lines) g.scene.remove(L.line);
    for (const f of this.flights) g.scene.remove(f.line);
    for (const n of [...this.allies, ...this.foes]) { n.dispose(); }
    g.npcs = g.npcs.filter((n) => !this.allies.includes(n) && !this.foes.includes(n));
    for (const s of [this.own, this.enemy]) s.lashed = false;
    g.boarding = null;
    if (g.mode === 'foot') g.enterSail();
  }
}
