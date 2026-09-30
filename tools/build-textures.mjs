// Downloads CC0 PBR textures from Poly Haven (https://polyhaven.com) and packs them for the game:
//   <id>_d.webp  diffuse (sRGB)
//   <id>_n.webp  OpenGL normal map
//   <id>_m.webp  R roughness, G height (drives layer blending), B ambient occlusion
// All opaque, so browsers can decode them through a canvas without premultiplying anything.
// Output: public/textures/<group>/.     node tools/build-textures.mjs [id ...]
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

// curl rather than fetch: it honours HTTPS_PROXY and the system CA store in sandboxed/CI environments
const curl = (url) => execFileSync('curl', ['-sSfL', '--retry', '3', url], { maxBuffer: 1 << 28 });

// id: [output group, size]
const TEXTURES = {
  coast_sand_01: ['terrain', 1024],
  leafy_grass: ['terrain', 1024],
  forest_leaves_02: ['terrain', 1024],
  coast_land_rocks_01: ['terrain', 1024],
  coral_gravel: ['terrain', 1024],
  // town building materials (also get a three.js-ready AO/roughness/metal map, <id>_arm.webp)
  clay_plaster: ['town', 1024],
  brown_planks_03: ['town', 1024],
  brown_planks_09: ['town', 1024],
  clay_roof_tiles_02: ['town', 1024],
  coral_fort_wall_01: ['town', 1024],
};
const only = process.argv.slice(2);

async function gray(buf, size) {
  return buf ? sharp(buf).resize(size, size).removeAlpha().greyscale().raw().toBuffer() : null;
}

async function rgbFile(buf, size, out) {
  await sharp(buf).resize(size, size).removeAlpha().webp({ quality: 82 }).toFile(out);
}

async function maskFile(rough, height, ao, size, out) {
  const [r, h, a] = await Promise.all([gray(rough, size), gray(height, size), gray(ao, size)]);
  const px = Buffer.alloc(size * size * 3);
  for (let i = 0; i < size * size; i++) { px[i * 3] = r ? r[i] : 220; px[i * 3 + 1] = h ? h[i] : 128; px[i * 3 + 2] = a ? a[i] : 255; }
  await sharp(px, { raw: { width: size, height: size, channels: 3 } }).webp({ quality: 88 }).toFile(out);
}

for (const [id, [group, size]] of Object.entries(TEXTURES)) {
  if (only.length && !only.includes(id)) continue;
  try {
    const files = JSON.parse(curl(`https://api.polyhaven.com/files/${id}`).toString());
    const res = size > 1024 ? '2k' : '1k';
    const get = (key) => files[key]?.[res]?.jpg?.url || files[key]?.[res]?.png?.url;
    const opt = (k) => (get(k) ? curl(get(k)) : null);
    const dir = path.resolve('public/textures', group);
    fs.mkdirSync(dir, { recursive: true });
    await rgbFile(curl(get('Diffuse')), size, path.join(dir, `${id}_d.webp`));
    await rgbFile(curl(get('nor_gl')), size, path.join(dir, `${id}_n.webp`));
    if (group !== 'town') await maskFile(opt('Rough'), opt('Displacement'), opt('AO'), size, path.join(dir, `${id}_m.webp`));
    if (group === 'town' && get('arm')) await rgbFile(curl(get('arm')), size, path.join(dir, `${id}_arm.webp`));
    const kb = (f) => Math.round(fs.statSync(path.join(dir, `${id}_${f}.webp`)).size / 1024);
    console.log(`${id}: ${kb('d')} + ${kb('n')} KB`);
  } catch (e) { console.log(id, 'FAILED', e.message); }
}
