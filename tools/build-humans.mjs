// Asset pipeline: turns Quaternius' CC0 Universal Base Characters, Modular Outfits and Universal Animation
// Library into small web-ready GLBs under public/models/humans/.
//
//   node tools/build-humans.mjs <folder with the extracted Quaternius packs>
//
// Output: head_male/female.glb (base character cut down to head & neck), outfit_*.glb, hair_*.glb,
// anims.glb (skeleton + animation clips only). All share the same 65-bone skeleton.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune, dedup, resample, textureCompress, weld } from '@gltf-transform/functions';
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';

const SRC = process.argv[2];
if (!SRC) { console.error('usage: node tools/build-humans.mjs <quaternius folder>'); process.exit(1); }
const OUT = path.resolve('public/models/humans');
fs.mkdirSync(OUT, { recursive: true });
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

const find = (re) => {
  const hits = [];
  const walk = (d) => { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p); else if (re.test(p)) hits.push(p); } };
  walk(SRC);
  if (!hits.length) throw new Error('not found: ' + re);
  return hits[0];
};

async function finish(doc, name, texSize = 1024) {
  await doc.transform(
    dedup(),
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [texSize, texSize], quality: 82 }),
    prune(),
  );
  const file = path.join(OUT, name);
  await io.write(file, doc);
  console.log('wrote', name, Math.round(fs.statSync(file).size / 1024) + ' KB');
}

// Remove every triangle of the base body that isn't head or neck (the outfit supplies the rest).
function cutToHead(doc) {
  const keepJoints = new Set(['Head', 'neck_01']);
  for (const skin of doc.getRoot().listSkins()) {
    const joints = skin.listJoints().map((j) => j.getName());
    for (const mesh of doc.getRoot().listMeshes()) {
      for (const prim of mesh.listPrimitives()) {
        const matName = prim.getMaterial()?.getName() || '';
        if (!/Superhero|Regular/.test(matName)) continue; // only the skin/body primitive
        const J = prim.getAttribute('JOINTS_0'), W = prim.getAttribute('WEIGHTS_0');
        const P = prim.getAttribute('POSITION');
        const idx = prim.getIndices();
        const keepV = new Uint8Array(J.getCount());
        const j = [], w = [], p = [];
        for (let v = 0; v < J.getCount(); v++) {
          J.getElement(v, j); W.getElement(v, w); P.getElement(v, p);
          let head = 0;
          for (let k = 0; k < 4; k++) if (keepJoints.has(joints[j[k]])) head += w[k];
          keepV[v] = head > 0.5 ? 1 : 0;
        }
        const arr = idx.getArray();
        const kept = [];
        for (let t = 0; t < arr.length; t += 3) {
          if (keepV[arr[t]] && keepV[arr[t + 1]] && keepV[arr[t + 2]]) kept.push(arr[t], arr[t + 1], arr[t + 2]);
        }
        idx.setArray(new Uint32Array(kept));
        console.log('  head cut:', matName, arr.length / 3, '->', kept.length / 3, 'triangles');
      }
    }
  }
}

// ---- base heads
for (const sex of ['Male', 'Female']) {
  const doc = await io.read(find(new RegExp(`Godot - UE[/\\\\]Superhero_${sex}_FullBody\\.gltf$`)));
  cutToHead(doc);
  await doc.transform(weld());
  await finish(doc, `head_${sex.toLowerCase()}.glb`, 1024);
}

// ---- outfits
for (const o of ['Male_Peasant', 'Female_Peasant', 'Male_Ranger', 'Female_Ranger']) {
  const doc = await io.read(find(new RegExp(`glTF \\(Godot-Unreal\\)[/\\\\]Outfits[/\\\\]${o}\\.gltf$`)));
  // drop fantasy-only accessories (pauldrons, hoods) for 1716
  for (const node of doc.getRoot().listNodes()) {
    if (/Pauldron|Hood|Bracer/i.test(node.getName()) && node.getMesh()) { node.getMesh().dispose(); node.dispose(); }
  }
  await finish(doc, `outfit_${o.toLowerCase()}.glb`, 1024);
}

// ---- hair & brows
for (const h of ['Hair_Beard', 'Hair_SimpleParted', 'Hair_Long', 'Hair_Buns', 'Hair_Buzzed', 'Hair_BuzzedFemale', 'Eyebrows_Regular', 'Eyebrows_Female']) {
  const doc = await io.read(find(new RegExp(`Rigged to Head Bone[/\\\\]glTF \\(Godot -Unreal\\)[/\\\\]${h}\\.gltf$`)));
  await finish(doc, `${h.toLowerCase()}.glb`, 512);
}

// ---- animation library: keep the skeleton and the clips the game uses, drop the mannequin mesh
{
  const doc = await io.read(find(/Unreal-Godot[/\\]UAL1_Standard\.glb$/));
  const keep = new Set([
    'Idle_Loop', 'Idle_Talking_Loop', 'Walk_Loop', 'Walk_Formal_Loop', 'Jog_Fwd_Loop', 'Sprint_Loop',
    'Sword_Attack', 'Sword_Idle', 'Punch_Cross', 'Punch_Jab',
    'Pistol_Aim_Neutral', 'Pistol_Aim_Up', 'Pistol_Aim_Down', 'Pistol_Idle_Loop', 'Pistol_Shoot', 'Pistol_Reload',
    'Hit_Chest', 'Hit_Head', 'Death01', 'Interact', 'PickUp_Table', 'Fixing_Kneeling',
    'Sitting_Idle_Loop', 'Sitting_Talking_Loop', 'Dance_Loop', 'Swim_Fwd_Loop', 'Swim_Idle_Loop',
    'Jump_Start', 'Jump_Loop', 'Jump_Land', 'Roll', 'Crouch_Idle_Loop', 'Crouch_Fwd_Loop', 'Push_Loop',
  ]);
  for (const a of doc.getRoot().listAnimations()) if (!keep.has(a.getName())) a.dispose();
  for (const node of doc.getRoot().listNodes()) if (node.getMesh()) { node.getMesh().dispose(); node.setMesh(null); node.setSkin(null); }
  for (const m of doc.getRoot().listMaterials()) m.dispose();
  await doc.transform(resample(), prune({ keepLeaves: true }));
  const file = path.join(OUT, 'anims.glb');
  await io.write(file, doc);
  console.log('wrote anims.glb', Math.round(fs.statSync(file).size / 1024) + ' KB', doc.getRoot().listAnimations().length, 'clips');
}
