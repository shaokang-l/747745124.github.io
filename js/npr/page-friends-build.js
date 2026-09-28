// Procedural pieces of the Friends banner ("the friend village"): a merged vertex-coloured parts builder,
// painted canvas textures, the floating island and one builder per village object (see page-friends.js).
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { createToonMaterial } from './core.js';

export const C = {
  grass: 0x8fae6e, grassDark: 0x6f9460, moss: 0xa9bd7a, dirt: 0xa8744c, rock: 0x86695a, rockDeep: 0x72606e,
  path: 0xe6c897, wood: 0xb07a4f, darkWood: 0x7a4f35, cream: 0xf3e6cc, stone: 0xbcab96, teal: 0x5f8f8b,
  pine: 0x4b7a6a, pineDark: 0x3c6560, terracotta: 0xc96f4a, mustard: 0xe0b04f, navy: 0x2f3a56, rose: 0xdc9580,
  plum: 0x8e5a6e, sage: 0x86a376, white: 0xf7f0e2, brass: 0xd6a54a, tilled: 0x8a5a3b, cloud: 0xfdf6f0,
};

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _n = new THREE.Vector3();
const _nm = new THREE.Matrix3();
const _c = new THREE.Color();

export function shade(hex, dl = 0, ds = 0, dh = 0) {
  return _c.set(hex).offsetHSL(dh, ds, dl).getHex();
}

/* ------------------------------------------------------------------------------------------------
 * Parts: primitives (transform + colour) merged into one vertex-coloured geometry = one draw call.
 * ---------------------------------------------------------------------------------------------- */
export class Parts {
  constructor() { this.items = []; }

  // t: { p:[x,y,z], r:[x,y,z], s: number|[x,y,z] }; color: hex or fn(localNormal, localPos) -> hex
  add(geo, color, t = {}) {
    _q.setFromEuler(_e.set(...(t.r || [0, 0, 0]), t.order || 'XYZ'));
    if (t.s === undefined) _s.set(1, 1, 1); else if (typeof t.s === 'number') _s.setScalar(t.s); else _s.set(...t.s);
    const m = new THREE.Matrix4().compose(_p.set(...(t.p || [0, 0, 0])), _q, _s);
    if (t.parent) m.premultiply(t.parent);
    this.items.push({ geo, color, m });
    return this;
  }
  box(w, h, d, color, t, radius = 0) {
    const r = Math.min(radius, w / 2, h / 2, d / 2) * 0.999;
    return this.add(r > 0 ? new RoundedBoxGeometry(w, h, d, 2, r) : new THREE.BoxGeometry(w, h, d), color, t);
  }
  cyl(rt, rb, h, color, t, seg = 14) { return this.add(new THREE.CylinderGeometry(rt, rb, h, seg), color, t); }
  cone(r, h, color, t, seg = 10) { return this.add(new THREE.ConeGeometry(r, h, seg), color, t); }
  sphere(r, color, t, ws = 12, hs = 9) { return this.add(new THREE.SphereGeometry(r, ws, hs), color, t); }
  lathe(pts, color, t, seg = 18) {
    return this.add(new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), seg), color, t);
  }

  get empty() { return this.items.length === 0; }

  build() {
    let nv = 0, ni = 0;
    for (const it of this.items) {
      nv += it.geo.attributes.position.count;
      ni += it.geo.index ? it.geo.index.count : it.geo.attributes.position.count;
    }
    const pos = new Float32Array(nv * 3), nrm = new Float32Array(nv * 3), col = new Float32Array(nv * 3);
    const idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
    let vo = 0, io = 0;
    for (const it of this.items) {
      const g = it.geo, P = g.attributes.position, N = g.attributes.normal, K = g.attributes.color;
      _nm.getNormalMatrix(it.m);
      const fn = typeof it.color === 'function';
      if (!fn && it.color !== null) _c.set(it.color);
      for (let i = 0; i < P.count; i++) {
        _p.fromBufferAttribute(P, i);
        _n.fromBufferAttribute(N, i);
        if (fn) _c.set(it.color(_n, _p));
        else if (it.color === null && K) _c.fromBufferAttribute(K, i);
        _p.applyMatrix4(it.m);
        _n.applyMatrix3(_nm).normalize();
        const o = (vo + i) * 3;
        pos[o] = _p.x; pos[o + 1] = _p.y; pos[o + 2] = _p.z;
        nrm[o] = _n.x; nrm[o + 1] = _n.y; nrm[o + 2] = _n.z;
        col[o] = _c.r; col[o + 1] = _c.g; col[o + 2] = _c.b;
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

// Face colour for boxes by the dominant axis of the local normal.
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

// Welded copy (positions only, smooth normals) for the screen-space highlight hull.
export function hullGeometry(geos) {
  const keys = new Map(), pos = [], index = [], v = new THREE.Vector3();
  for (const g of geos) {
    const P = g.attributes.position, I = g.index, n = I ? I.count : P.count;
    for (let i = 0; i < n; i++) {
      v.fromBufferAttribute(P, I ? I.getX(i) : i);
      const k = `${Math.round(v.x * 400)},${Math.round(v.y * 400)},${Math.round(v.z * 400)}`;
      let id = keys.get(k);
      if (id === undefined) { id = pos.length / 3; keys.set(k, id); pos.push(v.x, v.y, v.z); }
      index.push(id);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(index, 1) : new THREE.Uint16BufferAttribute(index, 1));
  geo.computeVertexNormals();
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

/* ------------------------------------------------------------------------------------------------
 * Materials & textures
 * ---------------------------------------------------------------------------------------------- */
const TOON = { bands: 3, softness: 0.05, shadeLift: 0.4 };
export function vcMaterial(extra) { return createToonMaterial({ color: 0xffffff, vertexColors: true, ...TOON, ...extra }); }
export function glowMaterial(color, intensity) {
  return createToonMaterial({ color, emissive: color, emissiveIntensity: intensity, ...TOON });
}

function canvasTex(w, h, draw) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  draw(cv.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export function blobTexture() {
  const t = canvasTex(64, 64, (g, w, h) => {
    const r = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.45, 'rgba(255,255,255,0.65)'); r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r; g.fillRect(0, 0, w, h);
  });
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

export function moonTexture() {
  const t = canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = '#fff'; g.beginPath(); g.arc(w / 2, h / 2, w * 0.42, 0, Math.PI * 2); g.fill();
    g.globalCompositeOperation = 'destination-out';
    g.beginPath(); g.arc(w * 0.66, h * 0.4, w * 0.38, 0, Math.PI * 2); g.fill();
  });
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

const FONT = '"Georgia", "Songti SC", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", serif';

// Painted cream sign board with a dark-ink name that shrinks to fit; `aspect` = board width / height.
export function signTexture(text, { sub = '', bg = '#fbf0d6', ink = '#2a170b', aspect = 3.2 } = {}) {
  const W = 640, H = Math.round(W / aspect);
  return canvasTex(W, H, (g, w, h) => {
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(150,110,70,0.18)'; g.lineWidth = 3;
    for (let i = 0; i < 5; i++) { // faint wood grain
      g.beginPath(); const y = h * (0.12 + i * 0.19);
      g.moveTo(0, y); g.bezierCurveTo(w * 0.3, y - 6, w * 0.6, y + 8, w, y - 2); g.stroke();
    }
    g.strokeStyle = '#4a2f1d'; g.lineWidth = 10; g.strokeRect(5, 5, w - 10, h - 10);
    g.fillStyle = ink; g.textAlign = 'center'; g.textBaseline = 'middle';
    const max = w - 60;
    let size = Math.round(h * (sub ? 0.46 : 0.62));
    g.font = `bold ${size}px ${FONT}`;
    while (size > 28 && g.measureText(text).width > max) { size -= 3; g.font = `bold ${size}px ${FONT}`; }
    g.fillText(text, w / 2, sub ? h * 0.37 : h * 0.54, max);
    if (sub) {
      let s2 = Math.round(h * 0.2);
      g.font = `bold italic ${s2}px ${FONT}`;
      while (s2 > 18 && g.measureText(sub).width > max) { s2 -= 2; g.font = `bold italic ${s2}px ${FONT}`; }
      g.fillStyle = '#5a3a22';
      g.fillText(sub, w / 2, h * 0.74, max);
    }
  });
}

/* ------------------------------------------------------------------------------------------------
 * Island: flat grassy top (outline wobble), overhanging lip, flat-shaded rocky underside.
 * ---------------------------------------------------------------------------------------------- */
export function islandShape(rand, rx, rz) {
  const k = [rand() * 6.28, rand() * 6.28, rand() * 6.28];
  return (a) => 1 + 0.05 * Math.sin(a * 3 + k[0]) + 0.035 * Math.sin(a * 5 + k[1]) + 0.02 * Math.sin(a * 9 + k[2]);
}

export function islandGeometry(rand, rx, rz, depth, shapeFn) {
  const SEG = 72;
  const pos = [], nrm = [], col = [];
  const cA = new THREE.Color(C.grass), cB = new THREE.Color(C.grassDark), cM = new THREE.Color(C.moss), tmp = new THREE.Color();
  const ring = (f, a) => { const s = shapeFn(a) * f; return [Math.cos(a) * rx * s, Math.sin(a) * rz * s]; };
  const grassCol = (x, z) => {
    const n = 0.5 + 0.5 * Math.sin(x * 1.3 + z * 0.7) * Math.cos(z * 1.7 - x * 0.4);
    tmp.copy(cA).lerp(n > 0.5 ? cM : cB, Math.abs(n - 0.5) * 1.2);
    return tmp;
  };
  const push = (x, y, z, n, c) => { pos.push(x, y, z); nrm.push(n[0], n[1], n[2]); col.push(c.r, c.g, c.b); };
  // top: polar grid
  const radial = [0, 0.3, 0.55, 0.75, 0.9, 1];
  const top = [];
  for (let r = 0; r < radial.length; r++) {
    const row = [];
    for (let s = 0; s < SEG; s++) {
      const a = (s / SEG) * Math.PI * 2;
      const [x, z] = ring(radial[r], a);
      row.push([x, 0, z]);
    }
    top.push(row);
  }
  const up = [0, 1, 0];
  for (let r = 0; r < radial.length - 1; r++) {
    for (let s = 0; s < SEG; s++) {
      const s2 = (s + 1) % SEG;
      const a = top[r][s], b = top[r][s2], c = top[r + 1][s], d = top[r + 1][s2];
      for (const v of [a, d, c, a, b, d]) push(v[0], v[1], v[2], up, grassCol(v[0], v[2]));
    }
  }
  // underside rings: [radius fraction, y, colour, jitter]
  const rings = [
    [1.0, 0, C.grassDark, 0], [1.015, -0.16, C.grassDark, 0], [0.985, -0.24, C.dirt, 0.01],
    [0.97, -0.5 * depth, C.dirt, 0.03], [0.88, -0.95 * depth, C.rock, 0.06], [0.7, -1.45 * depth, C.rock, 0.08],
    [0.45, -1.95 * depth, C.rockDeep, 0.08], [0.2, -2.35 * depth, C.rockDeep, 0.06], [0.03, -2.65 * depth, C.rockDeep, 0],
  ];
  const side = rings.map(([f, y, , j], ri) => {
    const row = [];
    for (let s = 0; s < SEG; s++) {
      const a = (s / SEG) * Math.PI * 2;
      const ff = f * (1 + (rand() - 0.5) * 2 * j);
      const [x, z] = ring(ff, a);
      row.push([x, y + (ri > 2 ? (rand() - 0.5) * 0.2 * depth : 0), z]);
    }
    return row;
  });
  const va = new THREE.Vector3(), vb = new THREE.Vector3(), vc = new THREE.Vector3();
  const tri = (a, b, c, color) => {
    va.set(...b).sub(vc.set(...a)); vb.set(...c).sub(vc); va.cross(vb).normalize();
    const n = [va.x, va.y, va.z];
    tmp.set(color);
    for (const v of [a, b, c]) push(v[0], v[1], v[2], n, tmp);
  };
  for (let r = 0; r < side.length - 1; r++) {
    // ring colours: the rocks darken with a slight per-face variation (painted, not uniform)
    for (let s = 0; s < SEG; s++) {
      const s2 = (s + 1) % SEG;
      const a = side[r][s], b = side[r][s2], c = side[r + 1][s], d = side[r + 1][s2];
      const base = rings[r][2];
      const cc = r > 1 ? shade(base, (rand() - 0.5) * 0.06, 0, (rand() - 0.5) * 0.02) : base;
      tri(a, d, c, cc); tri(a, b, d, cc);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.computeBoundingSphere();
  return geo;
}

// Flat ribbon along a curve (the path), with vertex-colour variation.
export function ribbonGeometry(curve, width, rand, y = 0.02) {
  const N = 90, pos = [], nrm = [], col = [], idx = [];
  const p = new THREE.Vector3(), t = new THREE.Vector3(), cc = new THREE.Color();
  for (let i = 0; i <= N; i++) {
    curve.getPointAt(i / N, p);
    curve.getTangentAt(i / N, t);
    const w = width * (0.9 + 0.2 * Math.sin(i * 0.9) * Math.sin(i * 0.37));
    const nx = -t.z, nz = t.x, l = Math.hypot(nx, nz) || 1;
    for (const sgn of [-1, 1]) {
      pos.push(p.x + (nx / l) * w * 0.5 * sgn, y, p.z + (nz / l) * w * 0.5 * sgn);
      nrm.push(0, 1, 0);
      cc.set(shade(C.path, (rand() - 0.5) * 0.06));
      col.push(cc.r, cc.g, cc.b);
    }
    if (i < N) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  return geo;
}

/* ------------------------------------------------------------------------------------------------
 * Village objects. Local space: ground at y = 0, front (door) toward +z.
 * Each builder fills `body` / `glass` Parts and returns { top } (label anchor height).
 * ---------------------------------------------------------------------------------------------- */
const HOUSE_COLORS = [
  { wall: 0xf1e2c4, roof: C.terracotta, trim: C.darkWood, door: C.teal },
  { wall: 0xe9d2c0, roof: C.teal, trim: 0x6e4a32, door: C.terracotta },
  { wall: 0xf3e7cf, roof: C.navy, trim: C.darkWood, door: C.mustard },
  { wall: 0xdfe0c4, roof: C.plum, trim: 0x6e4a32, door: C.rose },
  { wall: 0xf0dcc0, roof: 0x9a5a3e, trim: C.darkWood, door: C.sage },
];
export const VARIANTS = ['gable', 'tower', 'mushroom'];

function windowAt(body, glass, x, y, z, w, h, trim, ry = 0) {
  const at = (dx, dy, dz) => [x + Math.cos(ry) * dx + Math.sin(ry) * dz, y + dy, z - Math.sin(ry) * dx + Math.cos(ry) * dz];
  const r = [0, ry, 0];
  glass.box(w, h, 0.05, 0xffc978, { p: at(0, 0, 0), r });
  body.box(w + 0.12, 0.06, 0.1, trim, { p: at(0, -h / 2 - 0.02, 0.03), r }); // sill
  body.box(w + 0.08, 0.05, 0.08, trim, { p: at(0, h / 2 + 0.02, 0.02), r });
  for (const sx of [-1, 1]) body.box(0.05, h + 0.04, 0.08, trim, { p: at(sx * (w / 2 + 0.02), 0, 0.02), r });
  body.box(0.035, h, 0.07, trim, { p: at(0, 0, 0.02), r });
  body.box(w, 0.035, 0.07, trim, { p: at(0, 0, 0.02), r });
}

function gable(body, glass, rand, pal) {
  const w = 1.3 + rand() * 0.25, d = 1.05 + rand() * 0.2, h = 0.95 + rand() * 0.2, rh = 0.62 + rand() * 0.15;
  body.box(w + 0.12, 0.12, d + 0.12, C.stone, { p: [0, 0.06, 0] }, 0.03);
  body.box(w, h, d, faces({ pz: pal.wall, nz: pal.wall, px: shade(pal.wall, -0.03), nx: pal.wall, other: pal.wall }), { p: [0, 0.12 + h / 2, 0] });
  // gable triangle (front + back walls continue up under the roof)
  const tri = new THREE.Shape([new THREE.Vector2(-w / 2, 0), new THREE.Vector2(w / 2, 0), new THREE.Vector2(0, rh)]);
  const tg = new THREE.ExtrudeGeometry(tri, { depth: d, bevelEnabled: false });
  body.add(tg, pal.wall, { p: [0, 0.12 + h, -d / 2] });
  // timber corner posts
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) body.box(0.08, h, 0.08, pal.trim, { p: [sx * w / 2, 0.12 + h / 2, sz * d / 2] });
  body.box(w + 0.04, 0.07, 0.07, pal.trim, { p: [0, 0.12 + h, d / 2] });
  // roof slabs
  const ang = Math.atan2(rh, w / 2), slant = Math.hypot(w / 2, rh) + 0.2;
  for (const sx of [-1, 1]) {
    body.box(slant, 0.1, d + 0.34, pal.roof, {
      p: [sx * (w / 4 + 0.05 * Math.cos(ang)), 0.12 + h + rh / 2 + 0.07, 0], r: [0, 0, -sx * ang],
    }, 0.03);
  }
  // chimney
  const cx = (rand() < 0.5 ? -1 : 1) * w * 0.26;
  body.box(0.2, 0.55, 0.22, shade(C.stone, -0.08), { p: [cx, 0.12 + h + rh * 0.55 + 0.1, -d * 0.18] });
  body.box(0.26, 0.07, 0.28, shade(C.stone, -0.14), { p: [cx, 0.12 + h + rh * 0.55 + 0.38, -d * 0.18] });
  // door + step
  body.box(0.36, 0.56, 0.06, pal.door, { p: [0, 0.12 + 0.28, d / 2 + 0.02] }, 0.02);
  body.sphere(0.025, C.brass, { p: [0.11, 0.42, d / 2 + 0.07] }, 6, 5);
  body.box(0.5, 0.06, 0.2, C.stone, { p: [0, 0.03, d / 2 + 0.14] });
  // windows: two front, one round in the gable, one on the side
  windowAt(body, glass, -w * 0.3, 0.12 + h * 0.55, d / 2 + 0.01, 0.26, 0.3, pal.trim);
  windowAt(body, glass, w * 0.3, 0.12 + h * 0.55, d / 2 + 0.01, 0.26, 0.3, pal.trim);
  glass.cyl(0.11, 0.11, 0.05, 0xffc978, { p: [0, 0.12 + h + rh * 0.38, d / 2 + 0.005], r: [Math.PI / 2, 0, 0] }, 12);
  body.add(new THREE.TorusGeometry(0.12, 0.03, 5, 14), pal.trim, { p: [0, 0.12 + h + rh * 0.38, d / 2 + 0.03] });
  windowAt(body, glass, w / 2 + 0.01, 0.12 + h * 0.55, 0, 0.28, 0.3, pal.trim, Math.PI / 2);
  // flower box
  body.box(0.34, 0.08, 0.1, pal.trim, { p: [-w * 0.3, 0.12 + h * 0.55 - 0.21, d / 2 + 0.06] });
  for (let i = 0; i < 4; i++) body.sphere(0.045, [C.rose, C.mustard, 0xf2f0e6][i % 3], { p: [-w * 0.3 - 0.12 + i * 0.08, 0.12 + h * 0.55 - 0.15, d / 2 + 0.07] }, 6, 5);
  return { top: 0.12 + h + rh + 0.2, w, d };
}

function tower(body, glass, rand, pal) {
  const r = 0.52 + rand() * 0.08, h = 1.55 + rand() * 0.25, rr = r + 0.2, rh = 0.95 + rand() * 0.2;
  body.cyl(r + 0.07, r + 0.1, 0.14, C.stone, { p: [0, 0.07, 0] }, 16);
  body.cyl(r, r, h, pal.wall, { p: [0, 0.14 + h / 2, 0] }, 16);
  body.cyl(r + 0.03, r + 0.03, 0.08, pal.trim, { p: [0, 0.14 + h, 0] }, 16);
  body.cone(rr, rh, pal.roof, { p: [0, 0.14 + h + rh / 2 + 0.03, 0] }, 16);
  body.cyl(0.02, 0.02, 0.3, pal.trim, { p: [0, 0.14 + h + rh + 0.12, 0] }, 5);
  body.sphere(0.05, C.brass, { p: [0, 0.14 + h + rh + 0.28, 0] }, 6, 5);
  // door (arched feel via a rounded box) + windows following the wall
  body.box(0.34, 0.55, 0.08, pal.door, { p: [0, 0.14 + 0.28, r - 0.01] }, 0.05);
  body.box(0.48, 0.06, 0.22, C.stone, { p: [0, 0.03, r + 0.12] });
  windowAt(body, glass, 0, 0.14 + h * 0.72, r - 0.005, 0.24, 0.3, pal.trim);
  const a = 0.9;
  windowAt(body, glass, Math.sin(a) * (r - 0.005), 0.14 + h * 0.42, Math.cos(a) * (r - 0.005), 0.22, 0.26, pal.trim, a);
  windowAt(body, glass, Math.sin(-a) * (r - 0.005), 0.14 + h * 0.8, Math.cos(-a) * (r - 0.005), 0.22, 0.26, pal.trim, -a);
  // ivy
  for (let i = 0; i < 7; i++) {
    const t = -1.6 + i * 0.12;
    body.sphere(0.09, i % 2 ? C.grassDark : C.sage, { p: [Math.sin(t) * r, 0.25 + i * 0.13, Math.cos(t) * r], s: [1, 1, 0.6] }, 6, 5);
  }
  return { top: 0.14 + h + rh + 0.36, w: rr * 2, d: rr * 2 };
}

function mushroom(body, glass, rand, pal) {
  const sr = 0.5 + rand() * 0.06, sh = 0.95 + rand() * 0.1, cr = 1.0 + rand() * 0.12;
  const cap = rand() < 0.5 ? 0xc75a4a : shade(pal.roof, 0.02);
  body.lathe([[0.001, 0], [sr + 0.06, 0], [sr + 0.1, 0.25], [sr + 0.04, sh * 0.7], [sr - 0.06, sh], [0.001, sh]], 0xf2e6cf, { p: [0, 0, 0] }, 18);
  body.lathe([[0.001, 0], [cr, 0.02], [cr * 0.98, 0.14], [cr * 0.86, 0.42], [cr * 0.6, 0.66], [cr * 0.3, 0.8], [0.001, 0.84]], cap, { p: [0, sh - 0.08, 0] }, 20);
  body.lathe([[0.001, 0.02], [cr * 0.95, 0.02], [0.001, -0.05]], 0xe8d6b8, { p: [0, sh - 0.08, 0] }, 20);
  // spots
  for (let i = 0; i < 9; i++) {
    const a = i * 2.4 + rand() * 0.5, e = 0.25 + (i % 3) * 0.22;
    const rr = cr * (0.95 - e * 0.5), y = sh - 0.08 + 0.1 + e * 0.62;
    body.sphere(0.09 + rand() * 0.05, 0xfbf3e4, { p: [Math.cos(a) * rr, y, Math.sin(a) * rr], s: [1, 0.45, 1] }, 8, 5);
  }
  body.box(0.3, 0.5, 0.08, pal.door, { p: [0, 0.25, sr + 0.05] }, 0.06);
  body.sphere(0.025, C.brass, { p: [0.09, 0.27, sr + 0.1] }, 6, 5);
  glass.cyl(0.1, 0.1, 0.05, 0xffc978, { p: [-sr * 0.62, sh * 0.62, sr * 0.72], r: [Math.PI / 2, 0, -0.1], order: 'XYZ' }, 12);
  body.add(new THREE.TorusGeometry(0.11, 0.03, 5, 14), pal.trim, { p: [-sr * 0.62, sh * 0.62, sr * 0.76] });
  glass.cyl(0.09, 0.09, 0.05, 0xffc978, { p: [sr * 0.7, sh * 0.5, sr * 0.64], r: [Math.PI / 2, 0, 0] }, 12);
  body.add(new THREE.TorusGeometry(0.1, 0.03, 5, 14), pal.trim, { p: [sr * 0.7, sh * 0.5, sr * 0.68], r: [0, 0.7, 0] });
  // stepping stones + little chimney pipe
  body.cyl(0.14, 0.15, 0.05, C.stone, { p: [0.02, 0.025, sr + 0.3] }, 8);
  body.cyl(0.05, 0.05, 0.4, 0x7b7f86, { p: [cr * 0.45, sh + 0.55, -cr * 0.2] }, 8);
  return { top: sh + 0.95, w: cr * 2, d: cr * 2 };
}

export function buildHouse(variant, rand, colorIndex) {
  const pal = HOUSE_COLORS[colorIndex % HOUSE_COLORS.length];
  const body = new Parts(), glass = new Parts();
  const spec = (variant === 'tower' ? tower : variant === 'mushroom' ? mushroom : gable)(body, glass, rand, pal);
  return { body: body.build(), glass: glass.build(), ...spec };
}

// Signpost with a hanging lantern; the name board is a separate textured quad (see page-friends.js).
export function signpost(body, glow, x, z, ry, { boardW = 0.9, boardH = 0.28, postH = 0.95 } = {}) {
  const T = new THREE.Matrix4().compose(new THREE.Vector3(x, 0, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry), new THREE.Vector3(1, 1, 1));
  const o = { parent: T };
  // posts stand behind the board so they never cover its lettering
  body.box(0.07, postH, 0.07, C.darkWood, { ...o, p: [-boardW * 0.42, postH / 2, -0.07] });
  body.box(0.07, postH * 0.7, 0.07, C.darkWood, { ...o, p: [boardW * 0.42, postH * 0.35, -0.07] });
  body.box(boardW + 0.08, boardH + 0.08, 0.05, C.darkWood, { ...o, p: [0, postH * 0.62, -0.005] });
  // lantern arm + lantern on the tall post
  body.box(0.34, 0.04, 0.04, C.darkWood, { ...o, p: [-boardW * 0.42 - 0.15, postH - 0.04, -0.07] });
  body.box(0.12, 0.03, 0.12, C.navy, { ...o, p: [-boardW * 0.42 - 0.28, postH - 0.13, -0.07] });
  body.box(0.14, 0.03, 0.14, C.navy, { ...o, p: [-boardW * 0.42 - 0.28, postH - 0.33, -0.07] });
  glow.box(0.09, 0.16, 0.09, 0xffd27a, { ...o, p: [-boardW * 0.42 - 0.28, postH - 0.23, -0.07] });
  return { board: new THREE.Vector3(0, postH * 0.62, 0.025).applyMatrix4(T), lantern: new THREE.Vector3(-boardW * 0.42 - 0.28, postH - 0.23, -0.07).applyMatrix4(T) };
}

// The empty plot: tilled soil, corner stakes + string, a wheelbarrow and the "your house here?" sign.
// An open lot: a flat patch of bare earth, pegged out with stakes, sagging rope and little pennants.
// (The floating "+" marker and the sign are added by page-friends.js.)
export function buildPlot(body, rand, flag = C.mustard) {
  const w = 1.8, d = 1.3, z0 = -0.15;
  // bare earth: a slightly irregular low disc, lighter rim
  body.cyl(1, 1.04, 0.05, shade(C.dirt, 0.08), { p: [0, 0.025, z0], s: [w * 0.56, 1, d * 0.56] }, 14);
  body.cyl(1, 1, 0.05, shade(C.dirt, 0.02), { p: [0.03, 0.04, z0 - 0.02], s: [w * 0.47, 1, d * 0.45] }, 12);
  // stakes: corners + mid points, rope in two sagging segments per side
  const hw = w / 2, hd = d / 2, sh = 0.34;
  const stakes = [[-hw, -hd], [0, -hd], [hw, -hd], [hw, 0], [hw, hd], [0, hd], [-hw, hd], [-hw, 0]];
  stakes.forEach(([x, z], i) => {
    body.box(0.06, sh, 0.06, C.cream, { p: [x, sh / 2, z + z0] });
    body.cone(0.045, 0.08, C.cream, { p: [x, sh + 0.04, z + z0] }, 4);
    if (i % 2 === 0) body.box(0.14, 0.09, 0.012, flag, { p: [x + 0.08, sh - 0.02, z + z0] }); // pennant
  });
  for (let i = 0; i < stakes.length; i++) {
    const [ax, az] = stakes[i], [bx, bz] = stakes[(i + 1) % stakes.length];
    for (let k = 0; k < 2; k++) { // two straight pieces dipping at the middle
      const t0 = k * 0.5, t1 = t0 + 0.5;
      const y0 = sh - 0.05 - Math.sin(Math.PI * t0) * 0.07, y1 = sh - 0.05 - Math.sin(Math.PI * t1) * 0.07;
      const x0 = ax + (bx - ax) * t0, x1 = ax + (bx - ax) * t1, zz0 = az + (bz - az) * t0, zz1 = az + (bz - az) * t1;
      const len = Math.hypot(x1 - x0, zz1 - zz0, y1 - y0);
      const ry = Math.atan2(-(zz1 - zz0), x1 - x0), rz = Math.asin((y1 - y0) / len);
      body.box(len + 0.02, 0.022, 0.022, C.white, { p: [(x0 + x1) / 2, (y0 + y1) / 2, (zz0 + zz1) / 2 + z0], r: [0, ry, rz], order: 'YZX' });
    }
  }
  // a little stack of planks and a few stones waiting at the back corner
  for (let i = 0; i < 3; i++) body.box(0.62, 0.05, 0.13, i % 2 ? C.wood : shade(C.wood, 0.05), { p: [-hw + 0.45, 0.05 + i * 0.05, -hd + 0.28 + z0], r: [0, 0.25 + i * 0.08, 0] });
  for (let i = 0; i < 3; i++) body.sphere(0.08 + rand() * 0.04, C.stone, { p: [hw - 0.3 + i * 0.12, 0.07, -hd + 0.3 + (i % 2) * 0.1 + z0], s: [1, 0.6, 1] }, 7, 5);
  return { w, d, z0, top: 1.45 };
}

// The floating "+" marker above the open lot (added to a glow mesh).
export function plusMarker(glow, y = 0) {
  glow.box(0.44, 0.13, 0.13, 0xffd27a, { p: [0, y, 0] }, 0.05);
  glow.box(0.13, 0.44, 0.13, 0xffd27a, { p: [0, y, 0] }, 0.05);
}

// Tiny robot mascot (the blog logo): slate-blue boxy body with cream chest stripes, cream eyes and mouth,
// the logo's red Santa hat, and a little lantern in one hand (lights it up against the dark pines).
export function buildRobot(body, glow, eyes) {
  const slate = 0x55679a, slateDark = 0x44557f;
  body.box(0.34, 0.3, 0.24, slate, { p: [0, 0.2, 0] }, 0.06);
  for (let i = 0; i < 3; i++) body.box(0.24, 0.035, 0.02, C.cream, { p: [0, 0.13 + i * 0.07, 0.12] });
  body.box(0.12, 0.08, 0.08, slateDark, { p: [0, 0.39, 0] });
  body.box(0.48, 0.36, 0.34, slate, { p: [0, 0.6, 0] }, 0.09);
  body.box(0.14, 0.035, 0.02, C.cream, { p: [0, 0.52, 0.17] }); // mouth
  // Santa hat (red cone + cream brim + pompom)
  body.cyl(0.2, 0.21, 0.07, C.cream, { p: [0, 0.8, 0] }, 12);
  body.cone(0.18, 0.34, 0xd4483c, { p: [0.03, 0.99, 0], r: [0, 0, -0.35] }, 12);
  body.sphere(0.05, C.cream, { p: [0.12, 1.13, 0] }, 8, 6);
  for (const sx of [-1, 1]) {
    eyes.sphere(0.06, 0xfff4d8, { p: [sx * 0.11, 0.63, 0.165], s: [1, 1, 0.4] }, 10, 7);
    body.sphere(0.022, 0x1a2030, { p: [sx * 0.11, 0.63, 0.19] }, 6, 5);
  }
  // left arm hangs; right arm holds a lantern out in front
  body.box(0.08, 0.22, 0.1, slateDark, { p: [-0.25, 0.22, 0], r: [0, 0, -0.25] }, 0.03);
  body.box(0.08, 0.2, 0.1, slateDark, { p: [0.24, 0.26, 0.08], r: [-0.9, 0, 0.2] }, 0.03);
  body.cyl(0.008, 0.008, 0.1, C.darkWood, { p: [0.27, 0.27, 0.2] }, 4);
  body.box(0.12, 0.025, 0.12, C.navy, { p: [0.27, 0.22, 0.2] });
  body.box(0.13, 0.025, 0.13, C.navy, { p: [0.27, 0.05, 0.2] });
  glow.box(0.09, 0.15, 0.09, 0xffd27a, { p: [0.27, 0.135, 0.2] });
}

// Scenery: pine (stacked cones) and round tree, bush, rock.
export function pine(body, x, z, s, rand) {
  body.cyl(0.07 * s, 0.09 * s, 0.4 * s, C.darkWood, { p: [x, 0.2 * s, z] }, 6);
  const c = rand() < 0.5 ? C.pine : C.pineDark;
  for (let i = 0; i < 3; i++) body.cone((0.55 - i * 0.13) * s, (0.6 - i * 0.08) * s, shade(c, i * 0.025), { p: [x, (0.5 + i * 0.36) * s, z], r: [0, rand() * 3, 0] }, 7);
}
export function roundTree(body, x, z, s, rand) {
  body.cyl(0.06 * s, 0.1 * s, 0.7 * s, C.darkWood, { p: [x, 0.35 * s, z] }, 6);
  const c = [C.sage, 0x9cb36e, 0x7fa06a][Math.floor(rand() * 3)];
  body.sphere(0.45 * s, c, { p: [x, 0.95 * s, z] }, 10, 8);
  body.sphere(0.3 * s, shade(c, 0.03), { p: [x + 0.25 * s, 0.85 * s, z + 0.1 * s] }, 8, 6);
  body.sphere(0.28 * s, shade(c, -0.02), { p: [x - 0.22 * s, 0.9 * s, z - 0.08 * s] }, 8, 6);
}
export function bush(body, x, z, s, rand) {
  const c = rand() < 0.5 ? C.grassDark : C.sage;
  body.sphere(0.22 * s, c, { p: [x, 0.12 * s, z], s: [1, 0.8, 1] }, 8, 6);
  body.sphere(0.16 * s, shade(c, 0.03), { p: [x + 0.18 * s, 0.1 * s, z + 0.05 * s], s: [1, 0.8, 1] }, 7, 5);
  if (rand() < 0.5) body.sphere(0.04 * s, rand() < 0.5 ? C.rose : 0xf2f0e6, { p: [x, 0.28 * s, z + 0.12 * s] }, 5, 4);
}
export function cloud(body, rand, s = 1) {
  const n = 5 + Math.floor(rand() * 3);
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1) - 0.5;
    const r = (0.35 + (1 - Math.abs(t) * 1.6) * 0.3 + rand() * 0.1) * s;
    body.sphere(r, i % 2 ? C.cloud : 0xf7e8e6, { p: [t * 2.1 * s, r * 0.35, (rand() - 0.5) * 0.3 * s] }, 10, 8);
  }
}
