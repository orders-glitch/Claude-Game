// Download an animated (rigged) model from Sketchfab, keeping its skeleton and clips: textures re-encoded as
// WebP, keyframes resampled, unused data pruned. Needs SKETCHFAB_TOKEN (never commit it).
//   node tools/sketchfab-animated.mjs <uid> <out.glb> [--tex 512]
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune, dedup, resample, textureCompress, metalRough } from '@gltf-transform/functions';
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

const TOKEN = process.env.SKETCHFAB_TOKEN;
if (!TOKEN) { console.error('Set SKETCHFAB_TOKEN'); process.exit(1); }
const api = (url) => JSON.parse(execFileSync('curl', ['-sSfL', '--retry', '3', '-H', `Authorization: Token ${TOKEN}`, url], { maxBuffer: 1 << 26 }).toString());
const [uid, out, ...rest] = process.argv.slice(2);
const opt = (n, d) => { const i = rest.indexOf('--' + n); return i >= 0 ? rest[i + 1] : d; };
const info = api(`https://api.sketchfab.com/v3/models/${uid}`);
const dl = api(`https://api.sketchfab.com/v3/models/${uid}/download`);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skfa-'));
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
const tex = +opt('tex', 512);
await doc.transform(metalRough(), dedup(), resample(), textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [tex, tex], quality: 82 }), prune());
fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
await io.write(out, doc);
const clips = doc.getRoot().listAnimations().map((a) => a.getName());
console.log(`${path.basename(out)}: ${Math.round(fs.statSync(out).size / 1024)} KB, clips: ${clips.join(', ')}`);
const credits = path.join(path.dirname(path.resolve(out)), 'CREDITS.md');
if (!fs.readFileSync(credits, 'utf8').includes(uid)) fs.appendFileSync(credits, `| ${path.basename(out)} | "${info.name}" by ${info.user?.displayName} | ${info.license?.label || ''} | https://sketchfab.com/3d-models/${uid} |\n`);
