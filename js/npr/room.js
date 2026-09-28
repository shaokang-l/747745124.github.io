// The Diaspora menu as an NPR cut-away room ("the study"): every menu entry is an object in the room.
// mountRoom(container, { items, onSelect, onHover, quality, reducedMotion, accent }) — see CONTRACT 3.3.
import * as THREE from 'three';
import { createStage, createPointer, seededRandom } from './core.js';
import {
  ROOM, WIN, C, PLACES, SPOTS, DECOR, BUILDERS, buildShell, buildDecor, vcMaterial,
  paintingTexture, tagTexture, portraitTexture, blobTexture, outsideTexture,
} from './room-objects.js';

const DEG = Math.PI / 180;
const INTRO = 0.72;      // intro length (s): camera ease + staggered pop-in
const INTRO_HOLD = 0.18; // playIntro() waits this long first, so the pop-in plays once the menu has slid in
const noRaycast = () => {};
const easeOutCubic = (x) => 1 - Math.pow(1 - x, 3);
const easeOutBack = (x) => { const c = 1.9; return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2); };
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

// Screen-constant accent rim drawn from an inflated back-face hull (smooth welded normals).
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

// Sun beam through the window: additive prism, soft at the sides, fading toward the floor.
const BEAM_VERT = /* glsl */`
attribute vec2 aBeam;
varying vec2 vBeam;
void main() { vBeam = aBeam; gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 ); }`;
const BEAM_FRAG = /* glsl */`
uniform vec3 uColor;
uniform float uTime;
varying vec2 vBeam;
void main() {
  float side = smoothstep( 0.0, 0.3, vBeam.x ) * smoothstep( 1.0, 0.7, vBeam.x );
  float along = ( 1.0 - vBeam.y * 0.65 ) * smoothstep( 0.0, 0.08, vBeam.y );
  float streak = 0.8 + 0.2 * sin( vBeam.x * 23.0 + uTime * 0.35 ) * sin( vBeam.x * 9.0 - uTime * 0.21 );
  gl_FragColor = vec4( uColor * side * along * streak, 1.0 );
}`;

// Dust motes drifting in the beam.
const MOTE_VERT = /* glsl */`
attribute float aSeed;
uniform float uTime;
uniform float uScale;
varying float vAlpha;
void main() {
  vec3 p = position;
  float s = aSeed * 6.2831;
  p += vec3( sin( uTime * 0.21 + s ) * 0.12, sin( uTime * 0.13 + s * 1.7 ) * 0.16, cos( uTime * 0.17 + s * 2.3 ) * 0.12 );
  vec4 mv = modelViewMatrix * vec4( p, 1.0 );
  gl_PointSize = max( 1.5, 0.045 * uScale / - mv.z );
  vAlpha = 0.45 + 0.55 * sin( uTime * 0.9 + s * 3.0 );
  gl_Position = projectionMatrix * mv;
}`;
const MOTE_FRAG = /* glsl */`
uniform vec3 uColor;
varying float vAlpha;
void main() {
  float d = length( gl_PointCoord - 0.5 );
  float a = smoothstep( 0.5, 0.1, d ) * vAlpha;
  gl_FragColor = vec4( uColor * a, 1.0 );
}`;

// Inflation hull for an object (content-local space; instanced meshes are baked).
function buildHullGeometry(content) {
  content.updateMatrixWorld(true);
  const inv = content.matrixWorld.clone().invert();
  const m = new THREE.Matrix4(), im = new THREE.Matrix4(), v = new THREE.Vector3();
  const keys = new Map(), pos = [], index = [];
  const vid = (x, y, z) => {
    const k = `${Math.round(x * 500)},${Math.round(y * 500)},${Math.round(z * 500)}`;
    let id = keys.get(k);
    if (id === undefined) { id = pos.length / 3; keys.set(k, id); pos.push(x, y, z); }
    return id;
  };
  content.traverse((o) => {
    if (!o.isMesh || o.userData.noHull) return;
    const g = o.geometry, P = g.attributes.position, I = g.index;
    const count = I ? I.count : P.count;
    const n = o.isInstancedMesh ? o.count : 1;
    for (let k = 0; k < n; k++) {
      m.multiplyMatrices(inv, o.matrixWorld);
      if (o.isInstancedMesh) { o.getMatrixAt(k, im); m.multiply(im); }
      for (let i = 0; i < count; i++) {
        v.fromBufferAttribute(P, I ? I.getX(i) : i).applyMatrix4(m);
        index.push(vid(v.x, v.y, v.z));
      }
    }
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(index, 1) : new THREE.Uint16BufferAttribute(index, 1));
  geo.computeVertexNormals();
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

export async function mountRoom(container, opts = {}) {
  const { items = [], onSelect, onHover, quality, reducedMotion, accent = '#f5c46a' } = opts;
  const stage = createStage(container, {
    clearColor: C.paper,
    quality: quality || 'auto',
    reducedMotion,
    maxPixelRatio: 1.5,
    pipeline: {
      outline: { thickness: 1.75, color: 0x3a2618, opacity: 0.92, colorBleed: 0.3, wobble: 0.6, depthThreshold: 0.03, normalThreshold: 0.32 },
      bloom: { strength: 0.55, radius: 0.7, threshold: 1.0 },
      paper: { strength: 0.14, tint: 0xfff4e2 },
      grade: { exposure: 1.0, saturation: 1.02, tint: 0xfffaf2 },
      vignette: { strength: 0.16, softness: 0.7, color: 0xe6dac5 },
    },
  });
  const low = stage.quality === 'low';
  const still = stage.reducedMotion;
  const renderer = stage.renderer;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.shadowMap.autoUpdate = false;

  const rand = seededRandom('niflheimr-study');
  const uniforms = { time: { value: 0 } };
  const accentCol = new THREE.Color(accent);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(24, 1, 0.5, 400);
  const disposables = [];

  // --- lights: warm sun through the window (only light that casts shadows), cool-ish fill, sky/ground
  const { W, D, H, T, F, x0, x1, z0, z1 } = ROOM;
  const winC = new THREE.Vector3((WIN.x0 + WIN.x1) / 2, (WIN.y0 + WIN.y1) / 2, z0);
  const sunTravel = new THREE.Vector3(-0.8, -2.25, 3.4).normalize();
  const sun = new THREE.DirectionalLight(0xffe0b0, 2.7);
  sun.position.copy(winC).addScaledVector(sunTravel, -14);
  sun.target.position.copy(winC).addScaledVector(sunTravel, 3);
  sun.castShadow = true;
  sun.shadow.mapSize.set(low ? 1024 : 2048, low ? 1024 : 2048);
  Object.assign(sun.shadow.camera, { left: -7, right: 7, top: 7, bottom: -7, near: 2, far: 30 });
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.025;
  const fill = new THREE.DirectionalLight(0xfff0dc, 1.0);
  fill.position.set(0.62, 0.72, 0.3).multiplyScalar(20);
  const hemi = new THREE.HemisphereLight(0xfff0da, 0x9a7a62, 1.3);
  scene.add(sun, sun.target, fill, hemi);

  // --- textures
  const textures = {
    painting: paintingTexture(seededRandom('easel')),
    tag: tagTexture(),
    portrait: await portraitTexture(),
    blob: blobTexture(),
    outside: outsideTexture(),
  };
  disposables.push(...Object.values(textures));
  const ctx = { rand, uniforms, textures, mat: () => vcMaterial() };

  // --- shell + decor
  const shell = buildShell(ctx);
  scene.add(shell.group);
  const decor = buildDecor(ctx);
  scene.add(decor.group);

  // soft contact shadow under the diorama + small ones under floor objects
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(W * 1.9, D * 1.9), new THREE.MeshBasicMaterial({
    map: textures.blob, color: 0x9a8468, transparent: true, opacity: 0.5, depthWrite: false, fog: false,
  }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0.5, -F - 0.06, 0.5);
  ground.renderOrder = -1;
  scene.add(ground);

  // --- interactive objects
  const hullPx = { value: 0.001 };
  const proxyMat = new THREE.MeshBasicMaterial();
  const used = new Set();
  let spot = 0;
  const entries = items.map((item, i) => {
    let key = BUILDERS[item.object] && item.object !== 'crate' && !used.has(item.object) ? item.object : 'crate';
    let place = PLACES[key];
    if (key === 'crate') { const s = SPOTS[spot++ % SPOTS.length]; place = { p: s, ry: rand() * 0.6 - 0.3 }; }
    used.add(key);
    const root = new THREE.Group(), anim = new THREE.Group(), content = new THREE.Group();
    root.add(anim); anim.add(content);
    const mats = [];
    ctx.mat = (extra) => { const m = vcMaterial(extra); mats.push(m); return m; };
    const spec = BUILDERS[key](content, ctx);
    anim.position.copy(spec.pivot);
    content.position.copy(spec.pivot).negate();
    root.position.set(place.p[0], 0, place.p[1]);
    root.rotation.y = place.ry;
    if (place.s) root.scale.setScalar(place.s);
    for (const m of mats) { m.rimColor = accentCol; m.rimPower = 2.5; }

    const hullMat = new THREE.ShaderMaterial({
      vertexShader: HULL_VERT, fragmentShader: HULL_FRAG, side: THREE.BackSide,
      // ink-gold, just under the bloom threshold: a crisp outline, not a glow that washes the object out
      uniforms: { uWidth: { value: 0 }, uPx: hullPx, uColor: { value: accentCol.clone() } },
    });
    const hullGeo = buildHullGeometry(content);
    const hull = new THREE.Mesh(hullGeo, hullMat);
    hull.raycast = noRaycast;
    hull.userData.noHull = true;
    content.add(hull);
    const bb = hullGeo.boundingBox;
    const size = bb.getSize(new THREE.Vector3()).addScalar(0.16);
    const proxy = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), proxyMat);
    bb.getCenter(proxy.position);
    proxy.visible = false;
    proxy.userData.index = i;
    content.add(proxy);
    scene.add(root);
    return {
      i, key, item, el: item.el, spec, root, anim, content, mats, hull, hullMat, proxy,
      h: 0, lift: 0, liftV: 0, wobT: 9, pop: 0, activeWas: false,
      anchorW: new THREE.Vector3(), sx: 0, sy: 0, w: 0, lh: 0, onScreen: false, depth: 0, shown: false,
      css: { x: null, y: null, d: null, lx: null, ly: null, ll: null, la: null },
    };
  });

  // floor contact blobs (one instanced draw)
  const blobs = [];
  for (const e of entries) if (e.spec.footprint) blobs.push(e);
  const blobMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({
    map: textures.blob, color: 0x3b2a1e, transparent: true, opacity: 0.32, depthWrite: false, fog: false,
  }), Math.max(1, blobs.length + 3));
  blobMesh.count = 0;
  const bm = new THREE.Matrix4(), bq = new THREE.Quaternion(), bs = new THREE.Vector3(), bp = new THREE.Vector3();
  const flat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
  const decorBlobs = [[...DECOR.lamp, 0.7, 0.7], [...DECOR.plant, 0.8, 0.8], [...DECOR.cat, 0.9, 0.7]];
  function placeBlobs() {
    let n = 0;
    for (const e of blobs) {
      const [fw, fd] = e.spec.footprint;
      const k = 1 - clamp01(e.lift * 2.5) * 0.35;
      bq.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, e.root.rotation.y).multiply(flat);
      bm.compose(bp.set(e.root.position.x, 0.041, e.root.position.z), bq, bs.set((fw + 0.35) * k * e.pop, (fd + 0.35) * k * e.pop, 1));
      blobMesh.setMatrixAt(n++, bm);
    }
    for (const [x, z, w, d] of decorBlobs) {
      bm.compose(bp.set(x, 0.041, z), flat, bs.set(w, d, 1));
      blobMesh.setMatrixAt(n++, bm);
    }
    blobMesh.count = n;
    blobMesh.instanceMatrix.needsUpdate = true;
  }
  placeBlobs();
  scene.add(blobMesh);

  // --- sun beam + motes
  const beamGeo = new THREE.BufferGeometry();
  {
    const wc = [[WIN.x0, WIN.y0], [WIN.x1, WIN.y0], [WIN.x1, WIN.y1], [WIN.x0, WIN.y1]].map(([x, y]) => new THREE.Vector3(x, y, z0 + 0.02));
    const fc = wc.map((p) => p.clone().addScaledVector(sunTravel, -p.y / sunTravel.y));
    const pos = [], ab = [], idx = [];
    for (let s = 0; s < 4; s++) {
      const a = s, b = (s + 1) % 4, base = pos.length / 3;
      pos.push(...wc[a].toArray(), ...wc[b].toArray(), ...fc[b].toArray(), ...fc[a].toArray());
      ab.push(0, 0, 1, 0, 1, 1, 0, 1);
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    beamGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    beamGeo.setAttribute('aBeam', new THREE.Float32BufferAttribute(ab, 2));
    beamGeo.setIndex(idx);
  }
  const beam = new THREE.Mesh(beamGeo, new THREE.ShaderMaterial({
    vertexShader: BEAM_VERT, fragmentShader: BEAM_FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    uniforms: { uColor: { value: new THREE.Color(0xffd9a0).multiplyScalar(0.22) }, uTime: uniforms.time },
  }));
  beam.renderOrder = 2;
  scene.add(beam);

  const moteCount = low ? 24 : 90;
  const motePos = new Float32Array(moteCount * 3), moteSeed = new Float32Array(moteCount);
  for (let i = 0; i < moteCount; i++) {
    const p = new THREE.Vector3(WIN.x0 + rand() * (WIN.x1 - WIN.x0), WIN.y0 + rand() * (WIN.y1 - WIN.y0), z0 + 0.05);
    p.addScaledVector(sunTravel, (0.1 + rand() * 0.8) * (-p.y / sunTravel.y));
    motePos.set(p.toArray(), i * 3);
    moteSeed[i] = rand();
  }
  const moteGeo = new THREE.BufferGeometry();
  moteGeo.setAttribute('position', new THREE.BufferAttribute(motePos, 3));
  moteGeo.setAttribute('aSeed', new THREE.BufferAttribute(moteSeed, 1));
  const moteScale = { value: 800 };
  const motes = new THREE.Points(moteGeo, new THREE.ShaderMaterial({
    vertexShader: MOTE_VERT, fragmentShader: MOTE_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uTime: uniforms.time, uScale: moteScale, uColor: { value: new THREE.Color(0xffe2a8).multiplyScalar(1.6) } },
  }));
  motes.frustumCulled = false;
  motes.renderOrder = 3;
  scene.add(motes);

  /* --------------------------------------------------------------------------------------------
   * Camera fit: the room's bounding box fills the region between the header and the menu footer.
   * ------------------------------------------------------------------------------------------ */
  const target = new THREE.Vector3((x0 - T + x1) / 2, H * 0.4, (z0 - T + z1) / 2);
  const corners = [];
  for (const x of [x0 - T, x1]) for (const y of [-F - 0.04, H]) for (const z of [z0 - T, z1]) corners.push(new THREE.Vector3(x, y, z));
  // az / el: camera azimuth (from +z toward +x) and elevation; portrait screens get a steeper view.
  const fit = { dist: 20, top: 130, bottom: 170, near: 10, far: 30, w: 1, h: 1, az: 40 * DEG, el: 30 * DEG, portrait: false };
  const tmp = new THREE.Vector3(), dir = new THREE.Vector3();
  function placeCamera(az, el, dist) {
    dir.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
    camera.position.copy(target).addScaledVector(dir, dist);
    camera.lookAt(target);
    camera.updateMatrixWorld();
  }
  function layout(w, h) {
    const mobile = w < 780;
    const aspect = w / h;
    fit.w = w; fit.h = h;
    fit.portrait = aspect < 1;
    fit.top = mobile ? 96 : 116;
    fit.bottom = 150;
    // steeper on portrait (the floor gets taller on screen), 30 deg on landscape, blended in between
    const k0 = clamp01((1.3 - aspect) / 0.5);
    // phones (tall portrait) go steeper still, so the floor fills more of the tall band
    const k1 = clamp01((0.75 - aspect) / 0.3);
    fit.el = (30 + 8 * k0 + 6 * k1) * DEG;
    fit.az = (40 - 3 * k0 - 2 * k1) * DEG;
    const side = mobile ? Math.max(14, w * 0.04) : Math.max(24, w * 0.05);
    // keep the horizontal field of view (and so the camera distance / line weight) roughly constant
    camera.fov = aspect >= 1.4 ? 24 : 2 * Math.atan(Math.tan(12 * DEG) * 1.4 / aspect) / DEG;
    camera.aspect = aspect;
    camera.clearViewOffset();
    const rw = w - side * 2, rh = Math.max(80, h - fit.top - fit.bottom);
    let dist = 20, minX = 0, maxX = 0, minY = 0, maxY = 0;
    for (let k = 0; k < 6; k++) {
      placeCamera(fit.az, fit.el, dist);
      camera.updateProjectionMatrix();
      minX = minY = Infinity; maxX = maxY = -Infinity;
      for (const c of corners) {
        tmp.copy(c).project(camera);
        minX = Math.min(minX, tmp.x); maxX = Math.max(maxX, tmp.x);
        minY = Math.min(minY, tmp.y); maxY = Math.max(maxY, tmp.y);
      }
      const s = Math.max(((maxX - minX) * w / 2) / rw, ((maxY - minY) * h / 2) / rh);
      dist *= 0.35 + 0.65 * s;
    }
    fit.dist = dist;
    const cx = ((minX + maxX) / 2 + 1) / 2 * w, cy = (1 - (minY + maxY) / 2) / 2 * h;
    // spare height (width-limited fits): keep the room a little low, the band above holds the labels
    const spare = Math.max(0, rh - (maxY - minY) * h / 2);
    camera.setViewOffset(w, h, cx - w / 2, cy - (fit.top + rh / 2) - spare * 0.18, w, h);
    fit.near = dist - 9; fit.far = dist + 9;
    const O = stage.pipeline.params.outline;
    O.fadeStart = dist + 30; O.fadeEnd = dist + 60;
    moteScale.value = h * stage.pixelRatio / (2 * Math.tan(camera.fov * DEG / 2));
    hullPx.value = 2 * Math.tan(camera.fov * DEG / 2) / h;
    measureLabels();
  }
  /* --------------------------------------------------------------------------------------------
   * Labels: the real <li><a class="pviewa"> elements float above their objects (CSS vars) and are
   * pushed apart with a small 2D relaxation.
   * ------------------------------------------------------------------------------------------ */
  function measureLabels() {
    for (const e of entries) {
      if (!e.el) continue;
      e.w = e.el.offsetWidth || 80;
      e.lh = e.el.offsetHeight || 30;
    }
  }
  const GAP = 16, PAD = 6;
  // writes a CSS variable only when its rounded value changed (no string building on idle frames)
  function setVar(e, k, name, v, unit = 'px', scale = 10) {
    const r = Math.round(v * scale);
    if (e.css[k] !== r) { e.css[k] = r; e.el.style.setProperty(name, (r / scale) + unit); }
  }
  const vis = [];
  function updateLabels(dt, snap) {
    const w = fit.w, h = fit.h;
    // portrait: the room sits low, so labels of tall / wall objects use the calm band above it
    const gapUp = fit.portrait ? 34 : GAP;
    vis.length = 0;
    for (const e of entries) {
      e.anchorW.copy(e.spec.anchor);
      e.content.localToWorld(e.anchorW);
      const d = tmp.copy(e.anchorW).sub(camera.position).length();
      tmp.copy(e.anchorW).project(camera);
      e.ax = (tmp.x + 1) / 2 * w;
      e.ay = (1 - tmp.y) / 2 * h;
      e.depth = clamp01((d - fit.near) / (fit.far - fit.near));
      const inView = tmp.z < 1 && e.ax > -20 && e.ax < w + 20 && e.ay > 0 && e.ay < h;
      e.onScreen = inView && e.pop > 0.7;
      // target: label bottom-centre above the anchor
      const dirn = e.spec.label || 'up';
      if (dirn === 'down') { e.tx = e.ax; e.ty = e.ay + GAP + e.lh; }
      else if (dirn === 'right') { e.tx = e.ax + GAP + e.w / 2; e.ty = e.ay + e.lh / 2; }
      else if (dirn === 'left') { e.tx = e.ax - GAP - e.w / 2; e.ty = e.ay + e.lh / 2; }
      else { e.tx = e.ax; e.ty = e.ay - gapUp; }
      if (e.onScreen) vis.push(e);
    }
    // relax (start from targets every frame, deterministic order)
    for (const e of vis) { e.px = e.tx; e.py = e.ty; }
    const minY = 86, maxY = h - fit.bottom + 40;
    for (let it = 0; it < 12; it++) {
      let moved = false;
      for (let a = 0; a < vis.length; a++) {
        for (let b = a + 1; b < vis.length; b++) {
          const A = vis[a], B = vis[b];
          const ox = (A.w + B.w) / 2 + PAD - Math.abs(A.px - B.px);
          const oy = (A.lh + B.lh) / 2 + PAD - Math.abs((A.py - A.lh / 2) - (B.py - B.lh / 2));
          if (ox <= 0 || oy <= 0) continue;
          moved = true;
          if (oy * 1.6 < ox) {
            const s = A.py < B.py || (A.py === B.py && a < b) ? -1 : 1;
            A.py += s * oy / 2; B.py -= s * oy / 2;
          } else {
            const s = A.px < B.px || (A.px === B.px && a < b) ? -1 : 1;
            A.px += s * ox / 2; B.px -= s * ox / 2;
          }
        }
      }
      // a label must not cover another object's pin (its thread would vanish under the tag)
      for (const A of vis) {
        for (const B of vis) {
          if (A === B) continue;
          const ox = A.w / 2 + 6 - Math.abs(B.ax - A.px);
          if (ox <= 0 || B.ay < A.py - A.lh - 6 || B.ay > A.py + 6) continue;
          moved = true;
          A.px += (A.px < B.ax ? -1 : 1) * ox;
        }
      }
      for (const e of vis) {
        e.px = Math.min(Math.max(e.px, e.w / 2 + 6), w - e.w / 2 - 6);
        e.py = Math.min(Math.max(e.py, minY + e.lh), maxY);
      }
      if (!moved) break;
    }
    const k = snap ? 1 : 1 - Math.exp(-dt * 14);
    for (const e of entries) {
      if (!e.el) continue;
      if (e.onScreen) {
        if (!e.shown || snap) { e.sx = e.px; e.sy = e.py; } else { e.sx += (e.px - e.sx) * k; e.sy += (e.py - e.sy) * k; }
        setVar(e, 'x', '--npr-x', e.sx);
        setVar(e, 'y', '--npr-y', e.sy);
        const lx = e.ax - e.sx, ly = e.ay - e.sy;
        setVar(e, 'lx', '--npr-lx', lx);
        setVar(e, 'ly', '--npr-ly', ly);
        setVar(e, 'll', '--npr-ll', Math.hypot(lx, ly));
        setVar(e, 'la', '--npr-la', Math.atan2(-lx, ly), 'rad', 1000);
        setVar(e, 'd', '--npr-depth', e.depth, '', 100);
      }
      if (e.shown !== e.onScreen) { e.shown = e.onScreen; e.el.classList.toggle('npr-on-screen', e.onScreen); }
      const act = e.i === activeIndex();
      if (act !== e.activeWas) { e.activeWas = act; e.el.classList.toggle('npr-active', act); }
    }
  }

  /* --------------------------------------------------------------------------------------------
   * Interaction
   * ------------------------------------------------------------------------------------------ */
  let hoverIndex = null, focusIndex = null, pressed = null, lastSelect = 0, disposed = false;
  const activeIndex = () => (hoverIndex !== null ? hoverIndex : focusIndex);
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const proxies = entries.map((e) => e.proxy);
  const hits = [], preciseHits = [];
  let pickX = -1, pickY = -1, pickDirty = false;
  // repaint on demand while the loop is not running (reduced motion renders only when something changes)
  const refresh = () => { if (!stage.running && !disposed) stage.renderOnce(); };

  function pick(x, y) {
    const r = container.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    ndc.set(((x - r.left) / r.width) * 2 - 1, 1 - ((y - r.top) / r.height) * 2);
    ray.setFromCamera(ndc, camera);
    hits.length = 0;
    ray.intersectObjects(proxies, false, hits);
    if (!hits.length) return null;
    // precise test among the candidate objects; fall back to the nearest padded proxy
    let best = null, bestD = Infinity;
    for (const hit of hits) {
      const e = entries[hit.object.userData.index];
      preciseHits.length = 0;
      ray.intersectObject(e.content, true, preciseHits);
      for (const p of preciseHits) {
        if (p.object === e.proxy) continue;
        if (p.distance < bestD) { bestD = p.distance; best = e.i; }
        break; // sorted by distance: the first real surface is the nearest
      }
    }
    return best !== null ? best : hits[0].object.userData.index;
  }
  function setHover(i) {
    if (i === hoverIndex) return;
    hoverIndex = i;
    container.style.cursor = i !== null ? 'pointer' : '';
    if (onHover) onHover(i);
  }
  function select(i) {
    const now = performance.now();
    if (now - lastSelect < 450) return;
    lastSelect = now;
    const e = entries[i];
    if (!e) return;
    if (still || !stage.running) { if (onSelect) onSelect(i); return; }
    e.squashT = 0;
    setTimeout(() => { if (onSelect) onSelect(i); }, 150);
  }
  const onMove = (ev) => {
    if (ev.pointerType === 'touch') return;
    pickX = ev.clientX; pickY = ev.clientY; pickDirty = true;
    if (!stage.running) {
      const was = hoverIndex;
      setHover(pick(pickX, pickY));
      if (hoverIndex !== was) refresh();
    }
  };
  const onLeave = () => {
    pickDirty = false;
    if (hoverIndex === null) return;
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
    if (i === null) return;
    if (ev.pointerType === 'touch') { focusIndex = i; setTimeout(() => { if (focusIndex === i) focusIndex = null; }, 600); }
    select(i);
  };
  container.addEventListener('pointermove', onMove);
  container.addEventListener('pointerleave', onLeave);
  container.addEventListener('pointerdown', onDown);
  container.addEventListener('pointerup', onUp);
  const pointer = createPointer(window, { smoothing: 2.5 });

  /* --------------------------------------------------------------------------------------------
   * Frame update
   * ------------------------------------------------------------------------------------------ */
  // Not yet shown: objects wait at pop 0 (the idle mount renders just the empty shell) until the intro
  // runs; after a close the room returns to this state so every open pops in fresh.
  let introT = still ? INTRO + 1 : 0;
  let frozen = null;
  let shadowDirty = true;
  const n = entries.length;

  function updateEntries(dt, T) {
    let animating = false;
    const act = activeIndex();
    for (const e of entries) {
      const on = e.i === act;
      if (on && !e.activeWas2) { e.wobT = 0; }
      e.activeWas2 = on;
      // highlight fade
      const ht = on ? 1 : 0;
      e.h = still ? ht : e.h + (ht - e.h) * (1 - Math.exp(-dt * 12));
      // lift: under-damped spring
      const lt = on ? 1 : 0;
      if (still) { e.lift = lt; e.liftV = 0; } else {
        const acc = (lt - e.lift) * 170 - e.liftV * 15;
        e.liftV += acc * dt; e.lift += e.liftV * dt;
      }
      e.wobT += dt;
      const wob = still ? 0 : Math.exp(-e.wobT * 3.2) * Math.sin(e.wobT * 16) * 0.05 + (on ? Math.sin(T * 2.3 + e.i) * 0.012 : 0);
      // intro pop
      if (introT <= INTRO) {
        const delay = 0.04 + (n > 1 ? (0.3 * e.order) / (n - 1) : 0);
        e.pop = easeOutBack(clamp01((introT - delay) / 0.36));
      } else e.pop = 1;
      // click squash
      let sq = 1, sxz = 1;
      if (e.squashT !== undefined && e.squashT < 0.22) {
        e.squashT += dt;
        const p = Math.sin(Math.PI * clamp01(e.squashT / 0.22));
        sq = 1 - 0.12 * p; sxz = 1 + 0.06 * p;
      }
      const wall = e.spec.wall;
      e.anim.position.copy(e.spec.pivot);
      if (wall) { e.anim.position.z += e.lift * 0.12; e.anim.position.y += e.lift * 0.05; } else e.anim.position.y += e.lift * 0.14;
      e.anim.position.y += (1 - Math.min(e.pop, 1)) * 0.5;
      const ps = Math.max(0.001, e.pop);
      e.anim.scale.set(ps * sxz, ps * sq, ps * sxz);
      if (wall) e.anim.rotation.set(0, 0, wob); else e.anim.rotation.set(wob * 0.6, 0, wob);
      // accent highlight
      e.hull.visible = e.h > 0.01;
      e.hullMat.uniforms.uWidth.value = e.h * 3.5;
      for (const m of e.mats) {
        m.emissive.copy(accentCol).multiplyScalar(e.h * 0.06);
        m.rimStrength = e.h * 0.25;
      }
      if (e.spec.update) e.spec.update(T, on);
      // an active object sways continuously: keep it "moving" through the sway's zero crossings (where it is
      // fastest), otherwise its shadow froze for a few frames there and then jumped
      const moving = (on && !still) || Math.abs(e.lift - lt) > 0.002 || Math.abs(e.liftV) > 0.01 || e.pop < 1 || sq !== 1 || Math.abs(wob) > 0.002;
      if (moving) animating = true;
      e.root.updateMatrixWorld(true);
    }
    return animating;
  }

  // intro stagger: left-to-right as seen on screen
  {
    const sorted = entries.slice().sort((a, b) => (a.root.position.x - a.root.position.z) - (b.root.position.x - b.root.position.z));
    sorted.forEach((e, k) => { e.order = k; });
  }

  function update(dt, t) {
    const T = frozen !== null ? frozen : still ? 2 : t;
    uniforms.time.value = T;
    pointer.update(dt);
    if (pickDirty) { pickDirty = false; setHover(pick(pickX, pickY)); }
    // camera: intro ease + gentle parallax
    if (introT <= INTRO) introT += dt;
    const e = easeOutCubic(clamp01(introT / INTRO));
    const px = still ? 0 : pointer.x, py = still ? 0 : pointer.y;
    placeCamera(fit.az + px * 2.5 * DEG - (1 - e) * 9 * DEG, fit.el - py * 1.5 * DEG + (1 - e) * 5 * DEG, fit.dist * (1 + (1 - e) * 0.16));
    decor.update(T);
    const animating = updateEntries(dt, T);
    if (animating || introT <= INTRO) placeBlobs();
    // the shadow map only changes while objects move (idle sway casts no shadow); one more refresh once
    // they settle, so the resting pose's shadow is exact
    if (animating || introT <= INTRO || shadowDirty) {
      renderer.shadowMap.needsUpdate = true;
      shadowDirty = animating;
    }
    updateLabels(dt, dt === 0);
  }

  stage.onResize(layout);
  stage.onUpdate(update);
  stage.setScene(scene, camera);
  layout(Math.max(1, stage.width), Math.max(1, stage.height));

  // compile everything (hulls included) before the first frame
  for (const e of entries) e.hull.visible = true;
  await stage.compile();
  for (const e of entries) e.hull.visible = false;
  measureLabels();
  stage.renderOnce();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if (!disposed) { measureLabels(); refresh(); } });

  const ctrl = {
    stage,
    // reduced motion: nothing moves, so no loop — one frame now, more only on hover / focus / resize
    start() {
      if (disposed) return;
      measureLabels();
      if (still) stage.renderOnce(); else stage.start();
    },
    stop() {
      stage.stop();
      setHover(null);
      if (disposed) return;
      if (!still) {
        // back to the pre-intro state, so the next open never flashes the previous (finished) room
        introT = 0;
        for (const e of entries) { e.pop = 0; e.h = 0; e.lift = 0; e.liftV = 0; e.wobT = 9; }
        shadowDirty = true;
      }
      stage.renderOnce();
    },
    focus(i) {
      focusIndex = i === null || i === undefined || !entries[i] ? null : i;
      refresh();
    },
    playIntro() {
      if (still || disposed) return;
      introT = -INTRO_HOLD;
      shadowDirty = true;
    },
    // extras (debug / harness)
    setTime(t) { frozen = t === null || t === undefined ? null : +t; shadowDirty = true; refresh(); },
    anchors() {
      return entries.map((en) => {
        en.hull.geometry.boundingBox.getCenter(tmp);
        en.content.localToWorld(tmp).project(camera);
        return { key: en.key, name: en.item.name, x: en.ax, y: en.ay, label: [en.sx, en.sy], onScreen: en.onScreen,
          center: [(tmp.x + 1) / 2 * fit.w, (1 - tmp.y) / 2 * fit.h] };
      });
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
      for (const en of entries) {
        if (!en.el) continue;
        en.el.classList.remove('npr-on-screen', 'npr-active');
        for (const k of ['--npr-x', '--npr-y', '--npr-lx', '--npr-ly', '--npr-ll', '--npr-la', '--npr-depth']) en.el.style.removeProperty(k);
      }
      const seen = new Set();
      scene.traverse((o) => {
        if (o.geometry && !seen.has(o.geometry)) { seen.add(o.geometry); o.geometry.dispose(); }
        const ms = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
        for (const m of ms) if (!seen.has(m)) { seen.add(m); m.dispose(); }
        if (o.isLight && o.shadow && o.shadow.map) o.shadow.map.dispose();
      });
      proxyMat.dispose();
      for (const t of disposables) t.dispose();
      stage.dispose();
    },
  };
  return ctrl;
}
