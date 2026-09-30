// Ship models from Sketchfab -> game-ready GLBs in public/models/ships/ (token in SKETCHFAB_TOKEN).
//   node tools/build-ships.mjs [name ...]
// Each model is re-oriented (bow towards -Z, deck up +Y), scaled to 1 unit = 1 m at a nominal length, its
// waterline put at y = 0, and simplified per material: sails keep their shape (they are animated in the
// game), rigging and carving detail are thinned hardest.
import { NodeIO, getBounds } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune, dedup, weld, simplifyPrimitive, textureCompress, flatten, quantize, join, metalRough } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

const TOKEN = process.env.SKETCHFAB_TOKEN;
const OUT = path.resolve('public/models/ships');
fs.mkdirSync(OUT, { recursive: true });
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

// rot: Euler XYZ (radians) applied to the file so the bow faces -Z and the deck faces +Y
// waterline: fraction of the hull height (keel -> top of the model) that sits under water
export const SHIPS = {
  sloop: { uid: '2b4afbe5ce054b2489fc11fc18e156ae', rot: [0, 0, 0], length: 28, waterline: 0.075, budget: 50000, sails: 6000 },
  pinnace: { uid: 'e4e6e25025854ce496dda6144a4c0402', rot: [0, 0, 0], length: 30, waterline: 0.1, budget: 70000, sails: 12000 },
  // single-texture / anonymous-material models: sails found by the colour of the texture under each triangle
  galleon: { uid: 'b097e67c207540628828ebb55afce914', rot: [0, Math.PI / 2, 0], length: 44, waterline: 0.1, budget: 90000, sails: 16000, detectSails: true },
};
const only = process.argv.slice(2);

const api = (url) => JSON.parse(execFileSync('curl', ['-sSfL', '-H', `Authorization: Token ${TOKEN}`, url], { maxBuffer: 1 << 26 }).toString());
const tris = (p) => (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3;

for (const [name, cfg] of Object.entries(SHIPS)) {
  if (only.length && !only.includes(name)) continue;
  const cache = path.join(os.tmpdir(), `ship-${cfg.uid}.glb`);
  if (!fs.existsSync(cache)) {
    const dl = api(`https://api.sketchfab.com/v3/models/${cfg.uid}/download`);
    execFileSync('curl', ['-sSfL', '-o', cache, dl.glb.url]);
  }
  const doc = await io.read(cache);
  const root = doc.getRoot();
  const scene = root.listScenes()[0];
  // wrap everything in an orienting node, then bake
  const wrap = doc.createNode('orient');
  const q = eulerToQuat(cfg.rot);
  wrap.setRotation(q);
  for (const c of scene.listChildren()) { scene.removeChild(c); wrap.addChild(c); }
  scene.addChild(wrap);
  await doc.transform(metalRough(), flatten(), dedup(), join({ keepNamed: false }));
  if (cfg.detectSails) await splitSails(doc);
  let b = getBounds(scene);
  const len = b.max[2] - b.min[2];
  const s = cfg.length / len;
  const h = b.max[1] - b.min[1];
  const cx = (b.min[0] + b.max[0]) / 2, cz = (b.min[2] + b.max[2]) / 2;
  const water = b.min[1] + h * cfg.waterline;
  for (const n of scene.listChildren()) {
    n.setScale(n.getScale().map((v) => v * s));
    const t = n.getTranslation();
    n.setTranslation([(t[0] - cx) * s, (t[1] - water) * s, (t[2] - cz) * s]);
  }
  await doc.transform(flatten(), weld({}));
  await MeshoptSimplifier.ready;
  // per-material budgets: simplify one primitive at a time by detaching the others
  const prims = root.listMeshes().flatMap((m) => m.listPrimitives().map((p) => [m, p]));
  const total = prims.reduce((a, [, p]) => a + tris(p), 0);
  const isSail = (p) => /sail|canvas/i.test(p.getMaterial()?.getName() || '');
  const sailTris = prims.filter(([, p]) => isSail(p)).reduce((a, [, p]) => a + tris(p), 0);
  const restBudget = cfg.budget - Math.min(sailTris, cfg.sails);
  const rest = total - sailTris;
  for (const [m, p] of prims) {
    const n = tris(p);
    const ratio = isSail(p) ? Math.min(1, cfg.sails / Math.max(1, sailTris)) : Math.min(1, restBudget / Math.max(1, rest)) * (/rope|rigging/i.test(p.getMaterial()?.getName() || '') ? 0.6 : 1);
    if (ratio >= 0.95) continue;
    simplifyPrimitive(p, { simplifier: MeshoptSimplifier, ratio, error: isSail(p) ? 0.002 : 0.01, lockBorder: false });
  }
  await doc.transform(textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [1024, 1024], quality: 82 }), prune(), quantize());
  const out = path.join(OUT, name + '.glb');
  await io.write(out, doc);
  b = getBounds(root.listScenes()[0]);
  const after = root.listMeshes().flatMap((m) => m.listPrimitives()).reduce((a, p) => a + tris(p), 0);
  const mats = root.listMeshes().flatMap((m) => m.listPrimitives()).map((p) => `${p.getMaterial()?.getName()}:${tris(p)}`).join(' ');
  console.log(`${name}: ${total} -> ${after} tris, ${Math.round(fs.statSync(out).size / 1024)} KB, bounds ${b.min.map((v) => v.toFixed(1))} .. ${b.max.map((v) => v.toFixed(1))}\n  ${mats}`);
  const info = api(`https://api.sketchfab.com/v3/models/${cfg.uid}`);
  const credits = path.join(OUT, 'CREDITS.md');
  if (!fs.existsSync(credits)) fs.writeFileSync(credits, '# Ship models from Sketchfab\n\n| File | Model | Licence | Source |\n|---|---|---|---|\n');
  if (!fs.readFileSync(credits, 'utf8').includes(cfg.uid)) fs.appendFileSync(credits, `| ${name}.glb | "${info.name}" by ${info.user?.displayName} | ${info.license?.label} | https://sketchfab.com/3d-models/${cfg.uid} |\n`);
}

// Move every triangle whose texture colour is pale, unsaturated canvas into a separate 'sail' material.
async function splitSails(doc) {
  const cache = new Map();
  const pixels = async (tex) => {
    if (!cache.has(tex)) {
      const { data, info } = await sharp(Buffer.from(tex.getImage())).removeAlpha().resize(512, 512, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true });
      cache.set(tex, { data, w: info.width, h: info.height });
    }
    return cache.get(tex);
  };
  let moved = 0, total = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const mat = prim.getMaterial();
      const tex = mat?.getBaseColorTexture();
      const uv = prim.getAttribute('TEXCOORD_0');
      const idx = prim.getIndices();
      if (!idx) continue;
      const f = mat ? mat.getBaseColorFactor() : [1, 1, 1, 1];
      const px = tex && uv ? await pixels(tex) : null;
      const I = idx.getArray();
      const keep = [], sail = [];
      const t = [0, 0];
      for (let k = 0; k < I.length; k += 3) {
        let r = 0, g = 0, b = 0;
        for (let c = 0; c < 3; c++) {
          let cr = f[0], cg = f[1], cb = f[2];
          if (px) {
            uv.getElement(I[k + c], t);
            const x = Math.min(px.w - 1, Math.max(0, Math.floor((((t[0] % 1) + 1) % 1) * px.w)));
            const y = Math.min(px.h - 1, Math.max(0, Math.floor((((t[1] % 1) + 1) % 1) * px.h)));
            const o = (y * px.w + x) * 3;
            cr *= px.data[o] / 255; cg *= px.data[o + 1] / 255; cb *= px.data[o + 2] / 255;
          }
          r += cr / 3; g += cg / 3; b += cb / 3;
        }
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
        const lum = 0.3 * r + 0.59 * g + 0.11 * b, sat = mx > 0 ? (mx - mn) / mx : 0;
        (lum > 0.5 && sat < 0.28 ? sail : keep).push(I[k], I[k + 1], I[k + 2]);
      }
      total += I.length / 3;
      if (!sail.length || sail.length > I.length * 0.95) continue;
      moved += sail.length / 3;
      idx.setArray(new Uint32Array(keep));
      const sp = prim.clone();
      sp.setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(sail)));
      const sm = mat.clone().setName('sail_' + (mat.getName() || ''));
      sp.setMaterial(sm);
      mesh.addPrimitive(sp);
    }
  }
  console.log(`  sail detection: ${moved} of ${total} triangles are canvas`);
}

function eulerToQuat([x, y, z]) {
  const c1 = Math.cos(x / 2), c2 = Math.cos(y / 2), c3 = Math.cos(z / 2), s1 = Math.sin(x / 2), s2 = Math.sin(y / 2), s3 = Math.sin(z / 2);
  return [s1 * c2 * c3 + c1 * s2 * s3, c1 * s2 * c3 - s1 * c2 * s3, c1 * c2 * s3 + s1 * s2 * c3, c1 * c2 * c3 - s1 * s2 * s3];
}
