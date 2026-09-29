// Photographic terrain: five CC0 Poly Haven surfaces (built by tools/build-textures.mjs) in texture arrays,
// blended per vertex weight and per-pixel height, two tiling scales against repetition, triplanar rock
// on cliffs, and a colour remap that keeps each photo's detail but moves its average to a Caribbean palette.
import * as THREE from 'three';
import { detailNoiseTexture } from '../core/textures.js';

// order matches the `splat` attribute: x sand, y grass, z forest floor, w rock; dirt = 1 - sum
export const LAYERS = [
  { id: 'coast_sand_01', target: '#eadcbc', remap: 0.85, scale: 3.5 },
  { id: 'leafy_grass', target: '#62853a', remap: 0.5, scale: 3.0 },
  { id: 'forest_leaves_02', target: '#4c5a2c', remap: 0.55, scale: 3.0 },
  { id: 'coast_land_rocks_01', target: '#98928a', remap: 0.65, scale: 6.0 },
  { id: 'coral_gravel', target: '#b8a07c', remap: 0.35, scale: 4.0 },
];
const SIZE = 1024;
const BASE = './textures/terrain/';

export const terrainTextures = { ready: false };

async function loadLayerArray(suffix, srgb) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const data = new Uint8Array(SIZE * SIZE * 4 * LAYERS.length);
  const avg = [];
  const imgs = await Promise.all(LAYERS.map((l) => new THREE.ImageLoader().loadAsync(BASE + l.id + suffix)));
  imgs.forEach((img, i) => {
    ctx.drawImage(img, 0, 0, SIZE, SIZE);
    const px = ctx.getImageData(0, 0, SIZE, SIZE).data;
    data.set(px, i * SIZE * SIZE * 4);
    // mean colour in linear space (for the palette remap)
    let r = 0, g = 0, b = 0;
    const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    for (let k = 0; k < px.length; k += 64) { r += lin(px[k]); g += lin(px[k + 1]); b += lin(px[k + 2]); }
    const n = px.length / 64;
    avg.push(new THREE.Vector3(r / n, g / n, b / n));
  });
  const tex = new THREE.DataArrayTexture(data, SIZE, SIZE, LAYERS.length);
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.UnsignedByteType;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 8;
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return { tex, avg };
}

export async function loadTerrainTextures() {
  try {
    const [d, n, m] = await Promise.all([loadLayerArray('_d.webp', true), loadLayerArray('_n.webp', false), loadLayerArray('_m.webp', false)]);
    Object.assign(terrainTextures, { d: d.tex, n: n.tex, m: m.tex, avg: d.avg, ready: true });
  } catch (e) {
    console.warn('Terrain textures unavailable, using vertex colours', e);
  }
  return terrainTextures;
}

// cutFine: the coarse far mesh skips pixels inside the rectangle covered by high-resolution tiles
export function makeTerrainMaterial({ cutFine = false } = {}) {
  const T = terrainTextures;
  const mat = new THREE.MeshStandardMaterial({ vertexColors: !T.ready, roughness: 0.93, metalness: 0 });
  mat.userData.fineRect = { value: new THREE.Vector4(1e9, 1e9, -1e9, -1e9) };
  const detail = detailNoiseTexture();
  const lin = (hex) => new THREE.Color(hex); // Color() stores linear values
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uDetail = { value: detail };
    shader.uniforms.uFineRect = mat.userData.fineRect;
    shader.defines = shader.defines || {};
    if (cutFine) shader.defines.CUT_FINE = '';
    let vtx = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNrm;\n#ifdef TERRAIN_TEX\nattribute vec4 splat;\nvarying vec4 vSplat;\n#endif')
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vWNrm = normalize(mat3(modelMatrix) * objectNormal);
        #ifdef TERRAIN_TEX
        vSplat = splat;
        #endif`);
    let frag = shader.fragmentShader.replace('#include <common>', `#include <common>
      varying vec3 vWPos;
      varying vec3 vWNrm;
      uniform sampler2D uDetail;
      uniform vec4 uFineRect;
      #ifdef TERRAIN_TEX
      precision highp sampler2DArray;
      uniform sampler2DArray uTD, uTN, uTM;
      uniform vec3 uRemap[5];
      uniform float uRemapK[5];
      uniform float uScale[5];
      varying vec4 vSplat;
      vec3 tAlbedo; vec3 tWN; float tRough; float tAO;
      #endif`);

    frag = frag.replace('void main() {', `void main() {
      #ifdef CUT_FINE
      if (vWPos.x > uFineRect.x && vWPos.z > uFineRect.y && vWPos.x < uFineRect.z && vWPos.z < uFineRect.w) discard;
      #endif`);

    if (T.ready) {
      shader.defines.TERRAIN_TEX = '';
      shader.uniforms.uTD = { value: T.d };
      shader.uniforms.uTN = { value: T.n };
      shader.uniforms.uTM = { value: T.m };
      // per layer: multiply that moves the photo's mean colour towards the palette colour
      shader.uniforms.uRemap = { value: LAYERS.map((l, i) => { const c = lin(l.target); const a = T.avg[i]; return new THREE.Vector3(c.r / Math.max(a.x, 1e-3), c.g / Math.max(a.y, 1e-3), c.b / Math.max(a.z, 1e-3)); }) };
      shader.uniforms.uRemapK = { value: LAYERS.map((l) => l.remap) };
      shader.uniforms.uScale = { value: LAYERS.map((l) => 1 / l.scale) };
      frag = frag.replace('#include <map_fragment>', `#include <map_fragment>
        {
          vec3 wN = normalize(vWNrm);
          vec4 sp = clamp(vSplat, 0.0, 1.0);
          float w[5];
          w[0] = sp.x; w[1] = sp.y; w[2] = sp.z; w[3] = sp.w; w[4] = max(0.0, 1.0 - sp.x - sp.y - sp.z - sp.w);
          // second, rotated & larger tiling breaks up repetition
          vec2 uvA = vWPos.xz;
          vec2 uvB = mat2(0.866, -0.5, 0.5, 0.866) * vWPos.xz * 0.27 + 0.37;
          float macro = texture2D(uDetail, vWPos.xz * 0.0021).r;
          vec3 col[5]; vec3 nrm[5]; vec3 msk[5];
          float hmax = -1.0;
          float hb[5];
          for (int i = 0; i < 5; i++) {
            hb[i] = -1.0;
            if (w[i] < 0.004) continue;
            float s = uScale[i];
            vec3 c, n, m;
            if (i == 3) {
              // rock: triplanar so cliffs aren't smeared
              vec3 bw = pow(abs(wN), vec3(4.0)); bw /= (bw.x + bw.y + bw.z);
              vec2 ux = vWPos.zy * s, uy = vWPos.xz * s, uz = vWPos.xy * s;
              c = texture(uTD, vec3(ux, 3.0)).rgb * bw.x + texture(uTD, vec3(uy, 3.0)).rgb * bw.y + texture(uTD, vec3(uz, 3.0)).rgb * bw.z;
              m = texture(uTM, vec3(ux, 3.0)).rgb * bw.x + texture(uTM, vec3(uy, 3.0)).rgb * bw.y + texture(uTM, vec3(uz, 3.0)).rgb * bw.z;
              vec3 nX = texture(uTN, vec3(ux, 3.0)).rgb * 2.0 - 1.0;
              vec3 nY = texture(uTN, vec3(uy, 3.0)).rgb * 2.0 - 1.0;
              vec3 nZ = texture(uTN, vec3(uz, 3.0)).rgb * 2.0 - 1.0;
              nX = vec3(nX.xy + wN.zy, abs(nX.z) * wN.x);
              nY = vec3(nY.xy + wN.xz, abs(nY.z) * wN.y);
              nZ = vec3(nZ.xy + wN.xy, abs(nZ.z) * wN.z);
              n = normalize(nX.zyx * bw.x + nY.xzy * bw.y + nZ.xyz * bw.z); // world space
            } else {
              float fi = float(i);
              vec3 cA = texture(uTD, vec3(uvA * s, fi)).rgb, cB = texture(uTD, vec3(uvB * s, fi)).rgb;
              vec3 mA = texture(uTM, vec3(uvA * s, fi)).rgb, mB = texture(uTM, vec3(uvB * s, fi)).rgb;
              vec3 nA = texture(uTN, vec3(uvA * s, fi)).rgb * 2.0 - 1.0, nB = texture(uTN, vec3(uvB * s, fi)).rgb * 2.0 - 1.0;
              float k = 0.35 + 0.3 * macro;
              c = mix(cA, cB, k); m = mix(mA, mB, k);
              vec2 t = mix(nA.xy, nB.xy, k);
              vec3 nw = vec3(t + wN.xz, wN.y); // whiteout blend onto the surface normal (planar XZ projection)
              n = normalize(nw.xzy);
            }
            // palette remap (keeps the photo's detail, moves its mean colour)
            c = mix(c, c * uRemap[i], uRemapK[i]);
            col[i] = c; nrm[i] = n; msk[i] = m;
            hb[i] = m.g + w[i] * 1.6;
            hmax = max(hmax, hb[i]);
          }
          // height-based blend: the taller surface wins across the transition
          vec3 C = vec3(0.0), N = vec3(0.0), M = vec3(0.0); float tot = 0.0;
          for (int i = 0; i < 5; i++) {
            if (hb[i] < -0.5) continue;
            float b = max(hb[i] - hmax + 0.35, 0.0);
            C += col[i] * b; N += nrm[i] * b; M += msk[i] * b; tot += b;
          }
          C /= max(tot, 1e-4); N /= max(tot, 1e-4); M /= max(tot, 1e-4);
          C *= 0.86 + 0.28 * macro;
          tAlbedo = C; tWN = normalize(N); tRough = M.r; tAO = mix(1.0, M.b, 0.7);
          diffuseColor.rgb = tAlbedo * tAO;
        }`);
      frag = frag.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        normal = normalize((viewMatrix * vec4(tWN, 0.0)).xyz);`);
    } else {
      frag = frag.replace('#include <color_fragment>', `#include <color_fragment>
        vec3 dA = texture2D(uDetail, vWPos.xz * 0.013).rgb;
        vec3 dB = texture2D(uDetail, vWPos.xz * 0.11).rgb;
        diffuseColor.rgb *= 0.78 + (dA.r * 0.55 + dB.g * 0.45) * 0.44;`);
    }
    // wet band at the waterline: darker, glossier
    frag = frag.replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
      float wet = 1.0 - smoothstep(0.25, 1.2, vWPos.y);
      #ifdef TERRAIN_TEX
      roughnessFactor = mix(clamp(tRough * 1.05, 0.35, 1.0), 0.28, wet);
      #else
      roughnessFactor = mix(roughnessFactor, 0.35, wet);
      #endif
      diffuseColor.rgb *= 1.0 - wet * 0.3;`);
    shader.vertexShader = vtx;
    shader.fragmentShader = frag;
  };
  mat.customProgramCacheKey = () => 'terrain' + (cutFine ? '_cut' : '') + (T.ready ? '_tex' : '');
  return mat;
}
