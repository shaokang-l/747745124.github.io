// Geometry + textures for the Categories banner ("the category bookshelf", page-categories.js): the spine
// atlas (one painted spine per category), book meshes, and the bookcase frame / decor for a row layout.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createToonMaterial, markOutline } from './core.js';

export const C = {
  paper: 0xf4eee3, wood: 0xb07a4f, darkWood: 0x8a5a3b, back: 0x6e4a32, brass: 0xd6a54a, pages: 0xf1e6cc,
  terracotta: 0xc96f4a, sage: 0x86a376, leaf: 0x5f8a5a, teal: 0x5f8f8b, cream: 0xefe4cf, mustard: 0xe0b04f,
};
// Book cloth colours (storybook palette); neighbours never repeat.
const CLOTH = [0x5f8f8b, 0xc96f4a, 0x2f3a56, 0xe0b04f, 0x8e3b3b, 0x86a376, 0x6b4f7a, 0xdc9580, 0x3f6f6b, 0xb8793a, 0x4f6b45, 0x4a5a78];

// Shelf metrics (world units ~ metres).
export const M = {
  rowH: 1.08,        // clear height of one shelf compartment
  board: 0.07,       // shelf board thickness
  side: 0.09,        // side panel thickness
  depth: 0.56,       // carcass depth
  bookMaxH: 1.0,
  end: 0.09,         // bookend width
  slot: 0.95,        // free space per row for decor
  plinth: 0.46,      // drawer row under the shelves
  top: 0.1,          // top board thickness
};

export const TOON = { bands: 3, softness: 0.05, shadeLift: 0.35 };
export const vcMaterial = (extra) => createToonMaterial({ color: 0xffffff, vertexColors: true, ...TOON, ...extra });

// Deterministic 0..1 hash of a string (book heights etc. stay stable per category name).
export function hash01(s, salt = 0) {
  let a = 2166136261 ^ salt;
  for (let i = 0; i < s.length; i++) a = Math.imul(a ^ s.charCodeAt(i), 16777619);
  a = Math.imul(a ^ (a >>> 13), 0x5bd1e995);
  return ((a ^ (a >>> 15)) >>> 0) / 4294967296;
}

export function bookWidth(count) {
  return Math.min(0.8, 0.3 + 0.045 * Math.max(0, (count | 0) - 1));
}

export function clothColors(n, rand) {
  const out = [];
  let prev = -1;
  const order = CLOTH.map((c, i) => i);
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  for (let i = 0; i < n; i++) {
    let k = order[i % order.length];
    if (k === prev) k = order[(i + 1) % order.length];
    out.push(CLOTH[k]);
    prev = k;
  }
  return out;
}

/* ------------------------------------------------------------------------------------------------
 * Merged vertex-coloured parts -> one geometry (one draw call per group)
 * ---------------------------------------------------------------------------------------------- */
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
const _c = new THREE.Color();

class Parts {
  constructor() { this.list = []; }
  add(geo, color, p = [0, 0, 0], r = [0, 0, 0], s = 1) {
    let g = geo.index ? geo.toNonIndexed() : geo;
    if (g !== geo) geo.dispose();
    _q.setFromEuler(_e.set(r[0], r[1], r[2]));
    if (typeof s === 'number') _s.setScalar(s); else _s.set(s[0], s[1], s[2]);
    g.applyMatrix4(_m.compose(_p.set(p[0], p[1], p[2]), _q, _s));
    _c.set(color);
    const n = g.attributes.position.count, col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { col[i * 3] = _c.r; col[i * 3 + 1] = _c.g; col[i * 3 + 2] = _c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.list.push(g);
    return this;
  }
  box(w, h, d, color, p, r, radius = 0) {
    const g = radius > 0 ? new RoundedBoxGeometry(w, h, d, 2, Math.min(radius, w / 2, h / 2, d / 2) * 0.99) : new THREE.BoxGeometry(w, h, d);
    return this.add(g, color, p, r);
  }
  cyl(rt, rb, h, color, p, r, seg = 18) { return this.add(new THREE.CylinderGeometry(rt, rb, h, seg), color, p, r); }
  sphere(rad, color, p, s = 1, ws = 16, hs = 12) { return this.add(new THREE.SphereGeometry(rad, ws, hs), color, p, [0, 0, 0], s); }
  build() {
    if (!this.list.length) return null;
    const g = mergeGeometries(this.list, false);
    for (const x of this.list) x.dispose();
    this.list.length = 0;
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }
}

function mesh(geo, mat, outline = true) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true;
  m.receiveShadow = true;
  if (outline) markOutline(m);
  return m;
}

/* ------------------------------------------------------------------------------------------------
 * Spine atlas: every spine painted into one canvas (cloth, foil bands, rotated title, count badge)
 * ---------------------------------------------------------------------------------------------- */
const FONT = '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, "Songti SC", "Noto Serif CJK SC", serif';
const hex = (c) => '#' + c.toString(16).padStart(6, '0');

function luminance(c) {
  const r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255;
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

// Splits a name into k balanced lines at spaces (null if it has too few words).
function splitLines(name, k) {
  const words = name.split(/\s+/).filter(Boolean);
  if (k === 1) return [name];
  if (words.length < k) return null;
  let best = null, score = Infinity;
  const rec = (start, parts) => {
    if (parts.length === k - 1) {
      const all = [...parts, words.slice(start).join(' ')];
      const sc = Math.max(...all.map((l) => l.length));
      if (sc < score) { score = sc; best = all; }
      return;
    }
    for (let i = start + 1; i <= words.length - (k - 1 - parts.length); i++) rec(i, [...parts, words.slice(start, i).join(' ')]);
  };
  rec(0, []);
  return best;
}

// Greedy word wrap into at most maxLines lines of width len (current font); overflow ends in an ellipsis.
function wrapEllipsis(g, text, len, maxLines) {
  const words = text.split(/\s+/).filter(Boolean), out = [];
  const fits = (t) => g.measureText(t).width <= len;
  const clip = (t) => {
    const trim = (u) => u.replace(/[\s,.;:]+$/, '');
    while (t.length > 1 && !fits(trim(t) + '\u2026')) t = t.slice(0, -1);
    return trim(t) + '\u2026';
  };
  let i = 0;
  while (i < words.length && out.length < maxLines) {
    let line = words[i++];
    while (i < words.length && fits(line + ' ' + words[i])) line += ' ' + words[i++];
    out.push(line);
  }
  if (i < words.length) out[out.length - 1] += ' ' + words.slice(i).join(' ');
  return out.map((l) => (fits(l) ? l : clip(l)));
}

function paintSpine(g, x, y, w, h, book) {
  const { cloth, name, count } = book;
  const light = luminance(cloth) > 0.55;
  const ink = light ? '#3a2618' : '#f6ead0';
  const foil = light ? 'rgba(58,38,24,0.75)' : '#e9c26a';
  // cloth + faint weave
  g.fillStyle = hex(cloth);
  g.fillRect(x - 4, y - 4, w + 8, h + 8);
  g.save();
  g.beginPath(); g.rect(x, y, w, h); g.clip();
  g.globalAlpha = 0.06;
  g.fillStyle = light ? '#5a3b24' : '#fff4dc';
  for (let i = 0; i < h; i += 3) g.fillRect(x, y + i, w, 1);
  g.globalAlpha = 1;
  // soft rounded-spine shading at the edges
  const sh = g.createLinearGradient(x, 0, x + w, 0);
  sh.addColorStop(0, 'rgba(30,20,40,0.22)'); sh.addColorStop(0.18, 'rgba(30,20,40,0)');
  sh.addColorStop(0.75, 'rgba(255,245,220,0.06)'); sh.addColorStop(1, 'rgba(30,20,40,0.18)');
  g.fillStyle = sh; g.fillRect(x, y, w, h);
  // foil bands near head and tail
  g.fillStyle = foil;
  const band = Math.max(2, h * 0.008);
  for (const f of [0.05, 0.075, 0.8, 0.825]) g.fillRect(x + w * 0.08, y + h * f, w * 0.84, band);
  g.restore();

  // title, rotated to read top-to-bottom, fitted between the bands in one or two lines; never smaller than
  // a readable minimum — below it the name is wrapped at that size and ellipsised (the hover label has it all)
  const len = h * 0.66, thick = w * 0.8, cx = x + w / 2, top = y + h * 0.11;
  const minF = Math.min(thick * 0.36, h * 0.095);
  const sizeFor = (lines, cap) => {
    let f = Math.min(cap, 90);
    g.font = `600 ${f}px ${FONT}`;
    const widest = Math.max(...lines.map((l) => g.measureText(l).width));
    if (widest > len) f *= len / widest;
    return f;
  };
  let lines = [name], f = 0;
  for (let k = 1; k <= 3; k++) {
    const ls = splitLines(name, k);
    if (!ls) break;
    const fk = sizeFor(ls, thick * (k === 1 ? 0.62 : 0.84 / k));
    if (fk > f * 1.12) { lines = ls; f = fk; }
  }
  if (f < minF) {
    f = minF;
    g.font = `600 ${f}px ${FONT}`;
    lines = wrapEllipsis(g, name, len, Math.max(1, Math.min(3, Math.floor(thick / (f * 1.08)))));
  }
  g.save();
  g.translate(cx, top + len / 2);
  g.rotate(Math.PI / 2);
  g.font = `600 ${f}px ${FONT}`;
  g.fillStyle = ink;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const lh = f * 1.08;
  lines.forEach((l, i) => g.fillText(l, 0, (i - (lines.length - 1) / 2) * lh));
  g.restore();

  // count badge: a little cream label disc near the tail
  const r = Math.min(w * 0.3, h * 0.055);
  const by = y + h * 0.9;
  g.beginPath(); g.arc(cx, by, r, 0, Math.PI * 2);
  g.fillStyle = '#f7efdc'; g.fill();
  g.lineWidth = Math.max(1.5, r * 0.14); g.strokeStyle = light ? '#6e4a32' : '#e9c26a'; g.stroke();
  g.fillStyle = '#3a2618';
  g.font = `700 ${r * (String(count).length > 2 ? 0.8 : 1.05)}px ${FONT}`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(String(count), cx, by + r * 0.06);
}

// Packs all spines into one canvas; returns the texture and each book's cell in UV space.
export function spineAtlas(books, ppu, maxAniso) {
  const PAD = 6, MAXW = 2048;
  const cells = [];
  let x = PAD + 8, y = PAD, rowH = 0, width = 0;
  for (const b of books) {
    const w = Math.max(24, Math.round(b.w * ppu)), h = Math.round(b.h * ppu);
    if (x + w + PAD > MAXW) { x = PAD; y += rowH + PAD * 2; rowH = 0; }
    cells.push({ x, y, w, h });
    x += w + PAD * 2;
    rowH = Math.max(rowH, h);
    width = Math.max(width, x);
  }
  const W = Math.max(64, width), H = Math.max(64, y + rowH + PAD);
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const g = canvas.getContext('2d');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 8, 8); // white texel for the untextured faces
  books.forEach((b, i) => { const c = cells[i]; paintSpine(g, c.x, c.y, c.w, c.h, b); });
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = Math.min(8, maxAniso || 1);
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  const uv = cells.map((c) => ({ u0: c.x / W, u1: (c.x + c.w) / W, v0: 1 - (c.y + c.h) / H, v1: 1 - c.y / H }));
  return { tex, uv, white: [3 / W, 1 - 3 / H] };
}

// One book: origin at the bottom centre, spine facing +z. Cloth via vertex colours, spine via atlas cell.
export function bookGeometry(b, cell, white) {
  const g = new THREE.BoxGeometry(b.w, b.h, b.d);
  g.translate(0, b.h / 2, 0);
  const uv = g.attributes.uv, n = uv.count;
  const col = new Float32Array(n * 3);
  const cloth = new THREE.Color(b.cloth), pages = new THREE.Color(C.pages), white3 = new THREE.Color(1, 1, 1);
  for (let i = 0; i < n; i++) {
    const face = Math.floor(i / 4); // px nx py ny pz nz
    let c = cloth;
    if (face === 4) {
      uv.setXY(i, cell.u0 + uv.getX(i) * (cell.u1 - cell.u0), cell.v0 + uv.getY(i) * (cell.v1 - cell.v0));
      c = white3;
    } else {
      uv.setXY(i, white[0], white[1]);
      if (face === 2) c = pages;
    }
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

// Unit box with welded (smoothed) normals, origin at the bottom centre: inflated by the highlight hull.
export function hullGeometry() {
  const g = new THREE.BoxGeometry(1, 1, 1);
  g.translate(0, 0.5, 0);
  g.deleteAttribute('uv');
  g.deleteAttribute('normal');
  const pos = g.attributes.position, idx = g.index;
  const key = (i) => `${pos.getX(i).toFixed(3)},${pos.getY(i).toFixed(3)},${pos.getZ(i).toFixed(3)}`;
  const map = new Map(), P = [], I = [];
  for (let i = 0; i < pos.count; i++) {
    const k = key(i);
    if (!map.has(k)) { map.set(k, P.length / 3); P.push(pos.getX(i), pos.getY(i), pos.getZ(i)); }
  }
  for (let i = 0; i < idx.count; i++) I.push(map.get(key(idx.getX(i))));
  g.dispose();
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  out.setIndex(I);
  // corner normals = normalised position from the box centre
  const N = [];
  for (let i = 0; i < P.length; i += 3) {
    const v = new THREE.Vector3(P[i], P[i + 1] - 0.5, P[i + 2]).normalize();
    N.push(v.x, v.y, v.z);
  }
  out.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  return out;
}

/* ------------------------------------------------------------------------------------------------
 * Layout: split books (page order) into balanced rows
 * ---------------------------------------------------------------------------------------------- */
export function splitRows(books, rows) {
  const gap = 0.012;
  const total = books.reduce((s, b) => s + b.w + gap, 0);
  const out = [];
  let cur = [], acc = 0, left = total;
  for (let i = 0; i < books.length; i++) {
    const b = books[i];
    const remainingRows = rows - out.length;
    const target = left / remainingRows;
    const bw = b.w + gap;
    const booksLeft = books.length - i;
    if (cur.length && remainingRows > 1 && (acc + bw / 2 > target || booksLeft < remainingRows)) {
      out.push(cur); left -= acc; cur = []; acc = 0;
    }
    cur.push(b); acc += bw;
  }
  out.push(cur);
  return out.map((r) => ({ books: r, width: r.reduce((s, b) => s + b.w + gap, 0) }));
}

// Row count whose bookcase best matches the band's aspect ratio.
// Floor props flanking the bookcase on wide bands (left: plant + book pile, right: ladder).
export const WIDE = { aspect: 1.5, left: 1.35, right: 0.25 };

export function bestRows(books, aspect) {
  let best = 1, score = Infinity;
  const extra = aspect > WIDE.aspect ? WIDE.left + WIDE.right : 0;
  const maxRows = Math.max(1, Math.min(6, books.length));
  for (let r = 1; r <= maxRows; r++) {
    const rows = splitRows(books, r);
    const w = Math.max(...rows.map((x) => x.width)) + 2 * M.end + M.slot + 2 * M.side + extra;
    const h = r * (M.rowH + M.board) + M.plinth + M.top + 0.75;
    const sc = Math.abs(Math.log((w / h) / (aspect * 0.92)));
    if (sc < score - 0.02) { score = sc; best = r; }
  }
  return best;
}

/* ------------------------------------------------------------------------------------------------
 * Bookcase frame + decor for a layout. Returns { group, anims (swaying decor), bulb (lamp), flame (candle), bounds }
 * and places the book meshes (rowsOf: [{ books:[{mesh, w, d, h}] }]).
 * ---------------------------------------------------------------------------------------------- */
export function buildCase(rowsOf, rand, mats, wide) {
  const group = new THREE.Group();
  const frame = new Parts(), decor = new Parts();
  const nRows = rowsOf.length;
  const inner = Math.max(1.6, Math.max(...rowsOf.map((r) => r.width)) + 2 * M.end + M.slot);
  const W = inner + 2 * M.side, D = M.depth;
  const y0 = M.plinth; // bottom of the lowest compartment
  const Hc = nRows * (M.rowH + M.board) + M.board;
  const H = y0 + Hc + M.top;
  const zf = D / 2; // front plane

  // carcass: sides, back, top, shelves, plinth with drawers
  const wood = C.wood, dark = C.darkWood;
  frame.box(M.side, H, D, wood, [-W / 2 + M.side / 2, H / 2, 0], undefined, 0.02);
  frame.box(M.side, H, D, wood, [W / 2 - M.side / 2, H / 2, 0], undefined, 0.02);
  frame.box(inner, Hc, 0.04, C.back, [0, y0 + Hc / 2, -D / 2 + 0.02]);
  frame.box(W + 0.14, M.top, D + 0.1, wood, [0, H - M.top / 2, 0.02], undefined, 0.03);
  for (let r = 0; r <= nRows; r++) {
    frame.box(inner, M.board, D - 0.04, r === 0 ? dark : wood, [0, y0 + r * (M.rowH + M.board) + M.board / 2, 0.01]);
  }
  frame.box(W, 0.08, D + 0.02, dark, [0, 0.04, 0.01]);
  frame.box(inner, y0 - 0.08, D - 0.06, dark, [0, 0.08 + (y0 - 0.08) / 2, -0.02]);
  const drawers = Math.max(2, Math.min(5, Math.round(inner / 1.3)));
  const dw = inner / drawers;
  for (let i = 0; i < drawers; i++) {
    const cx = -inner / 2 + dw * (i + 0.5);
    frame.box(dw - 0.05, y0 - 0.16, 0.04, wood, [cx, 0.08 + (y0 - 0.08) / 2, zf - 0.03], undefined, 0.015);
    frame.sphere(0.035, C.brass, [cx, 0.08 + (y0 - 0.08) / 2, zf + 0.005], 1, 10, 8);
  }
  // little feet
  for (const sx of [-1, 1]) frame.box(0.14, 0.06, 0.14, dark, [sx * (W / 2 - 0.1), -0.03, zf - 0.12], undefined, 0.02);

  // books + bookends + decor per row (decor alternates sides)
  const gap = 0.012;
  const anims = [];
  rowsOf.forEach((row, r) => {
    const yb = y0 + M.board + (nRows - 1 - r) * (M.rowH + M.board); // row 0 is the top shelf
    const decorLeft = r % 2 === 1;
    let x = -inner / 2 + (decorLeft ? inner - row.width - 2 * M.end : 0);
    const endAt = (ex) => {
      frame.box(M.end * 0.35, 0.5, 0.32, C.brass, [ex, yb + 0.25, 0], undefined, 0.01);
      frame.box(M.end, 0.03, 0.32, C.brass, [ex, yb + 0.015, 0]);
    };
    endAt(x + M.end * 0.4); x += M.end;
    for (const b of row.books) {
      b.home.set(x + b.w / 2, yb, zf - 0.035 - b.d / 2 + (b.jit - 0.5) * 0.03);
      b.mesh.position.copy(b.home);
      x += b.w + gap;
    }
    endAt(x + M.end * 0.6);
    // decor in the free slot
    const free0 = decorLeft ? -inner / 2 : x + M.end;
    const free1 = decorLeft ? -inner / 2 + inner - row.width - 2 * M.end : inner / 2;
    const room = free1 - free0;
    const kind = (r + Math.floor(rand() * 3)) % 3;
    const cx = (free0 + free1) / 2;
    if (room > 0.45) {
      if (kind === 0 || room < 0.6) layStack(decor, cx, yb, Math.min(0.6, room * 0.8), rand);
      else if (kind === 1) anims.push(plant(group, mats, cx, yb, zf));
      else globe(decor, cx, yb);
      if (room > 1.4) layStack(decor, decorLeft ? free0 + 0.4 : free1 - 0.4, yb, 0.55, rand);
    }
  });

  // on top: reading lamp (glowing bulb) left, a stack of books + small plant right
  const yt = H;
  const lx = -W / 2 + Math.min(0.7, W * 0.2);
  decor.cyl(0.14, 0.17, 0.05, C.brass, [lx, yt + 0.025, 0]);
  decor.cyl(0.018, 0.018, 0.52, C.brass, [lx, yt + 0.3, 0]);
  decor.cyl(0.018, 0.018, 0.3, C.brass, [lx + 0.12, yt + 0.6, 0.02], [0, 0, -1.1]);
  const shade = new THREE.CylinderGeometry(0.1, 0.22, 0.22, 20, 1, true);
  decor.add(shade, C.mustard, [lx + 0.27, yt + 0.6, 0.04], [0, 0, -0.35]);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.06, 14, 10), mats.glow);
  bulb.position.set(lx + 0.3, yt + 0.51, 0.04);
  group.add(bulb);
  // a candle on the stack of books: unlit by day, the flame (and its light, page-categories.js) at night
  const cx = W / 2 - 0.55, cy = layStack(decor, cx, yt, 0.62, rand);
  decor.cyl(0.1, 0.11, 0.025, C.brass, [cx, cy + 0.0125, 0.02]);
  decor.cyl(0.045, 0.048, 0.2, C.cream, [cx, cy + 0.125, 0.02], undefined, 12);
  decor.cyl(0.004, 0.004, 0.03, C.back, [cx, cy + 0.24, 0.02], undefined, 4);
  const flame = new THREE.Mesh(new THREE.SphereGeometry(0.03, 10, 8), mats.flame);
  flame.geometry.translate(0, 0.03, 0);
  flame.scale.set(1, 1.9, 1);
  flame.position.set(cx, cy + 0.245, 0.02);
  group.add(flame);
  if (W > 3.2) anims.push(plant(group, mats, W / 2 - 1.15, yt, 0.02, 0.9));

  if (wide) {
    // library ladder: its top hooks over the front lip of the cornice, its foot stands out on the floor
    const top = new THREE.Vector3(W / 2 - 0.34, H + 0.03, zf + 0.13), foot = new THREE.Vector3(W / 2 - 0.2, 0, zf + 0.8);
    const len = top.distanceTo(foot), mid = top.clone().add(foot).multiplyScalar(0.5);
    const tilt = Math.atan2(top.z - foot.z, top.y - foot.y), roll = Math.atan2(foot.x - top.x, top.y - foot.y);
    for (const dx of [-0.2, 0.2]) {
      decor.box(0.05, len, 0.06, C.darkWood, [mid.x + dx, mid.y, mid.z], [-tilt, 0, roll], 0.015);
      decor.box(0.05, 0.05, 0.12, C.brass, [top.x + dx, top.y - 0.01, top.z - 0.05], undefined, 0.01); // hooks
    }
    const rungs = Math.max(3, Math.floor(len / 0.32));
    for (let i = 1; i < rungs; i++) {
      const f = i / rungs;
      decor.cyl(0.02, 0.02, 0.4, C.wood, [foot.x + (top.x - foot.x) * f, foot.y + (top.y - foot.y) * f, foot.z + (top.z - foot.z) * f], [0, 0, Math.PI / 2], 8);
    }
    // left: a pile of big books on the floor and a floor plant
    layStack(decor, -W / 2 - 0.4, 0, 0.62, rand);
    layStack(decor, -W / 2 - 0.42, 0.26, 0.5, rand);
    anims.push(plant(group, mats, -W / 2 - 1.0, 0, 0.15, 1.9));
  }

  const fm = mesh(frame.build(), mats.frame);
  group.add(fm);
  const dg = decor.build();
  if (dg) group.add(mesh(dg, mats.frame));
  const bounds = new THREE.Box3(new THREE.Vector3(-W / 2 - (wide ? WIDE.left : 0.1), -0.06, -D / 2), new THREE.Vector3(W / 2 + (wide ? WIDE.right : 0.1), H + 0.75, D / 2 + (wide ? 0.85 : 0.3)));
  return { group, anims, bulb, flame, bounds, W, H, D };
}

function layStack(p, cx, yb, w, rand) {
  let y = yb;
  const n = 2 + Math.floor(rand() * 2);
  for (let i = 0; i < n; i++) {
    const h = 0.07 + rand() * 0.04;
    const ww = w * (0.8 + rand() * 0.2);
    p.box(ww, h, 0.3 + rand() * 0.06, CLOTH[Math.floor(rand() * CLOTH.length)], [cx + (rand() - 0.5) * 0.06, y + h / 2, 0.02], [0, (rand() - 0.5) * 0.25, 0], 0.01);
    y += h;
  }
  return y;
}

function globe(p, cx, yb) {
  p.cyl(0.1, 0.13, 0.04, C.darkWood, [cx, yb + 0.02, 0]);
  p.cyl(0.015, 0.015, 0.12, C.brass, [cx, yb + 0.1, 0]);
  p.add(new THREE.TorusGeometry(0.2, 0.012, 6, 28, Math.PI * 1.2), C.brass, [cx, yb + 0.38, 0], [0, 0, -Math.PI * 0.1 - Math.PI / 2 + 0.4]);
  p.sphere(0.18, C.teal, [cx, yb + 0.38, 0], 1, 20, 14);
  p.sphere(0.07, C.sage, [cx + 0.07, yb + 0.44, 0.13], [1, 0.7, 0.5], 8, 6);
}

// Potted plant: its own group so it can sway.
function plant(parent, mats, cx, yb, z, s = 1) {
  const pot = new Parts();
  pot.cyl(0.13 * s, 0.1 * s, 0.2 * s, C.terracotta, [0, 0.1 * s, 0]);
  pot.cyl(0.14 * s, 0.14 * s, 0.04 * s, C.terracotta, [0, 0.2 * s, 0]);
  const leaves = new Parts();
  const L = [[0, 0.36, 0, 0.13], [-0.1, 0.3, 0.05, 0.1], [0.1, 0.32, 0.03, 0.11], [0.03, 0.46, -0.02, 0.1], [-0.05, 0.42, 0.08, 0.08]];
  for (const [x, y, zz, r] of L) leaves.sphere(r * s, y > 0.4 ? C.sage : C.leaf, [x * s, y * s, zz * s], [1, 0.85, 1], 10, 8);
  const g = new THREE.Group();
  g.position.set(cx, yb, z);
  g.add(mesh(pot.build(), mats.frame));
  const lg = new THREE.Group();
  lg.position.y = 0.2 * s;
  const lm = mesh(leaves.build(), mats.frame);
  lm.position.y = -0.2 * s;
  lg.add(lm);
  g.add(lg);
  parent.add(g);
  return lg;
}
