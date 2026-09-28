// The forest around the stag: ground, instanced trunks in depth layers, framing foreground trunks,
// ferns, grass, fallen leaves, glowing mushrooms and mossy rocks.
import * as THREE from 'three';
import { createToonMaterial, markOutline, seededRandom } from './core.js';
import { loft, merge, valueNoise2D } from './forest-geo.js';

const smooth = (e0, e1, x) => { const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1); return t * t * (3 - 2 * t); };
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();

function compose(mesh, i, x, y, z, rx, ry, rz, sx, sy = sx, sz = sx) {
  _q.setFromEuler(_e.set(rx, ry, rz));
  _m.compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz));
  mesh.setMatrixAt(i, _m);
}

/* ---------------------------------------------------------------- geometry builders */

// Unit trunk (radius 1 at the base, height 1): taper, buttress-root flare and bark ridges.
function trunkGeometry(radial = 14) {
  const ys = [-0.01, 0, 0.004, 0.009, 0.016, 0.028, 0.05, 0.09, 0.16, 0.26, 0.4, 0.58, 0.8, 1];
  const pos = [], idx = [];
  const R = radial;
  for (let i = 0; i < ys.length; i++) {
    const y = ys[i];
    const taper = 1 - 0.38 * y;
    const flare = Math.exp(-Math.max(y, 0) / 0.01) * 0.75;
    for (let j = 0; j < R; j++) {
      const a = (j / R) * Math.PI * 2;
      const lobes = 0.55 + 0.45 * Math.cos(a * 3 + 0.7) * Math.cos(a * 2 - 0.4);
      const ridges = 1 + 0.035 * Math.sin(a * 7) + 0.02 * Math.sin(a * 11 + 1);
      const r = taper * ridges * (1 + flare * lobes);
      pos.push(Math.cos(a) * r, y, Math.sin(a) * r);
    }
  }
  for (let i = 0; i < ys.length - 1; i++) {
    for (let j = 0; j < R; j++) {
      const a = i * R + j, b = i * R + ((j + 1) % R), c = (i + 1) * R + j, d = (i + 1) * R + ((j + 1) % R);
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function lumpGeometry(detail, seed, lump) {
  const g = new THREE.IcosahedronGeometry(1, detail);
  g.deleteAttribute('uv');
  const n = valueNoise2D(seed);
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).normalize();
    const k = 1 + lump * (n(v.x * 2.1 + 5, v.z * 2.1 + v.y * 1.7) - 0.5) * 2 + lump * 0.5 * (n(v.y * 4 + 9, v.x * 4) - 0.5);
    p.setXYZ(i, v.x * k, v.y * k, v.z * k);
  }
  return mergeVertices(g);
}

// IcosahedronGeometry is non-indexed; weld it so displaced normals stay smooth.
function mergeVertices(g) {
  const p = g.attributes.position;
  const map = new Map(), pos = [], idx = [];
  for (let i = 0; i < p.count; i++) {
    const key = `${p.getX(i).toFixed(4)},${p.getY(i).toFixed(4)},${p.getZ(i).toFixed(4)}`;
    let k = map.get(key);
    if (k === undefined) { k = pos.length / 3; map.set(key, k); pos.push(p.getX(i), p.getY(i), p.getZ(i)); }
    idx.push(k);
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setIndex(idx);
  out.computeVertexNormals();
  g.dispose();
  return out;
}

function fernClumpGeometry(rand) {
  const pos = [], col = [];
  const base = new THREE.Color(0x2c4424), tip = new THREE.Color(0x5b7a37), dry = new THREE.Color(0x8a5a2c);
  const fronds = 11;
  const put = (px, py, pz, cy, sy, s, isDry, lift) => {
    pos.push(px * cy - pz * sy, py, px * sy + pz * cy);
    _c.copy(base).lerp(tip, s * 0.8 + lift);
    if (isDry) _c.lerp(dry, 0.75);
    col.push(_c.r, _c.g, _c.b);
  };
  for (let f = 0; f < fronds; f++) {
    const len = 0.5 + rand() * 0.4;
    const rise = 0.3 + rand() * 0.2;
    const yaw = (f / fronds) * Math.PI * 2 + rand() * 0.4;
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    const isDry = rand() < 0.15;
    // arching rachis that droops toward the tip
    const P = (s) => [s * len, Math.sin(Math.min(s, 1) * Math.PI * 0.85) * len * rise - s * s * len * 0.3];
    const N = 28;
    // rachis: a thin strip so no leaflet floats
    for (let i = 0; i < N; i++) {
      const s0 = i / N, s1 = (i + 1) / N, w0 = 0.01 * (1 - s0), w1 = 0.01 * (1 - s1);
      const [x0, y0] = P(s0), [x1, y1] = P(s1);
      for (const [px, py, pz, s] of [[x0, y0, -w0, s0], [x1, y1, -w1, s1], [x0, y0, w0, s0], [x0, y0, w0, s0], [x1, y1, -w1, s1], [x1, y1, w1, s1]]) {
        put(px, py, pz, cy, sy, s, isDry, 0);
      }
    }
    for (let i = 1; i < N; i++) {
      const s = i / N, ds = 0.6 / N;
      const [xa, ya] = P(s - ds), [xb, yb] = P(s + ds);
      // overlapping leaflets angled toward the frond tip, longest in the lower third
      const pl = len * 0.143 * Math.sin(Math.PI * Math.min(1, (1 - s) * 1.1 + 0.06)) * (1 - s * 0.3);
      for (const side of [1, -1]) {
        const [xm, ym] = P(s);
        // lanceolate leaflet: base on the rachis, rounded shoulders, pointed tip angled toward the frond tip
        const L = (f, w) => [xm + pl * 0.55 * f + w * 0.35 * pl, ym - pl * 0.3 * f, side * pl * 0.85 * f];
        const a = [xa, ya, 0], b = [xb, yb, 0], tipP = L(1, 0), shA = L(0.45, -0.16), shB = L(0.5, 0.2);
        const tris = [[a, shA, tipP], [a, tipP, b], [tipP, shB, b]];
        for (const tri of tris) {
          if (side < 0) tri.reverse();
          for (const [px, py, pz] of tri) put(px, py, pz, cy, sy, s, isDry, pz !== 0 ? 0.25 : 0);
        }
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  // soft, mostly-up normals so a clump shades as one mass
  const nr = g.attributes.normal;
  for (let i = 0; i < nr.count; i++) {
    _p.fromBufferAttribute(nr, i);
    if (_p.y < 0) _p.negate();
    _p.y += 1.2; _p.normalize();
    nr.setXYZ(i, _p.x, _p.y, _p.z);
  }
  return g;
}

function grassTuftGeometry(rand, low) {
  const pos = [], col = [];
  const a = new THREE.Color(0x4a5a2a), b = new THREE.Color(0xa8a052);
  const blades = low ? 8 : 14; // low quality has no MSAA: fewer, wider blades
  for (let k = 0; k < blades; k++) {
    const h = 0.18 + rand() * 0.22, w = low ? 0.03 + rand() * 0.015 : 0.012 + rand() * 0.008;
    const yaw = rand() * Math.PI * 2, lean = 0.2 + rand() * 0.5;
    const ox = (rand() - 0.5) * 0.08, oz = (rand() - 0.5) * 0.08;
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    const S = 3;
    const pt = (s, side) => {
      const x = Math.sin(s * lean) * h * s * 0.8, y = h * s, z = side * w * (1 - s);
      return [ox + x * cy - z * sy, y, oz + x * sy + z * cy];
    };
    for (let i = 0; i < S; i++) {
      const s0 = i / S, s1 = (i + 1) / S;
      const quad = [pt(s0, -1), pt(s0, 1), pt(s1, -1), pt(s1, 1)];
      for (const t of [[0, 1, 2], [1, 3, 2]]) {
        for (const q of t) {
          pos.push(...quad[q]);
          const s = q < 2 ? s0 : s1;
          _c.copy(a).lerp(b, s);
          col.push(_c.r, _c.g, _c.b);
        }
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const n = new Float32Array(pos.length);
  for (let i = 0; i < n.length; i += 3) { n[i] = 0; n[i + 1] = 1; n[i + 2] = 0; }
  g.setAttribute('normal', new THREE.BufferAttribute(n, 3));
  return g;
}

export function leafGeometry() {
  // a small leaf lying in the xz-plane (length along z): pointed tip, rounded shoulders, raised midrib, stem
  const v = [
    0, 0.01, 0.09,        // 0 tip
    0.03, 0.002, 0.045,   // 1 right shoulder
    0.034, 0, -0.01,      // 2 right widest
    0.016, 0.002, -0.05,  // 3 right base
    0, 0.008, -0.06,      // 4 base
    -0.016, 0.002, -0.05, // 5
    -0.034, 0, -0.01,     // 6
    -0.03, 0.002, 0.045,  // 7
    0, 0.012, 0.0,        // 8 midrib
    0, 0.006, -0.085,     // 9 stem end
    0.003, 0.006, -0.06,  // 10 stem side
  ];
  const idx = [8, 0, 1, 8, 1, 2, 8, 2, 3, 8, 3, 4, 8, 4, 5, 8, 5, 6, 8, 6, 7, 8, 7, 0, 4, 10, 9];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function mushroomGeometries() {
  const stem = new THREE.CylinderGeometry(0.018, 0.026, 0.13, 8, 1);
  stem.translate(0, 0.065, 0);
  stem.deleteAttribute('uv');
  const cap = new THREE.SphereGeometry(0.06, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2);
  cap.scale(1, 0.62, 1);
  cap.translate(0, 0.118, 0);
  cap.deleteAttribute('uv');
  return { stem, cap };
}

// A broad leaf for the hanging sprays (length along z, no stem), folded along the midrib into a shallow V:
// seen from any side it keeps some width, so a swaying spray never shows sub-pixel edge-on slivers
// (those shimmered at the top edge of the picture).
function sprayLeafGeometry() {
  const L = 0.26, W = 0.075, F = 0.8; // length, half width, fold (rise per unit of width)
  const outline = [[0, 0.62], [0.55, 0.36], [0.82, 0.02], [0.62, -0.26], [0.28, -0.38]]; // half, tip -> base
  const v = [0, 0, 0.62 * L, 0, 0, -0.38 * L]; // 0 tip, 1 base (on the midrib)
  for (const side of [1, -1]) for (const [x, z] of outline.slice(1)) v.push(side * x * W, Math.abs(x) * W * F, z * L);
  // 2..5 right edge, 6..9 left edge
  const idx = [0, 2, 1, 2, 3, 1, 3, 4, 1, 4, 5, 1, 0, 1, 6, 6, 1, 7, 7, 1, 8, 8, 1, 9];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// A leafy branch hanging from above (attached at the origin, extending along +x and drooping down):
// fewer, broader leaves gathered in clumps, so it reads as a foliage mass rather than confetti.
function sprayGeometry(rand) {
  const bark = new THREE.Color(0x2e231c);
  const pts = [[0, 0.3, 0], [0.5, -0.25, 0.05], [1.2, -0.6, 0], [1.9, -1.0, -0.08], [2.5, -1.6, 0]];
  const parts = [loft(pts, { radii: [0.07, 0.05, 0.035, 0.022, 0.008], seg: 5, radial: 7, planar: false,
    color: () => bark })];
  const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p)));
  const green = [0x1f3326, 0x2b4430, 0x24392a].map((h) => new THREE.Color(h));
  const amber = new THREE.Color(0xb07630);
  const p = new THREE.Vector3(), q = new THREE.Quaternion(), e = new THREE.Euler(), m = new THREE.Matrix4(), sc = new THREE.Vector3();
  const clumps = [0.22, 0.38, 0.52, 0.66, 0.8, 0.94];
  for (let i = 0; i < 72; i++) {
    const u = clumps[i % clumps.length] + (rand() - 0.5) * 0.06;
    curve.getPoint(u, p);
    const r = 0.12 + 0.13 * u; // clumps grow toward the tip
    p.x += (rand() - 0.5) * 2 * r; p.y -= rand() * r * 1.2; p.z += (rand() - 0.5) * 2 * r;
    // roll about the midrib, droop the tip downward, then turn about the vertical
    e.set(0.7 + rand() * 0.9, rand() * Math.PI * 2, (rand() - 0.5) * 0.9, 'YXZ');
    m.compose(p, q.setFromEuler(e), sc.setScalar(0.85 + rand() * 0.35));
    const leaf = sprayLeafGeometry().applyMatrix4(m);
    const c = rand() < 0.22 ? amber : green[Math.floor(rand() * green.length)];
    const n = leaf.attributes.position.count, col = new Float32Array(n * 3);
    for (let k = 0; k < n; k++) { col[k * 3] = c.r; col[k * 3 + 1] = c.g; col[k * 3 + 2] = c.b; }
    leaf.setAttribute('color', new THREE.BufferAttribute(col, 3));
    parts.push(leaf);
  }
  return merge(parts);
}

/* ---------------------------------------------------------------- assembly */

// lane: { from: [x, z], through: [x, z] } — a sight line kept free of trunks (the night moon's window); its
// half width grows with the distance (from the view axis of every layout's camera)
export function createWoods({ atmos, quality, accent, lane = null }) {
  const low = quality === 'low';
  const rand = seededRandom('niflheimr-woods');
  const group = new THREE.Group();
  const disposables = [];
  const windTime = { value: 0 };
  const wind = (shader) => {
    shader.uniforms.uWindTime = windTime;
    shader.vertexShader = 'uniform float uWindTime;\n' + shader.vertexShader.replace('#include <begin_vertex>', /* glsl */`
      #include <begin_vertex>
      {
        vec2 ip = vec2( 0.0 );
        #ifdef USE_INSTANCING
        ip = instanceMatrix[ 3 ].xz;
        #endif
        float h = max( position.y, 0.0 );
        float w = sin( uWindTime * 0.8 + ip.x * 0.7 + ip.y * 0.45 ) * 0.75 + sin( uWindTime * 1.3 + ip.x * 1.9 ) * 0.2;
        transformed.x += w * h * 0.075;
        transformed.z += w * h * 0.04;
      }`);
  };
  // painted bark: wavy vertical streaks + a mossy, darker base (unit-trunk object space)
  const bark = (shader, { pass }) => {
    if (pass !== 'color') return;
    shader.vertexShader = 'varying vec3 vBarkP;\n' + shader.vertexShader
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBarkP = position;');
    shader.fragmentShader = 'varying vec3 vBarkP;\n' + shader.fragmentShader.replace('#include <color_fragment>', /* glsl */`
      #include <color_fragment>
      {
        float ang = atan( vBarkP.z, vBarkP.x );
        float wob = sin( vBarkP.y * 55.0 + ang * 2.0 ) * 0.35 + sin( vBarkP.y * 160.0 + ang * 5.0 ) * 0.12;
        float st = smoothstep( 0.35, 0.95, sin( ang * 11.0 + wob ) * 0.5 + 0.5 );
        diffuseColor.rgb *= 1.0 - 0.28 * st;
        float base = 1.0 - smoothstep( 0.0, 0.035, vBarkP.y );
        diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * vec3( 0.75, 0.95, 0.6 ), base * smoothstep( -0.2, 0.8, sin( ang + 1.0 ) ) );
      }`)
      // the gold rim only on near trunks (far ones would read as embossed paper flats)
      .replace('nprRimColor * nprRimStrength', 'nprRimColor * nprRimStrength * ( 1.0 - smoothstep( 8.0, 18.0, length( vViewPosition ) ) )');
  };
  const fog = atmos.fog();
  const barkFog = atmos.fog(bark, '-bark');
  const windFog = atmos.fog(wind, '-wind');

  /* ground */
  const noise = valueNoise2D(11);
  // gentle mounds, flat in the stag's clearing, rising in the far distance to hide the horizon
  const groundHeight = (x, z) => {
    const dStag = Math.hypot(x - 0.2, (z + 0.3) * 1.2);
    let h = (noise(x * 0.16, z * 0.16) - 0.5) * 0.7 + (noise(x * 0.6 + 3, z * 0.6) - 0.5) * 0.14;
    h *= smooth(1.2, 5, dStag);
    if (z < -35) h += (-35 - z) * 0.05;
    return h;
  };
  // warm pool of light under the stag, darker surroundings, the foreground falling into shade
  const poolCore = (x, z) => Math.exp(-((x - 0.2) ** 2 + (z + 0.3) ** 2) / 6);
  const pool = (x, z) => (0.28 + 0.9 * poolCore(x, z)) * (1 - 0.45 * smooth(2, 6, z));
  const groundGeo = new THREE.PlaneGeometry(170, 150, low ? 90 : 140, low ? 80 : 120);
  groundGeo.rotateX(-Math.PI / 2);
  groundGeo.translate(0, 0, -50);
  groundGeo.deleteAttribute('uv');
  {
    const p = groundGeo.attributes.position;
    const col = new Float32Array(p.count * 3);
    const earth = new THREE.Color(0x3a2a1c), moss = new THREE.Color(0x4a5230), rust = new THREE.Color(0x7a4a2c),
      litter = new THREE.Color(0x6b3d22), shadow = new THREE.Color(0x1e3436), lit = new THREE.Color(0xb08a5a);
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i);
      const dStag = Math.hypot(x - 0.2, (z + 0.3) * 1.2);
      p.setY(i, groundHeight(x, z));
      const m = noise(x * 0.3 + 20, z * 0.3);
      const r = noise(x * 0.9 + 40, z * 0.9);
      _c.copy(earth).lerp(moss, smooth(0.45, 0.7, m)).lerp(litter, smooth(0.4, 0.75, r) * 0.8);
      _c.lerp(rust, smooth(4, 0.8, dStag) * 0.55);
      // dark teal-shadowed soil / moss patches away from the clearing
      _c.lerp(shadow, smooth(0.58, 0.78, noise(x * 0.22 + 60, z * 0.22)) * smooth(2.5, 5, dStag) * 0.7);
      _c.multiplyScalar(pool(x, z)); // warm pool under the stag, darker surroundings
      // the floor behind the stag brightens toward the glowing ground mist (no seam against the haze)
      _c.lerp(lit, smooth(-1.5, -9, z) * (1 - smooth(-16, -32, z)) * Math.exp(-((x - 0.5) ** 2) / 50) * 0.75);
      col[i * 3] = _c.r; col[i * 3 + 1] = _c.g; col[i * 3 + 2] = _c.b;
    }
    groundGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    groundGeo.computeVertexNormals();
  }
  // antler-light pool: a smooth warm radial gradient round the stag's hooves (per fragment; the vertex grid
  // is too coarse for it); wider and stronger at night, when the antlers are the key light
  const poolU = { value: new THREE.Vector2(1, 5) }; // x = strength, y = spread (m^2)
  const groundPool = (shader, { pass }) => {
    if (pass !== 'color') return;
    shader.uniforms.uPool = poolU;
    shader.vertexShader = 'varying vec2 vGroundXZ;\n' + shader.vertexShader
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGroundXZ = position.xz;');
    shader.fragmentShader = 'varying vec2 vGroundXZ;\nuniform vec2 uPool;\n' + shader.fragmentShader.replace('#include <color_fragment>', /* glsl */`
      #include <color_fragment>
      {
        vec2 pd = ( vGroundXZ - vec2( 0.25, - 0.35 ) ) * vec2( 1.0, 1.35 );
        float pool = exp( - dot( pd, pd ) / uPool.y ) * uPool.x;
        diffuseColor.rgb *= 1.0 + pool * vec3( 0.55, 0.36, 0.14 );
      }`);
  };
  const groundMat = createToonMaterial({ color: 0xffffff, vertexColors: true, bands: 3, softness: 0.1, shadeLift: 0.4,
    ...atmos.fog(groundPool, '-ground') });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  group.add(ground);
  disposables.push(groundGeo, groundMat);

  /* trunks */
  const trunkGeo = trunkGeometry(low ? 10 : 14);
  const barkMat = createToonMaterial({ color: 0xffffff, bands: 3, softness: 0.08, shadeLift: 0.3,
    rimColor: 0xffd27a, rimStrength: 0.55, rimPower: 1.6, ...barkFog });
  disposables.push(trunkGeo, barkMat);
  const placed = [];
  const clear = (x, z, r) => {
    if (((x - 0.2) / 3.0) ** 2 + ((z + 0.4) / 3.2) ** 2 < 1) return false;          // stag clearing
    if (z > -1.2 && Math.abs(x) < 5.5) return false;                                  // keep the view open
    if (z > -6 && Math.abs(x + 0.3) < 1.2) return false;                              // right behind the antlers
    for (const t of placed) if (Math.hypot(t[0] - x, t[1] - z) < t[2] + r + 0.9 + Math.max(0, -z) * 0.03) return false;
    return true;
  };
  const scatter = (n, zMin, zMax, xSpan, rMin, rMax, saplings = 0) => {
    let tries = 0, k = 0;
    while (k < n && tries++ < n * 60) {
      const z = zMin + rand() * (zMax - zMin);
      const x = (rand() * 2 - 1) * (xSpan + Math.max(0, -z) * 0.55);
      const r = saplings && rand() < saplings ? 0.06 + rand() * 0.04 : rMin + rand() * (rMax - rMin);
      if (!clear(x, z, r)) continue;
      placed.push([x, z, r]);
      k++;
    }
  };
  scatter(low ? 16 : 26, -12, 3, 7, 0.16, 0.34);
  scatter(low ? 22 : 40, -28, -12, 9, 0.12, 0.55, 0.2); // widths 0.25..1.1 m: no even "pleats"
  scatter(low ? 26 : 50, -70, -28, 12, 0.14, 0.6, 0.2);
  const barkA = new THREE.Color(0x4a3a2f), barkB = new THREE.Color(0x5e4a3a), barkMoss = new THREE.Color(0x4a5236);
  // a mid trunk standing in the brightest ray gap just right of the antlers read as a dark "icicle" hanging
  // from the canopy: push such trunks back into the haze
  for (const t of placed) if (t[1] > -10 && t[1] < -7 && t[0] > 1.2 && t[0] < 3.2) { t[1] -= 4.5; t[0] += 0.3; }
  // clear the lane (after the scatter and drawing the same random numbers, so every other trunk, fern and
  // leaf stays where it was)
  const inLane = ([x, z, r]) => {
    if (!lane) return false;
    const [ax, az] = lane.from, dx = lane.through[0] - ax, dz = lane.through[1] - az, l = Math.hypot(dx, dz);
    const t = ((x - ax) * dx + (z - az) * dz) / l;
    return t > 8 && Math.abs((x - ax) * dz - (z - az) * dx) / l < r + 0.25 + 0.04 * t;
  };
  const standing = placed.filter((t) => !inLane(t));
  const trunks = new THREE.InstancedMesh(trunkGeo, barkMat, standing.length);
  let nTrunk = 0;
  placed.forEach((t) => {
    const [x, z, r] = t;
    const lean = (rand() - 0.5) * 0.12, ry = rand() * 6.28, rz = (rand() - 0.5) * 0.08, h = 34 + rand() * 6;
    _c.copy(barkA).lerp(barkB, rand()).lerp(barkMoss, rand() < 0.3 ? 0.5 : 0);
    if (inLane(t)) return;
    compose(trunks, nTrunk, x, groundHeight(x, z) - 0.15, z, lean, ry, rz, r, h, r);
    trunks.setColorAt(nTrunk++, _c);
  });
  group.add(trunks);

  /* framing foreground trunks (repositioned by the layout for each aspect ratio) */
  const frame = new THREE.InstancedMesh(trunkGeo, createToonMaterial({ color: 0xffffff, bands: 3, softness: 0.08,
    shadeLift: 0.22, rimColor: 0xffc766, rimStrength: 0.35, rimPower: 3.5, ...barkFog }), 4);
  disposables.push(frame.material);
  for (let i = 0; i < 4; i++) frame.setColorAt(i, _c.set(i % 2 ? 0x3e2f26 : 0x46362a));
  frame.frustumCulled = false;
  group.add(frame);
  let framing = [];
  function setFrame(list, ferns = [], hanging = []) {
    framing = list;
    sprays.count = hanging.length;
    hanging.forEach(([x, y, z, rot, sc], i) => compose(sprays, i, x, y, z, 0, rot, 0, sc));
    sprays.instanceMatrix.needsUpdate = true;
    nearFerns.count = ferns.length;
    ferns.forEach(([x, z, sc, rot], i) => compose(nearFerns, i, x, groundHeight(x, z) - 0.03, z, 0, rot, 0, sc));
    nearFerns.instanceMatrix.needsUpdate = true;
    frame.count = list.length;
    list.forEach(([x, z, r, rot], i) => compose(frame, i, x, groundHeight(x, z) - 0.2, z, 0, rot || 0, 0, r, 40, r));
    frame.instanceMatrix.needsUpdate = true;
  }

  /* ferns */
  const fernGeo = fernClumpGeometry(seededRandom('fern'));
  const fernMat = createToonMaterial({ color: 0xffffff, vertexColors: true, side: THREE.DoubleSide, bands: 3,
    softness: 0.12, shadeLift: 0.35, ...windFog });
  disposables.push(fernGeo, fernMat);
  const fernSpots = [];
  for (const [x, z, r] of placed) if (z > (low ? -10 : -16) && rand() < 0.7) fernSpots.push([x + (rand() - 0.5) * (r + 1.2), z + r + rand() * 0.8, 0.8 + rand() * 0.6]);
  for (let i = 0; i < (low ? 8 : 18); i++) {
    const x = (rand() * 2 - 1) * 7, z = -1 + rand() * 3.5;
    if (Math.hypot(x - 0.2, z + 0.3) < 2.2) continue;
    fernSpots.push([x, z, 0.8 + rand() * 0.45]);
  }
  const ferns = new THREE.InstancedMesh(fernGeo, fernMat, fernSpots.length);
  const fernTint = new THREE.Color(0xb89a5a);
  fernSpots.forEach(([x, z, s], i) => {
    compose(ferns, i, x, groundHeight(x, z) - 0.02, z, 0, rand() * 6.28, 0, s);
    ferns.setColorAt(i, _c.setRGB(1, 1, 1).lerp(fernTint, rand() * 0.7));
  });
  group.add(ferns);
  // foreground clumps framing the bottom corners (placed by setFrame)
  const nearFerns = new THREE.InstancedMesh(fernGeo, fernMat, 4);
  nearFerns.count = 0;
  nearFerns.frustumCulled = false;
  for (let i = 0; i < 4; i++) nearFerns.setColorAt(i, _c.setRGB(0.3, 0.36, 0.33)); // dark silhouettes behind the text
  group.add(nearFerns);

  /* hanging leafy branches framing the top edge (placed by setFrame; sway grows with the hang depth) */
  const hang = (shader) => {
    shader.uniforms.uWindTime = windTime;
    shader.vertexShader = 'uniform float uWindTime;\n' + shader.vertexShader.replace('#include <begin_vertex>', /* glsl */`
      #include <begin_vertex>
      {
        // the whole spray sways as one slow, soft pendulum (no per-leaf flutter: small leaves that jitter
        // against each other read as a shimmer)
        float k = max( 0.3 - position.y, 0.0 ) + position.x * 0.25;
        float w = sin( uWindTime * 0.42 + position.x * 0.35 ) * 0.7 + sin( uWindTime * 0.71 + 1.7 ) * 0.3;
        transformed.z += w * k * 0.035;
        transformed.x += w * k * 0.015;
      }`);
  };
  const sprayGeo = sprayGeometry(seededRandom('spray'));
  const sprayMat = createToonMaterial({ color: 0xffffff, vertexColors: true, side: THREE.DoubleSide, bands: 3,
    softness: 0.16, shadeLift: 0.3, rimColor: 0xffc766, rimStrength: 0.4, rimPower: 2.2, ...atmos.fog(hang, '-hang') });
  disposables.push(sprayGeo, sprayMat);
  const sprays = new THREE.InstancedMesh(sprayGeo, sprayMat, 4);
  sprays.count = 0;
  sprays.frustumCulled = false;
  for (let i = 0; i < 4; i++) sprays.setColorAt(i, _c.setScalar(i === 0 ? 1.15 : 0.75 + i * 0.08));
  group.add(sprays);

  /* grass tufts */
  const grassGeo = grassTuftGeometry(seededRandom('grass'), low);
  const grassMat = createToonMaterial({ color: 0xffffff, vertexColors: true, side: THREE.DoubleSide, bands: 2,
    softness: 0.2, shadeLift: 0.45, ...windFog });
  disposables.push(grassGeo, grassMat);
  const nGrass = low ? 50 : 120;
  const grass = new THREE.InstancedMesh(grassGeo, grassMat, nGrass);
  for (let i = 0; i < nGrass; i++) {
    let x, z;
    do { x = (rand() * 2 - 1) * 8; z = (low ? -6 : -12) + rand() * (low ? 11 : 17); } while (Math.hypot(x - 0.2, z + 0.3) < 1.1);
    compose(grass, i, x, groundHeight(x, z), z, 0, rand() * 6.28, 0, 0.8 + rand() * 0.9);
    grass.setColorAt(i, _c.setRGB(1, 1, 1).multiplyScalar(0.8 + rand() * 0.4));
  }
  group.add(grass);

  /* fallen leaves (no ink: too small) */
  const leafGeo = leafGeometry();
  const litterMat = createToonMaterial({ color: 0xffffff, bands: 2, softness: 0.2, shadeLift: 0.5, side: THREE.DoubleSide, ...fog });
  disposables.push(leafGeo, litterMat);
  const nLeaves = low ? 500 : 1400;
  const litter = new THREE.InstancedMesh(leafGeo, litterMat, nLeaves);
  const leafCols = [0x9a4a24, 0xb86a30, 0x7a3a1e, 0xa88a40, 0x5e3420, 0x6a2e1a].map((h) => new THREE.Color(h));
  const coolLeaf = new THREE.Color(0x2f3a34);
  const lr = seededRandom('litter');
  for (let i = 0; i < nLeaves; i++) {
    // drifts: low-frequency density (~0.3..1.5x) so the litter gathers in patches instead of an even carpet
    let x, z;
    do {
      const near = lr() < 0.45;
      x = near ? (lr() * 2 - 1) * 3.5 : (lr() * 2 - 1) * 10;
      z = near ? -3 + lr() * 6 : -16 + lr() * 22;
    } while (lr() * 1.5 > 0.3 + 1.2 * smooth(0.25, 0.75, noise(x * 0.35 + 80, z * 0.35)));
    compose(litter, i, x, groundHeight(x, z) + 0.01, z, (lr() - 0.5) * 0.4, lr() * 6.28, (lr() - 0.5) * 0.4, 0.6 + lr() * 0.7);
    const lit = (0.45 + lr() * 0.35) * pool(x, z) * (0.8 + 0.2 * poolCore(x, z));
    // leaves out of the antler light lean cool (teal shade) instead of staying rust
    _c.copy(leafCols[Math.floor(lr() * leafCols.length)]).lerp(coolLeaf, (1 - poolCore(x, z)) * 0.45);
    litter.setColorAt(i, _c.multiplyScalar(lit));
  }
  group.add(litter);

  /* glowing mushrooms */
  const { stem: stemGeo, cap: capGeo } = mushroomGeometries();
  const stemMat = createToonMaterial({ color: 0xb8a58a, bands: 2, shadeLift: 0.5, ...fog });
  const capMat = createToonMaterial({ color: 0xffc27a, emissive: accent.clone().lerp(new THREE.Color(0xffa040), 0.35),
    emissiveIntensity: 2.2, bands: 2, ...fog });
  capMat.userData.night = { emissiveScale: 1.6, emissive: 0xff9a4a }; // softly glowing lanterns of the forest floor
  disposables.push(stemGeo, capGeo, stemMat, capMat);
  const shrooms = [];
  for (const [cx, cz, n] of [[-2.1, 1.4, 5], [1.5, 1.3, 4], [2.9, -0.6, 3], [-4.6, -2.6, 4]]) {
    for (let i = 0; i < n; i++) shrooms.push([cx + (rand() - 0.5) * 0.6, cz + (rand() - 0.5) * 0.5, 0.45 + rand() * 0.6]);
  }
  const stems = new THREE.InstancedMesh(stemGeo, stemMat, shrooms.length);
  const caps = new THREE.InstancedMesh(capGeo, capMat, shrooms.length);
  const shroomLights = []; // [x, y, z, size] of every cap (fx adds a soft night glow round them)
  shrooms.forEach(([x, z, s], i) => {
    shroomLights.push([x, groundHeight(x, z) + 0.12 * s, z, s]);
    const tilt = (rand() - 0.5) * 0.4, yaw = rand() * 6.28;
    compose(stems, i, x, groundHeight(x, z) - 0.01, z, tilt, yaw, 0, s);
    compose(caps, i, x, groundHeight(x, z) - 0.01, z, tilt, yaw, 0, s);
  });
  group.add(stems, caps);

  /* mossy rocks */
  const rockGeo = lumpGeometry(2, 21, 0.4);
  {
    const n = rockGeo.attributes.normal, col = new Float32Array(n.count * 3);
    const stone = new THREE.Color(0x524c46), moss = new THREE.Color(0x3f5a2c);
    for (let i = 0; i < n.count; i++) {
      _c.copy(stone).lerp(moss, smooth(0.2, 0.7, n.getY(i)));
      col[i * 3] = _c.r; col[i * 3 + 1] = _c.g; col[i * 3 + 2] = _c.b;
    }
    rockGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  }
  const rockMat = createToonMaterial({ color: 0xffffff, vertexColors: true, bands: 3, shadeLift: 0.3,
    rimColor: 0xffd27a, rimStrength: 0.3, ...fog });
  disposables.push(rockGeo, rockMat);
  const rockSpots = [[2.6, 1.2, 0.32], [-3.4, -1.2, 0.45], [4.2, 3.2, 0.5], [-1.6, -4.5, 0.4], [5.5, -3.5, 0.6]];
  const rocks = new THREE.InstancedMesh(rockGeo, rockMat, rockSpots.length);
  rockSpots.forEach(([x, z, s], i) => compose(rocks, i, x, groundHeight(x, z) - s * 0.3, z, rand(), rand() * 6, rand() * 0.3, s * 1.3, s, s));
  group.add(rocks);

  markOutline(group);
  markOutline(litter, false);
  markOutline(grass, false);
  markOutline(ferns, false);
  markOutline(nearFerns, false);
  markOutline(sprays, false); // per-leaf ink is noise; the dark mass reads as a silhouette
  markOutline(caps, false);

  // Angular clearance (radians) of a view ray (from, unit dir) from every trunk nearer than maxDist: < 0 when
  // a trunk hides what lies beyond (the moon is placed where this is large).
  function clearance(from, dir, maxDist = 45) {
    const dl = Math.hypot(dir.x, dir.z) || 1e-6, ux = dir.x / dl, uz = dir.z / dl;
    let best = Infinity;
    const test = (x, z, r) => {
      const px = x - from.x, pz = z - from.z, t = px * ux + pz * uz;
      if (t <= 0.5 || t > maxDist) return;
      const y = from.y + t * dir.y / dl;
      best = Math.min(best, (Math.abs(px * uz - pz * ux) - r * (1 - 0.38 * Math.min(Math.max(y / 36, 0), 1))) / t);
    };
    for (const [x, z, r] of standing) test(x, z, r);
    for (const [x, z, r] of framing) test(x, z, r);
    return best;
  }

  function update(t) { windTime.value = t; }
  function setNight(k) { poolU.value.set(1 + 0.6 * k, 5 + 3 * k); }
  function dispose() { for (const d of disposables) d.dispose(); for (const m of [trunks, frame, ferns, nearFerns, sprays, grass, litter, stems, caps, rocks]) m.dispose(); }

  return { group, setFrame, groundHeight, shroomLights, clearance, update, setNight, dispose };
}
