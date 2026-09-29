// Scanned CC0 props from Poly Haven (barrels, crates, cannon, lanterns, chest, ferns, rocks…), built into
// public/models/props/ by tools/build-props.mjs. World code asks for placements; they are batched into
// one InstancedMesh per prop and cluster, so a whole harbour's worth of barrels costs a few draw calls.
// If the files are missing the game keeps its procedural stand-ins (see `has`).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const FILES = [
  'wine_barrel_01', 'wooden_crate_01', 'wooden_crate_02', 'old_military_crate', 'wooden_bucket_01',
  'wooden_lantern_01', 'treasure_chest', 'cannon_01', 'jug_01', 'wicker_basket_01', 'lambis_shell', 'fern_02',
  'shrub_sorrel_01', 'tree_stump_01', 'coast_rocks_01', 'wooden_ladder', 'wooden_handle_saber', 'machete', 'hatchet',
];

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _p = new THREE.Vector3();

// position, yaw, uniform scale (+ optional pitch/roll) -> matrix
export function PM(x, y, z, ry = 0, s = 1, rx = 0, rz = 0) {
  _e.set(rx, ry, rz, 'YXZ');
  return new THREE.Matrix4().compose(_p.set(x, y, z), _q.setFromEuler(_e), _s.setScalar(s));
}

// Poly Haven blades: where the grip centre sits along the model's +Y blade axis, and which Z side is the edge
const WEAPONS = {
  wooden_handle_saber: { grip: -0.035, edge: -1 },
  machete: { grip: -0.11, edge: -1 },
  hatchet: { grip: 0.02, edge: 1 },
};

class Props {
  constructor() {
    this.parts = {}; // name -> [{ geometry, material }]
    this.queue = new Map(); // cluster -> name -> [Matrix4]
    this.groups = [];
    this.lamps = [];
  }

  async load(base = './models/props/') {
    const loader = new GLTFLoader();
    await Promise.all(FILES.map(async (name) => {
      try {
        const gltf = await loader.loadAsync(base + name + '.glb');
        gltf.scene.updateMatrixWorld(true);
        const list = [];
        gltf.scene.traverse((o) => {
          if (!o.isMesh) return;
          const geometry = o.geometry.clone().applyMatrix4(o.matrixWorld);
          geometry.morphAttributes = {}; // instancing can't drive shape keys (some scans ship with them)
          const material = o.material;
          if (material.map) material.map.anisotropy = 4;
          if (material.transparent) { material.depthWrite = false; }
          // lantern panes: lit from within after dusk (see setNight)
          if (/glass/i.test(material.name)) {
            material.emissive = new THREE.Color('#ffb454');
            material.emissiveIntensity = 0;
            this.lamps.push(material);
          }
          list.push({ geometry, material });
        });
        if (list.length) this.parts[name] = list;
      } catch (e) { /* optional asset */ }
    }));
    return this;
  }

  has(name) { return !!this.parts[name]; }

  // queue an instance; `cluster` groups instances that are culled together (a town, a camp)
  place(name, matrix, cluster = 'world') {
    if (!this.parts[name]) return false;
    if (!this.queue.has(cluster)) this.queue.set(cluster, new Map());
    const c = this.queue.get(cluster);
    if (!c.has(name)) c.set(name, []);
    c.get(name).push(matrix);
    return true;
  }

  // a standalone copy (e.g. a dug-up chest)
  object(name) {
    if (!this.parts[name]) return null;
    const g = new THREE.Group();
    for (const p of this.parts[name]) {
      const m = new THREE.Mesh(p.geometry, p.material);
      m.castShadow = !p.material.transparent;
      m.receiveShadow = true;
      g.add(m);
    }
    return g;
  }

  // a hand weapon re-oriented to the game's convention: grip centre at the origin, blade along -Y, edge +X
  weapon(name) {
    const W = WEAPONS[name];
    const o = W && this.object(name);
    if (!o) return null;
    o.position.y = -W.grip;
    const g = new THREE.Group();
    g.add(o);
    // model +Y (blade) -> -Y, then the edge side -> +X
    g.quaternion.setFromEuler(new THREE.Euler(Math.PI, W.edge > 0 ? -Math.PI / 2 : Math.PI / 2, 0, 'YXZ'));
    const outer = new THREE.Group();
    outer.add(g);
    return outer;
  }

  // turn queued placements into instanced meshes
  flush(scene, { shadows = true, viewDist = 900 } = {}) {
    for (const [cluster, byName] of this.queue) {
      const group = new THREE.Group();
      group.name = 'props_' + cluster;
      const center = new THREE.Vector3();
      let n = 0;
      for (const [name, mats] of byName) {
        for (const p of this.parts[name]) {
          const im = new THREE.InstancedMesh(p.geometry, p.material, mats.length);
          mats.forEach((m, i) => im.setMatrixAt(i, m));
          im.castShadow = shadows && !p.material.transparent;
          im.receiveShadow = true;
          im.computeBoundingSphere();
          group.add(im);
        }
        for (const m of mats) { center.x += m.elements[12]; center.z += m.elements[14]; n++; }
      }
      group.userData.center = center.divideScalar(Math.max(1, n));
      group.userData.viewDist = viewDist;
      scene.add(group);
      this.groups.push(group);
    }
    this.queue.clear();
  }

  setNight(n) {
    for (const m of this.lamps) m.emissiveIntensity = Math.max(0, n - 0.3) * 6;
  }

  update(camPos) {
    for (const g of this.groups) {
      const c = g.userData.center, d = g.userData.viewDist;
      const dx = c.x - camPos.x, dz = c.z - camPos.z;
      g.visible = dx * dx + dz * dz < d * d;
    }
  }
}

export const props = new Props();
