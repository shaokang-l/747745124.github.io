// Home hero: "the golden stag of Niflheimr" — a misty NPR forest with a glowing-antlered stag, by day in a
// golden haze, by night (setNight) under a low moon, lit by its antlers, fireflies and glowing mushrooms.
// mountForest(container, { quality, reducedMotion, accent, night })
//   -> Promise<{ start, stop, dispose, setTime, setNight, enter, resetEnter, stage }>
import * as THREE from 'three';
import { createStage, isMobileLike } from './core.js';
import { createAtmosphere } from './forest-atmos.js';
import { createWoods } from './forest-woods.js';
import { createStag } from './forest-deer.js';
import { createFx } from './forest-fx.js';
import { createRig } from './forest-rig.js';

const DEG = Math.PI / 180;
const REST_TIME = 6.5;      // pose shown under reduced motion
const TIME_OFFSET = 3;      // start the idle cycle at a pleasant pose
const STAG_YAW = -2.8;      // body nearly side-on (walking toward the camera's left), head turned to us
const ENTER_S = 1.35;       // "enter the forest" flight (seconds)
const NIGHT_S = 0.8;        // day <-> night crossfade (seconds)
// parallax at the pointer's / tilt's extremes: the camera orbits the stag (which stays put) by YAW / PITCH,
// the view pans a little further (PAN, m at the stag), dollies in when looking up and out toward the sides
// (DOLLY, fraction of the distance) and banks (ROLL)
const PARALLAX = { yaw: 6 * DEG, pitch: 2.5 * DEG, pan: 0.14, dolly: 0.04, roll: 0.8 * DEG };
// night: the moon hangs low beside the antler crown, in a window kept free of trunks (a lane from the camera
// past the stag's right side), MOON_LIFT above the crown and clear of every trunk by MOON_CLEAR (rad; the
// disc's radius is 0.025) when possible
const MOON_LANE = { from: [0.5, 6.9], through: [0.8, -0.3] };
const MOON_LIFT = 0.45;
const MOON_CLEAR = 0.035;
const SUN_LIFT = 2.2;       // day: the god-ray light sits this far above the haze glow (m, at the crown's depth)
const ROUTE_END = new THREE.Vector3(-0.5, 4.3, -4.8); // flight end: above the lane behind the stag, >= 1.5 m from trunks

const smooth = (e0, e1, x) => { const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1); return t * t * (3 - 2 * t); };

// Horizontal screen position (0..1) for the stag on wide layouts: just right of Diaspora's translucent
// polygon (#vibrant: viewBox 2880x1620, xMaxYMax slice, edge from (600,0) to (2000,1620)) at hoof height.
function stagScreenX(w, h) {
  const s = Math.max(w / 2880, h / 1620);
  const x0 = w - 2880 * s, y0 = h - 1620 * s;
  const t = (0.9 * h - y0) / (1620 * s);
  const edge = x0 + s * (600 + 1400 * t);
  return Math.min(Math.max((edge + 0.2 * h) / w, 0.62), 0.74);
}

// Resolves once the container has a non-zero size (e.g. mounted while hidden by the post preview).
function sized(el) {
  if (el.clientWidth > 0 && el.clientHeight > 0) return Promise.resolve();
  return new Promise((resolve) => {
    const ro = new ResizeObserver(() => {
      if (el.clientWidth > 0 && el.clientHeight > 0) { ro.disconnect(); resolve(); }
    });
    ro.observe(el);
  });
}

/* Day and night looks of the lights and the NPR pipeline (numbers and colours are crossfaded). */
const LOOK = {
  day: {
    clear: 0x0f2426, outline: 0x1b1624, bloom: 1.2, threshold: 1.1,
    exposure: 1.0, contrast: 1.06, saturation: 1.05, tint: 0xfff4e6, lift: 0x061210,
    vignette: 0.55, vignetteColor: 0x0a1a1c,
    ambient: [0x6f9a98, 0.75], key: [0xffd79a, 2.6], fill: [0x8fbcc4, 1.0], glow: [0xffc860, 3.5, 7],
    rayPlanes: 0.4,
    rays: { color: 0xffe0a8, intensity: 1.0, threshold: 0.6, radius: 0.3, decay: 0.45 },
  },
  // warm night: plum / umber darks, the antlers (a brighter, wider point light) are the key light, a faint
  // cool moon rim from behind, moonbeams through the trunks, a touch more bloom and vignette
  night: {
    clear: 0x1b1418, outline: 0x150d0b, bloom: 1.45, threshold: 1.0,
    exposure: 1.0, contrast: 1.08, saturation: 1.06, tint: 0xffeedc, lift: 0x0e0709,
    vignette: 0.68, vignetteColor: 0x0d0609,
    ambient: [0x6a4a66, 0.5], key: [0xb8b2e6, 0.8], fill: [0x7a5470, 0.4], glow: [0xffb35c, 6.5, 9.5],
    rayPlanes: 0.17,
    rays: { color: 0xd8c8f0, intensity: 0.28, threshold: 0.7, radius: 0.12, decay: 0.25 }, // (the moon alone emits)
  },
};
const RAY_KEYS = ['intensity', 'threshold', 'radius', 'decay']; // (crossfaded god-ray numbers)
const MOON_RIM = 0xb3a6e0; // toon rim light at night (materials may override it: userData.night)

export async function mountForest(container, { quality, reducedMotion, accent = '#f5c46a', night = false } = {}) {
  const q = quality === 'high' || quality === 'low' ? quality : (isMobileLike() ? 'low' : 'high');
  const D = LOOK.day;
  const rayDir = new THREE.Vector4(0, 0.2, -1, 0); // god-ray light: a direction (w = 0), the haze glow
  const stage = createStage(container, {
    quality: q,
    reducedMotion,
    maxPixelRatio: q === 'low' ? 1.25 : 1.5,
    clearColor: D.clear,
    pipeline: {
      outline: { thickness: 1.8, color: D.outline, opacity: 0.92, fadeStart: 9, fadeEnd: 24, colorBleed: 0.38,
        wobble: 0.8, depthThreshold: 0.035, normalThreshold: 0.32 },
      bloom: { strength: D.bloom, radius: 0.8, threshold: D.threshold, knee: 0.25 },
      paper: { strength: 0.13, scale: 1, tint: 0xfff4e2 },
      grade: { exposure: D.exposure, contrast: D.contrast, saturation: D.saturation, tint: D.tint, lift: D.lift },
      vignette: { strength: D.vignette, softness: 0.6, color: D.vignetteColor },
      // shafts streaming from the glow behind the stag, occluded by the trunks and the stag (moonbeams at night)
      // (only the bright haze / moon emits: threshold; the stag at 7 m stays clear of the veil: depthFade)
      godrays: { enabled: true, position: rayDir, ...D.rays, knee: 0.2, density: 1, sceneTint: 0.45, maxDistance: 45,
        softness: 0.5, depthFade: 14, fadeOffscreen: 0.4 },
    },
  });
  let rig = null, atmos = null, woods = null, stag = null, fx = null;
  // The stage goes first: once its context is gone, freeing the scene's GL objects is a no-op, so there
  // are no stale-object warnings after a context loss / restore.
  const disposeParts = () => {
    stage.dispose();
    for (const part of [atmos, woods, stag, fx, rig]) if (part) part.dispose();
    for (const el of container.querySelectorAll('.npr-veil')) el.remove();
  };

  try {
    const Q = stage.quality;
    const still = stage.reducedMotion;
    const gold = new THREE.Color(accent);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 220);

    atmos = createAtmosphere({ accent: gold, quality: Q });
    woods = createWoods({ atmos, quality: Q, accent: gold, lane: MOON_LANE });
    stag = createStag({ accent: gold, fog: atmos.fog });
    stag.root.position.set(0.25, woods.groundHeight(0.25, -0.3), -0.3);
    stag.root.rotation.y = STAG_YAW;
    fx = createFx({ accent: gold, quality: Q, stag, groundHeight: woods.groundHeight, shroomLights: woods.shroomLights, fog: atmos.fog });
    scene.add(atmos.sky, woods.group, stag.root, atmos.rays, fx.group);

    /* lights: flat teal ambient (painted in the shade colour), golden backlight, teal front fill, antler glow
       (colours / intensities set by applyNight) */
    const ambient = new THREE.AmbientLight();
    const key = new THREE.DirectionalLight();
    key.position.set(-3, 4.6, -11);
    const fill = new THREE.DirectionalLight();
    fill.position.set(-6, 3, 9);
    // soft falloff from the crown: warms the head, back and ground without blowing out the ears
    const glow = new THREE.PointLight(0xffffff, 1, 7, 0.5);
    scene.add(ambient, key, key.target, fill, fill.target, glow);
    const glowDay = gold.clone().lerp(new THREE.Color(0xffb347), 0.3);

    /* camera + composition */
    const camBase = new THREE.Vector3(0.5, 1.45, 6.9);
    const lookAt = new THREE.Vector3(0.15, 1.8, -0.3);
    const stagCentre = new THREE.Vector3(0.2, 1.42, -0.3);
    const _v = new THREE.Vector3(), _d = new THREE.Vector3(), _f = new THREE.Vector3();
    const _off = new THREE.Vector3(), _aim = new THREE.Vector3(), _right = new THREE.Vector3();
    const glowDir = new THREE.Vector3(0, 0.2, -1);
    const sunDir = new THREE.Vector3(0, 0.3, -1), moonDir = new THREE.Vector3(0, 0.2, -1); // god-ray lights

    // The moon: the view direction near the lane beside the antler crown (right / up offsets in a plane
    // there) that clears the trunks by at least MOON_CLEAR, as close as possible to MOON_LIFT above the crown.
    const findMoon = (crown, out) => {
      const anchor = _aim.set(MOON_LANE.through[0], crown.y, MOON_LANE.through[1]);
      _right.subVectors(anchor, camPos).cross(camera.up).normalize();
      let bestClear = -Infinity, bestCost = Infinity;
      for (let dx = -0.6; dx <= 0.6001; dx += 0.1) {
        for (let dy = 0; dy <= 1.4001; dy += 0.1) {
          _d.copy(anchor).addScaledVector(_right, dx).setY(crown.y + dy).sub(camPos).normalize();
          const c = woods.clearance(camPos, _d);
          const ok = c >= MOON_CLEAR, cost = Math.hypot(dx, (dy - MOON_LIFT) * 1.3);
          if (ok ? cost < bestCost : bestCost === Infinity && c > bestClear) {
            out.copy(_d);
            if (ok) bestCost = cost; else bestClear = c;
          }
        }
      }
      return out;
    };
    const camPos = camBase.clone();
    let pixelScale = 600;
    const view = { w: 1, h: 1, fov: 38, offX: 0, offY: 0 }; // layout results (the flight blends away from them)

    const worldAt = (nx, ny, depth, out) => {
      _v.set(nx, ny, 0.5).unproject(camera);
      _d.subVectors(_v, camera.position).normalize();
      camera.getWorldDirection(_f);
      return out.copy(camera.position).addScaledVector(_d, depth / _d.dot(_f));
    };

    const layout = (w, h) => {
      const aspect = w / h;
      const narrow = w < 780 || aspect < 1;
      const portrait = narrow && aspect < 0.8;
      // keep at least ~34 degrees of horizontal view (portrait phones)
      camera.fov = Math.max(38, 2 * Math.atan(Math.tan(17 * DEG) / aspect) / DEG);
      // portrait: step a little closer, but leave breathing room round the stag and depth in the ground
      camPos.copy(lookAt).lerp(camBase, narrow ? Math.min(1, Math.max(0.78, aspect * 1.3)) : 1);
      camera.position.copy(camPos);
      camera.lookAt(lookAt);
      camera.clearViewOffset();
      camera.updateMatrixWorld();
      // lens shift (keeps verticals parallel): stag right of centre on landscape; on portrait a touch right
      // and high, above the post title at the bottom-left
      _v.copy(stagCentre).project(camera);
      const tx = narrow ? 0.12 : 2 * stagScreenX(w, h) - 1, ty = narrow ? 0.2 : -0.14;
      // (full size = view size in pixels: setViewOffset also sets camera.aspect = fullWidth / fullHeight)
      Object.assign(view, { w, h, fov: camera.fov, offX: -(tx - _v.x) / 2 * w, offY: (ty - _v.y) / 2 * h });
      camera.setViewOffset(w, h, view.offX, view.offY, w, h);
      camera.updateMatrixWorld();
      pixelScale = h / (2 * Math.tan(camera.fov * DEG / 2));

      // turn the neck + head to face the camera, so the antler crown reads as a symmetric lyre (as in a
      // portrait) instead of two overlapping beams
      stag.root.rotation.y = STAG_YAW;
      stag.setGaze(0);
      stag.update(TIME_OFFSET);
      stag.root.updateMatrixWorld(true);
      stag.headPivot.getWorldPosition(_v);
      _d.subVectors(camPos, _v);
      const ry = stag.root.rotation.y;
      const lx = _d.x * Math.cos(ry) - _d.z * Math.sin(ry), lz = _d.x * Math.sin(ry) + _d.z * Math.cos(ry);
      stag.setGaze(Math.max(-1.25, Math.min(1.25, Math.atan2(-lz, lx))));

      // framing trunks at the picture edges (+ one mid trunk in the quiet left half on wide screens),
      // foreground ferns on portrait, leafy branches hanging into the top corners (clear of the header)
      const p = new THREE.Vector3();
      const list = [], ferns = [], hanging = [];
      const spray = (nx, depth, rot, sc) => { worldAt(nx, 1.0, depth, p); hanging.push([p.x, p.y + 0.5 * sc, p.z, rot, sc]); };
      const add = (nx, depth, r, rot) => { worldAt(nx, 0, depth, p); list.push([p.x, p.z, r, rot]); };
      const fern = (nx, depth, sc, rot) => { worldAt(nx, -1.05, depth, p); ferns.push([p.x, p.z, sc, rot]); };
      if (narrow) {
        add(-1.02, 3.8, 0.3, 0.3);
        add(1.0, 4.6, 0.28, 1.1);
        fern(0.75, 1.9, 1.3, 0.4);
        fern(-0.8, 2.1, 1.2, 2.0);
        spray(0.85, 4.4, -Math.PI / 2 - 0.6, 0.45);
        spray(-0.85, 4.6, -Math.PI / 2 + 0.6, 0.45);
      } else {
        add(-0.97, 3.8, 0.3, 0.3);
        add(-0.45, 9, 0.26, 2.0);
        add(1.06, 4.6, 0.3, 1.1);
        add(0.8, 11, 0.26, 4.0);
        // (the right one hangs from the right framing trunk, never alone in the bright centre)
        spray(1.0, 6.2, -Math.PI / 2 - 1.15, 0.6);
        spray(-0.35, 5.5, -Math.PI / 2 + 0.5, 0.6);
      }
      woods.setFrame(list, ferns, hanging);

      // haze glow behind the antlers (beside them on portrait, so the crown is not gold on gold); the sun's
      // shafts (god rays) pour from high above it; at night the low moon rises by the antler crown, in the
      // clearest gap between the trunks (pale on warm, a silhouette the moonbeams stream round)
      stag.update(TIME_OFFSET);
      stag.root.updateMatrixWorld(true);
      const crown = stag.glowAnchor.getWorldPosition(new THREE.Vector3());
      const glowTarget = crown.clone();
      glowTarget.y += portrait ? 1.6 : 0.9;
      if (portrait) glowTarget.x -= 1.2;
      sunDir.copy(glowTarget).setY(glowTarget.y + SUN_LIFT).sub(camPos).normalize();
      findMoon(crown, moonDir);
      glowTarget.addScaledVector(_d.subVectors(glowTarget, camPos).normalize(), 25);
      atmos.setGlowFrom(camPos, glowTarget, _v.copy(camPos).addScaledVector(moonDir, 40));
      // the swirling motes circle a point inside that glow, a few metres behind the stag
      fx.setGlowCentre(_f.copy(camPos).addScaledVector(glowDir.subVectors(glowTarget, camPos).normalize(), 12));
      applyNight(nightK);
    };
    stage.onResize(layout);

    /* animation */
    rig = still ? null : createRig();
    let frozen = null;
    let disposed = false;
    let antlerLevel = stag.antlerMat.emissiveIntensity, glowLevel = 1; // (set by applyNight)

    // Camera for the parallax input (-1..1): orbit round the stag, a little pan, dolly and bank.
    const place = (px, py, vx, t) => {
      const P = PARALLAX;
      _off.subVectors(camPos, lookAt);
      const len = _off.length() * (1 - P.dolly * py + 0.75 * P.dolly * px * px);
      const yaw = Math.atan2(_off.x, _off.z) + px * P.yaw;
      const pitch = Math.asin(_off.y / _off.length()) + py * P.pitch;
      _off.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)).multiplyScalar(len);
      camera.position.copy(lookAt).add(_off);
      // very slow, tiny camera breathing
      camera.position.x += Math.sin(t * 0.21) * 0.015;
      camera.position.y += Math.sin(t * 0.33) * 0.01;
      _right.set(Math.cos(yaw), 0, -Math.sin(yaw));
      camera.lookAt(_aim.copy(lookAt).addScaledVector(_right, px * P.pan).setY(lookAt.y + py * P.pan * 0.4));
      camera.rotateZ(-(px + 0.25 * vx) * P.roll);
    };

    const pose = (t, dt) => {
      stag.update(t);
      const pulse = 1 + 0.1 * Math.sin(t * 1.3) + 0.04 * Math.sin(t * 3.1 + 1);
      stag.antlerMat.emissiveIntensity = antlerLevel * pulse;
      stag.lightAnchor.getWorldPosition(glow.position);
      glow.intensity = glowLevel * pulse;
      // the golden haze, halo and rays breathe with the antlers (a touch behind them), over a slower swell
      const breath = 0.8 * Math.sin(t * 1.3 - 0.4) + 0.2 * Math.sin(t * 0.41);
      if (rig) rig.update(dt);
      place(rig ? rig.x : 0, rig ? rig.y : 0, rig ? rig.vx : 0, t);
      if (flight) fly();
      atmos.update(t, camera, breath);
      woods.update(t);
      fx.update(t, camera, pixelScale * stage.pixelRatio, breath);
    };

    /* day / night: every light, colour and pipeline value is a crossfade between LOOK.day and LOOK.night */
    const params = stage.pipeline.params;
    const toon = [];
    scene.traverse((o) => {
      for (const m of [].concat(o.material || [])) {
        if (!m.nprUniforms || toon.some((e) => e.m === m)) continue;
        toon.push({ m, rim: m.rimColor.clone(), rimK: m.rimStrength, em: m.emissiveIntensity, emC: m.emissive.clone(),
          n: m.userData.night || {} });
      }
    });
    const base = {}; // the current (unflown) look, which the enter flight departs from
    const _c = new THREE.Color(), _c2 = new THREE.Color(), clearC = new THREE.Color();
    // (the pipeline reads Color params live: these are mixed in place)
    params.outline.color = new THREE.Color();
    params.grade.tint = new THREE.Color();
    params.grade.lift = new THREE.Color();
    params.vignette.color = new THREE.Color();
    params.godrays.color = new THREE.Color();
    const mixN = (a, b, k) => a + (b - a) * k;
    const mixC = (out, a, b, k) => out.set(a).lerp(_c2.set(b), k);
    let nightK = night ? 1 : 0, nightFade = null;

    function applyNight(k) {
      const N = LOOK.night;
      for (const e of toon) {
        e.m.rimColor = mixC(_c, e.rim, e.n.rimColor != null ? e.n.rimColor : MOON_RIM, k);
        e.m.rimStrength = e.rimK * mixN(1, e.n.rimScale != null ? e.n.rimScale : 0.45, k);
        e.m.emissiveIntensity = e.em * mixN(1, e.n.emissiveScale || 1, k);
        if (e.n.emissive != null) e.m.emissive.copy(e.emC).lerp(_c2.set(e.n.emissive), k);
      }
      antlerLevel = stag.antlerMat.emissiveIntensity;
      mixC(ambient.color, D.ambient[0], N.ambient[0], k); ambient.intensity = mixN(D.ambient[1], N.ambient[1], k);
      mixC(key.color, D.key[0], N.key[0], k); key.intensity = mixN(D.key[1], N.key[1], k);
      mixC(fill.color, D.fill[0], N.fill[0], k); fill.intensity = mixN(D.fill[1], N.fill[1], k);
      glow.color.copy(glowDay).lerp(_c2.set(N.glow[0]), k);
      glowLevel = mixN(D.glow[1], N.glow[1], k);
      glow.distance = mixN(D.glow[2], N.glow[2], k);
      stage.renderer.setClearColor(mixC(clearC, D.clear, N.clear, k), 1);
      mixC(params.outline.color, D.outline, N.outline, k);
      Object.assign(base, {
        exposure: mixN(D.exposure, N.exposure, k), bloom: mixN(D.bloom, N.bloom, k), threshold: mixN(D.threshold, N.threshold, k),
        vignette: mixN(D.vignette, N.vignette, k), ink: 0.92,
      });
      params.grade.contrast = mixN(D.contrast, N.contrast, k);
      params.grade.saturation = mixN(D.saturation, N.saturation, k);
      mixC(params.grade.tint, D.tint, N.tint, k);
      mixC(params.grade.lift, D.lift, N.lift, k);
      mixC(params.vignette.color, D.vignetteColor, N.vignetteColor, k);
      mixC(params.godrays.color, D.rays.color, N.rays.color, k);
      for (const key of RAY_KEYS) params.godrays[key] = mixN(D.rays[key], N.rays[key], k);
      _d.copy(sunDir).lerp(moonDir, k).normalize();
      rayDir.set(_d.x, _d.y, _d.z, 0);
      atmos.setRayPlanes(D.rayPlanes, N.rayPlanes);
      atmos.setNight(k);
      woods.setNight(k);
      fx.setNight(k);
      if (!flight) resetLook();
    }
    function resetLook() {
      params.grade.exposure = base.exposure;
      params.bloom.strength = base.bloom;
      params.bloom.threshold = base.threshold;
      params.vignette.strength = base.vignette;
      params.outline.opacity = base.ink;
    }

    // Crossfades to night (true) or day; instant under reduced motion, when asked, or while not running
    // (then one frame is rendered so the next reveal is already right).
    function setNight(on, { instant = false } = {}) {
      if (disposed) return;
      const to = on ? 1 : 0;
      nightFade = null;
      if (instant || still || !stage.running) {
        nightK = to;
        applyNight(nightK);
        if (!stage.running) stage.renderOnce();
      } else if (to !== nightK) {
        nightFade = { from: nightK, to, t0: performance.now() };
      }
    }

    /* "enter the forest": the camera flies up over the stag toward the golden light (ease-in), the lens
       widens, the light blooms and floods everything, then a warm-white veil (DOM, over the canvas) takes
       the frame to the page's white (at night: warm lamplight, then the page's dark ground, npr.css). The
       route rises over the antlers and runs along the clear lane behind the stag (trunks stay >= 0.8 m away,
       the antlers >= 0.45 m below; checked for 390x844 ... 2560x1080). */
    const veil = document.createElement('div');
    veil.className = 'npr-veil';
    container.appendChild(veil);
    let flight = null; // { t0, from, ctrl, to, promise, resolve, done }
    const _look = new THREE.Vector3(), _far = new THREE.Vector3();

    function fly() {
      const f = flight;
      const p = Math.min((performance.now() - f.t0) / 1000 / ENTER_S, 1);
      const e = 0.2 * p + 0.8 * Math.pow(p, 2.6); // accelerating
      // quadratic Bezier from where the camera is now, lifted over the stag, into the glow
      const a = (1 - e) * (1 - e), b = 2 * e * (1 - e), c = e * e;
      camera.position.set(
        a * f.from.x + b * f.ctrl.x + c * f.to.x,
        a * f.from.y + b * f.ctrl.y + c * f.to.y,
        a * f.from.z + b * f.ctrl.z + c * f.to.z);
      camera.lookAt(_look.copy(lookAt).lerp(_far, smooth(0, 0.55, p)));
      // lens: re-centre on the light and widen a little (speed)
      const k = 1 - smooth(0, 0.6, p);
      camera.fov = view.fov + 14 * p * p;
      camera.setViewOffset(view.w, view.h, view.offX * k, view.offY * k, view.w, view.h);
      camera.updateMatrixWorld();
      // light: exposure and bloom rise, ink and vignette dissolve, every surface fogs into the glow
      params.grade.exposure = base.exposure * (1 + 1.1 * p * p);
      params.bloom.strength = base.bloom + 1.6 * p * p;
      params.bloom.threshold = base.threshold - 0.45 * p;
      params.vignette.strength = base.vignette * (1 - p);
      params.outline.opacity = base.ink * (1 - smooth(0.25, 0.8, p));
      atmos.setEnter(Math.pow(smooth(0.05, 1, p), 1.5), smooth(0.5, 1, p));
      // the veil is centred on the light
      _v.copy(_far).project(camera);
      veil.style.setProperty('--lx', ((_v.x + 1) * 50).toFixed(1) + '%');
      veil.style.setProperty('--ly', ((1 - _v.y) * 50).toFixed(1) + '%');
      // (at night the lamplight comes a little sooner and holds longer before the dark page ground)
      veil.style.setProperty('--warm', smooth(0.45 - 0.1 * nightK, 0.88 - 0.1 * nightK, p).toFixed(3));
      veil.style.setProperty('--white', smooth(0.72 + 0.1 * nightK, 1, p).toFixed(3));
      if (p >= 1 && !f.done) { f.done = true; f.resolve(); }
    }

    function enter() {
      if (still || disposed) return Promise.resolve();
      if (flight) return flight.promise;
      const f = flight = { t0: performance.now(), done: false };
      f.promise = new Promise((resolve) => { f.resolve = resolve; });
      f.from = camera.position.clone();
      // (the route ends in the clear lane behind the stag for every layout; the view turns to the light)
      f.to = ROUTE_END.clone();
      f.ctrl = f.from.clone().lerp(f.to, 0.55);
      f.ctrl.y += 1.0;
      // look where we go (on portrait the glow sits left of the lane: looking at it would face a trunk)
      _far.subVectors(f.to, f.from).normalize().multiplyScalar(50).add(f.to);
      veil.classList.remove('npr-veil-out');
      veil.classList.add('npr-veil-on');
      stage.start();
      return f.promise;
    }

    // Back to the normal hero. The veil stays white until the container is visible again (e.g. Back from
    // the post), then fades out. Resolves when that fade starts.
    function resetEnter() {
      if (!flight) return Promise.resolve();
      flight = null;
      resetLook();
      atmos.setEnter(0, 0);
      layout(view.w, view.h);
      veil.style.setProperty('--warm', '0');
      veil.style.setProperty('--white', '1');
      if (!stage.running) stage.renderOnce();
      return sized(container).then(() => new Promise((r) => requestAnimationFrame(() => r()))).then(() => {
        if (disposed || flight) return;
        veil.classList.add('npr-veil-out'); // CSS fades the veil's opacity out
        const done = () => { if (!flight) { veil.classList.remove('npr-veil-on', 'npr-veil-out'); veil.style.setProperty('--white', '0'); } };
        setTimeout(done, 1000);
      });
    }

    stage.onUpdate((dt, t) => {
      if (nightFade) {
        const p = Math.min((performance.now() - nightFade.t0) / 1000 / NIGHT_S, 1);
        nightK = nightFade.from + (nightFade.to - nightFade.from) * smooth(0, 1, p);
        applyNight(nightK);
        if (p >= 1) nightFade = null;
      }
      const time = frozen !== null ? frozen : still ? REST_TIME : t + TIME_OFFSET;
      pose(time, dt);
    });
    applyNight(nightK);

    stage.setScene(scene, camera);
    layout(stage.width || container.clientWidth || 1, stage.height || container.clientHeight || 1);
    await stage.compile();
    await sized(container);
    stage.renderOnce();

    return {
      stage,
      scene, camera, // exposed for the dev harness (probing / debugging)
      start() { if (disposed) return; if (still) stage.renderOnce(); else stage.start(); },
      stop() { stage.stop(); },
      // Freeze the animation at time t (seconds); null resumes live time.
      setTime(t) { frozen = t === null || t === undefined ? null : +t; if (!stage.running) stage.renderOnce(); },
      // Warm night (true) or golden day; crossfades over ~0.8 s unless instant.
      setNight,
      get night() { return nightK >= 0.5; },
      // "Enter the forest" flight; resolves once the frame is fully white (then holds). No-op under reduced motion.
      enter,
      resetEnter,
      dispose() {
        if (disposed) return;
        disposed = true;
        disposeParts();
      },
    };
  } catch (err) {
    disposeParts();
    throw err;
  }
}
