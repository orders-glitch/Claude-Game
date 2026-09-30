// The game's map projection: the real West Indies at 1:60, equirectangular about 22.8°N 76.6°W.
// Game axes: x east, z south (north is -Z), 1 unit = 1 metre.
export const GEO_SCALE = 60;
export const LON0 = -76.6;
export const LAT0 = 22.8;
const KX = (111320 * Math.cos((LAT0 * Math.PI) / 180)) / GEO_SCALE;
const KZ = 110540 / GEO_SCALE;

export function geo(lon, lat) {
  return { x: (lon - LON0) * KX, z: -(lat - LAT0) * KZ };
}

export function lonLat(x, z) {
  return { lon: LON0 + x / KX, lat: LAT0 - z / KZ };
}
