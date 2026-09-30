// Ships lying at anchor in each port: detailed models with their canvas furled, riding the swell and
// swinging to their cables. Purely scenery (and a ship-collision obstacle), but a busy roadstead is what
// makes Port Royal or La Habana feel like a port.
import * as THREE from 'three';
import { shipLibrary } from '../entities/shipLibrary.js';
import { SHIP_CLASSES } from '../game/data.js';

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

  update(dt, t, ocean, camPos, wind) {
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
