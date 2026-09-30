// Gerstner-wave ocean. The same wave set is evaluated on the GPU (rendering) and CPU (buoyancy).
import * as THREE from 'three';
import { waterNormalTexture, detailNoiseTexture } from '../core/textures.js';
import { WORLD_HALF } from './terrain.js';

const G = 9.81;
// Prevailing waves roll in with the north-east trades (travelling toward the south-west).
const BASE_ANGLE = Math.atan2(-0.62, 0.78);
const WAVE_DEFS = [
  { a: 0.0, L: 92, A: 1.05, Q: 0.6 },
  { a: 0.55, L: 57, A: 0.66, Q: 0.6 },
  { a: -0.45, L: 35, A: 0.42, Q: 0.6 },
  { a: 1.1, L: 21, A: 0.24, Q: 0.55 },
  { a: -1.0, L: 13, A: 0.13, Q: 0.5 },
  { a: 0.25, L: 7.5, A: 0.06, Q: 0.45 },
];

export class Ocean {
  constructor(scene, terrain, quality = 'high') {
    this.terrain = terrain;
    this.time = 0;
    this.seaState = 1.0;
    this.waves = WAVE_DEFS.map((w) => {
      const ang = BASE_ANGLE + w.a;
      const k = (Math.PI * 2) / w.L;
      return { dx: Math.cos(ang), dz: Math.sin(ang), k, A: w.A, Q: w.Q, c: Math.sqrt(G / k) };
    });
    this.uniforms = {
      uTime: { value: 0 },
      uSea: { value: 1 },
      uWaves: { value: this.waves.map((w) => new THREE.Vector4(w.dx, w.dz, w.k, w.A)) },
      uWaveQ: { value: this.waves.map((w) => w.Q) },
      uCamPos: { value: new THREE.Vector3() },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunColor: { value: new THREE.Color(1, 1, 1) },
      uSunIntensity: { value: 1 },
      uAmbient: { value: new THREE.Color(0.3, 0.35, 0.4) },
      uHorizon: { value: new THREE.Color(0.7, 0.8, 0.9) },
      uZenith: { value: new THREE.Color(0.2, 0.4, 0.8) },
      uFogColor: { value: new THREE.Color() },
      uFogDensity: { value: 0.0002 },
      uNormalMap: { value: waterNormalTexture() },
      uFoamTex: { value: detailNoiseTexture() },
      uHeightMap: { value: terrain.heightTexture },
      uWorldHalf: { value: WORLD_HALF },
      uDeep: { value: new THREE.Color('#062b45') },
      uMid: { value: new THREE.Color('#0b5d78') },
      uShallow: { value: new THREE.Color('#2fc4c0') },
      uSandy: { value: new THREE.Color('#58d6c8') },
      uRain: { value: 0 },
    };
    const N = quality === 'low' ? 256 : quality === 'medium' ? 384 : 512;
    this.spacing = (16000 * 0.04 * 2) / N;
    const geo = buildOceanGeometry(N, 16000);
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: VERT,
      fragmentShader: FRAG,
      extensions: {},
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1;
    this.mesh.name = 'ocean';
    scene.add(this.mesh);
  }

  update(dt, camera, sky, fog) {
    this.time += dt;
    const u = this.uniforms;
    u.uTime.value = this.time;
    u.uSea.value = this.seaState;
    u.uCamPos.value.copy(camera.position);
    const s = this.spacing * 2;
    this.mesh.position.set(Math.round(camera.position.x / s) * s, 0, Math.round(camera.position.z / s) * s);
    u.uSunDir.value.copy(sky.lightDir);
    u.uSunColor.value.copy(sky.lightColor);
    u.uSunIntensity.value = sky.lightIntensity;
    u.uAmbient.value.copy(sky.ambientColor);
    u.uHorizon.value.copy(sky.horizonColor);
    u.uZenith.value.copy(sky.zenithColor);
    u.uFogColor.value.copy(fog.color);
    u.uFogDensity.value = fog.density;
  }

  // Gerstner displacement at an undisplaced grid position.
  displacement(x, z, out) {
    const t = this.time, s = this.seaState;
    let dx = 0, dy = 0, dz = 0;
    for (let i = 0; i < this.waves.length; i++) {
      const w = this.waves[i];
      const A = w.A * s;
      const f = w.k * (w.dx * x + w.dz * z - w.c * t);
      const cf = Math.cos(f);
      const q = Math.min(w.Q, 0.95 / (w.k * A * this.waves.length));
      dx += q * A * w.dx * cf;
      dz += q * A * w.dz * cf;
      dy += A * Math.sin(f);
    }
    // same shallow-water damping as the shader
    const g = this.terrain ? this.terrain.quickHeight(x, z) : -40;
    const t0 = Math.min(1, Math.max(0, (g + 2.2) / 2.8)), k = 1 - t0 * t0 * (3 - 2 * t0);
    out.x = dx * k; out.y = dy * k; out.z = dz * k;
    return out;
  }

  // Water surface height at world (x,z): invert the horizontal displacement with fixed-point iteration.
  heightAt(x, z) {
    const d = this._d || (this._d = { x: 0, y: 0, z: 0 });
    let px = x, pz = z;
    for (let i = 0; i < 3; i++) {
      this.displacement(px, pz, d);
      px = x - d.x; pz = z - d.z;
    }
    this.displacement(px, pz, d);
    return d.y;
  }
}

function buildOceanGeometry(N, R) {
  const f = (u) => R * (0.04 * u + 0.16 * u * u * u + 0.8 * Math.pow(Math.abs(u), 9) * Math.sign(u));
  const pos = new Float32Array((N + 1) * (N + 1) * 3);
  for (let j = 0; j <= N; j++) {
    for (let i = 0; i <= N; i++) {
      const k = (j * (N + 1) + i) * 3;
      pos[k] = f((i / N) * 2 - 1);
      pos[k + 1] = 0;
      pos[k + 2] = f((j / N) * 2 - 1);
    }
  }
  const idx = new Uint32Array(N * N * 6);
  let p = 0;
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const a = j * (N + 1) + i, b = a + 1, c = a + N + 1, d = c + 1;
      idx[p++] = a; idx[p++] = c; idx[p++] = b;
      idx[p++] = b; idx[p++] = c; idx[p++] = d;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), R * 1.5);
  return g;
}

const VERT = /* glsl */ `
uniform float uTime;
uniform float uSea;
uniform vec4 uWaves[6];
uniform float uWaveQ[6];
uniform vec3 uCamPos;
uniform sampler2D uHeightMap;
uniform float uWorldHalf;
varying vec3 vWorld;
varying vec3 vNormal;
varying float vHeight;
varying float vFade;
const float G = 9.81;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  float dist = length(wp.xz - uCamPos.xz);
  float fade = 1.0 - smoothstep(900.0, 2600.0, dist);
  vec3 disp = vec3(0.0);
  vec3 nrm = vec3(0.0, 1.0, 0.0);
  for (int i = 0; i < 6; i++) {
    vec4 w = uWaves[i];
    float A = w.w * uSea;
    float k = w.z;
    float c = sqrt(G / k);
    float f = k * (dot(w.xy, wp.xz) - c * uTime);
    float q = min(uWaveQ[i], 0.95 / (k * A * 6.0));
    float cf = cos(f), sf = sin(f);
    disp.x += q * A * w.x * cf;
    disp.z += q * A * w.y * cf;
    disp.y += A * sf;
    float wa = k * A;
    nrm.x -= w.x * wa * cf;
    nrm.z -= w.y * wa * cf;
    nrm.y -= q * wa * sf;
  }
  // waves die away in the shallows so crests never stand up through the beach
  float ground = texture2D(uHeightMap, (wp.xz + uWorldHalf) / (uWorldHalf * 2.0)).r;
  fade *= 1.0 - smoothstep(-2.2, 0.6, ground);
  disp *= fade;
  nrm = normalize(mix(vec3(0.0, 1.0, 0.0), nrm, fade));
  wp.xyz += disp;
  vWorld = wp.xyz;
  vNormal = nrm;
  vHeight = disp.y;
  vFade = fade;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const FRAG = /* glsl */ `
uniform float uTime;
uniform float uSea;
uniform vec3 uCamPos;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uSunIntensity;
uniform vec3 uAmbient;
uniform vec3 uHorizon;
uniform vec3 uZenith;
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform sampler2D uNormalMap;
uniform sampler2D uFoamTex;
uniform sampler2D uHeightMap;
uniform float uWorldHalf;
uniform vec3 uDeep;
uniform vec3 uMid;
uniform vec3 uShallow;
uniform vec3 uSandy;
uniform float uRain;
varying vec3 vWorld;
varying vec3 vNormal;
varying float vHeight;
varying float vFade;

vec3 skyColor(vec3 r) {
  float y = max(r.y, 0.0);
  vec3 c = mix(uHorizon, uZenith, pow(y, 0.55));
  return c;
}

void main() {
  vec3 toCam = uCamPos - vWorld;
  float dist = length(toCam);
  vec3 V = toCam / dist;

  // detail normals (two scrolling octaves + rain ripples)
  vec2 uv = vWorld.xz;
  float detailFade = 1.0 - smoothstep(150.0, 1400.0, dist);
  vec3 n1 = texture2D(uNormalMap, uv * 0.018 + vec2(uTime * 0.012, uTime * 0.007)).xyz * 2.0 - 1.0;
  vec3 n2 = texture2D(uNormalMap, uv * 0.061 - vec2(uTime * 0.018, -uTime * 0.021)).xyz * 2.0 - 1.0;
  vec3 n3 = texture2D(uNormalMap, uv * 0.33 + vec2(uTime * 0.09, uTime * 0.05)).xyz * 2.0 - 1.0;
  float farFade = 1.0 - smoothstep(1200.0, 5000.0, dist);
  vec2 dn = (n2.xy * 0.45 + n3.xy * (0.12 + uRain * 0.9) * (1.0 - smoothstep(40.0, 400.0, dist))) * detailFade
          + n1.xy * 0.55 * max(detailFade, farFade * 0.8);
  dn *= 0.35 + 0.25 * uSea;
  vec3 N = normalize(vNormal + vec3(dn.x, 0.0, dn.y));

  // bathymetry from the baked terrain heightmap
  vec2 huv = (vWorld.xz + uWorldHalf) / (uWorldHalf * 2.0);
  float ground = texture2D(uHeightMap, huv).r;
  float depth = max(0.0, vHeight - ground);
  float shallow = 1.0 - smoothstep(0.0, 16.0, depth);
  float veryShallow = 1.0 - smoothstep(0.0, 3.5, depth);
  float midT = 1.0 - smoothstep(10.0, 60.0, depth);

  vec3 L = normalize(uSunDir);
  float NdL = max(dot(N, L), 0.0);

  // water body colour
  vec3 body = mix(uDeep, uMid, midT * 0.8 + 0.2);
  body = mix(body, uShallow, shallow);
  body = mix(body, uSandy, veryShallow * 0.55);
  // subsurface scattering through wave crests
  float sss = pow(max(dot(V, -L), 0.0), 3.0) * max(vHeight / max(uSea, 0.3), 0.0) * 0.25;
  sss += pow(max(dot(N, V), 0.0), 2.0) * 0.04;
  float sunI = uSunIntensity * 0.16;
  vec3 lit = body * (uAmbient * 0.55 + uSunColor * sunI * (0.55 + 0.45 * NdL));
  lit += uShallow * sss * uSunColor * sunI * (0.8 + shallow);

  // reflections
  vec3 R = reflect(-V, N);
  R.y = abs(R.y) + 0.05;
  R = normalize(R);
  vec3 refl = skyColor(R);
  float fres = 0.02 + 0.98 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
  fres = mix(fres, fres * 0.5, veryShallow);
  vec3 col = mix(lit, refl * 0.82, fres * 0.8);

  // sun glitter
  vec3 H = normalize(L + V);
  float spec = pow(max(dot(N, H), 0.0), 900.0) * 5.0 + pow(max(dot(N, H), 0.0), 120.0) * 0.07;
  col += uSunColor * uSunIntensity * spec * (1.0 - uRain * 0.7);

  // foam: wave crests + shoreline surf
  vec3 fA = texture2D(uFoamTex, uv * 0.045 + vec2(uTime * 0.01)).rgb;
  vec3 fB = texture2D(uFoamTex, uv * 0.19 - vec2(uTime * 0.02, 0.0)).rgb;
  float foamNoise = fA.g * 0.6 + fB.r * 0.6;
  float crest = smoothstep(1.3, 2.0, vHeight / max(uSea, 0.35) + foamNoise * 0.9 - 0.3) * vFade * (0.35 + 0.65 * fB.g);
  crest *= smoothstep(0.9, 1.7, uSea) * 0.8 + 0.12;
  float shoreBand = veryShallow * (1.0 - smoothstep(-0.2, 0.6, ground - vHeight + 0.4));
  float surf = shoreBand * smoothstep(0.35, 0.7, fract(depth * 0.35 - uTime * 0.25 + foamNoise * 0.6)) ;
  surf += (1.0 - smoothstep(0.0, 0.9, depth)) * 0.9;
  float foam = clamp(crest + surf * foamNoise * 1.4, 0.0, 1.0);
  vec3 foamCol = vec3(0.9, 0.93, 0.95) * (uAmbient * 0.8 + uSunColor * uSunIntensity * 0.22 * (0.6 + 0.4 * NdL));
  col = mix(col, foamCol, foam * 0.85);

  // exponential-squared fog to match the scene fog
  float fogF = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
  col = mix(col, uFogColor, fogF);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;
