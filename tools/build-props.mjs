// Downloads CC0 models from Poly Haven (https://polyhaven.com), simplifies them to a game-friendly polygon
// budget and writes compact GLBs to public/models/props/.   node tools/build-props.mjs
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune, dedup, weld, simplify, textureCompress, join, flatten } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

// curl rather than fetch: it honours HTTPS_PROXY and the system CA store in sandboxed/CI environments
const curl = (url, out) => execFileSync('curl', ['-sSfL', '--retry', '3', ...(out ? ['-o', out] : []), url], { maxBuffer: 1 << 26 });

const OUT = path.resolve('public/models/props');
fs.mkdirSync(OUT, { recursive: true });
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

// id: [target triangle count, texture size]
const ASSETS = {
  wine_barrel_01: [2000, 512], wooden_crate_01: [800, 512], wooden_crate_02: [800, 512],
  wooden_bucket_01: [800, 512], wooden_lantern_01: [1500, 512], treasure_chest: [4000, 1024], cannon_01: [3000, 1024],
  jug_01: [800, 512], wicker_basket_01: [2000, 512], old_military_crate: [1200, 512], lambis_shell: [600, 256],
  fern_02: [1100, 512], shrub_sorrel_01: [700, 512], tree_stump_01: [1500, 512],
  coast_rocks_01: [4000, 1024], wooden_ladder: [800, 512],
  wooden_handle_saber: [3000, 512], machete: [1500, 512], hatchet: [1500, 512],
  ...Object.fromEntries((process.env.EXTRA || '').split(',').filter(Boolean).map((s) => { const [k, t, x] = s.split(':'); return [k, [+t, +x]]; })),
};
const only = process.argv.slice(2);

async function download(id) {
  const meta = JSON.parse(curl(`https://api.polyhaven.com/files/${id}`).toString());
  const g = meta.gltf['1k'].gltf;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-'));
  const get = async (url, rel) => {
    const p = path.join(dir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    curl(url, p);
    return p;
  };
  const main = await get(g.url, path.basename(g.url));
  for (const [rel, f] of Object.entries(g.include || {})) await get(f.url, rel);
  return main;
}

function triCount(doc) {
  let n = 0;
  for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) n += (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3;
  return n;
}

for (const [id, [target, tex]] of Object.entries(ASSETS)) {
  if (only.length && !only.includes(id)) continue;
  try {
    const file = await download(id);
    const doc = await io.read(file);
    const before = triCount(doc);
    await MeshoptSimplifier.ready;
    await doc.transform(weld({}), flatten(), dedup(), join({ keepNamed: false }));
    // relax the error bound until the mesh reaches its budget (scanned rocks have many tiny UV islands)
    for (const error of [0.02, 0.05, 0.12, 0.3]) {
      const ratio = Math.min(1, target / triCount(doc));
      if (ratio >= 0.8) break;
      await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio, error, lockBorder: false }));
    }
    await doc.transform(
      textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [tex, tex], quality: 80 }),
      prune(),
    );
    const out = path.join(OUT, id.toLowerCase() + '.glb');
    await io.write(out, doc);
    console.log(`${id}: ${Math.round(before)} -> ${Math.round(triCount(doc))} tris, ${Math.round(fs.statSync(out).size / 1024)} KB`);
  } catch (e) { console.log(id, 'FAILED', e.message); }
}
