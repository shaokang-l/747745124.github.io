// Small procedural-geometry helpers for the forest hero: lofted tubes / bodies and geometry merging.
import * as THREE from 'three';

const _t = new THREE.Vector3();
const _s = new THREE.Vector3();
const _u = new THREE.Vector3();
const _p = new THREE.Vector3();
const _q = new THREE.Vector3();
const Z = new THREE.Vector3(0, 0, 1);
const tmpColor = new THREE.Color();

// Uniform Catmull-Rom interpolation of a scalar key list at u in [0, 1] (keys evenly spaced).
function crScalar(keys, u) {
  const n = keys.length;
  if (n === 1) return keys[0];
  const f = Math.min(Math.max(u, 0), 1) * (n - 1);
  const i = Math.min(Math.floor(f), n - 2);
  const t = f - i;
  const p0 = keys[Math.max(i - 1, 0)], p1 = keys[i], p2 = keys[i + 1], p3 = keys[Math.min(i + 2, n - 1)];
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

/**
 * Lofts a closed tube along a Catmull-Rom curve through `points` ([x, y, z] keys).
 * radii: per key, a number (round) or [side, top, bottom] half-extents (egg / ellipse sections).
 * planar: section "side" axis stays on world Z (bodies, legs; keeps sagittal symmetry);
 *         otherwise a parallel-transported frame (antlers, tines).
 * pinch: narrows the upper half of the section (withers, skull ridge).
 * color(u, sinTheta, cosTheta) -> THREE.Color (linear) for a vertex colour attribute.
 * radiusAt(u, r) may override the interpolated radius scale (tapers, tips).
 */
export function loft(points, {
  radii, seg = 6, radial = 16, planar = true, pinch = 0, color = null, radiusAt = null,
  capStart = true, capEnd = true, curveType = 'catmullrom', tension = 0.5, attrs = null,
} = {}) {
  const pts = points.map((p) => new THREE.Vector3(p[0], p[1], p[2] || 0));
  const curve = new THREE.CatmullRomCurve3(pts, false, curveType, tension);
  const rs = radii.map((r) => (Array.isArray(r) ? r : [r, r, r]));
  const kw = rs.map((r) => r[0]), kt = rs.map((r) => r[1]), kb = rs.map((r) => r[2]);
  const S = (pts.length - 1) * seg + 1;
  const R = radial;
  const pos = [], col = [], extra = attrs ? attrs.map(() => []) : null;
  let prevN = null;
  const nrm = new THREE.Vector3();

  const pushExtra = (u) => { if (attrs) attrs.forEach((a, k) => extra[k].push(a.fn(u))); };
  const pushColor = (u, s, c) => {
    if (!color) return;
    const cc = color(u, s, c);
    col.push(cc.r, cc.g, cc.b);
  };

  for (let i = 0; i < S; i++) {
    const u = i / (S - 1);
    curve.getPoint(u, _p);
    curve.getTangent(u, _t);
    if (planar) {
      _s.copy(Z).addScaledVector(_t, -_t.dot(Z));
      if (_s.lengthSq() < 1e-8) _s.set(1, 0, 0);
      _s.normalize();
    } else {
      if (!prevN) {
        // any vector perpendicular to the first tangent
        nrm.set(0, 1, 0);
        if (Math.abs(_t.y) > 0.9) nrm.set(1, 0, 0);
        prevN = new THREE.Vector3().crossVectors(_t, nrm).normalize();
      }
      prevN.addScaledVector(_t, -_t.dot(prevN)).normalize();
      _s.copy(prevN);
    }
    _u.crossVectors(_s, _t).normalize();
    let w = crScalar(kw, u), top = crScalar(kt, u), bot = crScalar(kb, u);
    if (radiusAt) { const k = radiusAt(u); w *= k; top *= k; bot *= k; }
    for (let j = 0; j < R; j++) {
      const a = (j / R) * Math.PI * 2;
      const c = Math.cos(a), s = Math.sin(a);
      const up = s >= 0 ? top * s : bot * s;
      const side = w * c * (1 - pinch * Math.max(s, 0) * Math.max(s, 0));
      _q.copy(_p).addScaledVector(_s, side).addScaledVector(_u, up);
      pos.push(_q.x, _q.y, _q.z);
      pushColor(u, s, c);
      pushExtra(u);
    }
  }
  const idx = [];
  for (let i = 0; i < S - 1; i++) {
    for (let j = 0; j < R; j++) {
      const a = i * R + j, b = i * R + ((j + 1) % R), c = (i + 1) * R + j, d = (i + 1) * R + ((j + 1) % R);
      idx.push(a, c, b, b, c, d);
    }
  }
  if (capStart) {
    curve.getPoint(0, _p); curve.getTangent(0, _t);
    const p = pos.length / 3;
    const r0 = Math.min(crScalar(kw, 0), crScalar(kt, 0)) * 0.6 * (radiusAt ? radiusAt(0) : 1);
    _q.copy(_p).addScaledVector(_t, -r0);
    pos.push(_q.x, _q.y, _q.z); pushColor(0, 0, 1); pushExtra(0);
    for (let j = 0; j < R; j++) idx.push(p, j, (j + 1) % R);
  }
  if (capEnd) {
    curve.getPoint(1, _p); curve.getTangent(1, _t);
    const q = pos.length / 3;
    const r1 = Math.min(crScalar(kw, 1), crScalar(kt, 1)) * 0.6 * (radiusAt ? radiusAt(1) : 1);
    _q.copy(_p).addScaledVector(_t, r1);
    pos.push(_q.x, _q.y, _q.z); pushColor(1, 0, 1); pushExtra(1);
    const base = (S - 1) * R;
    for (let j = 0; j < R; j++) idx.push(q, base + ((j + 1) % R), base + j);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  if (color) g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  if (attrs) attrs.forEach((a, k) => g.setAttribute(a.name, new THREE.Float32BufferAttribute(extra[k], a.size || 1)));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// Gives a geometry a constant vertex colour (so it can be merged with vertex-coloured parts).
export function paint(geo, hexOrColor) {
  tmpColor.set(hexOrColor);
  const n = geo.attributes.position.count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = tmpColor.r; a[i * 3 + 1] = tmpColor.g; a[i * 3 + 2] = tmpColor.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return geo;
}

// Merges geometries that share the same attribute set (index optional). Drops attributes not common to all.
export function merge(geos) {
  const list = geos.map((g) => (g.index ? g : g.setIndex([...Array(g.attributes.position.count).keys()])));
  const names = Object.keys(list[0].attributes).filter((n) => list.every((g) => g.attributes[n]));
  const out = new THREE.BufferGeometry();
  let total = 0, totalIdx = 0;
  for (const g of list) { total += g.attributes.position.count; totalIdx += g.index.count; }
  for (const n of names) {
    const size = list[0].attributes[n].itemSize;
    const arr = new Float32Array(total * size);
    let o = 0;
    for (const g of list) {
      const a = g.attributes[n];
      for (let i = 0; i < a.count; i++) for (let k = 0; k < size; k++) arr[o++] = a.getComponent(i, k);
    }
    out.setAttribute(n, new THREE.BufferAttribute(arr, size));
  }
  const IndexArray = total > 65535 ? Uint32Array : Uint16Array;
  const idx = new IndexArray(totalIdx);
  let o = 0, base = 0;
  for (const g of list) {
    const ia = g.index.array;
    for (let i = 0; i < ia.length; i++) idx[o++] = ia[i] + base;
    base += g.attributes.position.count;
  }
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  for (const g of geos) g.dispose();
  return out;
}

// Cheap deterministic 2D value noise (smooth), for terrain and scatter masks.
export function valueNoise2D(seed = 1) {
  const hash = (x, y) => {
    let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 2147483647);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  return (x, y) => {
    const ix = Math.floor(x), iy = Math.floor(y);
    let fx = x - ix, fy = y - iy;
    fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
    const a = hash(ix, iy), b = hash(ix + 1, iy), c = hash(ix, iy + 1), d = hash(ix + 1, iy + 1);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
}

// Additive blending that leaves destination alpha untouched (the NPR composite reads scene alpha).
export function additive(material) {
  material.blending = THREE.CustomBlending;
  material.blendEquation = THREE.AddEquation;
  material.blendSrc = THREE.OneFactor;
  material.blendDst = THREE.OneFactor;
  material.blendSrcAlpha = THREE.ZeroFactor;
  material.blendDstAlpha = THREE.OneFactor;
  material.transparent = true;
  material.depthWrite = false;
  return material;
}
