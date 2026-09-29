// Weather: trade winds, cloud cover, squalls with rain, lightning and heavy seas.
import * as THREE from 'three';
import { clamp, damp, lerp, rand } from '../core/noise.js';

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
  }

  force(state) { this.state = state; this.timer = 60 * 8; }

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
    this.windAngle = damp(this.windAngle, this.windTarget, 0.02, dt);
    const gust = 1 + Math.sin(performance.now() * 0.00031) * 0.06 + Math.sin(performance.now() * 0.0011) * 0.04 * (1 + this.cur.storm);
    this.wind.x = Math.cos(this.windAngle);
    this.wind.z = Math.sin(this.windAngle);
    this.wind.angle = this.windAngle;
    this.wind.strength = this.cur.wind * gust;

    sky.cloudCover = this.cur.cloud;
    sky.storm = this.cur.storm;
    ocean.seaState = this.cur.sea;
    ocean.uniforms.uRain.value = this.cur.rain;

    // fog tracks the horizon colour
    this.fog.color.copy(sky.horizonColor).lerp(new THREE.Color(0x6a737c).multiplyScalar(1 - sky.nightFactor * 0.85), this.cur.storm * 0.5);
    this.fog.density = this.cur.fog * (1 + sky.nightFactor * 0.6);

    this.rainUniforms.uTime.value += dt;
    this.rainUniforms.uCam.value.copy(camera.position);
    this.rainUniforms.uWind.value.set(this.wind.x * this.wind.strength * 6, this.wind.z * this.wind.strength * 6);
    this.rainUniforms.uOpacity.value = clamp(this.cur.rain, 0, 1) * (1 - sky.nightFactor * 0.5);
    this.rain.visible = this.cur.rain > 0.03;

    if (this.cur.storm > 0.7) {
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
