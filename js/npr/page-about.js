// About page banner, "the maker's desk": the blog's robot mascot on a floating desk, surrounded by props
// for the interests listed on the page (camera, keyboard + notes, game controller, Utah teapot under a
// render lamp, sketchbook, books + mortarboard). Hover a prop for its label. See CONTRACT-pages.md.
// Night mode (CONTRACT-night.md): setNight() crossfades to a warm night lit by the desk lamp.
import * as THREE from 'three';
import { createStage, createPointer, seededRandom } from './core.js';
import {
  C, DESK_T, PROPS, buildDesk, buildRobot, buildNotes, buildMotes, vcMaterial, plankTexture, sketchTexture, blobTexture,
} from './page-about-props.js';

const DEG = Math.PI / 180;
const RX = 3.3, RZ = 1.55;     // desk radii on wide screens
const FLOAT = 0.95;            // gap between the desk bottom and its shadow on the paper
const NOTES = 4;
const MOTES = 34;
const FADE_MS = 800;       // day <-> night crossfade
const PROP_SCALE = 1.2;  // props read a little larger than life next to the robot (x1.15 on wide bands)
const HEAD_YAW = 25 * DEG; // beyond this the ring eyes turn to slivers; the pupils carry the rest of the gaze
const noRaycast = () => {};
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const isNight = () => document.documentElement.dataset.theme === 'night';

// Day/night look: every value that changes at night is registered once (its current value is the day one)
// and apply(n) writes the blend for n = 0 (day) .. 1 (night). Colours blend in place (linear space).
function createLook() {
  const items = [];
  return {
    color(c, night) { items.push({ c, a: c.clone(), b: new THREE.Color(night) }); return c; },
    num(o, k, night) { items.push({ o, k, a: o[k], b: night }); },
    apply(n) {
      for (const it of items) {
        if (it.c) it.c.copy(it.a).lerp(it.b, n);
        else it.o[it.k] = it.a + (it.b - it.a) * n;
      }
    },
  };
}

// Screen-constant accent rim from an inflated back-face hull (welded normals), as in the menu room.
const HULL_VERT = /* glsl */`
uniform float uWidth;
uniform float uPx;
void main() {
  vec4 mv = modelViewMatrix * vec4( position, 1.0 );
  vec3 n = normalize( normalMatrix * normal );
  mv.xyz += n * uWidth * uPx * max( - mv.z, 0.1 );
  gl_Position = projectionMatrix * mv;
}`;
const HULL_FRAG = /* glsl */`
uniform vec3 uColor;
void main() { gl_FragColor = vec4( uColor, 1.0 ); }`;

function weld(geo) {
  const P = geo.attributes.position, I = geo.index;
  const keys = new Map(), pos = [], index = [];
  const count = I ? I.count : P.count;
  for (let i = 0; i < count; i++) {
    const v = I ? I.getX(i) : i;
    const x = P.getX(v), y = P.getY(v), z = P.getZ(v);
    const k = `${Math.round(x * 400)},${Math.round(y * 400)},${Math.round(z * 400)}`;
    let id = keys.get(k);
    if (id === undefined) { id = pos.length / 3; keys.set(k, id); pos.push(x, y, z); }
    index.push(id);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

// The page's own lines (paragraphs and list items without their nested lists).
function readLines(root) {
  const content = root && (root.querySelector('.content') || root);
  const out = [];
  if (!content) return out;
  for (const el of content.querySelectorAll('p, li')) {
    let s = '';
    for (const n of el.childNodes) {
      if (n.nodeType === 3 || (n.nodeType === 1 && !/^(UL|OL|P)$/.test(n.tagName))) s += n.textContent;
    }
    s = s.replace(/\s+/g, ' ').trim();
    if (s && s.length <= 60) out.push(s);
  }
  return out;
}

export async function mountPageScene(container, { root, quality, reducedMotion, accent = '#f5c46a', night = isNight() } = {}) {
  const stage = createStage(container, {
    clearColor: C.paper,
    quality: quality || 'auto',
    reducedMotion,
    maxPixelRatio: 1.5,
    pipeline: {
      outline: { thickness: 1.7, color: 0x3a2618, opacity: 0.92, colorBleed: 0.3, wobble: 0.6, depthThreshold: 0.03, normalThreshold: 0.32 },
      bloom: { strength: 0.6, radius: 0.7, threshold: 1.0 },
      paper: { strength: 0.14, tint: 0xfff4e2 },
      grade: { exposure: 1.0, saturation: 1.02, tint: 0xfffaf2 },
      vignette: { strength: 0.55, softness: 0.7, color: 0xffffff }, // corners melt toward the white page
    },
  });
  const still = stage.reducedMotion;
  const low = stage.quality === 'low';
  const renderer = stage.renderer;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const rand = seededRandom('niflheimr-about');
  const accentCol = new THREE.Color(accent);
  const uniforms = { time: { value: 0 }, pxScale: { value: 800 } };
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(26, 1, 0.5, 200);
  const owned = new Set(); // materials + textures to dispose
  const track = (x) => { owned.add(x); return x; };
  const textures = { planks: track(plankTexture(rand)), sketch: track(sketchTexture(rand)), blob: track(blobTexture()) };
  const ctx = { rand, uniforms, textures, track, mat: null };

  // --- lights: warm key from the front-left (the only shadow caster), cool fill, sky/ground
  const key = new THREE.DirectionalLight(0xffe2b8, 2.5);
  key.position.set(-3.2, 7, 4.5);
  key.castShadow = true;
  key.shadow.mapSize.set(low ? 1024 : 2048, low ? 1024 : 2048);
  Object.assign(key.shadow.camera, { left: -4.2, right: 4.2, top: 4, bottom: -4, near: 1, far: 20 });
  key.shadow.bias = -0.0006;
  key.shadow.normalBias = 0.02;
  const fill = new THREE.DirectionalLight(0xe4ecff, 0.6);
  fill.position.set(4, 3, 2);
  const hemi = new THREE.HemisphereLight(0xfff0da, 0x9a7a62, 1.25);
  // the desk lamp's glow over the whole desk (off by day; placed at the lamp's bulb by layout())
  const lampGlow = new THREE.PointLight(0xffb35c, 0, 10, 1.5);
  scene.add(key, key.target, fill, hemi, lampGlow);

  // --- the floating world (bobs gently) and its shadow on the paper
  const world = new THREE.Group();
  scene.add(world);
  const desk = buildDesk(ctx);
  world.add(desk);
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), track(new THREE.MeshBasicMaterial({
    map: textures.blob, color: 0x9a8468, transparent: true, opacity: 0.42, depthWrite: false, fog: false,
  })));
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = -DESK_T - FLOAT;
  shadow.renderOrder = -1;
  scene.add(shadow);

  // --- interactive things: the robot (index 0) and the props the page talks about
  const lines = readLines(root);
  let found = PROPS.map((p) => {
    const hits = lines.filter((s) => p.match.test(s) && s.toLowerCase() !== p.title.toLowerCase());
    const any = lines.some((s) => p.match.test(s));
    return any ? { ...p, sub: hits.sort((a, b) => b.length - a.length)[0] || '' } : null;
  }).filter(Boolean);
  if (!found.length) found = PROPS.map((p) => ({ ...p, sub: '' })); // page rewritten: keep the desk dressed

  const hullPx = { value: 0.001 };
  const proxyMat = track(new THREE.MeshBasicMaterial());
  const box = new THREE.Box3();
  function makeEntry(i, spec, buildFn) {
    const rootG = new THREE.Group(), anim = new THREE.Group(), content = new THREE.Group();
    rootG.add(anim); anim.add(content);
    const mats = [];
    ctx.mat = (extra) => { const m = track(vcMaterial(extra)); mats.push(m); return m; };
    const built = buildFn(content, ctx);
    for (const m of mats) { m.rimColor = accentCol; m.rimPower = 2.5; }
    const hullMat = track(new THREE.ShaderMaterial({
      vertexShader: HULL_VERT, fragmentShader: HULL_FRAG, side: THREE.BackSide,
      uniforms: { uWidth: { value: 0 }, uPx: hullPx, uColor: { value: accentCol.clone() } },
    }));
    const hulls = [];
    const meshes = [];
    content.traverse((o) => { if (o.isMesh && !o.isInstancedMesh && !o.userData.noHull) meshes.push(o); });
    for (const m of meshes) {
      const h = new THREE.Mesh(weld(m.geometry), hullMat);
      h.raycast = noRaycast; h.userData.noHull = true; h.visible = false;
      m.add(h); hulls.push(h);
    }
    content.updateMatrixWorld(true);
    box.makeEmpty();
    for (const m of meshes) { m.geometry.computeBoundingBox(); box.union(m.geometry.boundingBox.clone().applyMatrix4(m.matrixWorld)); }
    const size = box.getSize(new THREE.Vector3()).addScalar(0.12);
    const proxy = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), proxyMat);
    box.getCenter(proxy.position);
    proxy.visible = false;
    proxy.userData.index = i;
    proxy.userData.proxy = true;
    content.add(proxy);
    world.add(rootG);
    return {
      i, spec, built, root: rootG, anim, content, mats, hullMat, hulls, proxy, anchor: built.anchor,
      h: 0, lift: 0, liftV: 0, wobT: 9, squashT: 9, notes: null,
    };
  }
  const bot = buildRobot(ctx);
  const entries = [makeEntry(0, { key: 'robot', title: 'Hi!', sub: '' }, (content) => {
    content.add(bot.root);
    return { anchor: bot.anchor };
  })];
  entries[0].mats.push(bot.mat);
  bot.mat.rimColor = accentCol; bot.mat.rimPower = 2.5;
  found.forEach((p, k) => {
    const e = makeEntry(k + 1, p, p.build);
    e.root.rotation.y = p.at[2];
    if (p.notes) {
      e.notes = buildNotes(ctx, NOTES);
      e.root.add(e.notes);
    }
    entries.push(e);
  });
  const renderEntry = entries.find((e) => e.spec.key === 'render');
  const musicEntry = entries.find((e) => e.notes);
  const motes = buildMotes(ctx, MOTES);
  motes.visible = false;
  world.add(motes);

  /* --------------------------------------------------------------------------------------------
   * Night: the desk lamp becomes the key light (warm, from the right), a faint cool moon rim from
   * behind, plum/umber ambient; the robot's eyes, the notes and drifting sparkles glow warm.
   * ------------------------------------------------------------------------------------------ */
  const P = stage.pipeline.params;
  const clear = new THREE.Color(C.paper);
  for (const [o, k] of [[P.outline, 'color'], [P.grade, 'tint'], [P.grade, 'lift'], [P.vignette, 'color']]) o[k] = new THREE.Color(o[k]);
  const look = createLook();
  const bgLook = createLook(); // the paper / page colours lead the fade, to follow the page's own switch
  bgLook.color(clear, 0x2a1f1d);
  look.color(P.outline.color, 0x150d0b);
  look.num(P.outline, 'colorBleed', 0.4);
  look.num(P.bloom, 'strength', 0.95);
  look.num(P.grade, 'saturation', 1.08);
  look.color(P.grade.tint, 0xfff0e2);
  look.color(P.grade.lift, 0x0c0708);
  look.num(P.paper, 'strength', 0.12);
  bgLook.color(P.vignette.color, 0x1c1714); // the dark page
  look.num(P.vignette, 'strength', 0.62);
  look.color(key.color, 0xffb35c);
  look.num(key, 'intensity', 0.5);
  const keyDay = key.position.clone(), keyNight = new THREE.Vector3(3.6, 5.6, 1.6);
  look.color(fill.color, 0xb9c4ff);
  look.num(fill, 'intensity', 0.4);
  const fillDay = fill.position.clone(), fillNight = new THREE.Vector3(-3, 3.5, -4);
  look.color(hemi.color, 0x6a4a52);
  look.color(hemi.groundColor, 0x2e2020);
  look.num(hemi, 'intensity', 0.85);
  look.num(lampGlow, 'intensity', 11);
  look.color(shadow.material.color, 0x0c0808);
  look.num(shadow.material, 'opacity', 0.6);
  look.color(bot.eyeMat.emissive, new THREE.Color(0xffc27a).multiplyScalar(0.9));
  if (musicEntry) look.color(musicEntry.notes.material.emissive, new THREE.Color(0xffb35c).multiplyScalar(1.5));
  const lamp = { base: 5 };
  look.num(lamp, 'base', 9);
  if (renderEntry) {
    look.color(renderEntry.built.bulb.material.color, new THREE.Color(0xffd08a).multiplyScalar(4.6));
    look.color(renderEntry.built.cone.material.uniforms.uColor.value, new THREE.Color(0xffc27a).multiplyScalar(0.6));
  }
  look.num(motes.material.uniforms.uAlpha, 'value', 1);
  const nightFx = { n: 0, nb: 0, from: 0, fromB: 0, to: night ? 1 : 0, t0: 0 };
  function applyNight(n, nb = n) {
    nightFx.n = n; nightFx.nb = nb;
    look.apply(n);
    bgLook.apply(nb);
    renderer.setClearColor(clear, 1);
    key.position.lerpVectors(keyDay, keyNight, n);
    fill.position.lerpVectors(fillDay, fillNight, n);
    motes.visible = n > 0.005;
  }
  applyNight(nightFx.to);

  /* --------------------------------------------------------------------------------------------
   * Layout: wide bands spread the props along an oval desk; narrow ones squeeze x and deepen z.
   * The camera is fitted so the whole diorama sits inside the band with calm margins.
   * ------------------------------------------------------------------------------------------ */
  const fit = { w: 1, h: 1, dist: 14, az: 0, el: 24 * DEG, k: 0 };
  const target = new THREE.Vector3(0, 0.4, 0);
  const pts = [];
  const tmp = new THREE.Vector3(), dir = new THREE.Vector3();
  function placeCamera(az, el, dist) {
    dir.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
    camera.position.copy(target).addScaledVector(dir, dist);
    camera.lookAt(target);
    camera.updateMatrixWorld();
  }
  function layout(w, h) {
    const aspect = w / h;
    const k = clamp01((2.1 - aspect) / 0.9);
    const wide = clamp01((aspect - 2.1) / 1.4); // 1440x414-ish bands: longer desk, bigger props
    fit.w = w; fit.h = h; fit.k = k;
    const sx = (1 - 0.36 * k) * (1 + 0.18 * wide), sz = 1 + 0.3 * k;
    const ps = PROP_SCALE * (1 + 0.15 * wide);
    entries[0].root.scale.setScalar(1 + 0.1 * wide);
    desk.scale.set(RX * sx, 1, RZ * sz);
    shadow.scale.set(RX * sx * 1.25, RZ * sz * 1.4, 1);
    for (const e of entries) {
      if (e.i === 0) continue;
      const [ax, az] = e.spec.at, n = e.spec.atNarrow || [ax * sx, az * sz];
      e.root.position.set(ax * sx + (n[0] - ax * sx) * k, 0, az * sz + (n[1] - az * sz) * k);
      e.root.scale.setScalar(ps);
    }
    world.updateMatrixWorld(true);
    // points to keep in view: desk rim (top + bottom), every object's box, rising notes
    pts.length = 0;
    for (let a = 0; a < 24; a++) {
      const c = Math.cos(a / 24 * Math.PI * 2) * RX * sx, s = Math.sin(a / 24 * Math.PI * 2) * RZ * sz;
      pts.push(new THREE.Vector3(c, 0, s), new THREE.Vector3(c, -DESK_T - 0.05, s));
    }
    for (const e of entries) {
      const b = e.proxy.geometry.parameters;
      for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) {
        pts.push(e.proxy.localToWorld(new THREE.Vector3(x * b.width / 2, y * b.height / 2, z * b.depth / 2)));
      }
    }
    if (musicEntry) pts.push(musicEntry.root.localToWorld(new THREE.Vector3(0, 1.25, 0)));
    motes.scale.set(RX * sx, 1, RZ * sz);
    if (renderEntry) renderEntry.built.bulb.getWorldPosition(lampGlow.position).y += 0.25;
    else lampGlow.position.set(RX * sx * 0.7, 1.6, -0.4);
    fit.el = (22 + 9 * k - 3 * wide) * DEG;
    fit.az = -4 * DEG;
    camera.fov = 24 + 6 * k;
    camera.aspect = aspect;
    camera.clearViewOffset();
    const mobile = w < 780;
    const top = h * (mobile ? 0.08 : 0.1 - 0.03 * wide), bottom = h * (mobile ? 0.06 : 0.1 - 0.03 * wide);
    const side = Math.max(16, w * 0.05);
    const rw = w - side * 2, rh = Math.max(60, h - top - bottom);
    let dist = 14, minX = 0, maxX = 0, minY = 0, maxY = 0;
    for (let it = 0; it < 6; it++) {
      placeCamera(fit.az, fit.el, dist);
      camera.updateProjectionMatrix();
      minX = minY = Infinity; maxX = maxY = -Infinity;
      for (const p of pts) {
        tmp.copy(p).project(camera);
        minX = Math.min(minX, tmp.x); maxX = Math.max(maxX, tmp.x);
        minY = Math.min(minY, tmp.y); maxY = Math.max(maxY, tmp.y);
      }
      const s = Math.max(((maxX - minX) * w / 2) / rw, ((maxY - minY) * h / 2) / rh);
      dist *= 0.35 + 0.65 * s;
    }
    fit.dist = dist;
    const cx = ((minX + maxX) / 2 + 1) / 2 * w, cy = (1 - (minY + maxY) / 2) / 2 * h;
    camera.setViewOffset(w, h, cx - w / 2, cy - (top + rh / 2), w, h);
    const O = stage.pipeline.params.outline;
    O.fadeStart = dist + 20; O.fadeEnd = dist + 50;
    hullPx.value = 2 * Math.tan(camera.fov * DEG / 2) / h;
    uniforms.pxScale.value = h * stage.pixelRatio / (2 * Math.tan(camera.fov * DEG / 2));
  }

  /* --------------------------------------------------------------------------------------------
   * Label: one small DOM tag inside the band (pointer-events: none), above the hovered object.
   * ------------------------------------------------------------------------------------------ */
  const tip = document.createElement('div');
  tip.className = 'npr-about-tip';
  const tipTitle = document.createElement('b');
  const tipSub = document.createElement('span');
  tip.append(tipTitle, tipSub);
  container.appendChild(tip);
  let tipFor = null, tipShown = false;
  function updateTip() {
    const e = activeEntry();
    if (e && e !== tipFor) {
      tipFor = e;
      tipTitle.textContent = e.spec.title;
      tipSub.textContent = e.spec.sub || '';
      tipSub.hidden = !e.spec.sub;
    }
    if (!!e !== tipShown) { tipShown = !!e; tip.classList.toggle('npr-on', tipShown); }
    if (!tipFor) return;
    tmp.copy(tipFor.anchor);
    tipFor.content.localToWorld(tmp).project(camera);
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    const x = Math.min(Math.max((tmp.x + 1) / 2 * fit.w, tw / 2 + 8), fit.w - tw / 2 - 8);
    const y = Math.min(Math.max((1 - tmp.y) / 2 * fit.h - 12, th + 6), fit.h - 6);
    tip.style.transform = `translate(${Math.round(x - tw / 2)}px, ${Math.round(y - th)}px)`;
  }

  /* --------------------------------------------------------------------------------------------
   * Interaction: hover highlights + labels; click/tap squashes the prop and the robot looks / waves.
   * ------------------------------------------------------------------------------------------ */
  let hover = null, tap = null, tapUntil = 0, disposed = false, pressed = null;
  let pickX = 0, pickY = 0, pickDirty = false;
  const activeEntry = () => (hover !== null ? entries[hover] : tap !== null ? entries[tap] : null);
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const proxies = entries.map((e) => e.proxy);
  const hits = [], precise = [];
  const refresh = () => { if (!stage.running && !disposed) stage.renderOnce(); };
  function pick(x, y) {
    const r = container.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    ndc.set(((x - r.left) / r.width) * 2 - 1, 1 - ((y - r.top) / r.height) * 2);
    ray.setFromCamera(ndc, camera);
    hits.length = 0;
    ray.intersectObjects(proxies, false, hits);
    if (!hits.length) return null;
    let best = null, bestD = Infinity;
    for (const hit of hits) {
      const e = entries[hit.object.userData.index];
      precise.length = 0;
      ray.intersectObject(e.content, true, precise);
      for (const p of precise) {
        if (p.object.userData.proxy) continue;
        if (p.distance < bestD) { bestD = p.distance; best = e.i; }
        break;
      }
    }
    return best !== null ? best : hits[0].object.userData.index;
  }
  function setHover(i) {
    if (i === hover) return;
    hover = i;
    container.style.cursor = i !== null ? 'pointer' : '';
  }
  const B = { yaw: 0, pitch: 0, blinkIn: 1.5 + rand() * 2, blink: -1, wave: -1, waveIn: 3.5, lookUntil: 0, lookAt: null };
  function poke(i) {
    const e = entries[i];
    if (!e) return;
    e.squashT = 0;
    if (i === 0) B.wave = 0; else { B.lookAt = e; B.lookUntil = stage.time + 2.2; }
    refresh();
  }
  const onMove = (ev) => {
    if (ev.pointerType === 'touch') return;
    pickX = ev.clientX; pickY = ev.clientY; pickDirty = true;
    if (!stage.running) {
      const was = hover;
      setHover(pick(pickX, pickY));
      if (hover !== was) refresh();
    }
  };
  const onLeave = () => {
    pickDirty = false;
    if (hover === null) return;
    setHover(null);
    refresh();
  };
  const onDown = (ev) => { pressed = { x: ev.clientX, y: ev.clientY, t: performance.now() }; };
  const onUp = (ev) => {
    if (!pressed || (ev.button !== undefined && ev.button > 0)) return;
    const moved = Math.hypot(ev.clientX - pressed.x, ev.clientY - pressed.y);
    const quick = performance.now() - pressed.t < 800;
    pressed = null;
    if (moved > 10 || !quick) return;
    const i = pick(ev.clientX, ev.clientY);
    if (i === null) { if (tap !== null) { tap = null; refresh(); } return; }
    if (ev.pointerType === 'touch') { tap = i; tapUntil = performance.now() + 2000; }
    poke(i);
  };
  container.addEventListener('pointermove', onMove);
  container.addEventListener('pointerleave', onLeave);
  container.addEventListener('pointerdown', onDown);
  container.addEventListener('pointerup', onUp);
  const pointer = createPointer(window, { smoothing: 2.5 });

  /* --------------------------------------------------------------------------------------------
   * Frame update
   * ------------------------------------------------------------------------------------------ */
  const nm = new THREE.Matrix4(), nq = new THREE.Quaternion(), ne = new THREE.Euler(), ns = new THREE.Vector3(), np = new THREE.Vector3();
  const headW = new THREE.Vector3();
  function updateRobot(dt, T) {
    const k = still ? 1 : 1 - Math.exp(-dt * 6);
    bot.body.position.y = still ? 0 : Math.sin(T * 2.2) * 0.018;
    bot.body.rotation.z = still ? 0 : Math.sin(T * 1.1) * 0.025;
    // look: at a hovered / poked prop, otherwise toward the cursor
    let yawT, pitchT;
    const look = hover !== null && hover !== 0 ? entries[hover] : T < B.lookUntil ? B.lookAt : null;
    if (look) {
      bot.head.getWorldPosition(headW);
      look.root.getWorldPosition(tmp);
      tmp.sub(headW);
      tmp.y += 0.25;
      yawT = Math.max(-1.2, Math.min(1.2, Math.atan2(tmp.x, tmp.z)));
      pitchT = Math.max(-0.2, Math.min(0.25, Math.atan2(-tmp.y, Math.hypot(tmp.x, tmp.z))));
    } else {
      yawT = still ? 0.12 : pointer.x * 0.6;
      pitchT = still ? 0.06 : -pointer.y * 0.22 + 0.04;
    }
    B.yaw += (yawT - B.yaw) * k;
    B.pitch += (pitchT - B.pitch) * k;
    const headYaw = Math.max(-HEAD_YAW, Math.min(HEAD_YAW, B.yaw));
    bot.head.rotation.set(B.pitch, headYaw, still ? 0 : Math.sin(T * 0.9) * 0.04);
    bot.pupils.position.set(Math.max(-0.034, Math.min(0.034, B.yaw * 0.045)), -B.pitch * 0.05, 0);
    // blink
    if (!still) {
      B.blinkIn -= dt;
      if (B.blinkIn <= 0) { B.blink = 0; B.blinkIn = 2.4 + rand() * 3.2; }
      if (B.blink >= 0) {
        B.blink += dt / 0.16;
        if (B.blink >= 1) B.blink = -1;
      }
    }
    bot.eyes.scale.y = B.blink >= 0 ? Math.max(0.1, 1 - Math.sin(Math.PI * B.blink)) : 1;
    // wave now and then (and when greeted)
    if (!still) {
      B.waveIn -= dt;
      if (B.waveIn <= 0 && B.wave < 0) { B.wave = 0; B.waveIn = 9 + rand() * 6; }
      if (hover === 0 && B.wave < 0) B.wave = 0;
    }
    let raise = 0, wig = 0;
    if (B.wave >= 0) {
      B.wave += dt;
      raise = smooth(0, 0.3, B.wave) * (1 - smooth(1.5, 1.9, B.wave));
      wig = Math.sin(B.wave * 13) * 0.32 * raise;
      if (B.wave > 1.9) B.wave = -1;
    }
    bot.armR.rotation.z = 0.05 + raise * 2.35 + wig + (still ? 0 : Math.sin(T * 2.2 + 1) * 0.03);
    bot.armL.rotation.z = -0.05 - (still ? 0 : Math.sin(T * 2.2) * 0.03);
  }

  function updateEntries(dt, T) {
    const act = activeEntry();
    for (const e of entries) {
      const on = e === act;
      if (on && !e.was) e.wobT = 0;
      e.was = on;
      const t1 = on ? 1 : 0;
      e.h = still ? t1 : e.h + (t1 - e.h) * (1 - Math.exp(-dt * 12));
      if (still) { e.lift = t1; e.liftV = 0; } else {
        e.liftV += ((t1 - e.lift) * 170 - e.liftV * 15) * dt;
        e.lift += e.liftV * dt;
      }
      e.wobT += dt;
      const wob = still ? 0 : Math.exp(-e.wobT * 3.2) * Math.sin(e.wobT * 16) * 0.05 + (on ? Math.sin(T * 2.3 + e.i) * 0.012 : 0);
      let sq = 1, sxz = 1;
      if (e.squashT < 0.3) {
        e.squashT += still ? 0.3 : dt;
        const p = Math.sin(Math.PI * clamp01(e.squashT / 0.3));
        sq = 1 - 0.14 * p; sxz = 1 + 0.07 * p;
      }
      e.anim.position.y = e.lift * (e.i === 0 ? 0.06 : 0.12);
      e.anim.scale.set(sxz, sq, sxz);
      e.anim.rotation.set(wob * 0.6, 0, wob);
      const vis = e.h > 0.01;
      for (const h of e.hulls) h.visible = vis;
      e.hullMat.uniforms.uWidth.value = e.h * 3.2;
      for (const m of e.mats) {
        m.emissive.copy(accentCol).multiplyScalar(e.i === 0 ? 0 : e.h * 0.06); // the dark robot would turn muddy
        m.rimStrength = e.h * 0.25 + nightFx.n * 0.1; // a warm lamp-lit edge keeps shapes legible at night
      }
      if (e.built.update) e.built.update(T);
      if (e.notes) {
        for (let n = 0; n < NOTES; n++) {
          const p = (T * 0.16 + n / NOTES) % 1;
          const s = Math.pow(Math.sin(Math.PI * p), 0.6) * (0.85 + (n % 2) * 0.25);
          np.set(-0.36 + n * 0.24 + Math.sin(T * 0.8 + n * 1.7) * 0.07, 0.32 + p * 0.85 + e.lift * 0.12, -0.05 + Math.cos(T * 0.6 + n) * 0.05);
          ne.set(0, Math.sin(T * 0.5 + n) * 0.4, Math.sin(T * 1.2 + n * 2) * 0.28);
          nm.compose(np, nq.setFromEuler(ne), ns.setScalar(Math.max(0.001, s)));
          e.notes.setMatrixAt(n, nm);
        }
        e.notes.instanceMatrix.needsUpdate = true;
      }
    }
    if (renderEntry) {
      const pulse = still ? 1 : 0.94 + 0.06 * Math.sin(T * 1.3);
      renderEntry.built.light.intensity = lamp.base * pulse * (1 + renderEntry.h * 0.4);
    }
  }

  function update(dt, t) {
    const T = still ? 2.4 : t;
    if (nightFx.n !== nightFx.to) {
      const p = clamp01((performance.now() - nightFx.t0) / FADE_MS), q = Math.min(1, p * 2.5);
      const { from, fromB, to } = nightFx;
      applyNight(from + (to - from) * p * p * (3 - 2 * p), fromB + (to - fromB) * q * (2 - q));
    }
    uniforms.time.value = T;
    pointer.update(dt);
    if (tap !== null && performance.now() > tapUntil) tap = null;
    if (pickDirty) { pickDirty = false; setHover(pick(pickX, pickY)); }
    world.position.y = still ? 0 : Math.sin(T * 0.6) * 0.035;
    const px = still ? 0 : pointer.x, py = still ? 0 : pointer.y;
    placeCamera(fit.az + px * 3 * DEG, fit.el - py * 1.5 * DEG, fit.dist);
    updateRobot(dt, T);
    updateEntries(dt, T);
    updateTip();
  }

  stage.onResize(layout);
  stage.onUpdate(update);
  stage.setScene(scene, camera);
  layout(Math.max(1, stage.width), Math.max(1, stage.height));

  // compile everything (hulls included) before the first frame
  for (const e of entries) for (const h of e.hulls) h.visible = true;
  await stage.compile();
  for (const e of entries) for (const h of e.hulls) h.visible = false;
  stage.renderOnce();

  return {
    stage,
    // reduced motion: no loop — one frame now, more only on hover / tap / resize
    start() { if (disposed) return; if (still) stage.renderOnce(); else stage.start(); },
    stop() { stage.stop(); },
    // warm night look on / off: ~0.8 s crossfade while the loop runs, otherwise (or reduced motion) at once
    setNight(on, { instant = false } = {}) {
      if (disposed) return;
      Object.assign(nightFx, { from: nightFx.n, fromB: nightFx.nb, to: on ? 1 : 0, t0: performance.now() });
      if (instant || still || !stage.running) { applyNight(nightFx.to); refresh(); }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      stage.stop();
      container.removeEventListener('pointermove', onMove);
      container.removeEventListener('pointerleave', onLeave);
      container.removeEventListener('pointerdown', onDown);
      container.removeEventListener('pointerup', onUp);
      container.style.cursor = '';
      pointer.dispose();
      tip.remove();
      const seen = new Set();
      scene.traverse((o) => {
        if (o.geometry && !seen.has(o.geometry)) { seen.add(o.geometry); o.geometry.dispose(); }
        if (o.isInstancedMesh) o.dispose();
        if (o.isLight && o.shadow && o.shadow.map) o.shadow.map.dispose();
      });
      for (const x of owned) x.dispose();
      stage.dispose();
    },
  };
}
