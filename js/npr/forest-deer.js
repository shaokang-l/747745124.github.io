// The golden stag: a procedural red-deer stag (lofted body, jointed legs, recursive glowing antlers)
// with a group hierarchy for idle animation (torso breathing, neck -> head -> ears / antlers, tail).
// Local frame: +x = forward, +y = up, +z = the stag's left. Units ~ metres (withers ~1.42 m).
// Proportions of a mature red-deer stag: deep barrel chest (girth ~52 % of the withers height), a level
// back, a thick maned neck carried forward, muscular haunches and fairly short, strong legs.
import * as THREE from 'three';
import { createToonMaterial, markOutline } from './core.js';
import { loft, merge, paint } from './forest-geo.js';

const C = (hex) => new THREE.Color(hex);
const FUR = {
  back: C(0x5a3a26), side: C(0x8c5e3b), belly: C(0x8a6a4a), rump: C(0xd8bf95),
  mane: C(0x4b3122), neck: C(0x74492e), head: C(0x8a5d3c), muzzle: C(0xb89470), nose: C(0x1d1512),
  leg: C(0x6d4630), shin: C(0x4a3122), hoof: C(0x1e1511), ear: C(0x6a4a32), earIn: C(0xa88a6a),
};
const _c = new THREE.Color();
const mix3 = (a, b, t) => _c.copy(a).lerp(b, Math.min(Math.max(t, 0), 1));
const smooth = (e0, e1, x) => { const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1); return t * t * (3 - 2 * t); };

/* ---------------------------------------------------------------- body parts */

function torsoGeometry() {
  // x stations from rump to chest: [x, centreY, halfWidth, top, bottom] — round, high haunches, a level
  // back up to the withers, a deep barrel whose underline rises gently toward the flank, broad brisket.
  const S = [
    [-0.745, 1.12, 0.03, 0.03, 0.03],
    [-0.715, 1.12, 0.125, 0.13, 0.17],
    [-0.645, 1.11, 0.205, 0.225, 0.29],
    [-0.545, 1.1, 0.255, 0.275, 0.34],
    [-0.4, 1.08, 0.26, 0.285, 0.32],
    [-0.22, 1.06, 0.25, 0.3, 0.335],
    [-0.03, 1.05, 0.26, 0.31, 0.36],
    [0.16, 1.06, 0.27, 0.32, 0.38],
    [0.33, 1.1, 0.27, 0.32, 0.4],
    [0.47, 1.11, 0.24, 0.29, 0.38],
    [0.58, 1.09, 0.17, 0.21, 0.29],
    [0.64, 1.07, 0.06, 0.08, 0.12],
  ];
  return loft(S.map((s) => [s[0], s[1], 0]), {
    radii: S.map((s) => [s[2], s[3], s[4]]), seg: 7, radial: 36, pinch: 0.25,
    color: (u, s) => {
      mix3(FUR.side, FUR.back, smooth(0.35, 0.95, s)).lerp(FUR.belly, smooth(-0.7, -0.95, s) * smooth(0.85, 0.6, u));
      _c.lerp(FUR.mane, smooth(-0.1, -0.6, s) * smooth(0.72, 0.9, u) * 0.85); // dark brisket under the mane
      if (u < 0.17) _c.lerp(FUR.rump, smooth(0.17, 0.06, u) * smooth(-0.6, -0.15, s) * smooth(0.9, 0.55, s) * 0.9); // pale rump patch round the tail
      return _c;
    },
  });
}

// Pushes the vertices of a lofted tube outward (fur ruff). amount(u, s, j) -> metres (s = sin of the
// section angle: > 0 top, < 0 bottom; j = vertex index round the section); droop bends it downward.
function shag(geo, stations, radial, amount, droop) {
  const p = geo.attributes.position;
  const c = new THREE.Vector3(), v = new THREE.Vector3(), d = new THREE.Vector3();
  for (let i = 0; i < stations; i++) {
    c.set(0, 0, 0);
    for (let j = 0; j < radial; j++) c.x += p.getX(i * radial + j), c.y += p.getY(i * radial + j), c.z += p.getZ(i * radial + j);
    c.divideScalar(radial);
    const u = i / (stations - 1);
    for (let j = 0; j < radial; j++) {
      const k = i * radial + j;
      const a = amount(u, Math.sin((j / radial) * Math.PI * 2), j);
      if (a <= 0) continue;
      v.set(p.getX(k), p.getY(k), p.getZ(k));
      d.subVectors(v, c).normalize();
      v.addScaledVector(d, a * (1 - droop)).y -= a * droop;
      p.setXYZ(k, v.x, v.y, v.z);
    }
  }
  geo.computeVertexNormals();
  return geo;
}

function neckGeometry() {
  // Neck in its own pivot frame (origin buried in the chest); dorsal side = "top", throat = "bottom".
  // A short, thick rut neck carried forward at ~60 degrees, tapering hard from the shoulders to the poll.
  const P = [[-0.1, -0.1], [0.04, 0.1], [0.135, 0.255], [0.205, 0.385], [0.245, 0.45]];
  const R = [[0.25, 0.3, 0.34], [0.2, 0.24, 0.31], [0.14, 0.16, 0.23], [0.104, 0.108, 0.16], [0.09, 0.088, 0.115]];
  const seg = 10, radial = 28;
  const g = loft(P.map((p) => [p[0], p[1], 0]), {
    radii: R, seg, radial, capEnd: true,
    color: (u, s) => {
      mix3(FUR.neck, FUR.mane, smooth(0.1, -0.6, s) * smooth(0.95, 0.4, u));
      return _c.lerp(FUR.back, smooth(0.4, 0.95, s) * 0.6);
    },
  });
  // mane: one continuous shaggy ruff hanging from the throat, fullest just under the jaw (the rut
  // "beard"), plus a low crest on top; strands vary only round the section (no rings), so the fur reads as
  // one mass, not cracked plates
  const jit = (j) => 0.5 + 0.5 * Math.sin(j * 12.9898 + 4.1);
  return shag(g, (P.length - 1) * seg + 1, radial, (u, s, j) => {
    const mask = smooth(0.08, 0.3, u) * smooth(1.0, 0.86, u) * (0.75 + 0.45 * smooth(0.35, 0.75, u));
    if (s > 0.35) return mask * 0.025 * smooth(0.35, 0.9, s);
    if (s > -0.2) return 0;
    return mask * Math.pow((-s - 0.2) / 0.8, 1.0) * 0.17 * (0.86 + 0.28 * jit(j + 7));
  }, 0.6);
}

function headGeometry() {
  // Along the head axis: back of skull (x=0) -> nose (x~0.36); [x, centreY, halfWidth, top, bottom]
  // Broad forehead between the pedicles, deep jaw, a slightly convex (Roman) nose and a blunt muzzle.
  const S = [
    [-0.04, 0.0, 0.05, 0.045, 0.045],
    [0.018, 0.0, 0.1, 0.085, 0.085],
    [0.079, -0.008, 0.11, 0.088, 0.13],
    [0.141, -0.018, 0.088, 0.074, 0.118],
    [0.203, -0.026, 0.07, 0.064, 0.096],
    [0.262, -0.034, 0.062, 0.058, 0.082],
    [0.302, -0.038, 0.062, 0.055, 0.076],
    [0.334, -0.04, 0.058, 0.052, 0.07],
    [0.357, -0.042, 0.04, 0.036, 0.045],
  ];
  const head = loft(S.map((s) => [s[0], s[1], 0]), {
    radii: S.map((s) => [s[2], s[3], s[4]]), seg: 4, radial: 24, pinch: 0.15,
    color: (u, s, c) => {
      mix3(FUR.head, FUR.muzzle, smooth(0.6, 0.82, u) * 0.75 + smooth(-0.3, -0.9, s) * 0.35);
      // dark preorbital patch below and in front of the eye
      _c.lerp(FUR.mane, smooth(0.36, 0.46, u) * smooth(0.62, 0.52, u) * smooth(0.2, -0.1, s) * smooth(-0.6, -0.3, s) * smooth(0.4, 0.7, Math.abs(c)) * 0.7);
      return _c.lerp(FUR.nose, smooth(0.92, 0.98, u));
    },
  });
  const parts = [head];
  for (const side of [1, -1]) {
    const eye = new THREE.SphereGeometry(0.021, 10, 8);
    eye.scale(1.35, 0.95, 0.6);
    eye.rotateY(-0.5 * side);
    eye.translate(0.13, 0.004, 0.086 * side);
    parts.push(paint(eye, 0x120c0a));
  }
  const nose = new THREE.SphereGeometry(0.026, 10, 8);
  nose.scale(0.8, 1.05, 1.6);
  nose.translate(0.354, -0.028, 0);
  parts.push(paint(nose, 0x1a1210));
  for (const p of parts) { p.deleteAttribute('uv'); }
  return merge(parts);
}

function earGeometry() {
  // A flat, pointed leaf along +x (length ~0.21); the flat face looks along local ±y.
  const P = [[0, 0], [0.05, 0], [0.11, 0.004], [0.17, 0.006], [0.215, 0.004]];
  return loft(P.map((p) => [p[0], p[1], 0]), {
    radii: [[0.024, 0.012, 0.012], [0.042, 0.014, 0.012], [0.045, 0.012, 0.01], [0.03, 0.01, 0.008], [0.004, 0.004, 0.004]],
    seg: 4, radial: 14,
    color: (u, s) => mix3(FUR.ear, FUR.earIn, smooth(0.1, -0.6, s) * smooth(0.05, 0.3, u) * 0.85),
  });
}

function tailGeometry() {
  // short, drooping; a dark stripe on top over a pale underside that merges with the rump patch
  const P = [[0.05, 0.02], [-0.02, -0.01], [-0.06, -0.07], [-0.075, -0.14]];
  return loft(P.map((p) => [p[0], p[1], 0]), {
    radii: [[0.05, 0.045, 0.05], [0.055, 0.045, 0.055], [0.042, 0.035, 0.045], [0.014, 0.012, 0.014]],
    seg: 4, radial: 12,
    color: (u, s) => mix3(FUR.rump, FUR.back, smooth(0.3, 0.9, s) * 0.9),
  });
}

function legsGeometry() {
  // [x, y, radius] keys. The first key starts inside the torso (shoulder / hip mass, coloured like the
  // flank so the seam disappears). front = shoulder, arm, elbow, forearm, carpus ("knee"), cannon,
  // fetlock, pastern, hoof
  const front = [
    [0.42, 1.1, 0.175], [0.37, 0.88, 0.14], [0.335, 0.74, 0.1], [0.35, 0.58, 0.075], [0.362, 0.42, 0.053],
    [0.368, 0.27, 0.035], [0.372, 0.12, 0.039], [0.395, 0.055, 0.029], [0.42, 0.018, 0.033],
  ];
  // hind = hip, thigh, stifle, gaskin, hock (points backwards), cannon, fetlock, pastern, hoof
  const hind = [
    [-0.45, 1.12, 0.17], [-0.39, 0.92, 0.17], [-0.335, 0.76, 0.125], [-0.42, 0.6, 0.09], [-0.53, 0.45, 0.058],
    [-0.515, 0.28, 0.036], [-0.495, 0.12, 0.039], [-0.47, 0.055, 0.029], [-0.445, 0.018, 0.033],
  ];
  const legs = [];
  // z narrows toward the top so the upper leg stays inside the body silhouette
  const build = (keys, dx, z) => loft(keys.map((k) => [k[0] + dx * (k[1] < 0.8 ? 1 : 0.4), k[1], z * (k[1] > 0.95 ? 0.55 : k[1] > 0.8 ? 0.85 : 1)]), {
    radii: keys.map((k) => k[2]), seg: 5, radial: 16, curveType: 'centripetal',
    color: (u) => {
      mix3(FUR.side, FUR.leg, smooth(0.14, 0.32, u)).lerp(FUR.shin, smooth(0.38, 0.7, u));
      return _c.lerp(FUR.hoof, smooth(0.9, 0.93, u));
    },
  });
  legs.push(build(front, 0.06, 0.14));   // near-left front, stepping forward
  legs.push(build(front, -0.02, -0.14));
  legs.push(build(hind, -0.02, 0.15));
  legs.push(build(hind, 0.05, -0.15));
  return merge(legs);
}

/* ---------------------------------------------------------------- antlers */

// A tine: marches from `start` along `dir`, bending toward `bendTo`; returns a lofted, pointed tube.
function tine(start, dir, bendTo, len, r0, glow0, out, tips, steps = 5) {
  const pts = [start.clone()];
  const d = dir.clone().normalize();
  const p = start.clone();
  for (let i = 1; i <= steps; i++) {
    d.lerp(bendTo, 0.28).normalize();
    p.addScaledVector(d, len / steps);
    pts.push(p.clone());
  }
  tips.push(p.clone());
  out.push(loft(pts.map((v) => [v.x, v.y, v.z]), {
    radii: pts.map(() => r0), seg: 4, radial: 7, planar: false, capStart: false,
    radiusAt: (u) => Math.pow(1 - u, 0.85) * 0.9 + 0.02,
    attrs: [{ name: 'aGlow', fn: (u) => glow0 + (1 - glow0) * u }],
  }));
}

function antlerSideGeometry(side, tips) {
  const V = (x, y, z) => new THREE.Vector3(x, y, z * side);
  // Main beam: out and back from the pedicle, then up, the crown curving forward / in.
  const beam = [V(0.05, 0.07, 0.045), V(-0.01, 0.18, 0.135), V(-0.09, 0.33, 0.26), V(-0.145, 0.5, 0.35),
    V(-0.145, 0.66, 0.39), V(-0.095, 0.8, 0.37), V(-0.035, 0.9, 0.31), V(0.03, 0.97, 0.25)];
  const curve = new THREE.CatmullRomCurve3(beam, false, 'centripetal');
  const beamR = (u) => 0.036 * (1 - u) + 0.011 * u;
  const out = [];
  out.push(loft(beam.map((v) => [v.x, v.y, v.z]), {
    radii: beam.map((_, i) => beamR(i / (beam.length - 1))), seg: 6, radial: 9, planar: false, curveType: 'centripetal',
    radiusAt: (u) => (u > 0.9 ? Math.max(0.05, (1 - u) / 0.1) : 1),
    attrs: [{ name: 'aGlow', fn: (u) => 0.28 + 0.72 * u }],
  }));
  tips.push(beam[beam.length - 1].clone());
  // coronet (burr) at the base
  out.push(loft([[0.05, 0.065, 0.04 * side], [0.052, 0.09, 0.052 * side]], {
    radii: [0.052, 0.044], seg: 2, radial: 10, planar: false, attrs: [{ name: 'aGlow', fn: () => 0.1 }],
  }));
  // Red-deer tines: brow, bez and trez pointing forward, then a cup-shaped crown.
  // [u on beam, direction, length, bend target]
  const T = [
    [0.05, V(1, 0.3, 0.2), 0.34, V(0.75, 1, 0.1)],    // brow tine
    [0.14, V(1, 0.42, 0.12), 0.27, V(0.65, 1, 0.05)], // bez tine
    [0.43, V(1, 0.45, -0.12), 0.25, V(0.45, 1, -0.05)], // trez tine (forward and in)
    [0.76, V(0.7, 1, 0.45), 0.2, V(0.2, 1, 0.25)],    // crown cup
    [0.83, V(-0.7, 1, 0.3), 0.18, V(-0.2, 1, 0.1)],
    [0.9, V(0.3, 1, -0.5), 0.15, V(0.05, 1, -0.2)],
  ];
  const p = new THREE.Vector3();
  for (const [u, dir, len, bend] of T) {
    curve.getPoint(u, p);
    tine(p, dir, bend.normalize(), len, beamR(u) * 0.8, 0.28 + 0.72 * u, out, tips);
  }
  // small forks on the trez and crown tines (the "golden" fantasy touch)
  const forks = [[2, 0.55, V(1, 0.4, -0.3)], [3, 0.5, V(0.3, 0.5, 1)], [4, 0.55, V(-0.3, 0.6, 1)]];
  for (const [k, at, dir] of forks) {
    const [u, d0, len] = T[k];
    curve.getPoint(u, p);
    const q = p.clone().addScaledVector(d0.clone().normalize(), len * at);
    tine(q, dir, V(0.2, 1, 0.2).normalize(), len * 0.45, beamR(u) * 0.45, 0.8, out, tips, 3);
  }
  return merge(out);
}

/* ---------------------------------------------------------------- assembly */

// fog(extra, key): the forest's material hook (haze + cool shade); by default only the stag's own patches.
const noFog = (extra, key = '') => ({ extend: extra, cacheKey: 'stag' + key });

export function createStag({ accent = new THREE.Color(0xf5c46a), fog = noFog } = {}) {
  const disposables = [];
  // painted fur: soft, elongated brush streaks (object space) that break up the smooth toon surfaces;
  // the gold rim only on upward-facing fur (back, crest, rump), shadows lean warm violet (not teal)
  const furStrokes = (shader, { pass }) => {
    if (pass !== 'color') return;
    shader.vertexShader = 'varying vec3 vFurP;\n' + shader.vertexShader
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFurP = position;');
    shader.fragmentShader = 'varying vec3 vFurP;\n' + shader.fragmentShader.replace('#include <color_fragment>', /* glsl */`
      #include <color_fragment>
      {
        vec3 q = vFurP * vec3( 9.0, 34.0, 34.0 );
        vec3 i = floor( q ), f = fract( q );
        f = f * f * ( 3.0 - 2.0 * f );
        float h000 = fract( sin( dot( i, vec3( 127.1, 311.7, 74.7 ) ) ) * 43758.5453 );
        float h100 = fract( sin( dot( i + vec3( 1, 0, 0 ), vec3( 127.1, 311.7, 74.7 ) ) ) * 43758.5453 );
        float h010 = fract( sin( dot( i + vec3( 0, 1, 0 ), vec3( 127.1, 311.7, 74.7 ) ) ) * 43758.5453 );
        float h110 = fract( sin( dot( i + vec3( 1, 1, 0 ), vec3( 127.1, 311.7, 74.7 ) ) ) * 43758.5453 );
        float h001 = fract( sin( dot( i + vec3( 0, 0, 1 ), vec3( 127.1, 311.7, 74.7 ) ) ) * 43758.5453 );
        float h101 = fract( sin( dot( i + vec3( 1, 0, 1 ), vec3( 127.1, 311.7, 74.7 ) ) ) * 43758.5453 );
        float h011 = fract( sin( dot( i + vec3( 0, 1, 1 ), vec3( 127.1, 311.7, 74.7 ) ) ) * 43758.5453 );
        float h111 = fract( sin( dot( i + vec3( 1, 1, 1 ), vec3( 127.1, 311.7, 74.7 ) ) ) * 43758.5453 );
        float n = mix( mix( mix( h000, h100, f.x ), mix( h010, h110, f.x ), f.y ), mix( mix( h001, h101, f.x ), mix( h011, h111, f.x ), f.y ), f.z );
        diffuseColor.rgb *= 0.9 + 0.2 * n;
      }`)
      .replace('nprRimColor * nprRimStrength', 'nprRimColor * nprRimStrength * smoothstep( 0.0, 0.4, geometryNormal.y )')
      .replace('uCoolShade * dot', 'vec3( 0.3, 0.13, 0.2 ) * dot');
  };
  const furMat = createToonMaterial({
    color: 0xffffff, vertexColors: true, bands: 3, softness: 0.1, shadeLift: 0.35,
    rimColor: 0xffd27a, rimStrength: 0.6, rimPower: 3.5, ...fog(furStrokes, '-fur2'),
  });
  // Antler emissive grows from the base to the tips (aGlow attribute); the burr and the lowest part of
  // the beam stay solid gold, so the skull and ears are not flooded by the bloom.
  const antlerGlow = (shader, { pass }) => {
    if (pass !== 'color') return;
    shader.vertexShader = 'attribute float aGlow;\nvarying float vGlow;\n' + shader.vertexShader
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = aGlow;');
    shader.fragmentShader = 'varying float vGlow;\n' + shader.fragmentShader
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance *= ( 0.25 + 0.95 * vGlow * vGlow ) * smoothstep( 0.1, 0.3, vGlow );');
  };
  const gold = accent.clone();
  const antlerMat = createToonMaterial({
    color: gold.clone().lerp(C(0xfff1c7), 0.15), emissive: gold.clone().lerp(C(0xffa033), 0.45),
    emissiveIntensity: 3.2, bands: 2, rimColor: 0xfff1c7, rimStrength: 0.6,
    ...fog(antlerGlow, '-antler2'),
  });
  disposables.push(furMat, antlerMat);

  const root = new THREE.Group();
  root.name = 'stag';

  const torso = new THREE.Mesh(torsoGeometry(), furMat);
  const legs = new THREE.Mesh(legsGeometry(), furMat);
  root.add(torso, legs);

  const neckPivot = new THREE.Group();
  neckPivot.position.set(0.44, 1.14, 0);
  root.add(neckPivot);
  const neck = new THREE.Mesh(neckGeometry(), furMat);
  neckPivot.add(neck);

  const headPivot = new THREE.Group();          // at the poll; level frame (antlers stay upright)
  headPivot.position.set(0.255, 0.475, 0);
  neckPivot.add(headPivot);
  const head = new THREE.Mesh(headGeometry(), furMat);
  head.position.set(-0.03, 0.0, 0);
  head.rotation.z = -0.8;                        // nose down ~46 degrees
  head.scale.setScalar(1.2);
  headPivot.add(head);

  const earGeo = earGeometry();
  const ears = [];
  for (const side of [1, -1]) {
    const pivot = new THREE.Group();
    pivot.position.set(-0.1, -0.03, 0.085 * side);     // well behind and below the burr
    const ear = new THREE.Mesh(earGeo, furMat);
    ear.scale.setScalar(0.8);
    // splayed out sideways (~35 degrees above level) and a little back, flat (inner) face opening forward
    const d = new THREE.Vector3(-0.4, 0.5, 0.78 * side).normalize();
    const n = new THREE.Vector3(1, 0.1, 0).addScaledVector(d, -d.x).normalize();
    ear.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(d, n.clone().negate(), new THREE.Vector3().crossVectors(d, n.clone().negate())));
    pivot.add(ear);
    headPivot.add(pivot);
    ears.push(pivot);
  }

  const tips = [];
  const antlerGeo = merge([antlerSideGeometry(1, tips), antlerSideGeometry(-1, tips)]);
  const antlers = new THREE.Mesh(antlerGeo, antlerMat);
  headPivot.add(antlers);

  const tailPivot = new THREE.Group();
  tailPivot.position.set(-0.715, 1.16, 0);
  const tail = new THREE.Mesh(tailGeometry(), furMat);
  tailPivot.add(tail);
  root.add(tailPivot);

  markOutline(root);
  markOutline(antlers, false); // glowing antlers: no ink frame around the light

  const geos = [torso.geometry, legs.geometry, neck.geometry, head.geometry, earGeo, antlerGeo, tail.geometry];
  disposables.push(...geos);

  // Antler glow anchors in headPivot space: the halo centre, and the crown for the point light (high
  // enough that the ears / skull do not blow out in its near field).
  const glowAnchor = new THREE.Object3D();
  glowAnchor.position.set(-0.05, 0.62, 0);
  const lightAnchor = new THREE.Object3D();
  lightAnchor.position.set(-0.05, 0.95, 0);
  headPivot.add(glowAnchor, lightAnchor);

  const pulse = (t, period, dur, offset) => {
    const ph = ((t + offset) % period + period) % period;
    return ph < dur ? Math.sin((ph / dur) * Math.PI) : 0;
  };

  // Resting gaze: yaw (radians, + = toward the stag's right) shared by neck and head, so the crown
  // faces the viewer as in a portrait; the idle look swings around it.
  let gaze = 0;
  function setGaze(yaw) { gaze = yaw; }

  function update(t) {
    const breath = Math.sin(t * 1.55);
    torso.scale.set(1, 1 + breath * 0.012, 1 + breath * 0.018);
    // slow, calm head turns (sum of incommensurate sines) + tiny nods
    const look = Math.sin(t * 0.13) * 0.6 + Math.sin(t * 0.29 + 1.3) * 0.4;
    neckPivot.rotation.set(0, gaze * 0.55 + look * 0.085, Math.sin(t * 0.21 + 0.4) * 0.025 + breath * 0.006, 'YXZ');
    headPivot.rotation.set(Math.sin(t * 0.37) * 0.04, gaze * 0.45 + look * 0.065, Math.sin(t * 0.25 + 2) * 0.035, 'YXZ');
    ears[0].rotation.x = pulse(t, 5.3, 0.32, 0) * 0.5;
    ears[1].rotation.x = -pulse(t, 7.9, 0.3, 2.2) * 0.5;
    ears[0].rotation.y = Math.sin(t * 0.7) * 0.06;
    ears[1].rotation.y = Math.sin(t * 0.63 + 1) * 0.06;
    tailPivot.rotation.z = pulse(t, 6.7, 0.5, 1.5) * 0.7 + Math.sin(t * 0.9) * 0.03;
  }

  function dispose() { for (const d of disposables) d.dispose(); }

  return { root, headPivot, antlerMat, glowAnchor, lightAnchor, tips, setGaze, update, dispose };
}
