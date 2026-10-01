// What a collider presents on top at its local (lx, lz): a gable or hipped roof's slope, a flat roof's floor,
// or simply its top. Shared by the game (walking on roofs) and the player (climbing to the eaves).
import { sampleShape } from './roofMap.js';

export function colliderSurface(c, lx, lz) {
  if (c.hmap) return sampleShape(c, lx, lz); // the building's real shape from above (see roofMap.js)
  const R = c.roof;
  if (!R) return c.top;
  if (R.flat) return R.y;
  const z = lz - R.dz;
  const fx = 1 - Math.abs(lx) / R.X, fz = 1 - Math.abs(z) / R.Z;
  const f = R.ridge === 'x' ? fz : R.ridge === 'z' ? fx : Math.min(fx, fz);
  return R.y + R.rise * Math.max(0, f);
}
