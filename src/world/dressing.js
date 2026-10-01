// The dressing pass: after a city's plan has laid out its streets and houses, fill the spaces between them
// with the clutter of daily life the way the period views show it (and the way the best open-world cities do):
// jars, crates and sacks against the walls, potted plants and flowering creepers, chairs by the doors with
// neighbours sitting out, strings of onions and peppers at the grocers', washing strung across the lanes and
// canvas shades over the busiest streets, market women selling from mats, and trees in the courtyards.
import * as THREE from 'three';
import { props } from './props.js';
import { T } from './builder.js';

const pick = (arr, rnd) => arr[Math.floor(rnd() * arr.length) % arr.length];

// per-town taste: how much of each thing
const STYLE = {
  havana: { jars: 0.35, pots: 0.45, creeper: 0.28, chair: 0.3, ristra: 0.16, cargo: 0.25, laundry: 0.3, shade: 0.14, plank: 0.12, mats: 0.5, courtyard: 0.6, density: 0.55, cloth: ['#efe8da', '#e6dcc4', '#b5462e', '#9fb3c4', '#c9a13a', '#efe8da', '#6a8a5a'] },
  portroyal: { jars: 0.05, pots: 0.15, creeper: 0.08, chair: 0.12, ristra: 0.04, cargo: 0.5, laundry: 0.35, shade: 0.03, plank: 0.15, mats: 0.35, courtyard: 0.35, density: 0.5, cloth: ['#efe8da', '#e6dcc4', '#d8d0bc', '#9fb3c4', '#7a1c1c', '#efe8da'] },
  tortuga: { jars: 0.15, pots: 0.35, creeper: 0.3, chair: 0.2, ristra: 0.06, cargo: 0.3, laundry: 0.25, shade: 0.0, plank: 0.1, mats: 0.4, courtyard: 0.3, density: 0.5, cloth: ['#efe8da', '#e6dcc4', '#7a2e24', '#5e7482', '#c9b48a'] },
  nassau: { jars: 0.1, pots: 0.05, creeper: 0.05, chair: 0.1, ristra: 0.02, cargo: 0.6, laundry: 0.1, shade: 0.0, plank: 0, mats: 0.6, courtyard: 0, density: 0.3, cloth: ['#d8cbb0', '#cfc1a2', '#b5462e', '#2a3450'] },
};

// a terracotta jar (tinaja) or flower pot, as a lathe
const _lathe = {};
function lathe(kind) {
  if (_lathe[kind]) return _lathe[kind];
  const pts = kind === 'jar'
    ? [[0, 0], [0.22, 0], [0.34, 0.2], [0.4, 0.45], [0.36, 0.72], [0.22, 0.88], [0.2, 0.95], [0.25, 1.0], [0.2, 1.0]]
    : [[0, 0], [0.15, 0], [0.2, 0.26], [0.23, 0.3], [0.21, 0.3]];
  return (_lathe[kind] = new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), 10));
}

// crossed leaf cards; `sheet`: 0 green creeper, 1 bougainvillea, 2 flowering shrub
function leafCard(B, m, w, h, sheet, color = '#ffffff') {
  const g = new THREE.PlaneGeometry(w, h);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setX(i, (uv.getX(i) + sheet) / 3);
  B.add('foliage', g, m, color, 'own');
}

export function dress(K, id) {
  const S = STYLE[id];
  if (!S) return;
  const t = K.t, B = K.B, rnd = K.rnd;
  const plants = (t.extraPlants = t.extraPlants || []);
  const trees = (t.extraTrees = t.extraTrees || []);
  const plant = (kind, a, y, b, sc) => { const w = t.toWorld(a, b); plants.push([kind, w.x, y, w.z, rnd() * 6.28, sc]); };
  const tree = (kind, a, b, sc) => { const w = t.toWorld(a, b); trees.push([kind, w.x, t.groundAt(a, b), w.z, rnd() * 6.28, sc]); };

  const free = (p, r) => !t.overlapsRect(p.a, p.b, r, r, 0);
  const ground = (p) => t.groundAt(p.a, p.b);
  const inside = (a, b) => {
    for (const h of K.buildings) {
      const dx = a - h.a, db = b - h.b;
      if (dx * dx + db * db > (h.w + h.d) ** 2) continue;
      const c = Math.cos(h.rot), s = Math.sin(h.rot);
      const x = dx * c - db * s, z = dx * s + db * c;
      if (Math.abs(x) < h.w / 2 && Math.abs(z) < h.d / 2) return h;
    }
    return null;
  };

  // Things set against a wall. P(x, z): point x along the wall, z out from it; `out`: yaw facing the street
  // (facing vector (sin, cos)); `I`: the building's info (base, H).
  const jar = (P, x) => {
    const p = P(x, 0.45);
    if (!free(p, 0.3)) return false;
    const sc = 0.9 + rnd() * 0.5;
    B.add('wall', lathe('jar'), T(p.a, ground(p), p.b, rnd() * 6, sc, sc, sc), pick(['#a85a3a', '#b8683f', '#94533a'], rnd));
    t.addCollider(p.a, p.b, 0.36 * sc, 0.36 * sc, 0, 1.0 * sc);
    if (rnd() < 0.4) { const q = P(x + 0.75, 0.4); if (free(q, 0.25)) B.add('wall', lathe('jar'), T(q.a, ground(q), q.b, rnd() * 6, sc * 0.7, sc * 0.7, sc * 0.7), '#a85a3a'); }
    t.reserveRect(p.a, p.b, 0.4, 0.4);
    return true;
  };
  // pots of plants along the wall (the plants themselves are real photoscans, set by the vegetation)
  const pots = (P, x) => {
    const n = 1 + Math.floor(rnd() * 3);
    for (let k = 0; k < n; k++) {
      const p = P(x + k * 0.6, 0.35);
      if (!free(p, 0.2)) continue;
      const y = ground(p), big = rnd() < 0.25, sc = big ? 1.8 : 1 + rnd() * 0.3;
      B.add('wall', lathe('pot'), T(p.a, y, p.b, 0, sc, sc, sc), pick(['#a8583e', '#b8683f', '#8a4a34'], rnd));
      plant(big ? 'pachira' : rnd() < 0.5 ? 'calathea' : 'anthurium', p.a, y + 0.27 * sc, p.b, big ? 0.45 : 0.4 + rnd() * 0.2);
      t.reserveRect(p.a, p.b, 0.25, 0.25);
    }
    return true;
  };
  // a flowering creeper climbing the wall and spilling from the eaves
  const creeper = (P, x, out, I) => {
    if (!I.H) return false;
    const boug = rnd() < 0.7 ? 1 : rnd() < 0.5 ? 2 : 0;
    const top = I.base + I.H - 0.2;
    const p0 = P(x, 0.12);
    const y0 = ground(p0);
    B.box('wood', 0.07, top - y0, 0.07, T(p0.a, (y0 + top) / 2, p0.b, out), '#5a4632');
    for (let y = y0 + 0.9; y < top; y += 0.8) {
      const p = P(x + (rnd() - 0.5) * 0.5, 0.16);
      leafCard(B, T(p.a, y, p.b, out + (rnd() - 0.5) * 0.4), 1.0 + rnd() * 0.6 + (y - y0) * 0.12, 1.1, boug && y > y0 + 2 ? boug : 0);
    }
    for (let k = 0; k < 8; k++) {
      const p = P(x + (rnd() - 0.5) * 3.2, 0.2 + rnd() * 0.5);
      leafCard(B, T(p.a, top - rnd() * 1.6, p.b, out + (rnd() - 0.5) * 1.2, 1, 1, 1, (rnd() - 0.5) * 0.6), 1.2 + rnd() * 0.8, 1.2 + rnd() * 0.6, boug);
    }
    return true;
  };
  // cargo waiting outside: crates, sacks, a barrel, a broom and bucket
  const cargo = (P, x, out) => {
    const p = P(x, 0.55);
    if (!free(p, 0.5)) return false;
    const y = ground(p), r = rnd();
    if (r < 0.35) {
      const two = rnd() < 0.5;
      t.prop('wooden_crate_01', p.a, y, p.b, out, 1.2);
      const h1 = props.height('wooden_crate_01', 1.2) || 0.62, h2 = props.height('wooden_crate_02', 1.0) || 0.53;
      if (two) t.prop('wooden_crate_02', p.a, y + h1, p.b, out + (rnd() - 0.5) * 0.3, 1.0);
      t.addCollider(p.a, p.b, 0.38, 0.38, out, two ? h1 + h2 : h1); // something to vault onto
    }
    else if (r < 0.6) for (let k = 0; k < 3; k++) B.add('cloth', new THREE.SphereGeometry(0.3, 7, 5), T(p.a + (rnd() - 0.5) * 0.5, y + 0.2 + (k === 2 ? 0.3 : 0), p.b + (rnd() - 0.5) * 0.5, rnd() * 3, 1.1, 0.7, 1.4), pick(['#c8b58a', '#b8a47a', '#d6c9a8'], rnd));
    else if (r < 0.8) {
      t.barrel(B, p.a, y, p.b); t.addCollider(p.a, p.b, 0.4, 0.4, 0, 1.08);
      if (rnd() < 0.5) { const q = P(x + 0.95, 0.55); if (free(q, 0.4)) { t.barrel(B, q.a, y, q.b); t.addCollider(q.a, q.b, 0.4, 0.4, 0, 1.08); } }
    }
    else {
      const bp = P(x, 0.15);
      B.cyl('wood', 0.02, 0.02, 1.3, 4, T(bp.a, y + 0.7, bp.b, out, 1, 1, 1, -0.18), '#8a6a44');
      B.add('thatch', new THREE.ConeGeometry(0.13, 0.35, 6), T(bp.a, y + 0.16, bp.b, out, 1, 1, 1, -0.18), '#b89a5a');
      t.prop('wooden_bucket_01', p.a, y, p.b, rnd() * 6, 1.6);
    }
    t.reserveRect(p.a, p.b, 0.55, 0.55);
    return true;
  };
  // a chair by the door, and somebody sitting out in it
  const chair = (P, x, out) => {
    const p = P(x, 0.55);
    if (!free(p, 0.35)) return false;
    const y = ground(p), yaw = out + (rnd() - 0.5) * 0.6;
    const q = (u, v) => ({ a: p.a + u * Math.cos(yaw) + v * Math.sin(yaw), b: p.b - u * Math.sin(yaw) + v * Math.cos(yaw) });
    B.box('wood', 0.5, 0.06, 0.46, T(p.a, y + 0.45, p.b, yaw), '#6a4a30'); // rawhide seat
    for (const [u, v] of [[-0.21, -0.19], [0.21, -0.19], [-0.21, 0.19], [0.21, 0.19]]) { const r = q(u, v); B.box('wood', 0.05, 0.45, 0.05, T(r.a, y + 0.22, r.b, yaw), '#4a3526'); }
    const bk = q(0, -0.21); B.box('wood', 0.5, 0.55, 0.05, T(bk.a, y + 0.75, bk.b, yaw, 1, 1, 1, -0.12), '#5a4028');
    const st = q(0, 0.1);
    t.spots.push({ type: rnd() < 0.5 ? 'sit' : 'sitTalk', pos: t.toWorld(st.a, st.b, y), yaw: t.dir + yaw + Math.PI, taken: null });
    t.reserveRect(p.a, p.b, 0.35, 0.35);
    return true;
  };

  // ---- at the doors: neighbours sitting out, strings of onions and peppers at the grocers'
  const doors = [];
  for (const h of K.buildings) {
    const I = h.info;
    if (!I.style || I.door == null) continue;
    const c = Math.cos(h.rot), s = Math.sin(h.rot);
    const front = -h.d / 2 - (I.gallery || 0) - (I.piazza ? 2.4 : 0);
    const P = (x, z) => ({ a: h.a + x * c + (front - z) * s, b: h.b - x * s + (front - z) * c });
    const out = h.rot + Math.PI;
    const dp = P(I.door, 0); doors.push(dp);
    if (I.special === 'governor') continue;
    if (rnd() < S.chair) chair(P, I.door + (rnd() < 0.5 ? -1 : 1) * (1.6 + rnd() * 0.6), out);
    if (rnd() < S.ristra) for (const k of [-1, 1]) {
      const p = P(I.door + k * 1.25, 0.12), y = I.base + 2.9;
      const col = pick(['#b8322a', '#d8c8a0', '#c89a4a', '#8a3a2a'], rnd);
      for (let i = 0; i < 9; i++) B.add('plain', new THREE.SphereGeometry(0.07, 5, 4), T(p.a, y - i * 0.13, p.b, 0, 1, rnd() < 0.5 ? 1.5 : 1, 1), col);
    }
  }
  const nearDoor = (p) => doors.some((d) => (d.a - p.a) ** 2 + (d.b - p.b) ** 2 < 1.5 * 1.5);

  // ---- along every wall that lines a street (fronts and flanks alike)
  const W = S.jars + S.pots + S.creeper * 0.5 + S.cargo;
  for (const pa of K.paths) {
    const len = Math.hypot(pa.a1 - pa.a0, pa.b1 - pa.b0);
    const ua = (pa.a1 - pa.a0) / len, ub = (pa.b1 - pa.b0) / len, na = -ub, nb = ua;
    for (const side of [-1, 1]) {
      let skip = 0;
      for (let u = 1.5; u < len - 1.5; u += 1.7) {
        if (skip > 0) { skip--; continue; }
        if (rnd() > S.density) continue;
        const ca = pa.a0 + ua * u, cb = pa.b0 + ub * u;
        // find the wall: step out from inside the street until we hit a house
        let off = null, h = null;
        for (let o = pa.width / 2 - 1.2; o < pa.width / 2 + 3.2; o += 0.2) { h = inside(ca + na * side * o, cb + nb * side * o); if (h) { off = o; break; } }
        if (off == null || !h.info.style) continue;
        const wa = ca + na * side * off, wb = cb + nb * side * off; // the wall face
        const oa = -na * side, ob = -nb * side; // out from the wall, into the street
        const P = (x, z) => ({ a: wa + ua * x + oa * z, b: wb + ub * x + ob * z });
        if (nearDoor(P(0, 0))) continue;
        const out = Math.atan2(oa, ob);
        let r = rnd() * W, ok = false;
        if ((r -= S.jars) < 0) ok = jar(P, 0);
        else if ((r -= S.pots) < 0) ok = pots(P, 0);
        else if ((r -= S.creeper * 0.5) < 0) ok = creeper(P, 0, out, h.info);
        else ok = cargo(P, 0, out);
        if (ok) skip = 1;
      }
    }
  }

  // ---- across and along the streets
  for (const p of K.paths) {
    const len = Math.hypot(p.a1 - p.a0, p.b1 - p.b0);
    const ua = (p.a1 - p.a0) / len, ub = (p.b1 - p.b0) / len, na = -ub, nb = ua;
    let lastLine = -99;
    for (let u = 4; u < len - 4; u += 3) {
      const ca = p.a0 + ua * u, cb = p.b0 + ub * u;
      const hw = p.width / 2;
      // walls on both sides close enough to string something between
      if (u - lastLine > 7 && hw < 5) {
        // find the actual walls either side: step out from the middle of the street until we're inside a house
        const wallAt = (sg) => { for (let o = 0.5; o < hw + 1.5; o += 0.1) { const h = inside(ca + na * o * sg, cb + nb * o * sg); if (h) return { h, o }; } return null; };
        const WL = wallAt(1), WR = wallAt(-1);
        const L = WL?.h, R = WR?.h;
        if (L && R && L.info.H && R.info.H && WL.o + WR.o < 9 && WL.o + WR.o > 3.5) {
          const r = rnd();
          const eave = Math.min(L.info.base + L.info.H, R.info.base + R.info.H);
          const yTop = eave + 0.02; // level with the eaves, so it can be walked from one roof to the other
          // re-centre between the two walls, the line's ends just into them
          const shift = (WL.o - WR.o) / 2;
          const cA = ca + na * shift, cB = cb + nb * shift;
          const span = WL.o + WR.o + 0.3, ang = Math.atan2(na, nb);
          const y0 = Math.max(t.groundAt(cA, cB) + 3.4, yTop);
          const acrossRot = Math.atan2(-nb, na); // a collider whose length runs across the street
          if (r < S.laundry) {
            // washing on a line from window to window, strung just under the eaves: taut enough to walk
            B.box('wood', 0.035, 0.035, span, T(cA, y0, cB, ang, 1, 1, 1, 0), '#d8d0bc');
            t.addCollider(cA, cB, span / 2, 0.3, acrossRot, 0, { y: y0 + 0.02, flat: true, lip: 0, bottom: y0 - 0.25, rope: true });
            for (let v = -span / 2 + 0.5; v < span / 2 - 0.4; v += 0.55 + rnd() * 0.4) {
              const w = 0.4 + rnd() * 0.5, hh = 0.5 + rnd() * 0.7, sag = 0.25 * (1 - (2 * v / span) ** 2);
              B.box('cloth', 0.02, hh, w, T(cA + na * v, y0 - sag - hh / 2, cB + nb * v, ang + (rnd() - 0.5) * 0.25), pick(S.cloth, rnd));
            }
            lastLine = u;
          } else if (r < S.laundry + S.shade) {
            // a canvas shade (toldo) over the street, sagging between its lines
            const d = 2.6 + rnd() * 2;
            const g = new THREE.PlaneGeometry(span, d, 6, 2);
            const pa = g.attributes.position;
            for (let i = 0; i < pa.count; i++) pa.setZ(i, -0.35 * (1 - (2 * pa.getX(i) / span) ** 2));
            g.computeVertexNormals();
            B.add('cloth', g, T(cA + ua * d / 2, y0 + 0.4, cB + ub * d / 2, ang + Math.PI / 2, 1, 1, 1, -Math.PI / 2), pick(['#e8e0cc', '#d8cbb0', '#c9b48a', '#b5462e', '#e6dcc4'], rnd));
            lastLine = u + d;
          } else if (r < S.laundry + S.shade + S.plank) {
            // a plank laid from eave to eave, the roofers' short cut across the lane
            const yp = eave + 0.12, pl = span + 1.2;
            B.box('wood', 0.4, 0.08, pl, T(cA, yp, cB, ang), '#7a6448');
            for (const k of [-1, 1]) B.box('wood', 0.45, 0.1, 0.12, T(cA + na * k * (pl / 2 - 0.3), yp - 0.06, cB + nb * k * (pl / 2 - 0.3), ang), '#5a4632');
            t.addCollider(cA, cB, pl / 2, 0.3, acrossRot, 0, { y: yp + 0.04, flat: true, lip: 0, bottom: yp - 0.2, rope: true });
            lastLine = u;
          }
        }
      }
      // a market woman selling from a mat at the side of the street
      if (rnd() < S.mats * 0.06 && p.width >= 5) {
        const side = rnd() < 0.5 ? 1 : -1, off = hw - 0.9;
        const ma = ca + na * off * side, mb = cb + nb * off * side;
        if (!t.overlapsRect(ma, mb, 0.9, 0.9, 0) && t.isLandLot(ma, mb, 0.6, 0.6)) {
          const y = t.groundAt(ma, mb), ang = Math.atan2(na, nb);
          B.box('cloth', 1.4, 0.02, 1.0, T(ma, y + 0.04, mb, ang), pick(['#b5462e', '#c9b48a', '#6a5a3a', '#3d6a8a'], rnd));
          const fruit = pick([['#e08a2a', '#d8a030'], ['#c8b030', '#a8b83a'], ['#6a8a3a', '#4a7a2a'], ['#8a3a2a', '#b84a2a'], ['#d8d0b0', '#c8b890']], rnd);
          for (let k = 0; k < 3; k++) {
            const fa = ma + Math.cos(ang) * (k - 1) * 0.42, fb = mb - Math.sin(ang) * (k - 1) * 0.42;
            if (rnd() < 0.5) t.prop('wicker_basket_01', fa, y + 0.03, fb, rnd() * 6, 1.4);
            for (let q = 0; q < 6; q++) B.add('plain', new THREE.SphereGeometry(0.06, 6, 4), T(fa + (rnd() - 0.5) * 0.25, y + 0.08 + (q > 3 ? 0.08 : 0), fb + (rnd() - 0.5) * 0.25), fruit[q % 2]);
          }
          // she sits between the mat and the wall, facing the passers-by
          const sa = ma + na * side * 0.8, sb = mb + nb * side * 0.8;
          t.spots.push({ type: 'sitTalk', pos: t.toWorld(sa, sb, y - 0.4), yaw: t.dir + Math.atan2(-na * side, -nb * side) + Math.PI, taken: null });
          t.reserveRect(ma, mb, 0.8, 0.8);
        }
      }
    }
  }

  // ---- trees in the courtyards behind the houses, palms round the squares
  for (const bl of K.blocks || []) {
    if (rnd() > S.courtyard) continue;
    if (t.overlapsRect(bl.ca, bl.cb, 1.5, 1.5, 0)) continue;
    const w = t.toWorld(bl.ca, bl.cb);
    if (t.terrain.baseHeight(w.x, w.z) < 1) continue;
    tree(rnd() < 0.45 ? 'palm' : 'tree', bl.ca + (rnd() - 0.5) * 3, bl.cb + (rnd() - 0.5) * 3, 0.9 + rnd() * 0.4);
  }
  for (const pl of K.plazas || []) {
    const c = Math.cos(pl.r), s = Math.sin(pl.r);
    for (const [u, v] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      if (rnd() < 0.3) continue;
      const x = u * (pl.w / 2 - 2), z = v * (pl.d / 2 - 2);
      const a = pl.a + x * c + z * s, b = pl.b - x * s + z * c;
      if (t.overlapsRect(a, b, 0.8, 0.8, 0)) continue;
      tree('palm', a, b, 1.1 + rnd() * 0.3);
      t.reserveRect(a, b, 0.6, 0.6);
    }
  }
}
