// Photoscanned trees (Poly Haven, CC0; built by tools/build-trees.mjs). Trees near the camera are real
// instanced meshes with shadows; everything further out is an impostor: a camera-facing card showing the
// tree from the nearest of 8 pre-rendered directions, lit with baked normals so it still follows the sun.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const FRAMES = 8;
const FRAME_PX = 256;
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);

export const floraUniforms = {
  uSunDir: { value: new THREE.Vector3(0.3, 0.8, 0.2) },
  uSunCol: { value: new THREE.Color(1, 1, 1) },
  uSky: { value: new THREE.Color(0.5, 0.6, 0.7) },
  uGround: { value: new THREE.Color(0.3, 0.28, 0.2) },
  uNear: { value: 48 },
};

const IMPOSTOR_VERT = /* glsl */ `
  uniform float uNear;
  uniform float uFrames;
  varying vec2 vUv;
  varying float vYaw;
  varying float vFade;
  #include <common>
  #include <fog_pars_vertex>
  void main() {
    vec3 c = instanceMatrix[3].xyz;
    float scale = length(instanceMatrix[0].xyz);
    float yaw = atan(instanceMatrix[0].z, instanceMatrix[0].x) * -1.0;
    vec3 toCam = cameraPosition - c; toCam.y = 0.0;
    float d = length(toCam);
    toCam /= max(d, 1e-3);
    // which of the baked directions is closest to the current view (in the tree's own frame)
    float ang = atan(toCam.x, toCam.z) - yaw;
    float f = mod(floor(ang / (6.2831853 / uFrames) + 0.5), uFrames);
    vYaw = yaw;
    vUv = vec2((uv.x + f) / uFrames, uv.y);
    vec3 right = vec3(toCam.z, 0.0, -toCam.x);
    vec3 pos = c + right * position.x * scale + vec3(0.0, position.y * scale, 0.0);
    // hand over to the real mesh up close (a short dithered band avoids popping)
    vFade = smoothstep(uNear - 6.0, uNear + 6.0, d);
    if (vFade <= 0.0) pos = vec3(0.0, -1e5, 0.0);
    vec4 mvPosition = viewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }`;

const IMPOSTOR_FRAG = /* glsl */ `
  uniform sampler2D uAlbedo;
  uniform sampler2D uNormal;
  uniform vec3 uSunDir;
  uniform vec3 uSunCol;
  uniform vec3 uSky;
  uniform vec3 uGround;
  varying vec2 vUv;
  varying float vYaw;
  varying float vFade;
  #include <common>
  #include <dithering_pars_fragment>
  #include <fog_pars_fragment>
  void main() {
    vec4 a = texture2D(uAlbedo, vUv);
    if (a.a < 0.5) discard;
    // dithered cross-fade with the near mesh
    if (vFade < 1.0 && fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) > vFade) discard;
    vec3 n = texture2D(uNormal, vUv).xyz * 2.0 - 1.0;
    // baked normals are in the tree's frame; rotate by the instance yaw
    float cy = cos(vYaw), sy = sin(vYaw);
    n = normalize(vec3(n.x * cy + n.z * sy, n.y, -n.x * sy + n.z * cy));
    // wrapped diffuse: foliage transmits light, so the shadowed side never goes black
    float sun = clamp(dot(n, uSunDir) * 0.6 + 0.4, 0.0, 1.0);
    vec3 amb = mix(uGround, uSky, n.y * 0.5 + 0.5) * 1.5;
    vec3 col = a.rgb * (amb + uSunCol * sun);
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }`;

// quantized glTF attributes (normalized int16 etc.) can't hold baked world transforms: convert to float
function dequantize(geo) {
  for (const [name, attr] of Object.entries(geo.attributes)) {
    if (!attr.isInterleavedBufferAttribute && attr.array instanceof Float32Array) continue;
    const out = new Float32Array(attr.count * attr.itemSize);
    const get = [attr.getX, attr.getY, attr.getZ, attr.getW];
    for (let i = 0; i < attr.count; i++) for (let c = 0; c < attr.itemSize; c++) out[i * attr.itemSize + c] = get[c].call(attr, i);
    geo.setAttribute(name, new THREE.BufferAttribute(out, attr.itemSize));
  }
  return geo;
}

class Flora {
  constructor() {
    this.types = {}; // name -> { parts, height, radius, impostor }
  }

  async load(names, base = './models/plants/') {
    const loader = new GLTFLoader();
    await Promise.all(names.map(async (name) => {
      try {
        const gltf = await loader.loadAsync(base + name + '.glb');
        gltf.scene.updateMatrixWorld(true);
        const parts = [];
        gltf.scene.traverse((o) => {
          if (!o.isMesh) return;
          const geometry = dequantize(o.geometry.clone()).applyMatrix4(o.matrixWorld);
          geometry.morphAttributes = {};
          const material = o.material;
          if (material.alphaTest > 0 || material.transparent) {
            material.transparent = false; material.alphaTest = 0.45; material.side = THREE.DoubleSide;
            material.color.setRGB(0.78, 1.0, 0.7); // lusher, tropical green
          }
          if (material.map) material.map.anisotropy = 4;
          parts.push({ geometry, material });
        });
        const box = new THREE.Box3();
        for (const p of parts) { p.geometry.computeBoundingBox(); box.union(p.geometry.boundingBox); }
        this.types[name] = { parts, box, height: box.max.y, radius: Math.max(-box.min.x, box.max.x, -box.min.z, box.max.z) };
      } catch (e) { /* optional */ }
    }));
    return this;
  }

  has(name) { return !!this.types[name]; }

  // Render 8 side views of each tree into albedo and normal atlases.
  bakeImpostors(renderer, names = TREE_TYPES) {
    for (const [name, T] of Object.entries(this.types)) {
      if (!names.includes(name)) continue;
      const w = T.radius * 2.1, h = T.height * 1.04;
      const scene = new THREE.Scene();
      const mats = { albedo: [], normal: [] };
      for (const p of T.parts) {
        const alphaTest = p.material.alphaTest || 0;
        const map = p.material.map || null;
        const albedo = new THREE.MeshBasicMaterial({ map, color: p.material.color, alphaTest, side: THREE.DoubleSide });
        const normal = new THREE.ShaderMaterial({
          uniforms: { map: { value: map }, alphaTest: { value: alphaTest } },
          side: THREE.DoubleSide,
          vertexShader: 'varying vec3 vN; varying vec2 vUv; void main(){ vN = normal; vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
          fragmentShader: 'uniform sampler2D map; uniform float alphaTest; varying vec3 vN; varying vec2 vUv; void main(){ float a = 1.0; ' + (map ? 'a = texture2D(map, vUv).a;' : '') + ' if (a < alphaTest) discard; vec3 n = normalize(vN) * (gl_FrontFacing ? 1.0 : -1.0); n = normalize(n + vec3(0.0, 0.35, 0.0)); gl_FragColor = vec4(n * 0.5 + 0.5, 1.0); }',
        });
        const mesh = new THREE.Mesh(p.geometry, albedo);
        mesh.userData.mats = { albedo, normal };
        scene.add(mesh);
      }
      const make = (srgb) => {
        const rt = new THREE.WebGLRenderTarget(FRAME_PX * FRAMES, FRAME_PX, { samples: 4 });
        rt.texture.generateMipmaps = true;
        rt.texture.minFilter = THREE.LinearMipmapLinearFilter;
        if (srgb) rt.texture.colorSpace = THREE.SRGBColorSpace;
        return rt;
      };
      const rtA = make(true), rtN = make(false);
      const cam = new THREE.OrthographicCamera(-w / 2, w / 2, h, 0, 0.1, T.radius * 6);
      const prev = { target: renderer.getRenderTarget(), clear: renderer.getClearColor(new THREE.Color()), alpha: renderer.getClearAlpha(), tm: renderer.toneMapping, sc: renderer.getScissorTest() };
      renderer.toneMapping = THREE.NoToneMapping;
      for (const [rt, key] of [[rtA, 'albedo'], [rtN, 'normal']]) {
        scene.traverse((o) => { if (o.userData.mats) o.material = o.userData.mats[key]; });
        renderer.setRenderTarget(rt);
        // albedo background: a dark leaf-ish colour so mip-mapped edges don't halo white
        renderer.setClearColor(key === 'albedo' ? 0x2a3a1c : 0x80ff80, 0);
        rt.scissorTest = false;
        renderer.setRenderTarget(rt);
        renderer.clear();
        renderer.setScissorTest(true);
        for (let f = 0; f < FRAMES; f++) {
          const a = (f / FRAMES) * Math.PI * 2;
          cam.position.set(Math.sin(a) * T.radius * 3, 0, Math.cos(a) * T.radius * 3);
          cam.lookAt(0, 0, 0);
          cam.updateMatrixWorld();
          rt.viewport.set(f * FRAME_PX, 0, FRAME_PX, FRAME_PX);
          rt.scissor.set(f * FRAME_PX, 0, FRAME_PX, FRAME_PX);
          rt.scissorTest = true; // render targets carry their own scissor state
          renderer.setRenderTarget(rt);
          renderer.render(scene, cam);
        }
      }
      renderer.setScissorTest(prev.sc);
      renderer.setRenderTarget(prev.target);
      renderer.setClearColor(prev.clear, prev.alpha);
      renderer.toneMapping = prev.tm;
      scene.traverse((o) => { if (o.userData.mats) { o.userData.mats.albedo.dispose(); o.userData.mats.normal.dispose(); } });
      const geo = new THREE.PlaneGeometry(w, h);
      geo.translate(0, h / 2, 0);
      const mat = new THREE.ShaderMaterial({
        uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uAlbedo: { value: null }, uNormal: { value: null }, uFrames: { value: FRAMES } }]),
        vertexShader: IMPOSTOR_VERT,
        fragmentShader: IMPOSTOR_FRAG,
        fog: true,
      });
      mat.uniforms.uAlbedo.value = rtA.texture;
      mat.uniforms.uNormal.value = rtN.texture;
      for (const k of Object.keys(floraUniforms)) mat.uniforms[k] = floraUniforms[k];
      T.impostor = { geo, mat, rtA, rtN };
    }
  }

  // Instanced impostors for a list of [x, y, z, yaw, scale]
  impostorMesh(name, list) {
    const T = this.types[name];
    const im = new THREE.InstancedMesh(T.impostor.geo, T.impostor.mat, list.length);
    for (let i = 0; i < list.length; i++) {
      const [x, y, z, ry, sc] = list[i];
      _q.setFromAxisAngle(_up, ry);
      im.setMatrixAt(i, _m.compose(_p.set(x, y, z), _q, _s.setScalar(sc)));
    }
    im.computeBoundingSphere();
    im.frustumCulled = true;
    return im;
  }

  // Real meshes for the trees close to the camera, refilled as the camera moves
  initNear(scene, all, shadows) {
    this.all = all; // name -> [[x,y,z,ry,sc]]
    this.near = {};
    this.grid = {};
    const G = 64;
    this.cellSize = G;
    for (const [name, list] of Object.entries(all)) {
      const grid = new Map();
      for (const t of list) {
        const k = Math.floor(t[0] / G) + ',' + Math.floor(t[2] / G);
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(t);
      }
      this.grid[name] = grid;
      const cap = 160;
      this.near[name] = this.types[name].parts.map((p) => {
        const im = new THREE.InstancedMesh(p.geometry, p.material, cap);
        im.count = 0;
        im.castShadow = shadows;
        im.receiveShadow = true;
        im.frustumCulled = false;
        scene.add(im);
        return im;
      });
    }
    this.lastRefill = new THREE.Vector3(1e9, 0, 1e9);
  }

  update(camPos, sky) {
    if (sky) {
      floraUniforms.uSunDir.value.copy(sky.lightDir);
      floraUniforms.uSunCol.value.copy(sky.sun.color).multiplyScalar(sky.sun.intensity * 0.55);
      floraUniforms.uSky.value.copy(sky.hemi.color).multiplyScalar(sky.hemi.intensity * 0.6);
      floraUniforms.uGround.value.copy(sky.hemi.groundColor).multiplyScalar(sky.hemi.intensity * 0.6);
    }
    if (!this.near || camPos.distanceToSquared(this.lastRefill) < 16) return;
    this.lastRefill.copy(camPos);
    const R = floraUniforms.uNear.value + 8, G = this.cellSize;
    const i0 = Math.floor((camPos.x - R) / G), i1 = Math.floor((camPos.x + R) / G);
    const j0 = Math.floor((camPos.z - R) / G), j1 = Math.floor((camPos.z + R) / G);
    for (const [name, meshes] of Object.entries(this.near)) {
      const grid = this.grid[name];
      let n = 0;
      const cap = meshes[0].instanceMatrix.count;
      for (let i = i0; i <= i1 && n < cap; i++) for (let j = j0; j <= j1 && n < cap; j++) {
        const cell = grid.get(i + ',' + j);
        if (!cell) continue;
        for (const t of cell) {
          const dx = t[0] - camPos.x, dz = t[2] - camPos.z;
          if (dx * dx + dz * dz > R * R || n >= cap) continue;
          _q.setFromAxisAngle(_up, t[3]);
          _m.compose(_p.set(t[0], t[1], t[2]), _q, _s.setScalar(t[4]));
          for (const im of meshes) im.setMatrixAt(n, _m);
          n++;
        }
      }
      for (const im of meshes) { im.count = n; im.instanceMatrix.needsUpdate = true; }
    }
  }
}

export const flora = new Flora();
export const TREE_TYPES = ['island_tree_01', 'island_tree_02', 'island_tree_03', 'tree_small_02'];
