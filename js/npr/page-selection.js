// Selection (/recommend/) banner — "the recommendation shelf": a sideboard with one prop per section of the
// page (games -> handheld console, music -> record player, books -> book stack, film -> retro TV), in page
// order. Hover highlights a prop and names its section; click / tap scrolls to that section's heading.
// mountPageScene(container, { root, quality, reducedMotion, accent, night }) — see CONTRACT-pages.md; night mode
// (CONTRACT-night.md): setNight() crossfades to a warm night lit by the table lamp, the TV and the turntable light.
import * as THREE from 'three';
import { createStage, createPointer, seededRandom } from './core.js';
import {
  C, PROPS, BODY, LEG, buildFurniture, mesh, buildLamp, buildPlant, vcMaterial,
  gameScreenTexture, tvScreenTexture, noteTexture, blobTexture,
} from './page-selection-props.js';

const DEG = Math.PI / 180;
const SLOT = 1.0;      // shelf width per prop
const END = 0.55;      // shelf width for the lamp / plant at each end
const DEPTH = 0.8;     // sideboard depth
const FLOOR = -0.06 - BODY - 0.05 - LEG;
const FADE_MS = 800;   // day <-> night crossfade
const LAMP_DAY = 1.4, LAMP_NIGHT = 6; // table lamp intensity (the night key light)

// Section kinds, matched against the page's headings (first match wins, each kind used once).
const KINDS = [
  { key: 'games', en: 'Games', re: /游戏|遊戲|game|steam/i },
  { key: 'music', en: 'Music', re: /音乐|音樂|music|album|song|歌/i },
  { key: 'books', en: 'Books', re: /书|書|book|novel|read/i },
  { key: 'film', en: 'Film & TV', re: /影|剧|劇|番|film|movie|cinema|tv|anime|video/i },
];

// Accent outline on hover: a back-face hull inflated by a constant number of screen pixels.
const HULL_VERT = /* glsl */`
uniform float uWidth;
uniform float uPx;
void main() {
  vec4 mv = modelViewMatrix * vec4( position, 1.0 );
  mv.xyz += normalize( normalMatrix * normal ) * uWidth * uPx * max( - mv.z, 0.1 );
  gl_Position = projectionMatrix * mv;
}`;
const HULL_FRAG = /* glsl */`
uniform vec3 uColor;
void main() { gl_FragColor = vec4( uColor, 1.0 ); }`;

// Welded copy of every mesh under `group` (group-local space) with smooth normals, for the hull.
function hullGeometry(group) {
  group.updateMatrixWorld(true);
  const inv = group.matrixWorld.clone().invert();
  const m = new THREE.Matrix4(), v = new THREE.Vector3();
  const keys = new Map(), pos = [], index = [];
  group.traverse((o) => {
    if (!o.isMesh || !o.geometry.attributes.position) return;
    const P = o.geometry.attributes.position, I = o.geometry.index;
    m.multiplyMatrices(inv, o.matrixWorld);
    const n = I ? I.count : P.count;
    for (let i = 0; i < n; i++) {
      v.fromBufferAttribute(P, I ? I.getX(i) : i).applyMatrix4(m);
      const k = Math.round(v.x * 400) + ',' + Math.round(v.y * 400) + ',' + Math.round(v.z * 400);
      let id = keys.get(k);
      if (id === undefined) { id = pos.length / 3; keys.set(k, id); pos.push(v.x, v.y, v.z); }
      index.push(id);
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
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

function readSections(root) {
  const used = new Set(), out = [];
  const heads = root.querySelectorAll('.content h2, .content h3, .content h4');
  for (const h of heads) {
    const text = (h.textContent || '').trim();
    const kind = KINDS.find((k) => !used.has(k.key) && k.re.test(text));
    if (!kind) continue;
    used.add(kind.key);
    // picks in this section: rating widgets or media cards between this heading and the next one
    let ratings = 0, cards = 0;
    for (let el = h.nextElementSibling; el && !/^H[1-4]$/.test(el.tagName); el = el.nextElementSibling) {
      ratings += el.matches('.rating') ? 1 : el.querySelectorAll('.rating').length;
      cards += el.matches('.media-card') ? 1 : el.querySelectorAll('.media-card').length;
    }
    const count = Math.max(ratings, cards);
    out.push({ ...kind, heading: h, title: text.replace(/[：:]\s*$/, ''), count });
  }
  return out;
}

export async function mountPageScene(container, opts = {}) {
  const { root = document, quality, reducedMotion, accent = '#f5c46a', night = isNight() } = opts;
  const sections = readSections(root);
  const stage = createStage(container, {
    clearColor: C.paper,
    quality: quality || 'auto',
    reducedMotion,
    maxPixelRatio: 1.5,
    pipeline: {
      outline: { thickness: 1.6, color: 0x3a2618, opacity: 0.92, colorBleed: 0.3, wobble: 0.5, depthThreshold: 0.03, normalThreshold: 0.32 },
      bloom: { strength: 0.5, radius: 0.7, threshold: 1.0 },
      paper: { strength: 0.12, tint: 0xfff4e2 },
      grade: { exposure: 1.0, saturation: 1.02, tint: 0xfffaf2 },
      vignette: { strength: 0.1, softness: 0.75, color: 0xe6dac5 },
    },
  });
  const still = stage.reducedMotion;
  const renderer = stage.renderer;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  let started = false, disposed = false, hover = -1;
  const accentCol = new THREE.Color(accent);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(24, 1, 0.5, 100);
  const uniforms = { time: { value: 0 }, pxScale: { value: 800 }, hullPx: { value: 0.001 } };
  const textures = { game: gameScreenTexture(), tv: tvScreenTexture(), note: noteTexture(), blob: blobTexture() };
  const ctx = { rand: seededRandom('niflheimr-selection'), uniforms, textures, glow: [], nightGlow: [], mat: null };

  // --- lights: warm key from the front-left (casts shadows on the shelf), soft fill, sky/ground, lamp
  const key = new THREE.DirectionalLight(0xffe2b8, 2.5);
  key.castShadow = true;
  key.shadow.mapSize.set(stage.quality === 'low' ? 1024 : 2048, stage.quality === 'low' ? 1024 : 2048);
  key.shadow.bias = -0.0005;
  key.shadow.normalBias = 0.02;
  const fill = new THREE.DirectionalLight(0xe8eeff, 0.7);
  fill.position.set(6, 3, 4);
  const hemi = new THREE.HemisphereLight(0xfff0da, 0x9a7a62, 1.25);
  const lampLight = new THREE.PointLight(0xffbe78, LAMP_DAY, 3, 1.2);
  scene.add(key, key.target, fill, hemi, lampLight);

  // --- props, one per section
  const pickMat = new THREE.MeshBasicMaterial();
  const entries = sections.map((s, i) => {
    const rootG = new THREE.Group(), anim = new THREE.Group();
    rootG.add(anim);
    const mats = [];
    ctx.mat = () => { const m = vcMaterial({ rimColor: accentCol, rimPower: 2.4, rimStrength: 0 }); mats.push(m); return m; };
    const glowFrom = ctx.glow.length;
    const spec = PROPS[s.key](anim, ctx);
    const [w, h, d] = spec.size;
    const proxy = new THREE.Mesh(new THREE.BoxGeometry(w, h + 0.1, d), pickMat);
    proxy.position.y = (h + 0.1) / 2;
    proxy.visible = false;
    proxy.userData.index = i;
    rootG.add(proxy);
    anim.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    const hull = new THREE.Mesh(hullGeometry(anim), new THREE.ShaderMaterial({
      vertexShader: HULL_VERT, fragmentShader: HULL_FRAG, side: THREE.BackSide,
      uniforms: { uWidth: { value: 0 }, uPx: uniforms.hullPx, uColor: { value: accentCol } },
    }));
    hull.visible = false;
    hull.raycast = () => {};
    anim.add(hull);
    scene.add(rootG);
    return {
      i, s, spec, root: rootG, anim, mats, proxy, hull, glows: ctx.glow.slice(glowFrom),
      h: 0, target: 0, bounce: 0, bounceV: 0, wob: 9, tag: null,
      anchor: new THREE.Vector3(), tagAnchor: new THREE.Vector3(),
    };
  });
  const proxies = entries.map((e) => e.proxy);

  const lamp = buildLamp(ctx);
  const plant = buildPlant(ctx);
  scene.add(lamp.group, plant.group);

  // soft contact shadow on the page under the sideboard
  const blob = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({
    map: textures.blob, color: 0x8a6f55, transparent: true, opacity: 0.45, depthWrite: false,
  }));
  blob.rotation.x = -Math.PI / 2;
  blob.position.y = FLOOR - 0.005;
  blob.renderOrder = -1;
  scene.add(blob);

  let furniture = null;
  const furnitureMat = vcMaterial();

  /* --------------------------------------------------------------------------------------------
   * Night: the table lamp becomes the key light, the screens glow and spill light, the turntable's
   * little target light comes on; faint cool moon rim from behind, plum/umber ambient.
   * ------------------------------------------------------------------------------------------ */
  const glowLights = [];
  for (const e of entries) {
    if (!e.spec.glowAt) continue;
    const l = new THREE.PointLight(e.spec.glowColor, 0, e.s.key === 'music' ? 0.9 : 2.6, 1.4);
    l.position.copy(e.spec.glowAt);
    e.anim.add(l);
    glowLights.push({ l, night: e.s.key === 'music' ? 0.6 : 2.4 });
  }
  const P = stage.pipeline.params;
  const clear = new THREE.Color(C.paper);
  for (const [o, k] of [[P.outline, 'color'], [P.grade, 'tint'], [P.grade, 'lift'], [P.vignette, 'color']]) o[k] = new THREE.Color(o[k]);
  const look = createLook();
  const bgLook = createLook(); // the paper / page colours lead the fade, to follow the page's own switch
  bgLook.color(clear, 0x2a1f1d);
  bgLook.color(P.vignette.color, 0x1c1714); // the dark page
  look.num(P.vignette, 'strength', 0.4);
  look.color(P.outline.color, 0x150d0b);
  look.num(P.outline, 'colorBleed', 0.4);
  look.num(P.bloom, 'strength', 0.9);
  look.num(P.grade, 'saturation', 1.08);
  look.color(P.grade.tint, 0xfff0e2);
  look.color(P.grade.lift, 0x0c0708);
  look.color(key.color, 0xffb35c);
  look.num(key, 'intensity', 0.2);
  look.color(fill.color, 0xb9c4ff);
  look.num(fill, 'intensity', 0.4);
  const fillDay = fill.position.clone(), fillNight = new THREE.Vector3(4, 4, -5);
  look.color(hemi.color, 0x6a4a52);
  look.color(hemi.groundColor, 0x2e2020);
  look.num(hemi, 'intensity', 0.6);
  look.num(lampLight, 'distance', 7);
  look.num(lampLight, 'decay', 1.7);
  look.num(lamp.shadeMat, 'emissiveIntensity', 0.9);
  look.color(lamp.bulb.material.emissive, 0xffd08a);
  look.num(lamp.bulb.material, 'emissiveIntensity', 6);
  look.color(furnitureMat.color, 0xc4b8b4); // the big cream / wood surfaces sit back in the dark
  look.color(blob.material.color, 0x0c0808);
  look.num(blob.material, 'opacity', 0.6);
  for (const g of glowLights) look.num(g.l, 'intensity', g.night);
  for (const g of ctx.nightGlow) look.color(g.mat.color, g.night);
  for (const e of entries) if (e.spec.noteColor) look.color(e.spec.noteColor, new THREE.Color(0xffc070).multiplyScalar(1.4));
  const nightFx = { n: 0, nb: 0, from: 0, fromB: 0, to: night ? 1 : 0, t0: 0, lamp: 1 };
  function applyNight(n, nb = n) {
    nightFx.n = n; nightFx.nb = nb;
    look.apply(n);
    lampLight.intensity = LAMP_DAY + (LAMP_NIGHT * nightFx.lamp - LAMP_DAY) * n;
    bgLook.apply(nb);
    renderer.setClearColor(clear, 1);
    fill.position.lerpVectors(fillDay, fillNight, n);
  }
  applyNight(nightFx.to);

  // --- DOM: a small name tag per prop (on the shelf edge) + a tooltip with the section heading
  const tip = document.createElement('div');
  tip.className = 'npr-sel-tip';
  container.appendChild(tip);
  for (const e of entries) {
    const t = document.createElement('span');
    t.className = 'npr-sel-tag';
    t.textContent = e.s.en;
    if (e.s.count) { const b = document.createElement('i'); b.textContent = e.s.count; t.appendChild(b); }
    container.appendChild(t);
    e.tag = t;
  }

  /* --------------------------------------------------------------------------------------------
   * Layout: one row on wide bands; a sideboard + hutch (two rows) on narrow / portrait ones.
   * ------------------------------------------------------------------------------------------ */
  const fit = { rows: 0, w: 1, h: 1, dist: 10, az: 0, el: 0, ox: 0, oy: 0, target: new THREE.Vector3(), corners: [] };
  const tmp = new THREE.Vector3(), dir = new THREE.Vector3();

  function arrange(rowsN) {
    const n = entries.length;
    const cols = rowsN > 1 ? Math.ceil(n / rowsN) : Math.max(n, 1);
    // two rows: the lamp stands at the left of the top shelf, the plant at the right of the bottom one
    const two = rowsN > 1;
    const W = Math.max(2.4, cols * SLOT + END * (two ? 1 : 2));
    // page order reads top row first; each row is as tall as its tallest prop
    const rowOf = (i) => (two ? rowsN - 1 - Math.floor(i / cols) : 0);
    const rowH = [two ? 0.62 : 0.66, 0.66]; // plant / lamp
    entries.forEach((e, i) => { const r = rowOf(i); rowH[r] = Math.max(rowH[r], e.spec.size[1]); });
    const rows = [{ y: 0 }];
    if (two) rows.push({ y: rowH[0] + 0.14 });
    const top = two ? rows[1].y + rowH[1] + 0.1 : rowH[0];
    entries.forEach((e, i) => {
      const r = rowOf(i);
      const inRow = two ? Math.min(cols, n - Math.floor(i / cols) * cols) : n;
      const c = two ? i % cols : i;
      const shift = two ? (r > 0 ? END / 2 : -END / 2) : 0;
      e.root.position.set((c - (inRow - 1) / 2) * SLOT + shift, rows[r].y, 0);
    });
    lamp.group.position.set(-W / 2 + END / 2, two ? rows[rowsN - 1].y : 0, -0.05);
    plant.group.position.set(W / 2 - END / 2, 0, -0.05);
    lampLight.position.set(lamp.group.position.x, lamp.group.position.y + 0.52, two ? 0.15 : 0);
    nightFx.lamp = two ? 0.35 : 1; // in the hutch the lamp stands close to the back panel
    applyNight(nightFx.n, nightFx.nb);
    if (furniture) { scene.remove(furniture); furniture.geometry.dispose(); }
    furniture = mesh(buildFurniture({ W, D: DEPTH, rows, top, doors: rowsN > 1 ? 2 : Math.max(2, cols) }), furnitureMat);
    scene.add(furniture);
    blob.scale.set(W + 1.2, DEPTH + 0.9, 1);

    fit.target.set(0, top * 0.4, 0);
    fit.corners = [];
    // the sideboard's lower half may run out through the band's soft bottom edge
    const bottom = two ? -0.34 : -0.42;
    for (const x of [-W / 2 - 0.06, W / 2 + 0.06]) for (const y of [bottom, top + (two ? 0.07 : 0)]) for (const z of [-DEPTH / 2, DEPTH / 2 + 0.05]) fit.corners.push(new THREE.Vector3(x, y, z));
    // key light + its shadow frustum follow the layout size
    const span = Math.max(W, top - FLOOR) / 2 + 0.6;
    key.target.position.copy(fit.target);
    key.position.copy(fit.target).add(tmp.set(-0.45, 0.8, 0.75).normalize().multiplyScalar(10));
    Object.assign(key.shadow.camera, { left: -span, right: span, top: span, bottom: -span, near: 2, far: 20 });
    key.shadow.camera.updateProjectionMatrix();
    for (const e of entries) {
      e.anchor.copy(e.spec.anchor);
      e.tagAnchor.set(0, -0.012, DEPTH / 2 + 0.04);
      if (e.root.position.y > 0) e.tagAnchor.set(0, -0.05, DEPTH / 2 - 0.1);
    }
    fit.rows = rowsN;
  }

  function placeCamera(az, el, dist) {
    dir.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
    camera.position.copy(fit.target).addScaledVector(dir, dist);
    camera.lookAt(fit.target);
    camera.updateMatrixWorld();
  }

  function layout(w, h) {
    if (!w || !h) return;
    const aspect = w / h;
    const rowsN = entries.length >= 3 && aspect < 1.9 ? 2 : 1;
    if (rowsN !== fit.rows) arrange(rowsN);
    fit.w = w; fit.h = h;
    fit.az = (rowsN > 1 ? -8 : -12) * DEG;
    fit.el = (rowsN > 1 ? 10 : 16) * DEG;
    camera.fov = aspect >= 1.2 ? 22 : 2 * Math.atan(Math.tan(11 * DEG) * 1.2 / aspect) / DEG;
    camera.aspect = aspect;
    camera.clearViewOffset();
    // free area: labels need a little room above, name tags below the props are inside the diorama
    const padT = rowsN > 1 ? 30 : 40, padB = 0, side = Math.max(16, w * 0.06);
    const rw = w - side * 2, rh = Math.max(60, h - padT - padB);
    let dist = 10, minX = 0, maxX = 0, minY = 0, maxY = 0;
    for (let k = 0; k < 6; k++) {
      placeCamera(fit.az, fit.el, dist);
      camera.updateProjectionMatrix();
      minX = minY = Infinity; maxX = maxY = -Infinity;
      for (const c of fit.corners) {
        tmp.copy(c).project(camera);
        minX = Math.min(minX, tmp.x); maxX = Math.max(maxX, tmp.x);
        minY = Math.min(minY, tmp.y); maxY = Math.max(maxY, tmp.y);
      }
      const s = Math.max(((maxX - minX) * w / 2) / rw, ((maxY - minY) * h / 2) / rh);
      dist *= 0.35 + 0.65 * s;
    }
    fit.dist = dist;
    fit.ox = ((minX + maxX) / 2 + 1) / 2 * w - w / 2;
    fit.oy = (1 - (minY + maxY) / 2) / 2 * h - (padT + rh / 2);
    camera.setViewOffset(w, h, fit.ox, fit.oy, w, h);
    camera.near = Math.max(0.5, dist - 8); camera.far = dist + 8;
    camera.updateProjectionMatrix();
    const O = stage.pipeline.params.outline;
    O.fadeStart = dist + 20; O.fadeEnd = dist + 40;
    uniforms.pxScale.value = h * stage.pixelRatio / (2 * Math.tan(camera.fov * DEG / 2));
    uniforms.hullPx.value = 2 * Math.tan(camera.fov * DEG / 2) / h;
    placeTags(true);
  }

  /* --------------------------------------------------------------------------------------------
   * DOM tags / tooltip positions (CSS custom properties, written only when they change)
   * ------------------------------------------------------------------------------------------ */
  const setPos = (el, cache, x, y) => {
    const rx = Math.round(x), ry = Math.round(y);
    if (cache.x === rx && cache.y === ry) return;
    cache.x = rx; cache.y = ry;
    el.style.setProperty('--x', rx + 'px');
    el.style.setProperty('--y', ry + 'px');
  };
  const project = (v, obj) => {
    tmp.copy(v);
    obj.localToWorld(tmp);
    tmp.project(camera);
    return [(tmp.x + 1) / 2 * fit.w, (1 - tmp.y) / 2 * fit.h];
  };
  const tipCache = {};
  let tipFor = -1;
  function placeTags(force) {
    for (const e of entries) {
      if (!e.tagCache) e.tagCache = {};
      if (force) e.tagCache.x = null;
      const [x, y] = project(e.tagAnchor, e.root);
      setPos(e.tag, e.tagCache, x, y);
    }
    if (hover >= 0) {
      const e = entries[hover];
      const [x, y] = project(e.anchor, e.anim);
      setPos(tip, tipCache, Math.min(Math.max(x, 90), fit.w - 90), Math.max(y - 10, 34));
    }
  }

  /* --------------------------------------------------------------------------------------------
   * Interaction
   * ------------------------------------------------------------------------------------------ */
  const canvas = stage.canvas;
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  function pick(ev) {
    const r = canvas.getBoundingClientRect();
    if (!r.width || !r.height) return -1;
    ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, 1 - ((ev.clientY - r.top) / r.height) * 2);
    raycaster.setFromCamera(ndc, camera);
    const hit = raycaster.intersectObjects(proxies, false)[0];
    return hit ? hit.object.userData.index : -1;
  }
  function setHover(i) {
    if (i === hover) return;
    hover = i;
    entries.forEach((e) => {
      e.target = e.i === i ? 1 : 0;
      e.tag.classList.toggle('npr-sel-on', e.i === i);
      if (e.i === i) e.wob = 0;
    });
    container.classList.toggle('npr-sel-hot', i >= 0);
    if (i >= 0) {
      const s = entries[i].s;
      tip.textContent = s.title;
      tipCache.x = null;
    }
    tip.classList.toggle('npr-sel-show', i >= 0);
    kick();
  }
  function go(i) {
    const e = entries[i];
    if (!e) return;
    const h = e.s.heading;
    if (h && h.isConnected) h.scrollIntoView({ behavior: still ? 'auto' : 'smooth', block: 'start' });
    e.bounceV = -2.2; // squash after the navigation has been triggered
    kick();
  }
  const guard = (fn) => (ev) => { try { fn(ev); } catch (err) { /* never throw out of handlers */ } };
  const onMove = guard((ev) => { if (ev.pointerType !== 'touch') setHover(pick(ev)); });
  const onLeave = guard(() => setHover(-1));
  const onClick = guard((ev) => { const i = pick(ev); if (i >= 0) go(i); });
  canvas.addEventListener('pointermove', onMove, { passive: true });
  canvas.addEventListener('pointerleave', onLeave, { passive: true });
  canvas.addEventListener('click', onClick);
  const tagListeners = entries.map((e) => {
    const enter = guard(() => setHover(e.i));
    const leave = guard(() => setHover(-1));
    const click = guard(() => go(e.i));
    e.tag.addEventListener('pointerenter', enter);
    e.tag.addEventListener('pointerleave', leave);
    e.tag.addEventListener('click', click);
    return () => {
      e.tag.removeEventListener('pointerenter', enter);
      e.tag.removeEventListener('pointerleave', leave);
      e.tag.removeEventListener('click', click);
    };
  });
  const pointer = still ? null : createPointer(window);

  // reduced motion: no loop, hover states snap and repaint once
  function kick() {
    if (!still || !started) return;
    for (const e of entries) e.h = e.target;
    update(0, stage.time);
    stage.renderOnce();
  }

  /* --------------------------------------------------------------------------------------------
   * Per-frame update
   * ------------------------------------------------------------------------------------------ */
  let clock = 0;
  function update(dt) {
    clock += dt;
    if (nightFx.n !== nightFx.to) {
      const p = clamp01((performance.now() - nightFx.t0) / FADE_MS), q = Math.min(1, p * 2.5);
      const { from, fromB, to } = nightFx;
      applyNight(from + (to - from) * p * p * (3 - 2 * p), fromB + (to - fromB) * q * (2 - q));
    }
    uniforms.time.value = clock;
    if (pointer) {
      pointer.update(dt);
      placeCamera(fit.az + pointer.x * 3 * DEG, fit.el - pointer.y * 1.5 * DEG, fit.dist);
    }
    for (const e of entries) {
      e.h = still ? e.target : damp(e.h, e.target, 10, dt);
      // spring for the click squash
      e.bounceV += (-e.bounce * 90 - e.bounceV * 9) * dt;
      e.bounce += e.bounceV * dt;
      e.wob += dt;
      const wob = still ? 0 : Math.sin(e.wob * 14) * Math.exp(-e.wob * 3.5) * 0.05;
      e.anim.position.y = e.h * 0.08;
      e.anim.rotation.z = wob;
      e.anim.scale.set(1 - e.bounce * 0.5, 1 + e.bounce, 1 - e.bounce * 0.5);
      for (const m of e.mats) m.rimStrength = e.h * 0.6 + nightFx.n * 0.1; // lamp-lit edges keep shapes legible at night
      e.hull.visible = e.h > 0.01;
      e.hull.material.uniforms.uWidth.value = e.h * 3;
      for (const g of e.glows) g.mat.color.setHex(g.base).multiplyScalar((1 + e.h * 0.35) * (1 + (g.night - 1) * nightFx.n));
      if (e.spec.update) e.spec.update(still ? 0 : clock, e.h);
    }
    placeTags(false);
  }

  stage.onUpdate(update);
  stage.onResize(layout);
  stage.setScene(scene, camera);
  if (!stage.width) {
    // the band's stylesheet may still be loading: wait for the first real size
    await new Promise((resolve) => {
      const off = stage.onResize(() => { off(); resolve(); });
      setTimeout(resolve, 4000);
    });
  }
  layout(stage.width, stage.height);
  await stage.compile();
  stage.renderOnce();

  return {
    stage,
    start() {
      if (disposed) return;
      started = true;
      if (still) stage.renderOnce(); else stage.start();
    },
    stop() { started = false; stage.stop(); },
    // warm night look on / off: ~0.8 s crossfade while the loop runs, otherwise (or reduced motion) at once
    setNight(on, { instant = false } = {}) {
      if (disposed) return;
      Object.assign(nightFx, { from: nightFx.n, fromB: nightFx.nb, to: on ? 1 : 0, t0: performance.now() });
      if (instant || still || !stage.running) {
        applyNight(nightFx.to);
        stage.renderOnce();
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerleave', onLeave);
      canvas.removeEventListener('click', onClick);
      tagListeners.forEach((off) => off());
      if (pointer) pointer.dispose();
      container.classList.remove('npr-sel-hot');
      tip.remove();
      entries.forEach((e) => e.tag.remove());
      const seen = new Set();
      scene.traverse((o) => {
        if (o.geometry && !seen.has(o.geometry)) { seen.add(o.geometry); o.geometry.dispose(); }
        const ms = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
        for (const m of ms) if (!seen.has(m)) { seen.add(m); m.dispose(); }
      });
      pickMat.dispose();
      Object.values(textures).forEach((t) => t.dispose());
      stage.dispose();
    },
  };
}
