// Sailing physics. The ship is a hull with mass and yaw inertia pushed by its rig through the APPARENT wind
// (the true wind minus the ship's own motion) and held by water resistance:
//  - the crew trims the sails to the apparent wind; square yards can only be braced so far round (about 35°
//    off the centreline), fore-and-aft canvas sheets in much flatter, so a sloop points far higher than a galleon;
//  - each rig is a sail foil with lift and drag curves: it drives best a little below the stall, luffs and
//    flogs when pinched, is taken aback (square sails) when the wind gets on the wrong side, and is pure drag
//    running before the wind;
//  - the hull resists motion ahead (growing steeply toward hull speed), resists sideways motion far more (so
//    the side force becomes a few degrees of leeway), heels to the side force against its stability, and turns
//    only while water flows past the rudder.
// Everything is in game units; each class is calibrated so its best speed in a fresh breeze equals its listed
// speed and it gathers way over a realistic number of seconds.
import { clamp, lerp, smoothstep } from '../core/noise.js';

// true wind speed (game m/s) for wind strength 1 — ships make roughly half the wind speed at best
export const WIND_SPEED = 58;

export const RIGS = {
  // fore-and-aft: gaff main and headsails
  sloop: { clMax: 1.5, stall: 0.32, cd0: 0.06, dMin: 0.14, dMax: 1.45, aOpt: 0.3, lat: 320, run: 0.9, windage: 0.2 },
  // square foremast, fore-and-aft main
  brigantine: { clMax: 1.32, stall: 0.36, cd0: 0.09, dMin: 0.42, dMax: 1.52, aOpt: 0.34, lat: 200, run: 1.0, windage: 0.45 },
  // full-rigged: square sails on every mast
  ship: { clMax: 1.15, stall: 0.42, cd0: 0.12, dMin: 0.72, dMax: 1.57, aOpt: 0.38, lat: 120, run: 1.12, windage: 0.8 },
};

// lift and drag coefficients of a trimmed rig at angle of attack a (radians; negative = backed)
export function coeffs(R, a) {
  const aa = Math.abs(a);
  let cl;
  if (aa <= R.stall) cl = R.clMax * Math.sin((aa / R.stall) * Math.PI / 2);
  else cl = R.clMax * (0.78 + 0.22 * Math.cos(Math.min(1, (aa - R.stall) / 0.25) * Math.PI)) * Math.cos(clamp((aa - R.stall) / (Math.PI / 2 - R.stall), 0, 1) * Math.PI / 2) ** 0.7;
  const cd = R.cd0 + 0.1 * cl * cl / R.clMax + 1.25 * Math.sin(aa) ** 2;
  return { cl: a < 0 ? -cl * 0.85 : cl, cd };
}

// Aerodynamic force coefficients along the ship (cx: ahead, cy: to leeward) for apparent wind coming from
// |beta| off the bow (0 = head to wind, PI = dead astern), with the crew's trim. Returns the angle of attack
// the sails see and how hard they are drawing.
export function rigForce(R, beta, backed = false) {
  const b = Math.abs(beta);
  // trim: sheet the sail to keep the best angle of attack, within what the rig allows
  const delta = clamp(b - R.aOpt, R.dMin, R.dMax);
  let a = b - delta;
  if (backed) a = -Math.max(0.15, R.dMin - b + 0.1); // square sails pressed back against the masts
  const { cl, cd } = coeffs(R, a);
  // the pinched sail flogs: lift collapses to nothing as the angle of attack goes to zero
  const luff = a < 0.1 && !backed ? smoothstep(0.1, -0.05, a) : 0;
  const L = cl * (1 - luff), D = cd + luff * 0.25;
  const cx = L * Math.sin(b) - D * Math.cos(b);
  const cy = L * Math.cos(b) + D * Math.sin(b);
  return { cx: cx * (b > 2.4 ? lerp(1, R.run, smoothstep(2.4, 3.0, b)) : 1), cy, a, luff };
}

// Per-class constants: resistance, mass and sail power so that the class reaches `speed` at its best
// point of sail in wind strength 1 and gathers way with a time constant of `tau` seconds.
const CAL = new Map();
export function steadyPolar(cls, th) { const c = calibrate(cls); return c.steady(c.K, th); }

export function calibrate(cls) {
  if (CAL.has(cls.id)) return CAL.get(cls.id);
  const R = RIGS[cls.rig] || RIGS.ship;
  const V = cls.speed;
  const tau = 7 + cls.length * 0.28;
  const cf = 1 / (2 * tau * V); // linearised: dv/dt = -2 cf V (v - V) -> time constant tau (per unit mass)
  const wave = (u) => 1 + 5 * smoothstep(0.82, 1.2, Math.abs(u) / V) ** 2;
  // steady speed for a sail power K at true wind angle th (0 = head to wind)
  const steady = (K, th) => {
    let u = V * 0.5;
    for (let i = 0; i < 60; i++) {
      // apparent wind (the way the air moves, in the ship's frame) and the angle of its source off the bow
      const wx = -Math.cos(th) * WIND_SPEED - u, wy = Math.sin(th) * WIND_SPEED;
      const q = wx * wx + wy * wy;
      const f = rigForce(R, Math.atan2(Math.abs(wy), -wx));
      const drive = K * q * f.cx;
      // solve drive = cf u^2 wave(u)
      const un = Math.sqrt(Math.max(0, drive) / (cf * wave(u)));
      u = lerp(u, un, 0.5);
    }
    return u;
  };
  const best = (K) => { let m = 0; for (let th = 0.4; th <= Math.PI; th += 0.05) m = Math.max(m, steady(K, th)); return m; };
  let lo = 1e-7, hi = 1e-2;
  for (let i = 0; i < 40; i++) { const mid = Math.sqrt(lo * hi); if (best(mid) > V) hi = mid; else lo = mid; }
  const K = Math.sqrt(lo * hi);
  // the closest the ship can usefully sail to the true wind (best speed made good to windward)
  let bestVmg = 0, tack = 1;
  for (let th = 0.4; th < Math.PI / 2; th += 0.02) { const vmg = steady(K, th) * Math.cos(th); if (vmg > bestVmg) { bestVmg = vmg; tack = th; } }
  // side force at a close reach sets the heel scale
  const c = { steady, R, K, cf, wave, V, tau, lat: cf * R.lat, tack, sideRef: K * WIND_SPEED * WIND_SPEED * rigForce(R, 1.2).cy, heelRef: cls.rig === 'sloop' ? 0.11 : cls.rig === 'brigantine' ? 0.09 : 0.075 };
  CAL.set(cls.id, c);
  return c;
}

// One physics step. `w`: local true wind {x, z, speed} (direction the air moves toward; speed in game m/s).
// Updates ship.speed (surge), ship.sway, ship.yawRate, ship.heading, ship.heelTarget and the sail state.
export function sailStep(ship, dt, w) {
  const cls = ship.cls, C = calibrate(cls), R = C.R;
  const f = ship.forward, r = ship.right;
  const u = ship.speed, s = ship.sway || 0;
  // apparent wind in the ship's frame: true wind minus the ship's velocity
  const wf = w.x * f.x + w.z * f.z, wr = w.x * r.x + w.z * r.z;
  const af = wf * w.speed - u, ar = wr * w.speed - s;
  const q = af * af + ar * ar;
  // angle of the apparent wind's source off the bow: 0 head to wind, PI dead astern
  const beta = Math.atan2(Math.abs(ar), -af);
  const windSide = ar >= 0 ? 1 : -1; // +1: the air is moving toward starboard (wind on the port side)
  // square sails are taken aback when the wind gets forward of the yards' bracing
  const backed = cls.rig !== 'sloop' && beta < R.dMin - 0.08 && ship.sailSet > 0.05;
  const rf = rigForce(R, beta, backed);
  const heel = ship.heel || 0;
  const power = C.K * ship.sailSet * ship.sailPower * q * Math.cos(heel) ** 2;
  const fx = power * rf.cx;
  const fy = power * rf.cy * windSide; // pushes to leeward
  // hull
  const wave = C.wave(u);
  const turnDrag = Math.abs(ship.yawRate || 0) * Math.abs(u) * 0.06;
  let du = fx - C.cf * u * Math.abs(u) * wave - turnDrag * Math.sign(u) - (ship.extraDrag || 0) * u;
  let ds = fy - C.lat * s * Math.abs(s) - C.lat * 0.4 * s;
  ship.speed = u + du * dt;
  ship.sway = s + ds * dt;
  // yaw: the rudder works on the water flowing past it; a stopped ship's windage turns her bow off the wind
  const flow = clamp(ship.speed / C.V, -0.6, 1.3);
  const rudderRate = ship.rudder * cls.turn * 0.26 * flow * (flow < 0 ? 0.7 : 1);
  // (head to wind the balance is unstable: she drifts back and her bow falls off one way or the other)
  const windage = -Math.max(Math.sin(beta), 0.4) * windSide * (R.windage + 0.15) * 0.05 * (q / (WIND_SPEED * WIND_SPEED)) * (1 - clamp(Math.abs(ship.speed) / (C.V * 0.4), 0, 1));
  // a square-rigger's backed headsails help her round through the wind when tacking
  const assist = backed ? Math.sign(ship.rudder || 0) * 0.05 : 0;
  const targetRate = rudderRate + windage + assist;
  const tauYaw = 0.9 + cls.length * 0.035;
  ship.yawRate = (ship.yawRate || 0) + (targetRate - (ship.yawRate || 0)) * clamp(dt / tauYaw, 0, 1);
  // heel to the side force against the ship's stability
  ship.heelTarget = clamp((fy / C.sideRef) * C.heelRef, -0.6, 0.6);
  // sail state for the visuals and the helm's instruments
  ship.aw = { beta, speed: Math.sqrt(q), side: windSide };
  ship.sailDraw = backed ? -0.6 : clamp(Math.sqrt(q) / (WIND_SPEED * 0.9) * clamp(Math.abs(rf.cx) + Math.abs(rf.cy) * 0.5, 0, 1.4) * (1 - rf.luff), 0, 1.2);
  ship.luff = rf.luff;
  ship.backed = backed;
  ship.drive = rf.cx;
  return C;
}
