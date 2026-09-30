// Weather: trade winds, cloud cover, squalls with rain, lightning and heavy seas.
import * as THREE from 'three';
import { clamp, damp, lerp, rand, Simplex } from '../core/noise.js';
import { WIND_SPEED } from '../entities/sailing.js';

const STATES = {
  clear: { cloud: 0.2, storm: 0, sea: 0.85, wind: 0.8, rain: 0, fog: 0.00009 },
  fair: { cloud: 0.45, storm: 0, sea: 1.0, wind: 0.95, rain: 0, fog: 0.0001 },
  overcast: { cloud: 0.75, storm: 0.25, sea: 1.25, wind: 1.1, rain: 0.15, fog: 0.00016 },
  storm: { cloud: 1.0, storm: 1.0, sea: 2.1, wind: 1.35, rain: 1, fog: 0.00045 },
};
const NEXT = { clear: ['fair', 'fair', 'clear'], fair: ['clear', 'overcast', 'fair', 'clear'], overcast: ['fair', 'storm', 'fair'], storm: ['overcast'] };

export class Weather {
  constructor(scene) {
    this.state = 'fair';
    this.timer = 60 * 6;
    this.cur = { ...STATES.fair };
    // Trade winds from the east-north-east
    this.baseAngle = Math.atan2(0.35, -0.94); // direction the wind blows toward (x,z) = (-0.94, 0.35)
    this.windAngle = this.baseAngle;
    this.windTarget = this.baseAngle;
    this.wind = { x: -0.94, z: 0.35, strength: 0.95, angle: this.baseAngle };
    this.fog = new THREE.FogExp2(0xbcd3e6, 0.0001);
    scene.fog = this.fog;
    this.lightningTimer = 5;
    this.forced = null;

    const N = 5000;
    const pos = new Float32Array(N * 6);
    for (let i = 0; i < N; i++) {
      const x = rand(-60, 60), y = rand(-10, 50), z = rand(-60, 60);
      pos.set([x, y, z, x, y, z], i * 6);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.rainUniforms = { uTime: { value: 0 }, uOpacity: { value: 0 }, uCam: { value: new THREE.Vector3() }, uWind: { value: new THREE.Vector2() } };
    this.rain = new THREE.LineSegments(g, new THREE.ShaderMaterial({
      uniforms: this.rainUniforms,
      transparent: true, depthWrite: false,
      vertexShader: `
        uniform float uTime; uniform vec3 uCam; uniform vec2 uWind;
        varying float vA;
        void main() {
          vec3 p = position;
          float fall = mod(p.y - uTime * 38.0 - uCam.y, 60.0) - 10.0;
          vec3 base = vec3(mod(p.x - uCam.x + uWind.x * uTime * 4.0, 120.0) - 60.0, fall, mod(p.z - uCam.z + uWind.y * uTime * 4.0, 120.0) - 60.0);
          vec3 wp = uCam + base + vec3(uWind.x, 0.0, uWind.y) * (fall * 0.08);
          if (mod(float(gl_VertexID), 2.0) > 0.5) wp += vec3(-uWind.x * 0.15, -0.9, -uWind.y * 0.15);
          vA = 1.0 - smoothstep(20.0, 60.0, length(base.xz));
          gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
        }`,
      fragmentShader: `
        uniform float uOpacity; varying float vA;
        void main() { gl_FragColor = vec4(0.72, 0.76, 0.82, uOpacity * vA * 0.28); }`,
    }));
    this.rain.frustumCulled = false;
    this.rain.visible = false;
    scene.add(this.rain);

    // Squalls: dark cells a few hundred metres across that march down the wind under their own cloud, with a
    // curtain of rain beneath and a hard, veering gust inside. A ship caught under full sail loses her gear.
    this.scene = scene;
    this.squalls = [];
    this.squallTimer = 40;
    this.localRain = 0;
    this.curtainMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uFade: { value: 0 }, uCol: { value: new THREE.Color(0x59626c) } },
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
      vertexShader: `
        varying vec3 vN; varying vec3 vW; varying vec2 vUv;
        void main() {
          vUv = uv;
          vec4 w = modelMatrix * vec4(position, 1.0);
          vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal);
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: `
        uniform float uTime; uniform vec3 uCol; uniform float uFade;
        varying vec3 vN; varying vec3 vW; varying vec2 vUv;
        float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float n(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
        void main() {
          vec3 V = normalize(cameraPosition - vW);
          // thickest looking through the middle of the column, thin at its edges
          float thick = pow(abs(dot(vN, V)), 0.8);
          // streaks of rain falling, in sheets that come and go
          float streak = n(vec2(vUv.x * 160.0, vUv.y * 6.0 + uTime * 1.6)) * 0.5 + n(vec2(vUv.x * 23.0, vUv.y * 1.5 + uTime * 0.4)) * 0.7;
          float a = uFade * thick * (0.3 + 0.4 * streak);
          a *= smoothstep(0.0, 0.06, vUv.y) * (1.0 - smoothstep(0.7, 1.0, vUv.y));
          a *= exp(-length(cameraPosition - vW) * 0.00018);
          gl_FragColor = vec4(uCol, a);
        }`,
    });
  }

  // how deep (0..1) the point lies inside a squall
  squallAt(x, z) {
    let q = 0;
    for (const c of this.squalls) {
      const d = Math.hypot(x - c.x, z - c.z);
      if (d < c.r) q = Math.max(q, (1 - (d / c.r) ** 2) * c.fade);
    }
    return q;
  }

  // a ragged, lumpy cloud base: soft dark billows, thinning to nothing at the rim
  cloudTexture() {
    if (this._cloudTex) return this._cloudTex;
    const N = 256, c = document.createElement('canvas'); c.width = c.height = N;
    const x = c.getContext('2d');
    for (let i = 0; i < 90; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * N * 0.36;
      const px = N / 2 + Math.cos(a) * r, py = N / 2 + Math.sin(a) * r, rad = rand(18, 52) * (1 - r / (N * 0.6));
      const g = x.createRadialGradient(px, py, 0, px, py, rad);
      const shade = Math.floor(rand(40, 85));
      g.addColorStop(0, `rgba(${shade},${shade + 6},${shade + 14},0.55)`); g.addColorStop(1, `rgba(${shade},${shade + 6},${shade + 14},0)`);
      x.fillStyle = g; x.fillRect(0, 0, N, N);
    }
    this._cloudTex = new THREE.CanvasTexture(c);
    this._cloudTex.colorSpace = THREE.SRGBColorSpace;
    return this._cloudTex;
  }

  spawnSquall(focus) {
    const W = this.wind;
    // form upwind of you, somewhere off to one side or the other, and come down on you with the wind
    const up = rand(900, 1500), side = rand(-600, 600);
    const x = focus.x - W.x * up - W.z * side, z = focus.z - W.z * up + W.x * side;
    const r = rand(170, 320);
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.85, r, 420, 40, 1, true).translate(0, 205, 0), this.curtainMat.clone());
    mesh.material.uniforms.uFade = { value: 0 };
    mesh.material.uniforms.uTime = this.curtainMat.uniforms.uTime;
    mesh.frustumCulled = false;
    mesh.renderOrder = 2;
    // its cloud: a dark, ragged base overhead
    const cloud = new THREE.Group();
    for (let k = 0; k < 3; k++) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(r * (3.2 + k * 0.5), r * (3.2 + k * 0.5)).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: this.cloudTexture(), transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, fog: true }));
      m.rotation.y = k * 2.1;
      m.position.y = 395 + k * 35;
      cloud.add(m);
    }
    mesh.add(cloud);
    mesh.position.set(x, 0, z);
    this.scene.add(mesh);
    this.squalls.push({ x, z, r, age: 0, life: rand(200, 320), fade: 0, mesh, cloud });
  }

  updateSqualls(dt, focus) {
    const rate = { clear: 0, fair: 1 / 420, overcast: 1 / 110, storm: 0 }[this.state] ?? 0;
    this.squallTimer -= dt;
    if (focus && this.squallTimer <= 0 && this.squalls.length < 3) {
      this.squallTimer = rand(20, 40);
      if (Math.random() < rate * 30 || this.forceSquall) { this.forceSquall = false; this.spawnSquall(focus); }
    }
    const W = this.wind, v = WIND_SPEED * 0.2 * W.strength;
    for (let i = this.squalls.length - 1; i >= 0; i--) {
      const c = this.squalls[i];
      c.age += dt;
      c.x += W.x * v * dt; c.z += W.z * v * dt;
      c.fade = clamp(Math.min(c.age / 25, (c.life - c.age) / 35), 0, 1);
      c.mesh.position.set(c.x, 0, c.z);
      c.mesh.material.uniforms.uFade.value = c.fade;
      for (const m of c.cloud.children) m.material.opacity = c.fade;
      if (c.age > c.life) { this.scene.remove(c.mesh); c.mesh.geometry.dispose(); for (const m of c.cloud.children) m.geometry.dispose(); this.squalls.splice(i, 1); }
    }
  }

  force(state) { this.state = state; this.timer = 60 * 8; }

  // The wind a ship actually feels at (x, z): the trade wind, shifting a few degrees as the day goes on, with
  // gusts and lulls rolling downwind across the sea, and knocked down and made fluky in the lee of high land.
  windAt(x, z, terrain) {
    const n = this.noise || (this.noise = new Simplex(1492));
    const t = this.clock || 0, W = this.wind;
    // gust patches ~250 m across drift downwind at a third of the wind's speed
    const ox = W.x * t * WIND_SPEED * 0.33, oz = W.z * t * WIND_SPEED * 0.33;
    const g = n.noise2((x - ox) * 0.004, (z - oz) * 0.004) * 0.7 + n.noise2((x - ox) * 0.011 + 40, (z - oz) * 0.011) * 0.3;
    const sq = this.squalls.length ? this.squallAt(x, z) : 0;
    let speed = W.strength * (1 + g * (0.16 + 0.14 * Math.max(this.cur.storm, sq))) * (1 + 0.95 * sq);
    let ang = W.angle + n.noise2(x * 0.0012 + t * 0.004, z * 0.0012) * 0.09 + sq * 0.35; // it veers in the squall
    // lee of the land: high ground upwind blankets the wind and makes it fluky
    if (terrain) {
      let shadow = 0;
      for (const d of [40, 110, 240, 450]) {
        const h = terrain.quickHeight(x - W.x * d, z - W.z * d);
        if (h > 2) shadow = Math.max(shadow, clamp((h - 2) / (d * 0.09 + 3), 0, 1));
      }
      speed *= 1 - 0.75 * shadow;
      ang += shadow * n.noise2(x * 0.02 + t * 0.2, z * 0.02) * 0.6;
    }
    return { x: Math.cos(ang), z: Math.sin(ang), speed: Math.max(0, speed) * WIND_SPEED, strength: Math.max(0, speed) };
  }

  update(dt, gameMinutesDt, camera, sky, ocean, audio) {
    this.timer -= gameMinutesDt;
    if (this.timer <= 0) {
      const opts = NEXT[this.state];
      this.state = opts[Math.floor(Math.random() * opts.length)];
      this.timer = rand(4, 10) * 60;
      this.windTarget = this.baseAngle + rand(-0.6, 0.6);
    }
    const tgt = STATES[this.state];
    const k = 0.05;
    for (const key of Object.keys(tgt)) this.cur[key] = damp(this.cur[key], tgt[key], k, dt);
    this.clock = (this.clock || 0) + dt;
    // the trade wind veers and backs a few degrees over the day
    this.windAngle = damp(this.windAngle, this.windTarget + Math.sin(this.clock * 0.004) * 0.12, 0.02, dt);
    const gust = 1 + Math.sin(performance.now() * 0.00031) * 0.06 + Math.sin(performance.now() * 0.0011) * 0.04 * (1 + this.cur.storm);
    this.wind.x = Math.cos(this.windAngle);
    this.wind.z = Math.sin(this.windAngle);
    this.wind.angle = this.windAngle;
    this.wind.strength = this.cur.wind * gust;

    this.updateSqualls(dt, camera.position);
    this.curtainMat.uniforms.uTime.value += dt;
    const sq = this.squallAt(camera.position.x, camera.position.z);
    this.localRain = damp(this.localRain, sq, 1.5, dt);
    const rain = Math.max(this.cur.rain, this.localRain);
    sky.cloudCover = Math.max(this.cur.cloud, this.localRain * 0.95);
    sky.storm = Math.max(this.cur.storm, this.localRain * 0.75);
    ocean.seaState = this.cur.sea;
    ocean.uniforms.uRain.value = rain;

    // fog tracks the horizon colour
    this.fog.color.copy(sky.horizonColor).lerp(new THREE.Color(0x6a737c).multiplyScalar(1 - sky.nightFactor * 0.85), Math.max(this.cur.storm, this.localRain) * 0.5);
    this.fog.density = (this.cur.fog + this.localRain * 0.0004) * (1 + sky.nightFactor * 0.6);

    this.rainUniforms.uTime.value += dt;
    this.rainUniforms.uCam.value.copy(camera.position);
    this.rainUniforms.uWind.value.set(this.wind.x * this.wind.strength * 6, this.wind.z * this.wind.strength * 6);
    this.rainUniforms.uOpacity.value = clamp(rain, 0, 1) * (1 - sky.nightFactor * 0.5);
    this.rain.visible = rain > 0.03;

    if (Math.max(this.cur.storm, this.localRain) > 0.7) {
      this.lightningTimer -= dt;
      if (this.lightningTimer <= 0) {
        this.lightningTimer = rand(6, 20);
        sky.flash();
        const d = rand(400, 3000);
        setTimeout(() => audio?.thunder(d), (d / 343) * 1000);
      }
    }
  }

  describe() {
    return { clear: 'Clear skies', fair: 'Fair weather', overcast: 'Overcast', storm: 'Squall' }[this.state];
  }
}
