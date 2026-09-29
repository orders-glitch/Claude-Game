// Cannon shot, chain shot, grape and musket balls with ballistic flight and hit resolution.
import * as THREE from 'three';
import { GRAVITY } from './ship.js';
import { AMMO } from '../game/data.js';

const MAX = 600;

export class Projectiles {
  constructor(scene) {
    this.list = [];
    const geo = new THREE.SphereGeometry(0.28, 8, 6);
    const mat = new THREE.MeshStandardMaterial({ color: '#141414', roughness: 0.4, metalness: 0.7 });
    this.mesh = new THREE.InstancedMesh(geo, mat, MAX);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    scene.add(this.mesh);
    this._m = new THREE.Matrix4();
    this._p = new THREE.Vector3();
  }

  spawn(pos, vel, owner, ammo = 'round') {
    const dmg = owner?.gunDamage || 1;
    if (this.ocean) pos.y = Math.max(pos.y, this.ocean.heightAt(pos.x, pos.z) + 0.6);
    if (ammo === 'grape') {
      for (let i = 0; i < 5; i++) {
        const v = vel.clone().add(new THREE.Vector3((Math.random() - 0.5) * 10, (Math.random() - 0.5) * 5, (Math.random() - 0.5) * 10));
        this.list.push({ p: pos.clone(), v, owner, ammo, life: 3, age: 0, damage: dmg * 0.3, scale: 0.45 });
      }
      return;
    }
    this.list.push({ p: pos.clone(), v: vel.clone(), owner, ammo, life: 6, age: 0, damage: dmg, scale: ammo === 'chain' ? 1.3 : 1 });
  }

  update(dt, world) {
    const out = [];
    const ships = world.ships;
    this.ocean = world.ocean;
    for (const b of this.list) {
      b.life -= dt;
      b.age += dt;
      const steps = 2;
      let dead = false;
      for (let s = 0; s < steps && !dead; s++) {
        const h = dt / steps;
        b.v.y -= GRAVITY * h;
        b.p.addScaledVector(b.v, h);
        // ships
        for (const ship of ships) {
          if (ship === b.owner || !ship.alive) continue;
          const dx = ship.position.x - b.p.x, dz = ship.position.z - b.p.z;
          const r = ship.cls.length * 0.6 + 2;
          if (dx * dx + dz * dz > r * r) continue;
          const zone = ship.hitTest(b.p);
          if (zone) {
            ship.onBallHit(zone, b.ammo, b, world);
            if (zone === 'hull') { world.effects.hit(b.p, b.ammo === 'grape' ? 0.3 : 1); world.audio?.impact(b.p, 'wood'); }
            else { world.effects.hit(b.p, 0.3); world.audio?.impact(b.p, 'sail'); }
            world.onShipHit?.(ship, b.owner, zone);
            dead = true;
            break;
          }
        }
        if (dead) break;
        // water
        if (b.p.y < 4 && b.age > 0.15) {
          const wh = world.ocean.heightAt(b.p.x, b.p.z);
          if (b.p.y < wh) {
            const tgh = world.terrain.quickHeight(b.p.x, b.p.z);
            if (tgh > wh - 0.5) world.effects.dust(b.p);
            else {
              world.effects.splash(b.p.x, b.p.z, b.ammo === 'grape' ? 0.3 : 1);
              if (b.ammo !== 'grape') world.audio?.splash(b.p);
            }
            dead = true;
          }
        }
        // land & forts
        if (!dead && b.p.y < 200) {
          const th = world.terrain.quickHeight(b.p.x, b.p.z);
          if (th > 0 && world.terrain.height(b.p.x, b.p.z) > b.p.y) {
            world.effects.dust(b.p);
            world.effects.hit(b.p, 0.3);
            world.onGroundHit?.(b);
            dead = true;
          }
        }
      }
      if (!dead && b.life > 0) out.push(b);
    }
    this.list = out;
    const n = Math.min(out.length, MAX);
    for (let i = 0; i < n; i++) {
      const b = out[i];
      this._m.makeScale(b.scale, b.scale, b.scale).setPosition(b.p);
      this.mesh.setMatrixAt(i, this._m);
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
