// DOM user interface: HUD, minimap, sea chart, shops, dialogs and menus.
import { PORTS, ISLANDS, GOODS, SHIP_CLASSES, NATIONS, AMMO, SALVAGE_CAMP } from '../game/data.js';
import { WORLD_HALF } from '../world/terrain.js';
import { flagTexture, parchmentCanvas } from '../core/textures.js';
import { clamp } from '../core/noise.js';
import { saveSettings } from '../game/state.js';

const $ = (id) => document.getElementById(id);
const SKULL = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="26" r="17" fill="#f2ead8"/><rect x="22" y="34" width="20" height="12" rx="3" fill="#f2ead8"/><circle cx="25" cy="25" r="5" fill="#140c08"/><circle cx="39" cy="25" r="5" fill="#140c08"/><path d="M32 30 l-3 6 h6z" fill="#140c08"/><path d="M8 50 L56 62 M56 50 L8 62" stroke="#f2ead8" stroke-width="5" stroke-linecap="round"/></svg>')}`;

const flagURL = new Map();
function flagImg(kind) {
  if (!flagURL.has(kind)) flagURL.set(kind, flagTexture(kind).image.toDataURL());
  return flagURL.get(kind);
}

export class UI {
  constructor(game) {
    this.game = game;
    this.toastEl = $('toasts');
    this.promptEl = $('prompt');
    this.mm = $('minimap');
    this.mmCtx = this.mm.getContext('2d');
    this.hudTimer = 0;
    this.modalStack = [];
    this.buildCompass();
    this.bindMenus();
  }

  // ---------------------------------------------------------------- screens
  setLoading(p, text) {
    $('load-fill').style.width = `${Math.round(p * 100)}%`;
    if (text) $('load-text').textContent = text;
  }
  hideLoading() { $('loading').classList.add('hidden'); }

  showTitle() {
    $('title').classList.remove('hidden');
    $('hud').classList.add('hidden');
    const has = this.game.hasSave();
    $('btn-continue').classList.toggle('hidden', !has);
    $('save-summary').textContent = has ? this.game.saveSummary() : '';
    $('newgame').classList.add('hidden');
    $('title-menu').classList.remove('hidden');
  }
  hideTitle() { $('title').classList.add('hidden'); $('hud').classList.remove('hidden'); }

  bindMenus() {
    const g = this.game;
    $('title').addEventListener('click', (e) => {
      const act = e.target.closest('button')?.dataset.act;
      if (!act) return;
      g.audio.init();
      g.audio.ui('click');
      if (act === 'continue') g.continueGame();
      if (act === 'new') { $('newgame').classList.remove('hidden'); $('title-menu').classList.add('hidden'); $('captain-name').focus(); }
      if (act === 'back') { $('newgame').classList.add('hidden'); $('title-menu').classList.remove('hidden'); }
      if (act === 'begin') g.newGame($('captain-name').value.trim() || 'James Kidd', $('ship-name').value.trim() || 'Ranger');
      if (act === 'settings') this.openModal('settings');
      if (act === 'controls') this.openModal('controls');
    });
    $('pause').addEventListener('click', (e) => {
      const act = e.target.closest('button')?.dataset.act;
      if (!act) return;
      g.audio.ui('click');
      if (act === 'resume') this.closeAll();
      if (act === 'save') { g.save(); this.toast(g.canSaveHere() ? 'Game saved.' : 'Game saved (you will resume at your last port).', 'good'); }
      if (act === 'settings') this.openModal('settings');
      if (act === 'controls') this.openModal('controls');
      if (act === 'log') this.openLog();
      if (act === 'quit') { this.closeAll(); g.quitToTitle(); }
    });
    document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => { g.audio.ui('click'); this.closeTop(); }));
    // settings
    const s = g.state.settings;
    const bind = (id, key, fn = (v) => v) => {
      const el = $(id);
      if (el.type === 'checkbox') el.checked = !!s[key]; else el.value = s[key];
      el.addEventListener('input', () => {
        s[key] = el.type === 'checkbox' ? el.checked : fn(el.value);
        saveSettings(s);
        g.applySettings();
      });
    };
    bind('set-quality', 'quality');
    bind('set-master', 'master', parseFloat);
    bind('set-music', 'music', parseFloat);
    bind('set-sfx', 'sfx', parseFloat);
    bind('set-sens', 'sensitivity', parseFloat);
    bind('set-fov', 'fov', parseFloat);
    bind('set-invert', 'invertY');
    bind('set-fps', 'showFps');
    $('dlg-next').addEventListener('click', () => this.advanceDialog());
    $('chart-canvas').addEventListener('click', (e) => this.chartClick(e));
    $('chart-canvas').addEventListener('mousemove', (e) => this.chartHover(e));
  }

  openModal(id) {
    $(id).classList.remove('hidden');
    if (!this.modalStack.includes(id)) this.modalStack.push(id);
    this.game.onModal(true);
  }
  closeTop() {
    const id = this.modalStack.pop();
    if (id) $(id).classList.add('hidden');
    if (id === 'dialog' && this.dialogCb) { const cb = this.dialogCb; this.dialogCb = null; cb(); }
    if (!this.modalStack.length) this.game.onModal(false);
  }
  closeAll() {
    while (this.modalStack.length) {
      const id = this.modalStack.pop();
      $(id).classList.add('hidden');
    }
    this.game.onModal(false);
  }
  anyModal() { return this.modalStack.length > 0; }
  top() { return this.modalStack[this.modalStack.length - 1]; }

  // ---------------------------------------------------------------- feedback
  toast(msg, kind = 'info', ms = 3800) {
    const d = document.createElement('div');
    d.className = 'toast ' + kind;
    d.textContent = msg;
    this.toastEl.appendChild(d);
    while (this.toastEl.children.length > 5) this.toastEl.removeChild(this.toastEl.firstChild);
    setTimeout(() => { d.classList.add('out'); setTimeout(() => d.remove(), 450); }, ms);
  }

  prompt(text) {
    if (this._prompt === text) return;
    this._prompt = text;
    if (!text) this.promptEl.classList.add('hidden');
    else { this.promptEl.innerHTML = text.replace(/\[(\w+)\]/g, '<kbd>$1</kbd>'); this.promptEl.classList.remove('hidden'); }
  }

  refreshObjective() {
    const t = this.game.missions.objectiveText();
    $('objective').classList.toggle('hidden', !t);
    $('obj-text').textContent = t || '';
  }

  dialog(speaker, text, cb) {
    this.dialogQueue = this.dialogQueue || [];
    this.dialogQueue.push({ speaker, text, cb });
    if (this.top() !== 'dialog') this.showNextDialog();
  }
  showNextDialog() {
    const d = this.dialogQueue.shift();
    if (!d) return;
    $('dlg-speaker').textContent = d.speaker;
    $('dlg-text').textContent = d.text;
    this.dialogCb = d.cb || null;
    this.game.audio.ui('open');
    this.openModal('dialog');
  }
  // multiple-choice dialog: buttons [{label, act}]
  choice(title, text, buttons) {
    $('dlg-speaker').textContent = title;
    $('dlg-text').textContent = text;
    const next = $('dlg-next');
    next.classList.add('hidden');
    const row = next.parentElement;
    row.querySelectorAll('.choice').forEach((b) => b.remove());
    for (const b of buttons) {
      const el = document.createElement('button');
      el.className = 'choice';
      el.textContent = b.label;
      el.onclick = () => {
        this.game.audio.ui('click');
        row.querySelectorAll('.choice').forEach((x) => x.remove());
        next.classList.remove('hidden');
        this.dialogCb = null;
        this.closeTop();
        b.act();
      };
      row.appendChild(el);
    }
    this.dialogCb = null;
    this.game.audio.ui('open');
    this.openModal('dialog');
  }

  advanceDialog() {
    if ($('dlg-next').classList.contains('hidden')) return;
    this.game.audio.ui('click');
    this.closeTop();
    if (this.dialogQueue?.length) this.showNextDialog();
  }

  banner(title, sub) {
    const b = $('banner');
    b.classList.add('hidden');
    void b.offsetWidth;
    b.querySelector('.banner-title').textContent = title;
    b.querySelector('.banner-sub').textContent = sub || '';
    b.classList.remove('hidden');
    clearTimeout(this._bannerT);
    this._bannerT = setTimeout(() => b.classList.add('hidden'), 4600);
  }

  missionComplete(title, reward, cb) {
    this.game.audio.ui('fanfare');
    const parts = [];
    if (reward.gold) parts.push(`+${reward.gold} pieces of eight`);
    if (reward.renown) parts.push(`+${reward.renown} renown`);
    this.banner(title, 'Mission complete · ' + parts.join(' · '));
    setTimeout(() => cb && cb(), 1800);
  }

  damageFlash() {
    const d = $('damage');
    d.style.opacity = 1;
    clearTimeout(this._dmgT);
    this._dmgT = setTimeout(() => (d.style.opacity = 0), 250);
  }

  fade(on) { $('fade').style.opacity = on ? 1 : 0; }

  wasted(title, sub) {
    const w = $('wasted');
    w.querySelector('.w-title').textContent = title;
    w.querySelector('.w-sub').textContent = sub;
    w.classList.remove('hidden');
    setTimeout(() => w.classList.add('hidden'), 4200);
  }

  finale() {
    const s = this.game.state;
    $('finale-text').textContent = `${s.captainName}, once a privateer without a commission, is now the most feared captain in the West Indies. ${s.stats.sunk} ships sent to the bottom, ${s.stats.captured} prizes taken and ${s.stats.plunder.toLocaleString()} pieces of eight in plunder. The campaign is complete — but the Caribbean is yours to roam: hunt bounties, dig for treasure, trade, and raise hell.`;
    this.openModal('finale');
  }

  openLog() {
    const g = this.game, s = g.state;
    const cur = g.missions.current;
    const lines = [];
    lines.push(`<h3>${s.captainName} — ${s.title()}</h3>`);
    lines.push(`<p>Commanding the ${SHIP_CLASSES[s.ship.cls].name} <i>${s.shipName}</i>. Renown ${Math.floor(s.renown)}.</p>`);
    lines.push(`<p>Ships sunk: ${s.stats.sunk} · Prizes taken: ${s.stats.captured} · Treasure found: ${s.stats.treasures} · Plunder: ${s.stats.plunder} ⛁</p>`);
    lines.push('<h3>The Campaign</h3>');
    for (const m of g.missions.story) {
      const done = s.mission.done.includes(m.id);
      const active = cur && cur.id === m.id;
      lines.push(`<p>${done ? '✔' : active ? '➤' : '·'} <b>${m.title}</b>${active ? ' — <i>' + (g.missions.stage?.text || '') + '</i>' : ''}</p>`);
    }
    if (s.contracts.length) {
      lines.push('<h3>Contracts</h3>');
      for (const c of s.contracts) lines.push(`<p>➤ ${c.text}${c.deadline !== undefined ? ` <i>(before ${this.game.dayToDate(c.deadline)})</i>` : ''} — ${c.reward} ⛁</p>`);
    }
    const maps = s.treasureMaps.filter((m) => !m.found);
    if (maps.length) {
      lines.push('<h3>Treasure Maps</h3>');
      for (const m of maps) lines.push(`<p>✘ Buried treasure on ${ISLANDS.find((i) => i.id === m.island).name}</p>`);
    }
    lines.push('<h3>Cargo</h3>');
    const cargo = Object.entries(s.ship.cargo).filter(([, n]) => n > 0);
    lines.push(`<p>${cargo.length ? cargo.map(([k, n]) => `${n} ${GOODS[k].name}`).join(', ') : 'The hold is empty.'}</p>`);
    lines.push('<h3>Notoriety</h3>');
    lines.push(`<p>${Object.entries(s.notoriety).map(([k, v]) => `${NATIONS[k].name}: ${'☠'.repeat(Math.floor(v)) || 'unknown'}`).join(' · ')}</p>`);
    $('log-body').innerHTML = lines.join('');
    this.openModal('log');
  }

  // ---------------------------------------------------------------- HUD
  buildCompass() {
    const inner = $('compass-inner');
    const labels = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
    let html = '';
    for (let rep = -1; rep <= 1; rep++) {
      for (let d = 0; d < 360; d += 15) {
        const x = (d + rep * 360) * 2;
        if (labels[d]) html += `<span class="${d % 90 === 0 ? 'card' : ''}" style="left:${x}px">${labels[d]}</span>`;
        else html += `<span class="tick" style="left:${x}px">|</span>`;
      }
    }
    inner.innerHTML = html;
  }

  update(dt) {
    const g = this.game;
    const s = g.state;
    this.hudTimer -= dt;
    // compass: bearing of camera
    const bearing = g.cameraBearing();
    const w = $('compass-strip').clientWidth;
    $('compass-inner').style.transform = `translateX(${w / 2 - bearing * 2}px)`;
    const mk = g.missions.marker();
    const cm = $('compass-marker');
    if (mk) {
      const cam = g.camera.position;
      const b = (Math.atan2(mk.x - cam.x, -(mk.z - cam.z)) * 180) / Math.PI;
      let rel = ((b - bearing + 540) % 360) - 180;
      if (Math.abs(rel) < w / 4) { cm.style.display = 'block'; cm.style.left = `${w / 2 + rel * 2}px`; } else cm.style.display = 'none';
    } else cm.style.display = 'none';

    this.drawMinimap();
    if (this.hudTimer > 0) return;
    this.hudTimer = 0.15;
    $('hud-date').textContent = s.dateString();
    $('hud-time').textContent = s.timeString();
    $('hud-weather').textContent = `${g.weather.describe()} · wind ${windName(g.weather.wind)} ${windForce(g.weather.wind.strength)}`;
    $('gold-val').textContent = Math.floor(s.gold).toLocaleString();
    // wanted
    let wh = '';
    for (const k of Object.keys(s.notoriety)) {
      const lv = Math.floor(s.notoriety[k]);
      if (lv <= 0) continue;
      const hunted = g.huntersActive?.[k];
      wh += `<div class="wanted-row ${hunted ? 'flash' : ''}"><img src="${flagImg(NATIONS[k].flag)}" style="width:26px;height:16px;border:1px solid #000"/>`;
      for (let i = 0; i < 5; i++) wh += `<img class="skull ${i < lv ? 'on' : ''}" src="${SKULL}"/>`;
      wh += '</div>';
    }
    if (this._wh !== wh) { $('hud-wanted').innerHTML = wh; this._wh = wh; }

    const sailing = g.mode === 'sail';
    $('ship-panel').classList.toggle('hidden', !sailing);
    $('foot-panel').classList.toggle('hidden', g.mode !== 'foot');
    if (sailing && g.playerShip) {
      const p = g.playerShip;
      $('bar-hull').style.width = `${clamp(p.hull / p.hullMax, 0, 1) * 100}%`;
      $('bar-sails').style.width = `${clamp(p.sails / p.sailsMax, 0, 1) * 100}%`;
      $('bar-crew').style.width = `${clamp(p.crew / p.cls.crewMax, 0, 1) * 100}%`;
      $('crew-val').textContent = p.crew;
      $('speed-val').textContent = p.speedKnots.toFixed(1);
      $('pos-sail').textContent = pointOfSail(p);
      $('pos-sail').className = p.eff < 0.25 && p.sailTarget > 0 ? 'bad' : '';
      const pips = $('sail-pips').children;
      pips[0].classList.toggle('on', p.sailTarget >= 1);
      pips[1].classList.toggle('on', p.sailTarget >= 2);
      $('ammo').innerHTML = `${AMMO[p.ammo].name}<br><small>${p.anchored ? '⚓ At anchor' : p.flagKind === 'pirate' ? '☠ Jolly Roger' : 'False colours'}</small>`;
      const rt = p.reloadTime();
      const port = 1 - p.reload.port / rt, star = 1 - p.reload.starboard / rt;
      $('rl-port').firstElementChild.style.width = `${port * 100}%`;
      $('rl-star').firstElementChild.style.width = `${star * 100}%`;
      $('rl-port').classList.toggle('ready', port >= 1);
      $('rl-star').classList.toggle('ready', star >= 1);
    }
    if (g.mode === 'foot' && g.walker) {
      const w = g.walker;
      $('bar-health').style.width = `${clamp(w.health / w.maxHealth, 0, 1) * 100}%`;
      $('pistols').textContent = w.pistols > 0 ? `Flintlocks: ${'▮'.repeat(w.pistols)}${'▯'.repeat(2 - w.pistols)}` : `Reloading flintlocks… ${w.pistolReload.toFixed(1)}s`;
    }
    // target info
    const t = g.targetShip;
    const ti = $('target-info');
    if (t && sailing) {
      ti.classList.remove('hidden');
      const rel = g.relationLabel(t);
      ti.innerHTML = `<div class="t-name"><img src="${flagImg(t.flagKind)}" style="width:24px;height:15px;vertical-align:-2px;border:1px solid #000"/> ${t.name}</div>
        <div class="t-class">${t.nation.adj} ${t.cls.name} · ${t.cls.guns} guns · ${rel}</div>
        <div class="track"><div class="fill hull" style="width:${clamp(t.hull / t.hullMax, 0, 1) * 100}%"></div></div>
        ${t.struck ? '<div class="struck">Colours struck — lay alongside and press F to board</div>' : ''}`;
    } else ti.classList.add('hidden');
    $('crosshair').classList.toggle('hidden', !(g.mode === 'foot' && g.walker?.aiming));
    const fps = $('fps');
    fps.classList.toggle('hidden', !s.settings.showFps);
    if (s.settings.showFps) fps.textContent = `${g.fps.toFixed(0)} fps · ${g.renderer.info.render.calls} calls · ${(g.renderer.info.render.triangles / 1000).toFixed(0)}k tris`;
  }

  // ---------------------------------------------------------------- world map rendering
  buildWorldMap() {
    const t = this.game.terrain;
    const size = t.heightSize;
    const c = document.createElement('canvas');
    c.width = size; c.height = size;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(size, size);
    const d = t.heightData;
    for (let j = 0; j < size; j++) {
      for (let i = 0; i < size; i++) {
        const h = d[j * size + i];
        const k = (j * size + i) * 4;
        let r, g, b;
        if (h < -20) { r = 22; g = 58; b = 86; }
        else if (h < -3) { const f = (h + 20) / 17; r = 22 + f * 30; g = 58 + f * 70; b = 86 + f * 50; }
        else if (h < 0.3) { r = 70; g = 170; b = 170; }
        else if (h < 3) { r = 214; g = 200; b = 150; }
        else { const f = clamp(h / 120, 0, 1); r = 92 + f * 60; g = 120 + f * 20; b = 60 + f * 40; }
        img.data[k] = r; img.data[k + 1] = g; img.data[k + 2] = b; img.data[k + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    this.worldMap = c;
  }

  worldToMap(x, z) {
    const size = this.game.terrain.heightSize;
    return [((x + WORLD_HALF) / (WORLD_HALF * 2)) * size, ((z + WORLD_HALF) / (WORLD_HALF * 2)) * size];
  }

  drawMinimap() {
    const g = this.game;
    if (!this.worldMap || !g.focus) return;
    const ctx = this.mmCtx;
    const W = this.mm.width, R = W / 2;
    const foot = g.mode === 'foot';
    const radius = foot ? 140 : 900; // world units shown to the edge
    const size = g.terrain.heightSize;
    const scale = R / radius; // px per world unit
    const mapScale = (WORLD_HALF * 2) / size; // world units per map px
    const f = g.focus;
    const rot = -g.cameraYaw();
    ctx.save();
    ctx.clearRect(0, 0, W, W);
    ctx.beginPath(); ctx.arc(R, R, R, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = '#163a56'; ctx.fillRect(0, 0, W, W);
    ctx.translate(R, R);
    ctx.rotate(rot);
    const [mx, mz] = this.worldToMap(f.x, f.z);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.worldMap, -mx * mapScale * scale, -mz * mapScale * scale, size * mapScale * scale, size * mapScale * scale);
    // buildings when ashore
    if (foot) {
      ctx.fillStyle = 'rgba(60,40,25,0.85)';
      for (const town of g.townList) {
        if (town.center.distanceTo(f) > 400) continue;
        for (const c of town.colliders) {
          const dx = (c.x - f.x) * scale, dz = (c.z - f.z) * scale;
          if (Math.abs(dx) > R * 1.5 || Math.abs(dz) > R * 1.5) continue;
          ctx.save();
          ctx.translate(dx, dz);
          ctx.rotate(-Math.atan2(c.sin, c.cos));
          ctx.fillRect(-c.hw * scale, -c.hd * scale, c.hw * 2 * scale, c.hd * 2 * scale);
          ctx.restore();
        }
        ctx.fillStyle = 'rgba(140,100,60,0.9)';
        for (const p of town.platforms) {
          ctx.save();
          ctx.translate((p.x - f.x) * scale, (p.z - f.z) * scale);
          ctx.rotate(-Math.atan2(p.sin, p.cos));
          ctx.fillRect(-p.hw * scale, -p.hd * scale, p.hw * 2 * scale, p.hd * 2 * scale);
          ctx.restore();
        }
        ctx.fillStyle = 'rgba(60,40,25,0.85)';
        // shop doors
        for (const d of town.doors) this.mmIcon(ctx, (d.pos.x - f.x) * scale, (d.pos.z - f.z) * scale, d.type, rot);
      }
    }
    // ports
    if (!foot) {
      for (const town of g.townList) {
        const dx = (town.coast.x - f.x) * scale, dz = (town.coast.z - f.z) * scale;
        this.mmIcon(ctx, dx, dz, 'port', rot, town);
      }
    }
    // ships
    for (const s of g.ships) {
      if (s.isPlayer || s.sunk) continue;
      const dx = (s.position.x - f.x) * scale, dz = (s.position.z - f.z) * scale;
      if (dx * dx + dz * dz > R * R * 1.1) continue;
      ctx.save();
      ctx.translate(dx, dz);
      ctx.rotate(-s.heading);
      const col = s.struck ? '#cfcfcf' : g.isHostile(s, g.playerShip) ? '#e5412d' : s.mission ? '#f3d58a' : '#f2ead8';
      ctx.fillStyle = col;
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, -6); ctx.lineTo(3.5, 5); ctx.lineTo(-3.5, 5); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.restore();
    }
    // treasure
    for (const m of g.state.treasureMaps) {
      if (m.found) continue;
      const dx = (m.x - f.x) * scale, dz = (m.z - f.z) * scale;
      ctx.save(); ctx.translate(dx, dz); ctx.rotate(-rot);
      ctx.strokeStyle = '#b01e1e'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(-5, -5); ctx.lineTo(5, 5); ctx.moveTo(5, -5); ctx.lineTo(-5, 5); ctx.stroke();
      ctx.restore();
    }
    // other walkers when ashore
    if (foot) {
      for (const n of g.npcs) {
        if (n.dead) continue;
        const dx = (n.pos.x - f.x) * scale, dz = (n.pos.z - f.z) * scale;
        ctx.fillStyle = g.isWalkerHostile(n) ? '#e5412d' : 'rgba(240,230,210,0.7)';
        ctx.beginPath(); ctx.arc(dx, dz, 2.2, 0, Math.PI * 2); ctx.fill();
      }
      if (g.playerShip) {
        const dx = (g.playerShip.position.x - f.x) * scale, dz = (g.playerShip.position.z - f.z) * scale;
        this.mmIcon(ctx, dx, dz, 'myship', rot);
      }
    }
    ctx.restore();

    // objective marker (clamped to the rim)
    const mk = g.missions.marker();
    if (mk) {
      let dx = (mk.x - f.x) * scale, dz = (mk.z - f.z) * scale;
      const c = Math.cos(rot), s = Math.sin(rot);
      let rx = dx * c - dz * s, rz = dx * s + dz * c;
      const d = Math.hypot(rx, rz);
      if (d > R - 10) { rx *= (R - 10) / d; rz *= (R - 10) / d; }
      ctx.fillStyle = '#f3c24a'; ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(R + rx, R + rz, 6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
    // player arrow (always pointing along its heading relative to view)
    const ph = g.mode === 'sail' ? g.playerShip.heading : g.walker ? g.walker.yaw : 0;
    ctx.save();
    ctx.translate(R, R);
    ctx.rotate(-ph + rot);
    ctx.fillStyle = '#fff'; ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(0, -9); ctx.lineTo(6, 7); ctx.lineTo(0, 3); ctx.lineTo(-6, 7); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore();
    // compass N marker on rim
    const nAng = rot - Math.PI / 2;
    ctx.fillStyle = '#f3d58a'; ctx.font = 'bold 15px "IM Fell English SC", serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('N', R + Math.cos(nAng) * (R - 11), R + Math.sin(nAng) * (R - 11));
    // wind arrow
    const wa = Math.atan2(g.weather.wind.z, g.weather.wind.x) + rot;
    ctx.save();
    ctx.translate(W - 26, 26);
    ctx.fillStyle = 'rgba(12,10,8,0.6)'; ctx.beginPath(); ctx.arc(0, 0, 18, 0, Math.PI * 2); ctx.fill();
    ctx.rotate(wa);
    ctx.strokeStyle = '#cfe6ff'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(-11, 0); ctx.lineTo(11, 0); ctx.lineTo(5, -5); ctx.moveTo(11, 0); ctx.lineTo(5, 5); ctx.stroke();
    ctx.restore();
  }

  mmIcon(ctx, x, y, type, rot, town) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(-rot);
    const icons = { tavern: ['#c9772a', 'T'], merchant: ['#3a7ab8', '$'], shipwright: ['#6a8a3a', '⚒'], governor: ['#b03a3a', '♜'], board: ['#f2ead8', '⚓'], port: ['#f3d58a', '⚓'], myship: ['#f3d58a', '⛵'] };
    const [col, ch] = icons[type] || ['#fff', '?'];
    ctx.fillStyle = 'rgba(12,10,8,0.8)';
    ctx.beginPath(); ctx.arc(0, 0, 8, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.fillStyle = col; ctx.font = '11px serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(ch, 0, 1);
    ctx.restore();
  }

  // ---------------------------------------------------------------- chart
  openChart() {
    const cv = $('chart-canvas');
    this.openModal('chart');
    const rect = cv.getBoundingClientRect();
    cv.width = Math.floor(rect.width * Math.min(2, devicePixelRatio));
    cv.height = Math.floor(rect.height * Math.min(2, devicePixelRatio));
    if (!this.chartBase || this.chartBase.width !== cv.width) this.chartBase = this.renderChartBase(cv.width, cv.height);
    this.drawChart();
  }

  chartView(w, h) {
    // world bounds shown on the chart
    const x0 = -6400, x1 = 7400, z0 = -8600, z1 = 1900;
    const sx = w / (x1 - x0), sz = h / (z1 - z0);
    const s = Math.min(sx, sz);
    const ox = (w - (x1 - x0) * s) / 2, oz = (h - (z1 - z0) * s) / 2;
    return { toPx: (x, z) => [ox + (x - x0) * s, oz + (z - z0) * s], toWorld: (px, py) => [(px - ox) / s + x0, (py - oz) / s + z0], s };
  }

  renderChartBase(w, h) {
    const c = parchmentCanvas(w, h);
    const ctx = c.getContext('2d');
    const t = this.game.terrain;
    const v = this.chartView(w, h);
    // land from the heightmap
    const img = ctx.getImageData(0, 0, w, h);
    const step = 1;
    for (let py = 0; py < h; py += step) {
      for (let px = 0; px < w; px += step) {
        const [x, z] = v.toWorld(px, py);
        const hgt = t.quickHeight(x, z);
        const k = (py * w + px) * 4;
        if (hgt > 0.3) {
          const f = clamp(hgt / 150, 0, 1);
          img.data[k] *= 0.82 - f * 0.25; img.data[k + 1] *= 0.74 - f * 0.25; img.data[k + 2] *= 0.55 - f * 0.2;
        } else if (hgt > -6) {
          img.data[k] *= 0.9; img.data[k + 1] *= 0.95; img.data[k + 2] *= 0.92;
        }
      }
    }
    // coast ink
    const d = new Uint8ClampedArray(img.data);
    for (let py = 1; py < h - 1; py++) {
      for (let px = 1; px < w - 1; px++) {
        const [x, z] = v.toWorld(px, py);
        const land = t.quickHeight(x, z) > 0.3;
        if (!land) continue;
        const [xl] = v.toWorld(px - 1, py); const [xr] = v.toWorld(px + 1, py);
        const [, zu] = v.toWorld(px, py - 1); const [, zd] = v.toWorld(px, py + 1);
        if (t.quickHeight(xl, z) <= 0.3 || t.quickHeight(xr, z) <= 0.3 || t.quickHeight(x, zu) <= 0.3 || t.quickHeight(x, zd) <= 0.3) {
          const k = (py * w + px) * 4;
          img.data[k] = 58; img.data[k + 1] = 38; img.data[k + 2] = 20;
        }
      }
    }
    ctx.putImageData(img, 0, 0);
    // rhumb lines from a compass rose (portolan style)
    const [rx, ry] = v.toPx(-5200, -600);
    ctx.strokeStyle = 'rgba(90,60,30,0.22)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 32; i++) {
      const a = (i / 32) * Math.PI * 2;
      ctx.beginPath(); ctx.moveTo(rx, ry); ctx.lineTo(rx + Math.cos(a) * w * 2, ry + Math.sin(a) * w * 2); ctx.stroke();
    }
    drawRose(ctx, rx, ry, Math.min(w, h) * 0.09);
    // island names
    ctx.fillStyle = 'rgba(58,38,20,0.9)';
    ctx.textAlign = 'center';
    for (const is of ISLANDS) {
      const [px, py] = v.toPx(is.x, is.z);
      const big = is.rx > 800;
      ctx.font = `italic ${big ? 26 : 16}px "IM Fell English", serif`;
      ctx.fillText(is.name, px, py + (big ? 8 : is.rz * v.s + 16));
    }
    ctx.font = `italic 30px "IM Fell English", serif`;
    ctx.fillStyle = 'rgba(58,38,20,0.55)';
    ctx.fillText('The Gulf of Florida', ...v.toPx(-2600, -6200));
    ctx.fillText('Mar del Norte', ...v.toPx(4200, -7200));
    ctx.fillText('The Caribbean Sea', ...v.toPx(-1000, 1500));
    ctx.font = `44px "Pirata One", serif`;
    ctx.fillStyle = 'rgba(58,38,20,0.8)';
    ctx.textAlign = 'left';
    ctx.fillText('A New Chart of the West Indies', 30, 56);
    ctx.font = `italic 18px "IM Fell English", serif`;
    ctx.fillText('drawn from the latest observations · MDCCXVI', 34, 82);
    this.chartView_ = v;
    return c;
  }

  drawChart() {
    const cv = $('chart-canvas');
    const ctx = cv.getContext('2d');
    const g = this.game;
    ctx.drawImage(this.chartBase, 0, 0);
    const v = this.chartView(cv.width, cv.height);
    const s = g.state;
    // ports
    for (const p of PORTS) {
      const town = g.towns[p.id];
      const [px, py] = v.toPx(town.coast.x, town.coast.z);
      const known = s.discovered.includes(p.id);
      const img = new Image();
      ctx.fillStyle = known ? '#8a1d1d' : '#6a5a40';
      ctx.beginPath(); ctx.arc(px, py, 7, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#2a1d10'; ctx.lineWidth = 2; ctx.stroke();
      ctx.font = `bold 20px "IM Fell English SC", serif`;
      ctx.fillStyle = '#2a1d10';
      ctx.textAlign = 'left';
      ctx.fillText(p.name, px + 12, py - 6);
      ctx.font = `italic 14px "IM Fell English", serif`;
      ctx.fillText(NATIONS[p.nation].adj + (known ? '' : ' (undiscovered)'), px + 12, py + 12);
      const fi = this._flagImgs || (this._flagImgs = {});
      if (!fi[p.nation]) { fi[p.nation] = new Image(); fi[p.nation].src = flagImg(NATIONS[p.nation].flag); fi[p.nation].onload = () => this.top() === 'chart' && this.drawChart(); }
      if (fi[p.nation].complete) ctx.drawImage(fi[p.nation], px - 12, py - 30, 24, 15);
    }
    // salvage camp
    if (g.salvage) {
      const [px, py] = v.toPx(g.salvage.coast3.x, g.salvage.coast3.z);
      ctx.fillStyle = '#2a1d10'; ctx.font = `italic 15px "IM Fell English", serif`; ctx.textAlign = 'right';
      ctx.fillText('Wrecks of the 1715 Flota ✝', px - 10, py);
    }
    // treasure
    for (const m of s.treasureMaps) {
      if (m.found) continue;
      const [px, py] = v.toPx(m.x, m.z);
      ctx.strokeStyle = '#a01818'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(px - 9, py - 9); ctx.lineTo(px + 9, py + 9); ctx.moveTo(px + 9, py - 9); ctx.lineTo(px - 9, py + 9); ctx.stroke();
    }
    // objective
    const mk = g.missions.marker();
    if (mk) {
      const [px, py] = v.toPx(mk.x, mk.z);
      ctx.strokeStyle = '#d89a1a'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(px, py, 14, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(px, py, 4, 0, Math.PI * 2); ctx.fillStyle = '#d89a1a'; ctx.fill();
    }
    // player
    const f = g.focus;
    const [px, py] = v.toPx(f.x, f.z);
    ctx.save();
    ctx.translate(px, py);
    const hd = g.mode === 'sail' ? g.playerShip.heading : 0;
    ctx.rotate(-hd);
    ctx.fillStyle = '#111'; ctx.strokeStyle = '#f3d58a'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, -14); ctx.lineTo(8, 10); ctx.lineTo(0, 5); ctx.lineTo(-8, 10); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore();
    $('chart-info').textContent = g.canFastTravel() ? 'Click a discovered port to set a course there (fast travel).' : g.fastTravelBlockReason();
  }

  chartHit(e) {
    const cv = $('chart-canvas');
    const rect = cv.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * cv.width, py = ((e.clientY - rect.top) / rect.height) * cv.height;
    const v = this.chartView(cv.width, cv.height);
    for (const p of PORTS) {
      const town = this.game.towns[p.id];
      const [x, y] = v.toPx(town.coast.x, town.coast.z);
      if (Math.hypot(px - x, py - y) < 26) return p;
    }
    return null;
  }

  chartHover(e) {
    const p = this.chartHit(e);
    const g = this.game;
    if (p) $('chart-info').textContent = `${p.name} — ${p.desc}${g.state.discovered.includes(p.id) ? '' : ' (undiscovered)'}`;
    else $('chart-info').textContent = g.canFastTravel() ? 'Click a discovered port to set a course there (fast travel).' : g.fastTravelBlockReason();
  }

  chartClick(e) {
    const p = this.chartHit(e);
    const g = this.game;
    if (!p) return;
    if (!g.state.discovered.includes(p.id)) return this.toast(`You have not yet found ${p.name}.`, 'warn');
    if (!g.canFastTravel()) return this.toast(g.fastTravelBlockReason(), 'warn');
    this.closeAll();
    g.fastTravel(p.id);
  }

  // ---------------------------------------------------------------- shops
  openShop(type, town) {
    this.shop = { type, town, tab: null };
    const titles = { tavern: 'The Tavern', merchant: 'Merchant', shipwright: 'Shipwright', governor: town.port.nation === 'pirate' ? 'Council of Captains' : 'Governor\'s House' };
    $('shop-title').textContent = `${titles[type]} · ${town.port.name}`;
    const tabs = {
      tavern: ['Crew', 'Contracts', 'Rumours', 'Rest'],
      merchant: ['Trade'],
      shipwright: ['Repairs', 'Refit', 'Ships'],
      governor: ['Audience'],
    }[type];
    this.shop.tab = tabs[0];
    $('shop-tabs').innerHTML = tabs.map((t) => `<button data-tab="${t}">${t}</button>`).join('');
    $('shop-tabs').onclick = (e) => { const t = e.target.dataset.tab; if (t) { this.shop.tab = t; this.game.audio.ui('click'); this.renderShop(); } };
    if (type === 'tavern') this.game.audio.setMusic('tavern');
    this.game.audio.ui('open');
    this.openModal('shop');
    this.renderShop();
  }

  renderShop() {
    const { type, town, tab } = this.shop;
    const g = this.game, s = g.state;
    [...$('shop-tabs').children].forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    $('shop-gold').innerHTML = `<span class="coin" style="width:16px;height:16px;vertical-align:-2px"></span> ${Math.floor(s.gold).toLocaleString()}`;
    const body = $('shop-body');
    const portId = town.port.id;
    const cls = SHIP_CLASSES[s.ship.cls];
    let html = '';
    if (type === 'merchant') {
      const room = g.playerCargoRoom();
      html += `<p class="note">Hold: ${s.cargoCount()} / ${cls.cargo} · Prices in pieces of eight per unit.</p><table class="trade"><tr><th>Goods</th><th class="num">In hold</th><th class="num">Buy</th><th class="num">Sell</th><th></th></tr>`;
      for (const [k, good] of Object.entries(GOODS)) {
        const buy = s.price(portId, k), sell = s.sellPrice(portId, k);
        const have = s.ship.cargo[k] || 0;
        const tag = town.port.produces.includes(k) ? 'cheap' : town.port.demands.includes(k) ? 'dear' : '';
        const canBuy = k !== 'silver';
        html += `<tr><td class="${tag}">${good.name} <small>(${good.unit})</small></td><td class="num">${have}</td><td class="num">${canBuy ? buy : '—'}</td><td class="num">${sell}</td><td class="num">
          ${canBuy ? `<button data-buy="${k}" data-n="1" ${s.gold < buy || room < 1 ? 'disabled' : ''}>+1</button><button data-buy="${k}" data-n="10" ${s.gold < buy * 10 || room < 10 ? 'disabled' : ''}>+10</button>` : ''}
          <button data-sell="${k}" data-n="1" ${have < 1 ? 'disabled' : ''}>−1</button><button data-sell="${k}" data-n="${have}" ${have < 1 ? 'disabled' : ''}>All</button></td></tr>`;
      }
      html += '</table>';
      html += `<div class="row right"><button data-sellall ${s.cargoCount() ? '' : 'disabled'}>Sell entire hold (${s.cargoValue(portId)} ⛁)</button></div>`;
      if (town.port.nation === 'pirate') html += '<p class="note">The fence asks no questions — and pays accordingly.</p>';
    } else if (type === 'shipwright') {
      if (tab === 'Repairs') {
        const hullNeed = Math.ceil(g.playerHullMax() - s.ship.hull), sailNeed = Math.ceil(cls.sails - s.ship.sails);
        const hullCost = hullNeed * 3, sailCost = sailNeed * 2;
        html += `<div class="shop-card"><div class="info"><b>Repair the hull</b><div>${hullNeed} points of damage — shot holes plugged, timbers replaced, seams caulked with oakum and pitch.</div></div><div class="price">${hullCost} ⛁</div><button data-repair="hull" ${hullNeed <= 0 || s.gold < hullCost ? 'disabled' : ''}>Repair</button></div>`;
        html += `<div class="shop-card"><div class="info"><b>Mend the sails & rigging</b><div>${sailNeed} points of damage to canvas and cordage.</div></div><div class="price">${sailCost} ⛁</div><button data-repair="sails" ${sailNeed <= 0 || s.gold < sailCost ? 'disabled' : ''}>Mend</button></div>`;
        html += `<div class="shop-card"><div class="info"><b>Careen & scrape the hull</b><div>Burn off weed and worm for a cleaner bottom. Restores full speed.</div></div><div class="price">60 ⛁</div><button data-careen ${s.gold < 60 ? 'disabled' : ''}>Careen</button></div>`;
      } else if (tab === 'Refit') {
        const up = s.upgrades;
        const items = [
          ['guns', ['6-pounders', '9-pounders', '12-pounders', 'Long 18-pounders'], 'Heavier guns: more damage and range.', [900, 2200, 4800]],
          ['hull', ['Standard planking', 'Doubled oak planking', 'Live-oak frames'], 'Stronger hull: more punishment before she founders.', [1200, 3200]],
          ['sails', ['Old canvas', 'New Holland duck', 'Fine flax canvas'], 'Better sails: more speed on every point of sail.', [800, 2400]],
        ];
        for (const [k, names, desc, costs] of items) {
          const lv = up[k];
          const cost = costs[lv];
          html += `<div class="shop-card"><div class="info"><b>${names[lv]}${cost ? ' → ' + names[lv + 1] : ''}</b><div>${desc}</div></div><div class="price">${cost ? cost + ' ⛁' : 'Finest'}</div><button data-upgrade="${k}" ${!cost || s.gold < cost ? 'disabled' : ''}>Refit</button></div>`;
        }
      } else {
        const trade = Math.floor(cls.price * 0.5 * clamp(s.ship.hull / g.playerHullMax(), 0.3, 1));
        html += `<p class="note">Your ${cls.name} is worth ${trade} ⛁ in part exchange. Guns, cargo and crew transfer to the new ship.</p>`;
        for (const id of town.port.shipyard) {
          const c = SHIP_CLASSES[id];
          const cost = Math.max(0, c.price - trade);
          const cur = id === s.ship.cls;
          html += `<div class="shop-card"><div class="info"><b>${c.name}</b><div>${c.desc} ${c.guns} guns · hull ${c.hull} · hold ${c.cargo} · crew ${c.crewMax}</div></div><div class="price">${cur ? 'Yours' : cost + ' ⛁'}</div><button data-buyship="${id}" ${cur || s.gold < cost ? 'disabled' : ''}>Buy</button></div>`;
        }
      }
    } else if (type === 'tavern') {
      if (tab === 'Crew') {
        const wage = town.port.nation === 'pirate' ? 12 : 22;
        const crew = s.ship.crew;
        const room = cls.crewMax - crew;
        html += `<p>Your crew: <b>${crew}</b> of ${cls.crewMax} berths. A full crew sails faster, reloads quicker and wins boarding fights.</p>`;
        html += `<div class="shop-card"><div class="info"><b>Sign on sailors</b><div>Out-of-work seamen, deserters and bold young hands. ${wage} ⛁ a head for the signing bounty.</div></div>
          <button data-hire="5" ${room < 5 || s.gold < wage * 5 ? 'disabled' : ''}>+5 (${wage * 5})</button>
          <button data-hire="${room}" ${room < 1 || s.gold < wage * room ? 'disabled' : ''}>Fill (${wage * room})</button></div>`;
        html += `<div class="shop-card"><div class="info"><b>Stand the house a round</b><div>Rum for every soul in the tavern. Your name will be sung — and remembered.</div></div><div class="price">60 ⛁</div><button data-round ${s.gold < 60 ? 'disabled' : ''}>Buy</button></div>`;
      } else if (tab === 'Contracts' || tab === 'Rumours') {
        const offers = g.missions.generateContracts(portId);
        const list = tab === 'Contracts' ? offers.filter((o) => o.type !== 'map') : offers.filter((o) => o.type === 'map');
        if (tab === 'Rumours') {
          html += RUMOURS.slice().sort(() => Math.random() - 0.5).slice(0, 2).map((r) => `<div class="rumour">“${r}”</div>`).join('');
        }
        for (const o of list) {
          const taken = s.contracts.some((c) => c.title === o.title) || s.treasureMaps.some((m) => m.island === o.island && !m.found);
          html += `<div class="shop-card"><div class="info"><b>${o.title}</b><div>${o.text}${o.deadline !== undefined ? ` — before ${g.dayToDate(o.deadline)}` : ''}</div></div><div class="price">${o.type === 'map' ? o.price + ' ⛁' : '+' + o.reward + ' ⛁'}</div><button data-offer="${encodeURIComponent(JSON.stringify(o))}" ${taken ? 'disabled' : ''}>${o.type === 'map' ? 'Buy' : 'Accept'}</button></div>`;
        }
        if (!list.length) html += '<p class="note">Nothing on offer here today.</p>';
      } else if (tab === 'Rest') {
        html += `<div class="shop-card"><div class="info"><b>Take a room until morning</b><div>Rest, let the crew carouse and your notoriety cool. The game is saved.</div></div><div class="price">20 ⛁</div><button data-rest ${s.gold < 20 ? 'disabled' : ''}>Rest</button></div>`;
      }
    } else if (type === 'governor') {
      const n = town.port.nation;
      if (n === 'pirate') {
        html += '<p>Captains of the Brethren gather here to settle disputes, divide plunder and plan their next venture.</p>';
        const st = g.missions.stage;
        if (!st) html += '<p class="note">No further orders from the Council. The sea is yours.</p>';
        else html += `<p class="note">Current venture: ${g.missions.current.title} — ${st.text}</p>`;
      } else {
        const lv = s.notoriety[n];
        const cost = Math.ceil(lv) * 450;
        html += `<p>His Excellency the Governor receives you with thinly veiled distaste.</p>`;
        if (lv >= 0.5) html += `<div class="shop-card"><div class="info"><b>Purchase a pardon</b><div>A generous "gift" to the colonial treasury will clear your name with ${NATIONS[n].name}.</div></div><div class="price">${cost} ⛁</div><button data-pardon="${n}" ${s.gold < cost ? 'disabled' : ''}>Pay</button></div>`;
        else html += '<p class="note">You are in good standing here. For now.</p>';
      }
    }
    body.innerHTML = html;
    body.onclick = (e) => this.shopClick(e);
  }

  shopClick(e) {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    const g = this.game, s = g.state;
    const { town } = this.shop;
    const portId = town.port.id;
    const d = b.dataset;
    const cls = SHIP_CLASSES[s.ship.cls];
    if (d.buy) {
      const n = Math.min(+d.n, g.playerCargoRoom(), Math.floor(s.gold / s.price(portId, d.buy)));
      if (n <= 0) return;
      s.gold -= n * s.price(portId, d.buy);
      s.ship.cargo[d.buy] = (s.ship.cargo[d.buy] || 0) + n;
      s.nudgeMarket(portId, d.buy, n * 0.004);
      g.audio.coins();
    } else if (d.sell) {
      const n = Math.min(+d.n, s.ship.cargo[d.sell] || 0);
      if (n <= 0) return;
      const earned = n * s.sellPrice(portId, d.sell);
      s.gold += earned;
      s.ship.cargo[d.sell] -= n;
      s.nudgeMarket(portId, d.sell, -n * 0.004);
      g.audio.coins();
      g.missions.onEvent({ type: 'sold', port: portId });
    } else if (d.sellall !== undefined) {
      const v = s.cargoValue(portId);
      s.gold += v;
      for (const k in s.ship.cargo) { s.nudgeMarket(portId, k, -s.ship.cargo[k] * 0.004); s.ship.cargo[k] = 0; }
      g.audio.coins();
      this.toast(`Sold the hold for ${v} pieces of eight.`, 'good');
    } else if (d.repair) {
      if (d.repair === 'hull') { const n = Math.ceil(g.playerHullMax() - s.ship.hull); s.gold -= n * 3; s.ship.hull = g.playerHullMax(); }
      else { const n = Math.ceil(cls.sails - s.ship.sails); s.gold -= n * 2; s.ship.sails = cls.sails; }
      g.syncPlayerShipFromState();
      g.audio.ui('click');
    } else if (d.careen !== undefined) {
      s.gold -= 60; this.toast('The hull is scraped clean.', 'good');
    } else if (d.upgrade) {
      const costs = { guns: [900, 2200, 4800], hull: [1200, 3200], sails: [800, 2400] }[d.upgrade];
      const c = costs[s.upgrades[d.upgrade]];
      s.gold -= c;
      s.upgrades[d.upgrade]++;
      if (d.upgrade === 'hull') s.ship.hull = g.playerHullMax();
      g.rebuildPlayerShip();
      g.audio.ui('fanfare');
      this.toast('Refit complete.', 'good');
    } else if (d.buyship) {
      const trade = Math.floor(cls.price * 0.5 * clamp(s.ship.hull / g.playerHullMax(), 0.3, 1));
      const c = SHIP_CLASSES[d.buyship];
      const cost = Math.max(0, c.price - trade);
      if (s.cargoCount() > c.cargo) return this.toast('Your cargo will not fit in her hold. Sell some first.', 'warn');
      s.gold -= cost;
      s.ship.cls = d.buyship;
      s.ship.hull = g.playerHullMax();
      s.ship.sails = c.sails;
      s.ship.crew = Math.min(s.ship.crew, c.crewMax);
      g.rebuildPlayerShip();
      g.audio.ui('fanfare');
      this.toast(`The ${c.name} ${s.shipName} is yours!`, 'good');
    } else if (d.hire) {
      const wage = town.port.nation === 'pirate' ? 12 : 22;
      const n = Math.min(+d.hire, cls.crewMax - s.ship.crew, Math.floor(s.gold / wage));
      s.gold -= n * wage;
      s.ship.crew += n;
      g.syncPlayerShipFromState();
      g.audio.coins();
    } else if (d.round !== undefined) {
      s.gold -= 60; s.renown += 1;
      this.toast('The tavern roars your name!', 'good');
      g.audio.coins();
    } else if (d.offer) {
      const o = JSON.parse(decodeURIComponent(d.offer));
      g.missions.acceptContract(o);
    } else if (d.rest !== undefined) {
      s.gold -= 20;
      this.closeAll();
      g.restUntilMorning();
      return;
    } else if (d.pardon) {
      const cost = Math.ceil(s.notoriety[d.pardon]) * 450;
      s.gold -= cost;
      s.notoriety[d.pardon] = 0;
      g.audio.coins();
      this.toast(`Pardoned by ${NATIONS[d.pardon].name}.`, 'good');
    }
    this.renderShop();
  }
}

const RUMOURS = [
  'They say Sam Bellamy took a slave ship called the Whydah, and her hold was stuffed with gold.',
  'A Spanish sloop was seen dragging for silver off the Florida reefs — the divers come up with coins by the handful.',
  'The Governor of Jamaica swears he\'ll hang every man-jack in Nassau. Let him come!',
  'Captain Thache has taken to wearing lit slow-match under his hat. Frightens the merchants half to death.',
  'Beware Andros at night — the reefs there have torn the bottom out of better ships than yours.',
  'The French in Cayona pay dearly for rum. The English in Port Royal pay dearly for cacao.',
  'A dying buccaneer told me he buried his share on some cay near Cuba. Maps turn up in taverns now and then.',
  'Chain shot will strip a merchantman\'s rigging bare. Grape, well — grape is for the men.',
  'Fly the King\'s colours and you can sail right up to a merchant before she knows you. Hoist the black when it\'s too late for her.',
  'The Spanish treasure galleons can outgun any three sloops. Take out her sails first, then keep off her broadside.',
  'When the sky turns green in the west, get your topsails in. The squalls here come on like the wrath of God.',
  'Navy frigates don\'t chase long if you slip out of sight. Lie low a few days and they\'ll forget your face.',
];

function pointOfSail(p) {
  if (p.anchored) return 'At anchor';
  if (p.sailTarget === 0) return 'Sails furled';
  const t = p.effTheta;
  if (p.eff < 0.25) return 'In irons — bear away!';
  if (t < 0.5) return 'Running before the wind';
  if (t < 1.25) return 'Broad reach';
  if (t < 1.95) return 'Beam reach';
  return 'Close-hauled';
}

function windName(w) {
  // direction the wind is coming FROM
  const b = (Math.atan2(-w.x, w.z) * 180) / Math.PI;
  const names = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const i = Math.round((((b + 360) % 360) / 45)) % 8;
  return `from the ${names[i]}`;
}
function windForce(s) {
  if (s < 0.7) return '· light airs';
  if (s < 0.9) return '· gentle breeze';
  if (s < 1.1) return '· fresh breeze';
  if (s < 1.25) return '· strong breeze';
  return '· gale';
}

function drawRose(ctx, x, y, r) {
  ctx.save();
  ctx.translate(x, y);
  for (let i = 0; i < 8; i++) {
    ctx.rotate(Math.PI / 4);
    const len = i % 2 ? r * 0.6 : r;
    ctx.fillStyle = i % 2 ? '#6a4a2a' : '#8a1d1d';
    ctx.beginPath(); ctx.moveTo(0, -len); ctx.lineTo(r * 0.12, 0); ctx.lineTo(0, r * 0.12); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#e9d9b4';
    ctx.beginPath(); ctx.moveTo(0, -len); ctx.lineTo(-r * 0.12, 0); ctx.lineTo(0, r * 0.12); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#3a2410'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, -len); ctx.lineTo(r * 0.12, 0); ctx.lineTo(-r * 0.12, 0); ctx.closePath(); ctx.stroke();
  }
  ctx.beginPath(); ctx.arc(0, 0, r * 0.15, 0, Math.PI * 2); ctx.fillStyle = '#c9a13a'; ctx.fill(); ctx.stroke();
  ctx.font = `bold ${r * 0.3}px "IM Fell English SC", serif`;
  ctx.fillStyle = '#3a2410'; ctx.textAlign = 'center';
  ctx.fillText('N', 0, -r - 6);
  ctx.restore();
}
