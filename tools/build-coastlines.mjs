// Real geography for the game from Natural Earth (public domain, naturalearthdata.com).
//   node tools/build-coastlines.mjs <folder with ne_10m_land, ne_10m_minor_islands and ne_10m_bathymetry_K_200 .geojson>
// Every island in the window is projected with the game's uniform 1:60 projection (src/game/geo.js), so
// positions, sizes and distances are true to the real West Indies. A few small islands are enlarged about their
// own centre (see src/game/islands.js) and tiny cays get a minimum size so they read from a deck.
// The 200 m depth contour becomes the shallow banks. Writes src/game/coastlines.js.
import fs from 'node:fs';
import path from 'node:path';
import { geo } from '../src/game/geo.js';
import { ISLAND_META } from '../src/game/islands.js';

const DIR = process.argv[2];
const WIN = { lonMin: -85.2, lonMax: -68.0, latMin: 16.0, latMax: 30.4 };
const read = (f) => JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));

function* polygons(file) {
  for (const feat of read(file).features) {
    const g = feat.geometry;
    if (!g) continue;
    for (const p of g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []) yield p;
  }
}
const touches = (ring) => ring.some(([lon, lat]) => lon > WIN.lonMin - 0.5 && lon < WIN.lonMax + 0.5 && lat > WIN.latMin - 0.5 && lat < WIN.latMax + 0.5);

// Sutherland-Hodgman against the window
function clipToWindow(ring) {
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
  const lat = (v) => (P, Q) => { const t = (v - P[1]) / (Q[1] - P[1]); return [P[0] + (Q[0] - P[0]) * t, v]; };
  const lon = (v) => (P, Q) => { const t = (v - P[0]) / (Q[0] - P[0]); return [v, P[1] + (Q[1] - P[1]) * t]; };
  ring = clip(ring, (p) => p[1] <= WIN.latMax, lat(WIN.latMax));
  ring = clip(ring, (p) => p[1] >= WIN.latMin, lat(WIN.latMin));
  ring = clip(ring, (p) => p[0] >= WIN.lonMin, lon(WIN.lonMin));
  ring = clip(ring, (p) => p[0] <= WIN.lonMax, lon(WIN.lonMax));
  return ring;
}

function inside(pt, ring) {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

// Douglas-Peucker on a closed ring (split at the point farthest from the start: a closed ring degenerates DP)
function simplifyOpen(pts, eps) {
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
function simplifyRing(pts, eps) {
  let far = 0, fd = 0;
  for (let i = 0; i < pts.length; i++) { const d = (pts[i][0] - pts[0][0]) ** 2 + (pts[i][1] - pts[0][1]) ** 2; if (d > fd) { fd = d; far = i; } }
  return [...simplifyOpen(pts.slice(0, far + 1), eps).slice(0, -1), ...simplifyOpen([...pts.slice(far), pts[0]], eps).slice(0, -1)];
}

const project = (ring) => ring.map(([lon, lat]) => { const p = geo(lon, lat); return [p.x, p.z]; });
const area = (pts) => { let a = 0; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += (pts[j][0] + pts[i][0]) * (pts[j][1] - pts[i][1]); return Math.abs(a / 2); };
const centroid = (pts) => { let x = 0, z = 0; for (const p of pts) { x += p[0]; z += p[1]; } return [x / pts.length, z / pts.length]; };
const extent = (pts) => { let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity; for (const [x, z] of pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); } return { x0, x1, z0, z1, size: Math.max(x1 - x0, z1 - z0) }; };
const r1 = (v) => Math.round(v * 10) / 10;

// ------------------------------------------------------------------ islands
const rings = [];
for (const f of ['ne_10m_land.geojson', 'ne_10m_minor_islands.geojson']) {
  for (const p of polygons(f)) {
    let ring = p[0];
    if (!touches(ring)) continue;
    ring = clipToWindow(ring);
    if (ring.length < 3) continue;
    const pts = project(ring);
    const a = area(pts);
    if (a < 12) continue; // under ~200 m across in reality
    // the two sources overlap in places: keep one copy
    const c = centroid(pts);
    if (rings.some((r) => Math.hypot(r.c[0] - c[0], r.c[1] - c[1]) < 3 && Math.abs(r.a - a) < a * 0.2)) continue;
    rings.push({ ring, pts, a, c });
  }
}

// name the rings: the one containing each reference point, else the nearest unnamed ring within ~15 km
rings.sort((p, q) => q.a - p.a);
for (const m of ISLAND_META) {
  let r = rings.find((q) => !q.meta && inside(m.ref, q.ring));
  if (!r) {
    let bd = 0.15;
    for (const q of rings) {
      if (q.meta) continue;
      for (const [lon, lat] of q.ring) { const d = Math.hypot(lon - m.ref[0], lat - m.ref[1]); if (d < bd) { bd = d; r = q; } }
    }
  }
  if (r) r.meta = m; else console.log('WARNING: no ring found for', m.id);
}
const out = [];
let cays = 0;
for (const r of rings) {
  const meta = r.meta;
  let pts = r.pts;
  const ext = extent(pts);
  // enlarge named small islands; give tiny cays a minimum footprint of ~45 m
  const k = Math.max(meta?.enlarge || 1, Math.min(meta ? 8 : 3.5, 45 / ext.size));
  if (k !== 1) pts = pts.map(([x, z]) => [r.c[0] + (x - r.c[0]) * k, r.c[1] + (z - r.c[1]) * k]);
  const size = ext.size * k;
  pts = simplifyRing(pts, Math.max(1.2, Math.min(10, size / 700))).map(([x, z]) => [r1(x), r1(z)]);
  if (pts.length < 4) continue;
  const e = extent(pts);
  out.push({ id: meta ? meta.id : 'cay' + ++cays, x: r1((e.x0 + e.x1) / 2), z: r1((e.z0 + e.z1) / 2), rx: r1((e.x1 - e.x0) / 2), rz: r1((e.z1 - e.z0) / 2), pts });
}

// ------------------------------------------------------------------ banks: the 200 m contour (areas deeper than 200 m)
const banks = [];
for (const p of polygons('ne_10m_bathymetry_K_200.geojson')) {
  if (!touches(p[0])) continue;
  for (const ring of p) {
    const c = clipToWindow(ring);
    if (c.length < 3) continue;
    const pts = simplifyRing(project(c), 18).map(([x, z]) => [Math.round(x), Math.round(z)]);
    if (pts.length >= 3 && area(pts) > 40 * 40) banks.push(pts);
  }
}

const js = '// Generated by tools/build-coastlines.mjs from Natural Earth (public domain). Game coordinates (x east, z south).\n'
  + '// SHAPES: every island (named ones carry their id from islands.js, the rest are cays). DEEP: rings of the\n'
  + '// areas deeper than 200 m (even-odd); everything else offshore is bank or shelf.\n'
  + 'export const SHAPES = ' + JSON.stringify(out) + ';\nexport const DEEP = ' + JSON.stringify(banks) + ';\n';
fs.writeFileSync('src/game/coastlines.js', js);
const named = out.filter((s) => !s.id.startsWith('cay'));
for (const s of named) console.log(`${s.id.padEnd(14)} ${String(s.pts.length).padStart(5)} pts  ${(s.rx * 2).toFixed(0).padStart(6)} x ${(s.rz * 2).toFixed(0).padStart(5)} m  at ${s.x}, ${s.z}`);
console.log(`${out.length} islands (${cays} cays), ${banks.length} deep-water rings, ${Math.round(js.length / 1024)} KB`);
