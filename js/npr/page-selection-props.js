// Props for the Selection banner (page-selection.js): a sideboard (+ optional hutch shelf), a lamp, a plant
// and one prop per recommendation section (games, music, books, film). Every prop is merged into a single
// vertex-coloured geometry (one draw call) plus a few separate moving / textured parts.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { createToonMaterial, markOutline } from './core.js';

export const C = {
  paper: 0xf4eee3, cream: 0xefe4cf, wood: 0xb07a4f, darkWood: 0x8a5a3b, teal: 0x5f8f8b, terracotta: 0xc96f4a,
  mustard: 0xe0b04f, navy: 0x2f3a56, ink: 0x3a2618, brass: 0xd6a54a, sage: 0x86a376, rose: 0xdc9580,
  white: 0xf7f0e2, vinyl: 0x221d26,
};

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _n = new THREE.Vector3();
const _nm = new THREE.Matrix3();
const _c = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);

export const shade = (hex, dl = 0, ds = 0, dh = 0) => _c.set(hex).offsetHSL(dh, ds, dl).getHex();
export const mat4 = (p = [0, 0, 0], r = [0, 0, 0], s = 1) =>
  new THREE.Matrix4().compose(new THREE.Vector3(...p), new THREE.Quaternion().setFromEuler(new THREE.Euler(...r)), new THREE.Vector3(s, s, s));

// Collects primitives (transform + colour) and merges them into one indexed, vertex-coloured geometry.
export class Parts {
  constructor() { this.items = []; }
  // t: { p:[x,y,z], r:[x,y,z], s:number|[x,y,z], parent: Matrix4 }
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
  sphere(r, color, t, ws = 14, hs = 10) { return this.add(new THREE.SphereGeometry(r, ws, hs), color, t); }
  lathe(pts, color, t, seg = 24) { return this.add(new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), seg), color, t); }
  torus(r, tube, color, t, arc = Math.PI * 2, rs = 8, ts = 20) { return this.add(new THREE.TorusGeometry(r, tube, rs, ts, arc), color, t); }
  // Round rod of radius r from a to b.
  rod(a, b, r, color, t = {}, seg = 8) {
    const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b);
    const d = vb.clone().sub(va);
    const g = new THREE.CylinderGeometry(r, r, d.length(), seg);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, d.normalize()));
    return this.add(g, color, { ...t, p: va.add(vb).multiplyScalar(0.5).toArray() });
  }
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
      const g = it.geo, P = g.attributes.position, N = g.attributes.normal;
      _nm.getNormalMatrix(it.m);
      _c.set(it.color);
      for (let i = 0; i < P.count; i++) {
        _p.fromBufferAttribute(P, i).applyMatrix4(it.m);
        _n.fromBufferAttribute(N, i).applyMatrix3(_nm).normalize();
        pos.set([_p.x, _p.y, _p.z], (vo + i) * 3);
        nrm.set([_n.x, _n.y, _n.z], (vo + i) * 3);
        col.set([_c.r, _c.g, _c.b], (vo + i) * 3);
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

const TOON = { bands: 3, softness: 0.05, shadeLift: 0.35 };
export const vcMaterial = (extra) => createToonMaterial({ color: 0xffffff, vertexColors: true, ...TOON, ...extra });
export const glowMaterial = (color, intensity = 3.5) => createToonMaterial({ color, emissive: color, emissiveIntensity: intensity, ...TOON });

export function mesh(geo, mat, { cast = true, receive = true, outline = true } = {}) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = cast; m.receiveShadow = receive;
  if (outline) markOutline(m);
  return m;
}

/* ------------------------------------------------------------------------------------------------
 * Canvas textures
 * ---------------------------------------------------------------------------------------------- */
function canvasTex(w, h, draw, srgb = true) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  draw(cv.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(cv);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// Handheld screen: a tiny pixel-art dusk landscape with a hero and a coin.
export function gameScreenTexture() {
  const t = canvasTex(48, 26, (g, w, h) => {
    const sky = g.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#6d8fb8'); sky.addColorStop(1, '#f2c07a');
    g.fillStyle = sky; g.fillRect(0, 0, w, h);
    g.fillStyle = '#fff1c7'; g.fillRect(36, 4, 4, 4);
    g.fillStyle = '#5f8f8b';
    for (let x = 0; x < w; x++) { const y = 16 + Math.round(Math.sin(x * 0.35) * 2); g.fillRect(x, y, 1, h - y); }
    g.fillStyle = '#7a5236'; g.fillRect(0, 21, w, 5);
    g.fillStyle = '#86a376'; g.fillRect(0, 20, w, 1);
    g.fillStyle = '#c96f4a'; g.fillRect(12, 15, 3, 5); g.fillStyle = '#2f3a56'; g.fillRect(12, 18, 3, 2);
    g.fillStyle = '#ffd27a'; g.fillRect(22, 11, 2, 2); g.fillRect(28, 9, 2, 2);
  });
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.generateMipmaps = false;
  return t;
}

// Retro TV: a cosy anime-ish evening scene with scanlines.
export function tvScreenTexture() {
  return canvasTex(128, 96, (g, w, h) => {
    const sky = g.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#39507a'); sky.addColorStop(0.55, '#d9876a'); sky.addColorStop(1, '#f6cf8a');
    g.fillStyle = sky; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(255,241,199,0.95)'; g.beginPath(); g.arc(88, 50, 13, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#2f3a56';
    g.beginPath(); g.moveTo(0, 70); g.lineTo(26, 52); g.lineTo(46, 64); g.lineTo(70, 48); g.lineTo(104, 68); g.lineTo(128, 58); g.lineTo(128, 96); g.lineTo(0, 96); g.fill();
    g.fillStyle = '#1e2640'; g.fillRect(0, 78, w, 18);
    g.fillStyle = '#ffd27a'; for (let i = 0; i < 7; i++) g.fillRect(8 + i * 17, 82 + (i % 2) * 4, 3, 3);
    g.fillStyle = 'rgba(0,0,0,0.14)'; for (let y = 0; y < h; y += 3) g.fillRect(0, y, w, 1);
    const v = g.createRadialGradient(w / 2, h / 2, 20, w / 2, h / 2, 80);
    v.addColorStop(0, 'rgba(255,255,255,0.1)'); v.addColorStop(1, 'rgba(20,20,40,0.45)');
    g.fillStyle = v; g.fillRect(0, 0, w, h);
  });
}

// Floating music note (alpha map, white on transparent).
export function noteTexture() {
  return canvasTex(64, 64, (g) => {
    g.fillStyle = '#fff'; g.strokeStyle = '#fff'; g.lineWidth = 5; g.lineCap = 'round';
    g.beginPath(); g.ellipse(22, 46, 10, 7, -0.4, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.moveTo(30, 44); g.lineTo(30, 12); g.quadraticCurveTo(40, 18, 48, 26); g.stroke();
  }, false);
}

export function blobTexture() {
  return canvasTex(64, 64, (g, w, h) => {
    const r = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.5, 'rgba(255,255,255,0.6)'); r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r; g.fillRect(0, 0, w, h);
  }, false);
}

/* ------------------------------------------------------------------------------------------------
 * Recommendation props. Local origin = centre of the footprint on the shelf top, front = +z.
 * Each returns { anchor (label point), size: [w, h, d] (pick box), update?(t, h) } and fills `root`.
 * ---------------------------------------------------------------------------------------------- */

// games: a handheld console on a little stand, a gamepad and two cartridges
function games(root, ctx) {
  const P = new Parts();
  // stand
  P.box(0.34, 0.04, 0.2, C.darkWood, { p: [0, 0.02, -0.02] }, 0.012);
  P.box(0.3, 0.2, 0.03, shade(C.darkWood, -0.04), { p: [0, 0.13, -0.1], r: [-0.3, 0, 0] }, 0.01);
  // console, leaning back on the stand
  const M = mat4([0, 0.19, -0.035], [-0.3, 0, 0]);
  P.box(0.44, 0.23, 0.04, C.navy, { parent: M }, 0.018);
  P.box(0.11, 0.23, 0.05, C.teal, { p: [-0.27, 0, 0], parent: M }, 0.035);
  P.box(0.11, 0.23, 0.05, C.terracotta, { p: [0.27, 0, 0], parent: M }, 0.035);
  P.cyl(0.024, 0.026, 0.03, 0x2a2530, { p: [-0.27, 0.045, 0.028], r: [Math.PI / 2, 0, 0], parent: M }, 12);
  P.box(0.05, 0.016, 0.01, 0x2a2530, { p: [-0.27, -0.05, 0.026], parent: M });
  P.box(0.016, 0.05, 0.01, 0x2a2530, { p: [-0.27, -0.05, 0.026], parent: M });
  for (const [x, y] of [[0, 0.03], [0, -0.03], [-0.03, 0], [0.03, 0]]) P.sphere(0.013, C.white, { p: [0.27 + x, 0.03 + y, 0.024], parent: M }, 8, 6);
  P.cyl(0.024, 0.026, 0.03, 0x2a2530, { p: [0.27, -0.06, 0.028], r: [Math.PI / 2, 0, 0], parent: M }, 12);
  // gamepad lying in front
  const G = mat4([0.2, 0.035, 0.2], [0, -0.35, 0]);
  P.box(0.24, 0.05, 0.11, C.white, { parent: G }, 0.024);
  P.sphere(0.058, C.white, { p: [-0.1, -0.003, 0.035], s: [1, 0.55, 1.25], parent: G });
  P.sphere(0.058, C.white, { p: [0.1, -0.003, 0.035], s: [1, 0.55, 1.25], parent: G });
  P.box(0.05, 0.02, 0.016, C.navy, { p: [-0.07, 0.025, 0], parent: G });
  P.box(0.016, 0.02, 0.05, C.navy, { p: [-0.07, 0.025, 0], parent: G });
  [[0.07, -0.022, C.terracotta], [0.07, 0.022, C.teal], [0.048, 0, C.mustard], [0.092, 0, C.navy]]
    .forEach(([x, z, c]) => P.sphere(0.013, c, { p: [x, 0.028, z], parent: G }, 8, 6));
  P.cyl(0.02, 0.022, 0.03, C.navy, { p: [-0.03, 0.03, 0.035], parent: G }, 10);
  P.cyl(0.02, 0.022, 0.03, C.navy, { p: [0.03, 0.03, 0.035], parent: G }, 10);
  // cartridges leaning on the stand
  P.box(0.1, 0.13, 0.016, C.mustard, { p: [-0.3, 0.065, 0.1], r: [-0.12, 0.35, 0.08] }, 0.006);
  P.box(0.07, 0.05, 0.004, C.white, { p: [-0.297, 0.075, 0.109], r: [-0.12, 0.35, 0.08] });
  P.box(0.1, 0.13, 0.016, C.sage, { p: [-0.36, 0.065, 0.02], r: [-0.12, 0.6, -0.06] }, 0.006);
  root.add(mesh(P.build(), ctx.mat()));

  const screenMat = new THREE.MeshBasicMaterial({ map: ctx.textures.game, color: 0xe8e4dc });
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.36, 0.195), screenMat);
  screen.applyMatrix4(new THREE.Matrix4().makeTranslation(0, 0, 0.0215).premultiply(M));
  root.add(screen);
  ctx.glow.push({ mat: screenMat, base: 0xe8e4dc, night: 1.3 });
  return { anchor: new THREE.Vector3(0, 0.36, 0), size: [0.9, 0.36, 0.55] };
}

// music: a record player with a spinning record, sleeves behind and notes floating up
function music(root, ctx) {
  const P = new Parts();
  for (const [x, z] of [[-0.28, -0.2], [0.28, -0.2], [-0.28, 0.2], [0.28, 0.2]]) P.cyl(0.03, 0.03, 0.025, C.ink, { p: [x, 0.0125, z] }, 10);
  P.box(0.68, 0.13, 0.52, C.wood, { p: [0, 0.09, 0] }, 0.025);
  P.box(0.64, 0.012, 0.48, shade(C.cream, -0.04), { p: [0, 0.16, 0] }, 0.004);
  P.cyl(0.215, 0.215, 0.02, 0x3b3440, { p: [-0.07, 0.172, 0] }, 32);
  // tonearm
  P.cyl(0.035, 0.04, 0.04, C.brass, { p: [0.22, 0.186, -0.16] }, 12);
  P.rod([0.22, 0.215, -0.16], [0.16, 0.22, 0.06], 0.009, C.brass);
  P.rod([0.16, 0.22, 0.06], [0.1, 0.21, 0.11], 0.009, C.brass);
  P.box(0.05, 0.02, 0.035, C.ink, { p: [0.09, 0.205, 0.115], r: [0, 0.6, 0] });
  // knobs + a little brass plate
  P.cyl(0.028, 0.028, 0.03, C.cream, { p: [0.2, 0.09, 0.265], r: [Math.PI / 2, 0, 0] }, 12);
  P.cyl(0.028, 0.028, 0.03, C.cream, { p: [0.27, 0.09, 0.265], r: [Math.PI / 2, 0, 0] }, 12);
  P.box(0.16, 0.035, 0.006, C.brass, { p: [-0.12, 0.09, 0.262] });
  // record sleeves standing behind
  P.box(0.4, 0.4, 0.014, C.teal, { p: [-0.12, 0.2, -0.33], r: [-0.14, 0.08, 0] });
  P.cyl(0.13, 0.13, 0.004, C.mustard, { p: [-0.126, 0.21, -0.318], r: [Math.PI / 2 - 0.14, 0, 0] }, 24);
  P.box(0.4, 0.4, 0.014, C.terracotta, { p: [0.14, 0.2, -0.36], r: [-0.12, -0.14, 0] });
  P.box(0.24, 0.05, 0.004, C.white, { p: [0.14, 0.3, -0.35], r: [-0.12, -0.14, 0] });
  // pop-up target light on the plinth's front-right corner (lit at night)
  P.cyl(0.012, 0.012, 0.06, C.brass, { p: [0.285, 0.19, 0.2] }, 8);
  P.cyl(0.028, 0.022, 0.03, C.brass, { p: [0.285, 0.23, 0.2], r: [0.5, 0, 0.35] }, 12);
  root.add(mesh(P.build(), ctx.mat()));
  const lampBulb = new THREE.Mesh(new THREE.SphereGeometry(0.016, 10, 8), new THREE.MeshBasicMaterial({ color: 0x8a6a48 }));
  lampBulb.position.set(0.28, 0.222, 0.21);
  root.add(lampBulb);
  ctx.nightGlow.push({ mat: lampBulb.material, night: new THREE.Color(0xffd08a).multiplyScalar(5) });

  const R = new Parts();
  R.cyl(0.2, 0.2, 0.008, C.vinyl, {}, 40);
  R.cyl(0.16, 0.16, 0.0085, 0x302a36, {}, 40);
  R.cyl(0.14, 0.14, 0.009, C.vinyl, {}, 40);
  R.cyl(0.066, 0.066, 0.01, C.terracotta, {}, 24);
  R.box(0.02, 0.011, 0.04, C.white, { p: [0.03, 0, 0] });
  R.cyl(0.008, 0.008, 0.04, C.brass, { p: [0, 0.015, 0] }, 6);
  const record = mesh(R.build(), ctx.mat());
  record.position.set(-0.07, 0.186, 0);
  root.add(record);

  // notes: small textured quads rising in a loop (one Points draw)
  const n = 5;
  const pos = new Float32Array(n * 3), seed = new Float32Array(n);
  for (let i = 0; i < n; i++) { seed[i] = i / n; pos.set([-0.07 + (i % 2 ? 0.1 : -0.1), 0.3, 0], i * 3); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  const noteMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { uTime: ctx.uniforms.time, uScale: ctx.uniforms.pxScale, uMap: { value: ctx.textures.note }, uColor: { value: new THREE.Color(C.ink) }, uHover: { value: 0 } },
    vertexShader: /* glsl */`
      attribute float aSeed;
      uniform float uTime, uScale, uHover;
      varying float vA;
      void main() {
        float k = fract( aSeed + uTime * ( 0.09 + 0.08 * uHover ) );
        vec3 p = position + vec3( sin( k * 6.0 + aSeed * 9.0 ) * 0.08, k * 0.62, 0.0 );
        vA = smoothstep( 0.0, 0.15, k ) * smoothstep( 1.0, 0.6, k );
        vec4 mv = modelViewMatrix * vec4( p, 1.0 );
        gl_PointSize = 0.1 * uScale / - mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform sampler2D uMap;
      uniform vec3 uColor;
      varying float vA;
      void main() {
        float a = texture2D( uMap, vec2( gl_PointCoord.x, 1.0 - gl_PointCoord.y ) ).a * vA * 0.85;
        if ( a < 0.01 ) discard;
        gl_FragColor = vec4( uColor, a );
      }`,
  });
  const notes = new THREE.Points(g, noteMat);
  notes.frustumCulled = false;
  notes.renderOrder = 3;
  root.add(notes);
  return {
    anchor: new THREE.Vector3(0, 0.44, -0.2), size: [0.8, 0.44, 0.8],
    glowAt: new THREE.Vector3(0.22, 0.26, 0.2), glowColor: 0xffb35c, noteColor: noteMat.uniforms.uColor.value,
    update(t, h) { record.rotation.y = -t * (2.2 + 2.5 * h); noteMat.uniforms.uHover.value = h; },
  };
}

// books: a stack with a ribbon bookmark, one leaning book and a mug of tea
function book(P, w, t, d, color, tr) {
  const b = 0.012;
  P.box(w, b, d, color, { ...tr, p: [0, t / 2 - b / 2, 0].map((v, i) => v + tr.p[i]) }, 0.004);
  P.box(w, b, d, color, { ...tr, p: [0, -t / 2 + b / 2, 0].map((v, i) => v + tr.p[i]) }, 0.004);
  P.box(0.018, t, d, shade(color, -0.04), { ...tr, p: [-w / 2 + 0.009, 0, 0].map((v, i) => v + tr.p[i]) }, 0.006);
  P.box(w - 0.03, t - 0.02, d - 0.024, C.white, { ...tr, p: [0.006, 0, 0].map((v, i) => v + tr.p[i]) });
}
function books(root, ctx) {
  const P = new Parts();
  const stack = [[0.5, 0.075, 0.36, C.navy, 0.05], [0.46, 0.06, 0.33, C.terracotta, -0.12], [0.48, 0.085, 0.35, C.teal, 0.1], [0.4, 0.055, 0.3, C.mustard, -0.05]];
  let y = 0;
  for (const [w, t, d, c, ry] of stack) {
    const q = new THREE.Matrix4().makeRotationY(ry).setPosition(0, y + t / 2, 0);
    book(P, w, t, d, c, { p: [0, 0, 0], parent: q });
    y += t;
  }
  // ribbon from the top book down its front edge
  const top = new THREE.Matrix4().makeRotationY(-0.05);
  P.box(0.03, 0.004, 0.08, C.rose, { p: [0.08, y + 0.002, 0.12], parent: top });
  P.box(0.03, 0.16, 0.004, C.rose, { p: [0.08, y - 0.075, 0.162], r: [0.08, 0, 0.05], parent: top });
  // leaning book on the left
  const L = mat4([-0.34, 0.2, -0.02], [0, 0.15, 0.28]);
  P.box(0.07, 0.4, 0.3, C.sage, { parent: L }, 0.01);
  P.box(0.074, 0.04, 0.304, C.mustard, { p: [0, 0.12, 0], parent: L });
  // mug
  const mx = 0.33, mz = 0.1;
  P.lathe([[0.001, 0], [0.058, 0], [0.062, 0.02], [0.062, 0.11], [0.055, 0.11], [0.055, 0.02], [0.001, 0.02]], C.cream, { p: [mx, 0, mz] }, 20);
  P.cyl(0.063, 0.063, 0.03, C.teal, { p: [mx, 0.06, mz] }, 20);
  P.cyl(0.052, 0.052, 0.004, 0x8a5234, { p: [mx, 0.095, mz] }, 16);
  P.torus(0.032, 0.01, C.cream, { p: [mx + 0.066, 0.058, mz], r: [0, 0, 0] }, Math.PI * 1.3, 6, 12);
  root.add(mesh(P.build(), ctx.mat()));
  return { anchor: new THREE.Vector3(0, 0.44, 0), size: [0.85, 0.44, 0.5] };
}

// film: a little retro TV with antennae and a clapperboard
function film(root, ctx) {
  const P = new Parts();
  for (const [x, z] of [[-0.24, -0.14], [0.24, -0.14], [-0.24, 0.14], [0.24, 0.14]]) P.cyl(0.02, 0.012, 0.07, C.ink, { p: [x, 0.035, z] }, 8);
  P.box(0.62, 0.46, 0.42, C.wood, { p: [0, 0.3, 0] }, 0.06);
  P.box(0.44, 0.35, 0.02, C.cream, { p: [-0.06, 0.3, 0.205] }, 0.03);
  P.box(0.11, 0.35, 0.012, shade(C.wood, -0.06), { p: [0.22, 0.3, 0.208] }, 0.01);
  P.cyl(0.03, 0.03, 0.03, C.mustard, { p: [0.22, 0.4, 0.22], r: [Math.PI / 2, 0, 0] }, 12);
  P.cyl(0.024, 0.024, 0.03, C.cream, { p: [0.22, 0.32, 0.22], r: [Math.PI / 2, 0, 0] }, 12);
  for (let i = 0; i < 4; i++) P.box(0.07, 0.008, 0.006, C.ink, { p: [0.22, 0.24 - i * 0.022, 0.216] });
  // antennae
  P.sphere(0.05, C.ink, { p: [0, 0.53, -0.04], s: [1, 0.6, 1] });
  P.rod([0, 0.55, -0.04], [-0.2, 0.86, -0.08], 0.006, C.brass);
  P.rod([0, 0.55, -0.04], [0.16, 0.84, -0.12], 0.006, C.brass);
  P.sphere(0.014, C.brass, { p: [-0.2, 0.86, -0.08] }, 8, 6);
  P.sphere(0.014, C.brass, { p: [0.16, 0.84, -0.12] }, 8, 6);
  // clapperboard leaning against the right side
  const K = mat4([0.4, 0.11, 0.1], [-0.05, -0.55, 0.22]);
  P.box(0.26, 0.2, 0.016, C.navy, { parent: K }, 0.006);
  for (let i = 0; i < 3; i++) P.box(0.2, 0.006, 0.004, C.white, { p: [0, 0.04 - i * 0.045, 0.009], parent: K });
  const A = new THREE.Matrix4().makeRotationZ(0.22).setPosition(-0.13, 0.11, 0).premultiply(K);
  for (let i = 0; i < 6; i++) P.box(0.045, 0.04, 0.017, i % 2 ? C.white : C.navy, { p: [0.0225 + i * 0.045, 0.02, 0], r: [0, 0, 0], parent: A });
  root.add(mesh(P.build(), ctx.mat()));

  const screenMat = new THREE.MeshBasicMaterial({ map: ctx.textures.tv, color: 0xe6e0d6 });
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.38, 0.29), screenMat);
  screen.position.set(-0.06, 0.3, 0.2165);
  root.add(screen);
  ctx.glow.push({ mat: screenMat, base: 0xe6e0d6, night: 1.55 });
  return {
    anchor: new THREE.Vector3(0, 0.9, -0.08), size: [0.85, 0.88, 0.5],
    glowAt: new THREE.Vector3(-0.06, 0.32, 0.55), glowColor: 0xffc9a0, // the screen's light spill at night
  };
}

export const PROPS = { games, music, books, film };

/* ------------------------------------------------------------------------------------------------
 * Furniture: sideboard (always) + hutch shelf (two-row layout). Built per layout.
 * rows: [{ y, n }] with y = top surface of the row; width W, depth D.
 * ---------------------------------------------------------------------------------------------- */
export const BODY = 0.62, LEG = 0.12;
export function buildFurniture({ W, D, rows, top, doors }) {
  const P = new Parts();
  const dw = C.darkWood, w = C.wood;
  // sideboard: top slab, body, doors, plinth, legs
  P.box(W + 0.1, 0.06, D + 0.08, w, { p: [0, -0.03, 0] }, 0.02);
  P.box(W, BODY, D, dw, { p: [0, -0.06 - BODY / 2, 0] }, 0.02);
  const dn = Math.max(2, doors), dwid = (W - 0.08) / dn;
  for (let i = 0; i < dn; i++) {
    const x = -W / 2 + 0.04 + dwid * (i + 0.5);
    P.box(dwid - 0.05, BODY - 0.14, 0.03, i % 2 ? shade(w, 0.02) : w, { p: [x, -0.06 - BODY / 2 - 0.01, D / 2 + 0.01] }, 0.012);
    P.box(dwid - 0.2, BODY - 0.3, 0.012, shade(w, -0.05), { p: [x, -0.06 - BODY / 2 - 0.01, D / 2 + 0.028] }, 0.006);
    P.sphere(0.026, C.brass, { p: [x + (i % 2 ? -1 : 1) * (dwid / 2 - 0.09), -0.06 - BODY / 2, D / 2 + 0.045] }, 10, 8);
  }
  P.box(W + 0.02, 0.05, D + 0.02, shade(dw, -0.05), { p: [0, -0.06 - BODY - 0.025, 0] }, 0.01);
  const ly = -0.06 - BODY - 0.05 - LEG / 2;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) P.cyl(0.035, 0.022, LEG, shade(dw, -0.08), { p: [sx * (W / 2 - 0.08), ly, sz * (D / 2 - 0.08)] }, 10);
  // hutch: side boards, shelves, back panel, crown
  if (rows.length > 1) {
    const hd = D - 0.1, hz = -D / 2 + hd / 2;
    for (const sx of [-1, 1]) P.box(0.06, top, hd, w, { p: [sx * (W / 2 - 0.03), top / 2, hz] }, 0.015);
    P.box(W - 0.1, top, 0.03, C.cream, { p: [0, top / 2, -D / 2 + 0.02] });
    P.box(W - 0.1, 0.012, 0.02, C.teal, { p: [0, top * 0.5, -D / 2 + 0.04] });
    for (let r = 1; r < rows.length; r++) P.box(W - 0.1, 0.05, hd, w, { p: [0, rows[r].y - 0.025, hz] }, 0.01);
    P.box(W + 0.08, 0.07, hd + 0.08, dw, { p: [0, top + 0.035, hz] }, 0.02);
  }
  return P.build();
}

export function buildLamp(ctx) {
  const P = new Parts();
  P.cyl(0.08, 0.11, 0.04, C.brass, { p: [0, 0.02, 0] }, 20);
  P.lathe([[0.001, 0.04], [0.07, 0.04], [0.09, 0.1], [0.07, 0.2], [0.03, 0.26], [0.001, 0.26]], C.teal, {}, 20);
  P.cyl(0.012, 0.012, 0.22, C.brass, { p: [0, 0.37, 0] }, 8);
  P.lathe([[0.19, 0.44], [0.11, 0.64], [0.1, 0.64], [0.18, 0.44]], 0xf6e2bb, {}, 24);
  const g = new THREE.Group();
  const shadeMat = vcMaterial({ side: THREE.DoubleSide, emissive: 0xffb866, emissiveIntensity: 0.25 });
  g.add(mesh(P.build(), shadeMat));
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.055, 12, 10), glowMaterial(0xffc27a, 4));
  bulb.position.set(0, 0.52, 0);
  g.add(bulb);
  return { group: g, bulb, shadeMat };
}

export function buildPlant(ctx) {
  const P = new Parts();
  P.lathe([[0.001, 0], [0.09, 0], [0.12, 0.2], [0.135, 0.2], [0.135, 0.24], [0.001, 0.24]], C.terracotta, {}, 20);
  P.cyl(0.12, 0.12, 0.01, 0x5a3b24, { p: [0, 0.22, 0] }, 16);
  const rand = ctx.rand;
  for (let i = 0; i < 9; i++) {
    const a = i * 2.4 + rand() * 0.4, tilt = 0.35 + rand() * 0.55, len = 0.22 + rand() * 0.14;
    const M = new THREE.Matrix4().makeRotationY(a).multiply(new THREE.Matrix4().makeRotationX(tilt)).setPosition(0, 0.22, 0);
    P.sphere(0.05, i % 3 ? C.sage : shade(C.teal, 0.05), { p: [0, len * 0.55, 0], s: [0.9, len / 0.1, 0.35], parent: M }, 10, 8);
  }
  const g = new THREE.Group();
  g.add(mesh(P.build(), vcMaterial()));
  return { group: g };
}
