// Walking characters: the captain on foot, townsfolk, guards and soldiers.
import * as THREE from 'three';
import { LOOKS } from './character.js';
import { CharacterRig } from './rig.js';
import { modelLibrary, GltfRig } from './modelLibrary.js';
import { humans } from './humans.js';
import { clamp, damp, dampAngle, wrapAngle, rand, pick, smoothstep as smooth } from '../core/noise.js';
import { colliderSurface } from '../world/surface.js';

const GRAV = 22;
const HANG = 2.05; // feet below the hands when hanging from a ledge
const _jv = new THREE.Vector3();
// if a role has no artist model, try a close substitute before falling back to the procedural rig
const ROLE_FALLBACK = { pirate_female: 'pirate', soldier_pirate: 'pirate', sailor: 'pirate' };
function modelRole(role) {
  if (modelLibrary.has(role)) return role;
  const alt = ROLE_FALLBACK[role];
  return alt && modelLibrary.has(alt) ? alt : null;
}

export class Walker {
  constructor(game, look, opts = {}) {
    this.game = game;
    this.look = look;
    // priority: a model listed for this role in models/characters/manifest.json, then the assembled
    // realistic humans, then the procedural rig
    const role = modelRole(look.role);
    if (role) this.rig = new GltfRig(modelLibrary.pick(role));
    else if (humans.has() && look.role) this.rig = humans.create(look.role);
    else this.rig = new CharacterRig(look);
    // pirates and sailors carry whatever blade they could get; officers and soldiers a proper sabre
    if (/pirate|sailor/.test(look.role || '')) { const r = Math.random(); this.rig.blade = r < 0.25 ? 'machete' : r < 0.4 ? 'hatchet' : r < 0.55 ? 'wooden_handle_saber' : 'cutlass'; }
    else if (/soldier|captain/.test(look.role || '') && look.role !== 'captain' && Math.random() < 0.5) this.rig.blade = 'basket_sword';
    this.root = this.rig.root;
    this.pos = new THREE.Vector3(opts.x || 0, opts.y || 0, opts.z || 0);
    this.yaw = opts.yaw || 0;
    this.vel = new THREE.Vector3();
    this.vy = 0;
    this.onGround = true;
    this.maxHealth = opts.health || 100;
    this.health = this.maxHealth;
    this.dead = false;
    this.deadT = 0;
    this.attackT = -1;
    this.hitT = 0;
    this.radius = 0.4;
    this.weapon = look.weapon;
    this.animState = { speed: 0, attack: -1, aim: false, dead: false, weapon: look.weapon };
    this.root.position.copy(this.pos);
    game.scene.add(this.root);
  }

  groundAt(x, z) { return this.game.groundAt(x, z); }

  // desired horizontal velocity (world)
  physics(dt, wishX, wishZ, accel = 12) {
    if (this.roofWalker) return this.roofPhysics(dt, wishX, wishZ, accel);
    const k = 1 - Math.exp(-accel * dt);
    this.vel.x += (wishX - this.vel.x) * k;
    this.vel.z += (wishZ - this.vel.z) * k;
    let nx = this.pos.x + this.vel.x * dt;
    let nz = this.pos.z + this.vel.z * dt;
    // water: refuse to walk into deep water
    const gNew = this.groundAt(nx, nz);
    if (gNew < -0.9) {
      const gx = this.groundAt(nx, this.pos.z), gz = this.groundAt(this.pos.x, nz);
      if (gx >= -0.9) nz = this.pos.z; else if (gz >= -0.9) nx = this.pos.x; else { nx = this.pos.x; nz = this.pos.z; }
      this.vel.set(0, 0, 0);
    }
    // steep slopes
    const g0 = this.groundAt(this.pos.x, this.pos.z);
    const g1 = this.groundAt(nx, nz);
    const dist = Math.hypot(nx - this.pos.x, nz - this.pos.z);
    if (dist > 1e-4 && (g1 - g0) / dist > 1.6 && g1 > this.pos.y + 0.6) { nx = this.pos.x; nz = this.pos.z; }
    this.pos.x = nx; this.pos.z = nz;
    this.game.collideWalker(this);
    // vertical
    const ground = this.groundAt(this.pos.x, this.pos.z);
    this.vy -= GRAV * dt;
    this.pos.y += this.vy * dt;
    if (this.pos.y <= ground) {
      this.pos.y = ground;
      this.vy = 0;
      this.onGround = true;
    } else if (this.pos.y - ground > 0.3) {
      this.onGround = false;
    } else if (this.vy <= 0) {
      this.pos.y = damp(this.pos.y, ground, 20, dt);
      this.onGround = true;
    }
    // wading: sink to water line
    const water = this.pos.y < 0 ? 0 : null;
  }

  // someone keeping to the roofs (a lookout): stands on the roof surface and stops at the edge rather than
  // stepping off it
  roofPhysics(dt, wishX, wishZ, accel) {
    const g = this.game;
    const k = 1 - Math.exp(-accel * dt);
    this.vel.x += (wishX - this.vel.x) * k;
    this.vel.z += (wishZ - this.vel.z) * k;
    const nx = this.pos.x + this.vel.x * dt, nz = this.pos.z + this.vel.z * dt;
    const ahead = g.surfaceAt(nx + this.vel.x * 0.25, nz + this.vel.z * 0.25, this.pos.y);
    if (ahead < this.pos.y - 0.8 && !this.dead) { this.vel.set(0, 0, 0); } else { this.pos.x = nx; this.pos.z = nz; }
    g.collideWalker(this);
    const under = g.surfaceAt(this.pos.x, this.pos.z, this.pos.y);
    this.vy -= GRAV * dt;
    this.pos.y += this.vy * dt;
    if (this.pos.y <= under || (this.vy <= 0 && this.pos.y - under < 0.4)) { this.pos.y = under; this.vy = 0; this.onGround = true; }
  }

  animate(dt) {
    const hs = Math.hypot(this.vel.x, this.vel.z);
    const st = this.animState;
    st.speed = this.dead ? 0 : hs;
    st.attack = this.attackT;
    st.dead = this.dead;
    st.weapon = this.weapon;
    st.hitT = this.hitT;
    this.hitT = Math.max(0, this.hitT - dt * 4);
    this.rig.setWeapon(this.weapon);
    this.rig.update(dt, st);
    this.root.position.copy(this.pos);
    this.root.rotation.y = this.yaw;
  }

  takeDamage(amount, from) {
    if (this.dead) return;
    this.health -= amount;
    this.hitT = 1;
    this.game.effects.blood(this.pos.clone().setY(this.pos.y + 1.3));
    if (this.health <= 0) this.die(from);
  }

  die() {
    this.dead = true;
    this.health = 0;
    this.animState.deadDir = Math.random() < 0.5 ? 1 : -1;
    this.game.audio.grunt(this.pos);
  }

  dispose() { this.rig.dispose(); this.game.scene.remove(this.root); }
}

// ---------------------------------------------------------------- player on foot
export class PlayerWalker extends Walker {
  constructor(game, opts) {
    super(game, { ...LOOKS.captain }, { ...opts, health: 100 });
    this.isPlayer = true;
    this.camYaw = this.yaw;
    this.camPitch = 0.25;
    this.camDist = 5.2;
    this.pistols = 2;
    this.pistolReload = 0;
    this.regenDelay = 0;
    this.comboQueued = false;
    this.aiming = false;
    this.swingHit = false;
    // free running
    this.mode = 'ground'; // ground | air | climb | hang | mantle | roll | land | slide
    this.sprintT = 0;
    this.fallTop = this.pos.y;
    this.moveAnim = null; this.moveT = 0; this.moveRate = 1;
    this.wall = null;
    this.wish = { x: 0, z: 0, len: 0 };
  }

  update(dt, input, cam) {
    const g = this.game;
    if (this.dead) { this.animate(dt); return; }
    const m = input.consumeMouse();
    this.camYaw -= m.dx;
    this.camPitch = clamp(this.camPitch + m.dy, -0.6, 1.1);
    if (m.wheel) this.camDist = clamp(this.camDist + m.wheel * 0.6, 2.5, 12);

    if (this.flying) { this.moveAnim = 'leap'; this.animate(dt); return; } // on a boarding line: the swing carries us
    this.aiming = input.mouseDown(2) && (this.mode === 'ground' || this.mode === 'air');
    this.freeRun(dt, input);

    // cutlass
    if (input.mouseHit(0) && !this.aiming && this.mode === 'ground') {
      if (this.attackT < 0) this.startSwing();
      else if (this.attackT > 0.45) this.comboQueued = true;
    }
    if (this.attackT >= 0) {
      this.attackT += dt / 0.55;
      if (!this.swingHit && this.attackT > 0.5) { this.swingHit = true; g.playerMelee(this); }
      if (this.attackT >= 1) {
        this.attackT = -1;
        if (this.comboQueued) { this.comboQueued = false; this.startSwing(); }
      }
    }
    // flintlock pistols (a brace of two, then reload)
    this.pistolReload = Math.max(0, this.pistolReload - dt);
    if (this.pistolReload <= 0 && this.pistols === 0) { this.pistols = 2; g.ui.toast('Pistols reloaded', 'info', 1200); }
    this.animState.aim = this.aiming;
    this.animState.aimPitch = -this.camPitch * 0.6 + 0.2;
    if (this.aiming && input.mouseHit(0)) {
      if (this.pistols > 0) {
        this.pistols--;
        if (this.pistols === 0) this.pistolReload = 4.5;
        g.playerShoot(this);
      } else g.audio.ui('click');
    }
    if (this.aiming && this.weapon !== 'pistol') this.weapon = 'pistol';
    if (!this.aiming && this.weapon !== 'cutlass') this.weapon = 'cutlass';

    // regeneration
    this.regenDelay -= dt;
    if (this.regenDelay <= 0 && this.health < this.maxHealth) this.health = Math.min(this.maxHealth, this.health + dt * 4);
    this.animate(dt);
  }

  // ---------------------------------------------------------------- free running
  // Walk, run and (holding Shift a moment) sprint; Space jumps (a long leap at speed), climbs a wall you are
  // facing, or vaults onto anything up to chest height; you catch ledges you jump at, climb hand over hand
  // (W/S/A/D), hang and shimmy along the eaves, pull yourself up onto the roofs, walk and run across them and
  // drop off (C lets go). Falls end in a roll when you're moving, a hard landing when you're not, and hurt
  // past a storey or two.
  freeRun(dt, input) {
    const g = this.game;
    let fx = 0, fz = 0;
    if (input.down('KeyW')) fz -= 1;
    if (input.down('KeyS')) fz += 1;
    if (input.down('KeyA')) fx -= 1;
    if (input.down('KeyD')) fx += 1;
    const len = Math.hypot(fx, fz);
    const shift = input.down('ShiftLeft') || input.down('ShiftRight');
    let wx = 0, wz = 0;
    if (len > 0) {
      const c = Math.cos(this.camYaw), s = Math.sin(this.camYaw);
      wx = (fx / len) * c + (fz / len) * s;
      wz = -(fx / len) * s + (fz / len) * c;
    }
    this.wish = { x: wx, z: wz, len: Math.min(1, len) };
    this.moveAnim = null;
    this.moveBlend = 14;
    switch (this.mode) {
      case 'climb': return this.climbStep(dt, input, fx, fz);
      case 'hang': return this.hangStep(dt, input, fx, fz);
      case 'mantle': return this.mantleStep(dt);
      default: break;
    }
    // ---- on foot or in the air
    const moving = len > 0;
    this.sprintT = shift && moving && this.mode !== 'air' ? this.sprintT + dt : Math.max(0, this.sprintT - dt * 3);
    let speed = shift ? 6.2 + 2.4 * smooth(0.25, 1.1, this.sprintT) : 2.6; // a walk, a run, then a flat-out sprint
    if (this.aiming) speed = 2.0;
    if (this.attackT >= 0) speed *= 0.4;
    if (this.pos.y < 0.1 && this.mode === 'ground') speed *= 0.55; // wading
    if (this.mode === 'roll' || this.mode === 'land' || this.mode === 'slide') return this.recoverStep(dt, speed);
    if (moving && !this.aiming) this.yaw = dampAngle(this.yaw, Math.atan2(-wx, -wz), this.mode === 'air' ? 3 : 12, dt);
    if (this.aiming) this.yaw = dampAngle(this.yaw, this.camYaw, 20, dt);
    const air = this.mode === 'air';
    this.move(dt, wx * speed, wz * speed, air ? 1.6 : 12);

    const hs = Math.hypot(this.vel.x, this.vel.z);
    const towardWall = this.contactToward();
    if (this.mode === 'ground') {
      // Space: climb or vault what's in front, or jump; sprinting into a wall runs straight up it
      if (towardWall && (input.hit('Space') || (shift && this.sprintT > 0.35 && towardWall.dot > 0.8))) { if (this.startWall(towardWall, false)) return; }
      if (input.hit('Space')) {
        if (hs > 4.8) {
          // a running leap: long and flat, arms flung forward
          const f = Math.max(hs, 9.2) / hs; // clears a lane from eave to eave
          this.vel.x *= f; this.vel.z *= f;
          this.vy = 7.3; this.leaping = true;
          this.moveT = 0; this.leapT = 0;
        } else { this.vy = 6.2; this.leaping = false; this.leapT = 0; }
        this.mode = 'air'; this.onGround = false; this.fallTop = this.pos.y;
        g.audio.thud(this.pos);
        return;
      }
      // sliding under momentum
      if (input.hit('KeyC') && hs > 6) { this.mode = 'slide'; this.slideT = 0; this.slideV = hs; return; }
    } else {
      // in the air: catch a ledge you're moving into, or grab the wall and start climbing
      this.leapT = (this.leapT || 0) + dt;
      if (this.leaping) { this.moveAnim = this.leapT < 0.3 ? 'leapStart' : 'leap'; this.moveT = this.leapT / 0.3; }
      else if (this.vy > 0 && this.leapT < 0.25) { this.moveAnim = 'jumpStart'; this.moveT = (this.leapT / 0.25) * 0.6; }
      else if (this.fallTop - this.pos.y > 0.7 || this.leapT > 0.2) this.moveAnim = 'fall'; // (not for a step down)
      if (towardWall && towardWall.dot > 0.3 && this.leapT > 0.12) { if (this.startWall(towardWall, true)) return; }
    }
  }

  // velocity toward the wish, then collide and settle on whatever is underfoot (ground, roofs, walls, crates)
  move(dt, wishX, wishZ, accel) {
    const g = this.game;
    const k = 1 - Math.exp(-accel * dt);
    this.vel.x += (wishX - this.vel.x) * k;
    this.vel.z += (wishZ - this.vel.z) * k;
    let nx = this.pos.x + this.vel.x * dt, nz = this.pos.z + this.vel.z * dt;
    // don't walk off into deep water (unless from a height, when you dive in)
    if (this.mode === 'ground' && g.surfaceAt(nx, nz, this.pos.y) < -0.9) {
      const gx = g.surfaceAt(nx, this.pos.z, this.pos.y), gz = g.surfaceAt(this.pos.x, nz, this.pos.y);
      if (gx >= -0.9) nz = this.pos.z; else if (gz >= -0.9) nx = this.pos.x; else { nx = this.pos.x; nz = this.pos.z; }
      this.vel.x = this.vel.z = 0;
    }
    // steep natural ground blocks as before
    const t0 = g.groundAt(this.pos.x, this.pos.z), t1 = g.groundAt(nx, nz), dist = Math.hypot(nx - this.pos.x, nz - this.pos.z);
    if (this.mode === 'ground' && dist > 1e-4 && (t1 - t0) / dist > 1.6 && t1 > this.pos.y + 0.6) { nx = this.pos.x; nz = this.pos.z; }
    this.pos.x = nx; this.pos.z = nz;
    g.collideWalker(this);
    const under = g.surfaceAt(this.pos.x, this.pos.z, this.pos.y, this.mode === 'ground' ? 0.45 : 0.05);
    this.vy -= GRAV * dt;
    this.pos.y += this.vy * dt;
    if (this.pos.y <= under) {
      this.pos.y = under;
      if (this.mode === 'air') this.landed(under);
      this.vy = 0;
      this.onGround = true;
    } else if (this.mode === 'ground' && this.vy <= 0 && this.pos.y - under < 0.4) {
      // follow the ground down slopes, steps and roof pitches without taking off
      this.pos.y = under; this.vy = 0; this.onGround = true;
    } else if (this.mode === 'ground') {
      this.mode = 'air'; this.onGround = false; this.fallTop = this.pos.y; this.leaping = false; this.leapT = 1;
    }
    if (this.mode === 'air') this.fallTop = Math.max(this.fallTop, this.pos.y);
    // on a line or a plank: the feet find the middle of it and the body goes along it, arms out
    const rope = this.mode === 'ground' && g.lastSurface?.rope ? g.lastSurface : null;
    this.onRope = !!rope;
    if (rope) {
      const Z = { x: rope.sin, z: rope.cos }, X = { x: rope.cos, z: -rope.sin };
      const lz = (this.pos.x - rope.x) * Z.x + (this.pos.z - rope.z) * Z.z;
      const k2 = Math.min(1, dt * 12);
      this.pos.x -= Z.x * lz * k2; this.pos.z -= Z.z * lz * k2;
      const va = this.vel.x * X.x + this.vel.z * X.z;
      this.vel.x = X.x * va; this.vel.z = X.z * va;
    }
  }

  landed(y) {
    const g = this.game;
    const h = this.fallTop - y;
    const hs = Math.hypot(this.vel.x, this.vel.z);
    this.leaping = false;
    if (h > 9) this.takeDamage(Math.round((h - 9) * 12), null); // a storey or two is nothing to a topman; three hurts
    if (this.dead) return;
    if (h > 2.6 && hs > 2.5) { this.mode = 'roll'; this.recT = 0; this.recDur = 0.75; this.recAnim = 'roll'; g.audio.thud(this.pos); }
    else if (h > 1.6) { this.mode = 'land'; this.recT = 0; this.recDur = h > 3.5 ? 0.7 : 0.4; this.recAnim = this.wasLeap ? 'leapLand' : 'land'; g.audio.thud(this.pos); if (h > 3.5) g.audio.grunt(this.pos); }
    else this.mode = 'ground';
    if (this.mode !== 'ground' && this.mode !== 'roll') { this.vel.x *= 0.3; this.vel.z *= 0.3; }
  }

  // rolls, hard landings and slides: carried by momentum, a one-shot animation, then back on your feet
  recoverStep(dt, speed) {
    this.recT += dt;
    let wish = 0;
    if (this.mode === 'roll') { wish = Math.max(4.5, Math.hypot(this.vel.x, this.vel.z)); this.moveAnim = 'roll'; this.moveT = this.recT / this.recDur; }
    else if (this.mode === 'land') { this.moveAnim = this.recAnim; this.moveT = this.recT / this.recDur; }
    else {
      // a slide: start, glide, get up
      this.slideV = Math.max(0, this.slideV - dt * 7);
      wish = this.slideV;
      this.slideT += dt;
      this.moveAnim = this.slideT < 0.3 ? 'slideStart' : this.slideT < 0.75 ? 'slide' : 'slideEnd';
      this.moveT = this.slideT < 0.3 ? this.slideT / 0.3 : (this.slideT - 0.75) / 0.4;
      if (this.slideT > 1.15) this.mode = 'ground';
    }
    const f = { x: -Math.sin(this.yaw), z: -Math.cos(this.yaw) };
    this.move(dt, f.x * wish, f.z * wish, 8);
    if (this.mode !== 'slide' && this.recT >= this.recDur) this.mode = 'ground';
    void speed;
  }

  // the wall the player is pressing into this frame: its collider, which face, and how squarely we face it
  contactToward() {
    const ct = this.contact;
    if (!ct || this.wish.len < 0.1) return null;
    const c = ct.c;
    const n = ct.axis === 'x' ? { x: ct.sign * c.cos, z: -ct.sign * c.sin } : { x: ct.sign * c.sin, z: ct.sign * c.cos };
    const dot = -(n.x * this.wish.x + n.z * this.wish.z);
    if (dot < 0.3) return null;
    return { ...ct, n, dot };
  }

  // the wall frame: its outward normal and tangent, the half-length of the face, and our place along it
  wallFrame(ct) {
    const c = ct.c;
    const X = { x: c.cos, z: -c.sin }, Z = { x: c.sin, z: c.cos }; // the collider's local axes in the world
    const dx = this.pos.x - c.x, dz = this.pos.z - c.z;
    const lx = dx * c.cos - dz * c.sin, lz = dx * c.sin + dz * c.cos;
    return ct.axis === 'x'
      ? { c, axis: 'x', sign: ct.sign, n: { x: ct.sign * X.x, z: ct.sign * X.z }, t: Z, along: lz, half: c.hd }
      : { c, axis: 'z', sign: ct.sign, n: { x: ct.sign * Z.x, z: ct.sign * Z.z }, t: X, along: lx, half: c.hw };
  }

  // the height of the top of the wall at a point along it (a gable end rises to its ridge; a parapet stands
  // above an azotea's floor)
  wallTop(W, along) {
    const c = W.c;
    const lx = W.axis === 'x' ? W.sign * (c.hw - 0.15) : along, lz = W.axis === 'x' ? along : W.sign * (c.hd - 0.15);
    const R = c.roof;
    return colliderSurface(c, lx, lz) + (R && R.flat ? R.lip : 0);
  }

  // how far the eaves stand out from this face (hands go to the edge of the overhang, not the wall)
  eaveOut(W) {
    const R = W.c.roof;
    if (!R || R.flat) return 0;
    return Math.max(0, W.axis === 'x' ? R.X - W.c.hw : R.Z - W.c.hd);
  }

  // the lowest ledge standing out overhead that the hands reach as we climb (its outer face, parallel to ours)
  overheadLedge(W, y) {
    const qx = this.pos.x + W.n.x * 0.6, qz = this.pos.z + W.n.z * 0.6;
    let best = null;
    for (const c of this.game.collidersAround(qx, qz)) {
      if (c === W.c || c.bottom === undefined) continue;
      if (c.bottom <= y + 1.0 || c.bottom > y + HANG + 0.15) continue;
      const dx = qx - c.x, dz = qz - c.z;
      const lx = dx * c.cos - dz * c.sin, lz = dx * c.sin + dz * c.cos;
      if (Math.abs(lx) > c.hw || Math.abs(lz) > c.hd) continue;
      if (!best || c.bottom < best.bottom) best = c;
    }
    if (!best) return null;
    const dX = best.cos * W.n.x - best.sin * W.n.z, dZ = best.sin * W.n.x + best.cos * W.n.z; // our normal in its axes
    return Math.abs(dX) > Math.abs(dZ) ? { c: best, axis: 'x', sign: Math.sign(dX) } : { c: best, axis: 'z', sign: Math.sign(dZ) };
  }

  // place the body against the wall at (along, feet height y), `out` metres further out from it
  pinToWall(W, along, y, out = 0) {
    const c = W.c;
    const lx = W.axis === 'x' ? W.sign * (c.hw + 0.12 + out) : along, lz = W.axis === 'x' ? along : W.sign * (c.hd + 0.12 + out);
    this.pos.set(c.x + lx * c.cos + lz * c.sin, y, c.z - lx * c.sin + lz * c.cos);
    this.yaw = Math.atan2(W.n.x, W.n.z);
    this.vel.set(0, 0, 0); this.vy = 0;
  }

  // start on a wall: vault or mantle what's low, catch the ledge of what's in reach, or climb what's tall
  startWall(ct, fromAir) {
    const W = this.wallFrame(ct);
    if (Math.abs(W.along) > W.half - 0.2) return false; // a corner: nothing to hold
    const top = this.wallTop(W, W.along);
    const rel = top - this.pos.y;
    if (rel < 0.4) return false;
    this.wall = W;
    this.leaping = false;
    if (rel <= 1.35) return this.startMantle(W, rel <= 1.0 ? 0.45 : 0.6);
    if (rel <= 2.35) {
      // hands on the ledge
      this.pinToWall(W, W.along, top - HANG, this.eaveOut(W));
      this.mode = 'hang';
      this.game.audio.thud(this.pos);
      return true;
    }
    if (fromAir && this.vy < -9) return false; // falling too fast to hold on
    this.pinToWall(W, W.along, this.pos.y + (fromAir ? 0 : 0.35));
    this.mode = 'climb'; this.climbPhase = 0;
    return true;
  }

  climbStep(dt, input, fx, fz) {
    const W = this.wall;
    const up = -fz, side = fx; // W climbs, S climbs down, A/D move along the wall (A to our left)
    const fast = input.down('ShiftLeft') || input.down('ShiftRight');
    const vUp = up * (fast ? 2.8 : 2.0), vSide = side * 1.1;
    // along the face, our left is the tangent's negative when the tangent runs to our right
    const tDot = Math.cos(this.yaw) * W.t.x - Math.sin(this.yaw) * W.t.z; // our right hand along the face's axis
    W.along = Math.max(-W.half + 0.3, Math.min(W.half - 0.3, W.along + tDot * vSide * dt));
    let y = this.pos.y + vUp * dt;
    const top = this.wallTop(W, W.along);
    const floor = this.game.surfaceAt(this.pos.x + W.n.x * 0.4, this.pos.z + W.n.z * 0.4, this.pos.y + 0.2, 0.2);
    if (y + HANG >= top) { y = top - HANG; this.mode = 'hang'; } // reached the eaves
    // a balcony, a canopy or an awning overhead: take hold of its edge instead of climbing through it
    if (up > 0) {
      const L = this.overheadLedge(W, y);
      if (L) {
        this.wall = this.wallFrame(L);
        const W2 = this.wall;
        W2.along = Math.max(-W2.half + 0.35, Math.min(W2.half - 0.35, W2.along));
        this.pinToWall(W2, W2.along, this.wallTop(W2, W2.along) - HANG);
        this.mode = 'hang';
        this.game.audio.thud(this.pos);
        return;
      }
    }
    // climbing down past the underside of a ledge: nothing left to hold, drop to the street
    if (W.c.bottom !== undefined && y + HANG < W.c.bottom - 0.1) return this.letGo(W);
    if (y <= floor + 0.05 && up < 0) { this.pos.y = floor; this.mode = 'ground'; this.onGround = true; this.pinToWall(W, W.along, floor); this.backOff(W, 0.3); return; }
    const yy = Math.max(y, floor);
    this.pinToWall(W, W.along, yy, this.eaveOut(W) * smooth(top - HANG - 1.2, top - HANG, yy));
    const moving = Math.abs(vUp) + Math.abs(vSide) > 0.01;
    this.moveAnim = 'climb';
    this.moveRate = moving ? (Math.abs(vUp) > 0.01 ? Math.abs(vUp) / 1.6 : 0.8) * (vUp < 0 ? -1 : 1) : 0;
    if (input.hit('KeyC')) return this.letGo(W);
    if (input.hit('Space')) { this.backOff(W, 0.35); this.vel.set(W.n.x * 4, 0, W.n.z * 4); this.vy = 5.5; this.mode = 'air'; this.fallTop = this.pos.y; this.leapT = 0; this.leaping = false; this.yaw += Math.PI; } // kick off the wall
  }

  hangStep(dt, input, fx, fz) {
    const W = this.wall;
    const tDot = Math.cos(this.yaw) * W.t.x - Math.sin(this.yaw) * W.t.z;
    W.along = Math.max(-W.half + 0.35, Math.min(W.half - 0.35, W.along + tDot * fx * 1.1 * dt));
    const top = this.wallTop(W, W.along);
    this.pinToWall(W, W.along, top - HANG, this.eaveOut(W));
    this.moveAnim = fx < 0 ? 'shimmyL' : fx > 0 ? 'shimmyR' : 'hang';
    this.moveRate = 1;
    if (fz < 0 || input.hit('Space')) return this.startMantle(W, 0.95);
    if (fz > 0) { this.mode = 'climb'; this.pinToWall(W, W.along, this.pos.y - 0.1); return; }
    if (input.hit('KeyC')) this.letGo(W);
  }

  // pull up over the edge, carried by the clip's own root motion scaled to the height of the wall
  startMantle(W, dur) {
    const top = this.wallTop(W, W.along);
    this.wall = W;
    this.mant = {
      t: 0, dur, x0: this.pos.x, z0: this.pos.z, y0: this.pos.y,
      // end a little way in over the top, standing on whatever is there
      x1: this.pos.x - W.n.x * (0.75 + this.eaveOut(W)), z1: this.pos.z - W.n.z * (0.75 + this.eaveOut(W)),
    };
    this.mant.y1 = Math.max(top - (W.c.roof?.flat ? W.c.roof.lip : 0), this.game.surfaceAt(this.mant.x1, this.mant.z1, top + 0.1, 0.3));
    this.mode = 'mantle';
    this.game.audio.thud(this.pos);
    return true;
  }

  mantleStep(dt) {
    const M = this.mant;
    M.t += dt / M.dur;
    const t = Math.min(1, M.t);
    const rm = this.rig.entry?.clips?.mantle?.userData?.rootMotion;
    let fu = t, ff = smooth(0.45, 1, t);
    if (rm) {
      const i = Math.min(rm.length - 2, Math.floor(t * (rm.length - 1))), f = t * (rm.length - 1) - i, end = rm[rm.length - 1];
      fu = (rm[i][2] + (rm[i + 1][2] - rm[i][2]) * f) / end[2];
      ff = (rm[i][1] + (rm[i + 1][1] - rm[i][1]) * f) / end[1];
    }
    this.pos.set(M.x0 + (M.x1 - M.x0) * ff, M.y0 + (M.y1 - M.y0) * fu, M.z0 + (M.z1 - M.z0) * ff);
    this.vel.set(0, 0, 0); this.vy = 0;
    this.moveAnim = 'mantle'; this.moveT = t; this.moveBlend = 20;
    if (M.t >= 1) { this.mode = 'ground'; this.onGround = true; this.fallTop = this.pos.y; }
  }

  backOff(W, d) { this.pos.x += W.n.x * d; this.pos.z += W.n.z * d; }

  letGo(W) {
    this.backOff(W, 0.25);
    this.mode = 'air'; this.onGround = false; this.vy = 0; this.leapT = 1; this.leaping = false;
    this.fallTop = this.pos.y;
  }

  animate(dt) {
    const st = this.animState;
    st.move = this.dead ? null : this.moveAnim;
    st.moveT = this.moveT;
    st.moveRate = this.moveRate;
    st.moveBlend = this.moveBlend;
    this.wasLeap = this.leaping || this.moveAnim === 'leap';
    super.animate(dt);
    // when the body is re-seated in one step (onto a ledge's edge, off a wall), glide the model across
    this.visOff = this.visOff || new THREE.Vector3();
    if (this.prevPos) {
      const jump = _jv.subVectors(this.pos, this.prevPos);
      const expected = (Math.hypot(this.vel.x, this.vel.z) + Math.abs(this.vy)) * dt * 1.5 + 0.25;
      if (jump.length() > expected && jump.length() < 4) this.visOff.sub(jump);
    } else this.prevPos = new THREE.Vector3();
    this.prevPos.copy(this.pos);
    this.visOff.multiplyScalar(Math.exp(-10 * dt));
    this.root.position.add(this.visOff);
  }

  dispose() {
    if (this.baseFov !== undefined) { this.game.camera.fov = this.baseFov; this.game.camera.updateProjectionMatrix(); }
    super.dispose();
  }

  startSwing() {
    this.attackT = 0;
    this.swingHit = false;
    this.game.audio.swoosh(this.pos);
  }

  takeDamage(amount, from) {
    if (this.dead) return;
    this.regenDelay = 5;
    this.game.ui.damageFlash();
    super.takeDamage(amount, from);
  }

  die(from) {
    super.die(from);
    this.game.onPlayerDeath();
  }

  // third-person camera
  updateCamera(camera, dt) {
    const shoulder = this.aiming ? 0.7 : 0.0;
    const dist = this.aiming ? 2.6 : this.camDist;
    const cy = Math.cos(this.camPitch), sy = Math.sin(this.camPitch);
    const back = new THREE.Vector3(Math.sin(this.camYaw) * cy, sy, Math.cos(this.camYaw) * cy);
    const right = new THREE.Vector3(Math.cos(this.camYaw), 0, -Math.sin(this.camYaw));
    const head = this.pos.clone().add(new THREE.Vector3(0, 1.65, 0)).addScaledVector(right, shoulder);
    let d = dist;
    // keep the camera out of the ground and walls
    for (let t = 0.5; t <= dist; t += 0.5) {
      const p = head.clone().addScaledVector(back, t);
      if (this.game.groundAt(p.x, p.z) > p.y - 0.3 || this.game.blockedAt(p.x, p.z, 0.2, p.y)) { d = Math.max(1.4, t - 0.5); break; }
    }
    this.curCamDist = damp(this.curCamDist || d, d, d < (this.curCamDist || d) ? 30 : 6, dt);
    const target = head.clone().addScaledVector(back, this.curCamDist);
    const wy = Math.max(target.y, this.game.ocean.heightAt(target.x, target.z) + 0.6);
    target.y = wy;
    camera.position.copy(target);
    camera.lookAt(head.x - back.x * 4, head.y - back.y * 4 + 0.2, head.z - back.z * 4);
    // the view opens a little at a flat-out sprint
    if (this.baseFov === undefined) this.baseFov = camera.fov;
    const fov = this.baseFov + 7 * smooth(0.4, 1.2, this.sprintT || 0);
    if (Math.abs(camera.fov - fov) > 0.05) { camera.fov = damp(camera.fov, fov, 4, dt); camera.updateProjectionMatrix(); }
  }
}

// ---------------------------------------------------------------- NPCs
export class NPC extends Walker {
  constructor(game, look, opts) {
    super(game, look, opts);
    this.kind = opts.kind || 'civilian'; // civilian | guard | soldier | pirate
    this.nation = opts.nation || null;
    this.town = opts.town || null;
    this.home = this.pos.clone();
    this.target = null;
    this.path = null;
    this.waitT = rand(0, 3);
    this.fleeT = 0;
    this.hostile = !!opts.hostile;
    this.musketReload = rand(0, 2);
    this.aimT = 0;
    this.meleeCd = rand(0.5, 1.5);
    this.alert = false;
    this.speedWalk = rand(1.1, 1.6);
    this.blockChance = this.kind === 'guard' || this.kind === 'soldier' ? 0.25 : 0;
    this.post = opts.post || null;
  }

  update(dt) {
    const g = this.game;
    if (this.dead) {
      if (this.spot) this.leaveSpot();
      this.deadT += dt;
      this.physics(dt, 0, 0);
      this.animate(dt);
      return;
    }
    // swinging across on a line, or struck and sitting out the rest of it
    if (this.flying) { this.animState.speed = 0; this.animate(dt); return; }
    if (this.surrendered) { this.animState.activity = 'sit'; this.physics(dt, 0, 0); this.animate(dt); return; }
    // in a boarding fight each side goes for the nearest of the other; otherwise it's the player or no one
    const player = this.side ? g.boarding?.foeFor(this) : g.walker;
    let wishX = 0, wishZ = 0, speed = 0;
    const toP = player && !player.dead ? player.pos.clone().sub(this.pos) : null;
    const dP = toP ? Math.hypot(toP.x, toP.z) : Infinity;
    if (this.lookout) this.watchRoofs(dt, player, dP);
    const hostile = this.side ? !!player : this.hostile || g.isWalkerHostile(this);
    this.animState.aim = false;
    if (this.spot && (this.fleeT > 0 || (hostile && this.kind !== 'civilian') || (this.kind === 'civilian' && g.combatNear && dP < 30))) this.leaveSpot();

    if ((this.kind === 'guard' || this.kind === 'soldier' || this.kind === 'pirate') && hostile && dP < 45) {
      // combat
      this.alert = true;
      const face = Math.atan2(-toP.x, -toP.z);
      this.yaw = dampAngle(this.yaw, face, 8, dt);
      const hasMusket = this.weapon === 'musket';
      if (hasMusket && dP > 5 && dP < 32 && this.musketReload <= 0) {
        this.aimT += dt;
        this.animState.aim = true;
        if (this.aimT > 1.1) {
          this.aimT = 0;
          this.musketReload = rand(5, 7);
          g.npcShoot(this, player);
        }
      } else {
        this.aimT = 0;
        const want = hasMusket && this.musketReload <= 0 ? 12 : 1.6;
        if (dP > want) { speed = dP > 10 ? 4.6 : 3.2; wishX = toP.x / dP * speed; wishZ = toP.z / dP * speed; }
        this.meleeCd -= dt;
        if (dP < 2.2 && this.meleeCd <= 0 && this.attackT < 0) {
          this.attackT = 0; this.swung = false;
          this.meleeCd = rand(1.1, 1.9);
          g.audio.swoosh(this.pos);
        }
      }
      this.musketReload -= dt;
    } else if (this.fleeT > 0 || (this.kind === 'civilian' && g.combatNear && dP < 30)) {
      this.fleeT = Math.max(0, this.fleeT - dt);
      if (toP && dP < 40) { speed = 5; wishX = -toP.x / dP * speed; wishZ = -toP.z / dP * speed; this.yaw = Math.atan2(-wishX, -wishZ); }
    } else if (this.spot) {
      // going to / doing an everyday activity
      const sp = this.spot;
      const d = sp.pos.clone().sub(this.pos);
      const dl = Math.hypot(d.x, d.z);
      if (!this.spotT && dl > 0.35) {
        speed = Math.min(this.speedWalk, dl * 2);
        wishX = d.x / dl * speed; wishZ = d.z / dl * speed;
        this.yaw = dampAngle(this.yaw, Math.atan2(-d.x, -d.z), 5, dt);
        this.stuckT = (this.stuckT || 0) + dt;
        if (this.stuckT > 30) this.leaveSpot();
      } else {
        if (!this.spotT) { this.spotT = rand(25, 90); this.stuckT = 0; }
        // settle exactly onto the spot and face the way it faces
        this.pos.x += d.x * Math.min(1, dt * 4); this.pos.z += d.z * Math.min(1, dt * 4);
        this.yaw = dampAngle(this.yaw, sp.yaw, 4, dt);
        this.animState.activity = sp.type;
        this.spotT -= dt;
        if (this.spotT <= 0 || (toP && dP < 1.2)) this.leaveSpot();
      }
    } else {
      // wander between street nodes / patrol
      if (!this.target || this.pos.distanceTo(this.target) < 1.5) {
        this.waitT -= dt;
        if (this.waitT <= 0) {
          this.waitT = rand(1, 6);
          // townsfolk often stop to sit, talk, dance or work somewhere
          if (this.kind !== 'guard' && this.town?.spots?.length && Math.random() < 0.55) {
            const free = this.town.spots.filter((s) => !s.taken && s.pos.distanceTo(this.pos) < 90);
            if (free.length) { this.spot = pick(free); this.spot.taken = this; this.spotT = 0; this.target = null; }
          }
          if (!this.spot) this.target = this.pickTarget();
        }
      } else {
        const d = this.target.clone().sub(this.pos);
        const dl = Math.hypot(d.x, d.z);
        speed = this.speedWalk;
        wishX = d.x / dl * speed; wishZ = d.z / dl * speed;
        this.yaw = dampAngle(this.yaw, Math.atan2(-d.x, -d.z), 5, dt);
        this.stuckT = (this.stuckT || 0) + dt;
        if (this.stuckT > 25) { this.target = null; this.stuckT = 0; }
      }
    }
    if (this.attackT >= 0) {
      this.attackT += dt / 0.6;
      if (!this.swung && this.attackT > 0.5) {
        this.swung = true;
        if (player && !player.dead && this.pos.distanceTo(player.pos) < 2.6) {
          if (player.attackT >= 0.1 && player.attackT < 0.5 && Math.random() < 0.35) { g.audio.clang(this.pos); }
          else { player.takeDamage(this.kind === 'soldier' || this.kind === 'guard' ? 14 : this.side ? (player.isPlayer ? 11 : 16) : 10, this); g.audio.thud(player.pos); }
        }
      }
      if (this.attackT >= 1) this.attackT = -1;
    }
    this.physics(dt, wishX, wishZ, 8);
    this.animate(dt);
  }

  dispose() { this.leaveSpot(); super.dispose(); }

  leaveSpot() {
    if (this.spot) this.spot.taken = null;
    this.spot = null;
    this.spotT = 0;
    this.animState.activity = null;
    this.waitT = rand(0.5, 2);
  }

  // A lookout on the roofs: a warning to anyone caught up there, then musket balls. Once provoked they stay
  // hostile; they keep to their roof and stop at its edge.
  watchRoofs(dt, player, dP) {
    if (this.hostile || !player || player.dead) return;
    const g = this.game;
    const up = player.mode !== 'ground' || player.pos.y - g.groundAt(player.pos.x, player.pos.z) > 2.2;
    if (up && dP < 30) {
      if (!this.warnT) {
        const call = this.nation === 'spain' ? '¡Eh! ¡Baja del tejado!' : this.nation === 'france' ? 'Hé ! Descendez du toit !' : 'You there! Get off the roof!';
        g.ui.toast(call + ' — a lookout has seen you', 'warn', 2600);
        g.audio.grunt(this.pos);
      }
      this.warnT = (this.warnT || 0) + dt;
      const face = Math.atan2(-(player.pos.x - this.pos.x), -(player.pos.z - this.pos.z));
      this.yaw = dampAngle(this.yaw, face, 6, dt);
      if (this.warnT > 4) { this.hostile = true; g.ui.toast('The lookout opens fire!', 'warn', 2000); }
    } else if (this.warnT) this.warnT = Math.max(0, this.warnT - dt * 0.5);
  }

  pickTarget() {
    if (this.lookout) {
      // pace between the two ends of the roof
      this.lookoutEnd = !this.lookoutEnd;
      return (this.lookoutEnd ? this.lookout.a : this.lookout.b).clone();
    }
    const nodes = this.town?.streetNodes;
    if (this.kind === 'guard' && this.post) {
      const a = Math.random() * Math.PI * 2;
      return this.post.clone().add(new THREE.Vector3(Math.cos(a) * 6, 0, Math.sin(a) * 6));
    }
    if (nodes && nodes.length) {
      // prefer nearby nodes
      const near = nodes.filter((n) => n.distanceTo(this.pos) < 60);
      return (near.length ? pick(near) : pick(nodes)).clone();
    }
    const a = Math.random() * Math.PI * 2;
    return this.home.clone().add(new THREE.Vector3(Math.cos(a) * 10, 0, Math.sin(a) * 10));
  }

  takeDamage(amount, from) {
    if (this.dead) return;
    if (from?.isPlayer && Math.random() < this.blockChance && this.attackT < 0) {
      this.game.audio.clang(this.pos);
      this.game.effects.fire.spawn({ x: this.pos.x, y: this.pos.y + 1.3, z: this.pos.z, vx: 0, vy: 2, vz: 0, life: 0.15, size: 0.6, endSize: 0.1, r: 1, g: 0.8, b: 0.4 });
      return;
    }
    super.takeDamage(amount, from);
    this.fleeT = 6;
    if (from?.isPlayer) this.game.onNPCAttacked(this);
  }
}

export function lookFor(kind, nation) {
  if (kind === 'guard' || kind === 'soldier') {
    if (nation === 'britain') return { ...LOOKS.redcoat };
    if (nation === 'france') return { ...LOOKS.frenchSoldier };
    if (nation === 'pirate') return { ...LOOKS.pirate, role: 'soldier_pirate', weapon: 'musket' };
    return { ...LOOKS.spanishSoldier };
  }
  if (kind === 'pirate') {
    const skins = ['#b07850', '#8a5a3a', '#c89468', '#6a4028', '#e0b090'];
    const tops = ['#d8ccb0', '#8a3a2a', '#4a5a6a', '#b0a080', '#6a2a3a'];
    return { ...LOOKS.pirate, role: Math.random() < 0.3 ? 'pirate_female' : 'pirate', skin: pick(skins), shirt: pick(tops), hatColor: pick(['#8a2a1a', '#2a3a5a', '#1a1a1a', '#6a5a2a']), hat: Math.random() < 0.3 ? 'tricorne' : Math.random() < 0.5 ? 'bandana' : 'straw', sash: pick(['#8a1d1d', '#3a5a7a', '#6a5a2a']), weapon: 'cutlass' };
  }
  const r = Math.random();
  const skins = ['#d0a078', '#8a5a3a', '#6a4028', '#e0b48c', '#b07850'];
  if (r < 0.35) return { ...LOOKS.woman, skin: pick(skins), dress: pick(['#8a4a5a', '#5a6a8a', '#8a7a4a', '#6a4a3a', '#e0d4bc']) };
  if (r < 0.5) return { ...LOOKS.woman2, skin: pick(skins) };
  if (r < 0.75) return { ...LOOKS.sailor, skin: pick(skins), shirt: pick(['#e0d8c4', '#b8b0a0', '#8a3a2a']) };
  if (r < 0.9) return { ...LOOKS.townsman, skin: pick(skins), coat: pick(['#6a5a44', '#4a3a2a', '#5a4a5a', '#3a4a3a']) };
  return { ...LOOKS.merchant };
}
