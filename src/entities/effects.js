// GPU billboard particles (smoke, fire, spray, debris) and ship wakes.
import * as THREE from 'three';
import { smokeSpriteTexture, detailNoiseTexture } from '../core/textures.js';
import { rand } from '../core/noise.js';

const PVERT = /* glsl */ `
attribute vec3 iPos;
attribute vec4 iColor;
attribute vec2 iSizeRot;
varying vec2 vUv;
varying vec4 vColor;
varying float vDist;
void main() {
  vUv = uv;
  vColor = iColor;
  vec4 mv = modelViewMatrix * vec4(iPos, 1.0);
  float c = cos(iSizeRot.y), s = sin(iSizeRot.y);
  vec2 corner = vec2(c * position.x - s * position.y, s * position.x + c * position.y) * iSizeRot.x;
  mv.xy += corner;
  vDist = -mv.z;
  gl_Position = projectionMatrix * mv;
}
`;
const PFRAG = /* glsl */ `
uniform sampler2D uTex;
uniform vec3 uLight;
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform float uAdditive;
varying vec2 vUv;
varying vec4 vColor;
varying float vDist;
void main() {
  vec4 t = texture2D(uTex, vUv);
  float a = t.a * vColor.a;
  if (a < 0.004) discard;
  vec3 col = vColor.rgb * mix(uLight, vec3(1.0), uAdditive);
  float fogF = 1.0 - exp(-uFogDensity * uFogDensity * vDist * vDist);
  col = mix(col, uFogColor, fogF * (1.0 - uAdditive));
  a *= 1.0 - fogF * uAdditive;
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
}
`;

class ParticlePool {
  constructor(scene, max, additive) {
    this.max = max;
    this.count = 0;
    this.p = [];
    const quad = new THREE.PlaneGeometry(1, 1);
    const g = new THREE.InstancedBufferGeometry();
    g.index = quad.index;
    g.attributes.position = quad.attributes.position;
    g.attributes.uv = quad.attributes.uv;
    this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.aSR = new THREE.InstancedBufferAttribute(new Float32Array(max * 2), 2).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iPos', this.aPos);
    g.setAttribute('iColor', this.aCol);
    g.setAttribute('iSizeRot', this.aSR);
    g.instanceCount = 0;
    this.uniforms = {
      uTex: { value: smokeSpriteTexture() },
      uLight: { value: new THREE.Color(1, 1, 1) },
      uFogColor: { value: new THREE.Color() },
      uFogDensity: { value: 0 },
      uAdditive: { value: additive ? 1 : 0 },
    };
    this.mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: PVERT, fragmentShader: PFRAG,
      transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = additive ? 11 : 10;
    this.geo = g;
    scene.add(this.mesh);
  }

  spawn(o) {
    if (this.p.length >= this.max) this.p.shift();
    this.p.push({
      x: o.x, y: o.y, z: o.z, vx: o.vx || 0, vy: o.vy || 0, vz: o.vz || 0,
      life: 0, max: o.life || 2, s0: o.size || 1, s1: o.endSize ?? (o.size || 1) * 3,
      r: o.r ?? 1, g: o.g ?? 1, b: o.b ?? 1, a: o.alpha ?? 1, rot: Math.random() * 6.28, vr: (Math.random() - 0.5) * (o.spin ?? 1),
      grav: o.gravity || 0, drag: o.drag ?? 0.6, fadeIn: o.fadeIn ?? 0.08, buoy: o.buoy || 0, water: o.water,
    });
  }

  update(dt, windX, windZ) {
    const arr = this.p;
    let n = 0;
    const P = this.aPos.array, Cc = this.aCol.array, SR = this.aSR.array;
    for (let i = 0; i < arr.length; i++) {
      const q = arr[i];
      q.life += dt;
      if (q.life >= q.max) continue;
      const k = Math.exp(-q.drag * dt);
      q.vx = q.vx * k + windX * (1 - k) * 0.5;
      q.vz = q.vz * k + windZ * (1 - k) * 0.5;
      q.vy = q.vy * k - q.grav * dt + q.buoy * dt;
      q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt;
      if (q.water !== undefined && q.y < q.water) { q.life = q.max; continue; }
      q.rot += q.vr * dt;
      const t = q.life / q.max;
      const fade = Math.min(1, t / q.fadeIn) * (1 - t) * (1 - t * 0.3);
      arr[n++] = q;
    }
    arr.length = n;
    for (let i = 0; i < n; i++) {
      const q = arr[i];
      const t = q.life / q.max;
      P[i * 3] = q.x; P[i * 3 + 1] = q.y; P[i * 3 + 2] = q.z;
      const fade = Math.min(1, t / q.fadeIn) * (1 - t);
      Cc[i * 4] = q.r; Cc[i * 4 + 1] = q.g; Cc[i * 4 + 2] = q.b; Cc[i * 4 + 3] = q.a * fade;
      SR[i * 2] = q.s0 + (q.s1 - q.s0) * Math.sqrt(t); SR[i * 2 + 1] = q.rot;
    }
    this.geo.instanceCount = n;
    this.aPos.needsUpdate = true; this.aCol.needsUpdate = true; this.aSR.needsUpdate = true;
  }
}

export class Effects {
  constructor(scene, ocean) {
    this.scene = scene;
    this.ocean = ocean;
    this.smoke = new ParticlePool(scene, 2500, false);
    this.fire = new ParticlePool(scene, 1200, true);
    this.wakes = new Set();
    this.windX = 0; this.windZ = 0;
    this.lights = [];
    for (let i = 0; i < 4; i++) {
      const l = new THREE.PointLight(0xffa040, 0, 60, 2);
      l.userData.t = 0;
      scene.add(l);
      this.lights.push(l);
    }
  }

  flashLight(pos, intensity = 200, dur = 0.12) {
    const l = this.lights.reduce((a, b) => (a.userData.t < b.userData.t ? a : b));
    l.position.copy(pos);
    l.intensity = intensity;
    l.userData.t = dur;
    l.userData.i0 = intensity;
    l.userData.d = dur;
  }

  muzzle(pos, dir, big = true) {
    const s = big ? 1 : 0.4;
    for (let i = 0; i < 5; i++) {
      const sp = rand(4, 16) * s;
      this.fire.spawn({ x: pos.x, y: pos.y, z: pos.z, vx: dir.x * sp, vy: dir.y * sp + rand(0, 1), vz: dir.z * sp, life: rand(0.08, 0.18), size: rand(1, 2.2) * s, endSize: rand(2, 3.5) * s, r: 1, g: 0.65, b: 0.25, drag: 4 });
    }
    for (let i = 0; i < (big ? 9 : 3); i++) {
      const sp = rand(2, 12) * s;
      const g = rand(0.72, 0.9);
      this.smoke.spawn({ x: pos.x + dir.x * 1.5, y: pos.y, z: pos.z + dir.z * 1.5, vx: dir.x * sp + rand(-1, 1), vy: rand(0.2, 1.5), vz: dir.z * sp + rand(-1, 1), life: rand(3.5, 7) * (big ? 1 : 0.5), size: rand(1.5, 3) * s, endSize: rand(8, 14) * s, r: g, g: g, b: g * 0.98, alpha: 0.75, drag: 1.2, buoy: 0.15 });
    }
    if (big) this.flashLight(pos, 400, 0.15);
  }

  splash(x, z, big = 1) {
    const y = this.ocean.heightAt(x, z);
    for (let i = 0; i < 14 * big; i++) {
      const a = Math.random() * Math.PI * 2, r = rand(0, 1.5);
      this.smoke.spawn({ x: x + Math.cos(a) * r, y, z: z + Math.sin(a) * r, vx: Math.cos(a) * rand(0.5, 3), vy: rand(6, 16) * big, vz: Math.sin(a) * rand(0.5, 3), life: rand(0.8, 1.6), size: rand(0.5, 1.2) * big, endSize: rand(2, 4) * big, r: 0.92, g: 0.96, b: 1, alpha: 0.9, gravity: 18, drag: 0.4 });
    }
    for (let i = 0; i < 4; i++) this.smoke.spawn({ x, y: y + 0.3, z, vx: rand(-1, 1), vy: rand(0, 1), vz: rand(-1, 1), life: 2.5, size: 2, endSize: 7, r: 0.95, g: 0.97, b: 1, alpha: 0.5, drag: 1 });
  }

  hit(pos, n = 1) {
    // splinters + smoke + sparks
    for (let i = 0; i < 16 * n; i++) {
      this.smoke.spawn({ x: pos.x, y: pos.y, z: pos.z, vx: rand(-8, 8), vy: rand(2, 12), vz: rand(-8, 8), life: rand(1, 2.2), size: rand(0.2, 0.5), endSize: 0.3, r: 0.28, g: 0.2, b: 0.12, alpha: 1, gravity: 20, drag: 0.3, spin: 12, water: -1 });
    }
    for (let i = 0; i < 6; i++) {
      const g = rand(0.25, 0.4);
      this.smoke.spawn({ x: pos.x, y: pos.y, z: pos.z, vx: rand(-2, 2), vy: rand(1, 3), vz: rand(-2, 2), life: rand(2, 4), size: 1.5, endSize: 7, r: g, g: g, b: g, alpha: 0.7, drag: 1, buoy: 0.4 });
    }
    for (let i = 0; i < 8; i++) {
      this.fire.spawn({ x: pos.x, y: pos.y, z: pos.z, vx: rand(-10, 10), vy: rand(0, 10), vz: rand(-10, 10), life: rand(0.15, 0.4), size: 0.6, endSize: 0.1, r: 1, g: 0.6, b: 0.2, gravity: 10, drag: 1 });
    }
    this.flashLight(pos, 150, 0.12);
  }

  burn(pos, intensity = 1) {
    if (Math.random() < 0.6 * intensity) {
      this.fire.spawn({ x: pos.x + rand(-1, 1), y: pos.y, z: pos.z + rand(-1, 1), vx: rand(-0.5, 0.5), vy: rand(2, 5), vz: rand(-0.5, 0.5), life: rand(0.4, 0.9), size: rand(1, 2) * intensity, endSize: 0.3, r: 1, g: rand(0.4, 0.6), b: 0.15, drag: 1, fadeIn: 0.2 });
    }
    if (Math.random() < 0.35 * intensity) {
      const g = rand(0.12, 0.25);
      this.smoke.spawn({ x: pos.x, y: pos.y + 2, z: pos.z, vx: rand(-0.5, 0.5), vy: rand(3, 5), vz: rand(-0.5, 0.5), life: rand(4, 7), size: 2, endSize: 12 * intensity, r: g, g: g, b: g, alpha: 0.65, drag: 0.5, buoy: 0.5 });
    }
  }

  explosion(pos) {
    for (let i = 0; i < 40; i++) this.fire.spawn({ x: pos.x, y: pos.y, z: pos.z, vx: rand(-14, 14), vy: rand(0, 18), vz: rand(-14, 14), life: rand(0.3, 1), size: rand(2, 4), endSize: 0.5, r: 1, g: rand(0.4, 0.7), b: 0.2, drag: 2 });
    for (let i = 0; i < 25; i++) {
      const g = rand(0.1, 0.3);
      this.smoke.spawn({ x: pos.x, y: pos.y, z: pos.z, vx: rand(-6, 6), vy: rand(2, 10), vz: rand(-6, 6), life: rand(4, 8), size: 3, endSize: 18, r: g, g: g, b: g, alpha: 0.8, drag: 0.8, buoy: 0.5 });
    }
    this.hit(pos, 3);
    this.flashLight(pos, 1500, 0.4);
  }

  // a cook fire or chimney: a lick of flame (optional) and a thin column of pale wood smoke
  hearth(pos, dt, flame = true) {
    if (flame && Math.random() < dt * 14) this.fire.spawn({ x: pos.x + rand(-0.3, 0.3), y: pos.y, z: pos.z + rand(-0.3, 0.3), vx: rand(-0.2, 0.2), vy: rand(0.8, 1.6), vz: rand(-0.2, 0.2), life: rand(0.35, 0.7), size: rand(0.35, 0.6), endSize: 0.1, r: 1, g: rand(0.45, 0.6), b: 0.15, drag: 1, fadeIn: 0.15 });
    if (Math.random() < dt * 3) {
      const g = rand(0.62, 0.78);
      this.smoke.spawn({ x: pos.x + rand(-0.2, 0.2), y: pos.y + (flame ? 0.8 : 0), z: pos.z + rand(-0.2, 0.2), vx: rand(-0.2, 0.2), vy: rand(0.9, 1.5), vz: rand(-0.2, 0.2), life: rand(6, 10), size: 0.6, endSize: rand(4, 7), r: g, g: g * 0.98, b: g * 0.95, alpha: 0.28, drag: 0.35, buoy: 0.12 });
    }
  }

  dust(pos) {
    for (let i = 0; i < 6; i++) this.smoke.spawn({ x: pos.x, y: pos.y, z: pos.z, vx: rand(-2, 2), vy: rand(0.5, 2), vz: rand(-2, 2), life: 1.2, size: 0.5, endSize: 2, r: 0.75, g: 0.68, b: 0.55, alpha: 0.5 });
  }

  blood(pos) {
    for (let i = 0; i < 6; i++) this.smoke.spawn({ x: pos.x, y: pos.y, z: pos.z, vx: rand(-2, 2), vy: rand(0, 3), vz: rand(-2, 2), life: 0.6, size: 0.25, endSize: 0.1, r: 0.45, g: 0.03, b: 0.03, alpha: 0.9, gravity: 12 });
  }

  addWake(w) { this.wakes.add(w); this.scene.add(w.mesh); }
  removeWake(w) { this.wakes.delete(w); this.scene.remove(w.mesh); w.mesh.geometry.dispose(); }

  update(dt, sky, fog) {
    for (const pool of [this.smoke, this.fire]) {
      pool.uniforms.uLight.value.copy(sky.ambientColor).multiplyScalar(1.1).add(sky.lightColor.clone().multiplyScalar(sky.lightIntensity * 0.25));
      pool.uniforms.uFogColor.value.copy(fog.color);
      pool.uniforms.uFogDensity.value = fog.density;
      pool.update(dt, this.windX, this.windZ);
    }
    for (const l of this.lights) {
      if (l.userData.t > 0) {
        l.userData.t -= dt;
        l.intensity = Math.max(0, l.userData.i0 * (l.userData.t / l.userData.d));
      } else l.intensity = 0;
    }
    for (const w of this.wakes) w.update(dt, this.ocean, sky);
  }
}

// ---------------------------------------------------------------- wake ribbon
const WAKE_VERT = /* glsl */ `
attribute float aAlpha;
attribute vec2 aUv2;
varying float vAlpha;
varying vec2 vUv2;
varying vec3 vW;
void main() {
  vAlpha = aAlpha;
  vUv2 = aUv2;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vW = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;
const WAKE_FRAG = /* glsl */ `
uniform sampler2D uNoise;
uniform vec3 uLight;
varying float vAlpha;
varying vec2 vUv2;
varying vec3 vW;
void main() {
  float n = texture2D(uNoise, vW.xz * 0.08).g * 0.6 + texture2D(uNoise, vW.xz * 0.25).r * 0.5;
  float edge = 1.0 - pow(abs(vUv2.x * 2.0 - 1.0), 2.5);
  float centre = 0.55 + 0.45 * smoothstep(0.2, 0.5, abs(vUv2.x - 0.5));
  float streak = texture2D(uNoise, vec2(vUv2.x * 1.7, vW.x * 0.02 + vW.z * 0.02)).b;
  float a = vAlpha * smoothstep(0.5, 0.95, n + edge * 0.2 + streak * 0.25) * edge * centre;
  gl_FragColor = vec4(uLight * 0.95, a * 0.55);
  #include <colorspace_fragment>
}
`;

export class Wake {
  constructor(ship, maxPts = 50) {
    this.ship = ship;
    this.max = maxPts;
    this.pts = [];
    this.timer = 0;
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(maxPts * 2 * 3);
    this.alpha = new Float32Array(maxPts * 2);
    this.uv2 = new Float32Array(maxPts * 2 * 2);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aUv2', new THREE.BufferAttribute(this.uv2, 2));
    const idx = [];
    for (let i = 0; i < maxPts - 1; i++) {
      const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
      idx.push(a, c, b, b, c, d);
    }
    g.setIndex(idx);
    for (let i = 0; i < maxPts; i++) { this.uv2[i * 4] = 0; this.uv2[i * 4 + 2] = 1; }
    this.uniforms = { uNoise: { value: detailNoiseTexture() }, uLight: { value: new THREE.Color(1, 1, 1) } };
    this.mesh = new THREE.Mesh(g, new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: WAKE_VERT, fragmentShader: WAKE_FRAG,
      transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
    }));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
  }

  update(dt, ocean, sky) {
    const s = this.ship;
    this.timer -= dt;
    const speed = s.speed;
    if (this.timer <= 0 && !s.sunk) {
      this.timer = 0.2;
      const fx = s.forward.x, fz = s.forward.z;
      this.pts.unshift({ x: s.position.x - fx * s.cls.length * 0.45, z: s.position.z - fz * s.cls.length * 0.45, lx: -fz, lz: fx, age: 0, w: s.cls.beam * 0.45, str: Math.min(1, speed / 14) });
      if (this.pts.length > this.max) this.pts.pop();
    }
    this.uniforms.uLight.value.copy(sky.ambientColor).multiplyScalar(0.7).add(sky.lightColor.clone().multiplyScalar(sky.lightIntensity * 0.2));
    const n = this.pts.length;
    for (let i = 0; i < this.max; i++) {
      const p = this.pts[Math.min(i, n - 1)];
      if (!p) { this.alpha[i * 2] = this.alpha[i * 2 + 1] = 0; continue; }
      if (i < n) { p.age += dt; p.w += dt * 1.6; }
      const y = ocean.heightAt(p.x, p.z) + 0.12;
      const k = i * 6;
      this.pos[k] = p.x - p.lx * p.w; this.pos[k + 1] = y; this.pos[k + 2] = p.z - p.lz * p.w;
      this.pos[k + 3] = p.x + p.lx * p.w; this.pos[k + 4] = y; this.pos[k + 5] = p.z + p.lz * p.w;
      const a = i < n ? p.str * Math.max(0, 1 - p.age / 9) * Math.min(1, i / 2) : 0;
      this.alpha[i * 2] = this.alpha[i * 2 + 1] = a;
    }
    // snap the first point to the stern each frame to avoid a gap
    if (n > 0 && !s.sunk) {
      const fx = s.forward.x, fz = s.forward.z;
      const x = s.position.x - fx * s.cls.length * 0.42, z = s.position.z - fz * s.cls.length * 0.42;
      const y = ocean.heightAt(x, z) + 0.12;
      const w = s.cls.beam * 0.4;
      this.pos[0] = x + fz * w; this.pos[1] = y; this.pos[2] = z - fx * w;
      this.pos[3] = x - fz * w; this.pos[4] = y; this.pos[5] = z + fx * w;
    }
    this.mesh.geometry.attributes.position.needsUpdate = true;
    this.mesh.geometry.attributes.aAlpha.needsUpdate = true;
  }
}
