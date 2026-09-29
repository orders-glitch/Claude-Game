// Sailing ship entity: wind-driven physics, buoyancy, groundings, broadsides, damage, fire & sinking.
import * as THREE from 'three';
import { buildShipModel } from './shipModel.js';
import { Wake } from './effects.js';
import { SHIP_CLASSES, NATIONS, AMMO } from '../game/data.js';
import { clamp, lerp, damp, wrapAngle, rand, smoothstep } from '../core/noise.js';

export const BALL_SPEED = 115;
export const GRAVITY = 15;

let shipIdCounter = 1;
const UP = new THREE.Vector3(0, 1, 0);

// Efficiency of the rig by angle between the bow and the direction the wind blows toward.
export function sailEfficiency(theta, upwind) {
  // theta: 0 = running dead downwind, PI = head to wind
  const closest = lerp(1.25, 0.78, upwind); // radians off the wind the rig can point
  const irons = Math.PI - closest;
  let e;
  if (theta < 0.8) e = lerp(0.72, 1.0, theta / 0.8);
  else if (theta < 1.7) e = lerp(1.0, 0.95, (theta - 0.8) / 0.9);
  else e = lerp(0.95, 0.5 + upwind * 0.25, clamp((theta - 1.7) / (irons - 1.7), 0, 1));
  const ironsT = smoothstep(irons - 0.05, irons + 0.3, theta);
  return lerp(e, 0.06, ironsT);
}

export class Ship {
  constructor(game, clsId, nationId, opts = {}) {
    this.id = shipIdCounter++;
    this.game = game;
    this.cls = SHIP_CLASSES[clsId];
    this.clsId = clsId;
    this.nation = NATIONS[nationId];
    this.nationId = nationId;
    this.role = opts.role || 'merchant';
    this.name = opts.name || 'Unnamed';
    this.isPlayer = !!opts.isPlayer;
    this.flagKind = opts.flag || this.nation.flag;
    this.model = buildShipModel(this.cls, this.nation, { flag: this.flagKind, seed: this.id, sailTint: opts.sailTint, crewFigures: opts.crewFigures });
    this.group = new THREE.Group();
    this.group.add(this.model.group);
    this.group.rotation.order = 'YXZ';
    this.group.name = 'ship_' + this.name;

    const m = opts.strength || 1;
    this.hullMax = this.cls.hull * m;
    this.hull = opts.hull ?? this.hullMax;
    this.sailsMax = this.cls.sails;
    this.sails = opts.sails ?? this.sailsMax;
    this.crew = opts.crew ?? Math.round(this.cls.crewMax * (opts.crewFrac ?? 0.8));
    this.gunDamage = opts.gunDamage || 1;
    this.gunRange = opts.gunRange || 1;
    this.reloadBase = opts.reloadBase || 7.5;

    this.position = new THREE.Vector3(opts.x || 0, 0, opts.z || 0);
    this.heading = opts.heading || 0;
    this.speed = opts.speed ?? 0;
    this.drift = new THREE.Vector2();
    this.forward = new THREE.Vector3();
    this.right = new THREE.Vector3();
    this.sailTarget = opts.sailTarget ?? 2;
    this.sailSet = this.sailTarget / 2;
    this.rudder = 0;
    this.rudderInput = 0;
    this.reload = { port: 0, starboard: 0 };
    this.ammo = 'round';
    this.cargo = opts.cargo || {};
    this.gold = opts.gold || 0;
    this.struck = false;
    this.sinking = false;
    this.sunk = false;
    this.sinkT = 0;
    this.fire = 0;
    this.anchored = !!opts.anchored;
    this.aground = 0;
    this.lastHitBy = null;
    this.aggro = new Set();
    this.pitch = 0; this.roll = 0; this.y = 0;
    this.effTheta = 0;
    this.eff = 1;
    this.windSide = 1;
    this.ai = null;
    this.updateAxes();
    this.wake = new Wake(this);
    this.bounds = { hx: this.cls.beam * 0.5, hz: this.cls.length * 0.5, yMin: -this.model.draft, yMax: this.model.deckY + 3 };
  }

  updateAxes() {
    const s = Math.sin(this.heading), c = Math.cos(this.heading);
    this.forward.set(-s, 0, -c);
    this.right.set(c, 0, -s);
  }

  get alive() { return !this.sinking && !this.sunk; }
  get speedKnots() { return this.speed * 0.45; }

  reloadTime() {
    const crewF = clamp(this.crew / (this.cls.crewMax * 0.55), 0.25, 1);
    return this.reloadBase / crewF;
  }

  update(dt, world) {
    const cls = this.cls;
    const wind = world.wind;
    this.updateAxes();
    if (this.sinking) return this.updateSinking(dt, world);

    // --- sails & wind
    const target = this.struck || this.anchored ? 0 : this.sailTarget / 2;
    this.sailSet = damp(this.sailSet, target, 1.2, dt);
    const dotW = clamp(this.forward.x * wind.x + this.forward.z * wind.z, -1, 1);
    const theta = Math.acos(dotW);
    this.effTheta = theta;
    this.eff = sailEfficiency(theta, cls.upwind);
    const sailHealth = Math.sqrt(clamp(this.sails / this.sailsMax, 0.05, 1));
    const crewF = clamp(this.crew / Math.max(1, cls.crewMin * 1.5), 0.3, 1);
    const hullF = 0.7 + 0.3 * clamp(this.hull / this.hullMax, 0, 1);
    const cargoLoad = this.cargoCount() / Math.max(1, cls.cargo);
    const loadF = 1 - cargoLoad * 0.12;
    let targetSpeed = cls.speed * this.sailSet * this.eff * wind.strength * sailHealth * crewF * hullF * loadF * (this.speedMult || 1);
    if (this.aground > 0) targetSpeed *= 0.2;
    const accel = targetSpeed > this.speed ? 0.22 : 0.35;
    this.speed = damp(this.speed, targetSpeed, accel, dt);

    // --- steering
    this.rudder = damp(this.rudder, this.rudderInput, 3, dt);
    const steerF = 0.2 + 0.8 * clamp(this.speed / 9, 0, 1);
    const turnRate = cls.turn * 0.36 * steerF * (this.anchored ? 0.3 : 1);
    this.heading = wrapAngle(this.heading + this.rudder * turnRate * dt);
    this.updateAxes();

    // leeway: slight sideways drift with the wind
    const windSide = wind.x * this.right.x + wind.z * this.right.z;
    this.windSide = windSide >= 0 ? 1 : -1;
    const leeway = windSide * 0.9 * this.sailSet * wind.strength * (1 - cls.upwind * 0.5);
    const vx = this.forward.x * this.speed + this.right.x * leeway;
    const vz = this.forward.z * this.speed + this.right.z * leeway;
    this.position.x += vx * dt;
    this.position.z += vz * dt;
    this.velocity = this.velocity || new THREE.Vector3();
    this.velocity.set(vx, 0, vz);

    this.collideLand(dt, world);
    this.collideBlockers(world);

    // --- rippling broadside
    if (this.pendingShots?.length) this.updateShots(dt, world);
    // --- reloads
    this.reload.port = Math.max(0, this.reload.port - dt);
    this.reload.starboard = Math.max(0, this.reload.starboard - dt);

    // --- fire aboard
    if (this.fire > 0) {
      this.fire -= dt * (0.4 + clamp(this.crew / cls.crewMax, 0, 1));
      this.hull -= dt * 1.6;
      const p = this.localToWorld(new THREE.Vector3(rand(-1, 1), this.model.deckY + 1, rand(-this.cls.length * 0.3, this.cls.length * 0.3)));
      world.effects.burn(p, 1.2);
      if (this.hull <= 0) this.startSinking(world);
    } else if (this.hull < this.hullMax * 0.35 && Math.random() < dt * 3) {
      const p = this.localToWorld(new THREE.Vector3(rand(-2, 2), this.model.deckY, rand(-this.cls.length * 0.35, this.cls.length * 0.35)));
      world.effects.burn(p, 0.5);
    }

    this.updateFloat(dt, world);
    this.updateVisuals(dt, wind);
  }

  cargoCount() {
    let n = 0;
    for (const k in this.cargo) n += this.cargo[k];
    return n;
  }

  collideLand(dt, world) {
    const t = world.terrain;
    const L = this.cls.length, B = this.cls.beam;
    const keel = -this.model.draft * 0.75;
    const f = this.forward, r = this.right;
    const pts = [[0, 0.5], [0.3, 0.3], [-0.3, 0.3], [0, 0], [0.5, 0], [-0.5, 0], [0, -0.45]];
    let hitAny = false;
    const nrm = this._n || (this._n = new THREE.Vector3());
    for (const [sx, sz] of pts) {
      const px = this.position.x + f.x * sz * L + r.x * sx * B;
      const pz = this.position.z + f.z * sz * L + r.z * sx * B;
      if (t.quickHeight(px, pz) < -14) continue;
      const h = t.height(px, pz);
      if (h > keel) {
        hitAny = true;
        t.normal(px, pz, nrm);
        let nx = nrm.x, nz = nrm.z;
        const len = Math.hypot(nx, nz) || 1;
        nx /= len; nz /= len;
        const pen = clamp(h - keel, 0, 4);
        this.position.x += nx * pen * 0.35;
        this.position.z += nz * pen * 0.35;
        const into = -(f.x * nx + f.z * nz);
        if (into > 0.2 && this.speed > 7 && this.aground <= 0) {
          const dmg = (this.speed - 6) * 1.8 * into;
          this.damage(dmg, 0, 0, world, null);
          world.effects.hit(new THREE.Vector3(px, 1, pz), 1);
          world.audio?.crunch(this.position);
          if (this.isPlayer) world.ui?.toast('Aground! The hull scrapes the reef.', 'warn');
        }
        this.speed *= 1 - clamp(into, 0, 1) * 0.5;
      }
    }
    this.aground = hitAny ? 0.5 : Math.max(0, this.aground - dt);
  }

  collideBlockers(world) {
    for (const b of world.shipBlockers) {
      const dx = this.position.x - b.x, dz = this.position.z - b.z;
      if (dx * dx + dz * dz > 40000) continue;
      // treat the ship as three circles along its length
      for (const s of [-0.35, 0, 0.35]) {
        const px = this.position.x + this.forward.x * s * this.cls.length;
        const pz = this.position.z + this.forward.z * s * this.cls.length;
        const ddx = px - b.x, ddz = pz - b.z;
        const lx = ddx * b.cos - ddz * b.sin;
        const lz = ddx * b.sin + ddz * b.cos;
        const rad = this.cls.beam * 0.55;
        const cx = clamp(lx, -b.hw, b.hw), cz = clamp(lz, -b.hd, b.hd);
        const ox = lx - cx, oz = lz - cz;
        const d = Math.hypot(ox, oz);
        if (d < rad) {
          const push = rad - d;
          let nx = d > 0.001 ? ox / d : 1, nz = d > 0.001 ? oz / d : 0;
          // back to world
          const wx = nx * b.cos + nz * b.sin;
          const wz = -nx * b.sin + nz * b.cos;
          this.position.x += wx * push;
          this.position.z += wz * push;
          this.speed *= 0.9;
        }
      }
    }
  }

  updateFloat(dt, world) {
    const o = world.ocean;
    const L = this.cls.length * 0.4, B = this.cls.beam * 0.45;
    const p = this.position, f = this.forward, r = this.right;
    const hb = o.heightAt(p.x + f.x * L, p.z + f.z * L);
    const hs = o.heightAt(p.x - f.x * L, p.z - f.z * L);
    const hp = o.heightAt(p.x - r.x * B, p.z - r.z * B);
    const hst = o.heightAt(p.x + r.x * B, p.z + r.z * B);
    const avg = (hb + hs + hp + hst) * 0.25;
    const damageSink = (1 - clamp(this.hull / this.hullMax, 0, 1)) * 0.8;
    this.y = damp(this.y, avg - damageSink, 6, dt);
    const pitch = Math.atan2(hb - hs, L * 2) * 0.85;
    const windLocal = world.wind.x * r.x + world.wind.z * r.z;
    const heel = -windLocal * this.sailSet * world.wind.strength * 0.09 * Math.sin(this.effTheta) * (this.cls.rig === 'sloop' ? 1.4 : 1);
    const turnHeel = this.rudder * clamp(this.speed / 25, 0, 1) * 0.05;
    const roll = Math.atan2(hst - hp, B * 2) * 0.8 + heel + turnHeel + (this.listAngle || 0);
    this.pitch = damp(this.pitch, pitch, 5, dt);
    this.roll = damp(this.roll, roll, 4, dt);
    this.group.position.set(p.x, this.y, p.z);
    this.group.rotation.set(this.pitch, this.heading, this.roll);
  }

  updateVisuals(dt, wind) {
    const u = this.model.sailUniforms;
    u.uFurl.value = clamp(this.sailSet, 0.04, 1);
    u.uFill.value = clamp(this.eff * 1.1 - 0.05, 0, 1) * wind.strength;
    // brace the yards: square sails swing toward the wind's direction
    const localWindAngle = Math.atan2(wind.x * this.right.x + wind.z * this.right.z, wind.x * this.forward.x + wind.z * this.forward.z);
    // localWindAngle: 0 = wind from astern
    const brace = clamp(localWindAngle * 0.35, -0.55, 0.55);
    u.uBrace.value = damp(u.uBrace.value, -brace, 1.5, dt);
    const boom = clamp(localWindAngle * 0.45, -0.9, 0.9);
    u.uBoom.value = damp(u.uBoom.value, -boom, 1.5, dt);
    u.uSide.value = damp(u.uSide.value, localWindAngle >= 0 ? 1 : -1, 2, dt);
    u.uDamage.value = 1 - clamp(this.sails / this.sailsMax, 0, 1);
  }

  localToWorld(v) {
    this.group.updateMatrixWorld();
    return v.applyMatrix4(this.model.group.matrixWorld);
  }

  worldToLocal(v) {
    this.group.updateMatrixWorld();
    const inv = this._inv || (this._inv = new THREE.Matrix4());
    inv.copy(this.model.group.matrixWorld).invert();
    return v.applyMatrix4(inv);
  }

  // side: 'port' (-x) or 'starboard' (+x). elevation radians.
  fireBroadside(side, elevation, world, aimYaw = 0) {
    if (!this.alive || this.struck) return false;
    if (this.reload[side] > 0) return false;
    const s = side === 'port' ? -1 : 1;
    const guns = this.model.gunPositions.filter((g) => Math.sign(g.x) === s);
    if (!guns.length) return false;
    const crewGuns = Math.max(1, Math.round(guns.length * clamp(this.crew / (this.cls.crewMax * 0.4), 0.2, 1)));
    this.reload[side] = this.reloadTime();
    const ammo = AMMO[this.ammo];
    const vel = BALL_SPEED * (0.75 + 0.25 * ammo.range) * this.gunRange;
    this.group.updateMatrixWorld();
    const mw = this.model.group.matrixWorld;
    const dirLocal = new THREE.Vector3(s * Math.cos(aimYaw), 0, -Math.sin(aimYaw) * s);
    const baseDir = dirLocal.clone().transformDirection(mw);
    baseDir.y = 0; baseDir.normalize();
    const used = guns.slice(0, crewGuns);
    this.pendingShots = this.pendingShots || [];
    used.forEach((g, i) => {
      this.pendingShots.push({ t: i * 0.07 + Math.random() * 0.05, gun: g, s, elevation, baseDir, vel });
    });
    world.audio?.broadside(this.position, used.length, this.isPlayer);
    return true;
  }

  updateShots(dt, world) {
    const keep = [];
    this.group.updateMatrixWorld();
    for (const sh of this.pendingShots) {
      sh.t -= dt;
      if (sh.t > 0) { keep.push(sh); continue; }
      const wp = sh.gun.clone().applyMatrix4(this.model.group.matrixWorld);
      const el = sh.elevation + rand(-0.012, 0.012) + this.roll * sh.s * 0.5;
      const d = sh.baseDir.clone().applyAxisAngle(UP, rand(-0.025, 0.025));
      const v = new THREE.Vector3(d.x * Math.cos(el), Math.sin(el), d.z * Math.cos(el)).multiplyScalar(sh.vel);
      v.x += this.velocity?.x || 0; v.z += this.velocity?.z || 0;
      world.projectiles.spawn(wp, v, this, this.ammo);
      world.effects.muzzle(wp, d, true);
    }
    this.pendingShots = keep;
  }

  // Point-in-hull test for projectiles. Returns 'hull', 'rig' or null.
  hitTest(worldPoint) {
    const p = this.worldToLocal(worldPoint.clone());
    const L = this.cls.length * 0.5, B = this.cls.beam * 0.5;
    if (Math.abs(p.z) > L + 1) return null;
    const t = 1 - (p.z + L) / (2 * L); // 0 stern -> 1 bow
    const bw = t > 0.5 ? B * Math.cos((t - 0.5) / 0.5 * Math.PI / 2) ** 0.7 + 0.4 : B + 0.3;
    if (p.y > -this.model.draft && p.y < this.model.deckY + 1.6 && Math.abs(p.x) < bw) return 'hull';
    const mastH = this.cls.length * 1.05;
    if (p.y >= this.model.deckY + 1.6 && p.y < mastH && Math.abs(p.x) < this.cls.beam * 1.1 && Math.abs(p.z) < L * 0.9) return 'rig';
    return null;
  }

  damage(hullDmg, sailDmg, crewDmg, world, attacker) {
    if (!this.alive) return;
    this.hull -= hullDmg;
    this.sails = Math.max(0, this.sails - sailDmg);
    this.crew = Math.max(0, this.crew - crewDmg);
    if (attacker) {
      this.lastHitBy = attacker;
      this.aggro.add(attacker.id);
    }
    if (this.hull <= 0) {
      this.hull = 0;
      this.startSinking(world);
    } else if (this.crew <= 0 && !this.isPlayer) {
      this.strike(world);
    }
  }

  onBallHit(zone, ammoId, ball, world) {
    const a = AMMO[ammoId];
    const dm = ball.damage;
    if (zone === 'hull') {
      const crewLoss = Math.random() < 0.6 ? Math.ceil(rand(0, 2.2) * a.crew * dm) : 0;
      this.damage(7 * a.hull * dm, 1 * a.sails, crewLoss, world, ball.owner);
      if (ammoId === 'round' && Math.random() < 0.03) this.fire = Math.max(this.fire, 8);
      if (this.hull > 0 && this.hull < this.hullMax * 0.2 && Math.random() < 0.012 && !this.isPlayer) {
        // magazine detonation
        world.effects.explosion(this.group.position.clone().setY(3));
        world.audio?.explosion(this.position);
        this.hull = 0;
        this.startSinking(world);
      }
    } else if (zone === 'rig') {
      const crewLoss = Math.random() < 0.3 ? Math.ceil(rand(0, 1.5) * a.crew * dm) : 0;
      this.damage(0, 5 * a.sails * dm, crewLoss, world, ball.owner);
    }
  }

  strike(world) {
    if (this.struck || this.isPlayer) return;
    this.struck = true;
    this.model.setFlag('white');
    this.sailTarget = 0;
    world.onShipStruck?.(this);
  }

  startSinking(world) {
    if (this.sinking) return;
    this.sinking = true;
    this.sinkT = 0;
    this.sinkRollDir = Math.random() < 0.5 ? -1 : 1;
    world.onShipSinking?.(this);
  }

  updateSinking(dt, world) {
    this.sinkT += dt;
    this.pendingShots = [];
    const t = this.sinkT;
    const o = world.ocean;
    const h = o.heightAt(this.position.x, this.position.z);
    this.speed = damp(this.speed, 0, 0.5, dt);
    this.position.x += this.forward.x * this.speed * dt;
    this.position.z += this.forward.z * this.speed * dt;
    this.y = h - t * t * 0.035 - t * 0.12;
    this.roll = damp(this.roll, this.sinkRollDir * Math.min(0.9, t * 0.05), 0.8, dt);
    this.pitch = damp(this.pitch, Math.min(0.35, t * 0.015), 0.5, dt);
    this.group.position.set(this.position.x, this.y, this.position.z);
    this.group.rotation.set(this.pitch, this.heading, this.roll);
    this.model.sailUniforms.uFurl.value = damp(this.model.sailUniforms.uFurl.value, 0.2, 0.5, dt);
    this.model.sailUniforms.uFill.value = 0;
    if (t < 14 && Math.random() < 0.9) {
      const p = this.localToWorld(new THREE.Vector3(rand(-2, 2), this.model.deckY, rand(-this.cls.length * 0.4, this.cls.length * 0.4)));
      if (p.y > h - 1) world.effects.burn(p, 1.3);
      if (Math.random() < 0.15) world.effects.splash(p.x, p.z, 0.6);
    }
    if (this.y < -(this.cls.length * 1.2 + 12)) this.sunk = true;
  }

  setVisibleFlag(kind) {
    this.flagKind = kind;
    this.model.setFlag(kind);
  }

  dispose(scene) {
    scene.remove(this.group);
    this.group.traverse((o) => {
      if (o.isMesh || o.isLineSegments) {
        o.geometry.dispose();
      }
    });
    this.model.sails.material.dispose();
  }
}
