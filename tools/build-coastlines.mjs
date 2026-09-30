// Real coastlines for the game's islands from Natural Earth (public domain, naturalearthdata.com).
//   node tools/build-coastlines.mjs <folder with ne_10m_land.geojson and ne_10m_minor_islands.geojson>
// Each island keeps its real shape and orientation, scaled so its length matches the game's (compressed)
// island and centred where the game places it. Writes src/game/coastlines.js.
import fs from 'node:fs';
import path from 'node:path';
import { ISLANDS } from '../src/game/data.js';

const DIR = process.argv[2];
const read = (f) => JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
const polys = [];
for (const f of ['ne_10m_land.geojson', 'ne_10m_minor_islands.geojson']) {
  for (const feat of read(f).features) {
    const g = feat.geometry;
    const list = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
    for (const p of list) {
      const ring = p[0];
      // Caribbean window only
      if (!ring.some(([lon, lat]) => lon > -86 && lon < -68 && lat > 17 && lat < 29)) continue;
      polys.push(ring);
    }
  }
}

// reference point inside each real island (lon, lat); clip: optional lat/lon window for mainland pieces.
// Hog Island and Matecumbe Key are below this data's resolution and keep their procedural shapes.
const REF = {
  newprovidence: [-77.4, 25.03], eleuthera: [-76.25, 25.25], exuma: [-75.85, 23.55],
  andros: [-78.0, 24.6], florida: [-80.9, 26.3, { latMax: 27.2, lonMin: -82.2 }],
  cayohueso: [-81.78, 24.56], tortugas: [-82.87, 24.63], cuba: [-79, 22], pinos: [-82.8, 21.7], cayman: [-81.25, 19.32],
  jamaica: [-77.3, 18.15], hispaniola: [-71.5, 19.0], tortuga: [-72.8, 20.04], vache: [-73.62, 18.07],
};

function inside(pt, ring) {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
function nearest(pt) {
  let best = null, bd = Infinity;
  for (const r of polys) for (const q of r) { const d = (q[0] - pt[0]) ** 2 + (q[1] - pt[1]) ** 2; if (d < bd) { bd = d; best = r; } }
  return best;
}
// Douglas-Peucker
function simplify(pts, eps) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let md = 0, mi = -1;
    const [ax, ay] = pts[a], [bx, by] = pts[b];
    const L = Math.hypot(bx - ax, by - ay) || 1e-9;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((by - ay) * pts[i][0] - (bx - ax) * pts[i][1] + bx * ay - by * ax) / L;
      if (d > md) { md = d; mi = i; }
    }
    if (md > eps) { keep[mi] = 1; stack.push([a, mi], [mi, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

const out = {};
for (const is of ISLANDS) {
  const ref = REF[is.id];
  if (!ref) continue;
  let ring = polys.find((r) => inside(ref, r)) || nearest(ref);
  if (ref[2]) {
    // mainland: keep the part of the ring inside the window (plus a straight cut)
    // Sutherland-Hodgman clip to the window
    const w = ref[2];
    const clip = (poly, inside, cut) => {
      const out = [];
      for (let i = 0; i < poly.length; i++) {
        const P = poly[i], Q = poly[(i + 1) % poly.length];
        const pin = inside(P), qin = inside(Q);
        if (pin) out.push(P);
        if (pin !== qin) out.push(cut(P, Q));
      }
      return out;
    };
    ring = clip(ring, (p) => p[1] <= w.latMax, (P, Q) => { const t = (w.latMax - P[1]) / (Q[1] - P[1]); return [P[0] + (Q[0] - P[0]) * t, w.latMax]; });
    ring = clip(ring, (p) => p[0] >= w.lonMin, (P, Q) => { const t = (w.lonMin - P[0]) / (Q[0] - P[0]); return [w.lonMin, P[1] + (Q[1] - P[1]) * t]; });
  }
  // to metres (equirectangular about the island), game axes: x east, z south
  const lat0 = ref[1] * Math.PI / 180;
  let pts = ring.map(([lon, lat]) => [lon * 111320 * Math.cos(lat0), -lat * 110540]);
  const cx0 = pts.reduce((s, p) => s + p[0], 0) / pts.length, cz0 = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  pts = pts.map(([x, z]) => [x - cx0, z - cz0]);
  // principal axis for the island's length
  let sxx = 0, szz = 0, sxz = 0;
  for (const [x, z] of pts) { sxx += x * x; szz += z * z; sxz += x * z; }
  const ang = 0.5 * Math.atan2(2 * sxz, sxx - szz);
  const ux = Math.cos(ang), uz = Math.sin(ang);
  let mn = Infinity, mx = -Infinity, mn2 = Infinity, mx2 = -Infinity;
  for (const [x, z] of pts) { const a = x * ux + z * uz, b = -x * uz + z * ux; mn = Math.min(mn, a); mx = Math.max(mx, a); mn2 = Math.min(mn2, b); mx2 = Math.max(mx2, b); }
  const s = (2 * Math.max(is.rx, is.rz)) / (mx - mn);
  // centre the box, scale, place
  const bc = [((mn + mx) / 2) * ux - ((mn2 + mx2) / 2) * uz, ((mn + mx) / 2) * uz + ((mn2 + mx2) / 2) * ux];
  pts = pts.map(([x, z]) => [Math.round((is.x + (x - bc[0]) * s) * 10) / 10, Math.round((is.z + (z - bc[1]) * s) * 10) / 10]);
  const eps = Math.max(2, (mx - mn) * s / 900);
  // a closed ring degenerates Douglas-Peucker (start == end): split at the point farthest from the start
  let far = 0, fd = 0;
  for (let i = 0; i < pts.length; i++) { const d = (pts[i][0] - pts[0][0]) ** 2 + (pts[i][1] - pts[0][1]) ** 2; if (d > fd) { fd = d; far = i; } }
  pts = [...simplify(pts.slice(0, far + 1), eps).slice(0, -1), ...simplify([...pts.slice(far), pts[0]], eps).slice(0, -1)];
  out[is.id] = pts;
  console.log(`${is.id}: ${ring.length} -> ${pts.length} points, length ${(2 * Math.max(is.rx, is.rz)).toFixed(0)} m, width ${((mx2 - mn2) * s).toFixed(0)} m, axis ${(ang * 180 / Math.PI).toFixed(0)}°`);
}
fs.writeFileSync('src/game/coastlines.js', '// Generated by tools/build-coastlines.mjs from Natural Earth (public domain). Game coordinates (x east, z south).\nexport const COASTLINES = ' + JSON.stringify(out) + ';\n');
console.log('wrote src/game/coastlines.js', Math.round(fs.statSync('src/game/coastlines.js').size / 1024) + ' KB');
