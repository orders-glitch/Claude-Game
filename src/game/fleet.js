// The squadron: ships sailing under your command, each with its own captain. Pirate squadrons of the 1710s were
// loose companies of consorts sailing under one commodore's articles (Hornigold, Bellamy and Blackbeard all
// sailed so), so: take prizes into company with a prize crew aboard, or buy ships at a shipwright, and give each
// a captain, appointed from your crew or hired in a tavern. Consorts keep station on you, follow your movements
// across the chart, anchor with you in the roads, and fight what you fight. Orders by signal flag:
//   [Z] engage my target · [X] form on me · [V] heave to and hold
import * as THREE from 'three';
import { SHIP_CLASSES, GOODS } from './data.js';
import { rand, randInt, pick, clamp } from '../core/noise.js';

const FIRST = ['Edward', 'Charles', 'Samuel', 'Thomas', 'John', 'Richard', 'Paulsgrave', 'Christopher', 'Israel', 'Stede', 'Calico', 'Henry', 'Josiah', 'Nicholas', 'Olivier', 'Pierre', 'Jan', 'Diego'];
const LAST = ['Vane', 'Hands', 'Moody', 'Condent', 'England', 'Burgess', 'Williams', 'La Buse', 'Winter', 'Tew', 'Cocklyn', 'Davis', 'Jennings', 'Bonnet', 'Fly', 'Low', 'Lowther', 'Evans', 'de Graaf'];
const SHIP_NAMES = ['Ranger', 'Delivery', 'Good Intent', 'Lark', 'Fortune', 'Mary Anne', 'Adventure', 'Revenge', 'Whydah', 'Royal James', 'Speedwell', 'Happy Return', 'Bachelor\'s Delight', 'Sea Nymph', 'Dragon'];

export function makeCaptain(rnd = Math.random, quality = 0.5) {
  const r = (lo, hi) => Math.round((lo + (hi - lo) * rnd()) * 10) / 10;
  return { name: `${FIRST[Math.floor(rnd() * FIRST.length)]} ${LAST[Math.floor(rnd() * LAST.length)]}`, sea: r(0.3, 0.6) + quality * 0.4, guns: r(0.3, 0.6) + quality * 0.4 };
}

export class Fleet {
  constructor(game) {
    this.g = game;
    this.ships = new Map(); // fleet entry id -> live Ship
    this.targets = new Map(); // fleet entry id -> the ship she's ordered to engage (kept out of the saved record)
  }

  get list() { return (this.g.state.fleet ||= []); }
  get pool() { return (this.g.state.captains ||= []); } // hired captains without a ship
  // how many consorts a commodore of your standing can keep in company
  capacity() { return clamp(1 + Math.floor((this.g.state.renown || 0) / 15), 1, 4); }
  room() { return this.capacity() - this.list.length; }

  // ------------------------------------------------------------------ joining the squadron
  addEntry(cls, name, captain, hull, sails, crew) {
    const id = 'f' + Date.now().toString(36) + randInt(0, 999);
    const e = { id, cls, name, captain, hull, sails, crew, order: 'follow' };
    this.list.push(e);
    return e;
  }

  // a prize taken into company: some of your people go across with a captain to sail her
  takePrize(ship) {
    const g = this.g, p = g.playerShip, s = g.state;
    const need = Math.max(ship.cls.crewMin + 2, Math.round(ship.cls.crewMin * 1.6));
    const from = Math.min(Math.max(0, p.crew - p.cls.crewMin - 2), need);
    const crew = from + Math.max(0, ship.crew); // (her surviving hands who sign the articles)
    p.crew -= from;
    s.ship.crew = p.crew;
    const captain = this.pool.length ? this.pool.sort((a, b) => b.sea + b.guns - a.sea - a.guns).shift() : makeCaptain(Math.random, 0.25);
    const e = this.addEntry(ship.cls.id, ship.name, captain, Math.max(ship.hull, ship.hullMax * 0.4), Math.max(ship.sails, ship.sailsMax * 0.4), Math.max(crew, ship.cls.crewMin));
    // the prize herself joins: same ship, new colours, new captain
    g.removeShip(ship);
    this.spawn(e, ship.position, ship.heading);
    g.ui.toast(`${from} of your hands cross to the ${e.name} under Captain ${captain.name}. She sails in company.`, 'good', 5000);
    return e;
  }

  // ------------------------------------------------------------------ live ships
  spawn(e, pos, heading) {
    const g = this.g;
    const cls = SHIP_CLASSES[e.cls];
    const ship = g.spawnShip(e.cls, 'pirate', { role: 'consort', name: e.name, x: pos.x, z: pos.z, heading, mission: true, flag: g.state.flag || 'pirate', hull: e.hull, sails: e.sails, crew: e.crew, speed: 0, sailTarget: 0 });
    ship.consort = e;
    ship.hull = Math.min(e.hull, ship.hullMax); ship.sails = Math.min(e.sails, ship.sailsMax); ship.crew = e.crew;
    // the captain's seamanship and gunnery
    ship.speedMult = 0.94 + e.captain.sea * 0.12;
    ship.reloadBase = 9 - e.captain.guns * 3;
    ship.gunDamage = 0.85 + e.captain.guns * 0.3;
    ship.ai.mode = 'escort';
    ship.ai.leader = g.playerShip;
    ship.ai.aggressive = true;
    ship.ai.courage = 0.9;
    // a squadron's captains close to decisive range before they fire, as the commodore's articles demand
    ship.ai.idealRange = 80 + ship.cls.length * 1.8;
    ship.ai.maxRange = 300;
    ship.ai.fireArc = 0.8;
    this.ships.set(e.id, ship);
    this.assignStations();
    void cls;
    return ship;
  }

  // stations in a loose line abreast and astern: alternate quarters, each further back
  assignStations() {
    let k = 0;
    for (const e of this.list) {
      const s = this.ships.get(e.id);
      if (!s) continue;
      s.ai.escortSide = k % 2 ? 1 : -1;
      s.ai.escortBack = 70 + Math.floor(k / 2) * 70;
      s.ai.escortOut = 75 + Math.floor(k / 2) * 30;
      k++;
    }
  }

  // bring every consort into being around the flagship (a new session, after a long passage or a refit)
  spawnAll(regroup = false) {
    const g = this.g, p = g.playerShip;
    if (!p) return;
    this.list.forEach((e, k) => {
      let s = this.ships.get(e.id);
      if (s && !s.alive) { this.ships.delete(e.id); s = null; }
      const side = k % 2 ? 1 : -1, back = 70 + Math.floor(k / 2) * 70, out = 75 + Math.floor(k / 2) * 30;
      const at = (b, o) => p.position.clone().addScaledVector(p.forward, -b).addScaledVector(p.right, side * o);
      let pos = at(back, out);
      // in open water
      for (let tries = 0; tries < 12 && g.terrain.height(pos.x, pos.z) > -6; tries++) pos = at(back + rand(-60, 120), out + rand(-40, 120));
      if (!s) this.spawn(e, pos, p.heading);
      else if (regroup) { s.position.copy(pos); s.heading = p.heading; s.speed = p.speed; s.updateAxes(); }
    });
  }

  // ------------------------------------------------------------------ orders
  order(kind) {
    const g = this.g;
    if (!this.list.length) { g.ui.toast('You have no ships in company.', 'warn', 1800); return; }
    let target = null;
    if (kind === 'engage') {
      target = g.targetShip && g.targetShip.alive && !g.targetShip.struck && g.targetShip.role !== 'consort' ? g.targetShip : null;
      if (!target) {
        const p = g.playerShip;
        let bd = 1200;
        for (const s of g.ships) if (s !== p && s.alive && !s.struck && s.role !== 'consort' && g.isHostile(s, p)) { const d = s.position.distanceTo(p.position); if (d < bd) { bd = d; target = s; } }
      }
      if (!target) { g.ui.toast('No enemy to engage — look toward a ship to mark her as your target.', 'warn', 2400); return; }
      // she's ours to fight now
      target.aggro.add(0);
    }
    for (const e of this.list) { e.order = kind; this.targets.set(e.id, target); }
    for (const s of this.ships.values()) {
      if (target) { s.ai.mode = 'attack'; s.ai.target = target; target.aggro.add(s.id); }
      else { s.ai.mode = 'escort'; s.ai.target = null; }
    }
    const flags = { engage: `Signal flown: “Engage the enemy”${target ? ' — the ' + target.name : ''}.`, follow: 'Signal flown: “Form on the commodore.”', hold: 'Signal flown: “Heave to.”' };
    g.ui.toast(flags[kind], 'info', 2800);
    g.audio.ui?.('click');
  }

  // the consort's mind, each time its captain thinks (ShipAI.decide)
  decide(ai, world) {
    const s = ai.ship, e = s.consort, g = this.g, p = g.playerShip;
    if (!e || !p) return;
    ai.leader = p;
    // nobody's at sea while the commodore is ashore: anchor where you are
    if (g.mode !== 'sail') { ai.mode = 'hold'; return; }
    // a beaten enemy to take: lay alongside her (no more firing into a ship that has struck)
    const PT = s.prizeTarget;
    if (PT && PT.alive && PT.struck && !PT.taken) { ai.mode = 'escort'; ai.target = null; ai.leader = PT; return; }
    const hpF = s.hull / s.hullMax;
    if (hpF < 0.22) { ai.mode = 'escort'; ai.target = null; if (!e.saidHurt) { e.saidHurt = true; g.ui.toast(`The ${e.name} signals: “Sore hurt, falling back on the commodore.”`, 'warn', 3500); } return; }
    if (hpF > 0.4) e.saidHurt = false;
    if (e.order === 'hold') { ai.mode = 'hold'; return; }
    // the ordered target, while she fights on
    const T = this.targets.get(e.id);
    if (e.order === 'engage' && T && T.alive && !T.struck) { ai.mode = 'attack'; ai.target = T; return; }
    if (e.order === 'engage') e.order = 'follow';
    // on station, but defending the squadron: anyone shooting at us, or anyone we're fighting near the commodore
    let best = null, bd = 650;
    for (const o of world.ships) {
      if (o === s || o === p || !o.alive || o.struck || o.role === 'consort') continue;
      // (someone attacking us: not a merchant running from us)
      const threat = o.aggro.has(0) || o.aggro.has(s.id) || (o.ai?.mode === 'attack' && o.ai.target && (o.ai.target === p || o.ai.target.role === 'consort'));
      if (!threat || !world.isHostile(o, p)) continue;
      const d = o.position.distanceTo(p.position);
      if (d < bd) { bd = d; best = o; }
    }
    if (best) { ai.mode = 'attack'; ai.target = best; } else { ai.mode = 'escort'; ai.target = null; }
  }

  // ------------------------------------------------------------------ per frame
  update(dt) {
    const g = this.g;
    if (g.mode === 'sail') this.checkPrizes(dt);
    for (const [id, s] of this.ships) {
      const e = this.list.find((x) => x.id === id);
      if (!e) { this.ships.delete(id); continue; }
      if (!s.alive || s.sinking) {
        // lost
        this.list.splice(this.list.indexOf(e), 1);
        this.ships.delete(id);
        g.ui.toast(`The ${e.name} is lost, and Captain ${e.captain.name} with her${Math.random() < 0.5 ? ' — though some of her people are pulled from the water' : ''}.`, 'warn', 5000);
        this.assignStations();
        continue;
      }
      // keep the record current (for saving)
      e.hull = s.hull; e.sails = s.sails; e.crew = s.crew;
      // anchor in the roads while the commodore is ashore
      const ashore = g.mode !== 'sail';
      if (ashore !== !!s.anchored) { s.anchored = ashore; if (ashore) s.sailTarget = 0; }
      if (s.flagKind !== g.playerShip?.flagKind && g.playerShip) s.setVisibleFlag?.(g.playerShip.flagKind);
    }
  }

  // Shares by the articles: when a consort's enemy strikes, she closes, boards and takes her prize; the plunder
  // is shared out (the commodore's share comes to you) and the prize is sent into Nassau to be condemned and
  // sold, your share of the sale following in a few days.
  COMMODORE_SHARE = 0.25;

  checkPrizes(dt) {
    const g = this.g;
    for (const [id, s] of this.ships) {
      if (!s.alive) continue;
      const e = this.list.find((x) => x.id === id);
      // her own target, or any beaten enemy she has been fighting close by
      let T = s.ai.target && s.ai.target.struck ? s.ai.target : null;
      if (!T) for (const o of g.ships) if (o.struck && o.alive && !o.taken && (o.aggro.has(s.id) || o.lastHitBy === s) && o.position.distanceTo(s.position) < 500) { T = o; break; }
      if (!T || !T.alive || T.taken || T.sinking || g.boarding?.enemy === T) { s.captureT = 0; s.prizeTarget = null; continue; }
      s.prizeTarget = T; // (she lays herself alongside: see decide)
      const d = T.position.distanceTo(s.position);
      if (d > 160) { s.captureT = 0; continue; }
      s.captureT = (s.captureT || 0) + dt;
      if (s.captureT > 8) this.consortTakes(s, e, T);
    }
  }

  consortTakes(s, e, T) {
    const g = this.g, st = g.state;
    T.taken = true;
    let cargo = 0;
    for (const k in T.cargo) cargo += (T.cargo[k] || 0) * (GOODS[k]?.base || 10);
    const plunder = Math.round(T.gold + randInt(20, 80) * Math.ceil(T.cls.guns / 4) + cargo * 0.5);
    const share = Math.round(plunder * this.COMMODORE_SHARE);
    st.gold += share;
    st.stats.captured = (st.stats.captured || 0) + 1;
    st.stats.plunder = (st.stats.plunder || 0) + share;
    st.renown = (st.renown || 0) + 1;
    // her prize crew takes the prize in; your share of the sale follows
    const prizeCrew = Math.min(Math.max(3, T.cls.crewMin), Math.max(0, s.crew - s.cls.crewMin - 2));
    const saleShare = Math.round(T.cls.price * 0.35 * clamp(T.hull / T.hullMax, 0.3, 1) * this.COMMODORE_SHARE);
    if (prizeCrew >= 3) {
      s.crew -= prizeCrew; e.crew = s.crew;
      (st.prizesAway ||= []).push({ name: T.name, cls: T.cls.name, value: saleShare, crew: 0, consortCrew: { id: e.id, n: prizeCrew }, due: st.day * 24 + st.hours + 36 + Math.random() * 36, port: 'Nassau', share: true });
    }
    g.audio.coins();
    g.ui.toast(`The ${e.name} takes the ${T.name}! Your commodore's share of the plunder: ${share} pieces of eight.${prizeCrew >= 3 ? ` Captain ${e.captain.name} sends her into Nassau to be sold (your share about ${saleShare}).` : ''}`, 'good', 6000);
    g.removeShip(T);
    s.captureT = 0; s.prizeTarget = null;
    s.ai.target = null; s.ai.mode = 'escort'; s.ai.leader = g.playerShip;
    this.targets.delete(e.id);
    if (e.order === 'engage') e.order = 'follow';
  }

  // a long passage: the squadron arrives with you
  regroup() { this.spawnAll(true); }

  clear() {
    for (const s of this.ships.values()) if (s.group?.parent) this.g.removeShip(s);
    this.ships.clear();
  }

  // repair the squadron in port
  repairCost(e) { const c = SHIP_CLASSES[e.cls]; return Math.ceil((c.hull - e.hull) * 3 + (c.sails - e.sails) * 2); }
  repair(e) {
    const c = SHIP_CLASSES[e.cls];
    e.hull = c.hull; e.sails = c.sails;
    const s = this.ships.get(e.id);
    if (s) { s.hull = s.hullMax; s.sails = s.sailsMax; s.restoreAllMasts?.(); }
  }
  // her share of a refit in crew: sign on hands for her up to a working complement
  sellValue(e) { const c = SHIP_CLASSES[e.cls]; return Math.floor(c.price * 0.4 * clamp(e.hull / c.hull, 0.3, 1)); }
  release(e) {
    const s = this.ships.get(e.id);
    if (s) { this.g.removeShip(s); this.ships.delete(e.id); }
    this.list.splice(this.list.indexOf(e), 1);
    this.assignStations();
  }
}

export { SHIP_NAMES as FLEET_SHIP_NAMES };
