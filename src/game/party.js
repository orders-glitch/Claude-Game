// The shore party: when the captain goes ashore, a party of his crew goes with him, and men from the ships of
// his squadron lying near join them. They follow him through the streets and over the beaches, run to keep up,
// and fight whatever he fights: guards who have called the alarm, pirates who turn on him, soldiers at the
// salvage camp. [T] tells them to stand fast where they are, or to follow again. A man who falls is gone from
// the crew of the ship he came from.
import * as THREE from 'three';
import { NPC, lookFor } from '../entities/actors.js';
import { clamp, rand } from '../core/noise.js';

const MAX = 9;

export class ShoreParty {
  constructor(game) {
    this.g = game;
    this.men = [];
    this.mustered = false;
    this.stand = false;
    this.lostT = 0;
  }

  // who comes ashore: hands from your own ship, and a few from each consort lying within a couple of miles
  muster() {
    const g = this.g, w = g.walker, p = g.playerShip, s = g.state;
    if (!w || !p || g.boarding) return;
    this.mustered = true;
    this.stand = false;
    const from = [];
    const own = clamp(Math.round(p.crew / 10), 2, 5);
    for (let i = 0; i < own; i++) from.push({ src: 'flag' });
    for (const e of g.fleet?.list || []) {
      const sh = g.fleet.ships.get(e.id);
      if (!sh || sh.position.distanceTo(p.position) > 2500) continue;
      const n = Math.min(2, Math.round(e.crew / 15));
      for (let i = 0; i < n; i++) from.push({ src: e.id, ship: e.name });
    }
    from.splice(MAX);
    from.forEach((f, k) => {
      const a = w.yaw + Math.PI + (k - (from.length - 1) / 2) * 0.5, r = 2.5 + Math.floor(k / 4) * 1.5;
      let x = w.pos.x + Math.sin(a) * r, z = w.pos.z + Math.cos(a) * r;
      if (g.surfaceAt(x, z, w.pos.y + 1) < -0.5) { x = w.pos.x + rand(-1, 1); z = w.pos.z + rand(-1, 1); }
      const n = new NPC(g, lookFor('pirate', 'pirate'), { x, y: g.surfaceAt(x, z, w.pos.y + 1), z, kind: 'pirate', nation: 'pirate', health: 80 });
      n.side = 'ally';
      n.partyMember = f;
      n.weapon = k % 3 === 1 ? 'musket' : 'cutlass';
      n.yaw = w.yaw;
      g.npcs.push(n);
      this.men.push(n);
    });
    if (this.men.length) g.ui.toast(`${this.men.length} of your people come ashore with you${from.some((f) => f.src !== 'flag') ? ', some from the squadron' : ''}. [T] stand fast / follow.`, 'info', 4500);
  }

  disband() {
    const g = this.g;
    for (const n of this.men) { g.npcs = g.npcs.filter((x) => x !== n); n.dispose(); }
    this.men = [];
    this.mustered = false;
  }

  // nearest enemy for one of your men: anyone hostile to you near him, or near you
  foeFor(n) {
    const g = this.g, w = g.walker;
    let best = null, bd = Infinity;
    for (const o of g.npcs) {
      if (o.side || o.dead || o.surrendered) continue;
      if (!(o.hostile || g.isWalkerHostile(o))) continue;
      const d = o.pos.distanceTo(n.pos);
      if (d > 32 && (!w || o.pos.distanceTo(w.pos) > 28)) continue;
      if (d < bd) { bd = d; best = o; }
    }
    return best;
  }

  // whom a hostile townsman goes for: you, or one of your men if he's nearer
  victimFor(o) {
    const w = this.g.walker;
    let best = w, bd = w && !w.dead ? w.pos.distanceTo(o.pos) - 2 : Infinity;
    for (const n of this.men) {
      if (n.dead) continue;
      const d = n.pos.distanceTo(o.pos);
      if (d < bd) { bd = d; best = n; }
    }
    return best;
  }

  toggleStand() {
    if (!this.men.some((n) => !n.dead)) return;
    this.stand = !this.stand;
    for (const n of this.men) n.standAt = this.stand ? n.pos.clone() : null;
    this.g.ui.toast(this.stand ? '“Stand fast, lads — wait here for me.”' : '“With me, lads!”', 'info', 1800);
  }

  // conspicuous: a gang of armed seamen at your heels draws the watch's eye
  conspicuous() {
    const w = this.g.walker;
    if (!w) return 0;
    return this.men.filter((n) => !n.dead && n.pos.distanceTo(w.pos) < 15).length;
  }

  update(dt) {
    const g = this.g, w = g.walker;
    if (g.mode !== 'foot' || !w || g.boarding) { if (this.mustered && g.mode !== 'foot') this.disband(); return; }
    // muster once you're on dry land (not while rowing or swimming out)
    if (!this.mustered) {
      const dry = w.mode === 'ground' && g.ocean.heightAt(w.pos.x, w.pos.z) < w.pos.y - 0.2 && !g.seaside?.rowing;
      if (dry) this.muster();
      return;
    }
    const water = w.mode === 'swim' || g.seaside?.rowing;
    const alive = this.men.filter((n) => !n.dead);
    alive.forEach((n, k) => {
      // a station a few paces behind you, in a loose knot
      if (this.stand && n.standAt) { n.followGoal = n.standAt; return; }
      if (water) { n.followGoal = null; return; } // they wait on the shore
      const a = w.yaw + Math.PI + (k - (alive.length - 1) / 2) * 0.5, r = 2.6 + Math.floor(k / 4) * 1.6;
      const gx = w.pos.x + Math.sin(a) * r, gz = w.pos.z + Math.cos(a) * r;
      const up = w.pos.y - g.groundAt(w.pos.x, w.pos.z) > 2.2; // on a roof: wait below
      n.followGoal = new THREE.Vector3(gx, 0, gz);
      n.followRun = w.mode !== 'ground' || (w.sprintT || 0) > 0.1 || n.pos.distanceTo(w.pos) > 9;
      // left far behind (you went over the roofs, or round the town): they catch up out of sight
      if (!up && n.pos.distanceTo(w.pos) > 70) {
        const b = new THREE.Vector3(gx - Math.sin(w.yaw) * 12, 0, gz - Math.cos(w.yaw) * 12);
        if (g.surfaceAt(b.x, b.z, w.pos.y + 1) > -0.5) { n.pos.set(b.x, g.surfaceAt(b.x, b.z, w.pos.y + 1), b.z); n.vel.set(0, 0, 0); }
      }
      // wounds mend out of a fight
      if (!g.combatNear && n.health < n.maxHealth) n.health = Math.min(n.maxHealth, n.health + dt * 3);
    });
    // the fallen come off the books of the ship they came from
    for (const n of this.men) {
      if (!n.dead || n.counted) continue;
      n.counted = true;
      const f = n.partyMember, s = g.state;
      if (f.src === 'flag') { s.ship.crew = Math.max(1, s.ship.crew - 1); if (g.playerShip) g.playerShip.crew = s.ship.crew; }
      else { const e = g.fleet?.list.find((x) => x.id === f.src); if (e) { e.crew = Math.max(1, e.crew - 1); const sh = g.fleet.ships.get(e.id); if (sh) sh.crew = e.crew; } }
      if (performance.now() - this.lostT > 4000) { this.lostT = performance.now(); g.ui.toast(`One of your men is down${f.ship ? ` (from the ${f.ship})` : ''}.`, 'warn', 2500); }
    }
  }
}
