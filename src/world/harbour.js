// Ships lying at anchor in each port: detailed models with their canvas furled, riding the swell and
// swinging to their cables. Purely scenery (and a ship-collision obstacle), but a busy roadstead is what
// makes Port Royal or La Habana feel like a port.
import * as THREE from 'three';
import { addWaterMask } from './waterMask.js';
import { shipLibrary } from '../entities/shipLibrary.js';
import { SHIP_CLASSES } from '../game/data.js';
import { props } from './props.js';

const BY_NATION = {
  pirate: ['sloop', 'sloop', 'brigantine', 'fluyt'],
  britain: ['frigate', 'fluyt', 'sloop', 'brigantine', 'manowar'],
  spain: ['galleon', 'fluyt', 'frigate', 'sloop'],
  france: ['frigate', 'fluyt', 'brigantine', 'sloop'],
};

export class Harbour {
  constructor(scene, towns, terrain) {
    this.ships = [];
    this.blockers = [];
    for (const t of towns) {
      const kinds = BY_NATION[t.port.nation] || BY_NATION.britain;
      let placed = 0;
      for (let k = 0; k < 14 && placed < 4; k++) {
        const a = (t.rand() - 0.5) * t.R * 1.6, b = -(70 + t.rand() * 130);
        const w = t.toWorld(a, b);
        if (terrain.height(w.x, w.z) > -6) continue;
        if (t.berth && Math.hypot(w.x - t.berth.x, w.z - t.berth.z) < 60) continue;
        if (this.ships.some((s) => Math.hypot(s.x - w.x, s.z - w.z) < 55)) continue;
        const cls = SHIP_CLASSES[kinds[placed % kinds.length]];
        if (!shipLibrary.has(cls.id)) continue;
        const m = shipLibrary.create(cls.id, cls.length, t.port.nation === 'pirate' ? '#d6c9a8' : '#ece4cf');
        m.uniforms.uFurl.value = 0.08;
        m.uniforms.uFill.value = 0;
        const heading = t.dir + (t.rand() - 0.5) * 0.9;
        m.group.position.set(w.x, 0, w.z);
        m.group.rotation.order = 'YXZ';
        scene.add(m.group);
        this.ships.push({ m, x: w.x, z: w.z, heading, phase: t.rand() * 10, len: cls.length });
        this.blockers.push({ x: w.x, z: w.z, hw: cls.beam * 0.6, hd: cls.length * 0.5, cos: Math.cos(heading), sin: Math.sin(heading) });
        placed++;
      }
    }
  }

  // Boats plying the harbour: ships' boats and bumboats rowing between the anchored ships and the quays,
  // canoes (piraguas) of fishermen and turtlers. Their crews are seats for the town crowd.
  addBoats(scene, towns, terrain) {
    this.boats = [];
    if (!props.has('rowboat')) return;
    const N = { havana: 8, portroyal: 7, nassau: 7, tortuga: 4 };
    for (const t of towns) {
      const n = N[t.port.id] ?? 4;
      const water = [];
      for (let k = 0; k < 400 && water.length < 24; k++) {
        const a = (t.rand() - 0.5) * t.R * 1.6, b = -(25 + t.rand() * 170);
        const w = t.toWorld(a, b);
        if (terrain.height(w.x, w.z) < -2.5) water.push(new THREE.Vector3(w.x, 0, w.z));
      }
      const docks = t.platforms.map((p) => new THREE.Vector3(p.x, 0, p.z)).concat(this.ships.filter((sh) => Math.hypot(sh.x - t.coast.x, sh.z - t.coast.z) < 400).map((sh) => new THREE.Vector3(sh.x + 8, 0, sh.z)));
      if (water.length < 4) continue;
      for (let i = 0; i < n; i++) {
        const canoe = (t.port.id === 'tortuga' || (t.port.id === 'havana' && i % 3 === 0) || (t.port.id === 'nassau' && i % 4 === 0)) && props.has('canoe');
        const mesh = props.object(canoe ? 'canoe' : 'rowboat');
        const inner = mesh;
        const group = new THREE.Group();
        if (canoe) inner.rotation.y = Math.PI / 2; else inner.scale.setScalar(1.4);
        group.add(inner);
        addWaterMask(inner); // keep the sea out of her
        scene.add(group);
        const p = water[Math.floor(t.rand() * water.length)].clone();
        const seats = canoe ? [new THREE.Vector3(0, 0.05, -1.2), new THREE.Vector3(0, 0.05, 1.1)] : [new THREE.Vector3(0, 0.2, -0.5), new THREE.Vector3(0, 0.2, 1.1)].slice(0, 1 + (i % 2));
        this.boats.push({ town: t, group, canoe, pos: p, yaw: t.rand() * 6.28, target: null, wait: t.rand() * 20, water, docks, seats, speed: canoe ? 1.3 : 1.6 });
      }
    }
  }

  update(dt, t, ocean, camPos, wind) {
    for (const bt of this.boats || []) {
      const d2 = bt.pos.distanceToSquared(camPos);
      bt.group.visible = d2 < 900 * 900;
      if (!bt.group.visible) continue;
      if (!bt.target) {
        bt.wait -= dt;
        if (bt.wait <= 0) {
          const pool = Math.random() < 0.5 && bt.docks.length ? bt.docks : bt.water;
          bt.target = pool[Math.floor(Math.random() * pool.length)].clone();
          bt.target.x += (Math.random() - 0.5) * 6; bt.target.z += (Math.random() - 0.5) * 6;
        }
      } else {
        const dx = bt.target.x - bt.pos.x, dz = bt.target.z - bt.pos.z, dl = Math.hypot(dx, dz);
        if (dl < 4) { bt.target = null; bt.wait = 15 + Math.random() * 50; }
        else {
          const want = Math.atan2(-dx, -dz);
          let dy = want - bt.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
          bt.yaw += dy * Math.min(1, dt * 0.8);
          const sp = bt.speed * (0.75 + 0.25 * Math.sin(t * 2.4 + bt.pos.x)) * Math.max(0.2, Math.cos(dy));
          bt.pos.x -= Math.sin(bt.yaw) * sp * dt; bt.pos.z -= Math.cos(bt.yaw) * sp * dt;
        }
      }
      const g = bt.group;
      g.position.set(bt.pos.x, ocean.heightAt(bt.pos.x, bt.pos.z) - 0.25, bt.pos.z);
      g.rotation.set(Math.sin(t * 1.3 + bt.pos.z) * 0.04, bt.yaw, Math.sin(t * 1.1 + bt.pos.x) * 0.05, 'YXZ');
    }
    for (const s of this.ships) {
      const g = s.m.group;
      const d2 = (s.x - camPos.x) ** 2 + (s.z - camPos.z) ** 2;
      g.visible = d2 < 3200 * 3200;
      if (!g.visible || d2 > 1500 * 1500) continue;
      // swing slowly to the wind about the anchor
      const want = Math.atan2(-wind.x, -wind.z);
      s.heading += Math.sin(want - s.heading) * dt * 0.01;
      g.position.y = ocean.heightAt(s.x, s.z) - 0.1;
      g.rotation.y = s.heading + Math.sin(t * 0.07 + s.phase) * 0.06;
      g.rotation.z = Math.sin(t * 0.6 + s.phase) * 0.025;
      g.rotation.x = Math.sin(t * 0.45 + s.phase * 1.3) * 0.015;
    }
  }
}
