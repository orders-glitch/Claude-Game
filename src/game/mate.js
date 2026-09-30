// The first mate keeps a lookout for you and sings out what matters: sails sighted (by the points of the
// compass relative to the bow), shoal water ahead, the wind shifting, the guns ready again, damage, and a ship
// caught in irons. One call at a time, and never the same one twice in a row too soon.
import { NATIONS, SHIP_CLASSES } from './data.js';

const MATE = 'Mr. Ward, first mate';
const POINT = Math.PI / 16; // one point of the compass, 11¼°
const COMPASS = ['N', 'NbE', 'NNE', 'NEbN', 'NE', 'NEbE', 'ENE', 'EbN', 'E', 'EbS', 'ESE', 'SEbE', 'SE', 'SEbS', 'SSE', 'SbE', 'S', 'SbW', 'SSW', 'SWbS', 'SW', 'SWbW', 'WSW', 'WbS', 'W', 'WbN', 'WNW', 'NWbW', 'NW', 'NWbN', 'NNW', 'NbW'];

// relative bearing in the seaman's words: "two points off the starboard bow", "on the larboard beam", ...
export function relBearing(ship, x, z) {
  const dx = x - ship.position.x, dz = z - ship.position.z;
  const ahead = dx * ship.forward.x + dz * ship.forward.z, right = dx * ship.right.x + dz * ship.right.z;
  const ang = Math.atan2(Math.abs(right), ahead); // 0 ahead .. PI astern
  const pts = Math.round(ang / POINT);
  const side = right >= 0 ? 'starboard' : 'larboard';
  const words = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven'];
  if (pts === 0) return 'dead ahead';
  if (pts === 16) return 'dead astern';
  if (pts < 4) return `${words[pts]} point${pts > 1 ? 's' : ''} off the ${side} bow`;
  if (pts === 4) return `broad on the ${side} bow`;
  if (pts < 8) return `${words[8 - pts]} point${8 - pts > 1 ? 's' : ''} forward of the ${side} beam`;
  if (pts === 8) return `on the ${side} beam`;
  if (pts < 12) return `${words[pts - 8]} point${pts - 8 > 1 ? 's' : ''} abaft the ${side} beam`;
  if (pts === 12) return `on the ${side} quarter`;
  return `${words[16 - pts]} point${16 - pts > 1 ? 's' : ''} off the ${side} quarter`;
}

export class FirstMate {
  constructor(game) {
    this.g = game;
    this.seen = new Set();
    this.cool = {};
    this.gap = 0;
    this.lastWind = null;
    this.wasReloading = { port: false, starboard: false };
  }

  say(key, text, cooldown = 20) {
    const now = performance.now() / 1000;
    if (this.gap > 0 || (this.cool[key] && now < this.cool[key])) return false;
    this.cool[key] = now + cooldown;
    this.gap = 5; // one call at a time
    this.g.ui.toast(`“${text}” — ${MATE}`, 'mate', 5200);
    this.g.audio.ui?.('click');
    return true;
  }

  update(dt) {
    const g = this.g, p = g.playerShip;
    if (!p || !p.alive || g.mode !== 'sail') return;
    this.gap = Math.max(0, this.gap - dt);
    // sail ho
    for (const s of g.ships) {
      if (s === p || !s.alive || this.seen.has(s)) continue;
      const d = s.position.distanceTo(p.position);
      if (d > 1100) continue;
      const kind = SHIP_CLASSES[s.cls.id]?.name?.toLowerCase() || 'ship';
      const nat = NATIONS[s.nationId]?.adj || '';
      const hostile = s.aggro?.has?.(0) || s.role === 'hunter' || s.role === 'navy';
      if (this.say('sail', `Sail ho! ${nat ? 'A' + (/^[aeiou]/i.test(nat) ? 'n ' : ' ') + nat + ' ' : 'A '}${kind}, ${relBearing(p, s.position.x, s.position.z)}${hostile ? ' — she looks to mean us harm' : ''}!`, 12)) this.seen.add(s);
      break;
    }
    // shoal water ahead
    if (p.speed > 4) {
      for (const d of [90, 160, 240]) {
        const x = p.position.x + p.forward.x * d, z = p.position.z + p.forward.z * d;
        if (g.terrain.height(x, z) > -(p.model.draft + 1.5)) { this.say('shoal', d < 120 ? 'Breakers ahead! Put the helm over, Captain!' : 'Shoal water ahead, Captain — the colour\'s changing!', 25); break; }
      }
    }
    // the wind shifting
    const w = g.wind, ang = Math.atan2(-w.x, -w.z); // where it blows from
    if (this.lastWind === null) this.lastWind = ang;
    let dA = ang - this.lastWind; dA = Math.atan2(Math.sin(dA), Math.cos(dA));
    if (Math.abs(dA) > 0.4) {
      const idx = ((Math.round(((ang + Math.PI * 2) % (Math.PI * 2)) / POINT) % 32) + 32) % 32;
      if (this.say('wind', `Wind's ${dA > 0 ? 'veering' : 'backing'}, Captain — she's coming from the ${COMPASS[idx]} now.`, 60)) this.lastWind = ang;
    }
    // guns ready again
    for (const sd of ['port', 'starboard']) {
      const r = p.reload[sd] > 0;
      if (this.wasReloading[sd] && !r) this.say('guns' + sd, `${sd === 'port' ? 'Larboard' : 'Starboard'} guns run out and ready, Captain!`, 4);
      this.wasReloading[sd] = r;
    }
    // damage
    const hull = p.hull / p.hullMax;
    if (hull < 0.5 && !this.saidHull) { if (this.say('hull', 'She\'s taking water fast, Captain — the pumps can\'t hold it for ever!', 60)) this.saidHull = true; }
    if (hull > 0.7) this.saidHull = false;
    if (p.fire > 0) this.say('fire', 'Fire on deck! Buckets, lads, buckets!', 20);
    // in irons
    if (p.sailSet > 0.4 && p.effTheta > 2.45 && Math.abs(p.speed) < 1.2) this.say('irons', 'She\'s in irons, Captain! Put the helm hard over and hold it till she pays off.', 30);
  }
}
