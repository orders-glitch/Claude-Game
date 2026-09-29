// Island terrain: analytic height function shared by rendering, physics, AI and the chart.
import * as THREE from 'three';
import { Simplex, smoothstep, lerp, clamp } from '../core/noise.js';
import { detailNoiseTexture } from '../core/textures.js';

export const SEA_FLOOR = -40;
export const WORLD_HALF = 9000;

export class Terrain {
  constructor(islands) {
    this.noise = new Simplex(1716);
    this.islands = islands.map((is) => {
      const minR = Math.min(is.rx, is.rz);
      const maxR = Math.max(is.rx, is.rz);
      return {
        ...is,
        cos: Math.cos(is.rot), sin: Math.sin(is.rot),
        minR, maxR,
        warpAmp: Math.min(120, minR * 0.35),
        hillRange: Math.max(40, minR * 0.85),
        boundR: maxR + Math.min(120, minR * 0.35) + 420,
      };
    });
    this.zones = []; // flattened town areas
    this.lastD = 0;
    this.lastIsland = null;
  }

  // Signed approximate distance to coast (positive inland) + height for one island.
  _island(is, x, z) {
    const dx = x - is.x, dz = z - is.z;
    const lx = dx * is.cos - dz * is.sin;
    const lz = dx * is.sin + dz * is.cos;
    const u = lx / is.rx, v = lz / is.rz;
    const nd = Math.sqrt(u * u + v * v);
    const g = Math.sqrt((u / is.rx) ** 2 + (v / is.rz) ** 2) / Math.max(nd, 1e-4);
    let d = nd < 1 ? Math.min((1 - nd) / g, (1 - nd) * is.minR) : (1 - nd) / g;
    const n = this.noise;
    d += n.fbm(x * 0.0032 + is.seed * 31.7, z * 0.0032 - is.seed * 7.3, 3) * is.warpAmp
       + n.noise2(x * 0.03 + is.seed, z * 0.03) * Math.min(6, is.minR * 0.08);
    let h;
    if (d > 0) {
      const beach = 0.3 + 1.9 * smoothstep(0, 22, d);
      const hillT = smoothstep(16, is.hillRange, d);
      let hills = 0;
      if (hillT > 0) {
        const ridge = n.ridged(x * 0.0042 + is.seed * 3.1, z * 0.0042, 4);
        hills = is.peak * Math.pow(hillT, 1.35) * (0.4 + 0.85 * ridge);
      }
      const bumps = n.noise2(x * 0.021, z * 0.021) * 1.4 * smoothstep(12, 40, d);
      h = beach + hills + bumps;
    } else {
      const dd = -d;
      h = 0.3 - 4.5 * smoothstep(0, 26, dd) - 35 * smoothstep(34, 330, dd)
        + n.noise2(x * 0.012, z * 0.012) * 1.5 * (1 - smoothstep(30, 200, dd));
    }
    return { h, d };
  }

  baseHeight(x, z) {
    let best = SEA_FLOOR;
    let bestD = -1e9;
    let bestIs = null;
    for (let i = 0; i < this.islands.length; i++) {
      const is = this.islands[i];
      const dx = x - is.x, dz = z - is.z;
      if (dx * dx + dz * dz > is.boundR * is.boundR) continue;
      const r = this._island(is, x, z);
      if (r.h > best) { best = r.h; bestD = r.d; bestIs = is; }
    }
    this.lastD = bestD;
    this.lastIsland = bestIs;
    return best;
  }

  height(x, z) {
    let h = this.baseHeight(x, z);
    const d = this.lastD, is = this.lastIsland;
    for (let i = 0; i < this.zones.length; i++) {
      const zn = this.zones[i];
      const dx = x - zn.x, dz = z - zn.z;
      const dist2 = dx * dx + dz * dz;
      if (dist2 > zn.r * zn.r) continue;
      if (h <= -0.2 && !zn.raise) continue;
      const w = 1 - smoothstep(zn.r * zn.inner, zn.r, Math.sqrt(dist2));
      if (zn.raise && h < zn.level) {
        h = lerp(h, zn.level, w);
      } else if (!zn.raise) {
        h = lerp(h, zn.level, w);
      }
    }
    this.lastD = d; this.lastIsland = is;
    return h;
  }

  addZone(z) { this.zones.push({ inner: 0.72, ...z }); }

  normal(x, z, out = new THREE.Vector3(), e = 1.5) {
    const hl = this.height(x - e, z), hr = this.height(x + e, z);
    const hd = this.height(x, z - e), hu = this.height(x, z + e);
    return out.set(hl - hr, 2 * e, hd - hu).normalize();
  }

  // Walk from a point along a direction to find the coastline (height crossing 0).
  findCoast(x, z, dirx, dirz) {
    let h = this.baseHeight(x, z);
    const step = 3;
    let px = x, pz = z;
    if (h > 0) {
      for (let i = 0; i < 600 && h > 0; i++) { px += dirx * step; pz += dirz * step; h = this.baseHeight(px, pz); }
    } else {
      for (let i = 0; i < 600 && h <= 0; i++) { px -= dirx * step; pz -= dirz * step; h = this.baseHeight(px, pz); }
      px += dirx * step; pz += dirz * step;
    }
    return { x: px, z: pz };
  }

  islandAt(x, z) {
    this.baseHeight(x, z);
    return this.lastIsland;
  }

  nearestIsland(x, z) {
    let best = null, bd = Infinity;
    for (const is of this.islands) {
      const d = Math.hypot(x - is.x, z - is.z) - (is.rx + is.rz) * 0.5;
      if (d < bd) { bd = d; best = is; }
    }
    return best;
  }

  // Find a walkable beach point on land close to (x,z).
  findLanding(x, z, maxR = 400) {
    let best = null, bd = Infinity;
    for (let r = 10; r <= maxR; r += 10) {
      const steps = Math.ceil(r / 6);
      for (let i = 0; i < steps; i++) {
        const a = (i / steps) * Math.PI * 2;
        const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
        const h = this.height(px, pz);
        if (h > 0.8 && h < 6) {
          const n = this.normal(px, pz);
          if (n.y > 0.85 && r < bd) { bd = r; best = { x: px, z: pz, y: h }; }
        }
      }
      if (best) return best;
    }
    return best;
  }

  // ------------------------------------------------------------------ rendering
  buildMeshes(scene, quality = 'high') {
    this.material = makeTerrainMaterial();
    this.meshes = [];
    const budget = quality === 'low' ? 45000 : quality === 'medium' ? 80000 : 140000;
    const col = new THREE.Color();
    const sand = new THREE.Color('#e3d3a4'), wetSand = new THREE.Color('#b8a47a'), under = new THREE.Color('#c9bd92');
    const grass = new THREE.Color('#5f7d2f'), jungle = new THREE.Color('#34521f'), scrub = new THREE.Color('#8b8a50');
    const rock = new THREE.Color('#7d7465'), dirt = new THREE.Color('#9a8766'), tmp = new THREE.Color();
    for (const is of this.islands) {
      const margin = 90;
      const ex = Math.sqrt((is.rx * is.cos) ** 2 + (is.rz * is.sin) ** 2) + is.warpAmp + margin;
      const ez = Math.sqrt((is.rx * is.sin) ** 2 + (is.rz * is.cos) ** 2) + is.warpAmp + margin;
      let cell = clamp(is.minR / 16, 3, 9);
      cell = Math.max(cell, Math.sqrt((ex * 2 * ez * 2) / budget));
      const nx = Math.ceil((ex * 2) / cell) + 1;
      const nz = Math.ceil((ez * 2) / cell) + 1;
      const pos = new Float32Array(nx * nz * 3);
      const colors = new Float32Array(nx * nz * 3);
      const hs = new Float32Array(nx * nz);
      for (let j = 0; j < nz; j++) {
        for (let i = 0; i < nx; i++) {
          const x = is.x - ex + i * cell, z = is.z - ez + j * cell;
          const h = Math.max(this.height(x, z), -30);
          const k = j * nx + i;
          hs[k] = h;
          pos[k * 3] = x; pos[k * 3 + 1] = h; pos[k * 3 + 2] = z;
        }
      }
      // colours from height, slope and noise
      for (let j = 0; j < nz; j++) {
        for (let i = 0; i < nx; i++) {
          const k = j * nx + i;
          const x = pos[k * 3], z = pos[k * 3 + 2], h = hs[k];
          const hl = hs[j * nx + Math.max(0, i - 1)], hr = hs[j * nx + Math.min(nx - 1, i + 1)];
          const hd = hs[Math.max(0, j - 1) * nx + i], hu = hs[Math.min(nz - 1, j + 1) * nx + i];
          const slope = Math.hypot(hr - hl, hu - hd) / (2 * cell);
          const n1 = this.noise.noise2(x * 0.01, z * 0.01);
          const n2 = this.noise.noise2(x * 0.07 + 40, z * 0.07);
          if (h < -0.4) col.copy(under).lerp(wetSand, clamp(-h / 8, 0, 1));
          else if (h < 0.7) col.copy(wetSand);
          else if (h < 2.3 + n1 * 0.8) col.copy(sand);
          else {
            const jun = clamp(is.jungle + n1 * 0.35, 0, 1);
            col.copy(scrub).lerp(grass, clamp(jun * 1.4, 0, 1)).lerp(jungle, clamp((jun - 0.4) * 1.6, 0, 1));
            // sandy transition
            col.lerp(sand, clamp(1 - (h - 2.3) / 1.6, 0, 1));
            if (slope > 0.55) col.lerp(rock, clamp((slope - 0.55) * 2.2, 0, 1));
            if (h > is.peak * 0.75 && is.peak > 60) col.lerp(rock, 0.35);
          }
          for (const zn of this.zones) {
            if (zn.dirt && h > 0.5) {
              const dd = Math.hypot(x - zn.x, z - zn.z) / zn.r;
              if (dd < 1) col.lerp(dirt, clamp((1 - dd) * 2.2, 0, 0.85) * (0.75 + n2 * 0.25));
            }
          }
          tmp.copy(col).multiplyScalar(0.92 + n2 * 0.08);
          colors[k * 3] = tmp.r; colors[k * 3 + 1] = tmp.g; colors[k * 3 + 2] = tmp.b;
        }
      }
      const idx = [];
      for (let j = 0; j < nz - 1; j++) {
        for (let i = 0; i < nx - 1; i++) {
          const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
          if (hs[a] < -12 && hs[b] < -12 && hs[c] < -12 && hs[d] < -12) continue;
          idx.push(a, c, b, b, c, d);
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      geo.setIndex(idx);
      geo.computeVertexNormals();
      geo.computeBoundingSphere();
      const mesh = new THREE.Mesh(geo, this.material);
      mesh.receiveShadow = true;
      mesh.castShadow = is.peak > 30;
      mesh.name = 'terrain_' + is.id;
      scene.add(mesh);
      this.meshes.push(mesh);
    }
  }

  // Low-res heightmap texture used by the ocean shader (shallows/foam) and the chart.
  bakeHeightmap(size = 512) {
    const data = new Float32Array(size * size);
    data.fill(SEA_FLOOR);
    const scale = (WORLD_HALF * 2) / size;
    for (const is of this.islands) {
      const r = is.boundR;
      const i0 = Math.max(0, Math.floor((is.x - r + WORLD_HALF) / scale));
      const i1 = Math.min(size - 1, Math.ceil((is.x + r + WORLD_HALF) / scale));
      const j0 = Math.max(0, Math.floor((is.z - r + WORLD_HALF) / scale));
      const j1 = Math.min(size - 1, Math.ceil((is.z + r + WORLD_HALF) / scale));
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const x = -WORLD_HALF + (i + 0.5) * scale, z = -WORLD_HALF + (j + 0.5) * scale;
          const k = j * size + i;
          if (data[k] > SEA_FLOOR) continue;
          data[k] = this.height(x, z);
        }
      }
    }
    this.heightData = data;
    this.heightSize = size;
    // Half-float so linear filtering works on every WebGL2 device.
    const half = new Uint16Array(size * size);
    for (let i = 0; i < half.length; i++) half[i] = THREE.DataUtils.toHalfFloat(data[i]);
    const tex = new THREE.DataTexture(half, size, size, THREE.RedFormat, THREE.HalfFloatType);
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.needsUpdate = true;
    this.heightTexture = tex;
    return tex;
  }

  // Fast approximate height from the baked map (for AI look-ahead).
  quickHeight(x, z) {
    if (!this.heightData) return this.height(x, z);
    const size = this.heightSize;
    const i = Math.floor(((x + WORLD_HALF) / (WORLD_HALF * 2)) * size);
    const j = Math.floor(((z + WORLD_HALF) / (WORLD_HALF * 2)) * size);
    if (i < 0 || j < 0 || i >= size || j >= size) return SEA_FLOOR;
    return this.heightData[j * size + i];
  }
}

function makeTerrainMaterial() {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.93, metalness: 0 });
  const detail = detailNoiseTexture();
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uDetail = { value: detail };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWPos = (modelMatrix * vec4(transformed,1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nuniform sampler2D uDetail;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 dA = texture2D(uDetail, vWPos.xz * 0.013).rgb;
        vec3 dB = texture2D(uDetail, vWPos.xz * 0.11).rgb;
        float dd = dA.r * 0.55 + dB.g * 0.45;
        diffuseColor.rgb *= 0.78 + dd * 0.44;
        // wet band at the waterline
        float wet = 1.0 - smoothstep(0.2, 1.1, vWPos.y);
        diffuseColor.rgb *= 1.0 - wet * 0.25;`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.35, wet);`);
  };
  return mat;
}
