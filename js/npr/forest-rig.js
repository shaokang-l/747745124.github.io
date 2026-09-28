// Camera input for the forest hero: the mouse (or a dragging finger) or, on phones that allow it without a
// permission prompt, the device's tilt, eased by a critically damped spring into a smooth -1..1 parallax
// signal (x right, y up) with velocity. The caller skips it entirely under reduced motion.
import { createPointer } from './core.js';

const TILT_RANGE = { x: 16, y: 12 }; // degrees of device tilt for a full deflection
const RECENTRE_S = 5;                // the neutral tilt slowly follows how the phone is held
const TILT_FRESH_MS = 1200;          // tilt readings older than this: back to the pointer

const clamp = (v) => (v < -1 ? -1 : v > 1 ? 1 : v);

export function createRig({ omega = 3.2 } = {}) {
  const pointer = createPointer(window); // (only its raw values are used: the spring does the easing)
  const rig = { x: 0, y: 0, vx: 0, vy: 0, update, dispose };

  /* device tilt: Android & co. fire deviceorientation freely; iOS needs a permission prompt (not asked) */
  const tilt = { x: 0, y: 0, bx: 0, by: 0, gx: 0, last: 0 };
  const DOE = window.DeviceOrientationEvent;
  let coarse = false;
  try { coarse = window.matchMedia('(pointer: coarse)').matches; } catch (e) { /* no matchMedia */ }
  const useTilt = !!DOE && typeof DOE.requestPermission !== 'function' && coarse;
  function onOrient(e) {
    if (e.beta == null || e.gamma == null) return;
    const now = performance.now();
    const a = (window.screen.orientation && window.screen.orientation.angle) || window.orientation || 0;
    // screen axes: x = turning left / right, y = tipping the top toward / away from the viewer
    let x = e.gamma, y = e.beta;
    if (a === 90) { x = e.beta; y = -e.gamma; } else if (a === -90 || a === 270) { x = -e.beta; y = e.gamma; } else if (a === 180) { x = -e.gamma; y = -e.beta; }
    // first reading, a stale one or a wrap-around (gamma flips at +-90 degrees): re-centre there
    if (!tilt.last || now - tilt.last > TILT_FRESH_MS || Math.abs(x - tilt.gx) > 45) { tilt.bx = x; tilt.by = y; }
    else {
      const k = Math.min(1, (now - tilt.last) / 1000 / RECENTRE_S);
      tilt.bx += (x - tilt.bx) * k;
      tilt.by += (y - tilt.by) * k;
    }
    tilt.gx = x;
    tilt.last = now;
    tilt.x = clamp((x - tilt.bx) / TILT_RANGE.x);
    tilt.y = clamp((tilt.by - y) / TILT_RANGE.y);
  }
  if (useTilt) window.addEventListener('deviceorientation', onOrient, { passive: true });

  // Critically damped spring toward the input (sub-stepped: stable for any frame time).
  function update(dt) {
    if (!(dt > 0)) return;
    const fresh = tilt.last && performance.now() - tilt.last < TILT_FRESH_MS;
    const tx = fresh ? tilt.x : pointer.rawX, ty = fresh ? tilt.y : pointer.rawY;
    const n = Math.ceil(Math.min(dt, 0.1) / 0.016), h = Math.min(dt, 0.1) / n, w2 = omega * omega, d = 2 * omega;
    for (let i = 0; i < n; i++) {
      rig.vx += (w2 * (tx - rig.x) - d * rig.vx) * h;
      rig.vy += (w2 * (ty - rig.y) - d * rig.vy) * h;
      rig.x += rig.vx * h;
      rig.y += rig.vy * h;
    }
  }

  function dispose() {
    pointer.dispose();
    if (useTilt) window.removeEventListener('deviceorientation', onOrient);
  }

  return rig;
}
