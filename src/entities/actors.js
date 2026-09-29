// Walking characters: the captain on foot, townsfolk, guards and soldiers.
import * as THREE from 'three';
import { LOOKS } from './character.js';
import { CharacterRig } from './rig.js';
import { clamp, damp, dampAngle, wrapAngle, rand, pick } from '../core/noise.js';

const GRAV = 22;

export class Walker {
  constructor(game, look, opts = {}) {
    this.game = game;
    this.look = look;
    this.rig = new CharacterRig(look);
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
  }

  update(dt, input, cam) {
    const g = this.game;
    if (this.dead) { this.animate(dt); return; }
    const m = input.consumeMouse();
    this.camYaw -= m.dx;
    this.camPitch = clamp(this.camPitch + m.dy, -0.6, 1.1);
    if (m.wheel) this.camDist = clamp(this.camDist + m.wheel * 0.6, 2.5, 12);

    let fx = 0, fz = 0;
    if (input.down('KeyW')) fz -= 1;
    if (input.down('KeyS')) fz += 1;
    if (input.down('KeyA')) fx -= 1;
    if (input.down('KeyD')) fx += 1;
    const len = Math.hypot(fx, fz);
    const run = input.down('ShiftLeft') || input.down('ShiftRight');
    this.aiming = input.mouseDown(2);
    let speed = run ? 6.2 : 2.6;
    if (this.aiming) speed = 2.0;
    if (this.attackT >= 0) speed *= 0.4;
    let wx = 0, wz = 0;
    if (len > 0) {
      fx /= len; fz /= len;
      const c = Math.cos(this.camYaw), s = Math.sin(this.camYaw);
      wx = fx * c + fz * s;
      wz = -fx * s + fz * c;
      if (!this.aiming) this.yaw = dampAngle(this.yaw, Math.atan2(-wx, -wz), 12, dt);
    }
    if (this.aiming) this.yaw = dampAngle(this.yaw, this.camYaw, 20, dt);
    // shallow water slows
    if (this.pos.y < 0.1) speed *= 0.55;
    this.physics(dt, wx * speed, wz * speed);
    if (input.hit('Space') && this.onGround) { this.vy = 7; this.onGround = false; }

    // cutlass
    if (input.mouseHit(0) && !this.aiming) {
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
      this.deadT += dt;
      this.physics(dt, 0, 0);
      this.animate(dt);
      return;
    }
    const player = g.walker;
    let wishX = 0, wishZ = 0, speed = 0;
    const toP = player && !player.dead ? player.pos.clone().sub(this.pos) : null;
    const dP = toP ? Math.hypot(toP.x, toP.z) : Infinity;
    const hostile = this.hostile || g.isWalkerHostile(this);
    this.animState.aim = false;

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
    } else {
      // wander between street nodes / patrol
      if (!this.target || this.pos.distanceTo(this.target) < 1.5) {
        this.waitT -= dt;
        if (this.waitT <= 0) {
          this.waitT = rand(1, 6);
          this.target = this.pickTarget();
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
          else { player.takeDamage(this.kind === 'soldier' || this.kind === 'guard' ? 14 : 10, this); g.audio.thud(player.pos); }
        }
      }
      if (this.attackT >= 1) this.attackT = -1;
    }
    this.physics(dt, wishX, wishZ, 8);
    this.animate(dt);
  }

  pickTarget() {
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
    if (nation === 'pirate') return { ...LOOKS.pirate, weapon: 'musket' };
    return { ...LOOKS.spanishSoldier };
  }
  if (kind === 'pirate') {
    const skins = ['#b07850', '#8a5a3a', '#c89468', '#6a4028', '#e0b090'];
    const tops = ['#d8ccb0', '#8a3a2a', '#4a5a6a', '#b0a080', '#6a2a3a'];
    return { ...LOOKS.pirate, skin: pick(skins), shirt: pick(tops), hatColor: pick(['#8a2a1a', '#2a3a5a', '#1a1a1a', '#6a5a2a']), hat: Math.random() < 0.3 ? 'tricorne' : Math.random() < 0.5 ? 'bandana' : 'straw', sash: pick(['#8a1d1d', '#3a5a7a', '#6a5a2a']), weapon: 'cutlass' };
  }
  const r = Math.random();
  const skins = ['#d0a078', '#8a5a3a', '#6a4028', '#e0b48c', '#b07850'];
  if (r < 0.35) return { ...LOOKS.woman, skin: pick(skins), dress: pick(['#8a4a5a', '#5a6a8a', '#8a7a4a', '#6a4a3a', '#e0d4bc']) };
  if (r < 0.5) return { ...LOOKS.woman2, skin: pick(skins) };
  if (r < 0.75) return { ...LOOKS.sailor, skin: pick(skins), shirt: pick(['#e0d8c4', '#b8b0a0', '#8a3a2a']) };
  if (r < 0.9) return { ...LOOKS.townsman, skin: pick(skins), coat: pick(['#6a5a44', '#4a3a2a', '#5a4a5a', '#3a4a3a']) };
  return { ...LOOKS.merchant };
}
