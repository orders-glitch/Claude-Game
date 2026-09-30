// Game orchestrator: world construction, main loop, modes (title / sailing / ashore), combat rules,
// notoriety & pirate hunters, docking, boarding, loot, missions and persistence.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

import { Input } from './core/input.js';
import { AudioSystem } from './core/audio.js';
import { setMaxAnisotropy } from './core/textures.js';
import { clamp, damp, dampAngle, lerp, rand, randInt, pick, wrapAngle } from './core/noise.js';
import { Terrain } from './world/terrain.js';
import { Ocean } from './world/ocean.js';
import { SkySystem } from './world/sky.js';
import { Weather } from './world/weather.js';
import { Vegetation } from './world/vegetation.js';
import { Grass } from './world/grass.js';
import { Wildlife } from './world/wildlife.js';
import { Town, buildSalvageCamp } from './world/town.js';
import { sharedMaterials } from './world/builder.js';
import { Ship, BALL_SPEED, GRAVITY } from './entities/ship.js';
import { ShipAI } from './entities/shipAI.js';
import { shipTime, shipMaterials } from './entities/shipModel.js';
import { Effects } from './entities/effects.js';
import { Projectiles } from './entities/projectiles.js';
import { PlayerWalker, NPC, lookFor } from './entities/actors.js';
import { modelLibrary } from './entities/modelLibrary.js';
import { humans } from './entities/humans.js';
import { props } from './world/props.js';
import { weapons } from './entities/weapons.js';
import { flora, TREE_TYPES } from './world/flora.js';
import { loadTerrainTextures } from './world/terrainMaterial.js';
import { TerrainDetail } from './world/terrain.js';
import { ISLANDS, PORTS, NATIONS, SHIP_CLASSES, SHIP_NAMES, GOODS, SALVAGE_CAMP, MONTHS } from './game/data.js';
import { GameState } from './game/state.js';
import { Missions } from './game/missions.js';
import { UI } from './ui/ui.js';

// Scrubs NaN / overflowed pixels (some GPUs produce them from edge-case maths) before bloom can smear a
// single bad pixel across the whole frame as a black flash.
const SANITIZE_SHADER = {
  uniforms: { tDiffuse: { value: null } },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      bool bad = !(c.r >= 0.0 && c.r < 6.0e4) || !(c.g >= 0.0 && c.g < 6.0e4) || !(c.b >= 0.0 && c.b < 6.0e4);
      gl_FragColor = bad ? vec4(0.0, 0.0, 0.0, 1.0) : vec4(c.rgb, 1.0);
    }`,
};

const GRADE_SHADER = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uVignette: { value: 0.32 }, uSat: { value: 1.08 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uTime; uniform float uVignette; uniform float uSat; varying vec2 vUv;
    float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)) + uTime) * 43758.5453); }
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      float l = dot(c.rgb, vec3(0.299,0.587,0.114));
      c.rgb = mix(vec3(l), c.rgb, uSat);
      // warm highlights, cool shadows — a painterly period grade
      c.rgb += vec3(0.018, 0.008, -0.012) * smoothstep(0.4, 1.0, l) + vec3(-0.01, 0.0, 0.015) * (1.0 - smoothstep(0.0, 0.35, l));
      vec2 d = vUv - 0.5;
      c.rgb *= 1.0 - uVignette * dot(d, d) * 2.2;
      c.rgb += (h(vUv * 1000.0) - 0.5) * 0.018;
      gl_FragColor = c;
    }`,
};

const PLAYER_ID = 0;
const tmpV = new THREE.Vector3();

export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.state = new GameState();
    this.audio = new AudioSystem();
    this.input = new Input(canvas);
    this.mode = 'loading';
    this.ships = [];
    this.npcs = [];
    this.pickups = [];
    this.treasureMarkers = [];
    this.fps = 60;
    this.paused = false;
    this.camYaw = 0; this.camPitch = 0.28; this.camDist = 60;
    this.focus = new THREE.Vector3();
    this.combatNear = false;
    this.huntersActive = {};
    this.forts = [];
    this.timeScale = 1;
    this.hitShips = new Set();
    this.timers = new Set();
    this.transitioning = false;
  }

  // ======================================================================== init
  async init() {
    const ui = (this.ui = new UI(this));
    const step = async (p, text) => { ui.setLoading(p, text); await new Promise((r) => setTimeout(r, 16)); };
    const q = this.state.settings.quality;
    this.quality = q;

    await step(0.05, 'Priming the powder…');
    const renderer = (this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: false, powerPreference: 'high-performance', stencil: false }));
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, q === 'high' ? 1.5 : q === 'medium' ? 1.25 : 1));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.95;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = q !== 'low';
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.info.autoReset = false;
    setMaxAnisotropy(renderer.capabilities.getMaxAnisotropy());

    const scene = (this.scene = new THREE.Scene());
    this.camera = new THREE.PerspectiveCamera(this.state.settings.fov, window.innerWidth / window.innerHeight, 0.3, 24000);

    await step(0.1, 'Stowing the cargo…');
    await Promise.all([props.load(), weapons.load(), loadTerrainTextures(), flora.load([...TREE_TYPES, 'pachira_aquatica_01', 'calathea_orbifolia_01', 'anthurium_botany_01'])]);
    flora.bakeImpostors(renderer);
    this.flora = flora;
    this.weapons = weapons;
    await step(0.12, 'Surveying the islands…');
    this.terrain = new Terrain(ISLANDS);
    this.towns = {};
    this.townList = [];
    for (const p of PORTS) {
      const t = new Town(p, this.terrain, NATIONS[p.nation]);
      this.towns[p.id] = t;
      this.townList.push(t);
    }
    await step(0.22, 'Salvaging the Plate Fleet…');
    const camp = buildSalvageCamp(scene, this.terrain, SALVAGE_CAMP);
    this.salvage = camp;
    camp.coast3 = new THREE.Vector3(camp.coast.x, 0, camp.coast.z).add(new THREE.Vector3(-Math.sin(SALVAGE_CAMP.dir), 0, -Math.cos(SALVAGE_CAMP.dir)).multiplyScalar(160));
    camp.center3 = camp.center.clone();

    await step(0.3, 'Sounding the shoals…');
    this.terrain.bakeHeightmap(1024);
    await step(0.4, 'Raising the islands…');
    this.terrain.buildMeshes(scene, q);
    this.terrainDetail = new TerrainDetail(this.terrain, scene, q === 'low' ? { cell: 4, radius: 1 } : q === 'medium' ? { cell: 2, radius: 1 } : { cell: 2, radius: 2 });
    await step(0.55, 'Building the colonies…');
    for (const t of this.townList) t.build(scene);
    this.shipBlockers = this.townList.flatMap((t) => t.shipBlockers);
    for (const t of this.townList) {
      if (t.port.nation !== 'pirate' && t.cannons.length) this.forts.push({ town: t, timer: 3, cannons: t.cannons });
    }

    await step(0.65, 'Filling the oceans…');
    this.ocean = new Ocean(scene, this.terrain, q);
    this.sky = new SkySystem(scene, renderer, q);
    this.weather = new Weather(scene);
    this.wind = this.weather.wind;

    await step(0.75, 'Planting palms…');
    const avoid = (x, z) => {
      for (const t of this.townList) {
        if (Math.hypot(x - t.center.x, z - t.center.z) < t.R * 1.35) return true;
      }
      if (Math.hypot(x - camp.center.x, z - camp.center.z) < 70) return true;
      return false;
    };
    this.vegetation = new Vegetation(scene, this.terrain, avoid, q);
    this.wildlife = new Wildlife(scene, this.terrain);
    this.grass = new Grass(scene, this.terrain, null, q);
    this.props = props;
    props.flush(scene, { shadows: q !== 'low', viewDist: q === 'low' ? 500 : 900 });

    await step(0.8, 'Mustering the crew…');
    await Promise.all([modelLibrary.load(), humans.load()]);
    this.humans = humans;
    await step(0.85, 'Casting cannon…');
    this.effects = new Effects(scene, this.ocean);
    this.projectiles = new Projectiles(scene);
    this.ui.buildWorldMap();

    // post-processing
    await step(0.92, 'Mixing the colours…');
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: q === 'low' ? 0 : 4 });
    this.composer = new EffectComposer(renderer, rt);
    this.composer.addPass(new RenderPass(scene, this.camera));
    this.composer.addPass(new ShaderPass(SANITIZE_SHADER));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.35, 0.5, 1.6);
    if (q !== 'low') this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.grade = new ShaderPass(GRADE_SHADER);
    this.composer.addPass(this.grade);

    window.addEventListener('resize', () => this.onResize());
    this.input.onLockChange = (locked) => this.onLockChange(locked);
    this.canvas.addEventListener('click', () => {
      if ((this.mode === 'sail' || this.mode === 'foot') && !this.ui.anyModal()) { this.audio.init(); this.input.lock(); }
    });
    window.addEventListener('keydown', (e) => this.onKey(e));

    await step(0.97, 'Hoisting the colours…');
    this.missions = new Missions(this);
    this.setupTitle();
    // warm-up render (compiles shaders)
    this.sky.update(0.016, this.state.hours, this.camera, this.focus);
    this.updateTitle(0.016);
    // compile every shader before revealing the world (avoids pop-in while programs link)
    await step(0.98, 'Tarring the rigging…');
    try { await this.renderer.compileAsync(scene, this.camera); } catch (e) { this.renderer.compile(scene, this.camera); }
    this.composer.render();
    await step(1, 'Ready.');
    this.ui.hideLoading();
    this.ui.showTitle();
    this.applySettings();
    this.last = performance.now();
    requestAnimationFrame((t) => this.loop(t));
  }

  onResize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
  }

  applySettings() {
    const s = this.state.settings;
    this.audio.setVolumes({ master: s.master, music: s.music, sfx: s.sfx });
    this.input.sensitivity = s.sensitivity;
    this.input.invertY = s.invertY;
    this.baseFov = s.fov;
  }

  hasSave() { return GameState.hasSave(); }
  saveSummary() { return GameState.saveSummary(); }
  dayToDate(day) {
    const d = new Date(Date.UTC(1716, 5, 1 + day));
    return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
  }

  // ======================================================================== title
  setupTitle() {
    this.mode = 'title';
    this.clearWorld();
    this.state.hours = 16.6;
    this.weather.force('fair');
    const n = this.towns.nassau;
    const s = this.spawnShip('brigantine', 'pirate', { role: 'pirate', name: 'Revenge', x: n.coast.x + 350, z: n.coast.z - 420, heading: -Math.PI / 2 + 0.3, patrol: true });
    s.ai.patrolR = 400;
    this.titleShip = s;
    this.spawnShip('fluyt', 'britain', { role: 'merchant', name: 'Mary Anne', x: n.coast.x - 300, z: n.coast.z - 700, heading: 1.2, dest: { x: 3000, z: -6000 } });
    this.titleT = 0;
  }

  clearWorld() {
    for (const id of this.timers) clearTimeout(id);
    this.timers.clear();
    this.transitioning = false;
    this.digging = null;
    this.ui.fade(false);
    for (const s of this.ships) { this.effects.removeWake(s.wake); s.dispose(this.scene); }
    this.ships = [];
    this.playerShip = null;
    this.despawnNPCs();
    if (this.walker) { this.walker.dispose(); this.walker = null; }
    for (const p of this.pickups) this.scene.remove(p.mesh);
    this.pickups = [];
    this.projectiles.list = [];
    this.missionTarget = null;
    this.clearTreasureMarkers();
  }

  newGame(name, shipName) {
    GameState.deleteSave();
    const settings = this.state.settings;
    this.state.reset(name);
    this.state.settings = settings;
    this.state.shipName = shipName;
    this.missions = new Missions(this);
    this.startSession(false);
    this.ui.dialog('Nassau, New Providence — June 1716', 'The Peace of Utrecht has ended the war with Spain, and with it your privateer\'s commission. Like hundreds of other seamen, you have drifted to Nassau — a lawless harbour of wrecks, tents and taverns, where the Brethren of the Coast answer to no king. Captain Benjamin Hornigold wants to meet you.', () => {});
  }

  continueGame() {
    if (!this.state.load()) return this.newGame('James Kidd', 'Ranger');
    this.missions = new Missions(this);
    this.startSession(true);
  }

  startSession(fromSave) {
    this.clearWorld();
    this.ui.hideTitle();
    this.audio.init();
    const s = this.state;
    this.weather.force('fair');
    this.lastHourBell = Math.floor(s.hours);
    s.onNewDay = () => { s.relaxMarkets(); };
    // player ship
    const pos = s.position;
    if (fromSave && pos && pos.mode === 'sail') {
      this.createPlayerShip(pos.x, pos.z, pos.heading);
      this.enterSail();
    } else {
      const port = this.towns[(pos && pos.port) || s.lastPort] || this.towns.nassau;
      this.createPlayerShip(port.berth.x, port.berth.z, port.berth.heading);
      this.playerShip.anchored = true;
      this.playerShip.sailTarget = 0;
      this.playerShip.sailSet = 0;
      this.enterFoot(port.spawnPoint.clone(), port);
    }
    this.spawnTreasureMarkers();
    this.missions.resume();
    // restore bounty ships
    for (const c of s.contracts) {
      if (c.type === 'bounty' && !c.target) c.target = this.spawnShip(c.cls, 'pirate', { role: 'pirate', name: c.shipName, x: c.marker.x, z: c.marker.z, heading: rand(-3, 3), mission: true, patrol: true, aggroPlayer: true });
    }
    this.ui.refreshObjective();
    this.input.lock();
    this.fillTraffic(true);
  }

  quitToTitle() {
    this.save();
    this.input.unlock();
    this.ui.hideClickToPlay();
    this.setupTitle();
    this.ui.showTitle();
    this.audio.setMusic('none');
  }

  // ======================================================================== ships
  playerHullMax() { return SHIP_CLASSES[this.state.ship.cls].hull * (1 + 0.25 * this.state.upgrades.hull); }

  createPlayerShip(x, z, heading) {
    const s = this.state;
    const cls = s.ship.cls;
    const ship = new Ship(this, cls, 'pirate', {
      isPlayer: true, name: s.shipName, x, z, heading, flag: s.flag || 'pirate',
      strength: 1 + 0.25 * s.upgrades.hull, hull: s.ship.hull, sails: s.ship.sails, crew: s.ship.crew,
      gunDamage: 1 + 0.35 * s.upgrades.guns, gunRange: 1 + 0.07 * s.upgrades.guns, sailTint: '#e6dcc4', crewFigures: 6,
    });
    ship.id = PLAYER_ID;
    ship.speedMult = 1 + 0.07 * s.upgrades.sails;
    ship.reloadBase = 6.5;
    ship.sailTarget = 0;
    ship.sailSet = 0;
    this.scene.add(ship.group);
    this.effects.addWake(ship.wake);
    this.ships.push(ship);
    this.playerShip = ship;
    ship.updateFloat(0.016, this);
    return ship;
  }

  // Recreate the player's ship from state (after a refit or a new purchase). Callers update state first.
  rebuildPlayerShip() {
    const old = this.playerShip;
    const anchored = old.anchored;
    this.removeShip(old);
    const s = this.createPlayerShip(old.position.x, old.position.z, old.heading);
    s.anchored = anchored;
    s.hull = Math.min(this.state.ship.hull, s.hullMax);
  }

  syncStateFromPlayerShip() {
    const p = this.playerShip;
    if (!p) return;
    this.state.ship.hull = Math.max(1, p.hull);
    this.state.ship.sails = p.sails;
    this.state.ship.crew = p.crew;
  }
  syncPlayerShipFromState() {
    const p = this.playerShip;
    if (!p) return;
    p.hull = this.state.ship.hull; p.sails = this.state.ship.sails; p.crew = this.state.ship.crew;
  }
  playerCargoRoom() { return SHIP_CLASSES[this.state.ship.cls].cargo - this.state.cargoCount(); }

  spawnShip(cls, nation, opts = {}) {
    const name = opts.name || pick(SHIP_NAMES[nation] || SHIP_NAMES.britain);
    const ship = new Ship(this, cls, nation, { ...opts, name });
    ship.mission = !!opts.mission;
    ship.rival = opts.role === 'pirate' && (opts.aggroPlayer || Math.random() < 0.35);
    if (!opts.cargo && opts.role === 'merchant') {
      const goods = Object.keys(GOODS).filter((g) => g !== 'silver');
      const n = randInt(2, 4);
      const cap = SHIP_CLASSES[cls].cargo;
      for (let i = 0; i < n; i++) { const g = pick(goods); ship.cargo[g] = (ship.cargo[g] || 0) + randInt(Math.floor(cap * 0.08), Math.floor(cap * 0.25)); }
      ship.gold = randInt(80, 400) * (cls === 'galleon' ? 6 : 1);
    }
    if (!opts.gold && opts.role !== 'merchant') ship.gold = randInt(60, 250) * (cls === 'manowar' ? 5 : cls === 'frigate' ? 2 : 1);
    const aiOpts = { mode: 'trade', dest: opts.dest, courage: opts.courage, aggressive: opts.aggressive };
    if (opts.patrol || (!opts.dest && !opts.escortOf)) { aiOpts.mode = 'patrol'; aiOpts.home = { x: ship.position.x, z: ship.position.z }; aiOpts.patrolR = opts.patrolR || 700; }
    if (opts.escortOf) { aiOpts.mode = 'escort'; aiOpts.leader = opts.escortOf; }
    ship.ai = new ShipAI(ship, aiOpts);
    ship.ai.escortSide = Math.random() < 0.5 ? 1 : -1;
    if (opts.aggroPlayer) ship.aggro.add(PLAYER_ID);
    ship.sailTarget = opts.sailTarget ?? 2;
    ship.sailSet = 1;
    ship.speed = opts.speed ?? SHIP_CLASSES[cls].speed * 0.5;
    this.scene.add(ship.group);
    this.effects.addWake(ship.wake);
    this.ships.push(ship);
    ship.updateFloat(0.016, this);
    return ship;
  }

  removeShip(s) {
    this.ships = this.ships.filter((x) => x !== s);
    this.effects.removeWake(s.wake);
    s.dispose(this.scene);
  }

  // Hostility from a's perspective toward b.
  isHostile(a, b) {
    if (!a || !b || a === b) return false;
    if (!a.alive || !b.alive) return false;
    if (a.struck || b.struck) return false;
    if (a.aggro.has(b.id)) return true;
    if (b.isPlayer) {
      const w = this.state.wanted(a.nationId);
      if (a.role === 'hunter') return true;
      if (a.role === 'navy') return w >= 2 || (w >= 1 && b.flagKind === 'pirate');
      if (a.role === 'pirate') return a.rival;
      if (a.role === 'merchant') return b.flagKind === 'pirate' && a.position.distanceTo(b.position) < 650;
      return false;
    }
    if (a.isPlayer) return this.isHostile(b, a) || (b.aggro.has(PLAYER_ID));
    const navyish = (s) => s.role === 'navy' || s.role === 'hunter';
    if (navyish(a) && b.role === 'pirate') return true;
    if (a.role === 'pirate' && (b.role === 'merchant' || navyish(b))) return true;
    if (a.role === 'merchant' && b.role === 'pirate') return true;
    return false;
  }

  relationLabel(s) {
    if (s.struck) return 'surrendered';
    if (this.isHostile(s, this.playerShip)) return s.role === 'merchant' ? 'fleeing' : 'hostile';
    return { merchant: 'merchantman', navy: 'navy patrol', hunter: 'pirate hunter', pirate: 'Brethren' }[s.role] || 'neutral';
  }

  // ======================================================================== modes
  enterSail() {
    this.mode = 'sail';
    this.ui.hint('[W]/[S] make or shorten sail · [A]/[D] helm · look to a side and [Left Click] to fire · [1][2][3] shot · [F] dock / board · [M] chart');
    const p = this.playerShip;
    p.anchored = false;
    this.camYaw = p.heading + 0.35;
    this.camPitch = 0.26;
    this.camDist = 30 + p.cls.length * 1.4;
    this.sky.setShadowExtent(40 + p.cls.length * 1.6);
    if (this.walker) { this.walker.dispose(); this.walker = null; }
  }

  enterFoot(pos, town) {
    this.mode = 'foot';
    this.ui.hint('[WASD] walk · [Shift] run · [Left Click] cutlass · hold [Right Click] to aim a pistol · [E] interact · [F] return to ship');
    if (this.walker) this.walker.dispose();
    this.walker = new PlayerWalker(this, { x: pos.x, y: pos.y, z: pos.z, yaw: town ? town.dir + Math.PI : 0 });
    this.walker.camYaw = this.walker.yaw;
    this.currentTown = town || null;
    this.sky.setShadowExtent(45);
  }

  // setTimeout scoped to the current session: cancelled when the world is cleared
  later(ms, fn) {
    const id = setTimeout(() => { this.timers.delete(id); fn(); }, ms);
    this.timers.add(id);
    return id;
  }

  // fade-out → action → fade-in, ignoring further input until it completes
  transition(ms, fn) {
    if (this.transitioning) return;
    this.transitioning = true;
    this.ui.fade(true);
    this.later(ms, () => {
      this.transitioning = false;
      fn();
      this.ui.fade(false);
    });
  }

  dock(town) {
    const p = this.playerShip;
    this.transition(700, () => {
      p.position.set(town.berth.x, 0, town.berth.z);
      p.heading = town.berth.heading;
      p.speed = 0;
      p.sailTarget = 0; p.sailSet = 0;
      p.anchored = true;
      p.updateAxes();
      p.updateFloat(0.016, this);
      this.enterFoot(town.spawnPoint.clone(), town);
      this.state.lastPort = town.port.id;
      this.syncStateFromPlayerShip();
      this.discover(town);
      this.missions.onEvent({ type: 'dock', port: town.port.id });
      this.save();
      const w = this.state.wanted(town.port.nation);
      if (town.port.nation !== 'pirate' && w >= 2) this.ui.toast(`The ${NATIONS[town.port.nation].adj} garrison knows your face — expect trouble ashore!`, 'warn', 5000);
      else this.ui.toast(`Welcome to ${town.port.name}. ${town.port.desc}`, 'info', 5000);
    });
  }

  goAshore(landing) {
    const p = this.playerShip;
    this.transition(600, () => {
      p.speed = 0; p.sailTarget = 0; p.anchored = true;
      this.syncStateFromPlayerShip();
      this.enterFoot(new THREE.Vector3(landing.x, landing.y + 0.2, landing.z), null);
      this.walker.yaw = Math.atan2(-(landing.x - p.position.x), -(landing.z - p.position.z));
      this.walker.camYaw = this.walker.yaw;
      this.ui.toast('Your boat crew rows you ashore. Press F near the water to return.', 'info');
    });
  }

  boardOwnShip() {
    this.transition(600, () => {
      this.despawnNPCs(true);
      this.currentTown = null;
      this.enterSail();
      const p = this.playerShip;
      // push away from the pier a little
      p.speed = 2;
      this.missions.onEvent({ type: 'board' });
      this.ui.toast('All hands! Make sail with [W].', 'info');
    });
  }

  // ======================================================================== loop
  loop(t) {
    requestAnimationFrame((tt) => this.loop(tt));
    let dt = (t - this.last) / 1000;
    this.last = t;
    if (!(dt > 0)) dt = 0.016;
    dt = Math.min(dt, 0.05);
    this.fps = lerp(this.fps, 1 / Math.max(dt, 0.001), 0.05);
    const paused = this.ui.anyModal() || this.mode === 'loading';
    if (!paused) this.update(dt);
    else this.updatePaused(dt);
    this.render(dt);
    this.input.endFrame();
  }

  updatePaused(dt) {
    // keep audio music scheduler alive
    this.audio.update(dt, { seaLevel: 0.3, surf: 0, wind: 0.2, rain: 0, town: 0, onShip: false, seaState: 1, nearLand: 0, day: true });
    if (this.ui.top() === 'chart') { /* static */ }
  }

  update(dt) {
    const s = this.state;
    // time: one game minute per real second
    if (this.mode !== 'title') {
      s.advanceHours(dt / 60 * this.timeScale);
      const hr = Math.floor(s.hours);
      if (hr !== this.lastHourBell) {
        this.lastHourBell = hr;
        if (this.mode === 'sail' && hr % 4 === 0) this.audio.bell(8);
        else if (this.mode === 'sail' && hr % 2 === 0) this.audio.bell(2);
      }
    } else s.hours = 16.6 + Math.sin(this.titleT * 0.02) * 0.2;
    shipTime.value += dt;

    // world systems
    this.weather.update(dt, this.mode === 'title' ? 0 : dt, this.camera, this.sky, this.ocean, this.audio);
    this.effects.windX = this.wind.x * this.wind.strength * 4;
    this.effects.windZ = this.wind.z * this.wind.strength * 4;
    this.sky.update(dt, s.hours, this.camera, this.focus);
    this.ocean.update(dt, this.camera, this.sky, this.weather.fog);
    const night = this.sky.nightFactor;
    sharedMaterials().windowLit.emissiveIntensity = night * 2.2;
    shipMaterials().window.emissiveIntensity = night * 2.5;
    for (const t of this.townList) if (t.group && t.center.distanceTo(this.camera.position) < 2500) t.update(dt, shipTime.value, night);
    props.setNight(night);

    // input-driven modes
    if (this.mode === 'sail') this.updateSailing(dt);
    else if (this.mode === 'foot') this.updateFoot(dt);
    else if (this.mode === 'title') this.updateTitle(dt);

    // ships
    for (const ship of this.ships) {
      if (ship.ai && !ship.isPlayer) ship.ai.update(dt, this);
      ship.update(dt, this);
      if (ship.anchored && ship.isPlayer) { ship.speed = damp(ship.speed, 0, 1, dt); }
      ship.group.visible = ship.position.distanceTo(this.camera.position) < 4500;
    }
    for (const ship of [...this.ships]) {
      if (ship.sunk) {
        if (ship.isPlayer) continue;
        this.removeShip(ship);
      }
    }
    this.shipCollisions(dt);
    this.projectiles.update(dt, this);
    this.updateForts(dt);
    this.updatePickups(dt);
    this.effects.update(dt, this.sky, this.weather.fog);
    this.vegetation.update(dt, this.camera.position, this.wind.strength * (1 + this.sky.storm));
    props.update(this.camera.position);
    flora.update(this.camera.position, this.sky);
    if (this.camera.position.y - this.terrain.height(this.camera.position.x, this.camera.position.z) < 60) this.grass.update(this.camera.position);
    this.terrainDetail.update(this.camera.position);
    this.wildlife.update(dt, this.focus, this.sky.nightFactor + this.sky.storm * 0.8);
    if (this.mode !== 'title') {
      this.updateNotoriety(dt);
      this.fillTraffic(false);
      this.manageNPCs();
      this.missions.update(dt);
    }
    // salvage-camp guards only exist while that objective is live
    if (this.keepNPCs && !(s.mission.id === 'm3' && s.mission.stage === 3)) this.despawnNPCs();
    // npcs
    for (const n of this.npcs) n.update(dt);
    this.combatT = Math.max(0, (this.combatT || 0) - dt);
    this.combatNear = this.combatT > 0;

    this.updateAudio(dt);
    if (this.mode !== 'title') this.ui.update(dt);
    this.grade.uniforms.uTime.value = (this.grade.uniforms.uTime.value + dt) % 100;
  }

  render() {
    this.renderer.info.reset();
    this.composer.render();
  }

  // ======================================================================== title camera
  updateTitle(dt) {
    this.titleT += dt;
    const s = this.titleShip;
    if (!s || !s.alive) return;
    const a = this.titleT * 0.035 + 2.2;
    const d = 88;
    this.camera.position.set(s.position.x + Math.cos(a) * d, 6 + Math.sin(this.titleT * 0.1) * 1.5, s.position.z + Math.sin(a) * d);
    this.camera.position.y = Math.max(this.camera.position.y, this.ocean.heightAt(this.camera.position.x, this.camera.position.z) + 3);
    // frame the ship in the right third of the screen, leaving room for the menu
    const to = s.position.clone().sub(this.camera.position); to.y = 0; to.normalize();
    const left = new THREE.Vector3(to.z, 0, -to.x);
    const target = s.position.clone().add(new THREE.Vector3(0, 16, 0)).addScaledVector(left, 30);
    this.camera.lookAt(target);
    this.camera.fov = 55; this.camera.updateProjectionMatrix();
    this.focus.copy(s.position);
    this.sky.setShadowExtent(80);
  }

  cameraYaw() {
    const d = this.camera.getWorldDirection(tmpV);
    return Math.atan2(-d.x, -d.z);
  }
  cameraBearing() { return ((-this.cameraYaw() * 180) / Math.PI + 360) % 360; }

  // ======================================================================== sailing
  updateSailing(dt) {
    const p = this.playerShip;
    const inp = this.input;
    const m = inp.consumeMouse();
    this.focus.copy(p.position);
    if (!p.alive) {
      this.sinkCam(dt);
      return;
    }
    // helm & sails
    if (inp.hit('KeyW')) { p.sailTarget = Math.min(2, p.sailTarget + 1); p.anchored = false; this.audio.ui('click'); }
    if (inp.hit('KeyS')) { p.sailTarget = Math.max(0, p.sailTarget - 1); this.audio.ui('click'); }
    p.rudderInput = (inp.down('KeyA') ? 1 : 0) - (inp.down('KeyD') ? 1 : 0);
    if (inp.hit('KeyR')) {
      p.anchored = !p.anchored;
      if (p.anchored) p.sailTarget = 0;
      this.ui.toast(p.anchored ? 'Let go the anchor!' : 'Weigh anchor!', 'info', 1500);
    }
    if (inp.hit('KeyG')) {
      const kind = p.flagKind === 'pirate' ? 'britain' : 'pirate';
      p.setVisibleFlag(kind);
      this.state.flag = kind;
      this.ui.toast(kind === 'pirate' ? 'Hoist the Jolly Roger!' : 'False colours: the British Red Ensign.', 'info');
    }
    if (inp.hit('Digit1')) { p.ammo = 'round'; this.ui.toast('Load round shot — smashes hulls', 'info', 1500); }
    if (inp.hit('Digit2')) { p.ammo = 'chain'; this.ui.toast('Load chain shot — shreds sails', 'info', 1500); }
    if (inp.hit('Digit3')) { p.ammo = 'grape'; this.ui.toast('Load grape shot — clears decks', 'info', 1500); }

    // camera orbit (drifts back astern when the mouse is idle, like a chase camera)
    const spy = inp.mouseDown(2);
    if (Math.abs(m.dx) + Math.abs(m.dy) > 0.0005 || inp.mouseDown(0)) this.camIdle = 0;
    else this.camIdle = (this.camIdle || 0) + dt;
    if (this.camIdle > 4 && !spy) this.camYaw = dampAngle(this.camYaw, p.heading, 0.5, dt);
    this.camYaw -= m.dx;
    this.camPitch = clamp(this.camPitch + m.dy, 0.04, 1.25);
    if (m.wheel) this.camDist = clamp(this.camDist + m.wheel * 6, 18, 220);
    // gentle auto-follow when not looking around
    const cy = Math.cos(this.camPitch), sy = Math.sin(this.camPitch);
    const back = new THREE.Vector3(Math.sin(this.camYaw) * cy, sy, Math.cos(this.camYaw) * cy);
    const target = p.position.clone().add(new THREE.Vector3(0, p.model.deckY + 6, 0));
    let camPos;
    if (spy) {
      camPos = p.position.clone().add(new THREE.Vector3(0, p.model.deckY + 4, 0)).addScaledVector(p.forward, p.cls.length * 0.2);
      this.camera.position.copy(camPos);
      this.camera.lookAt(camPos.x - back.x * 100, camPos.y - back.y * 60 + 6, camPos.z - back.z * 100);
      this.camera.fov = damp(this.camera.fov, 14, 10, dt);
    } else {
      camPos = target.clone().addScaledVector(back, this.camDist);
      const wh = this.ocean.heightAt(camPos.x, camPos.z) + 2.5;
      const th = this.terrain.height(camPos.x, camPos.z) + 3;
      camPos.y = Math.max(camPos.y, wh, th);
      this.camera.position.lerp(camPos, 1 - Math.exp(-12 * dt));
      this.camera.lookAt(target);
      this.camera.fov = damp(this.camera.fov, this.baseFov + clamp(p.speed / 30, 0, 1) * 6, 4, dt);
    }
    this.camera.updateProjectionMatrix();

    // broadside aiming: side facing the camera view
    const camFwd = this.camera.getWorldDirection(new THREE.Vector3()); camFwd.y = 0; camFwd.normalize();
    const sideDot = camFwd.dot(p.right);
    const side = sideDot >= 0 ? 'starboard' : 'port';
    const abeam = Math.abs(sideDot) > 0.45;
    const fwdDot = camFwd.dot(p.forward);
    const sgn = side === 'port' ? -1 : 1;
    const aimYaw = clamp(Math.atan2(fwdDot, Math.abs(sideDot)), -0.3, 0.3) * sgn;
    const elevation = spy ? clamp(0.02 + (0.5 - this.camPitch) * 0.35, 0.0, 0.26) : clamp(0.3 - this.camPitch * 0.62, 0.005, 0.26);
    this.aim = { side, abeam, elevation, aimYaw };
    const fire = (sd) => {
      const el = sd === side ? elevation : 0.06;
      const yaw = sd === side ? aimYaw : 0;
      if (p.fireBroadside(sd, el, this, yaw)) {
        this.missions.onEvent({ type: 'fired' });
        this.shakeT = 0.4;
        this.combatT = 20;
      } else if (p.reload[sd] > 0) this.ui.toast(`${sd === 'port' ? 'Larboard' : 'Starboard'} guns reloading…`, 'warn', 900);
    };
    if (inp.mouseHit(0) && abeam) fire(side);
    else if (inp.mouseHit(0)) this.ui.toast('Bring the guns to bear — look off the beam', 'warn', 1200);
    if (inp.hit('KeyQ')) fire('port');
    if (inp.hit('KeyE')) fire('starboard');
    this.updateAimPreview(p, abeam && (inp.mouseDown(0) || spy || this.state.day === 0 && this.state.hours < 9));

    // target selection for HUD
    this.targetShip = this.pickTarget(camFwd);

    // context actions
    const prompt = this.sailContext();
    this.ui.prompt(prompt?.text || null);
    if (prompt && inp.hit('KeyF')) prompt.act();

    // camera shake
    if (this.shakeT > 0) {
      this.shakeT -= dt;
      this.camera.position.x += (Math.random() - 0.5) * this.shakeT * 0.8;
      this.camera.position.y += (Math.random() - 0.5) * this.shakeT * 0.8;
    }
    // discovery & harbour notices
    for (const t of this.townList) {
      const d = t.coast.distanceTo(p.position);
      if (d < 1000) this.discover(t);
    }
  }

  updateAimPreview(p, show) {
    if (!this.aimLine) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(40 * 3), 3));
      this.aimLine = new THREE.Line(g, new THREE.LineDashedMaterial({ color: 0xffe0a0, dashSize: 3, gapSize: 2, transparent: true, opacity: 0.7, depthWrite: false }));
      this.aimLine.frustumCulled = false;
      this.scene.add(this.aimLine);
      this.aimRing = new THREE.Mesh(new THREE.RingGeometry(3, 4, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffd080, transparent: true, opacity: 0.6, depthWrite: false }));
      this.scene.add(this.aimRing);
    }
    this.aimLine.visible = this.aimRing.visible = show;
    if (!show) return;
    const a = this.aim;
    const s = a.side === 'port' ? -1 : 1;
    const dirLocal = new THREE.Vector3(s * Math.cos(a.aimYaw), 0, -Math.sin(a.aimYaw) * s);
    const d = dirLocal.applyAxisAngle(new THREE.Vector3(0, 1, 0), p.heading);
    const v = BALL_SPEED * p.gunRange;
    const start = p.position.clone().add(new THREE.Vector3(0, p.model.deckY * 0.8, 0)).addScaledVector(d, p.cls.beam * 0.6);
    const vel = new THREE.Vector3(d.x * Math.cos(a.elevation), Math.sin(a.elevation), d.z * Math.cos(a.elevation)).multiplyScalar(v);
    vel.x += p.velocity?.x || 0; vel.z += p.velocity?.z || 0;
    const pos = this.aimLine.geometry.attributes.position;
    const P = start.clone();
    let landed = P.clone();
    for (let i = 0; i < 40; i++) {
      pos.setXYZ(i, P.x, P.y, P.z);
      if (P.y > -1) landed.copy(P);
      for (let k = 0; k < 4; k++) { vel.y -= GRAVITY * 0.025; P.addScaledVector(vel, 0.025); }
      if (P.y < 0) { for (let j = i + 1; j < 40; j++) pos.setXYZ(j, P.x, 0, P.z); landed.copy(P); break; }
    }
    pos.needsUpdate = true;
    this.aimLine.computeLineDistances();
    this.aimRing.position.set(landed.x, this.ocean.heightAt(landed.x, landed.z) + 0.3, landed.z);
  }

  pickTarget(camFwd) {
    const p = this.playerShip;
    let best = null, bestScore = Infinity;
    for (const s of this.ships) {
      if (s === p || s.sunk) continue;
      const to = s.position.clone().sub(this.camera.position); to.y = 0;
      const d = to.length();
      if (d > 900) continue;
      to.normalize();
      const ang = Math.acos(clamp(to.dot(camFwd), -1, 1));
      const score = ang * 400 + d * 0.3;
      if (ang < 0.45 && score < bestScore) { best = s; bestScore = score; }
    }
    if (!best) {
      for (const s of this.ships) {
        if (s === p || s.sunk) continue;
        const d = s.position.distanceTo(p.position);
        if (d < 260 && d < bestScore) { best = s; bestScore = d; }
      }
    }
    return best;
  }

  sailContext() {
    if (this.transitioning) return null;
    const p = this.playerShip;
    // boarding
    for (const s of this.ships) {
      if (s === p || !s.alive) continue;
      const d = s.position.distanceTo(p.position);
      const reach = (s.cls.length + p.cls.length) * 0.5 + 25;
      if (d < reach) {
        const crippled = s.struck || (s.hull < s.hullMax * 0.3 && p.crew > s.crew * 1.3) || s.crew < 5;
        if (crippled && p.speed < 12) return { text: `[F] Board the ${s.name}`, act: () => this.boardPrize(s) };
        if (!s.struck && d < reach && s.role !== 'merchant' && p.crew > s.crew * 2 && p.speed < 10) return { text: `[F] Board the ${s.name} (${p.crew} vs ${s.crew} men)`, act: () => this.boardPrize(s) };
      }
    }
    // docking
    for (const t of this.townList) {
      const d = Math.hypot(t.berth.x - p.position.x, t.berth.z - p.position.z);
      if (d < 150) {
        if (p.speed > 12) return { text: 'Shorten sail [S] to dock', act: () => {} };
        const hostile = this.hostilesNear(700);
        if (hostile) return { text: 'Enemy ships nearby — cannot dock', act: () => {} };
        return { text: `[F] Dock at ${t.port.name}`, act: () => this.dock(t) };
      }
    }
    // landing a boat on any beach
    if (p.speed < 7) {
      if (!this._landCheckT || this._landCheckT < performance.now()) {
        this._landCheckT = performance.now() + 400;
        this._landing = this.terrain.quickHeight(p.position.x, p.position.z) > -35 ? this.terrain.findLanding(p.position.x, p.position.z, 170) : null;
      }
      if (this._landing) return { text: '[F] Row ashore', act: () => this.goAshore(this._landing) };
    }
    return null;
  }

  hostilesNear(r) {
    const p = this.playerShip;
    return this.ships.some((s) => s !== p && s.alive && this.isHostile(s, p) && s.role !== 'merchant' && s.position.distanceTo(p.position) < r);
  }

  sinkCam(dt) {
    const p = this.playerShip;
    const t = p.position.clone().add(new THREE.Vector3(0, 4, 0));
    this.camYaw += dt * 0.15;
    const back = new THREE.Vector3(Math.sin(this.camYaw), 0.45, Math.cos(this.camYaw)).normalize();
    this.camera.position.lerp(t.clone().addScaledVector(back, 70), 1 - Math.exp(-2 * dt));
    this.camera.lookAt(t);
  }

  shipCollisions(dt) {
    const L = this.ships;
    for (let i = 0; i < L.length; i++) {
      const a = L[i];
      if (a.sunk) continue;
      for (let j = i + 1; j < L.length; j++) {
        const b = L[j];
        if (b.sunk) continue;
        const dx = b.position.x - a.position.x, dz = b.position.z - a.position.z;
        const minD = (a.cls.length + b.cls.length) * 0.5;
        const d2 = dx * dx + dz * dz;
        if (d2 > minD * minD) continue;
        // capsule test along each hull
        let hit = false, nx = 0, nz = 0, pen = 0;
        for (const sa of [-0.38, 0, 0.38]) {
          const ax = a.position.x + a.forward.x * sa * a.cls.length, az = a.position.z + a.forward.z * sa * a.cls.length;
          for (const sb of [-0.38, 0, 0.38]) {
            const bx = b.position.x + b.forward.x * sb * b.cls.length, bz = b.position.z + b.forward.z * sb * b.cls.length;
            const ddx = bx - ax, ddz = bz - az;
            const dd = Math.hypot(ddx, ddz);
            const r = (a.cls.beam + b.cls.beam) * 0.48;
            if (dd < r && r - dd > pen) { hit = true; pen = r - dd; nx = ddx / (dd || 1); nz = ddz / (dd || 1); }
          }
        }
        if (!hit) continue;
        const ma = a.cls.length ** 2, mb = b.cls.length ** 2;
        const wa = mb / (ma + mb), wb = ma / (ma + mb);
        a.position.x -= nx * pen * wa; a.position.z -= nz * pen * wa;
        b.position.x += nx * pen * wb; b.position.z += nz * pen * wb;
        const rel = Math.abs(a.speed - b.speed * (a.forward.dot(b.forward)));
        if (rel > 8 && !(a._ramCd > 0)) {
          a._ramCd = 1.5;
          const dmg = rel * 0.9;
          a.damage(dmg * wa, 2, 0, this, b); b.damage(dmg * wb, 2, 0, this, a);
          this.audio.crunch(a.position);
          this.effects.hit(a.position.clone().setY(2).addScaledVector(new THREE.Vector3(nx, 0, nz), a.cls.beam * 0.5), 1);
        }
        a._ramCd = (a._ramCd || 0) - dt;
        a.speed *= 0.97; b.speed *= 0.97;
      }
    }
  }

  // ======================================================================== combat hooks
  onShipHit(ship, attacker, zone) {
    if (!attacker) return;
    if (ship.isPlayer) {
      this.shakeT = 0.3;
      this.ui.damageFlash();
      this.combatT = 20;
      return;
    }
    if (attacker.isPlayer) {
      this.combatT = 20;
      if (!this.hitShips.has(ship.id) && ship.nationId !== 'pirate') {
        this.hitShips.add(ship.id);
        this.state.addNotoriety(ship.nationId, 0.6);
        // nearby ships of the same flag take offence
        for (const o of this.ships) if (o.nationId === ship.nationId && o.position.distanceTo(ship.position) < 900 && o.role !== 'merchant') o.aggro.add(PLAYER_ID);
      }
      if (ship.role === 'pirate') ship.aggro.add(PLAYER_ID);
      if (ship.role !== 'merchant') ship.aggro.add(PLAYER_ID);
    }
  }

  onShipStruck(ship) {
    if (ship.position.distanceTo(this.playerShip?.position || tmpV) < 1200) this.ui.toast(`The ${ship.name} strikes her colours!`, 'good');
  }

  onShipSinking(ship) {
    this.audio.crunch(ship.position);
    if (ship.isPlayer) {
      this.ui.toast('She\'s going down! Abandon ship!', 'warn');
      this.later(6000, () => this.onPlayerShipLost());
      return;
    }
    const byPlayer = ship.lastHitBy?.isPlayer;
    if (byPlayer) {
      this.state.stats.sunk++;
      this.state.renown += Math.ceil(ship.cls.guns / 6);
      if (ship.nationId !== 'pirate') this.state.addNotoriety(ship.nationId, ship.role === 'merchant' ? 0.7 : 1.0);
      this.ui.toast(`The ${ship.name} is sinking!`, 'good');
      this.spawnFlotsam(ship);
    }
    this.missions.onEvent({ type: 'sunk', ship });
  }

  spawnFlotsam(ship) {
    const n = 3 + Math.floor(ship.cls.guns / 8);
    const goods = Object.entries(ship.cargo).filter(([, q]) => q > 0);
    for (let i = 0; i < n; i++) {
      const pos = ship.position.clone().add(new THREE.Vector3(rand(-15, 15), 0, rand(-15, 15)));
      let kind = 'gold', amount = Math.floor((ship.gold / n) * 0.6) + randInt(10, 40);
      if (goods.length && Math.random() < 0.6) { const [g, q] = pick(goods); kind = g; amount = Math.max(1, Math.floor(q / n)); }
      const mesh = new THREE.Group();
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 1.4, 10), new THREE.MeshStandardMaterial({ color: '#6a4a2a', roughness: 0.8 }));
      barrel.rotation.z = Math.PI / 2;
      mesh.add(barrel);
      const glow = new THREE.Mesh(new THREE.RingGeometry(1.6, 2.1, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffd070, transparent: true, opacity: 0.5, depthWrite: false }));
      mesh.add(glow);
      mesh.position.copy(pos);
      this.scene.add(mesh);
      this.pickups.push({ pos, kind, amount, life: 180, mesh, glow });
    }
  }

  updatePickups(dt) {
    const p = this.playerShip;
    for (const k of [...this.pickups]) {
      k.life -= dt;
      k.pos.x += this.wind.x * dt * 0.4; k.pos.z += this.wind.z * dt * 0.4;
      const h = this.ocean.heightAt(k.pos.x, k.pos.z);
      k.mesh.position.set(k.pos.x, h + 0.1, k.pos.z);
      k.mesh.rotation.y += dt * 0.3;
      k.glow.material.opacity = 0.3 + Math.sin(shipTime.value * 3) * 0.2;
      let collected = false;
      if (p && p.alive && this.mode === 'sail' && k.pos.distanceTo(p.position) < p.cls.length * 0.6 + 4) {
        if (k.kind === 'gold') { this.state.gold += k.amount; this.state.stats.plunder += k.amount; this.ui.toast(`Recovered ${k.amount} pieces of eight from the wreckage`, 'good', 2500); this.audio.coins(); collected = true; }
        else {
          const n = Math.min(k.amount, this.playerCargoRoom());
          if (n > 0) { this.state.ship.cargo[k.kind] = (this.state.ship.cargo[k.kind] || 0) + n; this.ui.toast(`Hauled aboard ${n} ${GOODS[k.kind].name}`, 'good', 2500); collected = true; this.audio.ui('click'); }
          else if (!k.warned) { k.warned = true; this.ui.toast('The hold is full!', 'warn'); }
        }
      }
      if (collected || k.life <= 0) { this.scene.remove(k.mesh); this.pickups = this.pickups.filter((x) => x !== k); }
    }
  }

  boardPrize(ship) {
    const p = this.playerShip;
    const s = this.state;
    // melee resolution
    let losses = 0, won = true;
    if (!ship.struck) {
      const ours = p.crew * (1 + s.renown * 0.002), theirs = ship.crew * (ship.role === 'hunter' || ship.role === 'navy' ? 1.3 : 0.9);
      const ratio = ours / Math.max(1, theirs);
      won = ratio > 0.9 || Math.random() < ratio * 0.7;
      losses = Math.min(p.crew - 1, Math.round(ship.crew * rand(0.25, 0.5) / Math.max(0.6, ratio)));
    } else losses = randInt(0, 2);
    p.crew = Math.max(1, p.crew - losses);
    this.audio.clang(p.position); this.later(200, () => this.audio.clang(p.position)); this.later(350, () => this.audio.musket(p.position));
    if (!won) {
      p.hull -= p.hullMax * 0.1;
      this.ui.dialog('Boarding repulsed', `Your boarders are thrown back with ${losses} men lost. The ${ship.name} still fights!`, () => {});
      ship.aggro.add(PLAYER_ID);
      return;
    }
    // plunder
    const gold = ship.gold + randInt(20, 80) * Math.ceil(ship.cls.guns / 4);
    s.gold += gold;
    s.stats.plunder += gold;
    s.stats.captured++;
    s.renown += Math.ceil(ship.cls.guns / 4) + 1;
    const taken = [];
    for (const [g, q] of Object.entries(ship.cargo)) {
      const n = Math.min(q, this.playerCargoRoom());
      if (n > 0) { s.ship.cargo[g] = (s.ship.cargo[g] || 0) + n; ship.cargo[g] -= n; taken.push(`${n} ${GOODS[g].name}`); }
    }
    const recruits = Math.min(Math.floor(ship.crew * 0.3), p.cls.crewMax - p.crew);
    p.crew += Math.max(0, recruits);
    if (ship.nationId !== 'pirate') s.addNotoriety(ship.nationId, 0.8);
    ship.strike(this);
    ship.crew = Math.max(2, Math.floor(ship.crew * 0.5));
    this.missions.onEvent({ type: 'captured', ship });
    this.audio.coins();
    const canTake = ship.cls.id !== p.cls.id;
    const text = `The ${ship.name} is yours! ${losses ? losses + ' of your men fell. ' : ''}You seize ${gold} pieces of eight${taken.length ? ' and ' + taken.join(', ') : ''}.${recruits > 0 ? ` ${recruits} of her crew sign your articles.` : ''}`;
    this.ui.choice('Prize Taken', text, [
      canTake ? { label: `Take her as flagship (${ship.cls.name})`, act: () => this.takeCommand(ship) } : null,
      { label: 'Set her adrift', act: () => { ship.ai.mode = 'flee'; ship.ai.target = p; ship.sailTarget = 1; ship.struck = true; ship.despawnT = 60; } },
      { label: 'Scuttle her', act: () => { ship.lastHitBy = p; ship.startSinking(this); } },
    ].filter(Boolean));
  }

  takeCommand(ship) {
    const s = this.state;
    const cls = ship.cls;
    if (s.cargoCount() > cls.cargo) {
      let excess = s.cargoCount() - cls.cargo;
      for (const k of Object.keys(s.ship.cargo).sort((a, b) => GOODS[a].base - GOODS[b].base)) {
        const n = Math.min(excess, s.ship.cargo[k]);
        s.ship.cargo[k] -= n; excess -= n;
        if (excess <= 0) break;
      }
      this.ui.toast('Her hold is smaller — the cheapest cargo had to be left behind.', 'warn');
    }
    const old = this.playerShip;
    const oldCls = old.cls;
    s.ship.cls = cls.id;
    s.ship.hull = Math.max(ship.hull, cls.hull * 0.4);
    s.ship.sails = Math.max(ship.sails, cls.sails * 0.4);
    s.ship.crew = Math.min(old.crew, cls.crewMax);
    const pos = ship.position.clone(), heading = ship.heading;
    this.removeShip(ship);
    this.removeShip(old);
    this.createPlayerShip(pos.x, pos.z, heading);
    this.enterSail();
    // old ship is left behind as a derelict
    this.ui.toast(`You take command of the ${cls.name}. Your old ${oldCls.name} is left to drift.`, 'good', 5000);
    this.save();
  }

  onGroundHit() {}

  onPlayerShipLost() {
    const s = this.state;
    this.ui.wasted('Sunk', 'Your crew drags you from the water. The Brethren lend you a sloop in Nassau.');
    this.transitioning = false;
    this.transition(3800, () => {
      s.gold = Math.floor(s.gold * 0.7);
      s.upgrades.hull = Math.min(s.upgrades.hull, 1);
      s.ship = { cls: 'sloop', hull: SHIP_CLASSES.sloop.hull * (1 + 0.25 * s.upgrades.hull), sails: SHIP_CLASSES.sloop.sails, crew: 18, cargo: {} };
      for (const k in s.notoriety) s.notoriety[k] = Math.max(0, s.notoriety[k] - 1.5);
      this.removeShip(this.playerShip);
      this.despawnHunters();
      this.despawnNPCs();
      const town = this.towns.nassau;
      this.createPlayerShip(town.berth.x, town.berth.z, town.berth.heading);
      this.playerShip.anchored = true;
      this.enterFoot(town.spawnPoint.clone(), town);
      s.lastPort = 'nassau';
      s.hours = 8; s.day += 1;
      this.save();
    });
  }

  // ======================================================================== forts
  updateForts(dt) {
    const p = this.playerShip;
    if (!p || this.mode !== 'sail' || !p.alive) return;
    for (const f of this.forts) {
      const n = f.town.port.nation;
      if (this.state.wanted(n) < 2 && !f.alarm) continue;
      const d = f.town.coast.distanceTo(p.position);
      if (d > 650) continue;
      f.timer -= dt;
      if (f.timer > 0) continue;
      f.timer = rand(2.5, 4.5);
      if (!f.warned) { f.warned = true; this.ui.toast(`The guns of ${f.town.port.name} open fire!`, 'warn'); }
      const c = pick(f.cannons);
      const lead = c.distanceTo(p.position) / BALL_SPEED;
      const tgt = p.position.clone().addScaledVector(p.velocity || tmpV.set(0, 0, 0), lead);
      const to = tgt.clone().sub(c); const hd = Math.hypot(to.x, to.z);
      const v = BALL_SPEED * 1.1;
      const el = 0.5 * Math.asin(clamp((GRAVITY * hd) / (v * v), 0, 1)) + rand(-0.01, 0.015) - (c.y / hd) * 0.5;
      const dir = new THREE.Vector3(to.x / hd, 0, to.z / hd);
      const vel = new THREE.Vector3(dir.x * Math.cos(el) * v, Math.sin(el) * v, dir.z * Math.cos(el) * v);
      this.projectiles.spawn(c.clone(), vel, { isFort: true, gunDamage: 1.3, id: -5 }, 'round');
      this.effects.muzzle(c, dir, true);
      this.audio.cannon(c);
    }
  }

  // ======================================================================== notoriety & traffic
  updateNotoriety(dt) {
    const s = this.state;
    const p = this.playerShip;
    const dh = dt / 60;
    const pos = this.mode === 'sail' ? p.position : this.walker ? this.walker.pos : p.position;
    for (const k of Object.keys(s.notoriety)) {
      const hunted = this.ships.some((o) => o.nationId === k && (o.role === 'navy' || o.role === 'hunter') && o.alive && this.isHostile(o, p) && o.position.distanceTo(pos) < 1300);
      this.huntersActive[k] = hunted;
      if (!hunted && !this.combatNear) s.notoriety[k] = Math.max(0, s.notoriety[k] - dh * 0.25);
    }
    // spawn pirate hunters for high notoriety
    this.hunterTimer = (this.hunterTimer ?? 20) - dt;
    if (this.hunterTimer <= 0 && this.mode === 'sail') {
      this.hunterTimer = 50;
      for (const k of Object.keys(s.notoriety)) {
        const lv = s.wanted(k);
        if (lv < 2 || k === 'dutch') continue;
        const current = this.ships.filter((o) => o.nationId === k && o.role === 'hunter' && o.alive).length;
        const want = Math.min(3, lv - 1);
        if (current < want) {
          const spot = this.findSeaSpot(p.position, 1300, 1900);
          if (!spot) continue;
          const cls = lv >= 4 ? pick(['frigate', 'frigate', 'manowar']) : lv >= 3 ? pick(['frigate', 'brigantine']) : pick(['brigantine', 'sloop']);
          const h = this.spawnShip(cls, k, { role: 'hunter', x: spot.x, z: spot.z, heading: Math.atan2(-(p.position.x - spot.x), -(p.position.z - spot.z)), patrol: true, aggroPlayer: true });
          h.ai.patrolR = 300;
          this.ui.toast(`${NATIONS[k].adj} pirate hunters sighted: the ${h.cls.name} ${h.name}!`, 'warn', 5000);
        }
      }
    }
  }

  despawnHunters() {
    for (const s of [...this.ships]) if (s.role === 'hunter' && !s.mission) this.removeShip(s);
  }

  findSeaSpot(center, rMin, rMax, depth = -18) {
    for (let i = 0; i < 30; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = rand(rMin, rMax);
      const x = center.x + Math.cos(a) * r, z = center.z + Math.sin(a) * r;
      if (Math.abs(x) > 8500 || Math.abs(z) > 8500) continue;
      if (this.terrain.quickHeight(x, z) < depth && this.terrain.quickHeight(x + 60, z) < depth && this.terrain.quickHeight(x, z + 60) < depth) return { x, z };
    }
    return null;
  }

  fillTraffic(initial) {
    this.trafficT = (this.trafficT || 0) - (initial ? 999 : 0.016);
    if (!initial && this.trafficT > 0) return;
    this.trafficT = 3;
    const center = this.mode === 'sail' ? this.playerShip.position : this.walker ? this.walker.pos : this.playerShip.position;
    // despawn distant non-mission ships
    for (const s of [...this.ships]) {
      if (s.isPlayer || s.mission) continue;
      const d = s.position.distanceTo(center);
      if (d > 3200 || (s.despawnT !== undefined && (s.despawnT -= 3) <= 0 && d > 400) || (s.ai?.arrived && d > 600)) this.removeShip(s);
    }
    const ambient = this.ships.filter((s) => !s.isPlayer && !s.mission && s.alive).length;
    const target = this.quality === 'low' ? 5 : 8;
    let n = initial ? target : 1;
    while (ambient + (initial ? 0 : 0) < target && n-- > 0) {
      const spot = this.findSeaSpot(center, initial ? 500 : 1500, initial ? 2000 : 2400);
      if (!spot) break;
      const r = Math.random();
      // pick a role from the local waters
      const nearPort = this.townList.reduce((a, t) => (t.coast.distanceTo(center) < a.coast.distanceTo(center) ? t : a));
      let nation, role, cls, opts = {};
      if (r < 0.55) {
        role = 'merchant';
        nation = pick(['britain', 'britain', 'spain', 'spain', 'france', 'dutch']);
        cls = pick(['fluyt', 'fluyt', 'sloop', 'brigantine']);
        const dest = pick(this.townList);
        opts.dest = { x: dest.berth.x, z: dest.berth.z };
      } else if (r < 0.8) {
        role = 'navy';
        nation = nearPort.port.nation === 'pirate' ? pick(['britain', 'spain']) : nearPort.port.nation;
        cls = pick(['sloop', 'brigantine', 'frigate']);
        opts.patrol = true; opts.patrolR = 900;
      } else {
        role = 'pirate'; nation = 'pirate';
        cls = pick(['sloop', 'sloop', 'brigantine']);
        opts.patrol = true; opts.patrolR = 1200;
      }
      const heading = rand(-Math.PI, Math.PI);
      this.spawnShip(cls, nation, { role, x: spot.x, z: spot.z, heading, ...opts });
      if (!initial) break;
    }
  }

  discover(town) {
    const s = this.state;
    if (!s.discovered.includes(town.port.id)) {
      s.discovered.push(town.port.id);
      this.ui.banner(town.port.name, `${NATIONS[town.port.nation].name} · port discovered`);
      this.audio.ui('fanfare');
    }
  }

  // ======================================================================== on foot
  updateFoot(dt) {
    const w = this.walker;
    if (!w) return;
    w.update(dt, this.input, this.camera);
    w.updateCamera(this.camera, dt);
    this.camera.fov = damp(this.camera.fov, w.aiming ? this.baseFov * 0.75 : this.baseFov, 8, dt);
    this.camera.updateProjectionMatrix();
    this.focus.copy(w.pos);
    // town the player is in
    this.currentTown = this.townList.find((t) => t.center.distanceTo(w.pos) < t.R * 1.6) || null;
    // interactions
    const act = this.footContext();
    this.ui.prompt(act?.text || null);
    if (act && (this.input.hit('KeyE') || (act.f && this.input.hit('KeyF')))) act.act();
    if (this.digging) {
      this.digging.t -= dt;
      w.animState.dig = true;
      if (Math.random() < dt * 3) { this.audio.dig(); this.effects.dust(w.pos.clone().add(new THREE.Vector3(0, 0.3, 0))); }
      if (this.digging.t <= 0) this.finishDig();
    }
  }

  footContext() {
    const w = this.walker;
    if (w.dead || this.transitioning) return null;
    // doors
    for (const t of this.townList) {
      if (t.center.distanceTo(w.pos) > t.R * 2) continue;
      for (const d of t.doors) {
        if (d.pos.distanceTo(w.pos) < 3.2) {
          if (d.type === 'board') return { text: '[E] Board your ship', f: true, act: () => this.boardOwnShip() };
          const hostile = t.port.nation !== 'pirate' && this.state.wanted(t.port.nation) >= 2;
          if (hostile && d.type !== 'tavern') return { text: `${d.label} — they will not deal with a wanted pirate`, act: () => {} };
          return { text: `[E] ${d.label}`, act: () => this.enterDoor(d, t) };
        }
      }
    }
    // salvage chests
    if (this.missions.stage && this.missions.current?.id === 'm3' && this.state.mission.stage === 3) {
      for (const c of this.salvage.chests) {
        if (c.taken) continue;
        if (Math.hypot(c.x - w.pos.x, c.z - w.pos.z) < 2.5) return { text: '[E] Seize the chest of silver', act: () => {
          const guards = this.npcs.filter((n) => n.kind === 'soldier' && !n.dead && n.pos.distanceTo(w.pos) < 30).length;
          if (guards > 0) { this.ui.toast(`Deal with the soldiers first! (${guards} nearby)`, 'warn'); return; }
          c.taken = true;
          const idx = this.salvage.chests.indexOf(c);
          (this.state.mission.chests = this.state.mission.chests || []).push(idx);
          const n = Math.max(0, Math.min(12, this.playerCargoRoom()));
          this.state.ship.cargo.silver = (this.state.ship.cargo.silver || 0) + n;
          this.state.gold += 150;
          this.audio.coins();
          this.ui.toast(`Loaded ${n} silver bars aboard${n < 12 ? ' (the hold is full)' : ''}`, 'good');
          this.missions.onEvent({ type: 'chest' });
        } };
      }
    }
    // treasure
    for (const m of this.state.treasureMaps) {
      if (m.found) continue;
      if (Math.hypot(m.x - w.pos.x, m.z - w.pos.z) < 3) return { text: '[E] Dig here', act: () => this.startDig(m) };
    }
    // return to ship by boat
    const p = this.playerShip;
    if (!this.currentTown || this.currentTown.berth && Math.hypot(this.currentTown.berth.x - p.position.x, this.currentTown.berth.z - p.position.z) > 50) {
      const dShip = Math.hypot(p.position.x - w.pos.x, p.position.z - w.pos.z);
      const g = this.terrain.height(w.pos.x, w.pos.z);
      if (dShip < 220 && g < 1.4) return { text: '[F] Row back to your ship', f: true, act: () => this.boardOwnShip() };
    }
    return null;
  }

  enterDoor(d, town) {
    this.input.unlock();
    const consumed = this.missions.onEvent({ type: 'interact', door: d, port: town.port.id });
    if (consumed) return;
    this.ui.openShop(d.type, town);
  }

  startDig(m) {
    if (this.digging) return;
    this.digging = { t: 2.6, map: m };
    this.ui.toast('Digging…', 'info', 2000);
  }

  finishDig() {
    const m = this.digging.map;
    this.digging = null;
    this.walker.animState.dig = false;
    m.found = true;
    this.state.gold += m.value;
    this.state.stats.treasures++;
    this.state.stats.plunder += m.value;
    this.state.renown += 3;
    this.audio.coins();
    this.audio.ui('fanfare');
    this.ui.banner('Buried Treasure!', `${m.value} pieces of eight`);
    // chest prop
    let chest = props.object('treasure_chest');
    if (chest) {
      chest.scale.setScalar(1.2);
      chest.rotation.y = Math.atan2(this.walker.pos.x - m.x, this.walker.pos.z - m.z);
      chest.position.set(m.x, this.terrain.height(m.x, m.z) - 0.15, m.z);
    } else {
      chest = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.8, 0.8), new THREE.MeshStandardMaterial({ color: '#5a3a1a', roughness: 0.7 }));
      chest.position.set(m.x, this.terrain.height(m.x, m.z) + 0.3, m.z);
    }
    this.scene.add(chest);
    this.treasureMarkers.push(chest);
    this.spawnTreasureMarkers();
  }

  findTreasureSpot(islandId) {
    const is = this.terrain.islands.find((i) => i.id === islandId);
    for (let k = 0; k < 400; k++) {
      const a = Math.random() * Math.PI * 2, r = Math.random() * Math.max(is.rx, is.rz);
      const x = is.x + Math.cos(a) * r, z = is.z + Math.sin(a) * r;
      const h = this.terrain.height(x, z);
      if (h < 2.2 || h > 18) continue;
      if (this.terrain.normal(x, z).y < 0.9) continue;
      return { x, z };
    }
    return null;
  }

  spawnTreasureMarkers() {
    this.clearTreasureMarkers(true);
    for (const m of this.state.treasureMaps) {
      if (m.found) continue;
      const y = this.terrain.height(m.x, m.z);
      const g = new THREE.Group();
      const mound = new THREE.Mesh(new THREE.SphereGeometry(1.2, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#b8a070', roughness: 1 }));
      mound.scale.y = 0.35;
      g.add(mound);
      for (const r of [0.7, -0.7]) {
        const st = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.15, 0.3), new THREE.MeshStandardMaterial({ color: '#8a8272', roughness: 1 }));
        st.rotation.y = r; st.position.y = 0.3;
        g.add(st);
      }
      g.position.set(m.x, y, m.z);
      this.scene.add(g);
      this.treasureMarkers.push(g);
      g.userData.treasure = true;
    }
  }

  clearTreasureMarkers(onlyMarkers) {
    for (const g of [...this.treasureMarkers]) {
      if (onlyMarkers && !g.userData.treasure) continue;
      this.scene.remove(g);
      this.treasureMarkers = this.treasureMarkers.filter((x) => x !== g);
    }
  }

  groundAt(x, z) {
    let h = this.terrain.height(x, z);
    for (const t of this.townList) {
      if (Math.abs(x - t.coast.x) > 400 || Math.abs(z - t.coast.z) > 400) continue;
      for (const p of t.platforms) {
        const dx = x - p.x, dz = z - p.z;
        const lx = dx * p.cos - dz * p.sin, lz = dx * p.sin + dz * p.cos;
        if (Math.abs(lx) < p.hw && Math.abs(lz) < p.hd) h = Math.max(h, p.y);
      }
    }
    return h;
  }

  collidersNear(x, z) {
    const out = [];
    for (const t of this.townList) if (Math.abs(x - t.center.x) < t.R * 2 && Math.abs(z - t.center.z) < t.R * 2) out.push(t.colliders);
    if (Math.abs(x - this.salvage.center.x) < 120 && Math.abs(z - this.salvage.center.z) < 120) out.push(this.salvage.colliders);
    return out;
  }

  collideWalker(w) {
    for (const list of this.collidersNear(w.pos.x, w.pos.z)) {
      for (const c of list) {
        const dx = w.pos.x - c.x, dz = w.pos.z - c.z;
        if (dx * dx + dz * dz > (c.hw + c.hd + 2) ** 2) continue;
        const lx = dx * c.cos - dz * c.sin, lz = dx * c.sin + dz * c.cos;
        const px = c.hw + w.radius - Math.abs(lx), pz = c.hd + w.radius - Math.abs(lz);
        if (px > 0 && pz > 0) {
          let ox = 0, oz = 0;
          if (px < pz) ox = Math.sign(lx) * px; else oz = Math.sign(lz) * pz;
          w.pos.x += ox * c.cos + oz * c.sin;
          w.pos.z += -ox * c.sin + oz * c.cos;
        }
      }
    }
    // separate from other walkers
    const all = this.walker ? [this.walker, ...this.npcs] : this.npcs;
    for (const o of all) {
      if (o === w || o.dead) continue;
      const dx = w.pos.x - o.pos.x, dz = w.pos.z - o.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > 0 && d < 0.75) { w.pos.x += (dx / d) * (0.75 - d) * 0.5; w.pos.z += (dz / d) * (0.75 - d) * 0.5; }
    }
  }

  blockedAt(x, z, r, y) {
    for (const list of this.collidersNear(x, z)) {
      for (const c of list) {
        if (y > (c.top ?? 12)) continue;
        const dx = x - c.x, dz = z - c.z;
        const lx = dx * c.cos - dz * c.sin, lz = dx * c.sin + dz * c.cos;
        if (Math.abs(lx) < c.hw + r && Math.abs(lz) < c.hd + r) return true;
      }
    }
    return false;
  }

  // NPC population around towns
  manageNPCs() {
    const focus = this.mode === 'foot' && this.walker ? this.walker.pos : null;
    if (!focus) { if (this.npcs.length && !this.keepNPCs) this.despawnNPCs(); return; }
    const town = this.townList.find((t) => t.center.distanceTo(focus) < t.R * 2.2);
    if (town && this.npcTown !== town) {
      this.despawnNPCs(true);
      this.npcTown = town;
      this.spawnTownNPCs(town);
    } else if (!town && this.npcTown) {
      this.despawnNPCs(true);
      this.npcTown = null;
    }
  }

  spawnTownNPCs(town) {
    const nodes = town.streetNodes;
    const n = this.quality === 'low' ? 8 : 16;
    const nation = town.port.nation;
    for (let i = 0; i < n && nodes.length; i++) {
      const p = pick(nodes);
      const kind = nation === 'pirate' && Math.random() < 0.55 ? 'pirate' : 'civilian';
      const npc = new NPC(this, lookFor(kind, nation), { x: p.x + rand(-2, 2), y: p.y, z: p.z + rand(-2, 2), kind, nation, town });
      this.npcs.push(npc);
    }
    const guardN = nation === 'pirate' ? 0 : this.quality === 'low' ? 3 : 5;
    const posts = town.guardPosts.length ? town.guardPosts : nodes;
    for (let i = 0; i < guardN; i++) {
      const post = posts[i % posts.length].clone();
      const y = this.groundAt(post.x, post.z);
      const g = new NPC(this, lookFor('guard', nation), { x: post.x + rand(-3, 3), y, z: post.z + rand(-3, 3), kind: 'guard', nation, town, post, health: 90 });
      this.npcs.push(g);
    }
  }

  spawnSalvageGuards() {
    this.keepNPCs = true;
    const c = this.salvage;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const x = c.center.x + Math.cos(a) * 14, z = c.center.z + Math.sin(a) * 14;
      const npc = new NPC(this, lookFor('soldier', 'spain'), { x, y: this.groundAt(x, z), z, kind: 'soldier', nation: 'spain', hostile: true, health: 80, post: new THREE.Vector3(x, 0, z) });
      if (i % 2) { npc.weapon = 'cutlass'; npc.look.weapon = 'cutlass'; }
      this.npcs.push(npc);
    }
  }

  despawnNPCs(keepSpecial) {
    const keep = [];
    for (const n of this.npcs) {
      if (keepSpecial && n.kind === 'soldier' && !n.town) { keep.push(n); continue; }
      n.dispose();
    }
    this.npcs = keep;
    this.npcTown = null;
    if (!keepSpecial) this.keepNPCs = false;
  }

  isWalkerHostile(npc) {
    if (npc.dead) return false;
    if (npc.hostile) return true;
    if (npc.kind === 'guard' || npc.kind === 'soldier') {
      if (npc.town?.alarm) return true;
      return npc.nation && npc.nation !== 'pirate' && this.state.wanted(npc.nation) >= 2;
    }
    return false;
  }

  onNPCAttacked(npc) {
    this.combatT = 12;
    if (npc.kind === 'pirate') {
      npc.hostile = true;
      for (const o of this.npcs) if (o.kind === 'pirate' && o.pos.distanceTo(npc.pos) < 15) o.hostile = true;
      return;
    }
    if (npc.town && npc.nation && npc.nation !== 'pirate') {
      npc.town.alarm = true;
      this.state.addNotoriety(npc.nation, npc.kind === 'civilian' ? 0.4 : 0.3);
      if (!this._alarmToast || performance.now() - this._alarmToast > 8000) { this._alarmToast = performance.now(); this.ui.toast('The watch has been called!', 'warn'); }
    }
  }

  playerMelee(w) {
    const fwd = new THREE.Vector3(-Math.sin(w.yaw), 0, -Math.cos(w.yaw));
    let hit = false;
    for (const n of this.npcs) {
      if (n.dead) continue;
      const to = n.pos.clone().sub(w.pos); to.y = 0;
      const d = to.length();
      if (d > 2.6) continue;
      if (to.normalize().dot(fwd) < 0.35) continue;
      n.takeDamage(34 + this.state.upgrades.guns * 3, w);
      hit = true;
      if (n.dead) { this.state.stats.duels++; this.lootBody(n); }
    }
    if (hit) this.audio.thud(w.pos);
    this.combatT = Math.max(this.combatT, 6);
  }

  playerShoot(w) {
    const origin = this.camera.position.clone();
    const dir = this.camera.getWorldDirection(new THREE.Vector3());
    let best = null, bestAng = 0.07;
    for (const n of this.npcs) {
      if (n.dead) continue;
      const c = n.pos.clone().add(new THREE.Vector3(0, 1.2, 0));
      const to = c.sub(origin);
      const d = to.length();
      if (d > 45) continue;
      const ang = Math.acos(clamp(to.normalize().dot(dir), -1, 1));
      if (ang < bestAng + 0.3 / d) { best = n; bestAng = ang; }
    }
    const hand = w.pos.clone().add(new THREE.Vector3(0, 1.4, 0)).addScaledVector(dir, 0.8);
    this.effects.muzzle(hand, dir, false);
    this.audio.pistol(w.pos);
    this.combatT = 12;
    if (best) {
      best.takeDamage(75, w);
      if (best.dead) this.lootBody(best);
    }
    // alarm anyone nearby
    for (const n of this.npcs) if (n.kind === 'civilian' && n.pos.distanceTo(w.pos) < 25) n.fleeT = 8;
  }

  lootBody(n) {
    const g = n.kind === 'civilian' ? randInt(2, 15) : randInt(8, 35);
    this.state.gold += g;
    this.ui.toast(`+${g} pieces of eight`, 'good', 1500);
  }

  npcShoot(npc, target) {
    const muzzle = npc.pos.clone().add(new THREE.Vector3(0, 1.45, 0));
    const dir = target.pos.clone().add(new THREE.Vector3(0, 1.2, 0)).sub(muzzle).normalize();
    this.effects.muzzle(muzzle.addScaledVector(dir, 1), dir, false);
    this.audio.musket(npc.pos);
    this.combatT = 12;
    const d = npc.pos.distanceTo(target.pos);
    const moving = Math.hypot(target.vel.x, target.vel.z) > 3;
    const chance = clamp(0.75 - d / 55 - (moving ? 0.3 : 0), 0.08, 0.8);
    if (Math.random() < chance) target.takeDamage(20, npc);
    else this.effects.dust(target.pos.clone().add(new THREE.Vector3(rand(-1.5, 1.5), 0.2, rand(-1.5, 1.5))));
  }

  onPlayerDeath() {
    const s = this.state;
    this.later(1500, () => {
      this.ui.wasted('Left for Dead', 'You wake in a tavern back room, lighter in the purse.');
      this.transitioning = false;
      this.transition(3500, () => {
        s.gold = Math.floor(s.gold * 0.8);
        for (const t of this.townList) t.alarm = false;
        for (const k in s.notoriety) s.notoriety[k] = Math.max(0, s.notoriety[k] - 1);
        const town = this.towns[s.lastPort] || this.towns.nassau;
        const tav = town.doors.find((d) => d.type === 'tavern');
        this.despawnNPCs(true);
        const p = this.playerShip;
        p.position.set(town.berth.x, 0, town.berth.z); p.heading = town.berth.heading; p.anchored = true; p.speed = 0; p.sailTarget = 0;
        p.updateAxes();
        this.enterFoot(tav.pos.clone().add(new THREE.Vector3(0, 0.5, 0)), town);
        s.hours = 9; s.day++;
      });
    });
  }

  // ======================================================================== misc actions
  restUntilMorning() {
    this.transition(900, () => {
      const s = this.state;
      if (s.hours > 6) s.day++;
      s.hours = 7;
      s.relaxMarkets();
      for (const k in s.notoriety) s.notoriety[k] = Math.max(0, s.notoriety[k] - 0.6);
      for (const t of this.townList) t.alarm = false;
      this.save();
      this.ui.toast('You wake refreshed. Game saved.', 'good');
    });
  }

  canFastTravel() { return this.mode === 'sail' && this.playerShip?.alive && !this.hostilesNear(1400) && !this.playerShip.struck; }
  fastTravelBlockReason() {
    if (this.mode !== 'sail') return 'You must be aboard and under way to set a long course.';
    if (this.hostilesNear(1400)) return 'Enemy sails in sight — you cannot slip away on a long course now.';
    return 'Cannot set a course now.';
  }

  fastTravel(portId) {
    const town = this.towns[portId];
    const p = this.playerShip;
    const dest = new THREE.Vector3(town.berth.x, 0, town.berth.z).add(new THREE.Vector3(town.sea.x, 0, town.sea.y).multiplyScalar(260));
    const dist = dest.distanceTo(p.position);
    const hours = dist / (p.cls.speed * 0.75) / 60 * 6;
    this.transition(900, () => {
      p.position.copy(dest);
      p.heading = Math.atan2(-(town.berth.x - dest.x), -(town.berth.z - dest.z));
      p.speed = 4; p.sailTarget = 1;
      p.updateAxes();
      this.state.advanceHours(hours);
      for (const s of [...this.ships]) if (!s.isPlayer && !s.mission) this.removeShip(s);
      this.camYaw = p.heading + 0.4;
      this.fillTraffic(true);
      this.ui.toast(`After ${Math.max(1, Math.round(hours))} hours under sail you raise ${town.port.name}.`, 'info', 5000);
    });
  }

  canSaveHere() { return true; }

  save() {
    const s = this.state;
    if (this.mode === 'title' || !this.playerShip) return;
    this.syncStateFromPlayerShip();
    const p = this.playerShip;
    if (this.mode === 'sail' && p.alive) s.position = { mode: 'sail', x: p.position.x, z: p.position.z, heading: p.heading };
    else s.position = { mode: 'foot', port: this.currentTown?.port.id || s.lastPort };
    const contracts = s.contracts;
    s.contracts = contracts.map((c) => ({ ...c, target: undefined }));
    s.save();
    s.contracts = contracts;
  }

  // ======================================================================== ui glue
  onModal(open) {
    if (open) this.input.unlock();
    else {
      if (this.audio.musicMode === 'tavern') this.audio.setMusic('none');
      if (this.mode === 'sail' || this.mode === 'foot') this.input.lock();
    }
  }

  onLockChange(locked) {
    this._lockChangeT = performance.now();
    // a late-arriving lock while a menu or the title is showing: release it again
    if (locked && (this.ui.anyModal() || (this.mode !== 'sail' && this.mode !== 'foot'))) { this.input.unlock(); return; }
    const playing = (this.mode === 'sail' || this.mode === 'foot') && !this.ui.anyModal();
    // The browser released the pointer (usually Esc): pause the game.
    if (!locked && playing) this.ui.openModal('pause');
  }

  onKey(e) {
    if (this.mode !== 'sail' && this.mode !== 'foot') return;
    if (e.code === 'Escape') {
      // ignore the Esc that just released pointer lock (it already opened the pause menu)
      if (performance.now() - (this._lockChangeT || 0) < 250) return;
      if (this.ui.anyModal()) { if (this.ui.top() !== 'dialog') this.ui.closeTop(); }
      else this.ui.openModal('pause');
      return;
    }
    if (this.ui.anyModal()) {
      if ((e.code === 'KeyM' && this.ui.top() === 'chart') || (e.code === 'Tab' && this.ui.top() === 'log')) this.ui.closeTop();
      if ((e.code === 'Space' || e.code === 'Enter') && this.ui.top() === 'dialog') this.ui.advanceDialog();
      return;
    }
    if (e.code === 'KeyM') this.ui.openChart();
    if (e.code === 'Tab') { e.preventDefault(); this.ui.openLog(); }
  }

  // ======================================================================== audio mix
  updateAudio(dt) {
    const cam = this.camera.position;
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
    this.audio.setListener(cam, right);
    const f = this.focus;
    const ground = this.terrain.quickHeight(f.x, f.z);
    const nearLand = clamp(1 - (-ground) / 30, 0, 1);
    const inTown = this.mode === 'foot' && this.currentTown ? 1 : 0;
    const night = this.sky.nightFactor;
    this.audio.update(dt, {
      seaLevel: this.mode === 'foot' ? 0.35 + nearLand * 0.3 : 1,
      surf: nearLand,
      wind: this.wind.strength * (this.mode === 'sail' ? 1 : 0.5) + this.sky.storm * 0.5,
      rain: this.weather.cur.rain,
      town: inTown * (1 - night * 0.6),
      onShip: this.mode === 'sail',
      seaState: this.ocean.seaState,
      nearLand,
      day: night < 0.5,
    });
    // music
    let music = 'none';
    if (this.mode === 'title') music = 'sail';
    else if (this.mode === 'sail') music = this.hostilesNear(650) || this.combatT > 0 ? 'battle' : 'sail';
    else if (this.mode === 'foot') music = this.combatT > 0 ? 'battle' : 'none';
    if (this.audio.musicMode !== 'tavern' || !this.ui.anyModal()) this.audio.setMusic(music);
  }
}
