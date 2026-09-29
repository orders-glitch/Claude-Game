// Persistent career state, economy and save/load.
import { GOODS, PORTS, SHIP_CLASSES, MONTHS, watchName } from './data.js';
import { clamp } from '../core/noise.js';

const SAVE_KEY = 'brethren_of_the_coast_save_v1';

export class GameState {
  constructor() { this.reset(); }

  reset(name = 'Captain') {
    this.captainName = name;
    this.shipName = 'Ranger';
    this.gold = 400;
    this.day = 0; // days since 1 June 1716
    this.hours = 7.5;
    this.health = 100;
    this.ship = { cls: 'sloop', hull: SHIP_CLASSES.sloop.hull, sails: SHIP_CLASSES.sloop.sails, crew: 40, cargo: {} };
    this.upgrades = { guns: 0, hull: 0, sails: 0 };
    this.notoriety = { britain: 0, spain: 0, france: 0, dutch: 0 };
    this.renown = 0;
    this.discovered = ['nassau'];
    this.mission = { id: 'm1', stage: 0, done: [] };
    this.contracts = [];
    this.treasureMaps = [];
    this.stats = { sunk: 0, captured: 0, plunder: 0, treasures: 0, duels: 0 };
    this.position = null; // {x,z,heading,mode}
    this.lastPort = 'nassau';
    this.flag = 'pirate';
    this.marketShift = {};
    this.settings = this.settings || loadSettings();
  }

  dateString() {
    const d = new Date(Date.UTC(1716, 5, 1 + this.day));
    return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  }

  timeString() {
    const h = Math.floor(this.hours), m = Math.floor((this.hours - h) * 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')} · ${watchName(this.hours)}`;
  }

  advanceHours(dh) {
    this.hours += dh;
    while (this.hours >= 24) { this.hours -= 24; this.day++; this.onNewDay?.(); }
  }

  // ---------------------------------------------------------------- notoriety
  wanted(nation) { return nation && this.notoriety[nation] !== undefined ? Math.floor(this.notoriety[nation]) : 0; }
  maxWanted() { return Math.max(...Object.values(this.notoriety).map(Math.floor)); }
  addNotoriety(nation, amt) {
    if (this.notoriety[nation] === undefined) return;
    this.notoriety[nation] = clamp(this.notoriety[nation] + amt, 0, 5);
  }
  decayNotoriety(dtHours, hiddenMult) {
    for (const k in this.notoriety) {
      const floor = this.notoriety[k] >= 4 ? 1 : 0;
      this.notoriety[k] = Math.max(floor, this.notoriety[k] - dtHours * 0.03 * hiddenMult);
    }
  }

  title() {
    const r = this.renown;
    if (r < 10) return 'Sea Rover';
    if (r < 30) return 'Freebooter';
    if (r < 60) return 'Buccaneer Captain';
    if (r < 120) return 'Terror of the Main';
    return 'Pirate King of the Indies';
  }

  // ---------------------------------------------------------------- economy
  price(portId, good) {
    const port = PORTS.find((p) => p.id === portId);
    const g = GOODS[good];
    let f = 1;
    if (port.produces.includes(good)) f = 0.62;
    if (port.demands.includes(good)) f = 1.45;
    // slow daily fluctuation
    const h = Math.sin((this.day + 3) * 0.37 + good.length * 1.7 + portId.length * 2.3) * 0.12;
    const shift = this.marketShift[portId + good] || 0;
    return Math.max(2, Math.round(g.base * f * (1 + h) * (1 + shift)));
  }
  sellPrice(portId, good) { return Math.max(1, Math.floor(this.price(portId, good) * 0.82)); }
  nudgeMarket(portId, good, amt) {
    const k = portId + good;
    this.marketShift[k] = clamp((this.marketShift[k] || 0) + amt, -0.4, 0.6);
  }
  relaxMarkets() {
    for (const k in this.marketShift) this.marketShift[k] *= 0.8;
  }

  cargoCount() { let n = 0; for (const k in this.ship.cargo) n += this.ship.cargo[k]; return n; }
  cargoValue(portId) { let v = 0; for (const k in this.ship.cargo) v += this.ship.cargo[k] * this.sellPrice(portId, k); return v; }

  // ---------------------------------------------------------------- persistence
  save(extra = {}) {
    try {
      const data = { ...this, ...extra, settings: undefined, onNewDay: undefined, savedAt: Date.now() };
      localStorage.setItem(SAVE_KEY, JSON.stringify(data));
      return true;
    } catch (e) { return false; }
  }
  static hasSave() {
    try { return !!localStorage.getItem(SAVE_KEY); } catch (e) { return false; }
  }
  static saveSummary() {
    try {
      const d = JSON.parse(localStorage.getItem(SAVE_KEY));
      if (!d) return null;
      const date = new Date(Date.UTC(1716, 5, 1 + d.day));
      return `${d.captainName} · ${d.gold} pieces of eight · ${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
    } catch (e) { return null; }
  }
  load() {
    try {
      const d = JSON.parse(localStorage.getItem(SAVE_KEY));
      if (!d) return false;
      const settings = this.settings;
      this.reset(d.captainName);
      Object.assign(this, d);
      this.settings = settings;
      return true;
    } catch (e) { return false; }
  }
  static deleteSave() { try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* */ } }
}

const SETTINGS_KEY = 'brethren_of_the_coast_settings_v1';
export function defaultQuality() {
  const mobile = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
  const mem = navigator.deviceMemory || 8;
  if (mobile || mem <= 2) return 'low';
  if (mem <= 4) return 'medium';
  return 'high';
}
export function loadSettings() {
  const def = { quality: defaultQuality(), master: 0.8, music: 0.5, sfx: 0.9, sensitivity: 1, invertY: false, fov: 60, showFps: false };
  try { return { ...def, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') }; } catch (e) { return def; }
}
export function saveSettings(s) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch (e) { /* */ }
}
