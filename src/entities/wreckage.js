// Spars and canvas brought down by shot. A topmast parts at the cap, topples over the side with its yards and
// torn sails, strikes the water, and drifts astern as a tangle of wreckage until it sinks.
import * as THREE from 'three';
import { rand, clamp } from '../core/noise.js';

let MATS;
function mats() {
  return (MATS ||= {
    wood: new THREE.MeshStandardMaterial({ color: '#4d3826', roughness: 0.9 }),
    canvas: new THREE.MeshStandardMaterial({ color: '#d9cdb1', roughness: 0.95, side: THREE.DoubleSide }),
    scorched: new THREE.MeshStandardMaterial({ color: '#5a5044', roughness: 0.95, side: THREE.DoubleSide }),
  });
}

// a sail in rags: a sagging sheet with its edges torn away
function ragGeometry(w, h) {
  const g = new THREE.PlaneGeometry(w, h, 8, 5);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i);
    const edge = Math.abs(x) / (w / 2);
    p.setZ(i, (1 - (x / (w / 2)) ** 2) * h * 0.18 + rand(-0.15, 0.15));
    // tattered foot and leeches
    if (y < -h * 0.3 && Math.random() < 0.5) p.setY(i, y + rand(0, h * 0.35));
    if (edge > 0.8 && Math.random() < 0.5) p.setX(i, x * rand(0.75, 0.95));
  }
  g.computeVertexNormals();
  return g;
}

export class Wreckage {
  constructor(scene, ocean, effects, audio) {
    this.scene = scene;
    this.ocean = ocean;
    this.effects = effects;
    this.audio = audio;
    this.list = [];
  }

  // mast: from the ship model (lz, lCutY, lTopY in the ship's frame); fromV: the velocity of the shot that did it
  topmast(ship, mast, fromV, burnt = false) {
    const M = mats();
    const h = clamp(mast.lTopY - mast.lCutY, 4, 30);
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.24, h, 7).translate(0, h / 2, 0), M.wood));
    const yards = Math.max(1, Math.min(3, Math.round(h / 6)));
    for (let k = 0; k < yards; k++) {
      const y = h * (yards === 1 ? 0.6 : 0.3 + (0.6 * k) / (yards - 1));
      const w = ship.cls.beam * (1.25 - 0.3 * k);
      const yard = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, w, 5).rotateZ(Math.PI / 2).translate(0, y, 0), M.wood);
      g.add(yard);
      const rag = new THREE.Mesh(ragGeometry(w * 0.9, h * 0.28), burnt ? M.scorched : M.canvas);
      rag.position.set(0, y - h * 0.15, 0.15);
      g.add(rag);
    }
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    g.position.set(0, mast.lCutY, mast.lz);
    ship.group.add(g);
    // it falls the way the shot was going, mostly over the side
    const inv = ship.group.getWorldQuaternion(new THREE.Quaternion()).invert();
    const d = new THREE.Vector3(fromV?.x || rand(-1, 1), 0, fromV?.z || rand(-1, 1)).applyQuaternion(inv).setY(0);
    d.x += Math.sign(d.x || 1) * 0.6; // athwartships: the stays hold it fore and aft
    d.normalize();
    const axis = new THREE.Vector3(d.z, 0, -d.x); // rotating up about this tips it toward d
    // it lies over until its head is in the water (or over the rail, hanging)
    const maxT = Math.min(2.2, Math.acos(clamp(-(mast.lCutY - 0.5) / h, -1, 1)));
    const brk = ship.localToWorld(new THREE.Vector3(0, mast.lCutY, mast.lz));
    this.effects.hit(brk, 2);
    this.audio?.crunch?.(brk);
    this.list.push({ g, ship, axis, h, th: 0.04, om: 0.15, maxT, phase: 'fall', t: 0, drift: new THREE.Vector3() });
  }

  update(dt) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const w = this.list[i];
      w.t += dt;
      if (w.phase === 'fall') {
        // a toppling pole: angular acceleration grows as it leans
        w.om += dt * (1.5 * 9.8 / w.h) * Math.sin(w.th + 0.08);
        w.th = Math.min(w.maxT, w.th + w.om * dt);
        w.g.quaternion.setFromAxisAngle(w.axis, w.th);
        if (w.th >= w.maxT || !w.ship.group.parent) {
          // over the side: it tears free and hits the water
          this.scene.attach(w.g);
          const tip = new THREE.Vector3(0, w.h, 0).applyMatrix4(w.g.matrixWorld);
          this.effects.splash(tip.x, tip.z, 2);
          const mid = new THREE.Vector3(0, w.h * 0.5, 0).applyMatrix4(w.g.matrixWorld);
          this.effects.splash(mid.x, mid.z, 1.2);
          this.audio?.splash?.(tip);
          w.phase = 'sea';
          w.t = 0;
          w.vy = 0;
          w.drift.copy(w.ship.velocity || new THREE.Vector3()).multiplyScalar(0.3);
          // settle flat on the water
          const flat = new THREE.Vector3(0, 1, 0).applyQuaternion(w.g.quaternion).setY(0);
          if (flat.lengthSq() < 1e-4) flat.set(1, 0, 0);
          flat.normalize();
          w.flatQ = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), flat);
        }
      } else {
        w.g.quaternion.slerp(w.flatQ, 1 - Math.exp(-2.5 * dt));
        const P = w.g.position;
        P.addScaledVector(w.drift, dt);
        w.drift.multiplyScalar(Math.exp(-0.3 * dt));
        const sink = w.t > 14 ? (w.t - 14) * 0.25 : 0;
        const wy = this.ocean.heightAt(P.x, P.z) + 0.15 - sink;
        if (P.y > wy) { w.vy -= 9.8 * dt; P.y = Math.max(wy, P.y + w.vy * dt); } else { w.vy = 0; P.y += (wy - P.y) * (1 - Math.exp(-3 * dt)); }
        if (w.t > 24) {
          this.scene.remove(w.g);
          w.g.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });
          this.list.splice(i, 1);
        }
      }
    }
  }

  clear() {
    for (const w of this.list) w.g.parent?.remove(w.g);
    this.list.length = 0;
  }
}
