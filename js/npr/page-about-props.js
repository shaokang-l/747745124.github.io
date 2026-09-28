// Procedural geometry for the About banner ("the maker's desk", page-about.js): a merged vertex-coloured
// parts builder, painted canvas textures, the floating desk, the robot mascot and one builder per prop.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { TeapotGeometry } from 'three/addons/geometries/TeapotGeometry.js';
import { createToonMaterial, markOutline } from './core.js';

export const C = {
  paper: 0xf4eee3, cream: 0xefe4cf, wood: 0xb07a4f, darkWood: 0x8a5a3b, teal: 0x5f8f8b, terracotta: 0xc96f4a,
  mustard: 0xe0b04f, navy: 0x2f3a56, ink: 0x3a2618, brass: 0xd6a54a, white: 0xf7f0e2, sage: 0x86a376,
  rose: 0xdc9580, bot: 0x2c3148, botDark: 0x1f2334, red: 0xd9544a, silver: 0xe2d8c5,
};

const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _n = new THREE.Vector3();
const _nm = new THREE.Matrix3();
const _c = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);

/* ------------------------------------------------------------------------------------------------
 * Parts: primitives (transform + colour) merged into one vertex-coloured geometry = one draw call.
 * ---------------------------------------------------------------------------------------------- */
export class Parts {
  constructor() { this.items = []; }

  // t: { p:[x,y,z], r:[x,y,z] (euler), s: number|[x,y,z], parent: Matrix4 }; color: hex or fn(normal) -> hex
  add(geo, color, t = {}) {
    _q.setFromEuler(_e.set(...(t.r || [0, 0, 0])));
    if (t.s === undefined) _s.set(1, 1, 1); else if (typeof t.s === 'number') _s.setScalar(t.s); else _s.set(...t.s);
    const m = new THREE.Matrix4().compose(_p.set(...(t.p || [0, 0, 0])), _q, _s);
    if (t.parent) m.premultiply(t.parent);
    this.items.push({ geo, color, m });
    return this;
  }
  box(w, h, d, color, t, radius = 0) {
    const g = radius > 0 ? new RoundedBoxGeometry(w, h, d, 2, Math.min(radius, w / 2, h / 2, d / 2) * 0.999) : new THREE.BoxGeometry(w, h, d);
    return this.add(g, color, t);
  }
  cyl(rt, rb, h, color, t, seg = 18) { return this.add(new THREE.CylinderGeometry(rt, rb, h, seg), color, t); }
  sphere(r, color, t, ws = 16, hs = 12) { return this.add(new THREE.SphereGeometry(r, ws, hs), color, t); }
  torus(r, tube, color, t, rs = 6, ts = 16) { return this.add(new THREE.TorusGeometry(r, tube, rs, ts), color, t); }
  tube(points, r, color, t, seg = 20, rs = 6) {
    const curve = new THREE.CatmullRomCurve3(points.map((v) => new THREE.Vector3(...v)));
    return this.add(new THREE.TubeGeometry(curve, seg, r, rs, false), color, t);
  }
  // Round rod of radius r from a to b.
  rod(a, b, r, color, t = {}, seg = 10) {
    const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b);
    const dir = vb.clone().sub(va);
    const g = new THREE.CylinderGeometry(r, r, dir.length(), seg);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, dir.normalize()));
    return this.add(g, color, { ...t, p: va.add(vb).multiplyScalar(0.5).toArray() });
  }

  build() {
    let nv = 0, ni = 0;
    for (const it of this.items) {
      if (!it.geo.attributes.normal) it.geo.computeVertexNormals();
      nv += it.geo.attributes.position.count;
      ni += it.geo.index ? it.geo.index.count : it.geo.attributes.position.count;
    }
    const pos = new Float32Array(nv * 3), nrm = new Float32Array(nv * 3), col = new Float32Array(nv * 3);
    const idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
    let vo = 0, io = 0;
    for (const it of this.items) {
      const g = it.geo, P = g.attributes.position, N = g.attributes.normal;
      _nm.getNormalMatrix(it.m);
      const fn = typeof it.color === 'function';
      if (!fn) _c.set(it.color);
      for (let i = 0; i < P.count; i++) {
        _p.fromBufferAttribute(P, i).applyMatrix4(it.m);
        pos[(vo + i) * 3] = _p.x; pos[(vo + i) * 3 + 1] = _p.y; pos[(vo + i) * 3 + 2] = _p.z;
        _n.fromBufferAttribute(N, i);
        if (fn) _c.set(it.color(_n));
        _n.applyMatrix3(_nm).normalize();
        nrm[(vo + i) * 3] = _n.x; nrm[(vo + i) * 3 + 1] = _n.y; nrm[(vo + i) * 3 + 2] = _n.z;
        col[(vo + i) * 3] = _c.r; col[(vo + i) * 3 + 1] = _c.g; col[(vo + i) * 3 + 2] = _c.b;
      }
      if (g.index) for (let i = 0; i < g.index.count; i++) idx[io + i] = g.index.getX(i) + vo;
      else for (let i = 0; i < P.count; i++) idx[io + i] = i + vo;
      io += g.index ? g.index.count : P.count;
      vo += P.count;
      g.dispose();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeBoundingSphere();
    geo.computeBoundingBox();
    this.items.length = 0;
    return geo;
  }
}

// Face-colour helper for boxes: pick by the dominant axis of the local normal.
function faces({ px, nx, py, ny, pz, nz, other }) {
  return (n) => {
    const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
    let c;
    if (ax >= ay && ax >= az) c = n.x > 0 ? px : nx;
    else if (ay >= az) c = n.y > 0 ? py : ny;
    else c = n.z > 0 ? pz : nz;
    return c !== undefined ? c : other;
  };
}
const topSide = (top, side) => (n) => (n.y > 0.5 ? top : side);

/* ------------------------------------------------------------------------------------------------
 * Materials and meshes
 * ---------------------------------------------------------------------------------------------- */
const TOON = { bands: 3, softness: 0.05, shadeLift: 0.35 };
export function vcMaterial(extra) { return createToonMaterial({ color: 0xffffff, vertexColors: true, ...TOON, ...extra }); }
export function toon(color, extra) { return createToonMaterial({ color, ...TOON, ...extra }); }
// HDR colour above the bloom threshold (bulbs)
export function glow(color, k) { return new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k) }); }

export function mesh(geo, mat, { cast = true, receive = true, outline = true } = {}) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = cast; m.receiveShadow = receive;
  if (outline) markOutline(m);
  return m;
}

/* ------------------------------------------------------------------------------------------------
 * Painted canvas textures
 * ---------------------------------------------------------------------------------------------- */
function canvasTex(w, h, draw) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  draw(cv.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// Desk top: planks with seams, grain and a few knots (mapped on a circle, so the planks run along x).
export function plankTexture(rand) {
  return canvasTex(512, 512, (g, w, h) => {
    const tones = ['#c48d5d', '#bb8455', '#c99463', '#b98253', '#c28a5a'];
    const n = 9, ph = h / n;
    for (let i = 0; i < n; i++) {
      g.fillStyle = tones[i % tones.length];
      g.fillRect(0, i * ph, w, ph);
      g.strokeStyle = 'rgba(110,70,40,0.22)';
      g.lineWidth = 1.2;
      for (let k = 0; k < 5; k++) {
        const y0 = i * ph + 6 + rand() * (ph - 12);
        g.beginPath(); g.moveTo(0, y0);
        for (let x = 0; x <= w; x += 32) g.lineTo(x, y0 + Math.sin(x * 0.02 + k + i) * 2.5);
        g.stroke();
      }
      g.fillStyle = 'rgba(80,50,30,0.55)';
      g.fillRect(0, i * ph - 1.5, w, 3);
      const bx = rand() * w;
      g.fillRect(bx, i * ph, 3, ph);
      if (rand() < 0.5) {
        g.strokeStyle = 'rgba(110,70,40,0.4)';
        g.beginPath(); g.ellipse(rand() * w, i * ph + ph / 2, 9, 4, 0, 0, 7); g.stroke();
      }
    }
  });
}

// Open sketchbook spread: product sketches (the robot, a teapot) in pencil with dimension lines.
export function sketchTexture(rand) {
  return canvasTex(512, 320, (g, w, h) => {
    g.fillStyle = '#fbf6ea'; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(95,143,139,0.18)'; g.lineWidth = 1;
    for (let x = 12; x < w; x += 16) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
    for (let y = 12; y < h; y += 16) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
    const gut = g.createLinearGradient(w / 2 - 18, 0, w / 2 + 18, 0);
    gut.addColorStop(0, 'rgba(120,90,60,0)'); gut.addColorStop(0.5, 'rgba(120,90,60,0.28)'); gut.addColorStop(1, 'rgba(120,90,60,0)');
    g.fillStyle = gut; g.fillRect(w / 2 - 18, 0, 36, h);
    const j = () => (rand() - 0.5) * 2.5;
    const line = (pts, width = 2, color = 'rgba(58,52,70,0.8)') => {
      g.strokeStyle = color; g.lineWidth = width; g.lineCap = 'round'; g.lineJoin = 'round';
      for (let pass = 0; pass < 2; pass++) {
        g.beginPath(); g.moveTo(pts[0][0] + j(), pts[0][1] + j());
        for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0] + j(), pts[i][1] + j());
        g.stroke();
      }
    };
    const rect = (x, y, rw, rh, width) => line([[x, y], [x + rw, y], [x + rw, y + rh], [x, y + rh], [x, y]], width);
    // left page: the robot, front view + dimension line
    rect(70, 70, 90, 70, 2.4); rect(105, 140, 20, 14, 2); rect(62, 154, 106, 100, 2.4);
    for (let k = 0; k < 4; k++) line([[76, 172 + k * 20], [154, 172 + k * 20]], 2);
    g.beginPath(); g.arc(96, 100, 11, 0, 7); g.arc(134, 100, 11, 0, 7); g.stroke();
    line([[100, 124], [130, 124]], 3);
    line([[62, 170], [40, 200], [44, 238]], 2.2); line([[168, 170], [190, 200], [186, 238]], 2.2);
    line([[196, 70], [196, 254]], 1.2, 'rgba(201,111,74,0.85)');
    line([[190, 70], [202, 70]], 1.2, 'rgba(201,111,74,0.85)'); line([[190, 254], [202, 254]], 1.2, 'rgba(201,111,74,0.85)');
    g.fillStyle = 'rgba(201,111,74,0.9)'; g.font = 'italic 15px Georgia, serif'; g.fillText('R-01', 70, 285);
    // right page: teapot silhouette studies + scribbled notes
    g.beginPath(); g.ellipse(360, 150, 62, 48, 0, 0, 7); g.lineWidth = 2.4; g.strokeStyle = 'rgba(58,52,70,0.8)'; g.stroke();
    line([[298, 150], [270, 118], [262, 104]], 2.2); line([[422, 128], [450, 140], [440, 170], [416, 176]], 2.2);
    line([[338, 102], [360, 88], [382, 102]], 2.2);
    g.beginPath(); g.ellipse(360, 150, 62, 12, 0, 0, 7); g.lineWidth = 1; g.stroke();
    for (let k = 0; k < 4; k++) line([[300, 232 + k * 16], [300 + 90 + rand() * 80, 232 + k * 16]], 1.4, 'rgba(58,52,70,0.45)');
    g.strokeStyle = 'rgba(224,176,79,0.55)'; g.lineWidth = 7;
    g.beginPath(); g.moveTo(300, 206); g.lineTo(420, 206); g.stroke();
  });
}

export function blobTexture() {
  const t = canvasTex(64, 64, (g, w, h) => {
    const r = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.5, 'rgba(255,255,255,0.6)'); r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r; g.fillRect(0, 0, w, h);
  });
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

/* ------------------------------------------------------------------------------------------------
 * The floating desk top (radius 1 on x/z, scaled per layout by the caller), top surface at y = 0
 * ---------------------------------------------------------------------------------------------- */
export const DESK_T = 0.26;
export function buildDesk(ctx) {
  const group = new THREE.Group();
  const P = new Parts();
  P.cyl(1, 0.97, DESK_T, topSide(C.wood, C.darkWood), { p: [0, -DESK_T / 2, 0] }, 64);
  P.cyl(0.95, 0.9, 0.05, C.ink, { p: [0, -DESK_T - 0.02, 0] }, 48);
  const slab = mesh(P.build(), ctx.track(vcMaterial()), { cast: false });
  const top = mesh(new THREE.CircleGeometry(0.985, 64), ctx.track(toon(0xffffff, { map: ctx.textures.planks })), { cast: false, outline: false });
  top.rotation.x = -Math.PI / 2;
  top.position.y = 0.002;
  group.add(slab, top);
  return group;
}

/* ------------------------------------------------------------------------------------------------
 * The robot mascot (the blog logo): boxy head with ring eyes, striped torso, hooked arms, Santa hat.
 * Faces +z. Returned parts are animated by page-about.js.
 * ---------------------------------------------------------------------------------------------- */
export function buildRobot(ctx) {
  const mat = ctx.track(vcMaterial({ shadeColor: 0xb7b3dc }));
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  let P = new Parts();
  for (const x of [-0.14, 0.14]) {
    P.box(0.17, 0.08, 0.24, C.botDark, { p: [x, 0.04, 0.02] }, 0.035);
    P.cyl(0.055, 0.06, 0.16, C.silver, { p: [x, 0.16, 0] }, 12);
  }
  const legs = mesh(P.build(), mat);
  root.add(legs);

  P = new Parts();
  P.box(0.62, 0.56, 0.4, C.bot, { p: [0, 0.52, 0] }, 0.07);
  for (let k = 0; k < 4; k++) P.box(0.42, 0.045, 0.03, C.white, { p: [0, 0.37 + k * 0.1, 0.2] }, 0.012);
  P.cyl(0.1, 0.12, 0.12, C.silver, { p: [0, 0.84, 0] }, 14);
  body.add(mesh(P.build(), mat));

  // head (pivot at the neck)
  const head = new THREE.Group();
  head.position.set(0, 0.88, 0);
  body.add(head);
  P = new Parts();
  P.box(0.68, 0.5, 0.46, C.bot, { p: [0, 0.27, 0] }, 0.07);
  P.box(0.2, 0.05, 0.03, C.white, { p: [0, 0.14, 0.23] }, 0.015);
  // Santa hat: brim, bent cone, pompom
  P.torus(0.24, 0.055, C.white, { p: [0, 0.53, 0], r: [Math.PI / 2, 0, 0], s: [1, 0.85, 1] }, 8, 24);
  P.cyl(0.02, 0.23, 0.34, C.red, { p: [0.05, 0.69, -0.02], r: [0, 0, -0.35] }, 16);
  P.sphere(0.065, C.white, { p: [0.19, 0.83, -0.03] }, 12, 10);
  head.add(mesh(P.build(), mat));

  // eyes (white rings) + pupils; the eye group scales in y to blink
  const eyes = new THREE.Group();
  eyes.position.set(0, 0.3, 0.232);
  head.add(eyes);
  P = new Parts();
  for (const x of [-0.14, 0.14]) P.cyl(0.085, 0.085, 0.02, C.white, { p: [x, 0, 0], r: [Math.PI / 2, 0, 0] }, 20);
  eyes.add(mesh(P.build(), mat, { cast: false }));
  P = new Parts();
  for (const x of [-0.14, 0.14]) P.cyl(0.046, 0.046, 0.02, C.botDark, { p: [x, 0, 0.012], r: [Math.PI / 2, 0, 0] }, 16);
  const pupils = mesh(P.build(), mat, { cast: false, outline: false });
  eyes.add(pupils);

  // arms: pivot at the shoulder, hanging down and out, hooked hands
  const arms = [];
  for (const side of [-1, 1]) {
    const arm = new THREE.Group();
    arm.position.set(side * 0.3, 0.7, 0);
    body.add(arm);
    P = new Parts();
    P.tube([[0, 0, 0], [side * 0.1, -0.05, 0], [side * 0.15, -0.2, 0.03], [side * 0.15, -0.32, 0.05]], 0.05, C.bot, {}, 16, 8);
    P.sphere(0.075, C.bot, { p: [side * 0.15, -0.38, 0.05] }, 14, 10);
    P.torus(0.06, 0.016, C.white, { p: [side * 0.15, -0.38, 0.05], r: [0.4, side * 0.6, 0.7] }, 6, 16);
    arm.add(mesh(P.build(), mat));
    arms.push(arm);
  }
  root.traverse((o) => { if (o.isMesh) o.userData.robot = true; });
  return { root, body, head, eyes, pupils, armL: arms[0], armR: arms[1], mat, anchor: new THREE.Vector3(0.1, 1.84, 0) };
}

/* ------------------------------------------------------------------------------------------------
 * Props. Each builder fills `content` (floor centre at the origin, facing +z) and returns
 * { anchor (label point, content space), update?(t) }. ctx.mat() returns the prop's material.
 * ---------------------------------------------------------------------------------------------- */
function camera(content, ctx) {
  const P = new Parts();
  P.box(0.56, 0.3, 0.24, C.navy, { p: [0, 0.15, 0] }, 0.04);
  P.box(0.58, 0.07, 0.25, C.silver, { p: [0, 0.325, 0] }, 0.025);
  P.box(0.2, 0.11, 0.2, C.silver, { p: [0, 0.4, -0.01] }, 0.03);
  P.box(0.12, 0.05, 0.02, 0x3c6f7a, { p: [0, 0.41, 0.095] }, 0.01);
  P.cyl(0.032, 0.032, 0.04, C.terracotta, { p: [0.19, 0.375, 0.02] }, 12);
  P.cyl(0.055, 0.055, 0.04, C.navy, { p: [-0.18, 0.375, 0] }, 14);
  P.cyl(0.125, 0.125, 0.1, C.silver, { p: [0, 0.16, 0.17], r: [Math.PI / 2, 0, 0] }, 22);
  P.cyl(0.13, 0.12, 0.05, C.botDark, { p: [0, 0.16, 0.24], r: [Math.PI / 2, 0, 0] }, 22);
  P.cyl(0.085, 0.085, 0.02, 0x3c6f7a, { p: [0, 0.16, 0.26], r: [Math.PI / 2, 0, 0] }, 20);
  P.sphere(0.022, C.white, { p: [0.035, 0.2, 0.27] }, 8, 6);
  P.tube([[-0.29, 0.26, 0], [-0.42, 0.12, -0.12], [-0.2, 0.02, -0.38], [0.2, 0.02, -0.4], [0.42, 0.1, -0.14], [0.29, 0.26, 0]], 0.018, C.terracotta, {}, 40, 5);
  content.add(mesh(P.build(), ctx.mat()));
  return { anchor: new THREE.Vector3(0, 0.62, 0) };
}

function keyboard(content, ctx) {
  const P = new Parts();
  P.box(1.1, 0.09, 0.42, C.terracotta, { p: [0, 0.045, 0] }, 0.03);
  P.box(1.0, 0.03, 0.1, C.navy, { p: [0, 0.1, -0.14] }, 0.01);
  for (const x of [-0.42, -0.33, 0.3, 0.4]) P.cyl(0.03, 0.03, 0.045, C.mustard, { p: [x, 0.13, -0.14] }, 12);
  P.box(0.12, 0.012, 0.05, 0x9fd0c4, { p: [0, 0.12, -0.14] });
  const n = 15, kw = 0.062, gap = 0.006, x0 = -((n * kw + (n - 1) * gap) / 2) + kw / 2;
  for (let k = 0; k < n; k++) P.box(kw, 0.035, 0.22, C.white, { p: [x0 + k * (kw + gap), 0.105, 0.07] }, 0.008);
  for (let k = 0; k < n - 1; k++) {
    if (![0, 1, 3, 4, 5].includes(k % 7)) continue;
    P.box(0.036, 0.04, 0.13, C.botDark, { p: [x0 + k * (kw + gap) + (kw + gap) / 2, 0.13, 0.025] }, 0.006);
  }
  content.add(mesh(P.build(), ctx.mat()));
  return { anchor: new THREE.Vector3(0, 0.62, 0) };
}

// Floating eighth notes (one instanced draw), rising from the keyboard.
export function buildNotes(ctx, count) {
  const P = new Parts();
  P.sphere(0.055, C.navy, { p: [0, 0, 0], r: [0, 0, 0.45], s: [1.25, 0.9, 0.7] }, 12, 8);
  P.box(0.018, 0.22, 0.018, C.navy, { p: [0.058, 0.11, 0] });
  P.tube([[0.058, 0.22, 0], [0.1, 0.18, 0], [0.12, 0.12, 0], [0.105, 0.08, 0]], 0.014, C.navy, {}, 10, 5);
  const m = new THREE.InstancedMesh(P.build(), ctx.track(toon(0xffffff, { vertexColors: true })), count);
  m.castShadow = true;
  markOutline(m);
  m.frustumCulled = false;
  return m;
}

function controller(content, ctx) {
  const P = new Parts();
  P.box(0.44, 0.1, 0.22, C.mustard, { p: [0, 0.07, -0.01] }, 0.045);
  for (const s of [-1, 1]) P.sphere(0.13, C.mustard, { p: [s * 0.22, 0.07, 0.05], s: [1, 0.55, 1.25] }, 18, 12);
  P.box(0.12, 0.03, 0.04, C.botDark, { p: [-0.21, 0.13, 0.0] }, 0.01);
  P.box(0.04, 0.03, 0.12, C.botDark, { p: [-0.21, 0.13, 0.0] }, 0.01);
  const btn = [[0.21, -0.05, C.terracotta], [0.26, 0, C.teal], [0.16, 0, C.navy], [0.21, 0.05, C.sage]];
  for (const [x, z, c] of btn) P.cyl(0.024, 0.024, 0.035, c, { p: [x, 0.125, z] }, 12);
  for (const x of [-0.08, 0.08]) {
    P.cyl(0.035, 0.035, 0.04, C.botDark, { p: [x, 0.13, 0.07] }, 12);
    P.cyl(0.045, 0.045, 0.02, C.navy, { p: [x, 0.155, 0.07] }, 14);
  }
  P.box(0.05, 0.015, 0.025, C.cream, { p: [-0.035, 0.12, -0.05] }, 0.006);
  P.box(0.05, 0.015, 0.025, C.cream, { p: [0.035, 0.12, -0.05] }, 0.006);
  P.tube([[0, 0.06, -0.12], [0.02, 0.025, -0.28], [-0.18, 0.018, -0.42], [-0.45, 0.018, -0.38]], 0.016, C.navy, {}, 24, 5);
  content.add(mesh(P.build(), ctx.mat()));
  return { anchor: new THREE.Vector3(0, 0.45, 0) };
}

// Utah teapot on a slowly spinning turntable, lit by an articulated render lamp.
function teapot(content, ctx) {
  const P = new Parts();
  P.cyl(0.43, 0.45, 0.08, C.darkWood, { p: [0, 0.04, 0] }, 32);
  P.sphere(0.018, 0xff9a6a, { p: [0, 0.05, 0.44] }, 8, 6);
  // lamp: base + two arms + shade, reaching over the turntable from behind-right
  const base = [0.5, 0, -0.42], elbow = [0.58, 0.82, -0.5], head = [0.2, 1.12, -0.12];
  P.cyl(0.15, 0.17, 0.05, C.brass, { p: [base[0], 0.025, base[2]] }, 24);
  P.rod([base[0], 0.05, base[2]], elbow, 0.025, C.mustard);
  P.rod(elbow, head, 0.025, C.mustard);
  P.sphere(0.045, C.brass, { p: elbow }, 12, 8);
  P.sphere(0.04, C.brass, { p: head }, 12, 8);
  const aim = new THREE.Vector3(0, 0.3, 0);
  const hv = new THREE.Vector3(...head);
  const dir = aim.clone().sub(hv).normalize();
  const shadeC = hv.clone().addScaledVector(dir, 0.1);
  const shadeGeo = new THREE.CylinderGeometry(0.06, 0.19, 0.22, 24, 1, true);
  shadeGeo.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, dir.clone().negate()));
  P.add(shadeGeo, C.terracotta, { p: shadeC.toArray() });
  const capGeo = new THREE.SphereGeometry(0.07, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  capGeo.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, dir.clone().negate()));
  P.add(capGeo, C.terracotta, { p: hv.clone().addScaledVector(dir, 0.0).toArray() });
  const lampMat = ctx.mat({ side: THREE.DoubleSide });
  content.add(mesh(P.build(), lampMat));

  // spinning platter + teapot
  const spin = new THREE.Group();
  content.add(spin);
  const S = new Parts();
  S.cyl(0.39, 0.39, 0.025, C.cream, { p: [0, 0.0925, 0] }, 32);
  const tg = new TeapotGeometry(0.19, 8);
  tg.computeBoundingBox();
  tg.translate(0, 0.105 - tg.boundingBox.min.y, 0);
  S.add(tg, C.teal);
  spin.add(mesh(S.build(), ctx.mat()));

  // bulb (bloom) + the lamp's light
  const bulbPos = hv.clone().addScaledVector(dir, 0.19);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.055, 14, 10), ctx.track(glow(0xffe2a8, 3.2)));
  bulb.position.copy(bulbPos);
  bulb.userData.noHull = true;
  content.add(bulb);
  const light = new THREE.SpotLight(0xffc27a, 5, 3.2, 0.62, 0.7, 1.4);
  light.position.copy(bulbPos);
  light.target.position.copy(aim).setY(0.1);
  content.add(light, light.target);

  // soft light cone (additive, no outline)
  const len = bulbPos.distanceTo(new THREE.Vector3(0, 0.11, 0));
  const coneGeo = new THREE.CylinderGeometry(0.07, 0.4, len, 24, 1, true);
  coneGeo.translate(0, -len / 2, 0);
  const cone = new THREE.Mesh(coneGeo, ctx.track(new THREE.ShaderMaterial({
    vertexShader: CONE_VERT, fragmentShader: CONE_FRAG, transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uColor: { value: new THREE.Color(0xffd79a).multiplyScalar(0.35) }, uTime: ctx.uniforms.time },
  })));
  cone.position.copy(bulbPos);
  cone.quaternion.setFromUnitVectors(UP, new THREE.Vector3(0, 0.11, 0).sub(bulbPos).normalize().negate());
  cone.renderOrder = 3;
  cone.userData.noHull = true;
  cone.raycast = () => {};
  content.add(cone);

  return {
    anchor: new THREE.Vector3(0, 0.62, 0), // just above the teapot, not the lamp head
    spin, bulb, light,
    update(t) { spin.rotation.y = t * 0.45; },
  };
}

const CONE_VERT = /* glsl */`
varying float vH;
varying float vEdge;
void main() {
  vH = uv.y;
  vec4 mv = modelViewMatrix * vec4( position, 1.0 );
  vec3 n = normalize( normalMatrix * normal );
  vEdge = abs( dot( n, normalize( - mv.xyz ) ) );
  gl_Position = projectionMatrix * mv;
}`;
const CONE_FRAG = /* glsl */`
uniform vec3 uColor;
uniform float uTime;
varying float vH;
varying float vEdge;
void main() {
  float e = clamp( vEdge, 0.0, 1.0 );
  float a = smoothstep( 0.0, 0.8, vH ) * e * e * ( 0.92 + 0.08 * sin( uTime * 1.3 ) );
  gl_FragColor = vec4( uColor * a, 1.0 );
}`;

function sketchbook(content, ctx) {
  const P = new Parts();
  P.box(0.92, 0.03, 0.62, C.navy, { p: [0, 0.015, 0] }, 0.012);
  P.box(0.43, 0.025, 0.58, C.white, { p: [-0.225, 0.042, 0], r: [0, 0, 0.04] }, 0.006);
  P.box(0.43, 0.025, 0.58, C.white, { p: [0.225, 0.042, 0], r: [0, 0, -0.04] }, 0.006);
  for (let k = 0; k < 9; k++) P.torus(0.028, 0.006, C.brass, { p: [0, 0.058, -0.26 + k * 0.065] }, 5, 12);
  // pencil lying across the right page
  const pm = new THREE.Matrix4().compose(new THREE.Vector3(0.18, 0.09, 0.08), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0.55, Math.PI / 2)), new THREE.Vector3(1, 1, 1));
  P.cyl(0.024, 0.024, 0.42, C.mustard, { parent: pm }, 6);
  P.cyl(0.026, 0.026, 0.05, C.brass, { p: [0, 0.235, 0], parent: pm }, 10);
  P.cyl(0.024, 0.024, 0.05, C.rose, { p: [0, 0.285, 0], parent: pm }, 10);
  P.cyl(0.024, 0.008, 0.07, 0xe8c9a0, { p: [0, -0.245, 0], r: [Math.PI, 0, 0], parent: pm }, 6);
  P.cyl(0.008, 0.001, 0.025, C.botDark, { p: [0, -0.29, 0], r: [Math.PI, 0, 0], parent: pm }, 6);
  content.add(mesh(P.build(), ctx.mat()));
  // the drawn spread on top of the pages
  const pages = new THREE.PlaneGeometry(0.86, 0.56);
  const page = mesh(pages, ctx.mat({ map: ctx.textures.sketch, vertexColors: false }), { outline: false, cast: false });
  page.rotation.x = -Math.PI / 2;
  page.position.set(0, 0.0555, 0);
  page.userData.noHull = true;
  content.add(page);
  return { anchor: new THREE.Vector3(0, 0.4, 0) };
}

function gradcap(content, ctx) {
  const P = new Parts();
  const book = (w, h, d, c, y, ry) => P.box(w, h, d, faces({ py: c, ny: c, nx: c, px: C.white, pz: C.white, nz: C.white }), { p: [0, y, 0], r: [0, ry, 0] }, 0.012);
  book(0.7, 0.12, 0.5, C.navy, 0.06, 0.1);
  book(0.64, 0.1, 0.46, C.terracotta, 0.17, -0.08);
  book(0.58, 0.09, 0.42, C.sage, 0.265, 0.14);
  P.cyl(0.17, 0.18, 0.11, C.botDark, { p: [0, 0.365, 0] }, 20);
  P.box(0.48, 0.03, 0.48, C.navy, { p: [0, 0.43, 0], r: [0.06, 0.62, 0] }, 0.01);
  P.cyl(0.026, 0.026, 0.02, C.mustard, { p: [0, 0.455, 0] }, 10);
  P.tube([[0, 0.455, 0], [0.12, 0.455, 0.1], [0.23, 0.445, 0.16], [0.26, 0.36, 0.18], [0.262, 0.3, 0.18]], 0.011, C.mustard, {}, 16, 5);
  P.cyl(0.018, 0.03, 0.08, C.mustard, { p: [0.262, 0.27, 0.18] }, 8);
  content.add(mesh(P.build(), ctx.mat()));
  return { anchor: new THREE.Vector3(0, 0.66, 0) };
}

/* ------------------------------------------------------------------------------------------------
 * Catalogue. `match` finds the prop's line on the About page; `title` is the short label.
 * Positions: [x, z, rotY] on the wide desk (page-about.js squeezes them for portrait screens).
 * ---------------------------------------------------------------------------------------------- */
export const PROPS = [
  { key: 'grad', title: 'Computer Science', match: /UCSB|graduat|毕业|computer science/i, build: gradcap, at: [-1.55, -0.72, 0.3] },
  { key: 'design', title: 'Design', match: /设计|industrial design|sketch/i, build: sketchbook, at: [-2.35, 0.3, 0.3] },
  { key: 'photo', title: 'Photography', match: /摄影|photograph/i, build: camera, at: [-1.08, 0.74, 0.35] },
  { key: 'games', title: 'Games', match: /游戏|\bgames?\b|gaming/i, build: controller, at: [1.08, 0.82, -0.35] },
  { key: 'music', title: 'Music', match: /编曲|作曲|音乐|music|composition/i, build: keyboard, at: [1.35, -0.74, -0.18], atNarrow: [1.4, -1.25], notes: true },
  { key: 'render', title: 'Rendering', match: /渲染|render|computer graphics|图形学/i, build: teapot, at: [2.4, 0.18, -0.35] },
];
