// Story campaign — "The Silver of the Plate Fleet" (Nassau, 1716) — plus tavern contracts & treasure maps.
import * as THREE from 'three';
import { ISLANDS, PORTS, SALVAGE_CAMP, GOODS, NATIONS, SHIP_NAMES, at } from './data.js';
import { pick, rand, randInt } from '../core/noise.js';

const V = (x, z) => new THREE.Vector3(x, 0, z);
const G = (lon, lat, dx, dz) => { const [x, z] = at(lon, lat, dx, dz); return V(x, z); };
// the western mouth of Nassau harbour, past the end of Hog Island
const G2 = (lon, lat) => { const [x, z] = at(lon, lat); return { x, z }; };
const HARBOUR_MOUTH = G(-77.345, 25.078, -470, -70);
const NORTH_OF_NASSAU = G(-77.32, 25.42);

export function buildStory(game) {
  const S = game.state;
  const nassau = () => game.towns.nassau;
  return [
    {
      id: 'm1', title: 'A Sloop Called Ranger',
      intro: ['Benjamin Hornigold', `So you're ${S.captainName}. The Peace of Utrecht left a great many good privateers without a commission — and Nassau is where such men wash up. I've a Jamaica sloop, the Ranger, that needs a captain. Take her out and show me you can handle her.`],
      stages: [
        { text: 'Meet Captain Hornigold at the Council of Captains', marker: () => nassau().doors.find((d) => d.type === 'governor').pos, onEvent: (e) => e.type === 'interact' && e.door.type === 'governor' && e.port === 'nassau', dialog: true },
        { text: 'Board the Ranger at the Nassau pier  [F]', marker: () => nassau().pierEnd, onEvent: (e) => e.type === 'board' },
        { text: 'Raise sail [W] and clear the harbour past Hog Island', marker: () => HARBOUR_MOUTH, check: () => game.playerShip && game.playerShip.position.distanceTo(HARBOUR_MOUTH) < 120 },
        { text: 'Test the guns: fire a broadside  [Left Mouse] or [Q]/[E]', onEvent: (e) => e.type === 'fired' },
      ],
      reward: { gold: 150, renown: 2 },
      outro: ['Benjamin Hornigold', 'Ha! She answers the helm like a racehorse. Come back to the Council when you are ready for real work.'],
    },
    {
      id: 'm2', title: 'First Prize',
      intro: ['Benjamin Hornigold', 'A Dutch fluyt out of Curaçao is working up the channel past Andros with a hold full of cloth and rum. Fly false colours if you like — make her strike, then lay alongside and board her. Bring the plunder home.'],
      giver: { port: 'nassau', door: 'governor' },
      stages: [
        { text: 'Visit the Council of Captains in Nassau for your orders', marker: () => nassau().doors.find((d) => d.type === 'governor').pos, onEvent: (e) => e.type === 'interact' && e.door.type === 'governor' && e.port === 'nassau', dialog: true },
        {
          text: 'Hunt down the Dutch fluyt "Goede Verwachting" near Andros',
          onStart: () => {
            const s = game.spawnShip('fluyt', 'dutch', { role: 'merchant', name: 'Goede Verwachting', ...G2(-77.75, 25.42), heading: -Math.PI / 2, mission: true, cargo: { cloth: 30, rum: 25, powder: 10 }, gold: 450, crewFrac: 0.7, dest: G2(-76.75, 25.85) });
            game.missionTarget = s;
          },
          marker: () => game.missionTarget?.position,
          onEvent: (e) => (e.type === 'captured' || e.type === 'sunk') && e.ship === game.missionTarget,
        },
        { text: 'Return to Nassau with your prize', marker: () => nassau().berth && V(nassau().berth.x, nassau().berth.z), onEvent: (e) => e.type === 'dock' && e.port === 'nassau' },
      ],
      reward: { gold: 300, renown: 4 },
      outro: ['Benjamin Hornigold', 'A clean job. Sell what you took to the fence — nobody in Nassau asks where a bolt of Dutch linen came from.'],
    },
    {
      id: 'm3', title: 'Silver on the Sand',
      intro: ['Benjamin Hornigold', 'Listen close. Last July a hurricane wrecked the whole Spanish Plate Fleet on the Florida coast. The Dons have a salvage camp at Palmar de Ayz, hauling up silver by the chest-load — and it\'s guarded by one warship. Henry Jennings means to raid it. I mean for us to get there first.'],
      giver: { port: 'nassau', door: 'governor' },
      stages: [
        { text: 'Visit the Council of Captains in Nassau', marker: () => nassau().doors.find((d) => d.type === 'governor').pos, onEvent: (e) => e.type === 'interact' && e.door.type === 'governor' && e.port === 'nassau', dialog: true },
        { text: 'Sail to the Spanish salvage camp on the Florida coast', marker: () => game.salvage.coast3, check: () => game.playerShip && game.playerShip.position.distanceTo(game.salvage.coast3) < 700 },
        {
          text: 'Defeat the guard ship "San Román"',
          onStart: () => {
            const c = game.salvage.coast3;
            const s = game.spawnShip('brigantine', 'spain', { role: 'navy', name: 'San Román', x: c.x + 260, z: c.z + 60, heading: Math.PI / 2, mission: true, patrol: true, strength: 1.1, aggroPlayer: true });
            game.missionTarget = s;
          },
          marker: () => game.missionTarget?.position,
          onEvent: (e) => (e.type === 'captured' || e.type === 'sunk') && e.ship === game.missionTarget,
        },
        {
          text: 'Go ashore [F near the beach] and seize the silver (0/3)',
          onStart: () => {
            const taken = game.state.mission.chests || [];
            game.salvage.chestsTaken = taken.length;
            game.salvage.chests.forEach((c, i) => { c.taken = taken.includes(i); });
            game.spawnSalvageGuards();
          },
          marker: () => game.salvage.center3,
          onEvent: (e, st) => {
            if (e.type === 'chest') {
              game.salvage.chestsTaken++;
              st.text = `Go ashore and seize the silver (${game.salvage.chestsTaken}/3)`;
              game.ui.refreshObjective();
              return game.salvage.chestsTaken >= 3;
            }
            return false;
          },
        },
        { text: 'Return the silver to Nassau', marker: () => V(nassau().berth.x, nassau().berth.z), onEvent: (e) => e.type === 'dock' && e.port === 'nassau' },
      ],
      reward: { gold: 1500, renown: 10, notoriety: { spain: 1.5 } },
      outro: ['Benjamin Hornigold', 'Silver! Real Spanish silver! Every captain in Nassau will be talking of you tonight. But the Dons will not forgive this — keep a weather eye on any ship flying the Cross of Burgundy.'],
    },
    {
      id: 'm4', title: 'The Havana Galleon',
      intro: ['Benjamin Hornigold', 'There\'s a French factor in Cayona on Tortuga who sells secrets as readily as indigo. He sent word he knows the sailing date of a treasure galleon out of La Habana. Go and hear his price.'],
      giver: { port: 'nassau', door: 'governor' },
      stages: [
        { text: 'Visit the Council of Captains in Nassau', marker: () => nassau().doors.find((d) => d.type === 'governor').pos, onEvent: (e) => e.type === 'interact' && e.door.type === 'governor' && e.port === 'nassau', dialog: true },
        {
          text: 'Meet the French factor in the Cayona tavern (Tortuga)', marker: () => game.towns.tortuga.doors.find((d) => d.type === 'tavern').pos,
          onEvent: (e) => e.type === 'interact' && e.door.type === 'tavern' && e.port === 'tortuga',
          talk: ['Monsieur Duval, factor', 'Ah, the famous capitaine from Nassau. The galeón "Nuestra Señora del Carmen" weighs anchor from La Habana within the week, bound for Veracruz with the payroll of New Spain. A frigate escorts her. For your trouble, I ask only one chest in ten… Bonne chance.'],
        },
        {
          text: 'Intercept the treasure galleon off La Habana',
          onStart: () => {
            const h = game.towns.havana;
            const bx = h.berth.x, bz = h.berth.z;
            const g = game.spawnShip('galleon', 'spain', { role: 'merchant', name: 'Nuestra Señora del Carmen', x: bx + 300, z: bz - 600, heading: Math.PI / 2, mission: true, gold: 6000, cargo: { silver: 60, tobacco: 20 }, crewFrac: 0.8, dest: G2(-84.6, 23.3), courage: 0.9, aggressive: true });
            const e = game.spawnShip('frigate', 'spain', { role: 'navy', name: 'Santa Rita', x: bx + 380, z: bz - 520, heading: Math.PI / 2, mission: true, escortOf: g });
            game.missionTarget = g;
            game.missionEscort = e;
          },
          marker: () => game.missionTarget?.position,
          onEvent: (e) => (e.type === 'captured' || e.type === 'sunk') && e.ship === game.missionTarget,
        },
        { text: 'Escape the Spanish and return to Nassau', marker: () => V(nassau().berth.x, nassau().berth.z), onEvent: (e) => e.type === 'dock' && e.port === 'nassau' },
      ],
      reward: { gold: 2500, renown: 20, notoriety: { spain: 2 } },
      outro: ['Benjamin Hornigold', 'The whole Main will know your name now. And that, my friend, is the trouble. A Royal Navy man-of-war has put in at Port Royal with orders to hang every pirate in Nassau.'],
    },
    {
      id: 'm5', title: 'The Pirate Hunter',
      intro: ['Benjamin Hornigold', 'HMS Scarborough — fifty guns, and a captain who wants your head on a pike at Gallows Point. She is coming for Nassau. You can run… or you can meet her at sea. Refit at the shipwright first if you have the coin.'],
      giver: { port: 'nassau', door: 'governor' },
      stages: [
        { text: 'Visit the Council of Captains in Nassau', marker: () => nassau().doors.find((d) => d.type === 'governor').pos, onEvent: (e) => e.type === 'interact' && e.door.type === 'governor' && e.port === 'nassau', dialog: true },
        { text: 'Put to sea and meet HMS Scarborough north of Nassau', marker: () => NORTH_OF_NASSAU, check: () => game.playerShip && game.mode === 'sail' && game.playerShip.position.distanceTo(NORTH_OF_NASSAU) < 600 },
        {
          text: 'Defeat HMS Scarborough',
          onStart: () => {
            const m = game.spawnShip('manowar', 'britain', { role: 'hunter', name: 'HMS Scarborough', ...G2(-77.2, 25.68), heading: Math.PI * 0.9, mission: true, aggroPlayer: true, strength: 1.0 });
            game.spawnShip('sloop', 'britain', { role: 'hunter', name: 'HMS Shark', ...G2(-77.28, 25.7), heading: Math.PI, mission: true, aggroPlayer: true, escortOf: m });
            game.missionTarget = m;
          },
          marker: () => game.missionTarget?.position,
          onEvent: (e) => (e.type === 'captured' || e.type === 'sunk') && e.ship === game.missionTarget,
        },
      ],
      reward: { gold: 4000, renown: 40 },
      outro: ['Benjamin Hornigold', 'The Scarborough, beaten! There is not a governor from Boston to Barbados who will sleep easy tonight. The sea is yours, Captain — every island, every prize. Long may the Brethren of the Coast sail free.'],
      finale: true,
    },
  ];
}

export class Missions {
  constructor(game) {
    this.game = game;
    this.story = buildStory(game);
  }

  get current() {
    const m = this.game.state.mission;
    return this.story.find((s) => s.id === m.id) || null;
  }
  get stage() {
    const c = this.current;
    return c ? c.stages[this.game.state.mission.stage] : null;
  }

  objectiveText() {
    const st = this.stage;
    if (st) return st.text;
    const c = this.game.state.contracts[0];
    if (c) return c.text;
    return null;
  }

  marker() {
    const st = this.stage;
    if (st?.marker) {
      const m = st.marker();
      if (m) return m;
    }
    const c = this.game.state.contracts[0];
    if (c?.marker) return c.target ? c.target.position : new THREE.Vector3(c.marker.x, 0, c.marker.z);
    const w = this.game.state.waypoint;
    if (w) return new THREE.Vector3(w.x, 0, w.z);
    return null;
  }

  start(stageIdx = this.game.state.mission.stage) {
    const st = this.stage;
    if (st?.onStart && !st._started) { st._started = true; st.onStart(); }
    if (st?.id === undefined && this.game.state.mission.id === 'm3' && this.game.state.mission.stage === 3) {
      st.text = `Go ashore [F near the beach] and seize the silver (${this.game.salvage.chestsTaken || 0}/3)`;
    }
  }

  // re-create mission entities after loading a save
  resume() {
    const st = this.stage;
    if (!st) return;
    if (st.onStart) { st._started = true; st.onStart(); }
  }

  advance() {
    const g = this.game;
    const m = g.state.mission;
    const cur = this.current;
    const st = cur.stages[m.stage];
    m.stage++;
    g.audio.ui('click');
    if (m.stage >= cur.stages.length) {
      // complete
      m.done.push(cur.id);
      const r = cur.reward || {};
      if (r.gold) g.state.gold += r.gold;
      if (r.renown) g.state.renown += r.renown;
      if (r.notoriety) for (const k in r.notoriety) g.state.addNotoriety(k, r.notoriety[k]);
      g.missionTarget = null;
      g.ui.missionComplete(cur.title, r, () => {
        if (cur.outro) g.ui.dialog(cur.outro[0], cur.outro[1], () => { if (cur.finale) g.ui.finale(); });
      });
      const idx = this.story.indexOf(cur);
      const next = this.story[idx + 1];
      m.id = next ? next.id : null;
      m.stage = 0;
      g.save();
    } else {
      g.ui.toast('Objective: ' + cur.stages[m.stage].text, 'objective');
      this.start();
    }
    g.ui.refreshObjective();
  }

  onEvent(e) {
    const g = this.game;
    const cur = this.current;
    const st = this.stage;
    let consumed = false;
    if (cur && st) {
      if (st.onEvent && st.onEvent(e, st)) {
        if (st.dialog && cur.intro) {
          g.ui.dialog(cur.intro[0], cur.intro[1], () => this.advance());
          consumed = true;
        } else if (st.talk) {
          g.ui.dialog(st.talk[0], st.talk[1], () => this.advance());
          consumed = true;
        } else {
          this.advance();
          consumed = e.type === 'interact';
        }
      }
    }
    // contracts
    for (const c of [...g.state.contracts]) {
      if (c.type === 'bounty' && (e.type === 'sunk' || e.type === 'captured') && e.ship === c.target) this.completeContract(c);
      if (c.type === 'delivery' && e.type === 'dock' && e.port === c.to) {
        if ((g.state.ship.cargo[c.good] || 0) >= c.qty) {
          g.state.ship.cargo[c.good] -= c.qty;
          this.completeContract(c);
        } else g.ui.toast(`You need ${c.qty} ${GOODS[c.good].name} for the delivery.`, 'warn');
      }
    }
    return consumed;
  }

  update(dt) {
    const st = this.stage;
    if (st?.check && st.check()) this.advance();
    const w = this.game.state.waypoint;
    if (w && Math.hypot(w.x - this.game.focus.x, w.z - this.game.focus.z) < 120) {
      this.game.state.waypoint = null;
      this.game.ui.toast('You have reached your waypoint.', 'info', 2000);
    }
    // contract expiry
    const g = this.game;
    for (const c of [...g.state.contracts]) {
      if (c.deadline !== undefined && g.state.day > c.deadline) {
        g.state.contracts = g.state.contracts.filter((x) => x !== c);
        if (c.target) { c.target.mission = false; c.target.despawnT = 30; }
        g.ui.toast(`Contract failed: ${c.title}`, 'warn');
        g.ui.refreshObjective();
      }
    }
  }

  completeContract(c) {
    const g = this.game;
    g.state.contracts = g.state.contracts.filter((x) => x !== c);
    g.state.gold += c.reward;
    g.state.renown += 2;
    if (c.nation) g.state.addNotoriety(c.nation, -1.2);
    g.audio.coins();
    g.ui.toast(`Contract complete: ${c.title}  +${c.reward} ⛁`, 'good');
    g.ui.refreshObjective();
  }

  // --- tavern offerings
  generateContracts(portId) {
    const g = this.game;
    const port = PORTS.find((p) => p.id === portId);
    const offers = [];
    const seed = g.state.day * 7 + portId.length;
    const r = (k) => Math.abs(Math.sin(seed * 12.9898 + k * 78.233) * 43758.5453) % 1;
    // bounty on a pirate
    if (port.nation !== 'pirate') {
      const isl = ISLANDS[Math.floor(r(1) * ISLANDS.length)];
      const ang = r(2) * Math.PI * 2;
      const dist = Math.max(isl.rx, isl.rz) + 350;
      const name = SHIP_NAMES.pirate[Math.floor(r(3) * SHIP_NAMES.pirate.length)];
      offers.push({
        type: 'bounty', title: `Bounty: the pirate ${name}`, nation: port.nation,
        text: `Sink or take the pirate sloop "${name}", last seen near ${isl.name}`,
        marker: { x: isl.x + Math.cos(ang) * dist, z: isl.z + Math.sin(ang) * dist }, reward: 500 + Math.floor(r(4) * 600), shipName: name,
        cls: r(5) < 0.5 ? 'sloop' : 'brigantine', deadline: g.state.day + 6,
      });
    }
    // delivery
    const others = PORTS.filter((p) => p.id !== portId);
    const to = others[Math.floor(r(6) * others.length)];
    const good = to.demands[Math.floor(r(7) * to.demands.length)];
    const qty = 10 + Math.floor(r(8) * 20);
    offers.push({
      type: 'delivery', title: `Deliver ${qty} ${GOODS[good].name} to ${to.name}`, good, qty, to: to.id,
      text: `Deliver ${qty} ${GOODS[good].name} to ${to.name}`,
      marker: { x: to.coast[0], z: to.coast[1] }, reward: Math.round(qty * GOODS[good].base * 0.9 + 150), deadline: g.state.day + 8, provides: true,
    });
    // treasure map
    const wild = ISLANDS.filter((i) => !PORTS.some((p) => p.island === i.id) && i.id !== 'florida' && i.rx < 1000);
    const isl = wild[Math.floor(r(9) * wild.length)];
    offers.push({ type: 'map', title: `A tattered map of ${isl.name}`, island: isl.id, price: 180 + Math.floor(r(10) * 220), text: `Dig for buried treasure on ${isl.name}` });
    return offers;
  }

  acceptContract(c) {
    const g = this.game;
    if (c.type === 'map') {
      if (g.state.gold < c.price) return g.ui.toast('Not enough coin.', 'warn');
      g.state.gold -= c.price;
      const spot = g.findTreasureSpot(c.island);
      if (!spot) return g.ui.toast('The map is illegible — the seller refunds you.', 'warn'), (g.state.gold += c.price);
      g.state.treasureMaps.push({ island: c.island, x: spot.x, z: spot.z, value: 800 + randInt(0, 1400), found: false });
      g.ui.toast(`Treasure map of ${ISLANDS.find((i) => i.id === c.island).name} added to your chart.`, 'good');
      g.spawnTreasureMarkers();
      return;
    }
    if (g.state.contracts.length >= 3) return g.ui.toast('You already have three contracts.', 'warn');
    if (c.type === 'delivery' && c.provides) {
      const room = g.playerCargoRoom();
      if (room < c.qty) return g.ui.toast('Not enough room in the hold for the consignment.', 'warn');
      g.state.ship.cargo[c.good] = (g.state.ship.cargo[c.good] || 0) + c.qty;
    }
    const copy = { ...c };
    if (c.type === 'bounty') {
      const s = g.spawnShip(c.cls, 'pirate', { role: 'pirate', name: c.shipName, x: c.marker.x, z: c.marker.z, heading: rand(-3, 3), mission: true, patrol: true, aggroPlayer: true });
      copy.target = s;
    }
    g.state.contracts.push(copy);
    g.ui.toast('Contract accepted: ' + c.title, 'objective');
    g.ui.refreshObjective();
  }
}
