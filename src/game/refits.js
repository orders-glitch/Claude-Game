// Refits: what a shipwright can do to a ship, and what it costs her. Each refit belongs to the ship it was
// fitted to (sell her or change ships and it goes with her), each one has a price in coin and most a price in
// something else (speed, hold space, berths), and the work shows on the ship.
import * as THREE from 'three';
import { SHIP_CLASSES } from './data.js';

// tiered refits: [name per level], description, base costs per step (scaled by the size of the ship)
export const TIERS = {
  guns: { names: ['6-pounders', '9-pounders', '12-pounders', 'Long 18-pounders'], costs: [900, 2200, 4800],
    desc: 'Heavier guns hit harder and carry further; the extra iron makes her a little slower (−2½% speed a step).' },
  hull: { names: ['Standard planking', 'Doubled oak planking', 'Live-oak frames'], costs: [1200, 3200],
    desc: 'Stronger hull: a quarter again more punishment before she founders; heavier, so a touch slower (−2%).' },
  sails: { names: ['Old canvas', 'New Holland duck', 'Fine flax canvas'], costs: [800, 2400],
    desc: 'Better canvas: more speed on every point of sail. New sails show white.' },
};

// single refits, each with its trade-off
export const EXTRAS = {
  chase: { name: 'Chase guns', cost: 1500, desc: 'A long gun at the bow and another at the stern: fire ahead when chasing or astern when fleeing (look fore or aft and fire).' },
  swivels: { name: 'Swivel guns', cost: 700, desc: 'Swivels on the rails sweep an enemy\'s deck at close quarters, thinning her crew before you board.' },
  stuns: { name: 'Studding sails', cost: 900, desc: 'Extra light sails set outboard of the square sails: 12% faster running before the wind.' },
  hold: { name: 'Enlarged hold', cost: 1100, desc: 'Bulkheads moved and the cable tier cleared: 30% more cargo, but 20% fewer berths for crew.' },
  carpenter: { name: 'Carpenter\'s store', cost: 600, desc: 'Spare plank, shot-plugs, oakum and spars: repairs at sea go faster and further (to 90%).' },
  surgeon: { name: 'Surgeon & medicine chest', cost: 800, desc: 'A surgeon aboard: four in ten men who would have died of their wounds live.' },
  armoury: { name: 'Armoury', cost: 1000, desc: 'Muskets, pistols, cutlasses and grenadoes for every man: a stronger boarding party.' },
};

// a ship's size makes her refits dearer (a frigate's guns cost more than a sloop's)
export function refitCost(cls, base) {
  const c = SHIP_CLASSES[cls];
  return Math.round((base * (0.6 + 0.4 * (c.guns / 10) ** 0.8)) / 10) * 10;
}

export function emptyRefit() { return { guns: 0, hull: 0, sails: 0, chase: false, swivels: false, stuns: false, hold: false, carpenter: false, surgeon: false, armoury: false }; }

// the effects of a refit on a ship's numbers
export function refitStats(clsId, R) {
  const c = SHIP_CLASSES[clsId];
  R = R || emptyRefit();
  return {
    hullMult: 1 + 0.25 * R.hull,
    gunDamage: 1 + 0.35 * R.guns,
    gunRange: 1 + 0.07 * R.guns,
    speedMult: (1 + 0.07 * R.sails) * (1 - 0.025 * R.guns) * (1 - 0.02 * R.hull),
    cargo: Math.round(c.cargo * (R.hold ? 1.3 : 1)),
    crewMax: Math.round(c.crewMax * (R.hold ? 0.8 : 1)),
    sailTint: ['#ddd2b6', '#ebe4d0', '#f6f2e6'][R.sails] || '#ddd2b6',
  };
}

// what the refits look like: guns run out at the ports (their length by their weight), chase guns at bow and
// stern, swivels on their stocks along the rails
export function fitRefitVisuals(ship, R) {
  if (!R) return;
  const M = ship.model, g = M.group;
  const old = g.getObjectByName('refits');
  if (old) g.remove(old);
  const grp = new THREE.Group();
  grp.name = 'refits';
  const iron = new THREE.MeshStandardMaterial({ color: '#1f1e1c', roughness: 0.45, metalness: 0.6 });
  const wood = new THREE.MeshStandardMaterial({ color: '#4a3424', roughness: 0.85 });
  // the broadside guns, run out: a muzzle poking from each port
  const len = 1.6 + 0.35 * R.guns, rad = 0.1 + 0.025 * R.guns;
  const barrel = new THREE.CylinderGeometry(rad * 0.8, rad, len, 8).rotateZ(Math.PI / 2);
  const B = ship.cls.beam / 2;
  for (const p of M.gunPositions) {
    const sd = Math.sign(p.x) || 1;
    // (just outboard of the side, at the ports)
    const half = M.deckHalf ? M.deckHalf / 0.85 : B;
    const m = new THREE.Mesh(barrel, iron);
    // (only the muzzle shows outboard: a foot or so for a 6-pounder, two feet for a long 18)
    // (the side draws in toward the bow and stern)
    const Lh = (M.deckLen || ship.cls.length * 0.7) / 2, u = (p.z - (M.deckMid || 0)) / Lh;
    const taper = Math.sqrt(Math.max(0.2, 1 - Math.pow(Math.abs(u), 2.5) * 0.85));
    m.position.set(sd * (half * 0.86 * taper + 0.3 + 0.12 * R.guns - len / 2), M.deckY - 0.15, p.z);
    m.castShadow = true;
    grp.add(m);
  }
  const L = M.deckLen || ship.cls.length * 0.7, mid = M.deckMid || 0;
  if (R.chase) {
    for (const [z, dir] of [[mid - L / 2 + 0.2, -1], [mid + L / 2 - 0.2, 1]]) {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 2.0, 8).rotateX(Math.PI / 2), iron);
      m.position.set(0, M.deckY + 0.9, z + dir * 0.5);
      const carriage = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.35, 1.0), wood);
      carriage.position.set(0, M.deckY + 0.6, z);
      grp.add(m, carriage);
    }
  }
  if (R.swivels) {
    const n = Math.max(2, Math.round(L / 6));
    for (let i = 0; i < n; i++) for (const sd of [-1, 1]) {
      const z = mid - L / 2 + ((i + 0.5) / n) * L;
      const half = (M.deckHalf ? M.deckHalf / 0.85 : B) * 0.95;
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.6, 5), wood);
      post.position.set(sd * half, M.deckY + 1.1, z);
      const gun = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 0.8, 6).rotateZ(Math.PI / 2), iron);
      gun.position.set(sd * (half + 0.2), M.deckY + 1.45, z);
      grp.add(post, gun);
    }
  }
  g.add(grp);
}
