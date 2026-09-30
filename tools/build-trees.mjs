// Turns Poly Haven's photoscanned CC0 plants into game-ready GLBs under public/models/plants/.
//   node tools/build-trees.mjs [id ...]
// Leaves: a random subset of leaf clusters is kept and each survivor is enlarged about its own centre, so
// the canopy keeps its coverage at a fraction of the triangles. Wood is simplified with meshoptimizer.
import { NodeIO, Document } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune, dedup, weld, simplify, textureCompress, flatten, compactPrimitive, quantize } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

const curl = (url, out) => execFileSync('curl', ['-sSfL', '--retry', '3', ...(out ? ['-o', out] : []), url], { maxBuffer: 1 << 26 });
const OUT = path.resolve('public/models/plants');
fs.mkdirSync(OUT, { recursive: true });
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

// id: { leaves: target leaf triangles, wood: target wood triangles, height: metres (optional), tex }
const PLANTS = {
  island_tree_01: { leaves: 32000, wood: 3000, height: 9, tex: 512 },
  island_tree_02: { leaves: 32000, wood: 3000, height: 8, tex: 512 },
  island_tree_03: { leaves: 32000, wood: 3000, height: 10, tex: 512, drop: ['island_tree_03'] },
  tree_small_02: { leaves: 34000, wood: 3000, height: 11, tex: 512 },
  // understory plants are a handful of big leaves: plain simplification to a total budget
  pachira_aquatica_01: { total: 5000, height: 2.2, tex: 512 },
  calathea_orbifolia_01: { total: 3000, tex: 512 },
  anthurium_botany_01: { total: 3500, tex: 512 },
};
const only = process.argv.slice(2);

async function download(id) {
  const meta = JSON.parse(curl(`https://api.polyhaven.com/files/${id}`).toString());
  const g = meta.gltf['1k'].gltf;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-'));
  curl(g.url, path.join(dir, path.basename(g.url)));
  for (const [rel, f] of Object.entries(g.include || {})) {
    fs.mkdirSync(path.join(dir, path.dirname(rel)), { recursive: true });
    curl(f.url, path.join(dir, rel));
  }
  return path.join(dir, path.basename(g.url));
}

// Split an indexed triangle list into connected clusters (union-find over shared vertices).
function clusters(index, vcount) {
  const parent = new Int32Array(vcount);
  for (let i = 0; i < vcount; i++) parent[i] = i;
  const find = (a) => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
  for (let t = 0; t < index.length; t += 3) {
    const a = find(index[t]), b = find(index[t + 1]), c = find(index[t + 2]);
    if (a !== b) parent[a] = b;
    const b2 = find(b);
    if (find(c) !== b2) parent[find(c)] = b2;
  }
  const byRoot = new Map();
  for (let t = 0; t < index.length; t += 3) {
    const r = find(index[t]);
    if (!byRoot.has(r)) byRoot.set(r, []);
    byRoot.get(r).push(t);
  }
  return [...byRoot.values()];
}

function rng(seed) { return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }; }

function thinLeaves(prim, keep) {
  const pos = prim.getAttribute('POSITION');
  const idx = prim.getIndices();
  const index = idx.getArray();
  const groups = clusters(index, pos.getCount());
  const rand = rng(1716);
  const P = pos.getArray();
  const kept = [];
  const grow = 1 / Math.sqrt(keep); // keep the canopy's coverage
  const touched = new Uint8Array(pos.getCount());
  for (const tris of groups) {
    if (rand() > keep) continue;
    // cluster centre
    let cx = 0, cy = 0, cz = 0, n = 0;
    for (const t of tris) for (let k = 0; k < 3; k++) { const v = index[t + k]; cx += P[v * 3]; cy += P[v * 3 + 1]; cz += P[v * 3 + 2]; n++; }
    cx /= n; cy /= n; cz /= n;
    for (const t of tris) {
      for (let k = 0; k < 3; k++) {
        const v = index[t + k];
        if (!touched[v]) {
          touched[v] = 1;
          P[v * 3] = cx + (P[v * 3] - cx) * grow; P[v * 3 + 1] = cy + (P[v * 3 + 1] - cy) * grow; P[v * 3 + 2] = cz + (P[v * 3 + 2] - cz) * grow;
        }
        kept.push(v);
      }
    }
  }
  pos.setArray(P);
  idx.setArray(new Uint32Array(kept));
  return { before: index.length / 3, after: kept.length / 3, clusters: groups.length };
}

function triCount(prim) { return (prim.getIndices()?.getCount() ?? prim.getAttribute('POSITION').getCount()) / 3; }

for (const [id, cfg] of Object.entries(PLANTS)) {
  if (only.length && !only.includes(id)) continue;
  try {
    const file = await download(id);
    const doc = await io.read(file);
    await MeshoptSimplifier.ready;
    await doc.transform(flatten(), dedup());
    const report = [];
    // scans that stand on a slab of their own ground: remove it
    for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) if ((cfg.drop || []).includes(p.getMaterial()?.getName())) { m.removePrimitive(p); p.dispose(); report.push('dropped base'); }
    if (cfg.total) {
      await doc.transform(weld({}));
      const before = doc.getRoot().listMeshes().flatMap((m) => m.listPrimitives()).reduce((s, p) => s + triCount(p), 0);
      for (const error of [0.01, 0.03, 0.08]) {
        const now = doc.getRoot().listMeshes().flatMap((m) => m.listPrimitives()).reduce((s, p) => s + triCount(p), 0);
        if (now <= cfg.total * 1.2) break;
        await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio: cfg.total / now, error, lockBorder: false }));
      }
      for (const m of doc.getRoot().listMaterials()) { if (m.getAlphaMode() === 'BLEND') { m.setAlphaMode('MASK'); m.setAlphaCutoff(0.45); } m.setDoubleSided(true); }
      report.push(`simplified ${before}`);
    }
    for (const mesh of cfg.total ? [] : doc.getRoot().listMeshes()) {
      for (const prim of mesh.listPrimitives()) {
        const mat = prim.getMaterial();
        const leafy = /leaf|leaves|foliage/i.test(mat?.getName() || '') || mat?.getAlphaMode() !== 'OPAQUE';
        if (leafy) {
          const r = thinLeaves(prim, Math.min(1, cfg.leaves / triCount(prim)));
          compactPrimitive(prim);
          report.push(`leaves ${r.before}->${r.after} (${r.clusters} clusters)`);
          mat.setAlphaMode('MASK'); mat.setAlphaCutoff(0.45); mat.setDoubleSided(true);
        }
      }
    }
    // simplify the wood (trunk, branches) to budget
    const wood = doc.getRoot().listMeshes().flatMap((m) => m.listPrimitives()).filter((p) => p.getMaterial()?.getAlphaMode() === 'OPAQUE');
    const woodTris = wood.reduce((s, p) => s + triCount(p), 0);
    if (!cfg.total && woodTris > cfg.wood) {
      await doc.transform(weld({}));
      for (const error of [0.01, 0.03, 0.08]) {
        const now = wood.reduce((s, p) => s + triCount(p), 0);
        if (now <= cfg.wood * 1.3) break;
        // simplify() works on the whole document; leaves are protected by keeping their ratio at 1 via a
        // temporary detach
        const leaves = [];
        for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) if (p.getMaterial()?.getAlphaMode() !== 'OPAQUE') { leaves.push([m, p]); m.removePrimitive(p); }
        await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio: cfg.wood / now, error, lockBorder: false }));
        for (const [m, p] of leaves) m.addPrimitive(p);
      }
      report.push(`wood ${woodTris}->${wood.reduce((s, p) => s + triCount(p), 0)}`);
    }
    // scale to game height, feet at y=0
    if (cfg.height) {
      const { getBounds } = await import('@gltf-transform/core');
      const b = getBounds(doc.getRoot().listScenes()[0]);
      const s = cfg.height / (b.max[1] - b.min[1]);
      for (const n of doc.getRoot().listScenes()[0].listChildren()) { n.setScale(n.getScale().map((v) => v * s)); n.setTranslation([n.getTranslation()[0] * s, -b.min[1] * s, n.getTranslation()[2] * s]); }
      await doc.transform(flatten());
    }
    // some scans stand on a slab of their ground: drop low triangles away from the trunk
    if (cfg.cutBase) {
      for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) {
        const P = p.getAttribute('POSITION'), I = p.getIndices();
        if (!I) continue;
        const idx = I.getArray(), keep = [], v = [0, 0, 0];
        let cx = 0, cz = 0, n = 0;
        for (let i = 0; i < P.getCount(); i++) { P.getElement(i, v); if (v[1] > cfg.cutBase.y && v[1] < cfg.cutBase.y + 1.5) { cx += v[0]; cz += v[2]; n++; } }
        if (n) { cx /= n; cz /= n; }
        let cut = 0;
        for (let t = 0; t < idx.length; t += 3) {
          let low = true, far = false;
          for (let k = 0; k < 3; k++) { P.getElement(idx[t + k], v); if (v[1] > cfg.cutBase.y) low = false; if (Math.hypot(v[0] - cx, v[2] - cz) > cfg.cutBase.r) far = true; }
          if (low && far) { cut++; continue; }
          keep.push(idx[t], idx[t + 1], idx[t + 2]);
        }
        I.setArray(new Uint32Array(keep));
        compactPrimitive(p);
        if (cut) report.push(`base -${cut}`);
      }
    }
    await doc.transform(
      textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [cfg.tex, cfg.tex], quality: 82 }),
      prune(),
      quantize(),
    );
    const out = path.join(OUT, id + '.glb');
    await io.write(out, doc);
    const total = doc.getRoot().listMeshes().flatMap((m) => m.listPrimitives()).reduce((s, p) => s + triCount(p), 0);
    console.log(`${id}: ${report.join(', ')}; total ${total} tris, ${Math.round(fs.statSync(out).size / 1024)} KB`);
  } catch (e) { console.log(id, 'FAILED', e.stack); }
}
