// Procedural geometry for the menu room ("the study"): a merged vertex-coloured parts builder, painted
// canvas textures, the room shell / decor and one builder per interactive object (see room.js).
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { createToonMaterial, markOutline } from './core.js';

export const C = {
  paper: 0xf4eee3, cream: 0xefe4cf, wood: 0xb07a4f, darkWood: 0x8a5a3b, teal: 0x5f8f8b, terracotta: 0xc96f4a,
  mustard: 0xe0b04f, navy: 0x2f3a56, ink: 0x3a2618, cut: 0x6e4a32, brass: 0xd6a54a, kraft: 0xc9a06a,
  cork: 0xc99a66, sage: 0x86a376, rose: 0xdc9580, white: 0xf7f0e2,
};

// Room box (floor top at y = 0). Walls stand on the far x (left) and far z (back) sides.
export const ROOM = { W: 8.6, D: 5.8, H: 3.3, T: 0.24, F: 0.34 };
ROOM.x0 = -ROOM.W / 2; ROOM.x1 = ROOM.W / 2; ROOM.z0 = -ROOM.D / 2; ROOM.z1 = ROOM.D / 2;
// Window opening in the back wall.
export const WIN = { x0: -1.1, x1: 1.1, y0: 1.05, y1: 2.75 };
// Kilim rug (centre x, z; half sizes) — the sun patch falls half on it, half on the boards.
export const RUG = { x: 0.1, z: 0.6, hx: 1.45, hz: 0.92 };

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _n = new THREE.Vector3();
const _nm = new THREE.Matrix3();
const _c = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);

export function shade(hex, dl = 0, ds = 0, dh = 0) {
  return _c.set(hex).offsetHSL(dh, ds, dl).getHex();
}

/* ------------------------------------------------------------------------------------------------
 * Parts: collects primitives (with transform + colour) and merges them into one vertex-coloured
 * indexed geometry -> one draw call per object.
 * ---------------------------------------------------------------------------------------------- */
export class Parts {
  constructor() { this.items = []; }

  // t: { p:[x,y,z], r:[x,y,z] (euler), q: Quaternion, s: number|[x,y,z] }; color: hex or fn(normal) -> hex
  add(geo, color, t = {}) {
    const p = t.p || [0, 0, 0];
    if (t.q) _q.copy(t.q); else _q.setFromEuler(_e.set(...(t.r || [0, 0, 0]), t.order || 'XYZ'));
    if (t.s === undefined) _s.set(1, 1, 1); else if (typeof t.s === 'number') _s.setScalar(t.s); else _s.set(...t.s);
    const m = new THREE.Matrix4().compose(_p.set(...p), _q, _s);
    if (t.parent) m.premultiply(t.parent);
    this.items.push({ geo, color, m });
    return this;
  }
  box(w, h, d, color, t, radius = 0) {
    const g = radius > 0 ? new RoundedBoxGeometry(w, h, d, 2, Math.min(radius, w / 2, h / 2, d / 2) * 0.999) : new THREE.BoxGeometry(w, h, d);
    return this.add(g, color, t);
  }
  cyl(rt, rb, h, color, t, seg = 18, open = false, theta = Math.PI * 2, thetaStart = 0) {
    return this.add(new THREE.CylinderGeometry(rt, rb, h, seg, 1, open, thetaStart, theta), color, t);
  }
  sphere(r, color, t, ws = 16, hs = 12) { return this.add(new THREE.SphereGeometry(r, ws, hs), color, t); }
  lathe(pts, color, t, seg = 28) {
    return this.add(new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), seg), color, t);
  }
  tube(points, r, color, t, seg = 24, rs = 6) {
    const curve = new THREE.CatmullRomCurve3(points.map((v) => new THREE.Vector3(...v)));
    return this.add(new THREE.TubeGeometry(curve, seg, r, rs, false), color, t);
  }
  torus(r, tube, color, t, arc = Math.PI * 2, rs = 8, ts = 24) {
    return this.add(new THREE.TorusGeometry(r, tube, rs, ts, arc), color, t);
  }
  // Square beam of cross-section w x d from point a to point b.
  beam(a, b, w, d, color, t = {}) {
    const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b);
    const dir = vb.clone().sub(va);
    const len = dir.length();
    const q = new THREE.Quaternion().setFromUnitVectors(UP, dir.normalize());
    if (t.twist) q.multiply(new THREE.Quaternion().setFromAxisAngle(UP, t.twist));
    return this.add(new THREE.BoxGeometry(w, len, d), color, { ...t, p: va.add(vb).multiplyScalar(0.5).toArray(), q });
  }

  build() {
    let nv = 0, ni = 0;
    for (const it of this.items) {
      nv += it.geo.attributes.position.count;
      ni += it.geo.index ? it.geo.index.count : it.geo.attributes.position.count;
    }
    const pos = new Float32Array(nv * 3), nrm = new Float32Array(nv * 3), col = new Float32Array(nv * 3);
    const idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
    const cache = new Map();
    const lin = (hex) => {
      let v = cache.get(hex);
      if (!v) { _c.set(hex); v = [_c.r, _c.g, _c.b]; cache.set(hex, v); }
      return v;
    };
    let vo = 0, io = 0;
    for (const it of this.items) {
      const g = it.geo, P = g.attributes.position, N = g.attributes.normal;
      _nm.getNormalMatrix(it.m);
      const fn = typeof it.color === 'function';
      const fixed = fn ? null : lin(it.color);
      for (let i = 0; i < P.count; i++) {
        _p.fromBufferAttribute(P, i).applyMatrix4(it.m);
        pos.set([_p.x, _p.y, _p.z], (vo + i) * 3);
        _n.fromBufferAttribute(N, i);
        const cc = fn ? lin(it.color(_n)) : fixed;
        _n.applyMatrix3(_nm).normalize();
        nrm.set([_n.x, _n.y, _n.z], (vo + i) * 3);
        col.set(cc, (vo + i) * 3);
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
export function faces({ px, nx, py, ny, pz, nz, other }) {
  return (n) => {
    const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
    let c;
    if (ax >= ay && ax >= az) c = n.x > 0 ? px : nx;
    else if (ay >= az) c = n.y > 0 ? py : ny;
    else c = n.z > 0 ? pz : nz;
    return c !== undefined ? c : other;
  };
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

// Loose brush strokes over whatever is on the canvas (watercolour feel).
function strokes(g, w, h, rand, colors, n, size) {
  g.save();
  g.lineCap = 'round';
  for (let i = 0; i < n; i++) {
    g.globalAlpha = 0.08 + rand() * 0.12;
    g.strokeStyle = colors[Math.floor(rand() * colors.length)];
    g.lineWidth = size * (0.5 + rand());
    const x = rand() * w, y = rand() * h, a = (rand() - 0.5) * 0.8, l = size * (2 + rand() * 4);
    g.beginPath();
    g.moveTo(x, y);
    g.quadraticCurveTo(x + Math.cos(a) * l * 0.5, y + Math.sin(a) * l * 0.5 + (rand() - 0.5) * size, x + Math.cos(a) * l, y + Math.sin(a) * l);
    g.stroke();
  }
  g.restore();
}

export function paintingTexture(rand) {
  return canvasTex(320, 240, (g, w, h) => {
    const sky = g.createLinearGradient(0, 0, 0, h * 0.7);
    sky.addColorStop(0, '#f1c16e'); sky.addColorStop(0.55, '#f6d9a0'); sky.addColorStop(1, '#eba27c');
    g.fillStyle = sky; g.fillRect(0, 0, w, h);
    const sun = g.createRadialGradient(w * 0.66, h * 0.46, 4, w * 0.66, h * 0.46, 70);
    sun.addColorStop(0, 'rgba(255,248,222,1)'); sun.addColorStop(0.3, 'rgba(255,236,190,0.9)'); sun.addColorStop(1, 'rgba(255,220,160,0)');
    g.fillStyle = sun; g.fillRect(0, 0, w, h);
    const hill = (y0, amp, freq, color, seed) => {
      g.fillStyle = color; g.beginPath(); g.moveTo(0, h);
      for (let x = 0; x <= w; x += 4) g.lineTo(x, y0 + Math.sin(x * freq + seed) * amp + Math.sin(x * freq * 2.7 + seed * 3) * amp * 0.35);
      g.lineTo(w, h); g.closePath(); g.fill();
    };
    hill(h * 0.58, 10, 0.018, '#9dbab0', 1.3);
    hill(h * 0.68, 12, 0.012, '#6f9a93', 4.1);
    // little trees on the middle hill
    g.fillStyle = '#3f6a66';
    for (let i = 0; i < 14; i++) {
      const x = rand() * w, y = h * 0.68 + Math.sin(x * 0.012 + 4.1) * 12 - 2, s = 6 + rand() * 8;
      g.beginPath(); g.moveTo(x, y - s * 2.2); g.lineTo(x + s * 0.6, y); g.lineTo(x - s * 0.6, y); g.closePath(); g.fill();
    }
    hill(h * 0.82, 8, 0.02, '#2f3a56', 2.2);
    // a golden stag on the near ridge
    g.fillStyle = '#2a2433'; g.strokeStyle = '#ffd98a'; g.lineWidth = 2;
    const sx = w * 0.3, sy = h * 0.8;
    g.beginPath(); g.ellipse(sx, sy - 16, 16, 7, 0, 0, Math.PI * 2); g.fill();
    g.fillRect(sx - 13, sy - 12, 3, 14); g.fillRect(sx - 6, sy - 12, 3, 14); g.fillRect(sx + 6, sy - 12, 3, 14); g.fillRect(sx + 11, sy - 12, 3, 14);
    g.beginPath(); g.moveTo(sx + 10, sy - 20); g.lineTo(sx + 20, sy - 36); g.lineTo(sx + 26, sy - 33); g.lineTo(sx + 16, sy - 16); g.closePath(); g.fill();
    g.beginPath();
    g.moveTo(sx + 21, sy - 36); g.lineTo(sx + 16, sy - 50); g.moveTo(sx + 18, sy - 44); g.lineTo(sx + 11, sy - 48);
    g.moveTo(sx + 23, sy - 36); g.lineTo(sx + 30, sy - 50); g.moveTo(sx + 27, sy - 44); g.lineTo(sx + 34, sy - 46);
    g.stroke();
    strokes(g, w, h, rand, ['#fff3d6', '#e7a878', '#5f8f8b', '#f3c56f'], 160, 5);
  });
}

export function outsideTexture() {
  return canvasTex(256, 256, (g, w, h) => {
    const sky = g.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#ffe9b8'); sky.addColorStop(0.55, '#ffd592'); sky.addColorStop(1, '#f4b77e');
    g.fillStyle = sky; g.fillRect(0, 0, w, h);
    const sun = g.createRadialGradient(w * 0.62, h * 0.62, 2, w * 0.62, h * 0.62, w * 0.5);
    sun.addColorStop(0, 'rgba(255,252,236,1)'); sun.addColorStop(0.2, 'rgba(255,244,210,0.8)'); sun.addColorStop(1, 'rgba(255,230,180,0)');
    g.fillStyle = sun; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(206,150,110,0.55)';
    g.beginPath(); g.moveTo(0, h);
    for (let x = 0; x <= w; x += 8) g.lineTo(x, h * 0.78 - Math.abs(Math.sin(x * 0.09)) * 18 - Math.sin(x * 0.023) * 10);
    g.lineTo(w, h); g.closePath(); g.fill();
  });
}

// Warm night behind the window: plum sky glowing amber at the horizon, moon, stars, a lit village.
export function outsideNightTexture(rand) {
  return canvasTex(512, 512, (g, w, h) => {
    const sky = g.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#1e1630'); sky.addColorStop(0.45, '#3b2544'); sky.addColorStop(0.7, '#6e3f4a'); sky.addColorStop(0.86, '#a5604a');
    g.fillStyle = sky; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 90; i++) {
      const x = rand() * w, y = rand() * h * 0.62, r = 0.6 + rand() * rand() * 2.2;
      g.globalAlpha = 0.45 + rand() * 0.55 * (1 - y / (h * 0.7));
      g.fillStyle = rand() < 0.3 ? '#ffe2b0' : '#fff6e4';
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    }
    g.globalAlpha = 1;
    const mx = w * 0.34, my = h * 0.3, mr = w * 0.045;
    const halo = g.createRadialGradient(mx, my, mr, mx, my, mr * 5);
    halo.addColorStop(0, 'rgba(255,232,196,0.45)'); halo.addColorStop(1, 'rgba(255,232,196,0)');
    g.fillStyle = halo; g.fillRect(0, 0, w, h);
    g.fillStyle = '#fff1d0';
    g.beginPath(); g.arc(mx, my, mr, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(214,190,160,0.5)';
    for (const [dx, dy, r] of [[-0.3, -0.2, 0.28], [0.25, 0.15, 0.2], [-0.05, 0.4, 0.16]]) {
      g.beginPath(); g.arc(mx + dx * mr, my + dy * mr, r * mr, 0, Math.PI * 2); g.fill();
    }
    // far hills with a few lit windows
    const ridge = (x) => h * 0.8 - Math.abs(Math.sin(x * 0.045)) * 18 - Math.sin(x * 0.012) * 12;
    g.fillStyle = '#2a1a22';
    g.beginPath(); g.moveTo(0, h);
    for (let x = 0; x <= w; x += 8) g.lineTo(x, ridge(x));
    g.lineTo(w, h); g.closePath(); g.fill();
    g.fillStyle = '#ffc070';
    for (let i = 0; i < 16; i++) {
      const x = rand() * w;
      g.fillRect(x, ridge(x) + 6 + rand() * 30, 2.5, 2.5);
    }
  });
}

export function tagTexture() {
  const W = 64, H = 96;
  return canvasTex(W, H, (g) => {
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, W, H);
    g.strokeStyle = 'rgba(90,59,36,0.55)'; g.lineWidth = 3;
    g.beginPath(); g.arc(W / 2, H * 0.16, 7, 0, Math.PI * 2); g.stroke();
    g.fillStyle = 'rgba(70,44,26,0.85)';
    g.font = 'bold 40px Georgia, "Times New Roman", serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('#', W / 2, H * 0.6);
  });
}

export function blobTexture() {
  const t = canvasTex(64, 64, (g, w, h) => {
    const r = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.45, 'rgba(255,255,255,0.7)'); r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r; g.fillRect(0, 0, w, h);
  });
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

// Framed bust of the blog's robot logo (falls back to a drawn robot if the image is unavailable).
export async function portraitTexture() {
  let img = null;
  try {
    img = new Image();
    img.src = '/img/logo.png';
    await Promise.race([img.decode(), new Promise((_, rej) => setTimeout(rej, 2500))]);
  } catch (e) { img = null; }
  return canvasTex(256, 320, (g, w, h) => {
    const bg = g.createRadialGradient(w * 0.5, h * 0.36, 10, w * 0.5, h * 0.5, h * 0.62);
    bg.addColorStop(0, '#9fc2b8'); bg.addColorStop(0.55, '#6e9892'); bg.addColorStop(1, '#3e605e');
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    const halo = g.createRadialGradient(w * 0.5, h * 0.42, 0, w * 0.5, h * 0.42, w * 0.42);
    halo.addColorStop(0, 'rgba(255,238,200,0.75)'); halo.addColorStop(1, 'rgba(255,238,200,0)');
    g.fillStyle = halo; g.fillRect(0, 0, w, h);
    if (img) {
      // robot occupies x 270..780, y 20..540 of the 1050x540 logo
      const s = (w * 0.86) / 510;
      g.drawImage(img, w / 2 - 525 * s, h - 540 * s, 1050 * s, 540 * s);
    } else {
      g.fillStyle = '#1d2233';
      g.fillRect(w * 0.3, h * 0.3, w * 0.4, h * 0.26);
      g.fillRect(w * 0.42, h * 0.56, w * 0.16, h * 0.06);
      g.fillRect(w * 0.2, h * 0.62, w * 0.6, h * 0.4);
      g.fillStyle = '#f4eee3';
      g.beginPath(); g.arc(w * 0.41, h * 0.4, 9, 0, 7); g.arc(w * 0.59, h * 0.4, 9, 0, 7); g.fill();
    }
    const vig = g.createRadialGradient(w / 2, h / 2, h * 0.3, w / 2, h / 2, h * 0.7);
    vig.addColorStop(0, 'rgba(40,30,20,0)'); vig.addColorStop(1, 'rgba(40,30,20,0.35)');
    g.fillStyle = vig; g.fillRect(0, 0, w, h);
  });
}

/* ------------------------------------------------------------------------------------------------
 * Materials
 * ---------------------------------------------------------------------------------------------- */
const TOON = { bands: 3, softness: 0.05, shadeLift: 0.35 };
// The shell's shaded side leans rose-lavender (multiplies the vertex colours) instead of the auto grey-blue.
const SHELL_SHADE = { shadeColor: 0xc4b0d4 };
export function vcMaterial(extra) { return createToonMaterial({ color: 0xffffff, vertexColors: true, ...TOON, ...extra }); }
export function toon(color, extra) { return createToonMaterial({ color, ...TOON, ...extra }); }
export function glowMaterial(color, intensity = 3.5) {
  return createToonMaterial({ color, emissive: color, emissiveIntensity: intensity, ...TOON });
}

function mesh(geo, mat, { cast = true, receive = true, outline = true } = {}) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = cast; m.receiveShadow = receive;
  if (outline) markOutline(m);
  return m;
}

/* ------------------------------------------------------------------------------------------------
 * Room shell: floor slab, planks, two cut-away walls with wainscot, window, curtains, outside view
 * ---------------------------------------------------------------------------------------------- */
export function buildShell(ctx) {
  const { rand, uniforms } = ctx;
  const { W, D, H, T, F, x0, x1, z0, z1 } = ROOM;
  const group = new THREE.Group();
  const P = new Parts();

  // slab (cut faces show its thickness)
  P.box(W + T, F, D + T, faces({ py: C.cut, other: shade(C.cut, -0.06) }), { p: [(x0 - T + x1) / 2, -F / 2 - 0.004, (z0 - T + z1) / 2] });
  // floor planks along x, staggered joints (flat quads: no seams for the edge detector)
  const planks = [0xd2a67a, 0xc99c6f, 0xd7af84, 0xcca274, 0xd0a578];
  const rows = 15, rd = D / rows;
  for (let r = 0; r < rows; r++) {
    let x = x0 - (r % 3) * 0.7 - rand() * 0.4;
    while (x < x1) {
      const len = 1.6 + rand() * 1.8;
      const a = Math.max(x, x0), b = Math.min(x + len, x1);
      if (b - a > 0.02) {
        P.add(new THREE.PlaneGeometry(b - a, rd), shade(planks[Math.floor(rand() * planks.length)], (rand() - 0.5) * 0.02),
          { p: [(a + b) / 2, 0, z0 + rd * (r + 0.5)], r: [-Math.PI / 2, 0, 0] });
      }
      x += len;
    }
  }

  const wall = C.cream, cut = C.cut;
  // left wall (inner face +x)
  P.box(T, H, D + T, faces({ px: wall, py: cut, pz: cut, other: shade(cut, -0.05) }), { p: [x0 - T / 2, H / 2, (z0 - T + z1) / 2] });
  // back wall (inner face +z) with the window opening
  const back = (a, b, y0, y1) => P.box(b - a, y1 - y0, T,
    faces({ pz: wall, py: y1 >= H ? cut : shade(wall, -0.05), ny: shade(wall, -0.07), px: a === WIN.x1 && b === x1 ? cut : shade(wall, -0.04), nx: shade(wall, -0.04), other: shade(cut, -0.05) }),
    { p: [(a + b) / 2, (y0 + y1) / 2, z0 - T / 2] });
  back(x0 - T, WIN.x0, 0, H);
  back(WIN.x1, x1, 0, H);
  back(WIN.x0, WIN.x1, 0, WIN.y0);
  back(WIN.x0, WIN.x1, WIN.y1, H);

  // wainscot, chair rail and skirting on both walls
  const wains = C.teal, rail = C.darkWood;
  P.box(0.03, 0.95, D, shade(wains, 0.02), { p: [x0 + 0.015, 0.475, (z0 + z1) / 2] });
  P.box(0.06, 0.06, D, rail, { p: [x0 + 0.03, 0.98, (z0 + z1) / 2] });
  P.box(0.05, 0.14, D, shade(rail, -0.05), { p: [x0 + 0.025, 0.07, (z0 + z1) / 2] });
  P.box(W, 0.95, 0.03, wains, { p: [0, 0.475, z0 + 0.015] });
  P.box(W, 0.06, 0.06, rail, { p: [0, 0.98, z0 + 0.03] });
  P.box(W, 0.14, 0.05, shade(rail, -0.05), { p: [0, 0.07, z0 + 0.025] });

  // window frame, mullions, sill
  const fr = C.white, fw = 0.09, cx = (WIN.x0 + WIN.x1) / 2, cy = (WIN.y0 + WIN.y1) / 2;
  const ww = WIN.x1 - WIN.x0, wh = WIN.y1 - WIN.y0;
  P.box(ww + fw * 2, fw, T + 0.06, fr, { p: [cx, WIN.y1 + fw / 2, z0 - T / 2] });
  P.box(fw, wh, T + 0.06, fr, { p: [WIN.x0 - fw / 2 + 0.001, cy, z0 - T / 2] });
  P.box(fw, wh, T + 0.06, fr, { p: [WIN.x1 + fw / 2 - 0.001, cy, z0 - T / 2] });
  // sill top sits 6 mm proud of the wall cut under the window (coplanar faces z-fought into a flicker band)
  P.box(ww + 0.36, 0.07, T + 0.2, C.wood, { p: [cx, WIN.y0 - 0.029, z0 - T / 2 + 0.07] });
  // curtain rod with finials
  const rodY = WIN.y1 + 0.2, rodZ = z0 + 0.14, rodOver = 0.5;
  P.cyl(0.022, 0.022, ww + rodOver * 2, C.brass, { p: [cx, rodY, rodZ], r: [0, 0, Math.PI / 2] }, 10);
  P.sphere(0.05, C.brass, { p: [WIN.x0 - rodOver, rodY, rodZ] }, 10, 8);
  P.sphere(0.05, C.brass, { p: [WIN.x1 + rodOver, rodY, rodZ] }, 10, 8);

  // kilim rug: rounded rectangle with a navy border, terracotta field and mustard diamonds
  const rugMat = (hx, hz, r, c, y) => {
    const s = new THREE.Shape();
    s.moveTo(-hx + r, -hz); s.lineTo(hx - r, -hz); s.quadraticCurveTo(hx, -hz, hx, -hz + r);
    s.lineTo(hx, hz - r); s.quadraticCurveTo(hx, hz, hx - r, hz); s.lineTo(-hx + r, hz);
    s.quadraticCurveTo(-hx, hz, -hx, hz - r); s.lineTo(-hx, -hz + r); s.quadraticCurveTo(-hx, -hz, -hx + r, -hz);
    P.add(new THREE.ShapeGeometry(s, 4), c, { p: [RUG.x, y, RUG.z], r: [-Math.PI / 2, 0, 0] });
  };
  P.box(RUG.hx * 2, 0.03, RUG.hz * 2, faces({ py: C.navy, other: shade(C.navy, -0.06) }), { p: [RUG.x, 0.015, RUG.z] }, 0.012);
  rugMat(RUG.hx - 0.16, RUG.hz - 0.16, 0.08, C.terracotta, 0.031);
  rugMat(RUG.hx - 0.3, RUG.hz - 0.3, 0.05, shade(C.terracotta, 0.04), 0.032);
  for (const [dx, dz, s] of [[-0.62, 0, 0.26], [0, 0, 0.34], [0.62, 0, 0.26]]) {
    P.add(new THREE.CircleGeometry(s, 4), C.mustard, { p: [RUG.x + dx, 0.033, RUG.z + dz], r: [-Math.PI / 2, 0, 0], s: [1, 1.25, 1] });
    P.add(new THREE.CircleGeometry(s * 0.45, 4), C.navy, { p: [RUG.x + dx, 0.034, RUG.z + dz], r: [-Math.PI / 2, 0, 0], s: [1, 1.25, 1] });
  }
  // fringe on the short ends
  for (const sx of [-1, 1]) {
    for (let k = 0; k < 11; k++) {
      P.box(0.12, 0.012, 0.035, C.kraft, { p: [RUG.x + sx * (RUG.hx + 0.05), 0.008, RUG.z - RUG.hz + 0.1 + k * ((RUG.hz * 2 - 0.2) / 10)] });
    }
  }

  const shell = mesh(P.build(), vcMaterial(SHELL_SHADE), { cast: true });
  group.add(shell);

  // window mullions: a separate mesh that casts no shadow, so the sun patch reads as clean panes
  const M = new Parts();
  M.box(0.05, wh, 0.06, fr, { p: [cx, cy, z0 - T / 2] });
  M.box(ww, 0.05, 0.06, fr, { p: [cx, WIN.y0 + wh * 0.5, z0 - T / 2] });
  group.add(mesh(M.build(), vcMaterial(), { cast: false }));

  // curtains: folded planes, swaying slightly in the breeze (vertex shader, outlines follow)
  const curtainTop = rodY - 0.02, curtainLen = rodY - 0.62;
  const cg = [];
  for (const [a, b] of [[WIN.x0 - rodOver - 0.05, WIN.x0 + 0.1], [WIN.x1 - 0.1, WIN.x1 + rodOver + 0.05]]) {
    const g = new THREE.PlaneGeometry(b - a, curtainLen, 18, 10);
    const pa = g.attributes.position;
    for (let i = 0; i < pa.count; i++) {
      const u = (pa.getX(i) + (b - a) / 2) / (b - a);
      const k = (curtainLen / 2 - pa.getY(i)) / curtainLen;
      pa.setZ(i, Math.sin(u * Math.PI * 7) * 0.04 * (0.6 + k * 0.6));
    }
    g.computeVertexNormals();
    g.translate((a + b) / 2, curtainTop - curtainLen / 2, rodZ);
    cg.push(g);
  }
  const P2 = new Parts();
  P2.add(cg[0], C.rose); P2.add(cg[1], C.rose);
  const sway = uniforms.time;
  const curtainExtend = (shader) => {
    shader.uniforms.uTime = sway;
    shader.vertexShader = 'uniform float uTime;\n' + shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      float hang = clamp((${curtainTop.toFixed(3)} - position.y) / ${curtainLen.toFixed(3)}, 0.0, 1.0);
      transformed.z += hang * hang * (0.05 + 0.04 * sin(uTime * 0.8 + position.x * 1.7)) * (0.6 + 0.4 * sin(uTime * 0.37));
      transformed.x += hang * hang * 0.025 * sin(uTime * 0.6 + position.y * 2.0);`);
  };
  // (no shadow: the sway would force a shadow-map refresh every frame for an imperceptible change)
  const curtains = mesh(P2.build(), vcMaterial({ side: THREE.DoubleSide, extend: curtainExtend, cacheKey: 'room-curtain' }), { cast: false });
  group.add(curtains);

  // outside view behind the window (HDR so it blooms a little); close behind the wall and below the
  // sight line over the wall top even at the steep portrait view, so it only shows through the window
  const outsideGeo = new THREE.PlaneGeometry(ww + 1.4, 2.35);
  const outside = new THREE.Mesh(outsideGeo,
    new THREE.MeshBasicMaterial({ map: ctx.textures.outside, color: new THREE.Color(1.45, 1.36, 1.22), fog: false }));
  outside.position.set(cx, 1.775, z0 - T - 0.3);
  // the night sky fades in over it (only one of the two is drawn outside the crossfade)
  const nightSky = new THREE.Mesh(outsideGeo, new THREE.MeshBasicMaterial({
    map: ctx.textures.outsideNight, color: new THREE.Color(1.5, 1.42, 1.3), fog: false, transparent: true, depthWrite: false,
  }));
  nightSky.position.set(cx, 1.775, z0 - T - 0.29);
  group.add(outside, nightSky);
  ctx.night.push((k) => {
    nightSky.material.opacity = k;
    nightSky.visible = k > 0.001;
    outside.visible = k < 0.999;
  });

  // a candle on the sill, lit at night
  {
    const g = new THREE.Group();
    g.position.set(WIN.x1 - 0.32, WIN.y0 + 0.006, z0 + 0.06);
    const P = new Parts();
    P.cyl(0.08, 0.09, 0.02, C.brass, { p: [0, 0.01, 0] }, 16);
    P.torus(0.035, 0.008, C.brass, { p: [0.095, 0.012, 0], r: [Math.PI / 2, 0, 0] }, Math.PI * 2, 5, 12);
    P.cyl(0.04, 0.042, 0.17, C.white, { p: [0, 0.105, 0] }, 14);
    P.cyl(0.004, 0.004, 0.03, 0x3a2618, { p: [0, 0.2, 0] }, 4);
    g.add(mesh(P.build(), vcMaterial(), { cast: false }));
    const flameMat = glowMaterial(0xffb35c, 5);
    const flame = new THREE.Mesh(new THREE.SphereGeometry(0.026, 10, 8), flameMat);
    flame.position.y = 0.235;
    const light = new THREE.PointLight(0xffa24e, 0, 3.4, 1.5);
    light.position.set(0, 0.34, 0.12);
    g.add(flame, light);
    group.add(g);
    let lit = 0;
    ctx.night.push((k) => { lit = k; light.intensity = 2.2 * k; });
    // gentle flicker (flame height + light); the flame shrinks away by day
    ctx.updates.push((t) => {
      const f = 1 + 0.07 * Math.sin(t * 7.3) * Math.sin(t * 3.1 + 1.3);
      flame.visible = lit > 0.001;
      flame.scale.set(lit, lit * 2.1 * f, lit);
      light.intensity = 2.2 * lit * (0.93 + 0.07 * f);
    });
  }

  return { group };
}

/* ------------------------------------------------------------------------------------------------
 * Decor (non-interactive): floor lamp, plant, sleeping cat
 * ---------------------------------------------------------------------------------------------- */
export function buildDecor(ctx) {
  const { rand } = ctx;
  const group = new THREE.Group();
  const updates = [];

  // floor lamp beside the sofa (reading corner)
  {
    const g = new THREE.Group();
    g.position.set(DECOR.lamp[0], 0, DECOR.lamp[1]);
    const P = new Parts();
    P.cyl(0.2, 0.22, 0.04, C.darkWood, { p: [0, 0.02, 0] }, 20);
    P.cyl(0.018, 0.018, 1.62, C.brass, { p: [0, 0.83, 0] }, 8);
    P.cyl(0.035, 0.035, 0.08, C.brass, { p: [0, 1.62, 0] }, 10);
    g.add(mesh(P.build(), vcMaterial()));
    const shadeGeo = new THREE.CylinderGeometry(0.16, 0.3, 0.36, 24, 1, true);
    const shadeMesh = mesh(shadeGeo, toon(0xf6e2bb, { side: THREE.DoubleSide, emissive: 0xffc98a, emissiveIntensity: 0.45 }));
    shadeMesh.position.y = 1.78;
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 10), glowMaterial(0xffc27a, 4));
    bulb.position.y = 1.7;
    g.add(shadeMesh, bulb);
    const light = new THREE.PointLight(0xffc27a, 2.2, 5, 1.6);
    light.position.set(0, 1.6, 0.1);
    g.add(light);
    group.add(g);
    // at night it is the key light of the reading corner: a glowing shade and a wide warm pool
    ctx.night.push((k) => {
      shadeMesh.material.emissiveIntensity = 0.45 + 0.3 * k;
      bulb.material.emissiveIntensity = 4 + 2 * k;
      light.intensity = 2.2 + 2.0 * k;
      light.distance = 5 + 2.2 * k;
      light.position.set(-0.1 * k, 1.6 - 0.2 * k, 0.1 + 0.3 * k); // off the wall: a wider, softer pool
    });
  }

  // potted plant between the bookshelf and the window
  {
    const g = new THREE.Group();
    g.position.set(DECOR.plant[0], 0, DECOR.plant[1]);
    const P = new Parts();
    P.lathe([[0, 0], [0.2, 0], [0.24, 0.05], [0.28, 0.44], [0.3, 0.46], [0.3, 0.52], [0.27, 0.52], [0.25, 0.47], [0, 0.47]], C.terracotta, {}, 24);
    P.cyl(0.25, 0.25, 0.02, 0x5a3b24, { p: [0, 0.48, 0] }, 20);
    g.add(mesh(P.build(), vcMaterial()));
    const leaves = new Parts();
    const n = 11;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rand() * 0.4, tilt = 0.35 + rand() * 0.6, len = 0.55 + rand() * 0.45;
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(tilt, a, 0, 'YXZ'));
      const tip = new THREE.Vector3(0, len, 0).applyQuaternion(q);
      leaves.tube([[0, 0.45, 0], [tip.x * 0.4, 0.45 + tip.y * 0.55, tip.z * 0.4], [tip.x, 0.45 + tip.y, tip.z]], 0.012, 0x5d7a45, {}, 8, 4);
      const lq = new THREE.Quaternion().setFromEuler(new THREE.Euler(tilt + 0.5, a, 0, 'YXZ'));
      leaves.sphere(0.2, shade(C.sage, (rand() - 0.5) * 0.08, 0, (rand() - 0.5) * 0.03),
        { p: [tip.x, 0.45 + tip.y, tip.z], q: lq, s: [0.55 + rand() * 0.2, 0.08, 1] }, 14, 8);
    }
    const leafMesh = mesh(leaves.build(), vcMaterial());
    const sway = new THREE.Group();
    sway.position.y = 0.45;
    leafMesh.position.y = -0.45;
    sway.add(leafMesh);
    g.add(sway);
    updates.push((t) => { sway.rotation.z = Math.sin(t * 0.7) * 0.025; sway.rotation.x = Math.sin(t * 0.53 + 1) * 0.02; });
    group.add(g);
  }

  // cat asleep on the rug (in the sun patch)
  {
    const g = new THREE.Group();
    g.position.set(DECOR.cat[0], 0.035, DECOR.cat[1]);
    g.rotation.y = 0.6;
    const P = new Parts();
    const fur = 0x8f8478, belly = 0xe9dcc6;
    P.sphere(0.3, fur, { p: [0, 0.14, 0], s: [1.15, 0.52, 0.85] }, 20, 14);
    P.sphere(0.13, fur, { p: [0.28, 0.12, 0.12], s: [1, 0.85, 1] }, 16, 12);
    P.sphere(0.07, belly, { p: [0.36, 0.09, 0.18], s: [1, 0.7, 0.9] }, 10, 8);
    P.cyl(0, 0.05, 0.09, fur, { p: [0.26, 0.24, 0.07], r: [-0.3, 0, 0.35] }, 6);
    P.cyl(0, 0.05, 0.09, fur, { p: [0.35, 0.22, 0.17], r: [0.1, 0, -0.35] }, 6);
    P.torus(0.28, 0.045, fur, { p: [0, 0.05, 0.02], r: [Math.PI / 2, 0, 0.3] }, Math.PI * 0.95, 8, 20);
    P.sphere(0.05, shade(fur, -0.12), { p: [-0.13, 0.28, -0.05], s: [2.2, 0.4, 1.3] }, 10, 6);
    const cat = mesh(P.build(), vcMaterial());
    g.add(cat);
    updates.push((t) => { cat.scale.y = 1 + Math.sin(t * 1.6) * 0.025; });
    group.add(g);
  }

  return { group, update(t) { for (const u of updates) u(t); } };
}

/* ------------------------------------------------------------------------------------------------
 * Interactive objects. Each builder fills `root` (object-local: floor at y = 0, back against the wall
 * at z = 0 for wall pieces or z = -depth/2 for floor pieces, facing +z) and returns
 * { anchor: Vector3, pivot: Vector3, wall: bool, footprint: [w, d] | null, update?(t, active) }.
 * ---------------------------------------------------------------------------------------------- */
// Back wall, left to right: bookshelf, plant, window (tag garland), sofa + floor lamp. Left wall, back to
// front: cabinet, portrait, desk under the corkboard. Floor: easel (front left), gramophone (right).
export const PLACES = {
  bookshelf: { p: [-3.2, ROOM.z0 + 0.23], ry: 0 },
  tags: { p: [(WIN.x0 + WIN.x1) / 2, ROOM.z0], ry: 0 },
  cabinet: { p: [ROOM.x0 + 0.35, -1.75], ry: Math.PI / 2 },
  portrait: { p: [ROOM.x0, -0.35], ry: Math.PI / 2 },
  gramophone: { p: [2.95, 0.95], ry: -0.7, s: 1.2 },
  sofa: { p: [2.72, ROOM.z0 + 0.5], ry: 0 },
  desk: { p: [ROOM.x0 + 0.38, 1.2], ry: Math.PI / 2 },
  corkboard: { p: [ROOM.x0, 1.2], ry: Math.PI / 2 },
  easel: { p: [3.55, -0.15], ry: 0.2 },
};
// Free floor spots for generic crates (unknown / duplicate keys, extra items).
export const SPOTS = [[3.3, -0.7], [1.6, 2.3], [-2.6, -0.9], [3.8, 2.3], [0.2, 2.3], [1.5, -1.2], [-3.6, 2.5], [0.3, -1.6]];
// Decor positions (x, z) — also used for their floor contact blobs.
export const DECOR = { lamp: [4.02, ROOM.z0 + 0.38], plant: [-1.95, ROOM.z0 + 0.42], cat: [-0.45, 0.35] };

function bookshelf(root, ctx) {
  const { rand } = ctx;
  const W = 1.7, H = 2.55, D = 0.42;
  const P = new Parts();
  const dw = C.darkWood;
  P.box(0.07, H, D, dw, { p: [-(W / 2 - 0.035), H / 2, 0] });
  P.box(0.07, H, D, dw, { p: [W / 2 - 0.035, H / 2, 0] });
  P.box(W - 0.14, H - 0.1, 0.03, 0x4d6f6c, { p: [0, H / 2, -D / 2 + 0.015] });
  P.box(W, 0.12, D, shade(dw, -0.05), { p: [0, 0.06, 0] });
  P.box(W + 0.1, 0.07, D + 0.06, shade(dw, -0.03), { p: [0, H + 0.035, 0.015] }, 0.015);
  const levels = [0.14, 0.74, 1.34, 1.94];
  for (const y of levels.slice(1)) P.box(W - 0.14, 0.045, D - 0.02, dw, { p: [0, y - 0.0225, 0.01] });
  P.box(W - 0.14, 0.04, D - 0.02, dw, { p: [0, H - 0.02, 0.01] });
  const fams = [
    [0x2f3a56, 0x3d4a6b, 0x26304a, 0x46557a],
    [0xc96f4a, 0xb85f3d, 0xd7825c, 0xa9553a],
    [0x5f8f8b, 0x4c7a76, 0x74a39c, 0x3f6b67],
    [0xe0b04f, 0xd19c3a, 0xebc26a, 0xc98f34],
  ];
  const inner = W - 0.14;
  levels.forEach((y0, s) => {
    const fam = fams[s];
    let x = -inner / 2 + 0.02;
    const stop = inner / 2 - 0.2 - rand() * 0.2;
    while (x < stop) {
      const bw = 0.05 + rand() * 0.055, bh = 0.34 + rand() * 0.17, bd = 0.25 + rand() * 0.07;
      const c = shade(fam[Math.floor(rand() * fam.length)], (rand() - 0.5) * 0.04);
      const z = -D / 2 + 0.04 + bd / 2;
      P.box(bw, bh, bd, c, { p: [x + bw / 2, y0 + bh / 2, z] });
      if (rand() < 0.7) P.box(bw * 1.02, 0.022, 0.006, 0xf3dfaa, { p: [x + bw / 2, y0 + bh * 0.82, z + bd / 2 + 0.002] });
      x += bw + 0.004;
    }
    // a leaning book, then a small lying stack
    const lh = 0.36, lw = 0.055;
    const lean = -0.32;
    P.box(lw, lh, 0.26, shade(fam[0], 0.05), { p: [x + Math.sin(-lean) * lh / 2 + lw / 2 + 0.01, y0 + Math.cos(lean) * lh / 2, -D / 2 + 0.2], r: [0, 0, lean] });
    const right = inner / 2 - 0.02;
    let sy = y0;
    for (let k = 0; k < 2 && right - (x + 0.2) > 0.18; k++) {
      const h2 = 0.05 + rand() * 0.02;
      P.box(0.16, h2, 0.24, shade(fam[(k + 2) % 4], 0.02), { p: [right - 0.09, sy + h2 / 2, -D / 2 + 0.18], r: [0, (rand() - 0.5) * 0.3, 0] });
      sy += h2;
    }
  });
  // globe on top
  const gy = H + 0.07;
  P.cyl(0.08, 0.1, 0.04, C.darkWood, { p: [-0.35, gy + 0.02, 0] }, 14);
  P.cyl(0.015, 0.015, 0.12, C.brass, { p: [-0.35, gy + 0.1, 0] }, 6);
  P.torus(0.17, 0.01, C.brass, { p: [-0.35, gy + 0.3, 0], r: [0, Math.PI / 2, 0.4] }, Math.PI * 1.2, 6, 20);
  P.sphere(0.15, C.teal, { p: [-0.35, gy + 0.3, 0] }, 20, 14);
  P.sphere(0.07, C.sage, { p: [-0.35 + 0.08, gy + 0.36, 0.08], s: [1, 0.7, 0.5] }, 10, 8);
  P.sphere(0.06, C.sage, { p: [-0.35 - 0.02, gy + 0.22, 0.12], s: [0.8, 0.6, 0.5] }, 10, 8);
  // two lying books on top
  P.box(0.4, 0.07, 0.28, C.terracotta, { p: [0.35, gy + 0.035, 0], r: [0, 0.12, 0] });
  P.box(0.34, 0.06, 0.25, C.mustard, { p: [0.33, gy + 0.1, 0.01], r: [0, -0.1, 0] });
  root.add(mesh(P.build(), ctx.mat()));
  return { anchor: new THREE.Vector3(0, H + 0.55, 0), pivot: new THREE.Vector3(0, 0, 0), footprint: [W, D] };
}

function cabinet(root, ctx) {
  const W = 0.95, H = 1.3, D = 0.66;
  const P = new Parts();
  P.box(W - 0.04, 0.08, D - 0.04, shade(C.darkWood, -0.05), { p: [0, 0.04, 0] });
  P.box(W, H - 0.08, D, C.wood, { p: [0, 0.08 + (H - 0.08) / 2, 0] });
  P.box(W + 0.06, 0.05, D + 0.05, C.darkWood, { p: [0, H + 0.025, 0.01] }, 0.012);
  const dh = (H - 0.16) / 3;
  for (let i = 0; i < 3; i++) {
    const y = 0.12 + dh * (i + 0.5);
    const out = i === 2 ? 0.26 : 0;
    const zf = D / 2 + 0.018 + out;
    P.box(W - 0.1, dh - 0.05, 0.036, shade(C.wood, 0.04), { p: [0, y, zf] }, 0.01);
    P.box(0.22, 0.035, 0.04, C.brass, { p: [0, y - 0.06, zf + 0.03] }, 0.012);
    P.box(0.19, 0.09, 0.012, C.brass, { p: [0, y + 0.08, zf + 0.02] });
    P.box(0.16, 0.066, 0.014, C.white, { p: [0, y + 0.08, zf + 0.022] });
    if (out) {
      // pulled-out drawer full of folders
      P.box(0.02, dh - 0.12, out + 0.02, shade(C.wood, -0.02), { p: [-(W / 2 - 0.08), y - 0.02, D / 2 + out / 2] });
      P.box(0.02, dh - 0.12, out + 0.02, shade(C.wood, -0.02), { p: [W / 2 - 0.08, y - 0.02, D / 2 + out / 2] });
      const cols = [C.white, C.mustard, C.teal, C.terracotta, 0xe8d6b0, C.navy];
      for (let k = 0; k < 6; k++) {
        const z = D / 2 - 0.02 + k * 0.045;
        P.box(W - 0.2, dh - 0.06, 0.012, cols[k], { p: [0, y + 0.02, z], r: [-0.12, 0, 0] });
        P.box(0.14, 0.05, 0.012, shade(cols[k], -0.03), { p: [-0.28 + (k % 3) * 0.26, y + dh / 2 + 0.02, z - 0.006], r: [-0.12, 0, 0] });
      }
    }
  }
  // archive boxes on top
  P.box(0.56, 0.28, 0.4, C.kraft, { p: [0, H + 0.05 + 0.14, 0], r: [0, 0.08, 0] }, 0.01);
  P.box(0.2, 0.08, 0.01, C.white, { p: [0.02, H + 0.05 + 0.15, 0.2 + 0.02], r: [0, 0.08, 0] });
  P.box(0.5, 0.22, 0.36, shade(C.kraft, 0.04), { p: [0.02, H + 0.33 + 0.11, 0.0], r: [0, -0.14, 0] }, 0.01);
  P.box(0.18, 0.07, 0.01, C.white, { p: [-0.01, H + 0.33 + 0.12, 0.18 + 0.03], r: [0, -0.14, 0] });
  root.add(mesh(P.build(), ctx.mat()));
  return { anchor: new THREE.Vector3(0, H + 0.95, 0.1), pivot: new THREE.Vector3(0, 0, 0), footprint: [W, D + 0.2] };
}

function portrait(root, ctx) {
  const cy = 2.05, W = 1.12, H = 1.38, b = 0.12, dz = 0.07;
  const P = new Parts();
  const gold = 0xd9a94a;
  P.box(W, b, dz, gold, { p: [0, cy + H / 2 - b / 2, dz / 2] }, 0.025);
  P.box(W, b, dz, gold, { p: [0, cy - H / 2 + b / 2, dz / 2] }, 0.025);
  P.box(b, H - 2 * b + 0.02, dz, gold, { p: [-W / 2 + b / 2, cy, dz / 2] }, 0.025);
  P.box(b, H - 2 * b + 0.02, dz, gold, { p: [W / 2 - b / 2, cy, dz / 2] }, 0.025);
  const lip = shade(gold, -0.12);
  const iw = W - 2 * b, ih = H - 2 * b;
  P.box(iw + 0.02, 0.025, 0.04, lip, { p: [0, cy + ih / 2, 0.05] });
  P.box(iw + 0.02, 0.025, 0.04, lip, { p: [0, cy - ih / 2, 0.05] });
  P.box(0.025, ih, 0.04, lip, { p: [-iw / 2, cy, 0.05] });
  P.box(0.025, ih, 0.04, lip, { p: [iw / 2, cy, 0.05] });
  P.box(0.28, 0.06, 0.012, 0xf0d58a, { p: [0, cy - H / 2 + b / 2, dz + 0.004] });
  // picture light
  P.cyl(0.012, 0.012, 0.2, C.brass, { p: [0, cy + H / 2 + 0.04, 0.1], r: [Math.PI / 2 - 0.5, 0, 0] }, 6);
  P.cyl(0.05, 0.05, 0.46, C.brass, { p: [0, cy + H / 2 + 0.09, 0.2], r: [0, 0, Math.PI / 2] }, 12, false, Math.PI, Math.PI);
  root.add(mesh(P.build(), ctx.mat()));
  const canvas = mesh(new THREE.PlaneGeometry(iw, ih), ctx.mat({ vertexColors: false, map: ctx.textures.portrait }), { cast: false });
  canvas.position.set(0, cy, 0.035);
  root.add(canvas);
  const bulb = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.02, 0.03), glowMaterial(0xffd58a, 3));
  bulb.position.set(0, cy + H / 2 + 0.07, 0.2);
  root.add(bulb);
  ctx.night.push((k) => { bulb.material.emissiveIntensity = 3 + 2 * k; });
  return { anchor: new THREE.Vector3(0, cy + H / 2 + 0.35, 0.1), pivot: new THREE.Vector3(0, cy, 0.04), wall: true, footprint: null };
}

function corkboard(root, ctx) {
  const { rand } = ctx;
  const cy = 2.34, W = 1.6, H = 1.08, b = 0.07, k = 1.1;
  const P = new Parts();
  const fw = C.wood;
  P.box(W, b, 0.05, fw, { p: [0, cy + H / 2 - b / 2, 0.025] }, 0.01);
  P.box(W, b, 0.05, fw, { p: [0, cy - H / 2 + b / 2, 0.025] }, 0.01);
  P.box(b, H - 2 * b, 0.05, fw, { p: [-W / 2 + b / 2, cy, 0.025] }, 0.01);
  P.box(b, H - 2 * b, 0.05, fw, { p: [W / 2 - b / 2, cy, 0.025] }, 0.01);
  P.box(W - 2 * b, H - 2 * b, 0.03, C.cork, { p: [0, cy, 0.015] });
  const notes = [
    [-0.45, 0.17, 0.26, 0.28, 0xf6ecd6], [-0.12, 0.2, 0.24, 0.22, 0xebc26a], [0.22, 0.14, 0.2, 0.26, 0x9cc3bd],
    [0.5, 0.18, 0.2, 0.2, C.white], [-0.4, -0.2, 0.24, 0.2, 0xe5a58f], [-0.06, -0.17, 0.22, 0.24, 0xb9c99e],
    [0.4, -0.18, 0.26, 0.22, 0xf6ecd6],
  ];
  const pins = [C.terracotta, C.navy, C.mustard, C.terracotta, C.teal, C.navy, C.terracotta];
  const pinPos = [];
  notes.forEach(([x0, y0, w0, h0, c], i) => {
    const x = x0 * k, y = y0 * k, w = w0 * k, h = h0 * k;
    const rz = (rand() - 0.5) * 0.24;
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), rz);
    P.box(w, h, 0.006, c, { p: [x, cy + y, 0.034], q });
    // scribbled lines
    for (let k = 0; k < 3; k++) {
      const off = new THREE.Vector3(-w * 0.08 * (k === 2), h * (0.12 - k * 0.14), 0).applyQuaternion(q);
      P.box(w * (k === 2 ? 0.45 : 0.65), 0.012, 0.004, 0x6b5a4a, { p: [x + off.x, cy + y + off.y, 0.039], q });
    }
    const top = new THREE.Vector3(0, h / 2 - 0.035, 0).applyQuaternion(q);
    pinPos.push([x + top.x, cy + y + top.y, 0.05]);
    P.sphere(0.024, pins[i], { p: pinPos[i] }, 10, 8);
  });
  // red thread between three pins
  P.tube([pinPos[0], [(pinPos[0][0] + pinPos[5][0]) / 2, (pinPos[0][1] + pinPos[5][1]) / 2 - 0.02, 0.052], pinPos[5]], 0.005, C.terracotta, {}, 12, 4);
  P.tube([pinPos[5], [(pinPos[5][0] + pinPos[2][0]) / 2, (pinPos[5][1] + pinPos[2][1]) / 2 - 0.02, 0.052], pinPos[2]], 0.005, C.terracotta, {}, 12, 4);
  root.add(mesh(P.build(), ctx.mat()));
  return { anchor: new THREE.Vector3(0, cy + H / 2 + 0.3, 0.1), pivot: new THREE.Vector3(0, cy, 0.03), wall: true, footprint: null };
}

function desk(root, ctx) {
  const W = 1.6, D = 0.72, TH = 0.78;
  const P = new Parts();
  const dw = C.darkWood;
  P.box(W, 0.06, D, dw, { p: [0, TH - 0.03, 0] }, 0.012);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) P.box(0.06, TH - 0.06, 0.06, shade(dw, -0.04), { p: [sx * (W / 2 - 0.07), (TH - 0.06) / 2, sz * (D / 2 - 0.07)] });
  P.box(W - 0.14, 0.1, D - 0.14, shade(dw, -0.02), { p: [0, TH - 0.11, 0] });
  P.box(0.5, 0.075, 0.02, shade(dw, 0.05), { p: [0, TH - 0.11, D / 2 - 0.06] });
  P.sphere(0.018, C.brass, { p: [0, TH - 0.11, D / 2 - 0.04] }, 8, 6);
  // open logbook
  const by = TH + 0.012;
  P.box(0.62, 0.02, 0.44, C.navy, { p: [-0.05, by, 0.04] }, 0.006);
  for (const s of [-1, 1]) {
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -s * 0.07);
    P.box(0.29, 0.03, 0.4, 0xfaf1dc, { p: [-0.05 + s * 0.148, by + 0.025, 0.04], q });
    // written lines: flat strips lying on the page (thin boxes grew ink edges that shimmered on hover)
    const page = new THREE.Matrix4().compose(new THREE.Vector3(-0.05 + s * 0.148, by + 0.025, 0.04), q, new THREE.Vector3(1, 1, 1));
    for (let k = 0; k < 6; k++) {
      P.add(new THREE.PlaneGeometry(k === 5 ? 0.12 : 0.2, 0.016), 0x6f5f4e,
        { p: [s * 0.002 - (k === 5 ? 0.04 : 0), 0.0165, -0.14 + k * 0.05], r: [-Math.PI / 2, 0, 0], parent: page });
    }
  }
  P.box(0.025, 0.004, 0.16, C.terracotta, { p: [-0.05, by + 0.04, 0.24] });
  P.box(0.025, 0.12, 0.004, C.terracotta, { p: [-0.05, by - 0.03, 0.262] });
  // inkpot + quill
  P.cyl(0.05, 0.055, 0.07, C.navy, { p: [0.42, TH + 0.035, 0.12] }, 14);
  P.cyl(0.025, 0.03, 0.03, C.navy, { p: [0.42, TH + 0.085, 0.12] }, 10);
  P.sphere(0.12, C.white, { p: [0.47, TH + 0.2, 0.08], r: [0.5, 0.3, -0.35], s: [0.18, 1, 0.05] }, 10, 8);
  // stack of books
  P.box(0.34, 0.07, 0.26, C.teal, { p: [-0.58, TH + 0.035, -0.12], r: [0, 0.1, 0] });
  P.box(0.3, 0.06, 0.24, C.terracotta, { p: [-0.57, TH + 0.1, -0.12], r: [0, -0.08, 0] });
  P.box(0.28, 0.05, 0.22, C.mustard, { p: [-0.58, TH + 0.155, -0.11], r: [0, 0.2, 0] });
  // banker's lamp
  const lx = 0.45, lz = -0.18;
  P.box(0.2, 0.03, 0.14, C.brass, { p: [lx, TH + 0.015, lz] }, 0.01);
  P.cyl(0.014, 0.014, 0.3, C.brass, { p: [lx, TH + 0.17, lz - 0.03] }, 6);
  P.cyl(0.09, 0.09, 0.3, 0x3f7a62, { p: [lx, TH + 0.33, lz + 0.02], r: [0, 0, Math.PI / 2] }, 16, false, Math.PI, Math.PI / 2);
  // chair, pulled out
  const ch = new THREE.Matrix4().compose(new THREE.Vector3(0.12, 0, D / 2 + 0.28), new THREE.Quaternion().setFromAxisAngle(UP, -0.3), new THREE.Vector3(1, 1, 1));
  const cw = C.wood;
  P.box(0.46, 0.05, 0.44, cw, { p: [0, 0.47, 0], parent: ch }, 0.012);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) P.box(0.045, 0.45, 0.045, shade(cw, -0.05), { p: [sx * 0.19, 0.225, sz * 0.18], parent: ch });
  for (const sx of [-1, 1]) P.box(0.045, 0.52, 0.045, shade(cw, -0.05), { p: [sx * 0.19, 0.74, 0.19], parent: ch, r: [0.08, 0, 0] });
  P.box(0.46, 0.12, 0.04, cw, { p: [0, 0.96, 0.21], parent: ch, r: [0.08, 0, 0] }, 0.01);
  P.box(0.4, 0.05, 0.03, cw, { p: [0, 0.76, 0.2], parent: ch, r: [0.08, 0, 0] });
  root.add(mesh(P.build(), ctx.mat()));
  const bulb = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.2, 8), glowMaterial(0xffd28a, 3.5));
  bulb.rotation.z = Math.PI / 2;
  bulb.position.set(lx, TH + 0.3, lz + 0.05);
  root.add(bulb);
  // the banker's lamp is switched on at night: a warm pool over the logbook
  const light = new THREE.PointLight(0xffb35c, 0, 3, 1.6);
  light.position.set(lx - 0.1, TH + 0.26, lz + 0.34);
  root.add(light);
  ctx.night.push((k) => { bulb.material.emissiveIntensity = 3.5 + 2.5 * k; light.intensity = 1.8 * k; });
  return { anchor: new THREE.Vector3(0.1, 0.95, D / 2 + 0.05), label: 'right', pivot: new THREE.Vector3(0, 0, 0), footprint: [W, D + 0.5] };
}

function gramophone(root, ctx) {
  const P = new Parts();
  const dw = C.darkWood;
  // round side table
  P.cyl(0.36, 0.36, 0.05, dw, { p: [0, 0.575, 0] }, 28);
  P.cyl(0.045, 0.06, 0.52, shade(dw, -0.05), { p: [0, 0.29, 0] }, 12);
  P.cyl(0.2, 0.24, 0.04, shade(dw, -0.05), { p: [0, 0.02, 0] }, 20);
  // gramophone box
  const by = 0.6;
  P.box(0.46, 0.035, 0.46, C.brass, { p: [0, by + 0.018, 0] }, 0.01);
  P.box(0.42, 0.18, 0.42, C.wood, { p: [0, by + 0.035 + 0.09, 0] }, 0.015);
  const ty = by + 0.215;
  P.cyl(0.19, 0.19, 0.016, 0x3b2d2a, { p: [0, ty + 0.008, 0] }, 28);
  P.cyl(0.03, 0.03, 0.03, C.brass, { p: [0.17, ty + 0.015, -0.16] }, 10);
  P.tube([[0.17, ty + 0.04, -0.16], [0.14, ty + 0.05, -0.02], [0.06, ty + 0.035, 0.07]], 0.009, C.brass, {}, 10, 5);
  P.box(0.04, 0.02, 0.05, C.brass, { p: [0.05, ty + 0.03, 0.08], r: [0, 0.5, 0] });
  P.cyl(0.01, 0.01, 0.12, C.brass, { p: [0.26, by + 0.12, 0.05], r: [0, 0, Math.PI / 2] }, 6);
  P.cyl(0.018, 0.018, 0.07, C.darkWood, { p: [0.32, by + 0.15, 0.05] }, 8);
  // horn: neck from the back, flaring bell toward the front / up
  const neckEnd = new THREE.Vector3(-0.02, by + 0.95, -0.2);
  P.tube([[-0.14, by + 0.2, -0.14], [-0.16, by + 0.45, -0.3], [-0.08, by + 0.8, -0.3], neckEnd.toArray()], 0.03, C.brass, {}, 20, 8);
  const prof = [];
  for (let i = 0; i <= 12; i++) { const t = i / 12; prof.push([0.035 + 0.34 * Math.pow(t, 2.4), t * 0.62]); }
  const inner = prof.map(([r, y]) => [Math.max(r - 0.012, 0.02), y]).reverse();
  const bellQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 1.0);
  const bellT = { p: neckEnd.toArray(), q: bellQ };
  P.lathe(prof, C.mustard, bellT, 32);
  P.lathe(inner, 0x9c6a2c, bellT, 32);
  const rim = new THREE.Vector3(0, 0.62, 0).applyQuaternion(bellQ).add(neckEnd);
  P.torus(0.372, 0.014, C.brass, { p: rim.toArray(), q: bellQ.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2)) }, Math.PI * 2, 6, 40);
  // record sleeves leaning on the table
  const sleeves = [C.teal, C.terracotta, C.mustard];
  sleeves.forEach((c, i) => {
    P.box(0.31, 0.31, 0.012, c, { p: [0.18 + i * 0.03, 0.155, 0.36 - i * 0.03], r: [-0.25, 0.9, 0] });
    P.cyl(0.08, 0.08, 0.004, shade(c, 0.12), { p: [0.18 + i * 0.03 + 0.005, 0.16, 0.36 - i * 0.03 + 0.008], r: [Math.PI / 2 - 0.25, 0, 0.9], order: 'YXZ' }, 16);
  });
  root.add(mesh(P.build(), ctx.mat()));
  // spinning record (separate so it can rotate)
  const R = new Parts();
  R.cyl(0.18, 0.18, 0.008, 0x1f1b22, {}, 36);
  R.cyl(0.065, 0.065, 0.01, C.terracotta, {}, 20);
  R.box(0.3, 0.002, 0.018, 0x4e4757, { p: [0, 0.005, 0] });
  R.cyl(0.008, 0.008, 0.04, C.brass, { p: [0, 0.015, 0] }, 6);
  const record = mesh(R.build(), ctx.mat());
  record.position.set(0, ty + 0.02, 0);
  root.add(record);
  return {
    anchor: new THREE.Vector3(0, 0.12, 0.3), label: 'down', pivot: new THREE.Vector3(0, 0, 0), footprint: [0.8, 0.8],
    update(t) { record.rotation.y = -t * 3.5; },
  };
}

function sofa(root, ctx) {
  const W = 2.3, D = 0.9;
  const P = new Parts();
  const body = C.teal;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) P.cyl(0.035, 0.025, 0.1, C.darkWood, { p: [sx * (W / 2 - 0.12), 0.05, sz * (D / 2 - 0.1)] }, 8);
  P.box(W - 0.3, 0.3, D, shade(body, -0.02), { p: [0, 0.25, 0] }, 0.06);
  const cw = (W - 0.52) / 2;
  for (const sx of [-1, 1]) P.box(cw - 0.01, 0.17, D - 0.26, shade(body, 0.03), { p: [sx * (cw / 2 + 0.004), 0.48, 0.1] }, 0.07);
  P.box(W - 0.46, 0.58, 0.26, body, { p: [0, 0.68, -D / 2 + 0.15], r: [-0.12, 0, 0] }, 0.09);
  for (const sx of [-1, 1]) P.box(0.27, 0.64, D, shade(body, -0.01), { p: [sx * (W / 2 - 0.135), 0.42, 0] }, 0.1);
  // throw pillows
  P.box(0.44, 0.42, 0.15, C.terracotta, { p: [-0.55, 0.74, -0.16], r: [-0.28, 0.12, 0.16] }, 0.07);
  P.box(0.4, 0.38, 0.14, C.mustard, { p: [0.58, 0.72, -0.15], r: [-0.3, -0.1, -0.14] }, 0.07);
  P.box(0.34, 0.32, 0.13, C.cream, { p: [0.18, 0.68, -0.12], r: [-0.25, 0.05, 0.1] }, 0.06);
  // knitted blanket over the right arm
  P.box(0.3, 0.025, 0.72, C.navy, { p: [W / 2 - 0.135, 0.755, 0.02] }, 0.01);
  P.box(0.025, 0.36, 0.64, C.navy, { p: [W / 2 + 0.01, 0.58, 0.02] }, 0.01);
  P.box(0.03, 0.04, 0.645, C.mustard, { p: [W / 2 + 0.012, 0.46, 0.02] });
  P.box(0.03, 0.04, 0.645, C.mustard, { p: [W / 2 + 0.012, 0.52, 0.02] });
  root.add(mesh(P.build(), ctx.mat()));
  return { anchor: new THREE.Vector3(0, 1.3, 0), pivot: new THREE.Vector3(0, 0, 0), footprint: [W, D] };
}

function easel(root, ctx) {
  const P = new Parts();
  const lw = C.wood;
  P.beam([-0.4, 0, 0.12], [-0.06, 2.0, -0.07], 0.05, 0.05, lw);
  P.beam([0.4, 0, 0.12], [0.06, 2.0, -0.07], 0.05, 0.05, lw);
  P.beam([0, 0, -0.62], [0, 1.9, -0.1], 0.05, 0.05, shade(lw, -0.05));
  P.box(0.62, 0.04, 0.04, shade(lw, -0.03), { p: [0, 0.5, 0.07] });
  const ledgeY = 0.82, lz = 0.12 - 0.19 * (ledgeY / 2.0);
  P.box(1.02, 0.04, 0.14, lw, { p: [0, ledgeY, lz + 0.04] });
  P.box(1.02, 0.05, 0.02, lw, { p: [0, ledgeY + 0.035, lz + 0.1] });
  const tilt = -Math.atan2(0.19, 2.0);
  const cw = 1.0, chh = 0.76, cy = ledgeY + 0.02 + chh / 2 * Math.cos(tilt);
  const cz = lz + 0.04 + chh / 2 * Math.sin(tilt);
  P.box(cw, chh, 0.035, faces({ other: 0xf2e8d4, nz: 0xd8c7a8 }), { p: [0, cy, cz], r: [tilt, 0, 0] });
  P.box(0.14, 0.05, 0.09, shade(lw, -0.05), { p: [0, cy + chh / 2 * Math.cos(tilt) + 0.02, cz - 0.03], r: [tilt, 0, 0] });
  // stool with palette, paints and a brush jar
  const st = new THREE.Matrix4().makeTranslation(0.78, 0, 0.18);
  P.cyl(0.19, 0.19, 0.04, C.darkWood, { p: [0, 0.5, 0], parent: st }, 20);
  for (let k = 0; k < 3; k++) {
    const a = k * Math.PI * 2 / 3 + 0.4;
    P.beam([Math.cos(a) * 0.2, 0, Math.sin(a) * 0.2], [Math.cos(a) * 0.12, 0.49, Math.sin(a) * 0.12], 0.035, 0.035, shade(C.darkWood, -0.05), { parent: st });
  }
  P.cyl(0.17, 0.17, 0.018, 0xd9b27c, { p: [-0.03, 0.53, 0.02], s: [1.25, 1, 0.9], parent: st }, 24);
  const dabs = [C.terracotta, C.mustard, C.teal, C.navy, C.white, C.rose];
  dabs.forEach((c, i) => {
    const a = i / dabs.length * Math.PI * 1.6 + 0.4;
    P.sphere(0.03, c, { p: [-0.03 + Math.cos(a) * 0.14, 0.54, 0.02 + Math.sin(a) * 0.09], s: [1, 0.35, 1], parent: st }, 8, 6);
  });
  P.cyl(0.055, 0.05, 0.13, 0x9fb9b4, { p: [0.1, 0.585, -0.08], parent: st }, 14);
  [[0.08, 0.1, C.terracotta], [0.11, -0.12, C.teal], [0.13, 0.02, C.mustard]].forEach(([dx, rz, c]) => {
    P.cyl(0.008, 0.008, 0.3, C.darkWood, { p: [dx, 0.7, -0.08], r: [0, 0, rz], parent: st }, 5);
    P.cyl(0.004, 0.014, 0.05, c, { p: [dx - Math.sin(rz) * 0.17, 0.7 + Math.cos(rz) * 0.17, -0.08], r: [0, 0, rz], parent: st }, 6);
  });
  root.add(mesh(P.build(), ctx.mat()));
  const painting = mesh(new THREE.PlaneGeometry(cw - 0.05, chh - 0.05), ctx.mat({ vertexColors: false, map: ctx.textures.painting }), { cast: false });
  painting.position.set(0, cy, cz + 0.019 * Math.cos(tilt));
  painting.rotation.x = tilt;
  root.add(painting);
  return { anchor: new THREE.Vector3(0, 0.12, 0.3), label: 'down', pivot: new THREE.Vector3(0, 0, 0), footprint: [1.0, 0.8] };
}

function tags(root, ctx) {
  const { rand, textures } = ctx;
  const P = new Parts();
  const span = 1.5, y0 = 3.0, sag = 0.3, z = 0.2;
  const yAt = (x) => y0 - sag * (1 - (x / span) * (x / span));
  const pts = [];
  for (let i = 0; i <= 16; i++) { const x = -span + (2 * span * i) / 16; pts.push([x, yAt(x), z]); }
  P.tube(pts, 0.008, 0x7a5a3c, {}, 48, 5);
  for (const s of [-1, 1]) P.cyl(0.018, 0.018, z + 0.02, C.brass, { p: [s * span, y0, z / 2], r: [Math.PI / 2, 0, 0] }, 6);
  const n = 6, tw = 0.3, th = 0.42;
  const shape = new THREE.Shape();
  shape.moveTo(-tw / 2, -th); shape.lineTo(tw / 2, -th); shape.lineTo(tw / 2, -0.09); shape.lineTo(0.06, 0);
  shape.lineTo(-0.06, 0); shape.lineTo(-tw / 2, -0.09); shape.closePath();
  const hole = new THREE.Path(); hole.absarc(0, -0.065, 0.024, 0, Math.PI * 2, true);
  shape.holes.push(hole);
  const tagGeo = new THREE.ExtrudeGeometry(shape, { depth: 0.012, bevelEnabled: false, curveSegments: 10 });
  tagGeo.translate(0, 0, -0.006);
  const tex = textures.tag;
  tex.repeat.set(1 / tw, 1 / th);
  tex.offset.set(0.5, 1);
  const tagMat = ctx.mat({ vertexColors: false, map: tex, side: THREE.DoubleSide });
  const inst = new THREE.InstancedMesh(tagGeo, tagMat, n);
  inst.castShadow = false; inst.receiveShadow = true; // swinging: no shadow-map refresh needed
  markOutline(inst);
  const cols = [C.kraft, 0x8fb5ae, 0xe9c36a, C.kraft, 0xe19a78, 0xd9b98a];
  const base = [];
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), one = new THREE.Vector3(1, 1, 1), v = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    const x = -span + 0.32 + (i * (2 * span - 0.64)) / (n - 1);
    const hang = 0.05 + rand() * 0.05;
    base.push({ x, y: yAt(x) - hang, rz: (rand() - 0.5) * 0.3, ry: (rand() - 0.5) * 0.5, ph: rand() * 6.28 });
    P.cyl(0.004, 0.004, hang, 0x7a5a3c, { p: [x, yAt(x) - hang / 2, z] }, 4);
    inst.setColorAt(i, new THREE.Color(cols[i % cols.length]));
  }
  const place = (t) => {
    for (let i = 0; i < n; i++) {
      const b = base[i];
      e.set(Math.sin(t * 0.9 + b.ph) * 0.06, b.ry + Math.sin(t * 0.6 + b.ph) * 0.12, b.rz + Math.sin(t * 1.1 + b.ph * 1.3) * 0.05);
      m.compose(v.set(b.x, b.y - 0.02, z), q.setFromEuler(e), one);
      inst.setMatrixAt(i, m);
    }
    inst.instanceMatrix.needsUpdate = true;
  };
  place(0);
  root.add(mesh(P.build(), ctx.mat()), inst);
  return {
    anchor: new THREE.Vector3(0, y0 + 0.22, z), pivot: new THREE.Vector3(0, y0 - 0.2, z), wall: true, footprint: null,
    update(t) { place(t); },
  };
}

// Generic fallback: a stack of labelled wooden crates.
function crate(root, ctx) {
  const { rand } = ctx;
  const P = new Parts();
  const c1 = shade(C.wood, (rand() - 0.5) * 0.06), c2 = shade(c1, 0.05);
  const crateAt = (s, y, ry, c) => {
    const tm = new THREE.Matrix4().compose(new THREE.Vector3(0, y, 0), new THREE.Quaternion().setFromAxisAngle(UP, ry), new THREE.Vector3(1, 1, 1));
    P.box(s, s * 0.7, s, shade(c, -0.08), { p: [0, s * 0.35, 0], parent: tm });
    for (let k = 0; k < 3; k++) {
      P.box(s + 0.02, s * 0.14, s + 0.02, c, { p: [0, s * (0.1 + k * 0.25), 0], parent: tm });
    }
    P.box(s * 0.4, s * 0.16, 0.01, C.white, { p: [0, s * 0.35, s / 2 + 0.012], parent: tm });
  };
  crateAt(0.6, 0, 0.1, c1);
  crateAt(0.46, 0.42, -0.2, c2);
  root.add(mesh(P.build(), ctx.mat()));
  return { anchor: new THREE.Vector3(0, 1.2, 0), pivot: new THREE.Vector3(0, 0, 0), footprint: [0.7, 0.7] };
}

export const BUILDERS = { bookshelf, tags, cabinet, portrait, gramophone, sofa, desk, corkboard, easel, crate };
