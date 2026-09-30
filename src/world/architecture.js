// Period buildings of the four ports, after the maps, paintings, surveys and archaeology of the towns
// (Havana's limewashed casas with turned-wood window grilles and balconies, Port Royal's brick terraces with
// shop fronts and "piazzas", the French "cases" of Tortuga, the tents and palmetto huts of pirate Nassau).
// Every builder works in the town's local frame: (a, b) is the centre of the footprint, `rot` the local yaw
// of the building (its front faces local -z rotated by rot), w the frontage and d the depth.
import * as THREE from 'three';
import { T, gableRoofGeometry, gableEndGeometry, hipRoofGeometry } from './builder.js';
const pick = (arr, rnd) => arr[Math.floor(rnd() * arr.length) % arr.length];

// Palettes from the research (hex values chosen from paintings and surviving buildings)
export const PALETTE = {
  havana: {
    walls: ['#f3eee2', '#f3eee2', '#efe6d0', '#e3c27a', '#ead7a6', '#a9c4d6', '#e1a99a', '#a8c9b0', '#f0dcc0'],
    plinth: '#8c7b67', roofs: ['#b5653e', '#9a5536', '#a85e3a', '#8c6a55'],
    shutters: ['#5b3a29', '#3f5e4a', '#6e8b9a', '#4a3424'], stone: '#cdbb98',
  },
  portroyal: {
    bricks: ['#b8664a', '#a8583e', '#c47456', '#9c4d36', '#b06048'],
    render: ['#efe8da', '#e8e0cc', '#f2ecdf'], roofs: ['#6a5646', '#5c4a3c', '#7a6452'], pantile: ['#9c4a2e', '#8a4430'],
    shutters: ['#3e4a3a', '#5a3d2b', '#2f3a30'], trim: '#efe8da', clap: ['#8b7355', '#c9b79c', '#a08a6a'],
  },
  cayona: {
    walls: ['#efeae0', '#efeae0', '#e9e2d2', '#7b6a55', '#8a7a62'], roofs: ['#a28d5b', '#6d5a48'],
    shutters: ['#7a2e24', '#5e7482', '#7a2e24', '#4d5f4a'],
  },
  nassau: {
    cloth: ['#d8cbb0', '#cfc1a2', '#b8a88a', '#e2d6bc', '#c4b393', '#a89878'],
    wood: ['#7a6a55', '#6f6252', '#8b7355', '#5e5244'], thatch: ['#a8955f', '#9c8b5e', '#8a7b5a'],
    lime: ['#ede6d6', '#e6ddc8', '#d9d0be'],
  },
};

// local transform helper for a building at (a, b) turned by rot
function framer(a, b, rot) {
  const c = Math.cos(rot), s = Math.sin(rot);
  return (x, y, z, ry = 0, sx = 1, sy = 1, sz = 1, rx = 0, rz = 0) => T(a + x * c + z * s, y, b - x * s + z * c, ry + rot, sx, sy, sz, rx, rz);
}

// local (a, b) of a point in a building's frame
function at(m, x, z) { const p = new THREE.Vector3().applyMatrix4(m(x, 0, z)); return { a: p.x, b: p.z }; }

// Life on a street front: a shop with its goods set out on the street, a painted sign on an iron bracket,
// an awning; a lamp on a bracket by the door; pots of flowers and a hanging on the balcony.
const SIGNS = ['#7a2a1a', '#1f4a6a', '#2f5a2a', '#6a4a1a', '#3a2a4a', '#8a6a2a'];
const WARES = {
  pottery: ['jug_01', 'jug_01', 'wooden_bucket_01'],
  baskets: ['wicker_basket_01', 'wicker_basket_01', 'wooden_bucket_01'],
  barrels: ['wine_barrel_01'],
  crates: ['wooden_crate_01', 'wooden_crate_02', 'old_military_crate'],
};
export function streetFront(B, t, rnd, m, w, d, base, o = {}) {
  const r = rnd();
  const fz = -d / 2;
  if (r < (o.shop ?? 0.3)) {
    // wares outside
    const kinds = Object.keys(WARES), kind = kinds[Math.floor(rnd() * kinds.length)];
    const n = 2 + Math.floor(rnd() * 4);
    for (let k = 0; k < n; k++) {
      const x = -w / 2 + 0.8 + rnd() * (w - 1.6), z = fz - 0.7 - rnd() * 0.8;
      const p = at(m, x, z);
      const name = WARES[kind][Math.floor(rnd() * WARES[kind].length)];
      const sc = name === 'wine_barrel_01' ? 1.05 : name.startsWith('wooden_crate') ? 1.3 : name === 'old_military_crate' ? 0.9 : 1.7;
      t.prop(name, p.a, base, p.b, rnd() * 6, sc);
    }
    // a trestle with goods in bolts and bundles
    if (rnd() < 0.5) {
      const p = at(m, (rnd() - 0.5) * (w - 3), fz - 0.9);
      B.box('wood', 2.2, 0.08, 0.8, T(p.a, base + 0.85, p.b, o.rot), '#6a5040');
      for (const k of [-0.9, 0.9]) B.box('wood', 0.08, 0.85, 0.7, T(p.a + Math.cos(o.rot) * k, base + 0.42, p.b - Math.sin(o.rot) * k, o.rot), '#4a3526');
      for (let k = 0; k < 4; k++) B.box('cloth', 0.45, 0.22, 0.6, T(p.a + Math.cos(o.rot) * (k - 1.5) * 0.5, base + 1.0, p.b - Math.sin(o.rot) * (k - 1.5) * 0.5, o.rot), SIGNS[Math.floor(rnd() * SIGNS.length)]);
    }
    // awning
    if (rnd() < 0.6) {
      const aw = Math.min(w - 0.6, 3 + rnd() * 3), x = (rnd() - 0.5) * (w - aw);
      const col = ['#d8cbb0', '#b5462e', '#e8e0cc', '#3d6a8a', '#c9a13a', '#8a4a3a'][Math.floor(rnd() * 6)];
      B.box('cloth', aw, 0.04, 1.8, m(x, base + 3.1, fz - 0.85, 0, 1, 1, 1, 0.3), col);
      for (const k of [-1, 1]) B.box('wood', 0.05, 0.05, 1.8, m(x + k * aw / 2, base + 3.05, fz - 0.85, 0, 1, 1, 1, 0.3), '#4a3a2a');
    }
    // hanging sign
    const sx = w / 2 - 0.8;
    B.box('metal', 0.04, 0.04, 1.2, m(sx, base + 3.7, fz - 0.6), '#1c1c1c');
    B.box('wood', 0.06, 0.7, 0.9, m(sx, base + 3.25, fz - 0.95), SIGNS[Math.floor(rnd() * SIGNS.length)]);
    if (rnd() < 0.5) t.spot('work', at(m, 0, fz - 1.6).a, at(m, 0, fz - 1.6).b, o.rot + Math.PI);
  }
  // a lamp on a bracket beside the door
  if (rnd() < (o.lamp ?? 0.25)) {
    const x = (rnd() < 0.5 ? -1 : 1) * Math.min(w / 2 - 0.6, 1.8);
    B.box('metal', 0.05, 0.05, 0.6, m(x, base + 3.4, fz - 0.3), '#1c1c1c');
    B.box('metal', 0.3, 0.42, 0.3, m(x, base + 3.2, fz - 0.62), '#2a2a2a');
    B.box('glow', 0.18, 0.26, 0.18, m(x, base + 3.2, fz - 0.62), '#ffcf80');
    const p = new THREE.Vector3().applyMatrix4(m(x, base + 3.2, fz - 0.62));
    t.lanterns.push(t.toWorld(p.x, p.z, p.y));
  }
  // balcony life: pots and a hanging
  if (o.balconyY) {
    const n = Math.floor(rnd() * 4);
    for (let k = 0; k < n; k++) {
      const x = -w / 2 + 1 + rnd() * (w - 2);
      B.cyl('wall', 0.14, 0.11, 0.26, 7, m(x, o.balconyY + 0.2, fz - 0.95), '#a8583e');
      B.add('plain', new THREE.IcosahedronGeometry(0.22, 0), m(x, o.balconyY + 0.45, fz - 0.95), rnd() < 0.3 ? '#b8442a' : '#4a6a2a');
    }
    if (rnd() < 0.25) B.box('cloth', 1.2 + rnd(), 1.4, 0.03, m((rnd() - 0.5) * (w - 2), o.balconyY + 0.1, fz - 1.1), ['#b5462e', '#efe8da', '#3d6a8a', '#c9a13a'][Math.floor(rnd() * 4)]);
  }
}

// ridge tiles along a gable roof whose ridge runs along local x at height y
function ridge(B, m, len, y, col, bucket = 'roof') {
  B.add(bucket, new THREE.CylinderGeometry(0.16, 0.16, len + 0.9, 6, 1, false, 0, Math.PI), m(0, y - 0.02, 0, 0, 1, 1, 1, 0, Math.PI / 2), col);
}

// lowest ground under a footprint (buildings stand on a plinth that hides any slope)
export function footing(t, a, b, w, d, rot) {
  const m = framer(a, b, rot);
  let lo = Infinity, hi = -Infinity;
  const p = new THREE.Vector3();
  for (const [x, z] of [[-w / 2, -d / 2], [w / 2, -d / 2], [-w / 2, d / 2], [w / 2, d / 2], [0, 0]]) {
    p.set(0, 0, 0).applyMatrix4(m(x, 0, z));
    const g = t.groundAt(p.x, p.z);
    lo = Math.min(lo, g); hi = Math.max(hi, g);
  }
  return { lo, hi };
}

// a window with its surround; `grille`: Havana's turned-wood rejas; `shutters`: a pair of open shutters
function window_(B, m, x, y, z, face, o) {
  const { w = 1.1, h = 1.7, lit = false, shutter, grille = false, frame, louvre = false, glass = true } = o;
  const zf = z + face * 0.03;
  B.box(glass ? (lit ? 'windowLit' : 'window') : 'plain', w, h, 0.1, m(x, y, zf), glass ? '#1d1812' : '#1a1410');
  if (frame) {
    B.box('wood', w + 0.24, 0.12, 0.14, m(x, y + h / 2 + 0.06, zf + face * 0.02), frame);
    B.box('wood', w + 0.3, 0.1, 0.24, m(x, y - h / 2 - 0.05, zf + face * 0.06), frame);
    for (const k of [-1, 1]) B.box('wood', 0.1, h, 0.12, m(x + k * (w / 2 + 0.06), y, zf + face * 0.02), frame);
    if (glass) B.box('wood', w, 0.05, 0.05, m(x, y, zf + face * 0.04), frame); // sash bar
  }
  if (grille) {
    // turned balusters in a box projecting from the wall, with a little cap and sill
    const dz = face * 0.28;
    B.box('wood', w + 0.3, 0.14, 0.4, m(x, y + h / 2 + 0.07, zf + dz * 0.6), grille);
    B.box('wood', w + 0.3, 0.12, 0.42, m(x, y - h / 2 - 0.06, zf + dz * 0.6), grille);
    const n = Math.max(4, Math.round(w / 0.16));
    for (let i = 0; i < n; i++) B.box('wood', 0.045, h, 0.045, m(x - w / 2 + (i + 0.5) * (w / n), y, zf + dz), grille);
  }
  if (shutter) {
    for (const k of [-1, 1]) {
      B.box('wood', w / 2 + 0.05, h, 0.06, m(x + k * (w * 0.75 + 0.1), y, zf + face * 0.05), shutter);
      if (louvre) for (let i = 0; i < 4; i++) B.box('wood', w / 2, 0.03, 0.05, m(x + k * (w * 0.75 + 0.1), y - h / 2 + (i + 0.5) * (h / 4), zf + face * 0.09), '#1f1a14');
    }
  }
}

function door_(B, m, x, y0, z, face, o) {
  const { w = 1.5, h = 2.7, col = '#4a3120', surround } = o;
  B.box('wood', w, h, 0.14, m(x, y0 + h / 2, z + face * 0.03), col);
  if (surround) {
    // cut-stone doorway (portada)
    B.box('stone', w + 0.9, 0.5, 0.3, m(x, y0 + h + 0.25, z + face * 0.08), surround);
    for (const k of [-1, 1]) B.box('stone', 0.42, h, 0.26, m(x + k * (w / 2 + 0.22), y0 + h / 2, z + face * 0.06), surround);
  }
}

// ---------------------------------------------------------------- Havana
// Casa de una planta / casa de alto: limewashed stone, clay barrel-tile roofs, tall doors, turned-wood rejas,
// a wooden balcón corrido under its own little tiled roof (tejaroz) on the upper floor.
export function spanishHouse(B, t, rnd, a, b, rot, w, d, o = {}) {
  const P = PALETTE.havana;
  const storeys = o.storeys ?? 1;
  const m = framer(a, b, rot);
  const { lo, hi } = footing(t, a, b, w, d, rot);
  const y0 = lo - 0.3, base = hi + 0.1;
  const wall = o.wall || pick(P.walls, rnd), roofC = pick(P.roofs, rnd), sh = pick(P.shutters, rnd);
  const h1 = 5 + rnd() * 0.5, h2 = 4.5;
  const H = storeys === 1 ? h1 : h1 + h2;
  B.box('wall', w, base - y0 + H, d, m(0, (y0 + base + H) / 2, 0), wall);
  B.box('wall', w + 0.04, base - y0 + 0.8, d + 0.04, m(0, (y0 + base + 0.8) / 2, 0), P.plinth); // painted plinth
  if (storeys > 1) B.box('wall', w + 0.1, 0.22, d + 0.1, m(0, base + h1, 0), '#f4ecdc'); // string course
  // roof: low tiled gable along the street, or a flat azotea behind a parapet
  const top = base + H;
  if (o.flat || (storeys > 1 && rnd() < 0.3)) {
    B.box('wall', w + 0.1, 0.6, d + 0.1, m(0, top + 0.3, 0), wall);
    B.box('stone', w - 0.5, 0.1, d - 0.5, m(0, top + 0.05, 0), '#b9ad98');
  } else {
    const rise = Math.min(d * 0.2, 2.2);
    B.add('roof', gableRoofGeometry(w, d, rise, 0.55), m(0, top, 0), roofC);
    ridge(B, m, w, top + rise, roofC);
    for (const s of [-1, 1]) B.add('wall', gableEndGeometry(d, rise * (d / 2) / (d / 2 + 0.55)), m(s * w / 2, top, 0, s > 0 ? 0 : Math.PI), wall);
    // eaves brackets (tejaroz) along the street
    for (let x = -w / 2 + 0.6; x < w / 2; x += 1.1) B.box('wood', 0.12, 0.14, 0.6, m(x, top - 0.12, -d / 2 - 0.25), '#4a3526');
  }
  // street front: a tall door with a stone portada and barred windows; balcony upstairs
  const n = Math.max(1, Math.floor(w / 3.4));
  const doorI = Math.min(n - 1, Math.floor(rnd() * n));
  for (let i = 0; i < n; i++) {
    const x = -w / 2 + (i + 0.5) * (w / n);
    if (i === doorI) door_(B, m, x, base, -d / 2, -1, { w: 1.7, h: 3.2, col: pick(['#4a3120', '#5b3a29', '#3f5e4a'], rnd), surround: storeys > 1 || rnd() < 0.4 ? P.stone : null });
    else window_(B, m, x, base + 2.1, -d / 2, -1, { w: 1.2, h: 2.4, grille: sh, glass: false });
    if (storeys > 1) window_(B, m, x, base + h1 + 1.8, -d / 2, -1, { w: 1.1, h: 2.5, shutter: sh, glass: rnd() < 0.5, lit: rnd() < 0.3 });
  }
  if (storeys > 1 && (o.balcony ?? rnd() < 0.75)) {
    const bw = w - 0.8, yb = base + h1 + 0.1;
    B.box('wood', bw, 0.16, 1.1, m(0, yb, -d / 2 - 0.55), '#4a3526');
    for (let x = -bw / 2 + 0.6; x < bw / 2; x += 1.2) B.box('wood', 0.14, 0.3, 1.0, m(x, yb - 0.22, -d / 2 - 0.5), '#3b2a1e'); // corbels
    B.box('wood', bw, 0.08, 0.08, m(0, yb + 1.0, -d / 2 - 1.06), '#4a3526');
    const nb = Math.round(bw / 0.3);
    for (let i = 0; i <= nb; i++) B.box('wood', 0.05, 0.9, 0.05, m(-bw / 2 + i * (bw / nb), yb + 0.53, -d / 2 - 1.06), '#4a3526');
    B.box('roof', bw + 0.3, 0.1, 1.4, m(0, base + H - 0.4, -d / 2 - 0.62, 0, 1, 1, 1, -0.28), roofC); // tejaroz
    for (const k of [-1, 1]) B.box('wood', 0.1, H - h1 - 0.6, 0.1, m(k * bw / 2, yb + (H - h1 - 0.6) / 2, -d / 2 - 1.05), '#3b2a1e');
  }
  // side walls: barred windows (and the odd side door) where the neighbour doesn't hide them
  const nd = Math.max(1, Math.floor(d / 4.5));
  for (const sx of [-1, 1]) for (let i = 0; i < nd; i++) {
    const z = -d / 2 + (i + 0.5) * (d / nd);
    const cm = (x, y, zz, ry = 0) => m(x, y, zz, ry + sx * Math.PI / 2);
    if (rnd() < 0.2 && i === 0) B.box('wood', 0.14, 3, 1.5, m(sx * (w / 2 + 0.03), base + 1.5, z), '#4a3120');
    else {
      B.box('plain', 0.1, 2.2, 1.1, m(sx * (w / 2 + 0.03), base + 2.1, z), '#1a1410');
      for (let k = 0; k < 6; k++) B.box('wood', 0.05, 2.2, 0.05, m(sx * (w / 2 + 0.2), base + 2.1, z - 0.5 + k * 0.2), sh);
    }
    if (storeys > 1) B.box('plain', 0.1, 2.2, 1.0, m(sx * (w / 2 + 0.03), base + h1 + 1.8, z), '#1a1410');
    void cm;
  }
  streetFront(B, t, rnd, m, w, d, base, { rot, shop: storeys > 1 ? 0.35 : 0.22, balconyY: storeys > 1 ? base + h1 + 0.1 : 0 });
  t.addCollider(a, b, w / 2 + 0.2, d / 2 + 0.2, rot, H);
  return { top, front: m(0, base, -d / 2) };
}

// Houses along a plaza with an arcade (portales) of stone piers in front of the shops; d includes the arcade
export function portales(B, t, rnd, a, b, rot, w, d) {
  const P = PALETTE.havana;
  const m = framer(a, b, rot);
  const arc = 3.6;
  const { lo, hi } = footing(t, a, b, w, d, rot);
  const y0 = lo - 0.3, base = hi + 0.1, h1 = 5, H = 10;
  const wall = pick(P.walls, rnd), stone = '#d8caa8';
  const zf = -d / 2, zb = -d / 2 + arc; // arcade front, shop fronts
  B.box('wall', w, base - y0 + H, d - arc, m(0, (y0 + base + H) / 2, (zb + d / 2) / 2), wall);
  B.box('wall', w, H - h1, arc, m(0, base + h1 + (H - h1) / 2, zf + arc / 2), wall); // upper floor over the arcade
  B.box('stone', w, base - y0 + 0.12, arc, m(0, (y0 + base + 0.12) / 2, zf + arc / 2), '#b9ad98'); // arcade floor
  const bays = Math.max(2, Math.round(w / 4));
  for (let i = 0; i <= bays; i++) B.box('stone', 0.8, h1, 0.8, m(-w / 2 + i * (w / bays), base + h1 / 2, zf + 0.4), stone);
  B.box('stone', w, 0.9, 0.9, m(0, base + h1 - 0.45, zf + 0.45), stone);
  const sh = pick(P.shutters, rnd);
  for (let i = 0; i < bays; i++) {
    const x = -w / 2 + (i + 0.5) * (w / bays);
    door_(B, m, x, base, zb, -1, { w: 2.2, h: 3.4, col: '#5b3a29' });
    window_(B, m, x, base + h1 + 2.1, zf, -1, { w: 1.1, h: 2.4, shutter: sh, glass: false });
  }
  B.add('roof', gableRoofGeometry(w, d, 1.8, 0.5), m(0, base + H, 0), pick(P.roofs, rnd));
  for (const s2 of [-1, 1]) B.add('wall', gableEndGeometry(d, 1.8 * (d / 2) / (d / 2 + 0.5)), m(s2 * w / 2, base + H, 0, s2 > 0 ? 0 : Math.PI), wall);
  t.addCollider(a + (arc / 2) * Math.sin(rot), b + (arc / 2) * Math.cos(rot), w / 2, (d - arc) / 2, rot, H); // the body; the arcade stays walkable
}

// ---------------------------------------------------------------- Port Royal
// Brick terrace houses of two or three storeys: shop below with drop-down board counters, sash windows with
// louvred shutters, steep shingle or pantile roofs with brick chimneys, and a timber "piazza" over the
// brick sidewalk. Some are rendered and limewashed; poorer ones are clapboard frame houses.
export function englishHouse(B, t, rnd, a, b, rot, w, d, o = {}) {
  const P = PALETTE.portroyal;
  const m = framer(a, b, rot);
  const frame = o.frame ?? rnd() < 0.2;
  const rendered = !frame && rnd() < 0.25;
  const storeys = o.storeys ?? (frame ? 1 + (rnd() < 0.5 ? 1 : 0) : 2 + (rnd() < 0.35 ? 1 : 0));
  const { lo, hi } = footing(t, a, b, w, d, rot);
  const y0 = lo - 0.3, base = hi + 0.15, sh = 3.2;
  const H = storeys * sh;
  const bucket = frame ? 'clap' : rendered ? 'wall' : 'brick';
  const col = frame ? pick(P.clap, rnd) : rendered ? pick(P.render, rnd) : pick(P.bricks, rnd);
  B.box(bucket, w, base - y0 + H, d, m(0, (y0 + base + H) / 2, 0), col);
  B.box('brick', w + 0.06, base - y0 + 0.2, d + 0.06, m(0, (y0 + base + 0.2) / 2, 0), '#8a4a34'); // brick sill
  // roof: ridge along the street, or a gable end turned to it
  const top = base + H;
  const gableFront = !frame && rnd() < 0.3;
  const shingle = rnd() < 0.65;
  const roofB = shingle ? 'shingle' : 'roof', roofC = shingle ? pick(P.roofs, rnd) : pick(P.pantile, rnd);
  const span = gableFront ? w : d, run = gableFront ? d : w;
  const rise = span * 0.55;
  B.add(roofB, gableRoofGeometry(run, span, rise, 0.35), m(0, top, 0, gableFront ? Math.PI / 2 : 0), roofC);
  for (const s of [-1, 1]) {
    const ge = gableEndGeometry(span, rise * (span / 2) / (span / 2 + 0.35));
    if (gableFront) B.add(bucket, ge, m(0, top, s * run / 2, s > 0 ? -Math.PI / 2 : Math.PI / 2), col);
    else B.add(bucket, ge, m(s * run / 2, top, 0, s > 0 ? 0 : Math.PI), col);
  }
  if (!frame) {
    const cx = gableFront ? 0 : (rnd() < 0.5 ? -1 : 1) * (w / 2 - 0.7), cz = gableFront ? d / 2 - 0.7 : 0;
    B.box('brick', 1.0, rise + 1.6, 0.8, m(cx, top + (rise + 1.6) / 2 - 0.3, cz), '#8f4a33');
    B.box('brick', 1.15, 0.2, 0.95, m(cx, top + rise + 1.2, cz), '#7a3e2c');
    if (rnd() < 0.18) { const p = new THREE.Vector3().applyMatrix4(m(cx, top + rise + 1.4, cz)); t.chimneys.push(t.toWorld(p.x, p.z, p.y)); }
  }
  // front: ground-floor shop, sash windows above
  const n = Math.max(1, Math.round(w / 2.6));
  const trim = P.trim, shut = pick(P.shutters, rnd);
  for (let s = 0; s < storeys; s++) {
    for (let i = 0; i < n; i++) {
      const x = -w / 2 + (i + 0.5) * (w / n);
      if (s === 0) {
        if (i === 0) door_(B, m, x, base, -d / 2, -1, { w: 1.2, h: 2.4, col: '#3a2a1c' });
        else {
          // shop window with its board shutter let down as a counter
          B.box('window', 1.6, 1.4, 0.1, m(x, base + 1.5, -d / 2 - 0.03), '#1d1812');
          B.box('wood', 1.7, 0.08, 0.6, m(x, base + 0.85, -d / 2 - 0.32), '#6a5040');
          if (!frame) B.box('brick', 1.9, 0.3, 0.2, m(x, base + 2.35, -d / 2 - 0.08), '#8f4a33'); // arch head
        }
      } else window_(B, m, x, base + s * sh + 1.6, -d / 2, -1, { w: 0.9, h: 1.5, frame: trim, shutter: shut, louvre: true, lit: rnd() < 0.35 });
    }
    // windows to the back too
    if (s > 0) for (let i = 0; i < n; i++) window_(B, m, -w / 2 + (i + 0.5) * (w / n), base + s * sh + 1.6, d / 2, 1, { w: 0.9, h: 1.5, frame: trim, lit: rnd() < 0.3 });
  }
  if (!frame && storeys > 1) B.box(bucket === 'brick' ? 'brick' : 'wall', w + 0.08, 0.16, d + 0.08, m(0, base + sh, 0), rendered ? '#f6f1e6' : '#9a5038');
  // piazza: posts and a shingled lean-to over the brick pavement
  if (o.piazza ?? rnd() < 0.6) {
    const pd = 2.4, ph = 3.0;
    B.box('brick', w, 0.12, pd, m(0, base - 0.05, -d / 2 - pd / 2), '#9c5a42');
    for (let x = -w / 2 + 0.2; x <= w / 2; x += Math.max(2.4, w / Math.ceil(w / 3))) B.box('wood', 0.16, ph, 0.16, m(x, base + ph / 2, -d / 2 - pd + 0.15), '#4a3a2c');
    B.box('wood', w, 0.18, 0.2, m(0, base + ph, -d / 2 - pd + 0.15), '#4a3a2c');
    B.box('shingle', w + 0.2, 0.08, pd + 0.4, m(0, base + ph + 0.35, -d / 2 - pd / 2 + 0.1, 0, 1, 1, 1, -0.22), roofC);
  }
  if (!gableFront) ridge(B, m, run, top + rise, roofC, roofB);
  streetFront(B, t, rnd, m, w, d, base, { rot, shop: 0.3, lamp: 0.2 });
  t.addCollider(a, b, w / 2 + 0.15, d / 2 + 0.15, rot, H + rise);
  return { top };
}

// ---------------------------------------------------------------- Tortuga
// French "case": a single storey on a masonry plinth, limewashed boards or bare planks, a steep hipped roof of
// latanier thatch or wooden shingles, board shutters in ox-blood or blue-grey and a gallery along the front.
export function frenchCase(B, t, rnd, a, b, rot, w, d, o = {}) {
  const P = PALETTE.cayona;
  const m = framer(a, b, rot);
  const { lo, hi } = footing(t, a, b, w, d, rot);
  const y0 = lo - 0.2, base = hi + 0.45, H = 3 + (o.tall ? 1.4 : 0);
  const bare = rnd() < 0.3;
  const col = bare ? pick(P.walls.slice(3), rnd) : pick(P.walls.slice(0, 3), rnd);
  B.box('stone', w + 0.3, base - y0, d + 0.3, m(0, (y0 + base) / 2, 0), '#cfc6b0'); // masonry plinth
  B.box(bare ? 'clap' : 'wall', w, H, d, m(0, base + H / 2, 0), col);
  const thatch = o.thatch ?? rnd() < 0.55;
  const rise = Math.min(w, d) * 0.75;
  const gal = o.gallery ?? rnd() < 0.75;
  const gd = gal ? 1.8 : 0;
  B.add(thatch ? 'thatch' : 'shingle', hipRoofGeometry(w, d + gd, rise, 0.5), m(0, base + H - 0.05, -gd / 2), thatch ? pick(['#a28d5b', '#978352', '#ae9a66'], rnd) : '#6d5a48');
  if (gal) {
    B.box('wood', w, 0.12, gd, m(0, base, -d / 2 - gd / 2), '#6f5a44');
    for (let x = -w / 2 + 0.15; x <= w / 2; x += w / Math.max(2, Math.round(w / 2.2))) B.box('wood', 0.14, H - 0.2, 0.14, m(x, base + (H - 0.2) / 2, -d / 2 - gd + 0.1), '#5a4632');
  }
  const sh = pick(P.shutters, rnd);
  const n = Math.max(2, Math.round(w / 2.4));
  for (let i = 0; i < n; i++) {
    const x = -w / 2 + (i + 0.5) * (w / n);
    if (i === Math.floor(n / 2)) door_(B, m, x, base, -d / 2, -1, { w: 1.2, h: 2.3, col: sh });
    else window_(B, m, x, base + 1.4, -d / 2, -1, { w: 0.9, h: 1.2, shutter: sh, glass: false });
  }
  window_(B, m, 0, base + 1.4, d / 2, 1, { w: 0.9, h: 1.2, shutter: sh, glass: false });
  streetFront(B, t, rnd, m, w, d + gd * 2, base, { rot, shop: 0.12, lamp: 0.1 });
  t.addCollider(a, b, w / 2 + 0.2, d / 2 + 0.2 + gd / 2, rot, H + rise);
}

// ---------------------------------------------------------------- Nassau
// sailcloth tent over a ridge spar: patched canvas, guy ropes, a sea chest at the door
export function tent(B, t, rnd, a, b, rot, w, d) {
  const m = framer(a, b, rot);
  const y = t.groundAt(...(() => { const p = new THREE.Vector3().applyMatrix4(m(0, 0, 0)); return [p.x, p.z]; })());
  const g = t.groundAt, P = PALETTE.nassau;
  const h = 1.9 + rnd() * 0.6;
  const cloth = pick(P.cloth, rnd);
  B.add('cloth', gableRoofGeometry(d, w, h, 0.05), m(0, y - 0.1, 0, Math.PI / 2), cloth);
  B.add('cloth', gableEndGeometry(w, h), m(0, y - 0.1, d / 2, -Math.PI / 2), cloth); // closed back
  B.cyl('wood', 0.05, 0.05, d + 0.6, 5, m(0, y + h - 0.12, 0, 0, 1, 1, 1, Math.PI / 2), '#5a4632');
  for (const s of [-1, 1]) B.cyl('wood', 0.05, 0.05, h, 5, m(0, y + h / 2 - 0.1, s * (d / 2 + 0.1)), '#5a4632');
  // a patch or two of darker sail
  if (rnd() < 0.6) B.box('cloth', 0.9, 0.7, 0.02, m(w * 0.22, y + h * 0.45, (rnd() - 0.5) * d * 0.5, 0, 1, 1, 1, 0, Math.atan2(h, w / 2) - Math.PI / 2), pick(['#9c8c70', '#b09e7e', '#8a7a60'], rnd));
  if (rnd() < 0.5) t.prop('treasure_chest', 0.9, y, -d / 2 - 0.9, rot + (rnd() - 0.5), 0.8) || B.box('wood', 0.9, 0.55, 0.55, m(0.9, y + 0.27, -d / 2 - 0.7), '#5a4028');
  void g;
  t.addCollider(a, b, w / 2 + 0.2, d / 2 + 0.2, rot, h);
}

// lean-to: a slanted sail or thatch roof on posts against a plank back wall, a hammock slung beneath
export function leanTo(B, t, rnd, a, b, rot, w, d) {
  const m = framer(a, b, rot);
  const p = new THREE.Vector3().applyMatrix4(m(0, 0, 0));
  const y = t.groundAt(p.x, p.z);
  const P = PALETTE.nassau;
  const hb = 2.4, hf = 1.8;
  B.box('clap', w, hb, 0.12, m(0, y + hb / 2 - 0.2, d / 2), pick(P.wood, rnd));
  for (const x of [-w / 2, w / 2]) for (const z of [-d / 2]) B.cyl('wood', 0.07, 0.08, hf, 5, m(x, y + hf / 2 - 0.1, z), '#5a4632');
  const sail = rnd() < 0.5;
  const slope = Math.atan2(hb - hf, d);
  B.box(sail ? 'cloth' : 'thatch', w + 0.4, 0.06, Math.hypot(d, hb - hf) + 0.4, m(0, y + (hb + hf) / 2 - 0.15, 0, 0, 1, 1, 1, slope), sail ? pick(P.cloth, rnd) : pick(P.thatch, rnd));
  B.box('cloth', 0.6, 0.05, 2.0, m(0, y + 0.9, 0, Math.PI / 2 + 0.2, 1, 1, 1, 0, 0.12), '#bba888'); // hammock
  t.addCollider(a, b, w / 2, d / 2, rot, hb);
}

// palmetto hut: wattle-and-daub (or bare posts) under a steep hipped thatch
export function palmettoHut(B, t, rnd, a, b, rot, w, d) {
  const m = framer(a, b, rot);
  const { lo, hi } = footing(t, a, b, w, d, rot);
  const P = PALETTE.nassau;
  const y0 = lo - 0.2, base = hi, H = 2.4;
  const daub = rnd() < 0.6;
  B.box(daub ? 'wall' : 'clap', w, base - y0 + H, d, m(0, (y0 + base + H) / 2, 0), daub ? pick(P.lime, rnd) : pick(P.wood, rnd));
  B.add('thatch', hipRoofGeometry(w, d, Math.min(w, d) * 0.85, 0.55), m(0, base + H - 0.05, 0), pick(P.thatch, rnd));
  door_(B, m, 0, base, -d / 2, -1, { w: 1.0, h: 1.9, col: '#3a2a1c' });
  window_(B, m, w / 2 - 0.9, base + 1.3, -d / 2, -1, { w: 0.7, h: 0.7, shutter: '#5a4630', glass: false });
  t.addCollider(a, b, w / 2 + 0.2, d / 2 + 0.2, rot, H + 1.5);
}

// a stone house left roofless by the raids of 1703: broken walls of lime-plastered rubble
export function ruin(B, t, rnd, a, b, rot, w, d, col = '#d9d0be') {
  const m = framer(a, b, rot);
  const { lo } = footing(t, a, b, w, d, rot);
  const y0 = lo - 0.3;
  for (const [x, z, len, along] of [[0, -d / 2, w, true], [0, d / 2, w, true], [-w / 2, 0, d, false], [w / 2, 0, d, false]]) {
    const segs = Math.max(2, Math.round(len / 2.5));
    for (let k = 0; k < segs; k++) {
      if (rnd() < 0.18) continue; // breach
      const l = len / segs, off = -len / 2 + l * (k + 0.5), h = 1.2 + rnd() * 3.4;
      B.box('stone', along ? l : 0.6, h, along ? 0.6 : l, m(x + (along ? off : 0), y0 + h / 2, z + (along ? 0 : off)), col);
    }
  }
  // fallen rubble
  for (let i = 0; i < 5; i++) B.box('stone', 0.5 + rnd(), 0.3 + rnd() * 0.4, 0.5 + rnd(), m((rnd() - 0.5) * w, y0 + 0.4, (rnd() - 0.5) * d, rnd() * 3), col);
  t.addCollider(a, b, w / 2 + 0.3, d / 2 + 0.3, rot, 3);
}

// ---------------------------------------------------------------- shared
export function warehouse(B, t, rnd, a, b, rot, w, d, o = {}) {
  const m = framer(a, b, rot);
  const { lo, hi } = footing(t, a, b, w, d, rot);
  const y0 = lo - 0.3, base = hi + 0.1, H = o.h ?? 5.5;
  const bucket = o.bucket || 'stone', col = o.col || '#cfc3a8';
  B.box(bucket, w, base - y0 + H, d, m(0, (y0 + base + H) / 2, 0), col);
  B.add(o.roof || 'roof', gableRoofGeometry(w, d, d * 0.28, 0.5), m(0, base + H, 0), o.roofCol || '#a85e3a');
  for (const s of [-1, 1]) B.add(bucket, gableEndGeometry(d, d * 0.28 * (d / 2) / (d / 2 + 0.5)), m(s * w / 2, base + H, 0, s > 0 ? 0 : Math.PI), col);
  const n = Math.max(1, Math.round(w / 7));
  for (let i = 0; i < n; i++) {
    const x = -w / 2 + (i + 0.5) * (w / n);
    B.box('wood', 2.6, 3.4, 0.16, m(x, base + 1.7, -d / 2 - 0.04), '#4a3526');
    B.box(bucket, 3.2, 0.5, 0.3, m(x, base + 3.65, -d / 2 - 0.1), o.trim || col);
  }
  // hoist beam under the eaves
  B.box('wood', 0.25, 0.25, 1.6, m(0, base + H - 0.4, -d / 2 - 0.7), '#3b2a1e');
  t.addCollider(a, b, w / 2 + 0.2, d / 2 + 0.2, rot, H + 2);
}

// a church: nave with a gabled tiled roof, a stone portal, and a bell tower with an open belfry
export function church(B, t, rnd, a, b, rot, o = {}) {
  const { len = 30, wid = 12, h = 9, towerH = 22, tower = 'side', wall = '#f0e8d6', roofB = 'roof', roofCol = '#a5593a', bucket = 'wall', dome = false, spire = false, cote = false } = o;
  const m = framer(a, b, rot);
  const { lo, hi } = footing(t, a, b, wid, len, rot);
  const y0 = lo - 0.4, base = hi + 0.3;
  // nave runs along local z, facade at -z
  B.box(bucket, wid, base - y0 + h, len, m(0, (y0 + base + h) / 2, 0), wall);
  const rise = wid * 0.35;
  B.add(roofB, gableRoofGeometry(len, wid, rise, 0.4), m(0, base + h, 0, Math.PI / 2), roofCol);
  for (const s of [-1, 1]) B.add(bucket, gableEndGeometry(wid, rise * (wid / 2) / (wid / 2 + 0.4)), m(0, base + h, s * len / 2, s > 0 ? -Math.PI / 2 : Math.PI / 2), wall);
  // facade: portal, oculus, pilasters
  door_(B, m, 0, base, -len / 2, -1, { w: 2.6, h: 4.6, col: '#3b2a1e', surround: '#cdbb98' });
  B.cyl('window', 0.9, 0.9, 0.12, 16, m(0, base + h - 1.6, -len / 2 - 0.04, 0, 1, 1, 1, Math.PI / 2), '#1d1812');
  for (const k of [-1, 1]) B.box(bucket, 0.8, h, 0.5, m(k * (wid / 2 - 0.4), base + h / 2, -len / 2 - 0.2), wall === '#f0e8d6' ? '#e6dcc4' : wall);
  // side windows high up
  for (let z = -len / 2 + 4; z < len / 2 - 2; z += 5) for (const s of [-1, 1]) B.box('window', 0.12, 2.2, 1.2, m(s * (wid / 2 + 0.02), base + h - 2.6, z), '#1d1812');
  if (cote) {
    // a simple bell-cote over the facade
    B.box(bucket, 2.4, 3, 0.8, m(0, base + h + rise + 1.2, -len / 2 + 0.3), wall);
    B.box('window', 1.1, 1.4, 0.9, m(0, base + h + rise + 1.4, -len / 2 + 0.3), '#1a140e');
  }
  if (towerH > 0) {
    const tw = Math.max(4.5, wid * 0.42);
    const tx = tower === 'side' ? wid / 2 + tw / 2 - 0.2 : 0, tz = tower === 'side' ? -len / 2 + tw / 2 : -len / 2 - tw / 2 + 0.3;
    B.box(bucket, tw, base - y0 + towerH, tw, m(tx, (y0 + base + towerH) / 2, tz), wall);
    // belfry openings on every face and a cornice
    for (const [fx, fz] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) B.box('window', fx ? 0.2 : tw * 0.45, 2.6, fz ? 0.2 : tw * 0.45, m(tx + fx * tw / 2, base + towerH - 2.2, tz + fz * tw / 2), '#1a140e');
    B.box(bucket, tw + 0.5, 0.4, tw + 0.5, m(tx, base + towerH, tz), '#e8dcc4');
    B.box(bucket, tw + 0.5, 0.35, tw + 0.5, m(tx, base + towerH - 4, tz), '#e8dcc4');
    if (spire) B.add(o.spireB || 'shingle', hipRoofGeometry(tw, tw, tw * 1.8, 0.2), m(tx, base + towerH + 0.2, tz), o.spireCol || '#5c4a3c');
    else {
      B.add(roofB, hipRoofGeometry(tw * 0.9, tw * 0.9, tw * 0.45, 0.2), m(tx, base + towerH + 0.2, tz), roofCol);
      B.box('metal', 0.12, 2, 0.12, m(tx, base + towerH + tw * 0.45 + 1, tz), '#2a2016');
      B.box('metal', 0.9, 0.12, 0.12, m(tx, base + towerH + tw * 0.45 + 1.4, tz), '#2a2016');
    }
    const tp = new THREE.Vector3().applyMatrix4(m(tx, 0, tz)); // (local frame)
    t.addCollider(tp.x, tp.z, tw / 2, tw / 2, rot, towerH);
  }
  if (dome) {
    B.add('stone', new THREE.SphereGeometry(wid * 0.34, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), m(0, base + h + rise * 0.6, len / 2 - wid * 0.45), '#8f949a');
    B.cyl('wall', wid * 0.36, wid * 0.36, 2.2, 16, m(0, base + h + rise * 0.6 - 1, len / 2 - wid * 0.45), wall);
  }
  t.addCollider(a, b, wid / 2 + 0.2, len / 2 + 0.2, rot, h + rise);
  return { door: m(0, base, -len / 2 - 1.2), base };
}
