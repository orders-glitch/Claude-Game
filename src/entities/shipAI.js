// Captain AI: trading voyages, patrols, pursuit, broadside manoeuvring, flight and surrender.
import * as THREE from 'three';
import { clamp, wrapAngle, rand } from '../core/noise.js';
import { BALL_SPEED, GRAVITY } from './ship.js';

function headingTo(dx, dz) { return Math.atan2(-dx, -dz); }

export class ShipAI {
  constructor(ship, opts = {}) {
    this.ship = ship;
    this.mode = opts.mode || 'trade';
    this.dest = opts.dest ? new THREE.Vector3(opts.dest.x, 0, opts.dest.z) : null;
    this.home = opts.home ? new THREE.Vector3(opts.home.x, 0, opts.home.z) : ship.position.clone();
    this.target = null;
    this.think = rand(0, 0.5);
    this.tackSide = Math.random() < 0.5 ? 1 : -1;
    this.tackTimer = 0;
    this.desired = ship.heading;
    this.aggressive = opts.aggressive ?? (ship.role === 'navy' || ship.role === 'hunter' || ship.role === 'pirate');
    this.courage = opts.courage ?? (ship.role === 'merchant' ? 0.2 : ship.role === 'hunter' ? 1 : 0.7);
    this.leader = opts.leader || null;
    this.fireCooldown = 0;
    this.patrolR = opts.patrolR || 800;
    this.stuck = 0;
    this.lastPos = ship.position.clone();
  }

  update(dt, world) {
    const s = this.ship;
    if (!s.alive) return;
    if (s.struck) { s.rudderInput = 0; return; }
    this.think -= dt;
    this.fireCooldown -= dt;
    if (this.think <= 0) {
      this.think = 0.4 + Math.random() * 0.3;
      this.decide(world);
    }
    this.steer(dt, world);
    if (this.target && this.mode === 'attack') this.tryFire(world);
  }

  decide(world) {
    const s = this.ship;
    // threat & target selection
    let best = null, bestD = Infinity;
    for (const o of world.ships) {
      if (o === s || !o.alive || o.struck) continue;
      const d = o.position.distanceTo(s.position);
      if (d > 900) continue;
      if (!world.isHostile(s, o)) continue;
      if (d < bestD) { bestD = d; best = o; }
    }
    const hpF = s.hull / s.hullMax;
    if (best) {
      const outgunned = best.cls.guns * (best.hull / best.hullMax) > s.cls.guns * hpF * (1.2 + this.courage * 2);
      if (!this.aggressive || (outgunned && this.courage < 0.8) || hpF < 0.25 * (1 - this.courage)) {
        this.mode = 'flee';
        this.target = best;
        if (s.role === 'merchant' && bestD < 140 && (hpF < 0.55 || s.sails < s.sailsMax * 0.35) && best.isPlayer) s.strike(world);
        if (s.role !== 'hunter' && s.role !== 'navy' && hpF < 0.3 && bestD < 220) s.strike(world);
      } else {
        this.mode = 'attack';
        this.target = best;
      }
    } else if (this.mode === 'attack' || this.mode === 'flee') {
      this.mode = this.dest ? 'trade' : 'patrol';
      this.target = null;
    }
    if (this.mode === 'escort' && this.leader && !this.leader.alive) this.mode = 'trade';
    // stuck detection
    const moved = this.lastPos.distanceTo(s.position);
    this.lastPos.copy(s.position);
    if (moved < 0.8 && s.sailTarget > 0) this.stuck += 1; else this.stuck = Math.max(0, this.stuck - 1);
    if (this.stuck > 12) { this.tackSide *= -1; this.stuck = 0; this.forceTurn = 6; }
  }

  steer(dt, world) {
    const s = this.ship;
    let desired = s.heading;
    s.sailTarget = 2;
    if (this.mode === 'trade' && this.dest) {
      desired = headingTo(this.dest.x - s.position.x, this.dest.z - s.position.z);
      const d = s.position.distanceTo(this.dest);
      if (d < 180) {
        s.sailTarget = 1;
        if (d < 90) { this.arrived = true; s.sailTarget = 0; }
      }
    } else if (this.mode === 'patrol') {
      if (!this.wp || s.position.distanceTo(this.wp) < 150) {
        const a = Math.random() * Math.PI * 2;
        this.wp = this.home.clone().add(new THREE.Vector3(Math.cos(a) * this.patrolR * Math.random(), 0, Math.sin(a) * this.patrolR * Math.random()));
        if (world.terrain.quickHeight(this.wp.x, this.wp.z) > -12) this.wp = this.home.clone();
      }
      desired = headingTo(this.wp.x - s.position.x, this.wp.z - s.position.z);
      s.sailTarget = 1;
    } else if (this.mode === 'escort' && this.leader) {
      const L = this.leader;
      const off = L.right.clone().multiplyScalar(this.escortSide * 70).add(L.forward.clone().multiplyScalar(-60));
      const tp = L.position.clone().add(off);
      desired = headingTo(tp.x - s.position.x, tp.z - s.position.z);
      const d = s.position.distanceTo(tp);
      s.sailTarget = d > 120 ? 2 : d > 40 ? 1 : 1;
    } else if (this.mode === 'attack' && this.target) {
      desired = this.combatHeading();
    } else if (this.mode === 'flee' && this.target) {
      const t = this.target;
      desired = headingTo(s.position.x - t.position.x, s.position.z - t.position.z);
      // prefer a broad reach while fleeing
      desired = wrapAngle(desired + Math.sin(performance.now() * 0.0002 + s.id) * 0.3);
    }

    // don't point into the eye of the wind: tack
    desired = this.avoidIrons(desired, world, dt);
    // avoid land with look-ahead probes
    desired = this.avoidLand(desired, world);
    if (this.forceTurn > 0) { this.forceTurn -= dt; desired = wrapAngle(s.heading + this.tackSide * 1.2); }
    // avoid other ships (not the target when close-hauled for boarding)
    for (const o of world.ships) {
      if (o === s || o.sunk) continue;
      const dx = o.position.x - s.position.x, dz = o.position.z - s.position.z;
      const d = Math.hypot(dx, dz);
      const minD = (o.cls.length + s.cls.length) * 0.7;
      if (d < minD * 1.4) {
        const away = headingTo(-dx, -dz);
        desired = wrapAngle(desired + wrapAngle(away - desired) * 0.6);
      }
    }
    this.desired = desired;
    const err = wrapAngle(desired - s.heading);
    s.rudderInput = clamp(err * 2.5, -1, 1);
  }

  avoidIrons(desired, world, dt) {
    const s = this.ship;
    const w = world.wind;
    const windFrom = headingTo(-w.x, -w.z); // heading pointing into the wind
    const closest = 0.78 + (1 - s.cls.upwind) * 0.5;
    const off = wrapAngle(desired - windFrom);
    if (Math.abs(off) < closest) {
      this.tackTimer -= dt;
      if (this.tackTimer <= 0) { this.tackSide *= -1; this.tackTimer = rand(25, 45); }
      return wrapAngle(windFrom + this.tackSide * (closest + 0.12));
    }
    return desired;
  }

  avoidLand(desired, world) {
    const s = this.ship;
    const t = world.terrain;
    const probe = (h) => {
      const fx = -Math.sin(h), fz = -Math.cos(h);
      let clear = 1e9;
      for (const dist of [30, 70, 120, 190, 270]) {
        const x = s.position.x + fx * dist, z = s.position.z + fz * dist;
        if (t.quickHeight(x, z) > -4) { clear = dist; break; }
      }
      return clear;
    };
    if (probe(desired) > 300) return desired;
    let bestH = desired, bestScore = -Infinity;
    for (let k = 1; k <= 12; k++) {
      for (const sgn of [1, -1]) {
        const h = wrapAngle(desired + sgn * k * 0.22);
        const c = probe(h);
        const score = Math.min(c, 300) - k * 12;
        if (score > bestScore) { bestScore = score; bestH = h; }
      }
    }
    return bestH;
  }

  combatHeading() {
    const s = this.ship, t = this.target;
    const dx = t.position.x - s.position.x, dz = t.position.z - s.position.z;
    const d = Math.hypot(dx, dz);
    const toT = headingTo(dx, dz);
    const ideal = 70 + s.cls.length * 3;
    if (d > ideal * 2.8) return toT; // close the distance
    // present the broadside: keep target abeam, choose side it's already on
    const side = Math.sign(dx * s.right.x + dz * s.right.z) || 1;
    // heading such that target is at +-90deg
    let h = wrapAngle(toT - side * Math.PI / 2 * -1);
    // drift in or out to hold range
    const adj = clamp((d - ideal) / ideal, -0.6, 0.6);
    h = wrapAngle(h - side * adj * 0.8);
    return h;
  }

  tryFire(world) {
    const s = this.ship, t = this.target;
    if (this.fireCooldown > 0) return;
    const lead = s.position.distanceTo(t.position) / BALL_SPEED;
    const px = t.position.x + (t.velocity?.x || 0) * lead, pz = t.position.z + (t.velocity?.z || 0) * lead;
    const dx = px - s.position.x, dz = pz - s.position.z;
    const d = Math.hypot(dx, dz);
    const maxRange = 380;
    if (d > maxRange || d < 15) return;
    const localX = (dx * s.right.x + dz * s.right.z) / d;
    const localZ = (dx * s.forward.x + dz * s.forward.z) / d;
    if (Math.abs(localX) < 0.9) return; // not abeam
    const side = localX > 0 ? 'starboard' : 'port';
    if (s.reload[side] > 0) return;
    // ammo choice: chain to cripple a fleeing ship, grape when close for boarding
    if (s.role === 'hunter' || s.role === 'navy') s.ammo = d < 80 ? 'grape' : t.speed > s.speed + 2 ? 'chain' : 'round';
    else s.ammo = 'round';
    const v = BALL_SPEED * s.gunRange;
    const arg = clamp((GRAVITY * d) / (v * v), 0, 1);
    const el = 0.5 * Math.asin(arg) + rand(-0.015, 0.02) - 0.005;
    const yaw = Math.atan2(localZ, Math.abs(localX)) * (side === 'port' ? -1 : 1);
    if (s.fireBroadside(side, el, world, clamp(yaw, -0.3, 0.3))) this.fireCooldown = rand(0.5, 2.5);
  }
}
