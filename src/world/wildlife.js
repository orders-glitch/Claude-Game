// Frigatebirds and gulls wheeling over the coasts and following ships.
import * as THREE from 'three';

const COUNT = 36;

function birdGeometry() {
  // body + two swept wings; wing vertices carry |x| used for flapping
  const v = [
    // left wing
    0, 0, -0.35, -1.6, 0.05, 0.25, 0, 0, 0.35,
    -1.6, 0.05, 0.25, -2.4, 0.0, 0.65, 0, 0, 0.35,
    // right wing
    0, 0, -0.35, 0, 0, 0.35, 1.6, 0.05, 0.25,
    1.6, 0.05, 0.25, 0, 0, 0.35, 2.4, 0.0, 0.65,
    // body
    0, 0.08, -0.7, -0.12, 0, 0.6, 0.12, 0, 0.6,
    // tail
    0, 0, 0.5, -0.3, 0, 1.1, 0.3, 0, 1.1,
  ];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.computeVertexNormals();
  return g;
}

export class Wildlife {
  constructor(scene, terrain) {
    this.terrain = terrain;
    const mat = new THREE.MeshStandardMaterial({ color: '#2a2622', roughness: 0.9, side: THREE.DoubleSide });
    this.uniforms = { uTime: { value: 0 } };
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.uniforms.uTime;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          float ph = instanceMatrix[3].x * 0.37 + instanceMatrix[3].z * 0.11;
          float span = abs(position.x);
          transformed.y += sin(uTime * 5.5 + ph) * span * 0.45 * step(0.2, span);`);
    };
    this.mesh = new THREE.InstancedMesh(birdGeometry(), mat, COUNT);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    scene.add(this.mesh);
    this.birds = [];
    for (let i = 0; i < COUNT; i++) this.birds.push({ cx: 0, cz: 0, r: 30 + Math.random() * 70, h: 25 + Math.random() * 35, a: Math.random() * 6.28, w: (0.2 + Math.random() * 0.25) * (Math.random() < 0.5 ? -1 : 1), bob: Math.random() * 6, timer: 0 });
    this.m = new THREE.Matrix4();
    this.q = new THREE.Quaternion();
    this.e = new THREE.Euler();
    this.s = new THREE.Vector3(1, 1, 1);
    this.p = new THREE.Vector3();
  }

  // pick a place for a flock near the focus: over a coast if there is one, else over the ship
  retarget(b, focus, follow) {
    for (let k = 0; k < 8; k++) {
      const a = Math.random() * Math.PI * 2, d = 80 + Math.random() * 500;
      const x = focus.x + Math.cos(a) * d, z = focus.z + Math.sin(a) * d;
      const h = this.terrain.quickHeight(x, z);
      if (h > -6 && h < 20) { b.cx = x; b.cz = z; b.timer = 20 + Math.random() * 30; return; }
    }
    b.cx = follow.x + (Math.random() - 0.5) * 60; b.cz = follow.z + (Math.random() - 0.5) * 60;
    b.timer = 8 + Math.random() * 10;
  }

  update(dt, focus, night) {
    this.uniforms.uTime.value += dt;
    this.mesh.visible = night < 0.7;
    if (!this.mesh.visible) return;
    for (let i = 0; i < COUNT; i++) {
      const b = this.birds[i];
      b.timer -= dt;
      const far = Math.hypot(b.cx - focus.x, b.cz - focus.z) > 900;
      if (b.timer <= 0 || far) {
        // flocks: birds share centres in groups of six
        const leader = this.birds[i - (i % 6)];
        if (i % 6 === 0 || leader.timer <= 0) this.retarget(b, focus, focus);
        else { b.cx = leader.cx + (Math.random() - 0.5) * 40; b.cz = leader.cz + (Math.random() - 0.5) * 40; b.timer = leader.timer; }
      }
      b.a += b.w * dt;
      b.bob += dt;
      const x = b.cx + Math.cos(b.a) * b.r, z = b.cz + Math.sin(b.a) * b.r;
      const y = b.h + Math.sin(b.bob * 0.7) * 3;
      // heading tangent to the circle
      const yaw = Math.atan2(-(-Math.sin(b.a) * b.w), -(Math.cos(b.a) * b.w));
      this.e.set(0, yaw, -Math.sign(b.w) * 0.35);
      this.q.setFromEuler(this.e);
      this.p.set(x, y, z);
      this.m.compose(this.p, this.q, this.s);
      this.mesh.setMatrixAt(i, this.m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
