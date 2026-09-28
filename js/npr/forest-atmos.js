// Atmosphere for the forest hero: one "haze" colour function shared by the sky dome and by the
// distance/ground-mist fog of every toon material (so the farthest trunks dissolve exactly into the sky,
// while nearer layers fog to a dimmer haze and keep dark silhouettes against the glow), a shared cool
// hue-shift of every material's shadow side, plus additive god-ray shafts.
import * as THREE from 'three';
import { seededRandom } from './core.js';
import { additive } from './forest-geo.js';

const HAZE_GLSL = /* glsl */`
uniform vec3 uHzZenith;
uniform vec3 uHzHorizon;
uniform vec3 uHzGround;
uniform vec3 uHzGlow;
uniform vec3 uHzWarm;
uniform vec3 uHzGlowDir;
uniform float uHzWide;
uniform float uHzCore;
uniform vec4 uHzLive;   // breathing: x = intensity, y = size, zw = drift of the centre (radians)
uniform vec2 uHzEnter;  // "enter the forest" flight: x = glow boost, y = flood of every surface into light
uniform float uHzTime;
// Colour of the misty air seen along world direction d: teal-green gradient with a golden glow
// (k scales the glow: 1 for the sky, less for the air in front of nearer objects).
vec3 forestHaze( vec3 d, float k ) {
  vec3 c = mix( uHzHorizon, uHzZenith, smoothstep( 0.0, 0.8, d.y ) );
  c = mix( c, uHzGround, 1.0 - smoothstep( -0.3, 0.02, d.y ) );
  // glow: slightly taller than wide (light pouring down through the canopy); it breathes (intensity and
  // size, in step with the antler pulse) and drifts a little
  vec3 g = uHzGlowDir;
  vec2 off = vec2( atan( d.x, - d.z ) - atan( g.x, - g.z ), ( d.y - g.y ) * 0.62 ) - uHzLive.zw;
  float r2 = dot( off, off ) / ( uHzLive.y * uHzLive.y * ( 1.0 + uHzEnter.x * 5.0 ) );
  // a soft corona of broad, slowly turning lobes round the centre (low frequency: no shimmer)
  float ang = atan( off.y, off.x );
  float lobes = sin( ang * 5.0 + uHzTime * 0.07 ) * 0.6 + sin( ang * 3.0 - uHzTime * 0.045 + 1.3 ) * 0.4;
  float wide = exp( - r2 * uHzWide ) * ( 1.0 + 0.16 * lobes * smoothstep( 0.002, 0.03, r2 ) );
  float I = uHzLive.x * ( 1.0 + uHzEnter.x * 2.5 );
  c = mix( c, uHzWarm, exp( - r2 * uHzWide * 0.35 ) * 0.75 );
  c = mix( c, uHzGlow * 0.42, min( wide * 0.8 * k * I, 1.0 ) );
  c += uHzGlow * exp( - r2 * uHzCore ) * 0.45 * k * I;
  // stays under the bloom threshold (only emissives bloom), except while flying into the light
  return min( c, vec3( 0.95 + uHzEnter.x * 2.5 ) );
}
`;

const FOG_GLSL = /* glsl */`
uniform float uFogNear;
uniform float uFogDensity;
uniform float uMistHeight;
uniform float uMistAmount;
uniform float uHzObjGlow;
uniform float uHzConeFloor;
uniform vec3 uCoolShade;
uniform float uCoolAmount;
`;

// Shadow sides lean cool (teal / violet) while the lit side keeps its warm albedo.
const COOL_SHADE = /* glsl */`
material.shadeColor = mix( material.shadeColor, uCoolShade * dot( material.diffuseColor, vec3( 0.3, 0.59, 0.11 ) ), uCoolAmount );
#include <lights_fragment_begin>
`;

const FOG_APPLY = /* glsl */`
{
  vec3 fv = - vViewPosition;
  float fd = length( fv );
  vec3 fw = normalize( ( vec4( fv, 0.0 ) * viewMatrix ).xyz );
  float fy = cameraPosition.y + fw.y * fd;
  float ff = 1.0 - exp( - max( fd - uFogNear, 0.0 ) * uFogDensity );
  float fm = uMistAmount * exp( - max( fy, 0.0 ) / uMistHeight ) * ( 1.0 - exp( - fd * 0.07 ) );
  // every layer closer than ~45 m keeps a silhouette; beyond that it dissolves into the sky
  float far = smoothstep( 40.0, 80.0, fd );
  // ground mist a few metres away glows like the sky behind it (no dark seam where the floor meets the haze)
  float glowK = max( far, smoothstep( 0.05, 0.25, fm ) * smoothstep( 5.0, 16.0, fd ) * 0.8 );
  ff = min( ff + fm * ( 1.0 - ff ), mix( 0.8, 1.0, far ) );
  // inside the bright haze cone behind the stag, mid-distance layers never stay near-black: a fog floor that
  // is uniform along a trunk's height (no dark "icicle" tops above ray-lit lower halves)
  {
    vec3 gd = uHzGlowDir;
    float gAz = atan( fw.x, - fw.z ) - atan( gd.x, - gd.z );
    float cone = exp( - gAz * gAz * uHzWide * 0.5 );
    ff = max( ff, uHzConeFloor * cone * smoothstep( 9.0, 14.0, fd ) );
  }
  ff = mix( ff, 1.0, uHzEnter.y * smoothstep( 0.3, 2.5, fd ) );
  if ( ff > 0.004 ) gl_FragColor.rgb = mix( gl_FragColor.rgb, forestHaze( fw, mix( uHzObjGlow, 1.0, glowK ) ), ff );
}
`;

export function createAtmosphere({ accent, quality }) {
  const gold = accent.clone();
  const U = {
    uHzZenith: { value: new THREE.Color(0x0b1a1f) },
    uHzHorizon: { value: new THREE.Color(0x1f3a3a) },
    uHzGround: { value: new THREE.Color(0x132624) },
    uHzGlow: { value: gold.clone().lerp(new THREE.Color(0xfff1c7), 0.2).multiplyScalar(0.85) },
    uHzWarm: { value: new THREE.Color(0x4a3320) },
    uHzGlowDir: { value: new THREE.Vector3(0, 0.2, -1).normalize() },
    uHzWide: { value: 9 },
    uHzCore: { value: 45 },
    uHzLive: { value: new THREE.Vector4(1, 1, 0, 0) },
    uHzEnter: { value: new THREE.Vector2(0, 0) },
    uHzTime: { value: 0 },
    uFogNear: { value: 8 },
    uFogDensity: { value: 0.028 },
    uMistHeight: { value: 1.3 },
    uMistAmount: { value: 0.6 },
    uHzObjGlow: { value: 0.45 },
    uHzConeFloor: { value: 0.32 },
    uCoolShade: { value: new THREE.Color(0x3f6a80) },
    uCoolAmount: { value: 0.6 },
  };

  // `extend` for createToonMaterial: haze fog + cool shadows in the colour pass (+ optional extra patch).
  function fog(extra = null, key = '') {
    return {
      extend(shader, ctx) {
        if (ctx.pass === 'color') {
          Object.assign(shader.uniforms, U);
          shader.fragmentShader = HAZE_GLSL + FOG_GLSL + shader.fragmentShader
            .replace('#include <lights_fragment_begin>', COOL_SHADE)
            .replace('#include <fog_fragment>', FOG_APPLY);
        }
        if (extra) extra(shader, ctx);
      },
      cacheKey: 'forest-haze-4' + key,
    };
  }

  /* sky dome: follows the camera; drawn after the opaque scene at depth 1, so it only shades the gaps */
  const skyMat = new THREE.ShaderMaterial({
    uniforms: U,
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main() {
        vDir = normalize( position );
        vec4 p = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
        gl_Position = p.xyww;
      }`,
    fragmentShader: HAZE_GLSL + /* glsl */`
      varying vec3 vDir;
      float h1( float n ) { return fract( sin( n ) * 43758.5453 ); }
      float vnoise( float x ) { float i = floor( x ), f = fract( x ); f = f * f * ( 3.0 - 2.0 * f ); return mix( h1( i ), h1( i + 1.0 ), f ); }
      void main() {
        vec3 d = normalize( vDir );
        vec3 c = forestHaze( d, 1.0 );
        // a painted band of very distant trunks: vertical stripes by azimuth, fading upward
        float az = atan( d.x, - d.z );
        float s = smoothstep( 0.55, 0.8, vnoise( az * 60.0 ) ) * 0.55 + smoothstep( 0.6, 0.85, vnoise( az * 23.0 + 7.0 ) ) * 0.45;
        float band = ( 1.0 - smoothstep( 0.05, 0.75, d.y ) ) * smoothstep( -0.2, 0.0, d.y );
        float g = dot( d, uHzGlowDir );
        c = mix( c, c * vec3( 0.62, 0.7, 0.72 ), s * band * ( 1.0 - smoothstep( 0.9, 0.995, g ) * 0.8 ) );
        gl_FragColor = vec4( c, 1.0 );
      }`,
    side: THREE.BackSide, depthWrite: false,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(150, 48, 24), skyMat);
  sky.renderOrder = 10;
  sky.frustumCulled = false;

  /* god rays: camera-facing (around their axis) additive shafts, one draw call */
  const rays = createRays(quality === 'low' ? 8 : 13, gold);

  function setGlowFrom(camPos, target) {
    U.uHzGlowDir.value.copy(target).sub(camPos).normalize();
  }

  // breath: -1..1, in step with the antler pulse (forest.js)
  function update(t, camera, breath = 0) {
    sky.position.copy(camera.position);
    rays.material.uniforms.uTime.value = t;
    rays.material.uniforms.uBreath.value = 1 + 0.14 * breath;
    U.uHzTime.value = t;
    U.uHzLive.value.set(1 + 0.1 * breath + 0.03 * Math.sin(t * 0.37), 1 + 0.07 * breath,
      Math.sin(t * 0.13) * 0.018 + Math.sin(t * 0.051 + 2) * 0.01, Math.sin(t * 0.093 + 1) * 0.01);
  }

  // "enter the forest" flight: boost (glow brighter / wider, may bloom) and flood (everything fogs into light)
  function setEnter(boost, flood) { U.uHzEnter.value.set(boost, flood); }

  function dispose() {
    sky.geometry.dispose(); skyMat.dispose();
    rays.geometry.dispose(); rays.material.dispose();
  }

  return { fog, sky, rays, setGlowFrom, update, setEnter, dispose };
}

function createRays(n, gold) {
  const rand = seededRandom(77);
  const pos = [], aA = [], aB = [], aSide = [], aAlong = [], aW = [], aSeed = [];
  const idx = [];
  // shafts lean sideways only (constant depth along a shaft): a shaft that slanted in depth crossed each trunk's
  // depth part-way down, so the depth test lit the trunk below that point and not above: a dark pointed "icicle"
  const dir = new THREE.Vector3(0.42, -1, 0).normalize();
  for (let i = 0; i < n; i++) {
    const bx = -5 + rand() * 11 + (i / n) * 1.5;
    const bz = -2.5 - rand() * 16;
    const B = new THREE.Vector3(bx, -0.5, bz);
    const A = B.clone().addScaledVector(dir, -22);
    const w0 = 0.2 + rand() * 0.6, w1 = w0 * (1.15 + rand() * 0.35); // near-parallel: no V-shaped gaps (dark "icicles" on trunks)
    const seed = rand();
    const base = i * 4;
    for (const [along, side] of [[0, -1], [0, 1], [1, -1], [1, 1]]) {
      pos.push(0, 0, 0);
      aA.push(A.x, A.y, A.z); aB.push(B.x, B.y, B.z);
      aSide.push(side); aAlong.push(along); aW.push(w0, w1); aSeed.push(seed, rand() * 0.5 + 0.5);
    }
    idx.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aA', new THREE.Float32BufferAttribute(aA, 3));
  g.setAttribute('aB', new THREE.Float32BufferAttribute(aB, 3));
  g.setAttribute('aSide', new THREE.Float32BufferAttribute(aSide, 1));
  g.setAttribute('aAlong', new THREE.Float32BufferAttribute(aAlong, 1));
  g.setAttribute('aW', new THREE.Float32BufferAttribute(aW, 2));
  g.setAttribute('aSeed', new THREE.Float32BufferAttribute(aSeed, 2));
  g.setIndex(idx);
  const m = additive(new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uColor: { value: gold.clone().lerp(new THREE.Color(0xfff1c7), 0.3) }, uStrength: { value: 0.75 }, uBreath: { value: 1 } },
    vertexShader: /* glsl */`
      attribute vec3 aA; attribute vec3 aB; attribute float aSide; attribute float aAlong; attribute vec2 aW; attribute vec2 aSeed;
      varying float vAcross; varying float vAlong; varying float vSeed; varying float vFade;
      uniform float uTime;
      void main() {
        vec3 p = mix( aA, aB, aAlong );
        vec3 ax = normalize( aB - aA );
        vec3 toCam = normalize( cameraPosition - p );
        vec3 side = normalize( cross( ax, toCam ) );
        float sway = sin( uTime * 0.11 + aSeed.x * 20.0 ) * 0.25;
        p += side * ( aSide * mix( aW.x, aW.y, aAlong ) + sway * aAlong );
        vAcross = aSide; vAlong = aAlong; vSeed = aSeed.x;
        vec4 mv = modelViewMatrix * vec4( p, 1.0 );
        vFade = smoothstep( 2.0, 7.0, - mv.z ) * aSeed.y;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform float uTime; uniform vec3 uColor; uniform float uStrength; uniform float uBreath;
      varying float vAcross; varying float vAlong; varying float vSeed; varying float vFade;
      void main() {
        // soft shoulders: a shaft crossing a trunk diagonally must not cut a crisp dark "icicle" out of it
        float across = exp( - vAcross * vAcross * 2.2 ) * ( 1.0 - vAcross * vAcross );
        float along = smoothstep( 0.0, 0.45, vAlong ) * ( 1.0 - smoothstep( 0.8, 1.0, vAlong ) );
        // each shaft waxes and wanes on its own slow cycle, and soft swells of light drift down it
        float shimmer = 0.72 + 0.28 * sin( uTime * ( 0.35 + vSeed * 0.3 ) + vSeed * 40.0 );
        float flow = 0.8 + 0.2 * sin( vAlong * 7.0 - uTime * ( 0.5 + vSeed * 0.3 ) + vSeed * 17.0 );
        // broad streaks inside the shaft, sliding across it
        float streak = 0.75 + 0.25 * sin( vAcross * 9.0 + vSeed * 13.0 + uTime * ( 0.25 + vSeed * 0.2 ) );
        float a = across * along * shimmer * flow * streak * vFade * uStrength * uBreath;
        gl_FragColor = vec4( uColor * a, 1.0 );
      }`,
    side: THREE.DoubleSide,
  }));
  const mesh = new THREE.Mesh(g, m);
  mesh.frustumCulled = false;
  mesh.renderOrder = 5;
  return mesh;
}
