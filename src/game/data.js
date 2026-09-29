// Static game data — geography, nations, ships, goods. Everything is set in the West Indies, 1716,
// the height of the "Republic of Pirates" in Nassau after the wreck of the 1715 Spanish Plate Fleet.

export const NATIONS = {
  britain: {
    id: 'britain', name: 'Great Britain', adj: 'British', flag: 'britain',
    hull: '#6b4b30', stripe: '#b8862d', coat: '#9c1b1b', facing: '#e8dcc0',
  },
  spain: {
    id: 'spain', name: 'Spain', adj: 'Spanish', flag: 'spain',
    hull: '#5e4430', stripe: '#8a1d1d', coat: '#2b3f7a', facing: '#c9372c',
  },
  france: {
    id: 'france', name: 'France', adj: 'French', flag: 'france',
    hull: '#5a4a38', stripe: '#1f3d78', coat: '#d9d4c6', facing: '#1f3d78',
  },
  dutch: {
    id: 'dutch', name: 'the Dutch Republic', adj: 'Dutch', flag: 'dutch',
    hull: '#6a4a2a', stripe: '#2f5a2e', coat: '#44506a', facing: '#c7792b',
  },
  pirate: {
    id: 'pirate', name: 'the Brethren', adj: 'Pirate', flag: 'pirate',
    hull: '#4a3526', stripe: '#1b1b1b', coat: '#3b2a22', facing: '#7a1d1d',
  },
};

// Islands of our (compressed) Caribbean. North is -Z. rx/rz are ellipse radii, rot in radians.
export const ISLANDS = [
  { id: 'newprovidence', name: 'New Providence', x: 1800, z: -4600, rx: 560, rz: 300, rot: 0.08, peak: 42, seed: 11, jungle: 0.55 },
  { id: 'hog', name: 'Hog Island', x: 1820, z: -5120, rx: 420, rz: 55, rot: 0.04, peak: 7, seed: 12, jungle: 0.2 },
  { id: 'eleuthera', name: 'Eleuthera', x: 3500, z: -5300, rx: 900, rz: 120, rot: 0.55, peak: 18, seed: 13, jungle: 0.4 },
  { id: 'exuma', name: 'Great Exuma', x: 3500, z: -3500, rx: 520, rz: 110, rot: -0.7, peak: 14, seed: 14, jungle: 0.35 },
  { id: 'andros', name: 'Andros', x: 250, z: -4300, rx: 380, rz: 700, rot: 0.1, peak: 16, seed: 15, jungle: 0.7 },
  { id: 'florida', name: 'Florida (Palmar de Ayz)', x: -1500, z: -6900, rx: 420, rz: 1500, rot: -0.12, peak: 20, seed: 21, jungle: 0.8 },
  { id: 'matecumbe', name: 'Matecumbe Key', x: -2500, z: -4950, rx: 460, rz: 70, rot: -0.55, peak: 5, seed: 22, jungle: 0.5 },
  { id: 'cayohueso', name: 'Cayo Hueso', x: -3700, z: -4500, rx: 280, rz: 110, rot: -0.2, peak: 6, seed: 23, jungle: 0.45 },
  { id: 'tortugas', name: 'Las Tortugas Secas', x: -5300, z: -5000, rx: 150, rz: 90, rot: 0.3, peak: 4, seed: 24, jungle: 0.1 },
  { id: 'cuba', name: 'Cuba', x: -1600, z: -2350, rx: 3900, rz: 480, rot: -0.1, peak: 140, seed: 31, jungle: 0.85 },
  { id: 'pinos', name: 'Isla de Pinos', x: -3900, z: -1050, rx: 380, rz: 300, rot: 0.2, peak: 38, seed: 32, jungle: 0.6 },
  { id: 'cayman', name: 'Grand Cayman', x: -1700, z: 900, rx: 260, rz: 85, rot: 0.1, peak: 8, seed: 33, jungle: 0.4 },
  { id: 'jamaica', name: 'Jamaica', x: 1300, z: 700, rx: 1000, rz: 360, rot: 0.02, peak: 150, seed: 41, jungle: 0.95 },
  { id: 'hispaniola', name: 'Hispaniola', x: 5400, z: -1000, rx: 1500, rz: 650, rot: 0.08, peak: 170, seed: 51, jungle: 0.9 },
  { id: 'tortuga', name: 'Tortuga', x: 5000, z: -2250, rx: 400, rz: 115, rot: 0.03, peak: 55, seed: 52, jungle: 0.75 },
  { id: 'vache', name: 'Île-à-Vache', x: 4250, z: 100, rx: 200, rz: 85, rot: -0.2, peak: 9, seed: 53, jungle: 0.5 },
];

// Ports. `coast` is an approximate coastal point; `dir` the direction the harbour faces (radians, bearing
// measured like ship heading: 0 = north/-Z, +PI/2 = west). The town generator snaps to the true coastline.
export const PORTS = [
  {
    id: 'nassau', name: 'Nassau', island: 'newprovidence', nation: 'pirate', coast: [1800, -4905], dir: 0,
    style: 'shanty', size: 1.0, fort: true, desc: 'The Republic of Pirates. No governor, no law — only the Brethren.',
    produces: ['hides', 'logwood'], demands: ['rum', 'silver', 'cloth', 'powder'], shipyard: ['sloop', 'brigantine'],
  },
  {
    id: 'havana', name: 'La Habana', island: 'cuba', nation: 'spain', coast: [-3500, -2750], dir: 0.05,
    style: 'spanish', size: 1.35, fort: true, desc: 'Key of the New World. Gathering port of the Spanish treasure fleets.',
    produces: ['tobacco', 'sugar', 'hides'], demands: ['cloth', 'indigo'], shipyard: ['sloop', 'brigantine', 'frigate', 'galleon'],
  },
  {
    id: 'portroyal', name: 'Port Royal', island: 'jamaica', nation: 'britain', coast: [1650, 1070], dir: Math.PI,
    style: 'english', size: 1.2, fort: true, desc: 'Rebuilt after the great earthquake of 1692. Seat of the Royal Navy in the West Indies.',
    produces: ['sugar', 'rum', 'molasses'], demands: ['cacao', 'silver', 'tobacco'], shipyard: ['sloop', 'brigantine', 'frigate'],
  },
  {
    id: 'tortuga', name: 'Cayona', island: 'tortuga', nation: 'france', coast: [5000, -2135], dir: Math.PI,
    style: 'french', size: 0.9, fort: true, desc: 'Old haunt of the boucaniers, now a sleepy French trading post.',
    produces: ['indigo', 'cacao', 'cotton'], demands: ['rum', 'cloth', 'powder'], shipyard: ['sloop', 'brigantine'],
  },
];

// Mission-only location: the Spanish salvage camp over the wrecks of the 1715 Plate Fleet.
export const SALVAGE_CAMP = { id: 'salvage', name: 'Spanish Salvage Camp', coast: [-1080, -7250], dir: -Math.PI / 2 - 0.1 };

export const GOODS = {
  sugar: { name: 'Sugar', unit: 'hogshead', base: 14 },
  rum: { name: 'Rum', unit: 'cask', base: 22 },
  molasses: { name: 'Molasses', unit: 'barrel', base: 10 },
  tobacco: { name: 'Tobacco', unit: 'bale', base: 26 },
  cotton: { name: 'Cotton', unit: 'bale', base: 16 },
  indigo: { name: 'Indigo', unit: 'chest', base: 42 },
  cacao: { name: 'Cacao', unit: 'sack', base: 30 },
  logwood: { name: 'Logwood', unit: 'ton', base: 12 },
  hides: { name: 'Hides', unit: 'bundle', base: 9 },
  cloth: { name: 'Linen & Cloth', unit: 'bolt', base: 24 },
  powder: { name: 'Gunpowder', unit: 'keg', base: 28 },
  silver: { name: 'Silver Bars', unit: 'bar', base: 85 },
};

// Ship classes of the period. speed in world units/s at best point of sail.
export const SHIP_CLASSES = {
  sloop: {
    id: 'sloop', name: 'Jamaica Sloop', rig: 'sloop', length: 22, beam: 6.8, depth: 3.2, guns: 10,
    hull: 110, sails: 100, crewMax: 75, crewMin: 8, cargo: 60, speed: 30, turn: 1.0, upwind: 0.85, price: 1800,
    desc: 'Fast, weatherly and shallow of draught — the pirate\'s favourite.',
  },
  brigantine: {
    id: 'brigantine', name: 'Brigantine', rig: 'brigantine', length: 28, beam: 8, depth: 3.8, guns: 14,
    hull: 190, sails: 140, crewMax: 110, crewMin: 14, cargo: 120, speed: 28, turn: 0.82, upwind: 0.7, price: 4800,
    desc: 'Two masts, square foresail and gaff main. A capable raider.',
  },
  fluyt: {
    id: 'fluyt', name: 'Merchant Fluyt', rig: 'ship', length: 30, beam: 8.6, depth: 4.4, guns: 6,
    hull: 170, sails: 160, crewMax: 40, crewMin: 10, cargo: 260, speed: 20, turn: 0.6, upwind: 0.45, price: 3600,
    desc: 'Dutch-built cargo carrier. Deep holds, few guns.',
  },
  frigate: {
    id: 'frigate', name: 'Sixth-Rate Frigate', rig: 'ship', length: 36, beam: 9.6, depth: 4.8, guns: 24,
    hull: 340, sails: 220, crewMax: 180, crewMin: 30, cargo: 160, speed: 27, turn: 0.66, upwind: 0.55, price: 12500,
    desc: 'A post ship of the line\'s smallest rating. Fast and well armed.',
  },
  galleon: {
    id: 'galleon', name: 'Galeón', rig: 'ship', length: 42, beam: 11.5, depth: 5.8, guns: 36,
    hull: 520, sails: 260, crewMax: 300, crewMin: 50, cargo: 420, speed: 18, turn: 0.46, upwind: 0.4, price: 22000,
    desc: 'Towering Spanish treasure ship of the Flota. Slow, but a floating fortress.',
  },
  manowar: {
    id: 'manowar', name: 'Fourth-Rate Man-of-War', rig: 'ship', length: 48, beam: 12.5, depth: 6.2, guns: 48,
    hull: 780, sails: 320, crewMax: 350, crewMin: 70, cargo: 200, speed: 22, turn: 0.45, upwind: 0.5, price: 40000,
    desc: 'Fifty guns on two decks. The Royal Navy\'s answer to piracy.',
  },
};

export const AMMO = {
  round: { name: 'Round Shot', key: '1', hull: 1.0, sails: 0.25, crew: 0.35, range: 1.0 },
  chain: { name: 'Chain Shot', key: '2', hull: 0.25, sails: 1.25, crew: 0.2, range: 0.75 },
  grape: { name: 'Grape Shot', key: '3', hull: 0.2, sails: 0.15, crew: 1.4, range: 0.5 },
};

export const SHIP_NAMES = {
  britain: ['Swallow', 'Greyhound', 'Pearl', 'Lyme', 'Phoenix', 'Scarborough', 'Seaford', 'Shoreham', 'Diamond', 'Adventure', 'Mary Anne', 'Speedwell', 'Charles', 'Endeavour'],
  spain: ['Nuestra Señora del Carmen', 'San Miguel', 'Santa Rita', 'El Ciervo', 'San José', 'Santísima Trinidad', 'La Holandesa', 'San Román', 'Urca de Lima', 'La Galera'],
  france: ['Le Griffon', 'La Concorde', 'L\'Aurore', 'Le Hardi', 'La Fortune', 'Le Saint-Louis', 'La Diligente', 'Le Dauphin'],
  dutch: ['Vliegende Hert', 'De Hoop', 'Eendracht', 'Zeeuwsche Leeuw', 'Amsterdam', 'Goede Verwachting'],
  pirate: ['Ranger', 'Revenge', 'Fancy', 'Whydah', 'Night Rambler', 'Delivery', 'Happy Return', 'Black Joke', 'Good Fortune', 'Bachelor\'s Delight'],
};

export const PIRATE_CAPTAINS = [
  'Calico Jack Rackham', 'Charles Vane', 'Benjamin Hornigold', 'Henry Jennings', 'Sam Bellamy', 'Edward Thache',
  'Stede Bonnet', 'Paulsgrave Williams', 'Christopher Winter', 'Olivier Levasseur',
];

// Watches of the ship's day (four-hour watches, with the dog watches).
export function watchName(hours) {
  const h = ((hours % 24) + 24) % 24;
  if (h < 4) return 'Middle Watch';
  if (h < 8) return 'Morning Watch';
  if (h < 12) return 'Forenoon Watch';
  if (h < 16) return 'Afternoon Watch';
  if (h < 18) return 'First Dog Watch';
  if (h < 20) return 'Last Dog Watch';
  return 'First Watch';
}

export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
