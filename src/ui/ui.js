// DOM user interface: HUD, minimap, sea chart, shops, dialogs and menus.
import { PORTS, ISLANDS, GOODS, SHIP_CLASSES, NATIONS, AMMO, SALVAGE_CAMP, at } from '../game/data.js';
import { WORLD_HALF } from '../world/terrain.js';
import { lonLat, LON0, LAT0, GEO_SCALE } from '../game/geo.js';
import { flagTexture, parchmentCanvas } from '../core/textures.js';
import { clamp } from '../core/noise.js';
import { saveSettings } from '../game/state.js';
import { makeCaptain } from '../game/fleet.js';
import { TIERS, EXTRAS, refitCost, emptyRefit } from '../game/refits.js';

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
    const touchOnly = window.matchMedia && !window.matchMedia('(pointer: fine)').matches;
    if (touchOnly) $('save-summary').textContent += (has ? ' — ' : '') + 'Best played on a computer with keyboard and mouse.';
    $('newgame').classList.add('hidden');
    $('title-menu').classList.remove('hidden');
  }
  hideTitle() { $('title').classList.add('hidden'); $('hud').classList.remove('hidden'); }

  bindMenus() {
    const g = this.game;
    // Never leave keyboard focus on a clicked button: Space/Enter would re-trigger it mid-game.
    document.addEventListener('click', (e) => {
      const b = e.target.closest && e.target.closest('button');
      if (b) setTimeout(() => b.blur(), 0);
    }, true);
    window.addEventListener('scroll', () => { if (window.scrollY || window.scrollX) window.scrollTo(0, 0); });
    // ?start=havana preselects where a new game begins (handy for testing)
    const qs = new URLSearchParams(location.search).get('start');
    if (qs && $('start-port').querySelector(`option[value="${CSS.escape(qs)}"]`)) $('start-port').value = qs;
    $('title').addEventListener('click', (e) => {
      const act = e.target.closest('button')?.dataset.act;
      if (!act) return;
      g.audio.init();
      g.audio.ui('click');
      if (act === 'continue') g.continueGame();
      if (act === 'new') { $('newgame').classList.remove('hidden'); $('title-menu').classList.add('hidden'); $('captain-name').focus(); }
      if (act === 'back') { $('newgame').classList.add('hidden'); $('title-menu').classList.remove('hidden'); }
      if (act === 'begin') g.newGame($('captain-name').value.trim() || 'James Kidd', $('ship-name').value.trim() || 'Ranger', $('start-port').value);
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
      if (act === 'quit') { g.quitToTitle(); this.closeAll(); }
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
    this.initChartControls();
  }

  openModal(id) {
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
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
  hideClickToPlay() { this._needClick = false; $('click-to-play').classList.add('hidden'); }
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

  // the controls along the bottom of the screen; `sticky` keeps them there (at the helm), otherwise they fade
  hint(text, sticky = false) {
    const el = $('hint');
    el.innerHTML = text.replace(/\[([^\]]+)\]/g, '<kbd>$1</kbd>');
    el.classList.remove('hidden', 'fade');
    el.classList.toggle('sticky', sticky);
    clearTimeout(this._hintT);
    if (!sticky) this._hintT = setTimeout(() => el.classList.add('fade'), 14000);
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
        if (this.dialogQueue?.length && this.top() !== 'dialog') this.showNextDialog();
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
    const needClick = !g.input.locked && !this.anyModal();
    if (needClick !== this._needClick) { this._needClick = needClick; $('click-to-play').classList.toggle('hidden', !needClick); }
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
      $('bar-crew').style.width = `${clamp(p.crew / (p.crewMax ?? p.cls.crewMax), 0, 1) * 100}%`;
      $('crew-val').textContent = p.crew;
      $('speed-val').textContent = p.speedKnots.toFixed(1);
      // point of sail, and the apparent wind, heel and leeway a sailing master would watch
      const deg = (r) => Math.round(Math.abs(r) * 180 / Math.PI);
      const leeway = Math.abs(p.speed) > 1 ? deg(Math.atan2(p.sway || 0, Math.abs(p.speed))) : 0;
      $('pos-sail').innerHTML = `${pointOfSail(p)}<br><small>apparent wind ${deg(p.aw?.beta ?? 0)}° ${p.aw?.side > 0 ? 'to port' : 'to starboard'} · ${(p.aw?.speed * 0.45 || 0).toFixed(0)} kn · heel ${deg(p.heel || 0)}° · leeway ${leeway}°</small>`;
      $('pos-sail').className = (p.backed || p.luff > 0.5 || p.eff < 0.2) && p.sailTarget > 0 ? 'bad' : '';
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
    const radius = foot ? 140 : 1400; // world units shown to the edge
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
      const col = s.role === 'consort' ? '#6fc3ff' : s.struck ? '#cfcfcf' : g.isHostile(s, g.playerShip) ? '#e5412d' : s.mission ? '#f3d58a' : '#f2ead8';
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
  // The sea chart zooms (wheel, or the + and − buttons) and pans (drag). The land is inked from the terrain once
  // for the whole chart, and again in finer detail for the part in view whenever you stop zooming in on a coast.
  // Names, rhumb lines, the graticule and every marker are drawn fresh at each view so they stay sharp.
  openChart() {
    const cv = $('chart-canvas');
    this.openModal('chart');
    const rect = cv.getBoundingClientRect();
    cv.width = Math.floor(rect.width * Math.min(2, devicePixelRatio));
    cv.height = Math.floor(rect.height * Math.min(2, devicePixelRatio));
    if (!this.chartBase || this.chartBase.c.width !== cv.width || this.chartBase.c.height !== cv.height) {
      this.chartPaper = parchmentCanvas(cv.width, cv.height);
      const z = this.chartZ;
      this.chartZ = { k: 1, cx: 0, cz: 0 };
      this.chartBase = this.renderLand(cv.width, cv.height, this.chartView(cv.width, cv.height));
      this.chartZ = z || this.chartZ;
      this.chartDetail = null;
    }
    this.drawChart();
    this.scheduleChartDetail();
  }

  initChartControls() {
    const cv = $('chart-canvas');
    const toCanvas = (e) => { const r = cv.getBoundingClientRect(); return [((e.clientX - r.left) / r.width) * cv.width, ((e.clientY - r.top) / r.height) * cv.height]; };
    cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.zoomChart(Math.exp(-e.deltaY * (e.deltaMode ? 0.05 : 0.0015)), ...toCanvas(e));
    }, { passive: false });
    cv.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      const [px, py] = toCanvas(e);
      this.chartDrag = { px, py, moved: 0 };
    });
    window.addEventListener('mousemove', (e) => {
      const d = this.chartDrag;
      if (!d || this.top() !== 'chart') return;
      const [px, py] = toCanvas(e);
      const v = this.chartView(cv.width, cv.height);
      d.moved += Math.hypot(px - d.px, py - d.py);
      this.chartZ.cx -= (px - d.px) / v.s; this.chartZ.cz -= (py - d.py) / v.s;
      d.px = px; d.py = py;
      if (d.moved > 6) { cv.style.cursor = 'grabbing'; this.drawChart(); }
    });
    window.addEventListener('mouseup', () => {
      const d = this.chartDrag;
      if (!d) return;
      cv.style.cursor = '';
      this.chartDragged = d.moved > 6;
      this.chartDrag = null;
      if (this.chartDragged) this.scheduleChartDetail();
    });
    const wrap = cv.parentElement;
    const bar = document.createElement('div');
    bar.className = 'chart-zoom';
    bar.innerHTML = '<button data-z="in" title="Zoom in">+</button><button data-z="out" title="Zoom out">−</button><button data-z="ship" title="Centre on your ship">⌖</button><button data-z="all" title="Whole chart">⤢</button>';
    bar.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      e.stopPropagation();
      const z = b.dataset.z;
      if (z === 'in') this.zoomChart(1.6);
      else if (z === 'out') this.zoomChart(1 / 1.6);
      else if (z === 'ship') { const f = this.game.focus; this.chartZ.cx = f.x; this.chartZ.cz = f.z; if (this.chartZ.k < 3) this.chartZ.k = 4; this.drawChart(); this.scheduleChartDetail(); }
      else { this.chartZ = { k: 1, cx: 0, cz: 0 }; this.chartDetail = null; this.drawChart(); }
      this.game.audio.ui('click');
    });
    wrap.appendChild(bar);
    window.addEventListener('keydown', (e) => {
      if (this.top() !== 'chart') return;
      if (e.key === '+' || e.key === '=') this.zoomChart(1.6);
      else if (e.key === '-' || e.key === '_') this.zoomChart(1 / 1.6);
    });
  }

  // zoom by a factor about a point on the canvas (the centre if none)
  zoomChart(f, px, py) {
    const cv = $('chart-canvas');
    if (px === undefined) { px = cv.width / 2; py = cv.height / 2; }
    const z = this.chartZ;
    const before = this.chartView(cv.width, cv.height).toWorld(px, py);
    z.k = clamp(z.k * f, 1, 16);
    // keep the point under the cursor where it is
    const v = this.chartView(cv.width, cv.height), after = v.toWorld(px, py);
    z.cx += before[0] - after[0]; z.cz += before[1] - after[1];
    this.drawChart();
    this.scheduleChartDetail();
  }

  // once the view settles: ink the coasts in view again, from the true terrain, a strip at a time so the chart
  // stays responsive (a newer view abandons the old work)
  scheduleChartDetail() {
    clearTimeout(this._chartDT);
    const job = this._chartJob = {};
    if (this.chartZ.k < 1.25) return;
    this._chartDT = setTimeout(() => {
      if (this.top() !== 'chart' || this.chartDrag) return;
      const cv = $('chart-canvas');
      const r = this.chartZ.k > 3 ? 0.75 : 0.5;
      const w = Math.round(cv.width * r), h = Math.round(cv.height * r);
      const v = this.chartView(cv.width, cv.height);
      const sub = { toWorld: (px, py) => v.toWorld(px / r, py / r), s: v.s * r, ox: v.ox * r, oz: v.oz * r };
      const t = this.game.terrain;
      this.renderLand(w, h, sub, (x, z) => t.height(x, z), job, (L) => { if (this._chartJob === job && this.top() === 'chart') { this.chartDetail = L; this.drawChart(); } });
    }, 200);
  }

  chartView(w, h) {
    // world bounds shown on the whole chart: Florida to the Caribbean coast of Hispaniola
    const x0 = -14800, x1 = 14800, z0 = -13200, z1 = 11600;
    const z = this.chartZ || (this.chartZ = { k: 1, cx: 0, cz: 0 });
    const s = Math.min(w / (x1 - x0), h / (z1 - z0)) * z.k;
    // keep the view on the chart
    const hw = w / 2 / s, hh = h / 2 / s;
    z.cx = x1 - x0 > hw * 2 ? clamp(z.cx, x0 + hw, x1 - hw) : (x0 + x1) / 2;
    z.cz = z1 - z0 > hh * 2 ? clamp(z.cz, z0 + hh, z1 - hh) : (z0 + z1) / 2;
    const ox = w / 2 - z.cx * s, oz = h / 2 - z.cz * s;
    return { toPx: (x, zz) => [ox + x * s, oz + zz * s], toWorld: (px, py) => [(px - ox) / s, (py - oz) / s], s, ox, oz, k: z.k, w, h };
  }

  // the land, as a layer to multiply over the paper: white sea, buff shallows, brown hills, inked coasts.
  // With `job` and `done` it works through the heights in slices between frames and hands the layer over at the end.
  renderLand(w, h, v, heightAt = (x, z) => this.game.terrain.quickHeight(x, z), job = null, done = null) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    const H = new Float32Array(w * h);
    const finish = () => {
      const img = ctx.createImageData(w, h);
      for (let py = 0; py < h; py++) {
        for (let px = 0; px < w; px++) {
          const i = py * w + px, k = i * 4, hgt = H[i];
          let r = 255, gg = 255, b = 255;
          if (hgt > 0.3) {
            const f = clamp(hgt / 150, 0, 1);
            r = 255 * (0.82 - f * 0.25); gg = 255 * (0.74 - f * 0.25); b = 255 * (0.55 - f * 0.2);
            // the coast, inked
            if ((px > 0 && H[i - 1] <= 0.3) || (px < w - 1 && H[i + 1] <= 0.3) || (py > 0 && H[i - w] <= 0.3) || (py < h - 1 && H[i + w] <= 0.3)) { r = 64; gg = 45; b = 28; }
          } else if (hgt > -6) { r = 230; gg = 242; b = 235; }
          img.data[k] = r; img.data[k + 1] = gg; img.data[k + 2] = b; img.data[k + 3] = 255;
        }
      }
      ctx.putImageData(img, 0, 0);
      return { c, s: v.s, ox: v.ox, oz: v.oz };
    };
    const rows = (a, b) => { for (let py = a; py < b; py++) for (let px = 0; px < w; px++) { const [x, z] = v.toWorld(px + 0.5, py + 0.5); H[py * w + px] = heightAt(x, z); } };
    if (!done) { rows(0, h); return finish(); }
    let y = 0;
    const slice = () => {
      if (this._chartJob !== job) return;
      const t0 = performance.now();
      while (y < h && performance.now() - t0 < 24) { rows(y, Math.min(h, y + 8)); y += 8; }
      if (y < h) setTimeout(slice, 0); else done(finish());
    };
    slice();
    return null;
  }

  drawChart() {
    const cv = $('chart-canvas');
    const ctx = cv.getContext('2d');
    const g = this.game, s = g.state;
    const W = cv.width, Hh = cv.height;
    const v = this.chartView(W, Hh);
    const k = v.k;
    // paper, then the land layers mapped into this view
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.chartPaper, 0, 0);
    const land = this._chartLand || (this._chartLand = document.createElement('canvas'));
    if (land.width !== W || land.height !== Hh) { land.width = W; land.height = Hh; }
    const lc = land.getContext('2d');
    lc.setTransform(1, 0, 0, 1, 0, 0);
    lc.fillStyle = '#fff'; lc.fillRect(0, 0, W, Hh);
    lc.imageSmoothingEnabled = true;
    for (const L of [this.chartBase, this.chartDetail]) {
      if (!L) continue;
      const m = v.s / L.s;
      lc.setTransform(m, 0, 0, m, v.ox - L.ox * m, v.oz - L.oz * m);
      lc.drawImage(L.c, 0, 0);
    }
    lc.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'multiply';
    ctx.drawImage(land, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    const fs = Math.min(1.5, 1 + Math.log2(k) * 0.12); // (lettering grows a little as you close in)
    // the graticule: a line each degree, numbered round the margin
    ctx.strokeStyle = 'rgba(90,60,30,0.2)'; ctx.lineWidth = 1; ctx.setLineDash([2, 6]);
    ctx.font = `italic ${Math.round(13 * fs)}px "IM Fell English", serif`; ctx.fillStyle = 'rgba(58,38,20,0.7)';
    const step = [0.25, 0.5, 1, 2].find((d) => at(LON0 + d, LAT0)[0] * v.s - at(LON0, LAT0)[0] * v.s > 120 * fs) || 2;
    const ll0 = lonLat(...v.toWorld(0, Hh)), ll1 = lonLat(...v.toWorld(W, 0));
    const deg = (d, pos, neg) => { const a = Math.abs(d), dd = Math.floor(a + 1e-6), mm = Math.round((a - dd) * 60); return `${dd}°${mm ? ` ${mm}′` : ''} ${d >= 0 ? pos : neg}`; };
    for (let lon = Math.ceil(ll0.lon / step) * step; lon < ll1.lon; lon += step) {
      const [px] = v.toPx(...at(lon, LAT0));
      ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, Hh); ctx.stroke();
      ctx.textAlign = 'center'; ctx.fillText(deg(lon, 'E', 'W'), px, 18 * fs);
    }
    for (let lat = Math.ceil(ll0.lat / step) * step; lat < ll1.lat; lat += step) {
      const [, py] = v.toPx(...at(LON0, lat));
      ctx.beginPath(); ctx.moveTo(0, py); ctx.lineTo(W, py); ctx.stroke();
      ctx.textAlign = 'left'; ctx.fillText(deg(lat, 'N', 'S'), 8, py - 4);
    }
    ctx.setLineDash([]);
    // rhumb lines from a compass rose (portolan style)
    const [rx, ry] = v.toPx(...at(-70.6, 25.2));
    ctx.strokeStyle = 'rgba(90,60,30,0.2)';
    for (let i = 0; i < 32; i++) {
      const a = (i / 32) * Math.PI * 2;
      ctx.beginPath(); ctx.moveTo(rx, ry); ctx.lineTo(rx + Math.cos(a) * W * 4 * k, ry + Math.sin(a) * W * 4 * k); ctx.stroke();
    }
    drawRose(ctx, rx, ry, Math.min(W, Hh) * 0.09 * Math.min(2, Math.sqrt(k)));
    const on = (px, py, m = 80) => px > -m && py > -m && px < W + m && py < Hh + m;
    const label = (txt, lon, lat, o = {}) => {
      if (k < (o.min || 1) || (o.max && k > o.max)) return;
      const [px, py] = v.toPx(...at(lon, lat));
      if (!on(px, py, 300)) return;
      ctx.save();
      ctx.translate(px, py);
      if (o.rot) ctx.rotate(o.rot);
      ctx.font = `${o.style || 'italic'} ${Math.round((o.size || 16) * fs)}px "${o.face || 'IM Fell English'}", serif`;
      ctx.fillStyle = o.color || 'rgba(58,38,20,0.75)';
      ctx.textAlign = o.align || 'center';
      if (o.spaced) ctx.letterSpacing = `${Math.round(o.spaced * fs)}px`;
      if (o.dot) {
        ctx.beginPath(); ctx.arc(0, 0, o.dot, 0, Math.PI * 2);
        if (o.ring) { ctx.strokeStyle = ctx.fillStyle; ctx.lineWidth = 1.5; ctx.stroke(); } else ctx.fill();
      }
      const lines = txt.split('\n');
      lines.forEach((ln, i) => ctx.fillText(ln, o.dx ?? (o.dot ? 8 : 0), (o.dy ?? (o.dot ? 5 : 0)) + (i - (lines.length - 1) / 2) * (o.size || 16) * fs * 1.15));
      ctx.restore();
    };
    // seas and gulfs
    for (const [t, lon, lat, rot] of CHART_SEAS) label(t, lon, lat, { size: 30, color: 'rgba(58,38,20,0.5)', spaced: 3, rot });
    // channels, passages and sounds
    for (const [t, lon, lat, rot, min] of CHART_PASSAGES) label(t, lon, lat, { size: 17, color: 'rgba(40,60,90,0.75)', rot, min });
    // banks, reefs and shoals
    for (const [t, lon, lat, min] of CHART_BANKS) label(t, lon, lat, { size: 14, color: 'rgba(90,60,30,0.7)', min: min || 1.4 });
    // the lands: Spanish and French Hispaniola, the Floridas
    for (const [t, lon, lat, min] of CHART_REGIONS) label(t, lon, lat, { size: 15, style: '', face: 'IM Fell English SC', color: 'rgba(58,38,20,0.5)', spaced: 5, min });
    // island names (little cays when close in)
    ctx.textAlign = 'center';
    for (const is of ISLANDS) {
      const named = is.name && is.name !== 'cay';
      if (!named || (is.minor && k < 2.2)) continue;
      const [px, py] = v.toPx(is.x, is.z);
      if (!on(px, py, 300)) continue;
      const big = is.rx > 2500;
      ctx.font = `italic ${Math.round((big ? 26 : is.minor ? 14 : 16) * fs)}px "IM Fell English", serif`;
      ctx.fillStyle = 'rgba(58,38,20,0.9)';
      ctx.fillText(is.name, px, py + (big ? 8 : is.rz * v.s + 16 * fs));
    }
    // capes and points
    for (const [t, lon, lat, align] of CHART_CAPES) label(t, lon, lat, { size: 13, min: 1.7, dot: 2.5, align: align || 'left', dx: align === 'right' ? -7 : 7, dy: 4, color: 'rgba(58,38,20,0.85)' });
    // towns and settlements you cannot (yet) put in at
    for (const [t, lon, lat, align] of CHART_TOWNS) label(t, lon, lat, { size: 13, style: '', min: 1.9, dot: 3.5, ring: true, align: align || 'left', dx: align === 'right' ? -8 : 8, dy: 4, color: 'rgba(58,38,20,0.85)' });
    // ports
    for (const p of PORTS) {
      const town = g.towns[p.id];
      const [px, py] = v.toPx(town.coast.x, town.coast.z);
      const known = s.discovered.includes(p.id);
      ctx.fillStyle = known ? '#8a1d1d' : '#6a5a40';
      ctx.beginPath(); ctx.arc(px, py, 7, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#2a1d10'; ctx.lineWidth = 2; ctx.stroke();
      ctx.font = `bold ${Math.round(20 * fs)}px "IM Fell English SC", serif`;
      ctx.fillStyle = '#2a1d10';
      ctx.textAlign = 'left';
      ctx.fillText(p.name, px + 12, py - 6);
      ctx.font = `italic ${Math.round(14 * fs)}px "IM Fell English", serif`;
      ctx.fillText(NATIONS[p.nation].adj + (known ? '' : ' (undiscovered)'), px + 12, py + 12 * fs);
      const fi = this._flagImgs || (this._flagImgs = {});
      if (!fi[p.nation]) { fi[p.nation] = new Image(); fi[p.nation].src = flagImg(NATIONS[p.nation].flag); fi[p.nation].onload = () => this.top() === 'chart' && this.drawChart(); }
      if (fi[p.nation].complete) ctx.drawImage(fi[p.nation], px - 12, py - 30, 24, 15);
    }
    const note = (txt, x, z, o = {}) => {
      const [px, py] = v.toPx(x, z);
      if (!on(px, py)) return;
      ctx.font = `${o.style ?? 'italic'} ${Math.round((o.size || 15) * fs)}px "IM Fell English", serif`;
      ctx.fillStyle = o.color || '#2a1d10'; ctx.textAlign = o.align || 'left';
      ctx.fillText(txt, px + (o.dx ?? 14), py + (o.dy ?? 5));
    };
    // salvage camp
    if (g.salvage) note('Wrecks of the 1715 Flota ✝', g.salvage.coast3.x, g.salvage.coast3.z, { align: 'right', dx: -10, dy: 0 });
    // wrecks your lookouts have marked
    for (const wr of g.seaside?.wrecks || []) {
      if (!wr.seen) continue;
      note('✝', wr.x, wr.z, { style: 'bold', size: 18, dx: -5, dy: 6, align: 'left' });
      if (k >= 1.8) note(`wreck${wr.chests?.some((c) => !c.taken) ? ' (unsearched)' : ''}`, wr.x, wr.z, { size: 12, dx: 10, dy: 5 });
    }
    // treasure
    for (const m of s.treasureMaps) {
      if (m.found) continue;
      const [px, py] = v.toPx(m.x, m.z);
      ctx.strokeStyle = '#a01818'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(px - 9, py - 9); ctx.lineTo(px + 9, py + 9); ctx.moveTo(px + 9, py - 9); ctx.lineTo(px - 9, py + 9); ctx.stroke();
      note('Treasure', m.x, m.z, { color: '#a01818', size: 14 });
    }
    // contracts: the cove of a smuggling run, a ship you are hunting
    for (const c of s.contracts) {
      const smug = c.type === 'smuggle';
      const at3 = smug ? c.marker : c.target?.position || c.marker;
      if (!at3) continue;
      const [px, py] = v.toPx(at3.x, at3.z);
      ctx.strokeStyle = '#7a3a8a'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.rect(px - 7, py - 7, 14, 14); ctx.stroke();
      note(smug ? 'Smugglers’ cove' : c.title || 'Contract', at3.x, at3.z, { color: '#5a2a6a', size: 14 });
    }
    // objective
    const mk = g.missions.marker();
    if (mk) {
      const [px, py] = v.toPx(mk.x, mk.z);
      ctx.strokeStyle = '#d89a1a'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(px, py, 14, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(px, py, 4, 0, Math.PI * 2); ctx.fillStyle = '#d89a1a'; ctx.fill();
      const ot = g.missions.objectiveText();
      if (ot && g.missions.stage) note(ot.length > 48 ? ot.slice(0, 46) + '…' : ot, mk.x, mk.z, { color: '#8a5a0a', size: 14, dx: 18, dy: -14 });
    }
    // waypoint
    if (s.waypoint) {
      const [wx, wy] = v.toPx(s.waypoint.x, s.waypoint.z);
      ctx.strokeStyle = '#2a5a8a'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(wx, wy, 11, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(wx - 16, wy); ctx.lineTo(wx + 16, wy); ctx.moveTo(wx, wy - 16); ctx.lineTo(wx, wy + 16); ctx.stroke();
      const [fx, fy] = v.toPx(g.focus.x, g.focus.z);
      ctx.setLineDash([8, 8]); ctx.strokeStyle = 'rgba(42,90,138,0.7)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(fx, fy); ctx.lineTo(wx, wy); ctx.stroke(); ctx.setLineDash([]);
      const d = Math.hypot(s.waypoint.x - g.focus.x, s.waypoint.z - g.focus.z) * GEO_SCALE / 5556;
      note(`${d < 10 ? d.toFixed(1) : Math.round(d)} leagues`, s.waypoint.x, s.waypoint.z, { color: '#2a5a8a', size: 13, dx: 18, dy: 18 });
    }
    // the squadron
    const ship = (x, z, hd, fill, name) => {
      const [px, py] = v.toPx(x, z);
      if (!on(px, py)) return;
      ctx.save(); ctx.translate(px, py); ctx.rotate(-hd);
      ctx.fillStyle = fill; ctx.strokeStyle = '#f3e7c4'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(0, -10); ctx.lineTo(6, 7); ctx.lineTo(0, 3); ctx.lineTo(-6, 7); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.restore();
      if (name && k >= 1.5) note(name, x, z, { color: '#1f4a7a', size: 13, dx: 10, dy: -8 });
    };
    for (const e of g.fleet?.list || []) {
      const sh = g.fleet.ships.get(e.id);
      if (sh) ship(sh.position.x, sh.position.z, sh.heading, '#2a5a8a', e.name);
    }
    // you
    const f = g.focus;
    const [px, py] = v.toPx(f.x, f.z);
    ctx.save();
    ctx.translate(px, py);
    const hd = g.mode === 'sail' ? g.playerShip.heading : 0;
    ctx.rotate(-hd);
    ctx.fillStyle = '#111'; ctx.strokeStyle = '#f3d58a'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, -14); ctx.lineTo(8, 10); ctx.lineTo(0, 5); ctx.lineTo(-8, 10); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore();
    if (k >= 1.5) note(s.ship.name || 'You', f.x, f.z, { style: 'bold italic', size: 14, dx: 12, dy: 18 });
    // a scale of leagues, and the cartouche
    {
      const lg = 5556 / GEO_SCALE; // one sea league (three sea miles) in game metres
      const nice = [1, 2, 5, 10, 20, 50, 100].find((n) => n * lg * v.s > W * 0.08) || 100;
      const L = nice * lg * v.s, x0 = W / 2 - L / 2, y0 = 58 * fs;
      ctx.fillStyle = '#2a1d10'; ctx.strokeStyle = '#2a1d10'; ctx.lineWidth = 1.5;
      for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.rect(x0 + (L / 4) * i, y0 - 5, L / 4, 6); i % 2 ? ctx.stroke() : ctx.fill(); }
      ctx.strokeRect(x0, y0 - 5, L, 6);
      ctx.font = `italic ${Math.round(13 * fs)}px "IM Fell English", serif`; ctx.textAlign = 'center';
      ctx.fillText(`A scale of ${nice} sea league${nice > 1 ? 's' : ''}`, W / 2, y0 - 12);
    }
    ctx.font = `${Math.round(W * 0.034)}px "Pirata One", serif`;
    ctx.fillStyle = 'rgba(58,38,20,0.85)';
    ctx.textAlign = 'right';
    ctx.fillText('A New Chart of the West Indies', W - 30, Hh - 58);
    ctx.font = `italic ${Math.round(W * 0.014)}px "IM Fell English", serif`;
    ctx.fillText('drawn from the latest observations · MDCCXVI', W - 32, Hh - 30);
    $('chart-info').textContent = (g.canFastTravel() ? 'Click a discovered port to fast-travel there. ' : g.fastTravelBlockReason() + ' ') + 'Click the sea to plot a waypoint · wheel to zoom, drag to pan.';
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
    if (this.chartDragged) { this.chartDragged = false; return; } // (the end of a drag, not a click)
    const p = this.chartHit(e);
    const g = this.game;
    if (!p) {
      // plot a waypoint on open water / any island
      const cv = $('chart-canvas');
      const rect = cv.getBoundingClientRect();
      const px = ((e.clientX - rect.left) / rect.width) * cv.width, py = ((e.clientY - rect.top) / rect.height) * cv.height;
      const [x, z] = this.chartView(cv.width, cv.height).toWorld(px, py);
      const wp = g.state.waypoint;
      if (wp && Math.hypot(wp.x - x, wp.z - z) < 150) { g.state.waypoint = null; this.toast('Waypoint cleared.', 'info', 1500); }
      else { g.state.waypoint = { x, z }; this.toast('Waypoint plotted on the chart.', 'info', 1500); }
      g.audio.ui('click');
      this.drawChart();
      return;
    }
    if (!g.state.discovered.includes(p.id)) return this.toast(`You have not yet found ${p.name}.`, 'warn');
    if (!g.canFastTravel()) return this.toast(g.fastTravelBlockReason(), 'warn');
    this.closeAll();
    g.fastTravel(p.id);
  }

  // the squadron in company: name, captain, hull, and what she's about
  fleetPanel(F) {
    this._fpT = (this._fpT || 0) - 1;
    if (this._fpT > 0) return;
    this._fpT = 10;
    let el = this._fp;
    if (!el) { el = this._fp = document.createElement('div'); el.id = 'fleet-panel'; document.body.appendChild(el); }
    const g = this.game;
    if (!F.list.length || g.mode !== 'sail') { el.style.display = 'none'; return; }
    el.style.display = 'block';
    el.innerHTML = '<div class="fp-title">Squadron</div>' + F.list.map((e) => {
      const c = SHIP_CLASSES[e.cls], hp = Math.round(100 * e.hull / c.hull);
      const what = { follow: 'on station', engage: 'engaging', hold: 'hove to' }[e.order] || '';
      return `<div class="fp-row"><span>${e.name}</span><i style="width:${hp}%;background:${hp < 30 ? '#c8452e' : '#c9a04a'}"></i><small>${what}</small></div>`;
    }).join('') + '<div class="fp-keys">[Z] engage · [X] form on me · [V] heave to</div>';
  }

  // ---------------------------------------------------------------- shops
  openShop(type, town) {
    this.shop = { type, town, tab: null };
    const titles = { tavern: 'The Tavern', merchant: 'Merchant', shipwright: 'Shipwright', governor: town.port.nation === 'pirate' ? 'Council of Captains' : 'Governor\'s House' };
    $('shop-title').textContent = `${titles[type]} · ${town.port.name}`;
    const tabs = {
      tavern: ['Crew', 'Captains', 'Contracts', 'Rumours', 'Rest'],
      merchant: ['Trade'],
      shipwright: ['Repairs', 'Refit', 'Ships', 'Squadron'],
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
      html += `<p class="note">Hold: ${s.cargoCount()} / ${g.playerStats().cargo} · Prices in pieces of eight per unit.</p><table class="trade"><tr><th>Goods</th><th class="num">In hold</th><th class="num">Buy</th><th class="num">Sell</th><th></th></tr>`;
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
        const foul = s.ship.fouling || 0;
        const beach = /careen/i.test(town.doors?.find((dd) => dd.type === 'shipwright')?.label || '') || town.port.nation === 'pirate';
        const careenCost = Math.round((beach ? 40 : 70) * cls.length / 22);
        const state = foul < 0.1 ? 'clean' : foul < 0.35 ? 'some weed' : foul < 0.7 ? 'foul: weed and barnacles' : 'very foul, and the worm in her';
        html += `<div class="shop-card"><div class="info"><b>Careen & scrape her bottom</b><div>Heave her down on the beach, burn off the weed, scrape the barnacles and pay the seams with tallow and sulphur against the worm. Her bottom: <b>${state}</b> (−${Math.round(foul * 30)}% speed).${beach ? ' The careening beach is cheaper.' : ''}</div></div><div class="price">${careenCost} ⛁</div><button data-careen="${careenCost}" ${foul < 0.02 || s.gold < careenCost ? 'disabled' : ''}>Careen</button></div>`;
      } else if (tab === 'Refit') {
        const R = (s.ship.refit ||= emptyRefit());
        html += `<p class="note">Refits belong to your ${cls.name}: sell her, or change ships, and they go with her (a well-found ship fetches more in part exchange).</p>`;
        for (const [k, T] of Object.entries(TIERS)) {
          const lv = R[k] || 0, base = T.costs[lv], cost = base ? refitCost(s.ship.cls, base) : 0;
          html += `<div class="shop-card"><div class="info"><b>${T.names[lv]}${base ? ' → ' + T.names[lv + 1] : ''}</b><div>${T.desc}</div></div><div class="price">${base ? cost + ' ⛁' : 'Finest'}</div><button data-upgrade="${k}" ${!base || s.gold < cost ? 'disabled' : ''}>Refit</button></div>`;
        }
        for (const [k, X] of Object.entries(EXTRAS)) {
          const cost = refitCost(s.ship.cls, X.cost), have = !!R[k];
          html += `<div class="shop-card"><div class="info"><b>${X.name}</b><div>${X.desc}</div></div><div class="price">${have ? 'Fitted' : cost + ' ⛁'}</div><button data-extra="${k}" ${have || s.gold < cost ? 'disabled' : ''}>${have ? '✔' : 'Fit'}</button></div>`;
        }
      } else if (tab === 'Ships') {
        const trade = Math.floor(cls.price * 0.5 * clamp(s.ship.hull / g.playerHullMax(), 0.3, 1) + (s.ship.refitValue || 0) * 0.4);
        html += `<p class="note">Your ${cls.name} is worth ${trade} ⛁ in part exchange, refits included. Cargo and crew transfer to the new ship; her refits stay with her.</p>`;
        for (const id of town.port.shipyard) {
          const c = SHIP_CLASSES[id];
          const cost = Math.max(0, c.price - trade);
          const cur = id === s.ship.cls;
          const fcost = c.price + Math.ceil(c.crewMin * 1.6) * 15;
          const canFleet = g.fleet.room() > 0 && g.fleet.pool.length > 0 && s.gold >= fcost;
          html += `<div class="shop-card"><div class="info"><b>${c.name}</b><div>${c.desc} ${c.guns} guns · hull ${c.hull} · hold ${c.cargo} · crew ${c.crewMax}</div></div><div class="price">${cur ? 'Yours' : cost + ' ⛁'}</div><button data-buyship="${id}" ${cur || s.gold < cost ? 'disabled' : ''}>Buy</button><button data-buyfleet="${id}" title="Crewed and sailed for you by a captain you have hired" ${canFleet ? '' : 'disabled'}>For the squadron (${fcost})</button></div>`;
        }
        if (!g.fleet.pool.length) html += '<p class="note">To buy a ship for your squadron, first sign a captain to command her (at the tavern).</p>';
      } else if (tab === 'Squadron') {
        const F = g.fleet;
        if (!F.list.length) html += '<p class="note">No ships sail in company with you. Take prizes into your squadron, or buy a ship for one of your captains.</p>';
        for (const e of F.list) {
          const c = SHIP_CLASSES[e.cls];
          const cost = F.repairCost(e), worth = F.sellValue(e);
          html += `<div class="shop-card"><div class="info"><b>${e.name}</b> <small>(${c.name})</small><div>Captain ${e.captain.name} · hull ${Math.round(100 * e.hull / c.hull)}% · sails ${Math.round(100 * e.sails / c.sails)}% · ${e.crew} men</div></div><button data-frepair="${e.id}" ${cost <= 0 || s.gold < cost ? 'disabled' : ''}>Repair (${cost})</button><button data-fsell="${e.id}">Sell (${worth})</button></div>`;
        }
      }
    } else if (type === 'tavern') {
      if (tab === 'Crew') {
        const wage = town.port.nation === 'pirate' ? 12 : 22;
        const crew = s.ship.crew;
        const room = g.playerStats().crewMax - crew;
        html += `<p>Your crew: <b>${crew}</b> of ${g.playerStats().crewMax} berths. A full crew sails faster, reloads quicker and wins boarding fights.</p>`;
        html += `<div class="shop-card"><div class="info"><b>Sign on sailors</b><div>Out-of-work seamen, deserters and bold young hands. ${wage} ⛁ a head for the signing bounty.</div></div>
          <button data-hire="5" ${room < 5 || s.gold < wage * 5 ? 'disabled' : ''}>+5 (${wage * 5})</button>
          <button data-hire="${room}" ${room < 1 || s.gold < wage * room ? 'disabled' : ''}>Fill (${wage * room})</button></div>`;
        html += `<div class="shop-card"><div class="info"><b>Stand the house a round</b><div>Rum for every soul in the tavern. Your name will be sung — and remembered.</div></div><div class="price">60 ⛁</div><button data-round ${s.gold < 60 ? 'disabled' : ''}>Buy</button></div>`;
      } else if (tab === 'Captains') {
        const F = g.fleet;
        html += `<p>Your squadron: <b>${F.list.length}</b> of ${F.capacity()} ships in company (more as your renown grows). A consort needs a captain to sail her.</p>`;
        if (F.pool.length) html += `<p class="note">Awaiting a command: ${F.pool.map((c) => `Captain ${c.name} (seamanship ${Math.round(c.sea * 10)}, gunnery ${Math.round(c.guns * 10)})`).join(' · ')}</p>`;
        // who's drinking here today (the same faces all day)
        let seed = (s.day * 7919 + portId.length * 104729) % 2147483647 || 1;
        const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
        for (let i = 0; i < 3; i++) {
          const c = makeCaptain(rnd, rnd());
          const fee = Math.round(150 + (c.sea + c.guns) * 450);
          const hired = F.pool.some((p) => p.name === c.name) || F.list.some((e) => e.captain.name === c.name);
          const bios = ['Sailed with Hornigold out of Nassau.', 'Lost his own sloop on the Colorados reefs.', 'A Jamaica privateer, out of work since the Peace.', 'Took a Spanish piragua off Trinidad with eleven men.', 'Once sailing master of a Bristol slaver.', 'Knows every cay of the Bahamas.'];
          const bio = bios[Math.floor(rnd() * bios.length)];
          html += `<div class="shop-card"><div class="info"><b>Captain ${c.name}</b><div>${bio} Seamanship ${Math.round(c.sea * 10)} · gunnery ${Math.round(c.guns * 10)}.</div></div><div class="price">${fee} ⛁</div><button data-hirecap="${encodeURIComponent(JSON.stringify({ ...c, fee }))}" ${hired || s.gold < fee || F.pool.length >= 4 ? 'disabled' : ''}>${hired ? 'Signed' : 'Sign articles'}</button></div>`;
        }
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
      else { const n = Math.ceil(cls.sails - s.ship.sails); s.gold -= n * 2; s.ship.sails = cls.sails; g.playerShip?.restoreAllMasts(); } // (new topmasts swayed up too)
      g.syncPlayerShipFromState();
      g.audio.ui('click');
    } else if (d.careen !== undefined) {
      s.gold -= +d.careen || 60;
      s.ship.fouling = 0;
      const p = g.playerShip; if (p) p.speedMult = p.baseSpeedMult || 1;
      g.state.advanceHours(10); // a tide or two on the beach
      this.toast('Hove down, scraped and paid: her bottom is clean and she sails like a witch again. (Ten hours on the beach.)', 'good', 4500);
    } else if (d.upgrade) {
      const R = (s.ship.refit ||= emptyRefit());
      const c = refitCost(s.ship.cls, TIERS[d.upgrade].costs[R[d.upgrade] || 0]);
      g.syncStateFromPlayerShip();
      s.gold -= c;
      R[d.upgrade] = (R[d.upgrade] || 0) + 1;
      s.ship.refitValue = (s.ship.refitValue || 0) + c;
      if (d.upgrade === 'hull') s.ship.hull = g.playerHullMax();
      g.rebuildPlayerShip();
      g.audio.ui('fanfare');
      this.toast('Refit complete.', 'good');
    } else if (d.extra) {
      const R = (s.ship.refit ||= emptyRefit());
      const c = refitCost(s.ship.cls, EXTRAS[d.extra].cost);
      g.syncStateFromPlayerShip();
      s.gold -= c;
      R[d.extra] = true;
      s.ship.refitValue = (s.ship.refitValue || 0) + c;
      if (d.extra === 'hold') s.ship.crew = Math.min(s.ship.crew, g.playerStats().crewMax);
      g.rebuildPlayerShip();
      g.audio.ui('fanfare');
      this.toast(`${EXTRAS[d.extra].name}: fitted.`, 'good');
    } else if (d.buyship) {
      const trade = Math.floor(cls.price * 0.5 * clamp(s.ship.hull / g.playerHullMax(), 0.3, 1) + (s.ship.refitValue || 0) * 0.4);
      const c = SHIP_CLASSES[d.buyship];
      const cost = Math.max(0, c.price - trade);
      if (s.cargoCount() > c.cargo) return this.toast('Your cargo will not fit in her hold. Sell some first.', 'warn');
      g.syncStateFromPlayerShip();
      s.gold -= cost;
      s.ship.cls = d.buyship;
      s.ship.refit = emptyRefit(); s.ship.refitValue = 0; s.ship.fouling = 0; // a new ship: clean bottom, no refits yet
      s.ship.hull = g.playerHullMax();
      s.ship.sails = c.sails;
      s.ship.crew = Math.min(s.ship.crew, c.crewMax);
      g.rebuildPlayerShip();
      g.audio.ui('fanfare');
      this.toast(`The ${c.name} ${s.shipName} is yours!`, 'good');
    } else if (d.hirecap) {
      const c = JSON.parse(decodeURIComponent(d.hirecap));
      s.gold -= c.fee; delete c.fee;
      g.fleet.pool.push(c);
      g.audio.coins();
      this.toast(`Captain ${c.name} signs your articles and awaits a ship.`, 'good');
    } else if (d.buyfleet) {
      const c = SHIP_CLASSES[d.buyfleet];
      const captain = g.fleet.pool.shift();
      s.gold -= c.price + Math.ceil(c.crewMin * 1.6) * 15;
      const names = ['Delivery', 'Good Intent', 'Lark', 'Fortune', 'Adventure', 'Speedwell', 'Happy Return', 'Sea Nymph', 'Dragon', 'Rover'];
      const e = g.fleet.addEntry(d.buyfleet, names.find((n) => !g.fleet.list.some((x) => x.name === n)) || 'Consort', captain, c.hull, c.sails, Math.ceil(c.crewMin * 1.6));
      g.fleet.spawnAll();
      g.audio.ui('fanfare');
      this.toast(`The ${e.name} (${c.name}) joins your squadron under Captain ${captain.name}. She lies in the roads.`, 'good', 5000);
    } else if (d.frepair) {
      const e = g.fleet.list.find((x) => x.id === d.frepair);
      s.gold -= g.fleet.repairCost(e); g.fleet.repair(e);
      g.audio.ui('click');
    } else if (d.fsell) {
      const e = g.fleet.list.find((x) => x.id === d.fsell);
      s.gold += g.fleet.sellValue(e);
      g.fleet.pool.push(e.captain);
      g.fleet.release(e);
      g.audio.coins();
      this.toast(`The ${e.name} is sold; Captain ${e.captain.name} waits for another command.`, 'info');
    } else if (d.hire) {
      const wage = town.port.nation === 'pirate' ? 12 : 22;
      const n = Math.min(+d.hire, g.playerStats().crewMax - s.ship.crew, Math.floor(s.gold / wage));
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
  if (p.backed) return p.speed < 0 ? 'Taken aback — making sternway!' : 'Taken aback — put the helm over!';
  const t = Math.PI - p.effTheta; // true wind angle off the bow
  if (t < (p.cls.rig === 'sloop' ? 0.62 : 0.95) || p.luff > 0.6) return 'In irons — sails luffing, bear away!';
  if (p.luff > 0.25) return 'Pinching — sails shivering';
  if (t < 1.25) return 'Close-hauled';
  if (t < 1.4) return 'Close reach';
  if (t < 1.85) return 'Beam reach';
  if (t < 2.6) return 'Broad reach';
  return 'Running before the wind';
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

// Names on the chart, as a chart-maker of 1716 would have written them: [name, lon, lat, rotation, least zoom]
const CHART_SEAS = [
  ['The Gulf of Florida', -81.3, 24.15],
  ['Mar del Norte', -72.5, 26.8],
  ['The Caribbean Sea', -80.5, 17.4],
  ['Golfo de México', -84.2, 25.7],
];
const CHART_PASSAGES = [
  ['New Bahama Channel', -79.72, 26.6, -Math.PI / 2],
  ['Old Bahama Channel', -78.2, 22.72, 0.3],
  ['Windward Passage', -73.85, 19.9, -1.2],
  ['N.W. Providence Channel', -78.65, 25.98, 0.15, 1.3],
  ['N.E. Providence Channel', -77.0, 25.72, 0.1, 1.3],
  ['Tongue of the Ocean', -77.45, 24.35, -1.25, 1.3],
  ['Exuma Sound', -76.1, 24.45, -0.6, 1.3],
  ['Crooked Island Passage', -74.75, 22.95, -1.15, 1.3],
  ['Caicos Passage', -72.55, 22.15, -0.5, 1.6],
  ['Jamaica Channel', -75.3, 18.25, -0.35],
  ['Golfe de la Gonâve', -73.0, 19.3, 0, 1.6],
  ['Golfo de Batabanó', -82.4, 22.3, 0, 1.4],
  ['Golfo de Guacanayabo', -77.45, 20.55, -0.5, 2],
];
const CHART_BANKS = [
  ['The Great Bahama Bank', -78.55, 23.65, 1],
  ['Little Bahama Bank', -78.3, 27.05],
  ['Cay Sal Bank', -80.05, 23.72],
  ['Los Mártires', -80.9, 24.68],
  ['Jardines de la Reina', -78.75, 20.7],
  ['Jardines del Rey', -78.3, 22.4, 2],
  ['Los Colorados', -84.0, 22.75, 2],
  ['The Abrojos, or Silver Bank', -69.9, 20.3],
  ['Mouchoir Bank', -70.9, 21.05],
  ['Turks Islands', -71.15, 21.45],
  ['Ragged Islands', -75.7, 22.25, 1.8],
  ['Hogsty Reef', -73.85, 21.68, 2.5],
  ['Pedro Bank', -77.8, 17.05],
  ['Serranilla Bank', -79.85, 16.85, 1.8],
];
const CHART_REGIONS = [
  ['Saint-Domingue', -72.75, 18.25, 1],
  ['Santo Domingo', -70.2, 18.95, 1],
  ['La Florida', -81.5, 28.6, 1],
];
const CHART_CAPES = [
  ['C. de S. Antonio', -84.95, 21.86],
  ['C. de Corrientes', -84.5, 21.75, 'right'],
  ['C. de Cruz', -77.73, 19.84, 'right'],
  ['Punta de Maisí', -74.13, 20.24],
  ['Cape Florida', -80.16, 25.67],
  ['C. Cañaveral', -80.6, 28.45],
  ['Cap Tiburon', -74.45, 18.33, 'right'],
  ['Môle St-Nicolas', -73.4, 19.8, 'right'],
  ['C. Beata', -71.42, 17.6],
  ['Point Morant', -76.19, 17.92],
  ['Negril Point', -78.37, 18.3, 'right'],
  ['C. Engaño', -68.32, 18.6, 'right'],
  ['Hole in the Wall', -77.2, 25.85],
  ['C. San Román', -80.1, 21.82, 'right'],
];
const CHART_TOWNS = [
  ['San Agustín', -81.31, 29.88],
  ['Santiago de Cuba', -75.83, 20.02],
  ['Puerto Príncipe', -77.92, 21.38],
  ['Trinidad', -79.98, 21.8],
  ['Matanzas', -81.58, 23.05],
  ['Baracoa', -74.5, 20.35],
  ['Bayamo', -76.64, 20.38],
  ['Sancti Spíritus', -79.44, 21.93],
  ['Cap-François', -72.2, 19.76],
  ['Léogâne', -72.63, 18.51],
  ['Petit-Goâve', -72.86, 18.43, 'right'],
  ['Santo Domingo', -69.9, 18.47],
  ['Santiago de los Caballeros', -70.7, 19.45],
  ['Spanish Town', -76.96, 18.0, 'right'],
  ['Kingston', -76.79, 17.99],
  ['Harbour Island', -76.64, 25.5],
];

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
