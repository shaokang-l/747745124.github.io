// Light and particles for the forest hero: fireflies + dust motes, rising antler sparks, the golden
// halo behind the stag, big foreground bokeh discs, a few falling leaves and the stag's contact shadow.
// Everything animates on the GPU from a time uniform (deterministic for any t) except the leaves.
import * as THREE from 'three';
import { createToonMaterial, seededRandom } from './core.js';
import { leafGeometry } from './forest-woods.js';
import { additive } from './forest-geo.js';

const POINT_VERT_HEAD = /* glsl */`
uniform float uTime;
uniform float uScale;   // pixels per world unit at distance 1 (viewport height / (2 tan(fov / 2)))
attribute vec4 aSeed;
attribute vec4 aLook;   // rgb colour (HDR), w = size (world units)
varying vec3 vColor;
varying float vAlpha;
`;

const POINT_FRAG = /* glsl */`
varying vec3 vColor;
varying float vAlpha;
uniform float uCore;
void main() {
  float d = length( gl_PointCoord - 0.5 ) * 2.0;
  if ( d > 1.0 ) discard;
  float core = 1.0 - smoothstep( 0.0, uCore, d );
  float halo = exp( - d * d * 5.0 ) * 0.4;
  gl_FragColor = vec4( vColor * ( core + halo ) * vAlpha, 1.0 );
}
`;

function pointsMaterial(vertexBody, core = 0.4) {
  return additive(new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uScale: { value: 600 }, uCore: { value: core } },
    vertexShader: POINT_VERT_HEAD + vertexBody,
    fragmentShader: POINT_FRAG,
  }));
}

function pointsGeometry(n, fill) {
  const pos = new Float32Array(n * 3), seed = new Float32Array(n * 4), look = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) fill(i, pos, seed, look);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
  g.setAttribute('aLook', new THREE.BufferAttribute(look, 4));
  return g;
}

export function createFx({ accent, quality, stag, groundHeight, fog = () => ({}) }) {
  const low = quality === 'low';
  const rand = seededRandom('niflheimr-fx');
  const group = new THREE.Group();
  const materials = [], geometries = [];
  const gold = accent.clone();
  const cream = new THREE.Color(0xfff1c7);

  /* fireflies (bright, bloom) + dust motes (dim). Fireflies favour the darker flanks and foreground,
     where they sparkle; a dozen big near ones read as warm glowing orbs. */
  const nOrb = low ? 6 : 14, nFly = low ? 45 : 110, nDust = low ? 60 : 170;
  const flyGeo = pointsGeometry(nOrb + nFly + nDust, (i, pos, seed, look) => {
    const orb = i < nOrb, fly = i < nOrb + nFly;
    let x, y, z;
    if (orb) {
      const side = i % 2 ? 1 : -1;
      x = 0.3 + side * (1.6 + rand() * 2.6); y = 0.3 + rand() * 1.4; z = 0.8 + rand() * 2.8;
    } else if (fly) {
      do { x = (rand() * 2 - 1) * 7; z = -12 + rand() * 16; } while (Math.abs(x) < 2 && z < 1 && rand() < 0.7);
      y = 0.2 + Math.pow(rand(), 2.2) * 3.4;
    } else {
      x = (rand() * 2 - 1) * 5; z = -9 + rand() * 13; y = 0.2 + rand() * 5;
    }
    pos.set([x, y, z], i * 3);
    seed.set([rand(), rand(), rand(), rand()], i * 4);
    const c = orb ? gold.clone().lerp(cream, rand() * 0.4).multiplyScalar(1.8 + rand() * 0.8)
      : fly ? gold.clone().lerp(cream, rand() * 0.5).multiplyScalar(2.4 + rand() * 1.4)
        : cream.clone().lerp(gold, rand()).multiplyScalar(0.35 + rand() * 0.35);
    look.set([c.r, c.g, c.b, orb ? 0.09 + rand() * 0.05 : fly ? 0.05 + rand() * 0.035 : 0.018 + rand() * 0.014], i * 4);
  });
  const flyMat = pointsMaterial(/* glsl */`
    void main() {
      vec3 p = position;
      float t = uTime * ( 0.25 + aSeed.x * 0.25 );
      p.x += sin( t * 1.3 + aSeed.y * 6.28 ) * 0.5 + sin( t * 0.53 + aSeed.z * 9.0 ) * 0.35;
      p.y += sin( t * 0.9 + aSeed.z * 6.28 ) * 0.28;
      p.z += cos( t * 1.1 + aSeed.w * 6.28 ) * 0.45;
      vec4 mv = modelViewMatrix * vec4( p, 1.0 );
      float tw = 0.5 + 0.5 * sin( uTime * ( 0.9 + aSeed.y * 1.7 ) + aSeed.w * 30.0 );
      vAlpha = 0.25 + 0.75 * tw * tw;
      vColor = aLook.rgb;
      gl_PointSize = clamp( aLook.w * uScale / - mv.z, 1.5, 48.0 );
      gl_Position = projectionMatrix * mv;
    }`);
  const flies = new THREE.Points(flyGeo, flyMat);
  flies.frustumCulled = false;
  group.add(flies);
  materials.push(flyMat); geometries.push(flyGeo);

  /* sparks rising from the antler tips (live in the head frame, so they follow the head) */
  const tips = stag.tips;
  const nSpark = low ? 36 : 80;
  const sparkGeo = pointsGeometry(nSpark, (i, pos, seed, look) => {
    const tp = tips[Math.floor(rand() * tips.length)];
    pos.set([tp.x, tp.y, tp.z], i * 3);
    seed.set([rand(), rand(), rand(), rand()], i * 4);
    const c = gold.clone().lerp(cream, rand() * 0.6).multiplyScalar(2.2 + rand() * 1.5);
    look.set([c.r, c.g, c.b, 0.022 + rand() * 0.018], i * 4);
  });
  const sparkMat = pointsMaterial(/* glsl */`
    void main() {
      float life = 1.8 + aSeed.x * 2.2;
      float age = fract( uTime / life + aSeed.y );
      vec3 p = position;
      p.y += age * ( 0.35 + aSeed.w * 0.45 ) + age * age * 0.2;
      p.x += sin( age * 5.0 + aSeed.z * 20.0 ) * 0.07 * age - age * 0.08;
      p.z += cos( age * 4.0 + aSeed.z * 13.0 ) * 0.07 * age;
      vec4 mv = modelViewMatrix * vec4( p, 1.0 );
      vAlpha = smoothstep( 0.0, 0.08, age ) * ( 1.0 - age ) * ( 1.0 - age );
      vColor = aLook.rgb;
      gl_PointSize = clamp( aLook.w * ( 1.2 - age * 0.6 ) * uScale / - mv.z, 1.0, 24.0 );
      gl_Position = projectionMatrix * mv;
    }`, 0.5);
  const sparks = new THREE.Points(sparkGeo, sparkMat);
  sparks.frustumCulled = false;
  stag.headPivot.add(sparks);
  materials.push(sparkMat); geometries.push(sparkGeo);

  /* golden halo card behind the antlers (camera-facing, additive): breathes with the antler pulse, with a
     faint corona of broad, slowly turning lobes; fades out when the camera comes close (the flight) */
  const haloMat = additive(new THREE.ShaderMaterial({
    uniforms: { uColor: { value: gold.clone().lerp(cream, 0.2).multiplyScalar(0.55) }, uPulse: { value: 1 },
      uSize: { value: 1 }, uTime: { value: 0 } },
    vertexShader: /* glsl */`
      uniform float uSize;
      varying vec2 vUv;
      varying float vFade;
      void main() {
        vUv = uv * 2.0 - 1.0;
        vec4 mv = modelViewMatrix * vec4( 0.0, 0.0, 0.0, 1.0 );
        vFade = smoothstep( 1.2, 3.5, - mv.z );
        mv.xy += position.xy * uSize;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uColor; uniform float uPulse; uniform float uTime;
      varying vec2 vUv;
      varying float vFade;
      void main() {
        float r2 = dot( vUv, vUv );
        float ang = atan( vUv.y, vUv.x );
        float lobes = sin( ang * 6.0 + uTime * 0.09 ) * 0.55 + sin( ang * 4.0 - uTime * 0.06 + 2.0 ) * 0.45;
        float a = exp( - r2 * 4.5 ) * 0.8 * ( 1.0 + 0.22 * lobes * smoothstep( 0.03, 0.3, r2 ) ) + exp( - r2 * 18.0 ) * 0.5;
        gl_FragColor = vec4( uColor * a * uPulse * vFade, 1.0 );
      }`,
  }));
  const halo = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 3.4), haloMat);
  halo.frustumCulled = false;
  halo.renderOrder = 4;
  group.add(halo);
  materials.push(haloMat); geometries.push(halo.geometry);

  /* motes of light slowly swirling inside the glow behind the stag (world space, so the trunks pass in
     front of them with parallax); dim, soft and never sub-pixel, so they drift instead of twinkling */
  const nSwirl = low ? 36 : 80;
  const swirlGeo = pointsGeometry(nSwirl, (i, pos, seed, look) => {
    const r = 0.5 + Math.pow(rand(), 0.8) * 3.2;
    pos.set([r, (rand() - 0.5) * 2.6, rand() * Math.PI * 2], i * 3); // radius, height, start angle
    seed.set([rand(), rand(), rand(), rand()], i * 4);
    const c = cream.clone().lerp(gold, rand() * 0.6).multiplyScalar(1.0 + rand() * 0.8);
    look.set([c.r, c.g, c.b, 0.045 + rand() * 0.04], i * 4);
  });
  const swirlMat = pointsMaterial(/* glsl */`
    uniform vec3 uCentre;
    void main() {
      float r = position.x;
      // slower further out; a gentle breathing of the radius
      float a = position.z + uTime * ( 0.05 + 0.1 * aSeed.x ) * ( 1.6 / ( 0.6 + r * 0.5 ) );
      float rr = r * ( 1.0 + 0.06 * sin( uTime * 0.3 + aSeed.y * 6.28 ) );
      vec3 p = uCentre + vec3( cos( a ) * rr, position.y + sin( uTime * 0.2 + aSeed.z * 6.28 ) * 0.25 + sin( a * 2.0 ) * 0.2, sin( a ) * rr * 0.6 );
      vec4 mv = viewMatrix * vec4( p, 1.0 );
      float size = aLook.w * uScale / - mv.z;
      // fade in the bright core (no clumping), at the rim, and when too small to draw steadily
      vAlpha = smoothstep( 0.4, 1.2, rr ) * ( 1.0 - smoothstep( 2.6, 3.8, rr ) ) * smoothstep( 1.0, 2.5, size )
        * ( 0.55 + 0.45 * sin( uTime * ( 0.25 + aSeed.w * 0.3 ) + aSeed.x * 20.0 ) ) * smoothstep( 1.5, 4.0, - mv.z );
      vColor = aLook.rgb;
      gl_PointSize = clamp( size, 2.0, 28.0 );
      gl_Position = projectionMatrix * mv;
    }`, 0.3);
  swirlMat.uniforms.uCentre = { value: new THREE.Vector3(0, 2.5, -8) };
  const swirl = new THREE.Points(swirlGeo, swirlMat);
  swirl.frustumCulled = false;
  group.add(swirl);
  materials.push(swirlMat); geometries.push(swirlGeo);

  /* glowing ground mist behind the stag: soft, wide, camera-facing (around y) additive banks standing
     on the ground; transparent at the ground line and at the top, so they have no visible edges */
  const mistBanks = [[0.8, -4.5, 8, 1.1, 0.45], [-1.2, -8, 14, 1.7, 0.6], [2.4, -11.5, 16, 2.2, 0.6], [-0.5, -17, 24, 3, 0.55]];
  const mistPos = [], mistUv = [], mistK = [], mistIdx = [];
  mistBanks.forEach(([x, z, w, h, k], i) => {
    const y = groundHeight(x, z) - 0.15;
    for (const [u, v] of [[-1, 0], [1, 0], [-1, 1], [1, 1]]) {
      mistPos.push(x, y, z);
      mistUv.push(u * w * 0.5, v * h, u, v); // offset (m), across (-1..1), up (0..1)
      mistK.push(k);
    }
    mistIdx.push(i * 4, i * 4 + 1, i * 4 + 2, i * 4 + 1, i * 4 + 3, i * 4 + 2);
  });
  const mistGeo = new THREE.BufferGeometry();
  mistGeo.setAttribute('position', new THREE.Float32BufferAttribute(mistPos, 3));
  mistGeo.setAttribute('aMist', new THREE.Float32BufferAttribute(mistUv, 4));
  mistGeo.setAttribute('aK', new THREE.Float32BufferAttribute(mistK, 1));
  mistGeo.setIndex(mistIdx);
  const mistMat = additive(new THREE.ShaderMaterial({
    uniforms: { uColor: { value: gold.clone().lerp(new THREE.Color(0xffd89a), 0.6).multiplyScalar(1.0) }, uTime: { value: 0 } },
    vertexShader: /* glsl */`
      attribute vec4 aMist;
      attribute float aK;
      varying vec2 vM;
      varying float vK;
      uniform float uTime;
      void main() {
        vec3 toCam = cameraPosition - position;
        vec3 side = normalize( vec3( toCam.z, 0.0, - toCam.x ) );
        vec3 p = position + side * ( aMist.x + sin( uTime * 0.07 + position.z ) * 0.4 ) + vec3( 0.0, aMist.y, 0.0 );
        vM = aMist.zw;
        vK = aK;
        gl_Position = projectionMatrix * viewMatrix * vec4( p, 1.0 );
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uColor;
      varying vec2 vM;
      varying float vK;
      void main() {
        float across = exp( - vM.x * vM.x * 2.6 );
        float up = smoothstep( 0.0, 0.18, vM.y ) * pow( 1.0 - smoothstep( 0.12, 1.0, vM.y ), 1.6 );
        gl_FragColor = vec4( uColor * across * up * vK, 1.0 );
      }`,
    side: THREE.DoubleSide,
  }));
  const mist = new THREE.Mesh(mistGeo, mistMat);
  mist.frustumCulled = false;
  mist.renderOrder = 3;
  group.add(mist);
  materials.push(mistMat); geometries.push(mistGeo);

  /* a few large out-of-focus bokeh discs: defocused lights hanging just in front of the lens. Each is
     anchored in the scene a few metres from the camera (placed by setSize from its rest-pose screen spot),
     so the camera's sway slides it across the trunks (nearer, bigger discs move more) and the enter flight
     carries it past; its size stays that of a defocused disc (screen-space radius, growing only as the
     camera closes in). Warm gold ones by the light, a cool teal one in the shade, ring-shaped (brighter
     rim); kept inside the frame and clear of the post text, the header icons and the bottom-right corner
     where the blog's live2d mascot sits. Low quality uses the first 3. */
  // [ndc x, ndc y, radius (fraction of sqrt(w * h)), warm (1) / cool (0), parallax (ndc x per unit of sway)]
  const bokehSpots = [[0.74, -0.1, 0.045, 1, 0.15], [0.8, 0.36, 0.028, 1, 0.11], [0.47, -0.8, 0.024, 1, 0.1],
    [0.84, -0.44, 0.022, 0, 0.12]].slice(0, low ? 3 : 4);
  const warmBokeh = new THREE.Color(0xffc25a).multiplyScalar(0.17), coolBokeh = new THREE.Color(0x6fb3a8).multiplyScalar(0.12);
  const bokehData = [], bokehCol = [], bokehIdx = [];
  bokehSpots.forEach(([, , r, warm], i) => {
    const c = warm ? warmBokeh : coolBokeh;
    const seed = rand();
    for (const [u, v] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      bokehData.push(u, v, r, seed);
      bokehCol.push(c.r, c.g, c.b);
    }
    bokehIdx.push(i * 4, i * 4 + 1, i * 4 + 2, i * 4 + 1, i * 4 + 3, i * 4 + 2);
  });
  const bokehGeo = new THREE.BufferGeometry();
  const bokehPos = new THREE.Float32BufferAttribute(new Float32Array(bokehSpots.length * 12), 3); // anchors (world)
  const bokehDepth = new THREE.Float32BufferAttribute(new Float32Array(bokehSpots.length * 4), 1); // rest view depth
  bokehGeo.setAttribute('position', bokehPos);
  bokehGeo.setAttribute('aDepth', bokehDepth);
  bokehGeo.setAttribute('aDisc', new THREE.Float32BufferAttribute(bokehData, 4));
  bokehGeo.setAttribute('aTint', new THREE.Float32BufferAttribute(bokehCol, 3));
  bokehGeo.setIndex(bokehIdx);
  const bokehMat = additive(new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uRadius: { value: new THREE.Vector2(0.1, 0.1) }, uFade: { value: 1 } },
    vertexShader: /* glsl */`
      uniform float uTime;
      uniform float uFade;
      uniform vec2 uRadius; // ndc radius per unit of aDisc.z (x, y)
      attribute float aDepth;
      attribute vec4 aDisc;
      attribute vec3 aTint;
      varying vec2 vUv;
      varying vec3 vColor;
      void main() {
        vec4 view = modelViewMatrix * vec4( position, 1.0 );
        vUv = aDisc.xy;
        vColor = aTint * ( 0.75 + 0.25 * sin( uTime * 0.3 + aDisc.w * 6.28 ) ) * uFade;
        if ( - view.z < 0.2 ) { gl_Position = vec4( 0.0, 0.0, 2.0, 1.0 ); return; } // passed the lens
        vec4 clip = projectionMatrix * view;
        // defocus disc: constant on screen, growing as the camera closes in (the enter flight)
        vec2 r = uRadius * aDisc.z * min( aDepth / - view.z, 3.0 );
        vec2 c = clip.xy / clip.w + vec2( sin( uTime * 0.05 + aDisc.w * 6.28 ), cos( uTime * 0.04 + aDisc.w * 9.0 ) ) * 0.015;
        // safety net at the frame edge (released while the discs fade out, so they slide off in the flight)
        c = mix( c, clamp( c, - 1.0 + r * 1.05, 1.0 - r * 1.05 ), uFade );
        gl_Position = vec4( c + aDisc.xy * r, 0.0, 1.0 );
      }`,
    fragmentShader: /* glsl */`
      varying vec2 vUv;
      varying vec3 vColor;
      void main() {
        float d = length( vUv );
        float aa = fwidth( d ) * 1.5;
        // lens bokeh: an even, dimmer centre and a thin brighter rim with a crisp edge
        float ring = mix( 0.4, 1.15, smoothstep( 0.6, 0.9, d ) ) * ( 1.0 - smoothstep( 0.95 - aa, 0.97, d ) );
        gl_FragColor = vec4( vColor * ring, 1.0 );
      }`,
    depthTest: false,
  }));
  const bokeh = new THREE.Mesh(bokehGeo, bokehMat);
  bokeh.frustumCulled = false;
  bokeh.renderOrder = 20;
  group.add(bokeh);
  materials.push(bokehMat); geometries.push(bokehGeo);

  /* falling leaves (CPU-animated instances, no allocation per frame): small, rust / gold even in shade,
     falling on the stag's side of the picture, never over the post text */
  const nFall = low ? 4 : 8;
  const fallGeo = leafGeometry();
  const warmShade = (shader, { pass }) => {
    if (pass === 'color') shader.fragmentShader = shader.fragmentShader.replace('uCoolShade * dot', 'vec3( 0.6, 0.3, 0.13 ) * dot');
  };
  const fallMat = createToonMaterial({ color: 0xffffff, side: THREE.DoubleSide, bands: 2, shadeLift: 0.6,
    rimColor: 0xffd27a, rimStrength: 0.4, ...fog(warmShade, '-fall') });
  const falling = new THREE.InstancedMesh(fallGeo, fallMat, nFall);
  falling.frustumCulled = false;
  const fallCols = [0xb8662e, 0xd49a42, 0x9a4a26, 0xc8a450];
  const fall = [];
  for (let i = 0; i < nFall; i++) {
    const f = { x: -1.5 + rand() * 6, z: -4.5 + rand() * 3.3, period: 9 + rand() * 7, phase: rand(), sway: 0.4 + rand() * 0.6, spin: rand() * 6 };
    f.land = (7.5 - groundHeight(f.x + 1.1, f.z)) / 8; // cycle fraction at which it lands (approx.)
    fall.push(f);
    falling.setColorAt(i, new THREE.Color(fallCols[i % fallCols.length]));
  }
  group.add(falling);
  materials.push(fallMat); geometries.push(fallGeo);
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3();

  /* soft contact shadow under the stag */
  const shadowMat = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(0x0f2426) } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv * 2.0 - 1.0; gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 ); }',
    fragmentShader: 'uniform vec3 uColor; varying vec2 vUv; void main() { float a = exp( - dot( vUv, vUv ) * 3.0 ) * 0.6; gl_FragColor = vec4( uColor, a ); }',
    transparent: true, depthWrite: false,
  });
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 1.0), shadowMat);
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.set(-0.05, 0.02, 0);
  stag.root.add(shadow);
  materials.push(shadowMat); geometries.push(shadow.geometry);

  const _anchor = new THREE.Vector3(), _toCam = new THREE.Vector3();

  // breath: -1..1, in step with the antler pulse
  function update(t, camera, pixelScale, breath = 0) {
    flyMat.uniforms.uTime.value = t;
    swirlMat.uniforms.uTime.value = t;
    swirlMat.uniforms.uScale.value = pixelScale;
    haloMat.uniforms.uTime.value = t;
    mistMat.uniforms.uTime.value = t;
    sparkMat.uniforms.uTime.value = t;
    bokehMat.uniforms.uTime.value = t;
    flyMat.uniforms.uScale.value = pixelScale;
    sparkMat.uniforms.uScale.value = pixelScale;
    // halo sits a little behind the antlers (away from the camera)
    stag.glowAnchor.getWorldPosition(_anchor);
    halo.position.copy(_anchor).addScaledVector(_toCam.subVectors(camera.position, _anchor).normalize(), -0.6);
    haloMat.uniforms.uPulse.value = 0.95 + 0.15 * breath;
    haloMat.uniforms.uSize.value = 1 + 0.07 * breath;
    for (let i = 0; i < nFall; i++) {
      const f = fall[i];
      const age = ((t / f.period + f.phase) % 1 + 1) % 1;
      const a = Math.min(age, f.land); // after landing: lie still and flat, then fade out (shrink)
      const x = f.x + Math.sin(a * 9 + f.spin) * f.sway + a * 1.2;
      const z = f.z + Math.cos(a * 7 + f.spin) * f.sway * 0.5;
      const gy = groundHeight(x, z) + 0.01;
      const k = age < f.land ? 1 : 0;
      _e.set(Math.sin(a * 11 + f.spin) * 1.2 * k, a * 8 + f.spin, Math.cos(a * 13) * 0.9 * k);
      _q.setFromEuler(_e);
      _m.compose(_p.set(x, Math.max(7.5 - a * 8, gy), z), _q, _s.setScalar(0.85 * Math.min(1, (1 - age) * 18)));
      falling.setMatrixAt(i, _m);
    }
    falling.instanceMatrix.needsUpdate = true;
  }

  function dispose() {
    for (const m of materials) m.dispose();
    for (const g of geometries) g.dispose();
    falling.dispose();
  }

  const _ndc = new THREE.Vector3(), _fwd = new THREE.Vector3();

  // Viewport size in css px + the camera in its rest pose (lens shift applied). Bokeh radii scale with
  // sqrt(w * h), so phones get proportionally larger discs. Each disc is anchored at the depth where the
  // camera's sideways sway (sway m, turning to keep aiming at a point pivot m away) shifts it by its parallax
  // (ndc x per unit of sway): 1 / depth = parallax * tan(fov / 2) * aspect / sway + 1 / pivot.
  function setSize(w, h, camera, pivot = 7, sway = 0.35) {
    const s = Math.sqrt(w * h);
    bokehMat.uniforms.uRadius.value.set(2 * s / w, 2 * s / h);
    const k = Math.tan(camera.fov * Math.PI / 360) * (w / h) / sway;
    camera.getWorldDirection(_fwd);
    bokehSpots.forEach(([x, y, , , par], i) => {
      const depth = 1 / (par * k + 1 / pivot);
      _ndc.set(x, y, 0.5).unproject(camera).sub(camera.position).normalize();
      _p.copy(camera.position).addScaledVector(_ndc, depth / _ndc.dot(_fwd));
      for (let j = i * 4; j < i * 4 + 4; j++) { bokehPos.setXYZ(j, _p.x, _p.y, _p.z); bokehDepth.setX(j, depth); }
    });
    bokehPos.needsUpdate = true;
    bokehDepth.needsUpdate = true;
  }

  // Lens bokeh fades while the camera flies into the forest (1 = normal, 0 = gone).
  function setBokeh(k) { bokehMat.uniforms.uFade.value = k; bokeh.visible = k > 0; }

  // Centre of the swirling motes: a point inside the glow, behind the stag.
  function setGlowCentre(v) { swirlMat.uniforms.uCentre.value.copy(v); }

  return { group, update, setSize, setGlowCentre, setBokeh, dispose };
}
