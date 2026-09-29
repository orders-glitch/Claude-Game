// Procedural colonial port towns: grid streets (Laws of the Indies for Spanish towns), waterfront,
// tavern, merchant, shipwright, church/governor's house, fort with guns, piers, market stalls and props.
import * as THREE from 'three';
import { Builder, T, gableRoofGeometry, gableEndGeometry, hipRoofGeometry, sharedMaterials } from './builder.js';
import { mulberry32, pick as rpick } from '../core/noise.js';
import { flagTexture } from '../core/textures.js';

const STYLE = {
  spanish: {
    walls: ['#ead9ad', '#f2e9d6', '#e7bba2', '#dcc58c', '#cad8d9', '#f3dcb3', '#e4ab88', '#f0d0b8'],
    roofs: ['#d8a080', '#c99070', '#e0b090'], roofBucket: 'roof', wallBucket: 'wall', storeys: [1, 2, 2], pitch: 0.28, hip: 0.6,
    shutters: ['#3f6b5a', '#6b3a2a', '#355a78', '#7a5a2a'],
  },
  english: {
    walls: ['#a8654a', '#9c5c44', '#e9e2d0', '#d9cfb7', '#b27157', '#e4dccb'],
    roofs: ['#6a625c', '#5c5752', '#7a6a60'], roofBucket: 'roof', wallBucket: 'wall', storeys: [2, 2, 3], pitch: 0.6, hip: 0.2,
    shutters: ['#2c2c2c', '#3d4a3a', '#4a3a2a'],
  },
  french: {
    walls: ['#efe5cf', '#e6d4a8', '#d9e1d4', '#f1dcc4', '#e0cfb2'],
    roofs: ['#b8805e', '#7a6a60', '#c88f6a'], roofBucket: 'roof', wallBucket: 'wall', storeys: [1, 2, 2], pitch: 0.55, hip: 0.7,
    shutters: ['#4f7a95', '#6c8a58', '#2f4f6f'],
  },
  shanty: {
    walls: ['#a0845f', '#8f7552', '#b39873', '#7d6446', '#c2ad8a'],
    roofs: ['#e8dcc0', '#d8caa8'], roofBucket: 'thatch', wallBucket: 'clap', storeys: [1, 1, 1], pitch: 0.55, hip: 0.3,
    shutters: ['#5a4630'],
  },
};

export class Town {
  // port: data from PORTS; terrain: Terrain
  constructor(port, terrain, nation) {
    this.port = port;
    this.terrain = terrain;
    this.nation = nation;
    this.style = STYLE[port.style] || STYLE.spanish;
    this.R = 150 * (port.size || 1);
    this.rand = mulberry32(port.id.split('').reduce((a, c) => a * 31 + c.charCodeAt(0), 7) >>> 0);
    this.colliders = []; // oriented rects in world space for walking characters
    this.platforms = []; // walkable raised surfaces (piers)
    this.shipBlockers = []; // rects ships collide with
    this.doors = [];
    this.streetNodes = [];
    this.guardPosts = [];
    this.lanterns = [];
    this.cannons = [];
    this.lots = [];

    // --- locate coastline & town frame
    const dir = port.dir;
    const sx = -Math.sin(dir), sz = -Math.cos(dir); // seaward
    const c = terrain.findCoast(port.coast[0], port.coast[1], sx, sz);
    this.coast = new THREE.Vector3(c.x, 0, c.z);
    this.dir = dir;
    this.sea = new THREE.Vector2(sx, sz);
    this.right = new THREE.Vector2(-sz, sx); // local +X
    // flatten a plateau inland
    const center = this.toWorld(0, this.R * 0.55);
    this.center = center;
    this.level = 2.6;
    terrain.addZone({ x: center.x, z: center.z, r: this.R * 1.3, level: this.level, dirt: true });
  }

  // local (a along coast, b inland) -> world
  toWorld(a, b, y = 0) {
    return new THREE.Vector3(
      this.coast.x + this.right.x * a - this.sea.x * b,
      y,
      this.coast.z + this.right.y * a - this.sea.y * b,
    );
  }

  groundAt(a, b) {
    const w = this.toWorld(a, b);
    return this.terrain.height(w.x, w.z);
  }

  isLandLot(a, b, hw, hd) {
    for (const [da, db] of [[-hw, -hd], [hw, -hd], [-hw, hd], [hw, hd], [0, 0]]) {
      const w = this.toWorld(a + da, b + db);
      if (this.terrain.baseHeight(w.x, w.z) < 0.9) return false;
      if (this.terrain.height(w.x, w.z) > this.level + 3.5) return false;
    }
    return true;
  }

  overlapsLots(a, b, hw, hd, pad = 1.5) {
    for (const l of this.lots) {
      if (Math.abs(a - l.a) < hw + l.hw + pad && Math.abs(b - l.b) < hd + l.hd + pad) return true;
    }
    return false;
  }

  reserve(a, b, hw, hd) { this.lots.push({ a, b, hw, hd }); }

  addCollider(a, b, hw, hd, rot = 0) {
    const w = this.toWorld(a, b);
    const ang = this.dir + rot; // local axes rotate with town
    this.colliders.push({ x: w.x, z: w.z, hw, hd, cos: Math.cos(ang), sin: Math.sin(ang) });
  }

  // ---------------------------------------------------------------- build
  build(scene) {
    const B = new Builder();
    this.B = B;
    const st = this.style;
    const rnd = this.rand;
    const R = this.R;

    // ---- pier(s)
    this.buildPier(B, 0);
    if (this.port.size > 1.1) this.buildPier(B, -R * 0.45, true);

    // ---- key buildings
    this.placeSpecial('tavern', 26, 30, 8, 6.5);
    this.placeSpecial('merchant', -26, 30, 9, 7);
    this.placeSpecial('shipwright', -R * 0.62, 20, 11, 8);
    this.placeSpecial('governor', 0, 100, 12, 9);
    this.placeFort(B);

    // plaza / market
    this.reserve(0, 64, 22, 18);
    if (this.isLandLot(0, 64, 10, 10)) this.buildMarket(B, 0, 64);

    // ---- streets grid & ordinary houses
    const streetsA = [0, -R * 0.4, R * 0.4];
    const streetsB = [16, 64, 100, 140];
    const isStreet = (a, b, hw, hd) => {
      for (const sa of streetsA) if (Math.abs(a - sa) < hw + 5) return true;
      for (const sb of streetsB) if (Math.abs(b - sb) < hd + 5) return true;
      return false;
    };
    const shanty = this.port.style === 'shanty';
    for (let b = 26; b < R * 1.3; b += shanty ? 14 : 13) {
      for (let a = -R * 1.1; a < R * 1.1; a += shanty ? 15 : 12.5) {
        const hw = 3.5 + rnd() * 2.8, hd = 3.2 + rnd() * 2.2;
        const ja = a + (rnd() - 0.5) * (shanty ? 8 : 1.5), jb = b + (rnd() - 0.5) * (shanty ? 8 : 1.5);
        if (Math.hypot(ja, jb - R * 0.55) > R * 1.2) continue;
        if (!shanty && isStreet(ja, jb, hw, hd)) continue;
        if (shanty && (Math.abs(ja) < 7 || rnd() < 0.3)) continue;
        if (this.overlapsLots(ja, jb, hw, hd)) continue;
        if (!this.isLandLot(ja, jb, hw, hd)) continue;
        const rot = shanty ? (rnd() - 0.5) * 0.5 : 0;
        this.reserve(ja, jb, hw, hd);
        this.buildHouse(B, ja, jb, hw * 2, hd * 2, rot, rpick(st.storeys));
      }
    }

    // ---- street nodes for pedestrians (inland of waterfront)
    for (const sb of streetsB) {
      for (let a = -R; a <= R; a += 20) {
        const w = this.toWorld(a, sb);
        const h = this.terrain.height(w.x, w.z);
        if (h > 0.8 && h < this.level + 3 && !this.blocked(w.x, w.z, 1)) this.streetNodes.push(new THREE.Vector3(w.x, h, w.z));
      }
    }
    for (const sa of streetsA) {
      for (let b = 20; b <= R * 1.3; b += 20) {
        const w = this.toWorld(sa, b);
        const h = this.terrain.height(w.x, w.z);
        if (h > 0.8 && h < this.level + 3 && !this.blocked(w.x, w.z, 1)) this.streetNodes.push(new THREE.Vector3(w.x, h, w.z));
      }
    }

    // ---- scattered props along the waterfront
    for (let i = 0; i < 26; i++) {
      const a = (rnd() - 0.5) * R * 1.6, b = 8 + rnd() * 10;
      if (!this.isLandLot(a, b, 1, 1) || this.overlapsLots(a, b, 1, 1, 0.5)) continue;
      const y = this.groundAt(a, b);
      if (rnd() < 0.55) {
        const n = 1 + Math.floor(rnd() * 4);
        for (let k = 0; k < n; k++) this.barrel(B, a + (k % 2) * 1.1, y, b + Math.floor(k / 2) * 1.1);
        this.addCollider(a + 0.5, b + 0.5, 1.3, 1.3);
      } else {
        const s = 1 + rnd() * 0.5;
        B.box('wood', s, s, s, T(a, y + s / 2, b, rnd()), '#a78a62');
        if (rnd() < 0.5) B.box('wood', s * 0.8, s * 0.8, s * 0.8, T(a + 0.1, y + s * 1.4, b, rnd()), '#9c7f58');
        this.addCollider(a, b, s * 0.6, s * 0.6);
      }
    }
    // lantern posts
    for (let i = 0; i < 10; i++) {
      const a = -R * 0.8 + (i / 9) * R * 1.6, b = 20;
      if (!this.isLandLot(a, b, 0.5, 0.5) || this.overlapsLots(a, b, 0.5, 0.5, 0.2)) continue;
      const y = this.groundAt(a, b);
      B.cyl('wood', 0.09, 0.12, 3.6, 5, T(a, y + 1.8, b), '#3a2a1a');
      B.box('metal', 0.45, 0.6, 0.45, T(a, y + 3.8, b), '#222');
      B.box('glow', 0.3, 0.4, 0.3, T(a, y + 3.8, b), '#ffcf80');
      this.lanterns.push(this.toWorld(a, b, y + 3.8));
    }

    // ---- flag over the fort / governor's house
    const materials = sharedMaterials();
    const group = B.build(materials);
    group.position.set(this.coast.x, 0, this.coast.z);
    group.rotation.y = this.dir;
    group.name = 'town_' + this.port.id;
    // Local builder coordinates: x=a (along coast, but sign flipped by rotation), z=b inland.
    scene.add(group);
    this.group = group;

    if (this.flagPos) {
      const tex = flagTexture(this.nation.flag);
      const fg = new THREE.PlaneGeometry(6, 3.75, 8, 4);
      fg.translate(3, 0, 0);
      const flag = new THREE.Mesh(fg, new THREE.MeshStandardMaterial({ map: tex, side: THREE.DoubleSide, roughness: 0.9 }));
      flag.position.copy(this.flagPos);
      scene.add(flag);
      this.flag = flag;
      this.flagGeoBase = fg.attributes.position.array.slice();
    }
    return group;
  }

  // In builder local frame the group is rotated by `dir`. With rotation.y = dir, local +Z maps to
  // (sin dir, cos dir) = -seaward (inland) ✓ and local +X maps to (cos dir, -sin dir) = right ✓.

  blocked(x, z, r = 0.4) {
    for (const c of this.colliders) {
      const dx = x - c.x, dz = z - c.z;
      const lx = dx * c.cos - dz * c.sin;
      const lz = dx * c.sin + dz * c.cos;
      if (Math.abs(lx) < c.hw + r && Math.abs(lz) < c.hd + r) return true;
    }
    return false;
  }

  buildPier(B, a0, secondary = false) {
    // walk seaward until deep water
    let len = 30;
    for (; len < 170; len += 5) {
      const w = this.toWorld(a0, -len);
      if (this.terrain.height(w.x, w.z) < -5) break;
    }
    len += secondary ? 10 : 22;
    const width = secondary ? 5 : 7;
    const deckY = 2.2;
    // deck planks
    B.box('wood', width, 0.35, len + 6, T(a0, deckY, -len / 2 + 3), '#8d6c49');
    for (let z = 3; z > -len; z -= 4.5) {
      for (const s of [-1, 1]) {
        B.cyl('wood', 0.28, 0.32, 9, 6, T(a0 + s * (width / 2 - 0.2), deckY - 4.3, z), '#4d3a28');
      }
    }
    // bollards and rails
    for (let z = -6; z > -len; z -= 9) {
      B.cyl('wood', 0.22, 0.26, 0.9, 6, T(a0 + width / 2 - 0.4, deckY + 0.6, z), '#3a2c1e');
      B.cyl('wood', 0.22, 0.26, 0.9, 6, T(a0 - width / 2 + 0.4, deckY + 0.6, z), '#3a2c1e');
    }
    // T-head at the end
    const endZ = -len + 3;
    B.box('wood', width * 3.2, 0.35, 7, T(a0, deckY, endZ), '#8a6946');
    for (const s of [-1, 0, 1]) B.cyl('wood', 0.3, 0.34, 9, 6, T(a0 + s * width * 1.4, deckY - 4.3, endZ), '#4d3a28');
    // barrels on pier
    this.barrel(B, a0 + 1.6, deckY + 0.17, -6);
    this.barrel(B, a0 + 2.4, deckY + 0.17, -7.2);

    const mid = this.toWorld(a0, -len / 2 + 3);
    const ang = this.dir;
    const rect = { x: mid.x, z: mid.z, hw: width / 2, hd: (len + 6) / 2, cos: Math.cos(ang), sin: Math.sin(ang), y: deckY + 0.18 };
    this.platforms.push(rect);
    const endW = this.toWorld(a0, endZ);
    this.platforms.push({ x: endW.x, z: endW.z, hw: width * 1.6, hd: 3.5, cos: rect.cos, sin: rect.sin, y: deckY + 0.18 });
    this.shipBlockers.push({ ...rect, hw: rect.hw + 1, hd: rect.hd });
    this.shipBlockers.push({ x: endW.x, z: endW.z, hw: width * 1.6 + 1, hd: 4, cos: rect.cos, sin: rect.sin });
    if (!secondary) {
      this.pierLen = len;
      // where the player ship moors: alongside the pier head, parallel to the pier
      const berth = this.toWorld(a0 + width * 1.6 + 9, endZ + 4);
      this.berth = { x: berth.x, z: berth.z, heading: this.dir };
      this.pierEnd = this.toWorld(a0 + width * 1.2, endZ, deckY + 0.2);
      this.doors.push({ type: 'board', label: 'Board your ship', pos: this.pierEnd.clone() });
      this.spawnPoint = this.toWorld(a0, -8, deckY + 0.2);
    }
  }

  barrel(B, a, y, b) {
    B.cyl('wood', 0.42, 0.42, 1.1, 10, T(a, y + 0.55, b), '#7a5a38');
    B.cyl('metal', 0.44, 0.44, 0.08, 10, T(a, y + 0.25, b), '#2a2a2a');
    B.cyl('metal', 0.44, 0.44, 0.08, 10, T(a, y + 0.85, b), '#2a2a2a');
  }

  // find a land position near (a,b), shifting inland if needed
  settle(a, b, hw, hd) {
    for (let k = 0; k < 20; k++) {
      if (this.isLandLot(a, b, hw, hd) && !this.overlapsLots(a, b, hw, hd)) return { a, b };
      b += 6;
    }
    for (let k = 0; k < 20; k++) {
      const ta = a + (this.rand() - 0.5) * 80, tb = 20 + this.rand() * this.R;
      if (this.isLandLot(ta, tb, hw, hd) && !this.overlapsLots(ta, tb, hw, hd)) return { a: ta, b: tb };
    }
    return { a, b };
  }

  placeSpecial(type, a, b, hw, hd) {
    const s = this.settle(a, b, hw, hd);
    a = s.a; b = s.b;
    this.reserve(a, b, hw, hd);
    const B = this.B;
    const st = this.style;
    const y = this.groundAt(a, b);
    const labels = {
      tavern: { spanish: 'Taberna', english: 'Tavern', french: 'Cabaret', shanty: 'Tavern' },
      merchant: { spanish: 'Almacén (Merchant)', english: 'Merchant\'s Warehouse', french: 'Négociant (Merchant)', shanty: 'Fence & Trader' },
      shipwright: { spanish: 'Astillero (Shipwright)', english: 'Shipwright', french: 'Charpentier (Shipwright)', shanty: 'Careening Beach' },
      governor: { spanish: 'Casa del Gobernador', english: 'Governor\'s House', french: 'Maison du Gouverneur', shanty: 'Council of Captains' },
    };
    let doorB = b - hd - 0.8;
    if (type === 'shipwright') {
      // open-sided timber shed with a hull on the stocks
      for (const sa of [-1, 1]) for (const sb of [-1, 0, 1]) B.box('wood', 0.5, 7, 0.5, T(a + sa * hw, y + 3.5, b + sb * hd), '#5a4330');
      B.add(st.roofBucket === 'thatch' ? 'thatch' : 'roof', gableRoofGeometry(hd * 2, hw * 2, 3, 0.8), T(a, y + 7, b, Math.PI / 2), st.roofs[0]);
      // hull on stocks
      const hull = new THREE.SphereGeometry(1, 16, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
      B.add('wood', hull, T(a, y + 3.2, b, 0, 2.4, 2.6, hd * 0.9), '#6b4a2e');
      for (let k = -2; k <= 2; k++) B.box('wood', 5.5, 0.12, 0.2, T(a, y + 2.4 + Math.abs(k) * 0.1, b + k * hd * 0.35, 0, 1, 1, 1, 0, 0), '#8a6a48');
      for (let k = 0; k < 6; k++) B.box('wood', 0.4, 0.4, 6, T(a + hw - 2 + k * 0.45, y + 0.2 + (k % 2) * 0.4, b - 2, 0.1), '#9a7a52');
      this.addCollider(a, b, 3, hd * 0.9);
      doorB = b - hd - 1;
    } else if (type === 'governor') {
      const storeys = 2;
      this.buildHouse(B, a, b, hw * 2, hd * 2, 0, storeys, { grand: true });
      // church/bell tower beside it
      const ta = a + hw + 6;
      if (this.isLandLot(ta, b, 4, 4)) {
        const ty = this.groundAt(ta, b);
        B.box(st.wallBucket === 'clap' ? 'clap' : 'wall', 7, 18, 7, T(ta, ty + 9, b), st.walls[1]);
        B.add(st.roofBucket, hipRoofGeometry(7, 7, st.pitch > 0.5 ? 9 : 4, 0.3), T(ta, ty + 18, b), st.roofs[0]);
        B.box('window', 1.8, 2.5, 7.1, T(ta, ty + 15, b), '#1a140e');
        B.box('window', 7.1, 2.5, 1.8, T(ta, ty + 15, b), '#1a140e');
        B.box('wood', 0.25, 2.2, 0.25, T(ta, ty + (st.pitch > 0.5 ? 28 : 23), b), '#2a2016');
        B.box('wood', 1.2, 0.25, 0.25, T(ta, ty + (st.pitch > 0.5 ? 28.5 : 23.5), b), '#2a2016');
        this.addCollider(ta, b, 3.6, 3.6);
        this.reserve(ta, b, 4, 4);
      }
      if (!this.flagPos) {
        B.cyl('wood', 0.12, 0.16, 12, 6, T(a, y + 6 + 11, b), '#3a2a1a');
        this.flagPos = this.toWorld(a, b, y + 22);
      }
    } else {
      const storeys = type === 'tavern' ? 2 : 2;
      this.buildHouse(B, a, b, hw * 2, hd * 2, 0, storeys, { sign: type });
    }
    const door = this.toWorld(a, doorB, y + 0.2);
    this.doors.push({ type, label: labels[type][this.port.style] || type, pos: door });
    if (type === 'tavern' || type === 'governor') this.guardPosts.push(this.toWorld(a + hw + 2, doorB - 2, y));
  }

  buildHouse(B, a, b, w, d, rot, storeys, opts = {}) {
    const st = this.style;
    const rnd = this.rand;
    const y0 = Math.min(this.groundAt(a - w / 2, b - d / 2), this.groundAt(a + w / 2, b + d / 2), this.groundAt(a, b)) - 0.4;
    const storeyH = this.port.style === 'shanty' ? 3.2 : 3.6;
    const H = storeys * storeyH + (opts.grand ? 1.5 : 0);
    const wallCol = opts.grand ? st.walls[1] : rpick(st.walls);
    const roofCol = rpick(st.roofs);
    const wallB = st.wallBucket;
    const m = (x, y, z, ry = 0, sx = 1, sy = 1, sz = 1) => {
      // rotate local house coords by rot around (a,b)
      const c = Math.cos(rot), s = Math.sin(rot);
      return T(a + x * c + z * s, y, b - x * s + z * c, ry + rot, sx, sy, sz);
    };
    // plinth
    B.box('stone', w + 0.4, 1.4, d + 0.4, m(0, y0 + 0.3, 0), '#b8ae9c');
    // walls
    B.box(wallB, w, H, d, m(0, y0 + 1 + H / 2, 0), wallCol);
    // string course between storeys
    if (storeys > 1 && wallB !== 'clap') B.box('wall', w + 0.2, 0.25, d + 0.2, m(0, y0 + 1 + storeyH, 0), '#f4ecdc');
    // roof
    const top = y0 + 1 + H;
    const pitchH = Math.min(w, d) * st.pitch;
    if (rnd() < st.hip) {
      B.add(st.roofBucket, hipRoofGeometry(w, d, pitchH, 0.6), m(0, top - 0.05, 0), roofCol);
    } else {
      const along = w >= d;
      const rw = along ? w : d, rd = along ? d : w;
      const r = along ? 0 : Math.PI / 2;
      B.add(st.roofBucket, gableRoofGeometry(rw, rd, pitchH, 0.6), m(0, top - 0.05, 0, r), roofCol);
      for (const s of [-1, 1]) {
        const ge = gableEndGeometry(rd, pitchH * (rd / 2) / (rd / 2 + 0.6));
        const ex = s * rw / 2;
        B.add(wallB, ge, along ? m(ex, top - 0.05, 0, s > 0 ? 0 : Math.PI) : m(0, top - 0.05, ex, s > 0 ? -Math.PI / 2 : Math.PI / 2), wallCol);
      }
      if (st === STYLE.english && rnd() < 0.8) {
        B.box('stone', 1.2, pitchH + 2.2, 1.2, m((along ? 1 : 0) * (rw / 2 - 1), top + pitchH / 2 + 0.6, (along ? 0 : 1) * (rw / 2 - 1)), '#8a5a44');
      }
    }
    // windows & door on the street (front, -z) and back faces
    const shutter = rpick(st.shutters);
    const winW = 1.1, winH = st === STYLE.english ? 1.8 : 1.6;
    for (let s = 0; s < storeys; s++) {
      const wy = y0 + 1 + s * storeyH + storeyH * 0.55;
      const n = Math.max(1, Math.floor(w / 3.2));
      for (let i = 0; i < n; i++) {
        const wx = -w / 2 + (i + 0.5) * (w / n);
        if (s === 0 && i === Math.floor(n / 2)) continue; // door slot
        for (const face of [-1, 1]) {
          const lit = rnd() < 0.45;
          B.box(lit ? 'windowLit' : 'window', winW, winH, 0.12, m(wx, wy, face * (d / 2 + 0.02)), '#1d1812');
          B.box('wood', 0.35, winH, 0.08, m(wx - winW / 2 - 0.2, wy, face * (d / 2 + 0.07), 0), shutter);
          B.box('wood', 0.35, winH, 0.08, m(wx + winW / 2 + 0.2, wy, face * (d / 2 + 0.07), 0), shutter);
        }
      }
      const nd = Math.max(1, Math.floor(d / 3.5));
      for (let i = 0; i < nd; i++) {
        const wz = -d / 2 + (i + 0.5) * (d / nd);
        for (const face of [-1, 1]) {
          const lit = rnd() < 0.4;
          B.box(lit ? 'windowLit' : 'window', 0.12, winH, winW, m(face * (w / 2 + 0.02), wy, wz), '#1d1812');
        }
      }
      // balconies on Spanish/French upper floors
      if (s > 0 && (st === STYLE.spanish || st === STYLE.french) && rnd() < 0.6) {
        B.box('wood', w * 0.6, 0.2, 1.2, m(0, y0 + 1 + s * storeyH, -d / 2 - 0.6), '#5a4230');
        B.box('wood', w * 0.6, 0.9, 0.08, m(0, y0 + 1.45 + s * storeyH, -d / 2 - 1.18), '#4a3424');
      }
    }
    // door
    const doorX = -w / 2 + (Math.floor(Math.max(1, Math.floor(w / 3.2)) / 2) + 0.5) * (w / Math.max(1, Math.floor(w / 3.2)));
    B.box('wood', 1.5, 2.6, 0.2, m(doorX, y0 + 1 + 1.3, -d / 2 - 0.05), '#4a3120');
    if (opts.grand) {
      for (const s of [-1, 1]) B.cyl('wall', 0.35, 0.4, 5, 10, m(doorX + s * 1.8, y0 + 3.5, -d / 2 - 1.2), '#f2ead8');
      B.box('wall', 5.5, 0.6, 2.2, m(doorX, y0 + 6.1, -d / 2 - 1.1), '#f2ead8');
    }
    if (opts.sign) {
      B.box('wood', 0.12, 0.12, 1.6, m(doorX + 1.6, y0 + 4.2, -d / 2 - 0.8), '#2a1d12');
      const signCol = opts.sign === 'tavern' ? '#7a2a1a' : opts.sign === 'merchant' ? '#1f4a6a' : '#2f5a2a';
      B.box('wood', 0.08, 1.0, 1.3, m(doorX + 1.6, y0 + 3.5, -d / 2 - 1.2), signCol);
      // tavern lantern
      B.box('glow', 0.3, 0.4, 0.3, m(doorX - 1.3, y0 + 3.6, -d / 2 - 0.4), '#ffcf80');
      this.lanterns.push(this.toWorld(a + doorX - 1.3, b - d / 2 - 0.4, y0 + 3.6));
    }
    // awning over shanty doors
    if (this.port.style === 'shanty' && rnd() < 0.6) {
      B.box('cloth', w * 0.7, 0.05, 2.4, m(0, y0 + 3.2, -d / 2 - 1.2, 0, 1, 1, 1), rpick(['#d8cbb0', '#a8583a', '#6a7a5a']));
      for (const s of [-1, 1]) B.cyl('wood', 0.08, 0.08, 2.4, 4, m(s * w * 0.33, y0 + 1.9, -d / 2 - 2.3), '#4a3a2a');
    }
    this.addCollider(a, b, w / 2 + 0.3, d / 2 + 0.3, rot);
  }

  buildMarket(B, a, b) {
    const rnd = this.rand;
    const y = this.groundAt(a, b);
    // fountain / well
    B.cyl('stone', 2.4, 2.6, 0.9, 16, T(a, y + 0.45, b), '#bfb4a0');
    B.cyl('stone', 0.4, 0.5, 2.2, 8, T(a, y + 1.1, b), '#bfb4a0');
    this.addCollider(a, b, 2.5, 2.5);
    const colors = ['#b5462e', '#d9c7a0', '#3d6a8a', '#c9a13a', '#6f8a4a'];
    for (let i = 0; i < 8; i++) {
      const ang = (i / 8) * Math.PI * 2;
      const sa = a + Math.cos(ang) * 13, sb = b + Math.sin(ang) * 10;
      if (!this.isLandLot(sa, sb, 1.5, 1)) continue;
      const sy = this.groundAt(sa, sb);
      const r = -ang + Math.PI / 2;
      for (const px of [-1.4, 1.4]) for (const pz of [-0.9, 0.9]) {
        const c = Math.cos(r), s = Math.sin(r);
        B.cyl('wood', 0.07, 0.07, 2.4, 4, T(sa + px * c + pz * s, sy + 1.2, sb - px * s + pz * c), '#4a3a2a');
      }
      B.box('wood', 3, 0.15, 1.9, T(sa, sy + 0.95, sb, r), '#7a5a3a');
      B.box('cloth', 3.4, 0.06, 2.4, T(sa, sy + 2.45, sb, r, 1, 1, 1, 0.12), rpick(colors));
      // goods
      for (let k = 0; k < 4; k++) {
        B.box('plain', 0.5, 0.35, 0.5, T(sa + (k - 1.5) * 0.65 * Math.cos(r), sy + 1.2, sb - (k - 1.5) * 0.65 * Math.sin(r), rnd()), rpick(['#c9a24a', '#8a3a2a', '#6a8a3a', '#d8c8a0', '#5a3a1a']));
      }
      this.addCollider(sa, sb, 1.7, 1.1, r);
    }
  }

  placeFort(B) {
    const R = this.R;
    const st = this.style;
    let fa = null;
    for (const cand of [R * 0.85, -R * 0.9, R * 1.05, -R * 1.1, R * 0.6]) {
      if (this.isLandLot(cand, 22, 5, 5) && !this.overlapsLots(cand, 22, 16, 16)) { fa = cand; break; }
    }
    if (fa === null) return;
    const fb = 24;
    this.reserve(fa, fb, 18, 18);
    const y = this.groundAt(fa, fb);
    const ruined = this.port.style === 'shanty';
    const wallH = ruined ? 4 : 7;
    const size = 15;
    const col = ruined ? '#a89f8a' : '#c2b69b';
    // square fort with corner bastions
    for (const [sx, sz, len, rot] of [[0, -size, size * 2, 0], [0, size, size * 2, 0], [-size, 0, size * 2, Math.PI / 2], [size, 0, size * 2, Math.PI / 2]]) {
      const segs = ruined ? 4 : 1;
      for (let k = 0; k < segs; k++) {
        if (ruined && k === 2 && sz < 0) continue; // breach
        const l = len / segs;
        const off = -len / 2 + l * (k + 0.5);
        const h = ruined ? wallH * (0.6 + this.rand() * 0.5) : wallH;
        const cx = fa + sx + (rot ? 0 : off), cz = fb + sz + (rot ? off : 0);
        B.box('stone', rot ? 2.4 : l, h, rot ? l : 2.4, T(cx, y + h / 2 - 0.5, cz), col);
        this.addCollider(cx, cz, rot ? 1.3 : l / 2, rot ? l / 2 : 1.3);
      }
    }
    for (const [cx, cz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const bx = fa + cx * size, bz = fb + cz * size;
      B.box('stone', 7, wallH + 1, 7, T(bx, y + (wallH + 1) / 2 - 0.5, bz, Math.PI / 4), col);
      B.box('stone', 7.6, 0.6, 7.6, T(bx, y + wallH + 0.8, bz, Math.PI / 4), '#b0a58c');
      this.addCollider(bx, bz, 4, 4, Math.PI / 4);
      // cannon on bastion
      const gx = bx + cx * 1.5, gz = bz - 2.4;
      B.cyl('metal', 0.22, 0.34, 3, 8, T(gx, y + wallH + 1.8, gz, 0, 1, 1, 1, Math.PI / 2), '#1c1c1e');
      B.box('wood', 1.4, 0.6, 2.2, T(gx, y + wallH + 1.4, gz + 0.6), '#4a3522');
      this.cannons.push(this.toWorld(gx, gz - 1.5, y + wallH + 1.8));
    }
    // seaward gun line
    for (let k = -2; k <= 2; k++) {
      const gx = fa + k * 5, gz = fb - size - 1.2;
      B.cyl('metal', 0.2, 0.3, 2.6, 8, T(gx, y + wallH + 0.2, gz, 0, 1, 1, 1, Math.PI / 2), '#1c1c1e');
      this.cannons.push(this.toWorld(gx, gz - 1.5, y + wallH + 0.2));
    }
    // flagstaff
    B.cyl('wood', 0.14, 0.2, 16, 6, T(fa, y + 8, fb), '#3a2a1a');
    this.flagPos = this.toWorld(fa, fb, y + 15);
    // barracks inside
    B.box('stone', 12, 4, 6, T(fa, y + 2, fb + 5), '#b8ad94');
    B.add(st.roofBucket, gableRoofGeometry(12, 6, 2, 0.4), T(fa, y + 4, fb + 5), st.roofs[0]);
    this.addCollider(fa, fb + 5, 6.2, 3.2);
    this.guardPosts.push(this.toWorld(fa, fb - 6, y), this.toWorld(fa - 6, fb, y));
    this.fortPos = this.toWorld(fa, fb, y);
  }

  update(dt, t, night) {
    if (this.flag) {
      const p = this.flag.geometry.attributes.position;
      const base = this.flagGeoBase;
      for (let i = 0; i < p.count; i++) {
        const x = base[i * 3];
        p.array[i * 3 + 2] = Math.sin(x * 0.9 - t * 6) * 0.25 * (x / 6);
      }
      p.needsUpdate = true;
      this.flag.geometry.computeVertexNormals();
    }
  }
}

// Spanish salvage camp over the Plate Fleet wrecks (mission location)
export function buildSalvageCamp(scene, terrain, site) {
  const sx = -Math.sin(site.dir), sz = -Math.cos(site.dir);
  const c = terrain.findCoast(site.coast[0], site.coast[1], sx, sz);
  const B = new Builder();
  const inland = (b) => ({ x: c.x - sx * b, z: c.z - sz * b });
  const center = inland(30);
  terrain.addZone({ x: center.x, z: center.z, r: 60, level: 2.4, dirt: true });
  const rightX = -sz, rightZ = sx;
  const tents = [];
  const rnd = mulberry32(1715);
  const colliders = [];
  const toW = (a, b) => ({ x: c.x + rightX * a - sx * b, z: c.z + rightZ * a - sz * b });
  for (let i = 0; i < 7; i++) {
    const a = (rnd() - 0.5) * 70, b = 15 + rnd() * 40;
    const w = toW(a, b);
    const y = terrain.height(w.x, w.z);
    B.add('cloth', new THREE.ConeGeometry(3, 3.5, 4, 1, true), T(a, y + 1.7, b, Math.PI / 4 + rnd()), '#d8ccb0');
    tents.push({ a, b });
    colliders.push({ a, b, hw: 2.2, hd: 2.2 });
  }
  // crates of recovered silver
  const chests = [];
  for (let i = 0; i < 5; i++) {
    const a = -12 + i * 6, b = 12;
    const w = toW(a, b);
    const y = terrain.height(w.x, w.z);
    B.box('wood', 1.4, 0.9, 0.9, T(a, y + 0.45, b), '#6a4a2a');
    B.box('metal', 1.42, 0.12, 0.92, T(a, y + 0.7, b), '#8a8a8a');
    chests.push({ ...w, y });
  }
  // campfire
  const fw = toW(0, 35);
  const fy = terrain.height(fw.x, fw.z);
  for (let k = 0; k < 6; k++) B.box('wood', 1.4, 0.2, 0.2, T(0, fy + 0.15, 35, (k / 6) * Math.PI), '#3a2a1a');
  // flagpole
  B.cyl('wood', 0.1, 0.14, 10, 6, T(8, fy + 5, 30), '#3a2a1a');
  const group = B.build(sharedMaterials());
  group.position.set(c.x, 0, c.z);
  group.rotation.y = site.dir;
  scene.add(group);
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(4, 2.5).translate(2, 0, 0), new THREE.MeshStandardMaterial({ map: flagTexture('spain'), side: THREE.DoubleSide }));
  const fp = toW(8, 30);
  flag.position.set(fp.x, fy + 9, fp.z);
  scene.add(flag);
  const worldColliders = colliders.map((o) => {
    const w = toW(o.a, o.b);
    return { x: w.x, z: w.z, hw: o.hw, hd: o.hd, cos: Math.cos(site.dir), sin: Math.sin(site.dir) };
  });
  const firePos = new THREE.Vector3(fw.x, fy + 0.5, fw.z);
  return { group, chests, colliders: worldColliders, firePos, center: new THREE.Vector3(center.x, 2.4, center.z), coast: c, toW };
}
