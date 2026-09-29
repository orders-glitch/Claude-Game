// Analytic sky dome with sun, moon, stars and a procedural cloud layer; drives the scene lighting.
import * as THREE from 'three';
import { clamp, lerp, smoothstep } from '../core/noise.js';

const C = (hex) => new THREE.Color(hex);
// Sky gradient keys by sun elevation (sin of altitude).
const KEYS = [
  { e: -0.35, zen: C('#02050d'), hor: C('#0a1222'), sun: C('#223355'), amb: C('#18233a') },
  { e: -0.12, zen: C('#0a1430'), hor: C('#1e2740'), sun: C('#40507a'), amb: C('#1d2a42') },
  { e: -0.02, zen: C('#28355e'), hor: C('#d0694a'), sun: C('#ff7a40'), amb: C('#4a3a4a') },
  { e: 0.06, zen: C('#3d5f98'), hor: C('#f0a766'), sun: C('#ffb070'), amb: C('#6e6a70') },
  { e: 0.22, zen: C('#3b73c2'), hor: C('#bcd3e6'), sun: C('#ffe2b8'), amb: C('#8ea3b8') },
  { e: 0.6, zen: C('#2f6ac2'), hor: C('#b9d6ee'), sun: C('#fff4e2'), amb: C('#9fb4c8') },
  { e: 1.0, zen: C('#2a62bd'), hor: C('#b5d3ee'), sun: C('#ffffff'), amb: C('#a5bace') },
];

function sampleKeys(e, out) {
  let a = KEYS[0], b = KEYS[KEYS.length - 1];
  for (let i = 0; i < KEYS.length - 1; i++) {
    if (e >= KEYS[i].e && e <= KEYS[i + 1].e) { a = KEYS[i]; b = KEYS[i + 1]; break; }
  }
  if (e < KEYS[0].e) b = a;
  if (e > KEYS[KEYS.length - 1].e) a = b;
  const t = a === b ? 0 : (e - a.e) / (b.e - a.e);
  out.zen.copy(a.zen).lerp(b.zen, t);
  out.hor.copy(a.hor).lerp(b.hor, t);
  out.sun.copy(a.sun).lerp(b.sun, t);
  out.amb.copy(a.amb).lerp(b.amb, t);
}

export class SkySystem {
  constructor(scene, renderer, quality = 'high') {
    this.scene = scene;
    this.renderer = renderer;
    this.sunDir = new THREE.Vector3(0, 1, 0);
    this.moonDir = new THREE.Vector3(0, -1, 0);
    this.lightDir = new THREE.Vector3(0, 1, 0);
    this.lightColor = new THREE.Color();
    this.lightIntensity = 1;
    this.ambientColor = new THREE.Color();
    this.horizonColor = new THREE.Color();
    this.zenithColor = new THREE.Color();
    this.cloudCover = 0.45;
    this.storm = 0;
    this.nightFactor = 0;
    this._k = { zen: new THREE.Color(), hor: new THREE.Color(), sun: new THREE.Color(), amb: new THREE.Color() };

    this.uniforms = {
      uSunDir: { value: this.sunDir },
      uMoonDir: { value: this.moonDir },
      uZenith: { value: this.zenithColor },
      uHorizon: { value: this.horizonColor },
      uSunColor: { value: new THREE.Color() },
      uNight: { value: 0 },
      uTime: { value: 0 },
      uCloud: { value: 0.45 },
      uStorm: { value: 0 },
      uFlash: { value: 0 },
    };
    const geo = new THREE.SphereGeometry(1, 48, 24);
    this.dome = new THREE.Mesh(geo, new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
    }));
    this.dome.scale.setScalar(20000);
    this.dome.renderOrder = -10;
    this.dome.frustumCulled = false;
    scene.add(this.dome);

    // Lights
    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = quality !== 'low';
    const sm = quality === 'high' ? 4096 : 2048;
    this.sun.shadow.mapSize.set(sm, sm);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.6;
    this.setShadowExtent(90);
    scene.add(this.sun);
    scene.add(this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xbfd8ff, 0x5a4a30, 1);
    scene.add(this.hemi);

    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envScene = new THREE.Scene();
    this.envDome = new THREE.Mesh(geo, this.dome.material);
    this.envDome.scale.setScalar(100);
    this.envScene.add(this.envDome);
    this.envTimer = 0;
    this.envRT = null;
  }

  setShadowExtent(r) {
    const c = this.sun.shadow.camera;
    c.left = -r; c.right = r; c.top = r; c.bottom = -r;
    c.near = 1; c.far = r * 6;
    c.updateProjectionMatrix();
    this.shadowExtent = r;
  }

  // hours: 0..24 game time
  update(dt, hours, camera, focus) {
    const u = this.uniforms;
    u.uTime.value += dt;
    const a = ((hours - 6) / 12) * Math.PI;
    this.sunDir.set(Math.cos(a), Math.sin(a), 0.28).normalize();
    this.moonDir.set(-Math.cos(a) * 0.9, -Math.sin(a) * 0.85 + 0.12, -0.3).normalize();
    const e = this.sunDir.y;
    const k = this._k;
    sampleKeys(e, k);
    this.nightFactor = 1 - smoothstep(-0.18, 0.02, e);

    // storms grey everything out
    const st = this.storm;
    const grey = C('#5d666e');
    k.zen.lerp(grey.clone().multiplyScalar(0.55 + 0.45 * (1 - this.nightFactor)), st * 0.8 * (1 - this.nightFactor * 0.8));
    k.hor.lerp(grey.clone().multiplyScalar(0.75 * (1 - this.nightFactor) + 0.08), st * 0.75);
    k.sun.multiplyScalar(1 - st * 0.55);

    this.zenithColor.copy(k.zen);
    this.horizonColor.copy(k.hor);
    u.uSunColor.value.copy(k.sun);
    u.uNight.value = this.nightFactor;
    u.uCloud.value = this.cloudCover;
    u.uStorm.value = st;

    // sun or moon as key light
    const moonUp = this.nightFactor > 0.6;
    if (!moonUp) {
      this.lightDir.copy(this.sunDir);
      if (this.lightDir.y < 0.04) this.lightDir.y = 0.04;
      this.lightDir.normalize();
      this.lightColor.copy(k.sun);
      this.lightIntensity = (3.2 * smoothstep(-0.04, 0.25, e) + 0.05) * (1 - st * 0.65) * (1 - this.cloudCover * 0.25);
    } else {
      this.lightDir.copy(this.moonDir);
      if (this.lightDir.y < 0.2) this.lightDir.y = 0.2;
      this.lightDir.normalize();
      this.lightColor.set('#8fa6d6');
      this.lightIntensity = 0.45 * (1 - st * 0.7);
    }
    this.ambientColor.copy(k.amb).multiplyScalar(1 - st * 0.25);

    this.sun.color.copy(this.lightColor);
    this.sun.intensity = this.lightIntensity;
    this.hemi.color.copy(k.zen).lerp(k.hor, 0.5).multiplyScalar(1.2);
    this.hemi.groundColor.copy(k.amb).multiplyScalar(0.5);
    this.hemi.intensity = lerp(0.85, 0.45, this.nightFactor) * (1 - st * 0.2);

    // flash (lightning)
    if (u.uFlash.value > 0) {
      this.hemi.intensity += u.uFlash.value * 4;
      u.uFlash.value = Math.max(0, u.uFlash.value - dt * 5);
    }

    // follow camera
    this.dome.position.copy(camera.position);
    const f = focus || camera.position;
    const ext = this.shadowExtent;
    // snap shadow camera to texel grid to avoid shimmering
    const texel = (ext * 2) / this.sun.shadow.mapSize.x;
    const fx = Math.round(f.x / texel) * texel, fz = Math.round(f.z / texel) * texel;
    this.sun.target.position.set(fx, f.y, fz);
    this.sun.position.set(fx + this.lightDir.x * ext * 3, f.y + this.lightDir.y * ext * 3, fz + this.lightDir.z * ext * 3);

    // environment map for PBR reflections, refreshed periodically
    this.envTimer -= dt;
    if (this.envTimer <= 0) {
      this.envTimer = 6;
      const old = this.envRT;
      this.envRT = this.pmrem.fromScene(this.envScene, 0, 0.1, 1000);
      this.scene.environment = this.envRT.texture;
      this.scene.environmentIntensity = lerp(0.45, 0.15, this.nightFactor) * (1 - st * 0.4);
      if (old) old.dispose();
    }
  }

  flash() { this.uniforms.uFlash.value = 1; }
}

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize((modelMatrix * vec4(position, 0.0)).xyz);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}
`;

const SKY_FRAG = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uMoonDir;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uSunColor;
uniform float uNight;
uniform float uTime;
uniform float uCloud;
uniform float uStorm;
uniform float uFlash;
varying vec3 vDir;

float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash2(i), hash2(i + vec2(1, 0)), u.x), mix(hash2(i + vec2(0, 1)), hash2(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 6; i++) { s += a * vnoise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; }
  return s;
}

void main() {
  vec3 d = normalize(vDir);
  float y = d.y;
  vec3 col = mix(uHorizon, uZenith, pow(max(y, 0.0), 0.5));
  col = mix(col, uHorizon * 0.8, smoothstep(0.0, -0.3, y));

  float sd = max(dot(d, normalize(uSunDir)), 0.0);
  float sunVis = smoothstep(-0.1, 0.02, uSunDir.y);
  // atmospheric glow around the sun, warmer near the horizon
  float horizonBoost = 1.0 - smoothstep(0.0, 0.5, uSunDir.y);
  col += uSunColor * (pow(sd, 6.0) * (0.12 + 0.35 * horizonBoost) + pow(sd, 64.0) * 0.35) * sunVis * (1.0 - uStorm * 0.8);
  col += uSunColor * smoothstep(0.99955, 0.99975, sd) * 40.0 * sunVis * (1.0 - uStorm) * (1.0 - uCloud * 0.3);

  // night sky
  if (uNight > 0.01) {
    vec3 sp = d * 420.0;
    vec3 cell = floor(sp);
    float h = hash(cell);
    float star = step(0.9965, h) * smoothstep(0.5, 0.0, length(fract(sp) - 0.5));
    float tw = 0.6 + 0.4 * sin(uTime * (2.0 + h * 5.0) + h * 40.0);
    // faint milky way band
    float bd = dot(d, normalize(vec3(0.4, 0.3, 0.86))) * 3.2;
    float band = exp(-bd * bd) * fbm(d.xz * 9.0 + d.y * 3.0);
    col += (vec3(star * tw * 1.6) + vec3(0.06, 0.07, 0.1) * band) * uNight * smoothstep(-0.05, 0.15, y) * (1.0 - uStorm);
    float md = dot(d, normalize(uMoonDir));
    float moon = smoothstep(0.99935, 0.9995, md);
    float crater = fbm(d.xy * 400.0) * 0.35;
    col += vec3(0.9, 0.92, 1.0) * moon * (1.6 - crater) * uNight * (1.0 - uStorm);
    col += vec3(0.25, 0.3, 0.45) * pow(max(md, 0.0), 180.0) * 0.5 * uNight;
  }

  // cloud layer
  if (y > 0.0) {
    vec2 cp = d.xz / (y + 0.06) * 1.6 + vec2(uTime * 0.012, uTime * 0.006);
    float cov = mix(0.62, 0.18, uCloud) - uStorm * 0.2;
    float n = fbm(cp);
    float dens = smoothstep(cov, cov + 0.28, n);
    // cheap self-shadowing toward the sun
    float n2 = fbm(cp + normalize(uSunDir.xz + 0.0001) * 0.12);
    float shade = clamp(0.55 + (n - n2) * 3.0, 0.0, 1.0);
    vec3 cLit = mix(uHorizon * 0.9 + uSunColor * 0.35, uSunColor * 1.15 + vec3(0.1), shade) * (1.0 - uNight * 0.85);
    vec3 cDark = mix(vec3(0.35, 0.38, 0.42), vec3(0.2, 0.22, 0.25), uStorm) * (1.0 - uNight * 0.9);
    vec3 cc = mix(cDark, cLit, shade * (1.0 - uStorm * 0.7));
    cc += uSunColor * pow(sd, 8.0) * 0.6 * (1.0 - dens) * sunVis;
    float fadeH = smoothstep(0.0, 0.18, y);
    col = mix(col, cc, dens * fadeH * 0.95);
  }
  col += vec3(0.7, 0.75, 0.9) * uFlash * 0.8;
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;
