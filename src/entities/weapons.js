// Museum-scanned period weapons (Sketchfab, CC-BY; see public/models/weapons/CREDITS.md), normalised to the
// convention the hand grips use: grip centre at the origin, blade / barrel along -Y, cutting edge (or the
// lock side) along +X, real-world length in metres.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// per model: real length in metres; `tip`: the file axis running from grip to blade tip / muzzle; swords give
// `edge` (file axis the cutting edge faces), guns give `down` (file axis the butt / trigger hangs towards);
// `grip`: where the hand sits along the length (0 = pommel / butt end, 1 = tip)
export const WEAPON_MODELS = {
  cutlass: { file: 'cutlass.glb', length: 0.86, tip: '+z', edge: '+x', grip: 0.07 },
  basket_sword: { file: 'basket_sword.glb', length: 1.0, tip: '+z', edge: '+x', grip: 0.06 },
  pistol: { file: 'pistol.glb', length: 0.48, tip: '-x', down: '-y', grip: 0.12 },
  musket: { file: 'musket.glb', length: 1.55, tip: '+x', down: '-y', grip: 0.2 },
};

const AXES = { '+x': [1, 0, 0], '-x': [-1, 0, 0], '+y': [0, 1, 0], '-y': [0, -1, 0], '+z': [0, 0, 1], '-z': [0, 0, -1] };

class Weapons {
  constructor() { this.raw = {}; this.ready = {}; }

  async load(base = './models/weapons/') {
    const loader = new GLTFLoader();
    await Promise.all(Object.entries(WEAPON_MODELS).map(async ([name, cfg]) => {
      try {
        const gltf = await loader.loadAsync(base + cfg.file);
        this.raw[name] = gltf.scene;
        this.ready[name] = this.normalise(gltf.scene, cfg);
      } catch (e) { /* optional */ }
    }));
    return this;
  }

  normalise(scene, cfg) {
    scene.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(scene);
    const size = box.getSize(new THREE.Vector3());
    const tip = new THREE.Vector3(...AXES[cfg.tip]);
    const len = Math.abs(size.dot(tip));
    const s = cfg.length / len;
    // grip centre in file space: along the length axis from the grip end, centred on the other axes
    const c = box.getCenter(new THREE.Vector3());
    const gripEnd = c.clone().addScaledVector(tip, -len / 2);
    const grip = gripEnd.addScaledVector(tip, len * cfg.grip);
    // rotation taking tip -> -Y and the edge -> +X (swords) or the butt -> +Z (guns)
    const Y = tip.clone().negate();
    let X, Z;
    if (cfg.edge) { X = new THREE.Vector3(...AXES[cfg.edge]); Z = new THREE.Vector3().crossVectors(X, Y); }
    else { Z = new THREE.Vector3(...AXES[cfg.down]); X = new THREE.Vector3().crossVectors(Y, Z); }
    const basis = new THREE.Matrix4().makeBasis(X, Y, Z).invert(); // file axes -> game axes
    const inner = new THREE.Group();
    const model = scene.clone(true);
    model.position.copy(grip).negate();
    inner.add(model);
    inner.quaternion.setFromRotationMatrix(basis);
    inner.scale.setScalar(s);
    const outer = new THREE.Group();
    outer.add(inner);
    outer.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    return outer;
  }

  has(name) { return !!this.ready[name]; }
  create(name) { return this.ready[name] ? this.ready[name].clone(true) : null; }
}

export const weapons = new Weapons();
