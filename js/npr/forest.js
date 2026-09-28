// Home hero: "the golden stag of Niflheimr" — a misty NPR forest with a glowing-antlered stag.
// mountForest(container, { quality, reducedMotion, accent })
//   -> Promise<{ start, stop, dispose, setTime, enter, resetEnter, stage }>
import * as THREE from 'three';
import { createStage, createPointer, isMobileLike } from './core.js';
import { createAtmosphere } from './forest-atmos.js';
import { createWoods } from './forest-woods.js';
import { createStag } from './forest-deer.js';
import { createFx } from './forest-fx.js';

const DEG = Math.PI / 180;
const REST_TIME = 6.5;      // pose shown under reduced motion
const TIME_OFFSET = 3;      // start the idle cycle at a pleasant pose
const STAG_YAW = -2.8;      // body nearly side-on (walking toward the camera's left), head turned to us
const ENTER_S = 1.35;       // "enter the forest" flight (seconds)
const SWAY = { x: 0.35, y: 0.12 }; // mouse parallax: camera sway (m) at the pointer's extremes
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

export async function mountForest(container, { quality, reducedMotion, accent = '#f5c46a' } = {}) {
  const q = quality === 'high' || quality === 'low' ? quality : (isMobileLike() ? 'low' : 'high');
  const stage = createStage(container, {
    quality: q,
    reducedMotion,
    maxPixelRatio: q === 'low' ? 1.25 : 1.5,
    clearColor: 0x0f2426,
    pipeline: {
      outline: { thickness: 1.8, color: 0x1b1624, opacity: 0.92, fadeStart: 9, fadeEnd: 24, colorBleed: 0.38,
        wobble: 0.8, depthThreshold: 0.035, normalThreshold: 0.32 },
      bloom: { strength: 1.2, radius: 0.8, threshold: 1.1, knee: 0.25 },
      paper: { strength: 0.13, scale: 1, tint: 0xfff4e2 },
      grade: { exposure: 1.0, contrast: 1.06, saturation: 1.05, tint: 0xfff4e6, lift: 0x061210 },
      vignette: { strength: 0.55, softness: 0.6, color: 0x0a1a1c },
    },
  });
  let pointer = null, atmos = null, woods = null, stag = null, fx = null;
  // The stage goes first: once its context is gone, freeing the scene's GL objects is a no-op, so there
  // are no stale-object warnings after a context loss / restore.
  const disposeParts = () => {
    stage.dispose();
    for (const part of [atmos, woods, stag, fx, pointer]) if (part) part.dispose();
    for (const el of container.querySelectorAll('.npr-veil')) el.remove();
  };

  try {
    const Q = stage.quality;
    const still = stage.reducedMotion;
    const gold = new THREE.Color(accent);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 220);

    atmos = createAtmosphere({ accent: gold, quality: Q });
    woods = createWoods({ atmos, quality: Q, accent: gold });
    stag = createStag({ accent: gold, fog: atmos.fog });
    stag.root.position.set(0.25, woods.groundHeight(0.25, -0.3), -0.3);
    stag.root.rotation.y = STAG_YAW;
    fx = createFx({ accent: gold, quality: Q, stag, groundHeight: woods.groundHeight, fog: atmos.fog });
    scene.add(atmos.sky, woods.group, stag.root, atmos.rays, fx.group);

    /* lights: flat teal ambient (painted in the shade colour), golden backlight, teal front fill, antler glow */
    const ambient = new THREE.AmbientLight(0x6f9a98, 0.75);
    const key = new THREE.DirectionalLight(0xffd79a, 2.6);
    key.position.set(-3, 4.6, -11);
    const fill = new THREE.DirectionalLight(0x8fbcc4, 1.0);
    fill.position.set(-6, 3, 9);
    // soft falloff from the crown: warms the head, back and ground without blowing out the ears
    const glow = new THREE.PointLight(gold.clone().lerp(new THREE.Color(0xffb347), 0.3), 3.5, 7, 0.5);
    scene.add(ambient, key, key.target, fill, fill.target, glow);

    /* camera + composition */
    const camBase = new THREE.Vector3(0.5, 1.45, 6.9);
    const lookAt = new THREE.Vector3(0.15, 1.8, -0.3);
    const stagCentre = new THREE.Vector3(0.2, 1.42, -0.3);
    const _v = new THREE.Vector3(), _d = new THREE.Vector3(), _f = new THREE.Vector3();
    const glowDir = new THREE.Vector3(0, 0.2, -1);
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
      fx.setSize(w, h, camera, camPos.distanceTo(lookAt), SWAY.x);

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

      // haze glow behind the antlers (beside them on portrait, so the crown is not gold on gold)
      stag.update(TIME_OFFSET);
      stag.root.updateMatrixWorld(true);
      const glowTarget = stag.glowAnchor.getWorldPosition(new THREE.Vector3());
      glowTarget.y += portrait ? 1.6 : 0.9;
      if (portrait) glowTarget.x -= 1.2;
      glowTarget.addScaledVector(_d.subVectors(glowTarget, camPos).normalize(), 25);
      atmos.setGlowFrom(camPos, glowTarget);
      // the swirling motes circle a point inside that glow, a few metres behind the stag
      fx.setGlowCentre(_f.copy(camPos).addScaledVector(glowDir.subVectors(glowTarget, camPos).normalize(), 12));

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
    };
    stage.onResize(layout);

    /* animation */
    pointer = createPointer(window, { smoothing: 2 });
    let frozen = null;
    let disposed = false;
    const antlerBase = stag.antlerMat.emissiveIntensity;
    const glowBase = glow.intensity;

    const pose = (t, dt) => {
      stag.update(t);
      const pulse = 1 + 0.1 * Math.sin(t * 1.3) + 0.04 * Math.sin(t * 3.1 + 1);
      stag.antlerMat.emissiveIntensity = antlerBase * pulse;
      stag.lightAnchor.getWorldPosition(glow.position);
      glow.intensity = glowBase * pulse;
      // the golden haze, halo and rays breathe with the antlers (a touch behind them), over a slower swell
      const breath = 0.8 * Math.sin(t * 1.3 - 0.4) + 0.2 * Math.sin(t * 0.41);
      // mouse parallax (a few degrees) + very slow, tiny camera breathing
      let px = 0, py = 0;
      if (!still && frozen === null) { pointer.update(dt); px = pointer.x; py = pointer.y; }
      camera.position.set(camPos.x + px * SWAY.x + Math.sin(t * 0.21) * 0.015, camPos.y + py * SWAY.y + Math.sin(t * 0.33) * 0.01, camPos.z);
      camera.lookAt(lookAt);
      if (flight) fly();
      atmos.update(t, camera, breath);
      woods.update(t);
      fx.update(t, camera, pixelScale * stage.pixelRatio, breath);
    };

    /* "enter the forest": the camera flies up over the stag toward the golden light (ease-in), the lens
       widens, the light blooms and floods everything, then a warm-white veil (DOM, over the canvas) takes
       the frame to the page's white. The route rises over the antlers and runs along the clear lane behind
       the stag (trunks stay >= 0.8 m away, the antlers >= 0.45 m below; checked for 390x844 ... 2560x1080). */
    const params = stage.pipeline.params;
    const look0 = { exposure: params.grade.exposure, bloom: params.bloom.strength, threshold: params.bloom.threshold,
      vignette: params.vignette.strength, ink: params.outline.opacity };
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
      params.grade.exposure = look0.exposure * (1 + 1.1 * p * p);
      params.bloom.strength = look0.bloom + 1.6 * p * p;
      params.bloom.threshold = look0.threshold - 0.45 * p;
      params.vignette.strength = look0.vignette * (1 - p);
      params.outline.opacity = look0.ink * (1 - smooth(0.25, 0.8, p));
      atmos.setEnter(Math.pow(smooth(0.05, 1, p), 1.5), smooth(0.5, 1, p));
      fx.setBokeh(1 - smooth(0, 0.3, p));
      // the veil is centred on the light
      _v.copy(_far).project(camera);
      veil.style.setProperty('--lx', ((_v.x + 1) * 50).toFixed(1) + '%');
      veil.style.setProperty('--ly', ((1 - _v.y) * 50).toFixed(1) + '%');
      veil.style.setProperty('--warm', smooth(0.45, 0.88, p).toFixed(3));
      veil.style.setProperty('--white', smooth(0.72, 1, p).toFixed(3));
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
      params.grade.exposure = look0.exposure;
      params.bloom.strength = look0.bloom;
      params.bloom.threshold = look0.threshold;
      params.vignette.strength = look0.vignette;
      params.outline.opacity = look0.ink;
      atmos.setEnter(0, 0);
      fx.setBokeh(1);
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
      const time = frozen !== null ? frozen : still ? REST_TIME : t + TIME_OFFSET;
      pose(time, dt);
    });

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
