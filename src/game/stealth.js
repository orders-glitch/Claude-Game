// Town stealth: a wanted pirate isn't known on sight by every soldier in the Indies. The watch has only a
// description, and it takes a good look to put a face to it. Each guard grows suspicious while he can see you
// (the nearer, the plainer; a sprint draws the eye, a walk among a crowd or in the dark of night hides you, a
// haystack hides you entirely) and calls the alarm when he's sure. Break his line of sight and stay out of it
// and the hue and cry dies down. Wanted posters on the walls keep your face in their minds: tear them down.
import * as THREE from 'three';
import { clamp, rand } from '../core/noise.js';

const SIGHT = 26; // how far a guard makes out a face by day
const CONE = Math.cos(1.05); // ~60° either side of where he looks

let STRAW = null;
function strawMaterial() {
  if (STRAW) return STRAW;
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d');
  x.fillStyle = '#b49a5a'; x.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 900; i++) {
    const s = rand(0.6, 1.2);
    x.strokeStyle = `rgba(${Math.floor(200 * s)},${Math.floor(172 * s)},${Math.floor(98 * s)},0.8)`;
    x.lineWidth = rand(0.6, 1.4);
    const px = rand(0, 128), py = rand(0, 128), a = rand(-0.6, 0.6) + Math.PI / 2;
    x.beginPath(); x.moveTo(px, py); x.lineTo(px + Math.cos(a) * rand(5, 14), py + Math.sin(a) * rand(5, 14)); x.stroke();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping;
  STRAW = new THREE.MeshStandardMaterial({ map: t, roughness: 1 });
  return STRAW;
}

function posterTexture(name, nation, reward) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 360;
  const x = c.getContext('2d');
  // parchment, foxed and stained
  x.fillStyle = '#e4d3a8'; x.fillRect(0, 0, 256, 360);
  for (let i = 0; i < 40; i++) { x.fillStyle = `rgba(120,90,40,${rand(0.02, 0.08)})`; x.beginPath(); x.arc(rand(0, 256), rand(0, 360), rand(8, 50), 0, 7); x.fill(); }
  x.fillStyle = '#2a1d10'; x.textAlign = 'center';
  const head = nation === 'spain' ? 'SE BUSCA' : nation === 'france' ? 'RECHERCHÉ' : nation === 'dutch' ? 'GEZOCHT' : 'WANTED';
  x.font = 'bold 44px Georgia, serif'; x.fillText(head, 128, 56);
  x.font = 'italic 17px Georgia, serif'; x.fillText(nation === 'spain' ? 'por piratería' : nation === 'france' ? 'pour piraterie' : 'for Piracy upon the High Seas', 128, 82);
  // a crude woodcut likeness
  x.fillStyle = '#d6c28f'; x.fillRect(58, 96, 140, 150);
  x.strokeStyle = '#2a1d10'; x.lineWidth = 3; x.strokeRect(58, 96, 140, 150);
  x.fillStyle = '#2a1d10';
  x.beginPath(); x.ellipse(128, 176, 38, 48, 0, 0, 7); x.fill(); // head
  x.fillStyle = '#d6c28f'; x.beginPath(); x.ellipse(128, 182, 30, 38, 0, 0, 7); x.fill();
  x.fillStyle = '#2a1d10';
  x.fillRect(80, 130, 96, 12); x.beginPath(); x.moveTo(70, 142); x.lineTo(128, 112); x.lineTo(186, 142); x.fill(); // tricorne
  x.fillRect(110, 170, 8, 5); x.fillRect(138, 170, 8, 5); // eyes
  x.fillRect(114, 200, 28, 3); // mouth
  for (let i = 0; i < 26; i++) x.fillRect(100 + rand(0, 56), 206 + rand(0, 16), 2, rand(3, 7)); // beard
  x.font = 'bold 22px Georgia, serif'; x.fillText(name.toUpperCase(), 128, 280);
  x.font = '16px Georgia, serif'; x.fillText(nation === 'spain' ? 'Recompensa' : nation === 'france' ? 'Récompense' : 'Reward', 128, 308);
  x.font = 'bold 24px Georgia, serif'; x.fillText(`${reward} pieces of eight`, 128, 336);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Stealth {
  constructor(game) {
    this.g = game;
    this.town = null;
    this.spots = []; // haystacks
    this.posters = [];
    this.hidden = null;
    this.unseenT = 0;
    this.status = '';
    // detection markers over the guards' heads
    this.layer = document.createElement('div');
    this.layer.className = 'stealth-layer';
    document.body.appendChild(this.layer);
    this.marks = [];
    this.badge = document.createElement('div');
    this.badge.className = 'stealth-badge';
    document.body.appendChild(this.badge);
  }

  // ------------------------------------------------------------------ the town's hiding places and posters
  setTown(town) {
    if (town === this.town) return;
    this.clearTown();
    this.town = town;
    if (!town) return;
    const g = this.g, t0 = performance.now();
    // haystacks against walls along the streets, spread through the town
    const nodes = town.streetNodes || [];
    const picked = [];
    // each pushed back against the nearest wall, out of the carts' way
    const againstWall = (n) => {
      let best = null, bd = 6;
      for (const c of g.collidersAround(n.x, n.z)) {
        if (c.rope || c.top - n.y < 2) continue;
        const dx = n.x - c.x, dz = n.z - c.z;
        const lx = dx * c.cos - dz * c.sin, lz = dx * c.sin + dz * c.cos;
        const ex = Math.abs(lx) - c.hw, ez = Math.abs(lz) - c.hd;
        if (ex < 0 && ez < 0) return null;
        const d = Math.max(ex, ez);
        if (d < bd) { bd = d; best = { c, lx: ex > ez ? Math.sign(lx) * (c.hw + 1.45) : clamp(lx, -c.hw + 1.5, c.hw - 1.5), lz: ex > ez ? clamp(lz, -c.hd + 1.5, c.hd - 1.5) : Math.sign(lz) * (c.hd + 1.45) }; }
      }
      if (!best) return null;
      const { c, lx, lz } = best;
      const p = new THREE.Vector3(c.x + lx * c.cos + lz * c.sin, 0, c.z - lx * c.sin + lz * c.cos);
      return g.collidersAround(p.x, p.z).some((o) => this.inside(o, p.x, p.z, 1.2)) ? null : p;
    };
    for (let k = 0; k < 80 && picked.length < 7 && nodes.length; k++) {
      const n = againstWall(nodes[Math.floor(Math.random() * nodes.length)]);
      if (n && picked.every((p) => p.distanceTo(n) > 35)) picked.push(n);
    }
    for (const n of picked) {
      const grp = new THREE.Group();
      const geo = new THREE.SphereGeometry(1.25, 14, 9, 0, Math.PI * 2, 0, Math.PI * 0.55).scale(1.1, 1.05, 0.95);
      const p = geo.attributes.position;
      for (let i = 0; i < p.count; i++) { const j = rand(-0.08, 0.08); p.setXYZ(i, p.getX(i) * (1 + j), p.getY(i) * (1 + j * 0.5), p.getZ(i) * (1 + j)); }
      geo.computeVertexNormals();
      const m = new THREE.Mesh(geo, strawMaterial());
      m.castShadow = true; m.receiveShadow = true;
      grp.add(m);
      grp.position.set(n.x, g.groundAt(n.x, n.z) - 0.25, n.z);
      grp.rotation.y = rand(0, 6.28);
      g.scene.add(grp);
      this.spots.push({ pos: new THREE.Vector3(n.x, grp.position.y + 0.25, n.z), mesh: grp });
    }
    this.placePosters();
    this.setupMs = performance.now() - t0;
  }

  inside(c, x, z, pad = 0) {
    const dx = x - c.x, dz = z - c.z;
    const lx = dx * c.cos - dz * c.sin, lz = dx * c.sin + dz * c.cos;
    return Math.abs(lx) < c.hw + pad && Math.abs(lz) < c.hd + pad;
  }

  // posters go up beside the doors of the town's buildings, flat on the wall
  placePosters() {
    const g = this.g, t = this.town, nation = t.port.nation;
    if (!nation || nation === 'pirate') return;
    const lvl = g.state.wanted(nation);
    if (lvl < 1) return;
    const torn = (g.state.tornPosters ||= {});
    const tex = posterTexture(g.state.captainName || 'Pirate', nation, 250 * lvl * lvl);
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95, side: THREE.DoubleSide });
    const doors = t.doors.filter((d) => d.type !== 'board');
    let i = 0;
    for (const d of doors) {
      if (this.posters.length >= 2 + lvl * 2) break;
      const key = `${t.port.id}:${i++}`;
      if (torn[key] === g.state.day) continue;
      // the wall the door is in: the nearest face of the building's box
      let best = null, bd = 2.5;
      for (const c of g.collidersAround(d.pos.x, d.pos.z)) {
        if (c.rope || c.top - d.pos.y < 2.5) continue;
        const dx = d.pos.x - c.x, dz = d.pos.z - c.z;
        const lx = dx * c.cos - dz * c.sin, lz = dx * c.sin + dz * c.cos;
        const ex = Math.abs(Math.abs(lx) - c.hw), ez = Math.abs(Math.abs(lz) - c.hd);
        const face = ex < ez ? { d: ex, n: [Math.sign(lx), 0], t: [0, 1], lx, lz, along: lz, half: c.hd } : { d: ez, n: [0, Math.sign(lz)], t: [1, 0], lx, lz, along: lx, half: c.hw };
        if (face.d < bd) { bd = face.d; best = { c, ...face }; }
      }
      if (!best) continue;
      const { c } = best;
      // a step to one side of the door, on the wall's face
      const off = best.along + 1.4 < best.half - 0.4 ? 1.4 : -1.4;
      const plx = best.n[0] ? best.n[0] * (c.hw + 0.04) : best.lx + off;
      const plz = best.n[1] ? best.n[1] * (c.hd + 0.04) : best.lz + off;
      const x = c.x + plx * c.cos + plz * c.sin, z = c.z - plx * c.sin + plz * c.cos;
      const nx = best.n[0] * c.cos + best.n[1] * c.sin, nz = -best.n[0] * c.sin + best.n[1] * c.cos;
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.87), mat);
      mesh.position.set(x, d.pos.y + 1.55, z);
      mesh.rotation.y = Math.atan2(nx, nz) + rand(-0.04, 0.04);
      mesh.rotation.z = rand(-0.06, 0.06);
      g.scene.add(mesh);
      this.posters.push({ mesh, key, pos: mesh.position.clone(), nation });
    }
  }

  clearTown() {
    for (const s of this.spots) this.g.scene.remove(s.mesh);
    for (const p of this.posters) { this.g.scene.remove(p.mesh); p.mesh.geometry.dispose(); }
    this.spots = []; this.posters = [];
    if (this.hidden) this.leaveHiding();
    this.town = null;
  }

  // ------------------------------------------------------------------ hiding
  hide(spot) {
    const w = this.g.walker;
    this.hidden = spot;
    this.hiddenFrom = w.pos.clone();
    w.root.visible = false;
    w.pos.copy(spot.pos);
    w.vel?.set(0, 0, 0);
    this.g.audio.swoosh?.(spot.pos);
    this.g.ui.toast('You burrow into the hay. [E] to come out.', 'info', 2200);
  }

  leaveHiding() {
    const w = this.g.walker, s = this.hidden;
    this.hidden = null;
    if (!w) return;
    w.root.visible = true;
    if (s && this.hiddenFrom) { const d = this.hiddenFrom.clone().sub(s.pos).setY(0); if (d.lengthSq() < 0.01) d.set(1, 0, 0); w.pos.copy(s.pos).addScaledVector(d.normalize(), 1.9); w.pos.y = this.g.groundAt(w.pos.x, w.pos.z); }
  }

  // context actions near a haystack or a poster (called from footContext)
  context() {
    const w = this.g.walker;
    if (this.hidden) return { text: '[E] Climb out of the hay', act: () => this.leaveHiding() };
    for (const s of this.spots) if (s.pos.distanceTo(w.pos) < 2.4) return { text: '[E] Hide in the haystack', act: () => this.hide(s) };
    for (const p of this.posters) if (Math.hypot(p.pos.x - w.pos.x, p.pos.z - w.pos.z) < 2.4 && Math.abs(p.pos.y - w.pos.y - 1.5) < 1.5) return { text: '[E] Tear down the wanted poster', act: () => this.tear(p) };
    return null;
  }

  tear(p) {
    const g = this.g;
    g.scene.remove(p.mesh);
    this.posters.splice(this.posters.indexOf(p), 1);
    g.state.tornPosters[p.key] = g.state.day;
    g.state.notoriety[p.nation] = Math.max(0, g.state.notoriety[p.nation] - 0.2);
    g.audio.swoosh?.(p.pos);
    // tearing it down under a guard's nose is not wise
    for (const n of g.npcs) if (this.isWatch(n) && n.pos.distanceTo(p.pos) < 18 && this.canSee(n, g.walker)) n.suspicion = Math.min(1, (n.suspicion || 0) + 0.6);
    g.ui.toast(this.posters.length ? `Poster torn down. ${this.posters.length} still up in town.` : 'The last poster in town comes down — fewer will know your face.', 'good', 2400);
  }

  // ------------------------------------------------------------------ the watch
  isWatch(n) { return !n.dead && !n.side && (n.kind === 'guard' || n.kind === 'soldier') && n.town && n.nation && n.nation !== 'pirate'; }

  // walls between a guard's eye and the player's head: the sight line, rising or falling between the two, is
  // blocked where it passes through a building below its top (a lookout on a roof sees down over the edge)
  blocked(a, b) {
    const g = this.g;
    const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2, len = Math.hypot(b.x - a.x, b.z - a.z);
    const ya = a.y + 1.6, yb = b.y + 1.5, lowY = Math.min(ya, yb);
    for (const host of g.collidersNear(mx, mz)) {
      for (const c of host) {
        if (c.rope || c.top < lowY || (c.bottom !== undefined && c.bottom > Math.max(ya, yb))) continue;
        if (Math.abs(c.x - mx) > len / 2 + c.hw + c.hd || Math.abs(c.z - mz) > len / 2 + c.hw + c.hd) continue;
        // slab test in the box's frame
        const tx = (p) => { const dx = p.x - c.x, dz = p.z - c.z; return [dx * c.cos - dz * c.sin, dx * c.sin + dz * c.cos]; };
        const [ax, az] = tx(a), [bx, bz] = tx(b);
        let t0 = 0, t1 = 1;
        const dX = bx - ax, dZ = bz - az;
        const slab = (p, d, h) => {
          if (Math.abs(d) < 1e-6) return Math.abs(p) <= h;
          let u = (-h - p) / d, v = (h - p) / d;
          if (u > v) [u, v] = [v, u];
          t0 = Math.max(t0, u); t1 = Math.min(t1, v);
          return t0 <= t1;
        };
        if (slab(ax, dX, c.hw - 0.2) && slab(az, dZ, c.hd - 0.2) && t1 > 0.02 && t0 < 0.98) {
          const h0 = ya + (yb - ya) * Math.max(0, t0), h1 = ya + (yb - ya) * Math.min(1, t1);
          if (Math.min(h0, h1) < c.top - 0.3 && (c.bottom === undefined || Math.max(h0, h1) > c.bottom)) return true;
        }
      }
    }
    return false;
  }

  canSee(n, w, range = SIGHT) {
    const dx = w.pos.x - n.pos.x, dz = w.pos.z - n.pos.z, d = Math.hypot(dx, dz);
    if (d > range) return false;
    if (d > 3.5) {
      const fx = -Math.sin(n.yaw), fz = -Math.cos(n.yaw);
      if ((dx * fx + dz * fz) / d < CONE) return false;
    }
    return !this.blocked(n.pos, w.pos);
  }

  update(dt) {
    const g = this.g, w = g.walker;
    this.setTown(g.mode === 'foot' ? g.currentTown : null);
    if (!w || w.dead || g.mode !== 'foot' || !this.town || g.boarding) { this.draw([]); return; }
    const nation = this.town.port.nation;
    const wanted = g.state.wanted(nation);
    const night = g.sky.nightFactor;
    const sprinting = (w.sprintT || 0) > 0.2 || w.mode === 'air' || w.mode === 'climb' || w.mode === 'hang';
    const up = w.pos.y - g.groundAt(w.pos.x, w.pos.z) > 2.2;
    const crowd = !sprinting && !up && g.crowd?.nearCount ? g.crowd.nearCount(w.pos, 3.2) : 0;
    const blended = crowd >= 2;
    // lanterns near you undo the dark
    const lit = night > 0.3 && this.town.lanterns?.some((l) => Math.abs(l.x - w.pos.x) < 7 && Math.abs(l.z - w.pos.z) < 7);
    const darkF = 1 - night * (lit ? 0.2 : 0.6);
    const range = SIGHT * darkF * (up ? 0.7 : 1);
    const rate = wanted >= 3 ? 1.1 : wanted === 2 ? 0.65 : wanted === 1 ? 0.3 : 0;
    // a gang of armed seamen at your heels draws the eye (leave them standing fast to slip in alone)
    const gang = g.party?.conspicuous() || 0;
    const factor = (sprinting ? 1.8 : 1) * (blended && !gang ? 0.12 : 1) * (this.hidden ? 0 : 1) * (1 + 0.15 * gang);
    this.status = this.hidden ? 'Hidden' : blended ? 'Blending in' : night > 0.5 && !lit && !up ? 'In the shadows' : '';
    this.lookT = (this.lookT || 0) - dt;
    const check = this.lookT <= 0;
    if (check) this.lookT = 0.2;
    const shown = [];
    let anySee = false;
    for (const n of g.npcs) {
      if (!this.isWatch(n) || n.town !== this.town) continue;
      if (check) n.seesPlayer = !this.hidden && this.canSee(n, w, this.town.alarm || n.spotted ? SIGHT * 1.4 * darkF : range);
      const d = n.pos.distanceTo(w.pos);
      if (this.town.alarm || n.spotted) {
        if (n.seesPlayer) anySee = true;
        continue;
      }
      if (rate > 0 && n.seesPlayer) {
        n.suspicion = (n.suspicion || 0) + dt * rate * factor * (1.2 - 0.8 * d / range);
        // he turns to look
        n.yaw += Math.atan2(Math.sin(Math.atan2(-(w.pos.x - n.pos.x), -(w.pos.z - n.pos.z)) - n.yaw), Math.cos(Math.atan2(-(w.pos.x - n.pos.x), -(w.pos.z - n.pos.z)) - n.yaw)) * Math.min(1, dt * 2 * n.suspicion);
      } else n.suspicion = Math.max(0, (n.suspicion || 0) - dt * 0.15);
      if (n.suspicion >= 1) this.spotted(n);
      if (n.suspicion > 0.03) shown.push(n);
    }
    // the chase: out of every guard's sight long enough, and they give it up
    if (this.town.alarm) {
      this.unseenT = anySee ? 0 : this.unseenT + dt;
      this.status = anySee ? 'Pursued' : `Searching… ${Math.max(0, Math.ceil(15 - this.unseenT))}`;
      if (this.unseenT > 15) this.lose();
      for (const n of g.npcs) if (this.isWatch(n) && n.town === this.town && n.pos.distanceTo(w.pos) < 40) shown.push(n);
    }
    this.draw(shown);
  }

  spotted(n) {
    const g = this.g, t = this.town;
    n.spotted = true;
    t.alarm = true;
    this.unseenT = 0;
    for (const o of g.npcs) if (this.isWatch(o) && o.town === t && o.pos.distanceTo(n.pos) < 40) o.spotted = true;
    g.state.notoriety[n.nation] = Math.max(g.state.notoriety[n.nation], 2);
    const call = n.nation === 'spain' ? '¡Es él! ¡El pirata!' : n.nation === 'france' ? "C'est lui ! Le pirate !" : n.nation === 'dutch' ? 'Dat is hem! De piraat!' : "That's him! That's the pirate!";
    g.ui.toast(`“${call}” — you've been recognised. Break their line of sight to lose them.`, 'warn', 3500);
    g.audio.grunt?.(n.pos);
    g.combatT = 12;
  }

  lose() {
    const g = this.g, t = this.town;
    t.alarm = false;
    this.unseenT = 0;
    for (const n of g.npcs) if (n.town === t) { n.spotted = false; n.suspicion = 0.5; n.hostile = false; }
    g.ui.toast("You've lost them. The watch goes back to its posts, grumbling.", 'good', 3000);
  }

  // ------------------------------------------------------------------ the markers
  draw(list) {
    const g = this.g;
    while (this.marks.length < list.length) {
      const m = document.createElement('div'); m.className = 'stealth-mark'; m.innerHTML = '<i></i>';
      this.layer.appendChild(m); this.marks.push(m);
    }
    const v = new THREE.Vector3();
    this.marks.forEach((m, i) => {
      const n = list[i];
      if (!n) { m.style.display = 'none'; return; }
      v.copy(n.pos); v.y += 2.35;
      v.project(g.camera);
      if (v.z > 1) { m.style.display = 'none'; return; }
      m.style.display = 'block';
      m.style.left = `${(v.x * 0.5 + 0.5) * innerWidth}px`;
      m.style.top = `${(-v.y * 0.5 + 0.5) * innerHeight}px`;
      const hot = n.spotted || this.town?.alarm;
      const s = hot ? 1 : clamp(n.suspicion || 0, 0, 1);
      m.classList.toggle('hot', !!hot);
      m.firstChild.style.height = `${Math.round(s * 100)}%`;
    });
    this.badge.textContent = this.status;
    this.badge.style.display = this.status && g.mode === 'foot' ? 'block' : 'none';
  }
}
