// Asset pipeline: the free-running clips from Quaternius' CC0 Universal Animation Library 2 (same 65-bone
// skeleton as the first library): the climb-up mantle, the running leap, the slide and the knock-back.
// Built from the root-motion export so the game can read how far each move carries the body; the root's
// track is written into the clip's extras and removed from the animation itself.
//
//   node tools/build-parkour-anims.mjs <folder with the extracted "Universal Animation Library 2[Standard]">
//
// Output: public/models/humans/anims2.glb (skeleton + clips only)
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune, resample } from '@gltf-transform/functions';
import fs from 'node:fs';
import path from 'node:path';

const SRC = process.argv[2];
if (!SRC) { console.error('usage: node tools/build-parkour-anims.mjs <UAL2 folder>'); process.exit(1); }
const find = (re) => {
  const hits = [];
  const walk = (d) => { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p); else if (re.test(p)) hits.push(p); } };
  walk(SRC);
  if (!hits.length) throw new Error('not found: ' + re);
  return hits[0];
};
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(find(/Unreal-Godot[/\\]UAL2_Standard_RM\.glb$/));
const keep = new Set(['ClimbUp_1m', 'NinjaJump_Start', 'NinjaJump_Idle_Loop', 'NinjaJump_Land', 'Slide_Start', 'Slide_Loop', 'Slide_Exit', 'Hit_Knockback']);
const motion = {};
for (const a of doc.getRoot().listAnimations()) {
  if (!keep.has(a.getName())) {
    for (const s of a.listSamplers()) s.dispose();
    a.dispose();
    continue;
  }
  for (const ch of a.listChannels()) {
    // a rigid skeleton: only rotations matter, plus the pelvis's height (and the root's travel, below)
    const bone = ch.getTargetNode().getName(), what = ch.getTargetPath();
    if (what === 'scale' || (what === 'translation' && bone !== 'pelvis' && bone !== 'root')) { const s = ch.getSampler(); ch.dispose(); s.dispose(); continue; }
    if (bone !== 'root' || what !== 'translation') continue;
    const s = ch.getSampler();
    const t = Array.from(s.getInput().getArray()), v = Array.from(s.getOutput().getArray());
    // root space is Z-up: (x side, y forward, z up) -> store [time, forward, up]
    motion[a.getName()] = t.map((ti, i) => [+ti.toFixed(4), +v[i * 3 + 1].toFixed(4), +v[i * 3 + 2].toFixed(4)]);
    ch.dispose(); s.dispose();
  }
}
doc.getRoot().setExtras({ rootMotion: motion });
for (const node of doc.getRoot().listNodes()) if (node.getMesh()) { node.getMesh().dispose(); node.setMesh(null); node.setSkin(null); }
for (const m of doc.getRoot().listMaterials()) m.dispose();
await doc.transform(resample(), prune({ keepLeaves: true }));
// accessors left behind by the dropped clips and channels
const used = new Set();
for (const a of doc.getRoot().listAnimations()) for (const s of a.listSamplers()) { used.add(s.getInput()); used.add(s.getOutput()); }
for (const acc of doc.getRoot().listAccessors()) if (!used.has(acc) && !acc.listParents().some((p) => p.propertyType === 'Primitive')) acc.dispose();
const file = path.resolve('public/models/humans/anims2.glb');
await io.write(file, doc);
console.log('wrote anims2.glb', Math.round(fs.statSync(file).size / 1024) + ' KB', doc.getRoot().listAnimations().map((a) => a.getName()).join(', '));
