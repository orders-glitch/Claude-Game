// Sailing ship entity: wind-driven physics, buoyancy, groundings, broadsides, damage, fire & sinking.
import * as THREE from 'three';
import { buildShipModel } from './shipModel.js';
import { Wake } from './effects.js';
import { SHIP_CLASSES, NATIONS, AMMO } from '../game/data.js';
import { clamp, lerp, damp, wrapAngle, rand, smoothstep } from '../core/noise.js';
import { sailStep, WIND_SPEED } from './sailing.js';

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
    this.fireT = 0;
    this.strain = 0; // gear overpressed in a squall
    this.shipping = 0; // green seas coming aboard a deep-laden hull
    this.lanternsLit = true;
    this.mastsDown = new Set();
    this.mastLoss = 0; // share of her canvas lost with shot-away topmasts
    this.anchored = !!opts.anchored;
    this.aground = 0;
    this.lastHitBy = null;
    this.aggro = new Set();
    this.pitch = 0; this.roll = 0; this.y = 0;
    this.effTheta = 0;
    this.eff = 1;
    this.windSide = 1;
    this.sway = 0; this.yawRate = 0; this.heel = 0; this.heelTarget = 0; this.sailDraw = 0; this.luff = 0; this.backed = false; this.drive = 0;
    this.aw = { beta: Math.PI, speed: 0, side: 1 };
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

    // --- sails & wind: real forces from the apparent wind (see sailing.js)
    const target = this.struck || this.anchored ? 0 : this.sailTarget / 2;
    this.sailSet = damp(this.sailSet, target, 0.9, dt); // setting and handing sail takes the crew a while
    const w = world.windAt ? world.windAt(this.position.x, this.position.z) : { x: wind.x, z: wind.z, speed: WIND_SPEED * wind.strength };
    this.localWind = w;
    // true wind angle for the instruments: 0 = running dead before it, PI = head to wind
    this.effTheta = Math.acos(clamp(this.forward.x * w.x + this.forward.z * w.z, -1, 1));
    const sailHealth = Math.sqrt(clamp(this.sails / this.sailsMax, 0.05, 1));
    const crewF = clamp(this.crew / Math.max(1, cls.crewMin * 1.5), 0.3, 1);
    const hullF = 0.7 + 0.3 * clamp(this.hull / this.hullMax, 0, 1);
    const cargoLoad = this.cargoCount() / Math.max(1, cls.cargo);
    this.sailPower = sailHealth * crewF * hullF * (1 - this.mastLoss) * (this.speedMult || 1);
    // a full hold and shot-through planking make her sit deeper and drag more
    this.extraDrag = cargoLoad * 0.004 + (1 - hullF) * 0.02 + (this.aground > 0 ? 0.8 : 0) + (this.anchored ? 0.3 : 0);
    this.rudder = damp(this.rudder, this.rudderInput, 3, dt);
    sailStep(this, dt, w);
    if (this.lashed) { this.speed = 0; this.sway = 0; this.yawRate = 0; this.heelTarget = 0; } // grappled alongside another ship
    // Carrying a press of sail into a squall: the canvas splits and the topmasts go (a reefed ship rides it out)
    const press = this.sailSet * w.strength * w.strength;
    if (press > 3 && !this.anchored && !this.lashed && !this.sinking) this.strain += dt * (press - 3) * 0.5;
    else this.strain = Math.max(0, this.strain - dt * 0.6);
    if (this.strain > 8) {
      this.strain = 3;
      this.sails = Math.max(0, this.sails - this.sailsMax * 0.15);
      if (Math.random() < 0.6) this.loseMast(rand(-cls.length * 0.3, cls.length * 0.3), world, new THREE.Vector3(w.x * 40, 0, w.z * 40));
      world.onGearCarried?.(this);
    }
    // heavy seas over a deep-laden hull: she ships green water faster than the pumps clear it
    const sea = world.ocean?.seaState ?? 1;
    this.shipping = sea > 1.5 && cargoLoad > 0.75 && !this.lashed ? (sea - 1.5) * (cargoLoad - 0.6) : 0;
    if (this.shipping > 0) { this.hull -= dt * this.shipping * 5; if (this.hull <= 0) { this.hull = 0; this.startSinking(world); } }
    // how well she's drawing, for the helm's instruments and the AI
    this.eff = clamp(this.drive / 0.9, 0, 1) * (this.backed ? 0 : 1);
    this.heading = wrapAngle(this.heading + this.yawRate * dt);
    this.updateAxes();
    this.windSide = this.aw.side;
    const vx = this.forward.x * this.speed + this.right.x * this.sway;
    const vz = this.forward.z * this.speed + this.right.z * this.sway;
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

    // --- fire aboard: it spreads unless enough hands fight it, burns the planking, then climbs into the rigging
    if (this.fire > 0) {
      const hands = clamp(this.crew / cls.crewMax, 0, 1);
      this.fire = Math.min(12, this.fire + dt * (0.45 - 1.1 * hands));
      this.fireT += dt;
      this.hull -= dt * (0.6 + this.fire * 0.15);
      const n = this.fire > 6 ? 2 : 1;
      for (let i = 0; i < n; i++) {
        const p = this.localToWorld(new THREE.Vector3(rand(-1, 1), this.model.deckY + 1, rand(-this.cls.length * 0.3, this.cls.length * 0.3)));
        world.effects.burn(p, 0.8 + this.fire * 0.08);
      }
      if (this.fire > 5) {
        // the canvas catches: flames run up a mast and the sails burn away
        this.sails = Math.max(0, this.sails - dt * this.fire * 0.22);
        const ms = this.model.masts;
        if (ms?.length && Math.random() < dt * 4) {
          const m = ms[Math.floor(Math.random() * ms.length)];
          if (!this.mastsDown.has(m)) world.effects.burn(this.localToWorld(new THREE.Vector3(rand(-1.5, 1.5), rand(this.model.deckY + 3, m.lCutY), m.lz)), 1 + this.fire * 0.06);
        }
        // and it reaches a ship lying alongside
        for (const o of world.ships) {
          if (o === this || !o.alive || o.fire > 0 || o.sinking) continue;
          if (o.position.distanceTo(this.position) < (o.cls.beam + this.cls.beam) * 0.9 + 2 && Math.random() < dt * 0.08) o.fire = 2.5;
        }
        // a long fire finds the magazine
        if (!this.isPlayer && this.fireT > 30 && Math.random() < dt * 0.02) {
          world.effects.explosion(this.group.position.clone().setY(3));
          world.audio?.explosion(this.position);
          this.hull = 0;
        }
      }
      if (this.fire <= 0) { this.fire = 0; this.fireT = 0; }
      if (this.hull <= 0) this.startSinking(world);
    } else if (this.hull < this.hullMax * 0.35 && Math.random() < dt * 3) {
      const p = this.localToWorld(new THREE.Vector3(rand(-2, 2), this.model.deckY, rand(-this.cls.length * 0.35, this.cls.length * 0.35)));
      world.effects.burn(p, 0.5);
    }

    this.updateFloat(dt, world);
    this.updateVisuals(dt, wind);
    this.bowSpray(dt, world);
  }

  // white water thrown off the bow when she's making way
  bowSpray(dt, world) {
    if (this.speed < 9) return;
    const cam = world.camera?.position;
    if (cam && cam.distanceTo(this.position) > 450) return;
    const rate = (this.speed - 8) * 0.9 * (0.6 + world.ocean.seaState * 0.4);
    if (Math.random() > rate * dt) return;
    const side = Math.random() < 0.5 ? -1 : 1;
    const L = this.cls.length * 0.44, B = this.cls.beam * 0.35;
    const x = this.position.x + this.forward.x * L + this.right.x * side * B;
    const z = this.position.z + this.forward.z * L + this.right.z * side * B;
    const y = world.ocean.heightAt(x, z) + 0.3;
    const out = 2 + Math.random() * 3;
    world.effects.smoke.spawn({
      x, y, z,
      vx: this.right.x * side * out + this.forward.x * this.speed * 0.4,
      vy: 2 + Math.random() * 3,
      vz: this.right.z * side * out + this.forward.z * this.speed * 0.4,
      life: 0.9 + Math.random() * 0.5, size: 0.8, endSize: 3.2, r: 0.93, g: 0.96, b: 1, alpha: 0.55, gravity: 9, drag: 0.8,
    });
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
          // fend off and slide along it: only the way into it is lost
          const into = -(this.forward.x * wx + this.forward.z * wz);
          if (into > 0) this.speed *= 1 - Math.min(1, into) * 0.25;
          this.sway *= 0.5;
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
    // heel to leeward under the side force of the sails, and outward in a turn
    this.heel = damp(this.heel, this.heelTarget, 1.2, dt);
    const heel = -this.heel;
    const turnHeel = (this.yawRate || 0) * clamp(this.speed / 25, 0, 1) * 0.3;
    const roll = Math.atan2(hst - hp, B * 2) * 0.8 + heel + turnHeel + (this.listAngle || 0);
    this.pitch = damp(this.pitch, pitch, 5, dt);
    this.roll = damp(this.roll, roll, 4, dt);
    this.group.position.set(p.x, this.y, p.z);
    this.group.rotation.set(this.pitch, this.heading, this.roll);
  }

  updateVisuals(dt, wind) {
    const u = this.model.sailUniforms;
    u.uFurl.value = clamp(this.sailSet, 0.04, 1);
    // canvas bellies with the pressure of the apparent wind, flogs when pinched, presses back when taken aback
    u.uFill.value = damp(u.uFill.value, this.sailDraw, this.backed ? 3 : 2, dt);
    if (u.uLuff) u.uLuff.value = damp(u.uLuff.value, clamp(this.luff + (this.sailSet > 0.1 && this.aw.speed < 8 ? 0.4 : 0) + (1 - clamp(this.sails / this.sailsMax, 0, 1)) * 0.45 * this.sailSet, 0, 1), 3, dt);
    // brace the yards to the apparent wind: square sails swing toward the wind's direction
    const aw = this.aw;
    const localWindAngle = (Math.PI - aw.beta) * aw.side; // 0 = apparent wind from astern
    // localWindAngle: 0 = wind from astern
    const brace = clamp(localWindAngle * 0.35, -0.55, 0.55);
    u.uBrace.value = damp(u.uBrace.value, -brace, 1.5, dt);
    const boom = clamp(localWindAngle * 0.45, -0.9, 0.9);
    u.uBoom.value = damp(u.uBoom.value, -boom, 1.5, dt);
    u.uSide.value = damp(u.uSide.value, localWindAngle >= 0 ? 1 : -1, 2, dt);
    u.uDamage.value = 1 - clamp(this.sails / this.sailsMax, 0, 1);
    // trim the scanned rigs: sheets and braces follow the apparent wind (same trim as the physics)
    if (u.uTrimFA) {
      const b = aw.beta;
      const lee = aw.side;
      const fa = clamp(b - 0.3, 0.14, 1.45), sq = this.backed ? 0.72 : clamp(b - 0.38, 0.72, 1.57);
      // sails that are handed or slack drift back toward the centreline / square
      const set = clamp(this.sailSet * 1.5, 0, 1);
      u.uTrimFA.value = damp(u.uTrimFA.value, lerp(0.05, fa, set), 1.2, dt);
      u.uTrimSq.value = damp(u.uTrimSq.value, lerp(1.4, sq, set), 0.8, dt);
      u.uLee.value = damp(u.uLee.value, lee, 1.5, dt);
    }
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
    // raking fire: a shot travelling fore and aft down her length finds every gun crew and bulkhead in its path
    const sp = Math.hypot(ball.v.x, ball.v.z) || 1;
    const along = (ball.v.x * this.forward.x + ball.v.z * this.forward.z) / sp;
    const rake = Math.abs(along) > 0.8 ? (along > 0 ? 2.2 : 1.8) : 1; // through the stern windows is worst
    ball.raked = rake > 1;
    if (zone === 'hull') {
      const crewLoss = Math.random() < 0.6 * Math.min(1.5, rake) ? Math.ceil(rand(0, 2.2) * a.crew * dm * rake) : 0;
      this.damage(7 * a.hull * dm * (rake > 1 ? 1.5 : 1), 1 * a.sails, crewLoss, world, ball.owner);
      if (ammoId === 'round' && Math.random() < 0.03 * rake) this.fire = Math.max(this.fire, 3);
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
      // with the canvas in rags and the rigging cut, a spar gives way
      const frac = this.sails / this.sailsMax;
      if (this.alive && frac < 0.6 && Math.random() < (ammoId === 'chain' ? 0.2 : 0.07) * dm * (1.4 - frac)) {
        const lp = this.worldToLocal(ball.p.clone());
        this.loseMast(lp.z, world, ball.v);
      }
    }
  }

  // A topmast shot away: it and everything it carries comes down over the side, and her speed goes with it
  loseMast(nearZ, world, fromV) {
    const ms = this.model.masts;
    if (!ms?.length) return false;
    let best = null, bd = Infinity;
    for (const m of ms) {
      if (this.mastsDown.has(m)) continue;
      const d = Math.abs(m.lz - nearZ);
      if (d < bd) { bd = d; best = m; }
    }
    if (!best) return false;
    this.mastsDown.add(best);
    const i = ms.indexOf(best);
    if (this.model.uCut && i < 3) this.model.uCut.value[i].set(best.z0, best.z1, best.cutY, 1);
    this.mastLoss = Math.min(0.75, this.mastLoss + best.share * 0.85);
    this.sails = Math.min(this.sails, this.sailsMax * (1 - this.mastLoss));
    // the masthead pennant goes with the mast it flies from
    if (this.model.masthead && this.model.scanned) {
      const near = ms.reduce((a, m) => (Math.abs(m.lz - this.model.masthead.position.z) < Math.abs(a.lz - this.model.masthead.position.z) ? m : a));
      if (near === best) this.model.masthead.visible = false;
    }
    world.onMastLost?.(this, best, fromV);
    return true;
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
