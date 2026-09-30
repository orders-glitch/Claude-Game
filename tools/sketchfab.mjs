// Sketchfab helper (needs your own API token in SKETCHFAB_TOKEN; never commit it).
//   node tools/sketchfab.mjs search "flintlock pistol" [count] [--relevance] [--animated]
//   node tools/sketchfab.mjs fetch <uid> <out.glb> [--tris N] [--tex 1024] [--height m]
// fetch downloads the model's GLB, simplifies it to a triangle budget, re-encodes textures as WebP and
// writes a compact GLB. Credits (author, licence, URL) are appended to CREDITS.md next to the output.
import { NodeIO, getBounds } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune, dedup, weld, simplify, textureCompress, flatten, quantize, join, metalRough } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

const TOKEN = process.env.SKETCHFAB_TOKEN;
if (!TOKEN) { console.error('Set SKETCHFAB_TOKEN'); process.exit(1); }
const api = (url) => JSON.parse(execFileSync('curl', ['-sSfL', '--retry', '3', '-H', `Authorization: Token ${TOKEN}`, url], { maxBuffer: 1 << 26 }).toString());
const [cmd, ...args] = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : def; };

if (cmd === 'search') {
  const q = encodeURIComponent(args[0]);
  const count = args[1] || 24;
  const sort = args.includes('--relevance') ? '' : '&sort_by=-likeCount';
  const anim = args.includes('--animated') ? '&animated=true' : '';
  const r = api(`https://api.sketchfab.com/v3/search?type=models&q=${q}&downloadable=true${sort}${anim}&count=${count}`);
  for (const m of r.results) console.log(`${m.uid}  ${String(m.faceCount).padStart(8)}f  ${m.license?.label?.padEnd(28) || ''}  ${m.name}  — ${m.user?.displayName}`);
} else if (cmd === 'fetch') {
  const [uid, out] = args;
  const info = api(`https://api.sketchfab.com/v3/models/${uid}`);
  const dl = api(`https://api.sketchfab.com/v3/models/${uid}/download`);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skf-'));
  let file;
  if (dl.glb) { file = path.join(dir, 'model.glb'); execFileSync('curl', ['-sSfL', '-o', file, dl.glb.url]); }
  else {
    const zip = path.join(dir, 'model.zip');
    execFileSync('curl', ['-sSfL', '-o', zip, dl.gltf.url]);
    execFileSync('unzip', ['-q', '-o', zip, '-d', dir]);
    file = execFileSync('find', [dir, '-name', '*.gltf']).toString().trim().split('\n')[0];
  }
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const doc = await io.read(file);
  const tris = () => doc.getRoot().listMeshes().flatMap((m) => m.listPrimitives()).reduce((s, p) => s + (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3, 0);
  const before = tris();
  await MeshoptSimplifier.ready;
  await doc.transform(metalRough(), flatten(), dedup(), join({ keepNamed: false }), weld({}));
  const target = +opt('tris', 20000);
  for (const error of [0.005, 0.02, 0.06, 0.15]) {
    const now = tris();
    if (now <= target * 1.15) break;
    await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio: target / now, error, lockBorder: false }));
  }
  const height = opt('height');
  if (height) {
    const b = getBounds(doc.getRoot().listScenes()[0]);
    const s = +height / (b.max[1] - b.min[1]);
    for (const n of doc.getRoot().listScenes()[0].listChildren()) { n.setScale(n.getScale().map((v) => v * s)); const t = n.getTranslation(); n.setTranslation([t[0] * s, t[1] * s - b.min[1] * s, t[2] * s]); }
    await doc.transform(flatten());
  }
  const tex = +opt('tex', 1024);
  await doc.transform(textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [tex, tex], quality: 84 }), prune(), quantize());
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  await io.write(out, doc);
  const b = getBounds(doc.getRoot().listScenes()[0]);
  console.log(`${path.basename(out)}: ${before} -> ${tris()} tris, ${Math.round(fs.statSync(out).size / 1024)} KB, bounds ${b.min.map((v) => v.toFixed(2))} .. ${b.max.map((v) => v.toFixed(2))}`);
  const credits = path.join(path.dirname(path.resolve(out)), 'CREDITS.md');
  const line = `| ${path.basename(out)} | "${info.name}" by ${info.user?.displayName} | ${info.license?.label || ''} | https://sketchfab.com/3d-models/${uid} |\n`;
  if (!fs.existsSync(credits)) fs.writeFileSync(credits, '# Models from Sketchfab\n\n| File | Model | Licence | Source |\n|---|---|---|---|\n');
  if (!fs.readFileSync(credits, 'utf8').includes(uid)) fs.appendFileSync(credits, line);
} else {
  console.log('usage: search <query> | fetch <uid> <out.glb> [--tris N] [--tex N] [--height m]');
}
