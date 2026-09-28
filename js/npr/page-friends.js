// Friends page banner ("the friend village"): a floating island at dusk with one cottage per friend link
// (a.link-item in the page) along a winding lantern-lit path, plus an empty plot whose sign invites the
// visitor to the Bulletin board. mountPageScene(container, opts) — see CONTRACT-pages.md.
import * as THREE from 'three';
import { createStage, createPointer, seededRandom, markOutline } from './core.js';
import {
  C, Parts, VARIANTS, hullGeometry, vcMaterial, glowMaterial, moonTexture, signTexture,
  islandShape, islandGeometry, ribbonGeometry, buildHouse, signpost, buildPlot, plusMarker, buildRobot, pine, roundTree,
  bush, cloud,
} from './page-friends-build.js';

const DEG = Math.PI / 180;
const noRaycast = () => {};
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const DEPTH = 0.95; // underside depth scale of the island
const GLASS = 1.5, GLASS_ON = 3.4; // window glow (HDR emissive) idle / hovered
const SIGN_W = 1.5, SIGN_H = 0.46; // friend name boards (world units)
const SIGN_FACE = 9 * DEG; // boards turn toward the camera (world yaw)

// Screen-constant accent rim drawn from an inflated back-face hull.
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

// Fireflies / stars: soft HDR points that drift and twinkle (bloom picks them up).
const SPARK_VERT = /* glsl */`
attribute float aSeed;
uniform float uTime;
uniform float uDrift;
uniform float uSize;
varying float vAlpha;
void main() {
  vec3 p = position;
  float s = aSeed * 6.2831;
  p += uDrift * vec3( sin( uTime * 0.31 + s ) * 0.35, sin( uTime * 0.23 + s * 1.7 ) * 0.25, cos( uTime * 0.27 + s * 2.3 ) * 0.35 );
  vec4 mv = modelViewMatrix * vec4( p, 1.0 );
  gl_PointSize = max( 1.5, uSize * ( 0.6 + 0.4 * fract( aSeed * 7.13 ) ) / - mv.z );
  vAlpha = 0.35 + 0.65 * pow( 0.5 + 0.5 * sin( uTime * ( 0.8 + aSeed ) + s * 3.0 ), 2.0 );
  gl_Position = projectionMatrix * mv;
}`;
const SPARK_FRAG = /* glsl */`
uniform vec3 uColor;
varying float vAlpha;
void main() {
  float d = length( gl_PointCoord - 0.5 );
  float a = smoothstep( 0.5, 0.05, d ) * vAlpha;
  gl_FragColor = vec4( uColor * a, a );
}`;

function text(el) { return el ? el.textContent.replace(/\s+/g, ' ').trim() : ''; }

// Friends from the page. The page shuffles its cards on every load, so sort for a stable village.
function readFriends(root) {
  const list = [];
  root.querySelectorAll('a.link-item').forEach((a) => {
    let host = '';
    try { host = new URL(a.href, location.href).hostname.replace(/^www\./, ''); } catch (e) { /* keep empty */ }
    const name = text(a.querySelector('.link-nickname p')) || text(a.querySelector('.link-nickname')) || host || 'Friend';
    list.push({ a, name, host, intro: text(a.querySelector('.link-intro p')) });
  });
  return list.sort((x, y) => (x.name < y.name ? -1 : x.name > y.name ? 1 : 0));
}

function hashOf(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

// The Bulletin board: an existing link (page, or the menu when we are inside the AJAX preview) keeps the
// theme's own navigation; otherwise a plain page load.
const BULLETIN = 'a[href$="/bulletin/"], a[href$="/bulletin"], a[href$="/bulletin/index.html"]';
function openBulletin(root) {
  const a = root.querySelector(BULLETIN) || (document.getElementById('preview') ? document.querySelector('#menu-menu ' + BULLETIN) : null);
  if (a) a.click();
  else location.href = '/bulletin/';
}

function sparkles(count, place, { color, size, drift }) {
  const pos = new Float32Array(count * 3), seed = new Float32Array(count);
  const v = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    place(v, i);
    pos.set([v.x, v.y, v.z], i * 3);
    seed[i] = (i * 0.618034) % 1;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  const mat = new THREE.ShaderMaterial({
    vertexShader: SPARK_VERT, fragmentShader: SPARK_FRAG, transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uDrift: { value: drift }, uSize: { value: size }, uColor: { value: color } },
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  return pts;
}

export async function mountPageScene(container, { root, quality, reducedMotion, accent = '#f5c46a' } = {}) {
  root = root || document;
  const friends = readFriends(root);
  const stage = createStage(container, {
    clearColor: 0xffffff, clearAlpha: 0,
    quality: quality || 'auto',
    reducedMotion,
    maxPixelRatio: 1.5,
    pipeline: {
      outline: { thickness: 1.6, color: 0x3a2618, opacity: 0.9, colorBleed: 0.3, wobble: 0.6, depthThreshold: 0.03, normalThreshold: 0.32, fadeStart: 40, fadeEnd: 120 },
      bloom: { strength: 0.75, radius: 0.7, threshold: 1.0 },
      paper: { strength: 0.1, tint: 0xfff4e2 },
      grade: { exposure: 1.0, saturation: 1.02 },
      vignette: { strength: 0 },
    },
  });
  const low = stage.quality === 'low';
  const still = stage.reducedMotion;
  const renderer = stage.renderer;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.shadowMap.autoUpdate = false;

  const rand = seededRandom('niflheimr-friends');
  const accentCol = new THREE.Color(accent);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(28, 1, 0.5, 200);
  const disposables = [];
  const track = (x) => { disposables.push(x); return x; };
  const world = new THREE.Group();
  scene.add(world);

  /* --------------------------------------------------------------------------------------------
   * Layout: one slot per friend + the empty plot, in rows of up to five (two or three in a portrait band,
   * so the village stays big on phones), zig-zagging slightly.
   * ------------------------------------------------------------------------------------------ */
  const S = friends.length + 1;
  const portrait = (stage.width || innerWidth) < (stage.height || innerHeight * 0.64) * 1.2;
  const perRow = Math.min(S, portrait ? (S <= 4 ? 2 : 3) : 5), rows = Math.ceil(S / perRow);
  const SX = 2.6, SZ = 2.9;
  const slots = [];
  for (let k = 0; k < S; k++) {
    const r = Math.floor(k / perRow), j = k % perRow;
    const cnt = Math.min(perRow, S - r * perRow);
    const jj = r % 2 ? cnt - 1 - j : j; // serpentine order so the path runs through every slot
    // portrait fills from the back row, so the flat plot (last) sits in front of the cottages, not behind
    const rz0 = portrait ? rows - 1 - r : r;
    slots.push({ x: (jj - (cnt - 1) / 2) * SX + (r % 2 && !portrait ? SX * 0.3 : 0), z: -rz0 * SZ + (j % 2 ? -0.3 : 0.25), row: r });
  }
  const zs = slots.map((s) => s.z);
  const zMid = (Math.max(...zs) + Math.min(...zs)) / 2 + 0.15;
  for (const s of slots) s.z -= zMid;
  const halfX = ((Math.min(perRow, S) - 1) / 2) * SX + (rows > 1 && !portrait ? SX * 0.3 : 0);
  const halfZ = ((rows - 1) * SZ) / 2 + 0.9;
  const rx = Math.max(3.4, halfX + 2.1), rz = Math.max(2.6, halfZ + 1.8);
  const shapeFn = islandShape(rand, rx, rz);
  const inside = (x, z, f) => {
    const a = Math.atan2(z / rz, x / rx);
    return Math.hypot(x / rx, z / rz) < f * shapeFn(a);
  };

  // path: enters on the left edge, passes in front of every slot, leaves on the right (then the far rows)
  const pathPts = [new THREE.Vector3(-rx * 1.02, 0, slots[0].z + 1.2)];
  slots.forEach((s, k) => {
    pathPts.push(new THREE.Vector3(s.x - 0.45, 0, s.z + 1.15 + (k % 2 ? 0.1 : -0.05)));
    const n = slots[k + 1];
    if (n && n.row !== s.row) pathPts.push(new THREE.Vector3(s.x + (s.row % 2 ? -1.3 : 1.3), 0, (s.z + n.z) / 2 + 0.9));
    else if (n) pathPts.push(new THREE.Vector3((s.x + n.x) / 2, 0, Math.max(s.z, n.z) + 1.55 + (k % 2 ? 0.15 : 0)));
  });
  const last = slots[S - 1];
  pathPts.push(new THREE.Vector3(last.row % 2 ? -rx * 1.02 : rx * 1.02, 0, last.z + 1.3));
  const path = new THREE.CatmullRomCurve3(pathPts, false, 'centripetal');
  const pathSamples = path.getSpacedPoints(80);
  const nearPath = (x, z, d) => pathSamples.some((p) => Math.hypot(p.x - x, p.z - z) < d);
  const nearSlot = (x, z, d) => slots.some((s) => Math.hypot(s.x - x, (s.z - z) * 1.2) < d);

  /* --------------------------------------------------------------------------------------------
   * Lights: low peach dusk key (shadows), cool lavender fill, sky/ground hemisphere.
   * ------------------------------------------------------------------------------------------ */
  const key = new THREE.DirectionalLight(0xffc9a0, 2.3);
  key.position.set(-7, 9, 8);
  key.castShadow = true;
  key.shadow.mapSize.set(low ? 1024 : 2048, low ? 1024 : 2048);
  const ext = Math.max(rx, rz) + 2;
  Object.assign(key.shadow.camera, { left: -ext, right: ext, top: ext, bottom: -ext, near: 1, far: 40 });
  key.shadow.bias = -0.0006;
  key.shadow.normalBias = 0.025;
  const fill = new THREE.DirectionalLight(0xa9b4ff, 0.7);
  fill.position.set(8, 3, 5);
  const hemi = new THREE.HemisphereLight(0xe6d4f2, 0x6d5a58, 1.25);
  world.add(key, key.target, fill, hemi);

  const vc = track(vcMaterial());
  const glowMat = track(glowMaterial(0xffd27a, 2.4));

  /* --------------------------------------------------------------------------------------------
   * Island + path + scenery (one merged mesh) + lantern bulbs (one glow mesh)
   * ------------------------------------------------------------------------------------------ */
  const islandMesh = new THREE.Mesh(track(islandGeometry(rand, rx, rz, DEPTH, shapeFn)), vc);
  islandMesh.receiveShadow = true;
  markOutline(islandMesh);
  world.add(islandMesh);

  const decor = new Parts(), bulbs = new Parts();
  // where the name signs will stand (see the cottages below), so no lantern blocks one
  const signX = (i, w) => (i % 2 ? 1 : -1) * Math.min(0.45, w * 0.35); // neighbours' boards lean apart
  // (friends: in front of the cottage; the plot: at the back of the lot, see buildPlot)
  const signSpots = slots.map((s, i) => (i < friends.length ? [s.x + signX(i, 1.5), s.z + 0.9] : [s.x + 0.05, s.z - 0.92]));
  decor.add(ribbonGeometry(path, 0.62, rand), null);
  // lanterns along the path, alternating sides, clear of the houses
  const lanternAt = (x, z) => {
    decor.cyl(0.035, 0.045, 0.72, C.darkWood, { p: [x, 0.36, z] }, 6);
    decor.box(0.16, 0.035, 0.16, C.navy, { p: [x, 0.93, z] });
    decor.cone(0.13, 0.1, C.navy, { p: [x, 0.99, z] }, 4);
    decor.box(0.13, 0.025, 0.13, C.navy, { p: [x, 0.74, z] });
    bulbs.box(0.1, 0.16, 0.1, 0xffd27a, { p: [x, 0.84, z] });
  };
  {
    const len = path.getLength(), step = 1.9, p = new THREE.Vector3(), t = new THREE.Vector3();
    let side = 1;
    for (let d = 0.9; d < len - 0.6; d += step) {
      path.getPointAt(d / len, p); path.getTangentAt(d / len, t);
      const x = p.x - t.z * 0.5 * side, z = p.z + t.x * 0.5 * side;
      side = -side;
      if (!inside(x, z, 0.93) || nearSlot(x, z, 1.25) || signSpots.some((q) => Math.abs(q[0] - x) < 1.3 && z - q[1] > -0.5)) continue;
      lanternAt(x, z);
    }
  }
  // trees behind and beside the village; low bushes / flowers in front so nothing hides a cottage
  const frontZ = Math.max(...slots.slice(0, Math.max(1, friends.length)).map((s) => s.z)) + 0.8;
  const hidesSign = (x, z) => signSpots.some((q) => Math.abs(q[0] - x) < 1.3 && z > q[1] - 0.6);
  const nTrees = Math.round(rx * rz * 1.1);
  for (let i = 0, placed = 0; i < 400 && placed < nTrees; i++) {
    const a = rand() * Math.PI * 2, f = Math.sqrt(0.2 + rand() * 0.8) * 0.9;
    const x = Math.cos(a) * rx * f, z = Math.sin(a) * rz * f;
    if (!inside(x, z, 0.9) || nearPath(x, z, 0.6) || nearSlot(x, z, 1.45) || hidesSign(x, z)) continue;
    const s = 0.75 + rand() * 0.5;
    if (z > frontZ - 0.2) { bush(decor, x, z, s, rand); if (rand() < 0.5) bush(decor, x + 0.35, z + 0.1, s * 0.7, rand); }
    else if (rand() < 0.55) pine(decor, x, z, s * (z < -rz * 0.4 ? 1.25 : 1), rand);
    else roundTree(decor, x, z, s, rand);
    placed++;
  }
  // rocks and grass tufts on the rim
  for (let i = 0; i < 18; i++) {
    const a = rand() * Math.PI * 2, f = 0.9 + rand() * 0.06;
    const x = Math.cos(a) * rx * f * shapeFn(a), z = Math.sin(a) * rz * f * shapeFn(a);
    if (nearPath(x, z, 0.5)) continue;
    if (rand() < 0.5) decor.sphere(0.1 + rand() * 0.08, C.stone, { p: [x, 0.05, z], s: [1.2, 0.6, 1] }, 7, 5);
    else decor.cone(0.07, 0.22, C.grassDark, { p: [x, 0.1, z], r: [0, 0, (rand() - 0.5) * 0.4] }, 4);
  }

  /* --------------------------------------------------------------------------------------------
   * Interactive objects: cottages (friends) + the empty plot
   * ------------------------------------------------------------------------------------------ */
  const hullPx = { value: 0.001 };
  const proxyMat = track(new THREE.MeshBasicMaterial());
  const lampLights = [];
  const entries = [];
  const makeEntry = (i, slot, kind, data) => {
    const root3 = new THREE.Group(), anim = new THREE.Group();
    root3.position.set(slot.x, 0, slot.z);
    root3.add(anim);
    world.add(root3);
    return { i, kind, data, slot, root: root3, anim, h: 0, lift: 0, liftV: 0, wobT: 9, squashT: 9, glass: null, light: null, top: 1.5 };
  };
  const addHull = (e, geos) => {
    const g = track(hullGeometry(geos));
    const mat = track(new THREE.ShaderMaterial({
      vertexShader: HULL_VERT, fragmentShader: HULL_FRAG, side: THREE.BackSide,
      uniforms: { uWidth: { value: 0 }, uPx: hullPx, uColor: { value: accentCol.clone() } },
    }));
    const hull = new THREE.Mesh(g, mat);
    hull.raycast = noRaycast;
    hull.visible = false;
    e.anim.add(hull);
    e.hull = hull; e.hullMat = mat;
    const size = g.boundingBox.getSize(new THREE.Vector3()).addScalar(0.25);
    const proxy = new THREE.Mesh(track(new THREE.BoxGeometry(size.x, size.y, size.z)), proxyMat);
    g.boundingBox.getCenter(proxy.position);
    proxy.visible = false;
    proxy.userData.index = e.i;
    e.anim.add(proxy);
    e.proxy = proxy;
  };
  const signBoard = (e, tex, pos, w, h, ry) => {
    // unlit, so lantern light / bloom never washes the lettering out
    const m = new THREE.Mesh(track(new THREE.PlaneGeometry(w, h)), track(new THREE.MeshBasicMaterial({ map: tex, color: 0xe8e0d0 })));
    m.position.copy(pos);
    m.rotation.y = ry;
    m.raycast = noRaycast;
    e.anim.add(m);
  };

  friends.forEach((f, i) => {
    const slot = slots[i];
    const h = hashOf(f.name);
    const hr = seededRandom(h);
    const variant = VARIANTS[h % VARIANTS.length];
    const e = makeEntry(i, slot, 'friend', f);
    e.root.rotation.y = (hr() - 0.5) * 0.3;
    const house = buildHouse(variant, hr, (h >>> 3) + i);
    const body = new THREE.Mesh(track(house.body), vc);
    body.castShadow = body.receiveShadow = true;
    markOutline(body);
    e.glass = track(glowMaterial(0xffc978, GLASS));
    const glass = new THREE.Mesh(track(house.glass), e.glass);
    markOutline(glass);
    e.anim.add(body, glass);
    // signpost in front, beside the path
    const sp = new Parts(), sg = new Parts();
    const sx = signX(i, house.w);
    const sry = SIGN_FACE - e.root.rotation.y;
    const sgn = signpost(sp, sg, sx, 0.95, sry, { boardW: SIGN_W, boardH: SIGN_H, postH: 1.05 });
    e.signAt = sgn.board.clone();
    const spMesh = new THREE.Mesh(track(sp.build()), vc);
    spMesh.castShadow = true;
    markOutline(spMesh);
    const sgMesh = new THREE.Mesh(track(sg.build()), glowMat);
    e.anim.add(spMesh, sgMesh);
    signBoard(e, track(signTexture(f.name, { aspect: SIGN_W / SIGN_H })), sgn.board, SIGN_W, SIGN_H, sry);
    addHull(e, [house.body, house.glass]);
    e.top = house.top;
    if (lampLights.length < 4) {
      const L = new THREE.PointLight(0xffb870, 1.2, 3.2, 2);
      L.position.set(0, 0.7, (house.d || 1) / 2 + 0.45);
      e.anim.add(L);
      e.light = L;
      lampLights.push(L);
    }
    entries.push(e);
  });

  // the empty plot: a pegged-out lot with a floating "+" and a sign in front; the robot waits beside it
  const plotSlot = slots[S - 1];
  const plot = makeEntry(friends.length, plotSlot, 'plot', null);
  let plus = null;
  {
    const pp = new Parts();
    const spec = buildPlot(pp, rand, accent);
    const sp = new Parts(), sg = new Parts();
    const PW = 1.75, PH = 0.64;
    // the sign stands at the back of the lot on tall posts, so the pegged-out lot in front stays visible
    const sgn = signpost(sp, sg, 0.05, spec.z0 - spec.d / 2 - 0.12, SIGN_FACE, { boardW: PW, boardH: PH, postH: 1.4 });
    plot.signAt = sgn.board.clone();
    const geoPlot = track(pp.build()), geoSign = track(sp.build());
    const m1 = new THREE.Mesh(geoPlot, vc), m2 = new THREE.Mesh(geoSign, vc);
    m1.receiveShadow = true; m1.castShadow = true; m2.castShadow = true;
    markOutline(m1); markOutline(m2);
    plot.anim.add(m1, m2, new THREE.Mesh(track(sg.build()), glowMat));
    signBoard(plot, track(signTexture('Your house here?', { sub: 'ask on the Bulletin board', aspect: PW / PH })), sgn.board, PW, PH, SIGN_FACE);
    const pm = new Parts();
    plusMarker(pm);
    plus = new THREE.Mesh(track(pm.build()), track(glowMaterial(accentCol.getHex(), 2.2)));
    plus.position.set(0.05, 0.5, spec.z0 + 0.05);
    plus.scale.setScalar(1.35);
    plus.userData.y = plus.position.y;
    markOutline(plus);
    plot.anim.add(plus);
    addHull(plot, [geoPlot, geoSign]);
    plot.top = sgn.board.y + PH / 2 + 0.1;
  }
  entries.push(plot);

  const robot = new THREE.Group();
  {
    const rb = new Parts(), rg = new Parts(), re = new Parts();
    buildRobot(rb, rg, re);
    const b = new THREE.Mesh(track(rb.build()), vc);
    b.castShadow = true;
    markOutline(b);
    const eyes = new THREE.Mesh(track(re.build()), track(glowMaterial(0xfff1c7, 0.9)));
    robot.add(b, new THREE.Mesh(track(rg.build()), glowMat), eyes);
    const L = new THREE.PointLight(0xffc27a, 1.6, 2.6, 2); // its lantern lights the robot and the lot
    L.position.set(0.1, 0.55, 0.55);
    robot.add(L);
    robot.position.set(plotSlot.x + 1.15, 0, plotSlot.z + 0.55);
    robot.scale.setScalar(1.25);
    world.add(robot);
  }

  if (!decor.empty) {
    const dm = new THREE.Mesh(track(decor.build()), vc);
    dm.castShadow = dm.receiveShadow = true;
    markOutline(dm);
    world.add(dm);
  }
  if (!bulbs.empty) world.add(new THREE.Mesh(track(bulbs.build()), glowMat));

  /* --------------------------------------------------------------------------------------------
   * Sky props: islets, clouds, moon, stars, fireflies
   * ------------------------------------------------------------------------------------------ */
  const floaters = [];
  const islet = (x, y, z, s, tree) => {
    const p = new Parts();
    const shp = islandShape(rand, s, s * 0.8);
    p.add(islandGeometry(rand, s, s * 0.8, 0.55, shp), null);
    if (tree === 'pine') pine(p, 0, 0, s * 0.9, rand); else roundTree(p, 0.1, 0, s * 0.8, rand);
    const m = new THREE.Mesh(track(p.build()), vc);
    m.position.set(x, y, z);
    markOutline(m);
    world.add(m);
    floaters.push({ m, y, ph: rand() * 6, amp: 0.12 });
  };
  islet(-rx - 2.6, -0.9, -0.6, 0.85, 'pine');
  islet(rx + 2.5, 0.5, -1.4, 0.65, 'round');
  const islets = floaters.map((f) => f.m);
  const cloudMat = track(vcMaterial({ shadeColor: 0xc9b5dd }));
  const cloudAt = (x, y, z, s) => {
    const p = new Parts();
    cloud(p, rand, s);
    const m = new THREE.Mesh(track(p.build()), cloudMat);
    m.position.set(x, y, z);
    markOutline(m);
    world.add(m);
    floaters.push({ m, y, x, ph: rand() * 6, amp: 0.08, drift: 0.25 });
  };
  cloudAt(-rx - 2.2, 1.7, -rz - 0.6, 1);
  cloudAt(rx + 3.2, -1.5, 0.6, 0.7);
  cloudAt(rx * 0.35, -2.7, -1.5, 0.9);
  const clouds = floaters.slice(islets.length);

  const moon = new THREE.Mesh(track(new THREE.PlaneGeometry(1.4, 1.4)), track(new THREE.MeshBasicMaterial({
    map: track(moonTexture()), color: new THREE.Color(1.7, 1.55, 1.2), transparent: true, depthWrite: false, fog: false,
  })));
  moon.position.set(rx * 1.25, 2.3, -rz - 3);
  moon.raycast = noRaycast;
  world.add(moon);

  const skyR = seededRandom('friends-stars');
  const stars = sparkles(low ? 18 : 30, (v) => v.set((skyR() - 0.5) * rx * 5, 1.6 + skyR() * 3.2, -rz - 4 - skyR() * 3), {
    color: new THREE.Color(1.8, 1.6, 1.2), size: 26, drift: 0,
  });
  track(stars.geometry); track(stars.material);
  world.add(stars);
  const flies = sparkles(low ? 22 : 40, (v) => {
    for (let k = 0; k < 20; k++) {
      v.set((skyR() - 0.5) * rx * 2.1, 0.3 + skyR() * 1.9, (skyR() - 0.5) * rz * 2.1);
      if (inside(v.x, v.z, 1.05)) break;
    }
  }, { color: accentCol.clone().multiplyScalar(2.6), size: 34, drift: 1 });
  track(flies.geometry); track(flies.material);
  world.add(flies);

  /* --------------------------------------------------------------------------------------------
   * Camera framing: fit the island (plus the tallest roofs and the rocky tip) for any aspect.
   * ------------------------------------------------------------------------------------------ */
  const fitPts = [];
  const maxTop = Math.max(...entries.map((e) => e.top)) + 0.3;
  for (let k = 0; k < 24; k++) {
    const a = (k / 24) * Math.PI * 2, s = shapeFn(a);
    fitPts.push(new THREE.Vector3(Math.cos(a) * rx * s, 0, Math.sin(a) * rz * s));
    if (Math.sin(a) < 0.2) fitPts.push(new THREE.Vector3(Math.cos(a) * rx * s * 0.8, maxTop * 0.8, Math.sin(a) * rz * s * 0.8));
  }
  for (const e of entries) fitPts.push(new THREE.Vector3(e.slot.x, e.top, e.slot.z));
  islandMesh.geometry.computeBoundingBox(); // the rocky tip hangs deeper under bigger islands
  fitPts.push(new THREE.Vector3(0, Math.min(-2.6 * DEPTH, islandMesh.geometry.boundingBox.min.y + 0.1), 0), pathPts[0].clone(), pathPts[pathPts.length - 1].clone());
  const view = { target: new THREE.Vector3(0, 0, 0), dist: 20, az: 10 * DEG, el: 22 * DEG, wide: true };
  const _v = new THREE.Vector3(), _dir = new THREE.Vector3(), _right = new THREE.Vector3(), _up = new THREE.Vector3();
  function placeCamera(az, el, dist, target) {
    _dir.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
    camera.position.copy(target).addScaledVector(_dir, dist);
    camera.lookAt(target);
    camera.updateMatrixWorld();
  }
  function extent(mx, my, out) {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const p of fitPts) {
      _v.copy(p).project(camera);
      if (_v.x < x0) x0 = _v.x; if (_v.x > x1) x1 = _v.x;
      if (_v.y < y0) y0 = _v.y; if (_v.y > y1) y1 = _v.y;
    }
    out.cx = (x0 + x1) / 2; out.cy = (y0 + y1) / 2;
    out.s = Math.max((x1 - x0) / (2 * mx), (y1 - y0) / (2 * my));
    return out;
  }
  const ex = {};
  // world x at which a point at height y / depth z projects to NDC x = nx (current camera)
  function xAtNdc(nx, y, z) {
    let x = 0;
    for (let k = 0; k < 3; k++) {
      _v.set(x, y, z);
      const halfW = Math.tan(camera.fov * DEG / 2) * camera.aspect * _v.distanceTo(camera.position);
      _v.project(camera);
      x += (nx - _v.x) * halfW;
    }
    return x;
  }
  function frame(w, h) {
    const aspect = w / h;
    camera.aspect = aspect;
    view.wide = aspect > 1.6;
    view.el = (view.wide ? 21 : rows > 1 ? 34 : 24) * DEG;
    view.az = (view.wide ? 10 : 6) * DEG;
    camera.fov = view.wide ? 26 : 32;
    camera.updateProjectionMatrix();
    // how much of the band the island may fill (the wide band keeps a margin for the side islets)
    const mx = view.wide ? Math.min(0.78, 2.3 / aspect) : 0.92, my = view.wide ? 0.87 : 0.8;
    view.target.set(0, 0, 0);
    view.dist = 20;
    for (let k = 0; k < 4; k++) {
      placeCamera(view.az, view.el, view.dist, view.target);
      extent(mx, my, ex);
      // recentre: shift the target in the view plane by the NDC offset, then scale the distance
      const halfH = Math.tan(camera.fov * DEG / 2) * view.dist, halfW = halfH * aspect;
      _right.setFromMatrixColumn(camera.matrixWorld, 0);
      _up.setFromMatrixColumn(camera.matrixWorld, 1);
      view.target.addScaledVector(_right, ex.cx * halfW).addScaledVector(_up, ex.cy * halfH);
      view.dist *= ex.s;
    }
    if (!view.wide) { // portrait: sit the island a little lower (less empty wash under it, room for name tags)
      _up.setFromMatrixColumn(camera.matrixWorld, 1);
      view.target.addScaledVector(_up, Math.tan(camera.fov * DEG / 2) * view.dist * 0.07);
    }
    placeCamera(view.az, view.el, view.dist, view.target);
    hullPx.value = 2 * Math.tan(camera.fov * DEG / 2) / h;
    stars.material.uniforms.uSize.value = 26 * stage.pixelRatio * (h / 400);
    flies.material.uniforms.uSize.value = 34 * stage.pixelRatio * (h / 400);
    // wide bands: park the islets / clouds / moon near the band's sides (the island fills the middle);
    // portrait bands: no room for them beside the island, keep only the moon, above it
    for (const m of islets) m.visible = view.wide;
    clouds[0].m.visible = view.wide;
    clouds[1].m.visible = view.wide;
    if (view.wide) {
      islets[0].position.x = xAtNdc(-0.9, -0.9, -0.6);
      islets[1].position.x = xAtNdc(0.91, 0.5, -1.4);
      clouds[0].x = xAtNdc(-0.76, 1.7, -rz - 0.6);
      clouds[1].x = xAtNdc(0.86, -1.5, 0.6);
      moon.position.set(xAtNdc(0.8, 1.9, -rz - 3), 1.9, -rz - 3);
    } else moon.position.set(rx * 0.7, rows > 1 ? 2.2 : 2.9, -rz - 3);
    moon.lookAt(camera.position);
  }
  const renderShadows = () => { renderer.shadowMap.needsUpdate = true; };
  stage.onResize((w, h) => { frame(w, h); if (!stage.running && stage.frames > 0) renderShadows(); });

  /* --------------------------------------------------------------------------------------------
   * Hover label (DOM, inside the container; never catches the pointer)
   * ------------------------------------------------------------------------------------------ */
  const tip = document.createElement('div');
  tip.className = 'npr-friends-tip';
  const tipName = document.createElement('b'), tipSub = document.createElement('span'), tipHint = document.createElement('i');
  tip.append(tipName, tipSub, tipHint);
  container.appendChild(tip);
  let tipFor = -1, tipKey = '', tipX = NaN, tipY = NaN;
  const _a = new THREE.Vector3();
  // The label stands in for the (hidden) friend card: nickname, intro line, and where the click goes.
  function placeTip(e, kbd) {
    if (!e) { if (tipFor !== -1) tip.classList.remove('npr-on'); tipFor = -1; return; }
    const key = e.i + (tapArmed ? 't' : '');
    if (tipKey !== key) {
      tipKey = key;
      const plotE = e.kind === 'plot';
      tipName.textContent = plotE ? 'Your house here?' : e.data.name;
      tipSub.textContent = plotE ? 'Leave a message on the Bulletin board' : e.data.intro;
      tipSub.hidden = !tipSub.textContent;
      tipHint.textContent = tapArmed ? 'Tap again to open \u2197' : plotE || !e.data.host ? '' : e.data.host + ' \u2197';
      tipHint.hidden = !tipHint.textContent;
    }
    tipFor = e.i;
    tip.classList.toggle('npr-kbd', !!kbd);
    _a.set(0, e.top + 0.15, 0);
    e.anim.localToWorld(_a).project(camera);
    const x = Math.round((_a.x * 0.5 + 0.5) * stage.width), y = Math.round(Math.max((0.5 - _a.y * 0.5) * stage.height, 8));
    if (x !== tipX || y !== tipY) {
      tipX = x; tipY = y;
      tip.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`;
    }
    tip.classList.add('npr-on');
  }

  // Narrow bands: the painted boards get too small to read, so pin a DOM name tag under each board.
  const tags = entries.map((e) => {
    const d = document.createElement('div');
    d.className = 'npr-friends-tag';
    d.textContent = e.kind === 'plot' ? 'Your house here?' : e.data.name;
    if (e.kind === 'plot') d.classList.add('npr-friends-tag-plot');
    d.hidden = true;
    container.appendChild(d);
    return { d, x: NaN, y: NaN };
  });
  let tagsOn = false;
  function placeTags(act) {
    const want = stage.width > 0 && stage.width < 640;
    if (want !== tagsOn) tagsOn = want;
    entries.forEach((e, k) => {
      const hide = !tagsOn || k === act; // the full label replaces the active entry's tag
      if (tags[k].d.hidden !== hide) tags[k].d.hidden = hide;
      if (hide) return;
      _a.set(0, e.top + 0.05, 0);
      e.anim.localToWorld(_a).project(camera);
      const t = tags[k];
      const x = Math.round((_a.x * 0.5 + 0.5) * stage.width), y = Math.round((0.5 - _a.y * 0.5) * stage.height);
      if (x !== t.x || y !== t.y) {
        t.x = x; t.y = y;
        t.d.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`;
      }
    });
  }

  /* --------------------------------------------------------------------------------------------
   * Interaction
   * ------------------------------------------------------------------------------------------ */
  let hoverIndex = null, focusIndex = null, pressed = null, disposed = false;
  let tapArmed = false; // touch: the first tap on an entry shows its label, the second one follows it
  const activeIndex = () => (hoverIndex !== null ? hoverIndex : focusIndex);
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const proxies = entries.map((e) => e.proxy);
  const hits = [];
  let dirty = true;
  const refresh = () => { dirty = true; if (!stage.running && !disposed) stage.renderOnce(); };

  function pick(x, y) {
    const r = container.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    ndc.set(((x - r.left) / r.width) * 2 - 1, 1 - ((y - r.top) / r.height) * 2);
    ray.setFromCamera(ndc, camera);
    hits.length = 0;
    ray.intersectObjects(proxies, false, hits);
    return hits.length ? hits[0].object.userData.index : null;
  }
  function setHover(i) {
    if (i === hoverIndex) return;
    hoverIndex = i;
    tapArmed = false;
    container.style.cursor = i !== null ? 'pointer' : '';
    refresh();
  }
  // Navigation must run synchronously inside the click handler (friends open in a new tab).
  function select(i) {
    const e = entries[i];
    if (!e) return;
    if (e.kind === 'friend') e.data.a.click();
    else openBulletin(root);
    e.squashT = 0;
    refresh();
  }
  const onMove = (ev) => { if (ev.pointerType !== 'touch') setHover(pick(ev.clientX, ev.clientY)); };
  const onLeave = (ev) => { if (ev.pointerType !== 'touch') setHover(null); };
  const onDown = (ev) => { pressed = { x: ev.clientX, y: ev.clientY, touch: ev.pointerType === 'touch' }; };
  const onClick = (ev) => {
    try {
      const p = pressed;
      pressed = null;
      if (p && Math.hypot(ev.clientX - p.x, ev.clientY - p.y) > 10) return;
      const i = pick(ev.clientX, ev.clientY);
      if (p && p.touch) { // no hover on touch: tap once for the label, tap the same entry again to go
        if (i === null || i !== hoverIndex || !tapArmed) {
          setHover(i);
          tapArmed = i !== null;
          refresh();
          return;
        }
      }
      if (i !== null) select(i);
    } catch (err) { /* never throw out of a handler */ }
  };
  // a touch outside the band drops the armed label
  const onDocDown = (ev) => { if (hoverIndex !== null && ev.pointerType === 'touch' && !container.contains(ev.target)) setHover(null); };
  container.addEventListener('pointermove', onMove, { passive: true });
  container.addEventListener('pointerleave', onLeave, { passive: true });
  container.addEventListener('pointerdown', onDown, { passive: true });
  container.addEventListener('click', onClick);
  document.addEventListener('pointerdown', onDocDown, { passive: true });
  // The friend links stay the accessible path (their cards are visually hidden while the scene is on):
  // focusing one lights its cottage and label, and brings the band into view. A clearer accessible name
  // is set for the scene's lifetime and restored on dispose.
  const linkHandlers = [], labels = [];
  friends.forEach((f, i) => {
    const on = (ev) => {
      focusIndex = i;
      refresh();
      if (ev.type === 'focus') {
        const r = container.getBoundingClientRect();
        if (r.top < 0 || r.bottom > window.innerHeight) container.scrollIntoView({ block: 'nearest' });
      }
    };
    const off = () => { if (focusIndex === i) { focusIndex = null; refresh(); } };
    for (const [t, h] of [['mouseenter', on], ['focus', on], ['mouseleave', off], ['blur', off]]) {
      f.a.addEventListener(t, h);
      linkHandlers.push([f.a, t, h]);
    }
    if (!f.a.hasAttribute('aria-label')) {
      const newTab = f.a.target === '_blank' ? ' (opens in a new tab)' : '';
      f.a.setAttribute('aria-label', f.name + (f.intro ? ' \u2014 ' + f.intro : '') + newTab);
      labels.push(f.a);
    }
  });
  const pointer = createPointer(window, { smoothing: 2.5 });

  /* --------------------------------------------------------------------------------------------
   * Frame update
   * ------------------------------------------------------------------------------------------ */
  const T0 = 3.2; // reduced motion: time frozen on a pleasant moment
  function update(dt, t) {
    const T = still ? T0 : t;
    if (!still) pointer.update(dt);
    const px = still ? 0 : pointer.x, py = still ? 0 : pointer.y;
    // parallax + gentle bob
    _v.copy(view.target);
    _v.y += still ? 0 : Math.sin(T * 0.6) * 0.06;
    placeCamera(view.az + px * 3 * DEG, view.el + py * 1.5 * DEG, view.dist, _v);
    stars.material.uniforms.uTime.value = T;
    flies.material.uniforms.uTime.value = T;
    for (const f of floaters) {
      f.m.position.y = f.y + Math.sin(T * 0.5 + f.ph) * f.amp;
      if (f.drift) f.m.position.x = f.x + Math.sin(T * 0.07 + f.ph) * f.drift;
    }
    // robot looks toward the pointer, bobs a little
    robot.rotation.y = -0.2 + px * 0.5;
    robot.position.y = still ? 0 : Math.abs(Math.sin(T * 1.6)) * 0.03;
    if (plus) {
      plus.position.y = plus.userData.y + (still ? 0 : Math.sin(T * 1.3) * 0.06);
      plus.rotation.y = still ? 0.4 : T * 0.8;
    }

    const act = activeIndex();
    let moving = false;
    const k = still ? 1 : 1 - Math.exp(-dt * 10);
    for (const e of entries) {
      const on = e.i === act;
      if (on && !e.was) e.wobT = 0;
      e.was = on;
      e.h += ((on ? 1 : 0) - e.h) * k;
      // springy lift
      const lt = on ? 1 : 0;
      if (still) { e.lift = lt; e.liftV = 0; } else {
        e.liftV += ((lt - e.lift) * 160 - e.liftV * 16) * dt;
        e.lift += e.liftV * dt;
      }
      let wob = 0;
      if (!still && e.wobT < 1.2) { e.wobT += dt; wob = Math.sin(e.wobT * 14) * Math.exp(-e.wobT * 4) * 0.05; }
      let sq = 1, sxz = 1;
      if (!still && e.squashT < 0.3) {
        e.squashT += dt;
        const p = Math.sin(Math.PI * clamp01(e.squashT / 0.3));
        sq = 1 - 0.14 * p; sxz = 1 + 0.07 * p;
      }
      e.anim.position.y = e.lift * 0.2;
      e.anim.rotation.set(0, 0, wob);
      e.anim.scale.set(sxz, sq, sxz);
      e.hull.visible = e.h > 0.01;
      e.hullMat.uniforms.uWidth.value = e.h * 3.2;
      if (e.glass) e.glass.emissiveIntensity = GLASS + (GLASS_ON - GLASS) * e.h + (still ? 0 : Math.sin(T * 2.1 + e.i * 1.7) * 0.08);
      if (e.light) e.light.intensity = 1.2 + e.h * 2.2;
      if (Math.abs(e.lift - lt) > 0.002 || Math.abs(e.liftV) > 0.01 || sq !== 1 || wob !== 0 || Math.abs(e.h - lt) > 0.01) moving = true;
    }
    if (moving || dirty) { renderShadows(); dirty = moving; }
    placeTags(act);
    placeTip(act !== null ? entries[act] : null, hoverIndex === null && act !== null);
  }
  stage.onUpdate(update);

  stage.setScene(scene, camera);
  frame(Math.max(1, stage.width), Math.max(1, stage.height));
  await stage.compile();
  stage.renderOnce();

  return {
    stage,
    start() {
      if (disposed) return;
      if (still) stage.renderOnce(); else stage.start();
    },
    stop() { stage.stop(); },
    dispose() {
      if (disposed) return;
      disposed = true;
      stage.stop();
      container.removeEventListener('pointermove', onMove);
      container.removeEventListener('pointerleave', onLeave);
      container.removeEventListener('pointerdown', onDown);
      container.removeEventListener('click', onClick);
      document.removeEventListener('pointerdown', onDocDown);
      for (const [el, t, h] of linkHandlers) el.removeEventListener(t, h);
      for (const a of labels) a.removeAttribute('aria-label');
      pointer.dispose();
      container.style.cursor = '';
      tip.remove();
      for (const t of tags) t.d.remove();
      stage.dispose();
      for (const d of disposables) d.dispose();
      disposables.length = 0;
    },
  };
}
