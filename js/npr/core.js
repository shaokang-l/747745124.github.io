// NPR (non-photorealistic) toolkit shared by the Diaspora hero (forest.js) and menu (room.js) scenes:
// environment helpers, a cel/toon material, a post-processing chain (HDR scene -> ink outlines -> bloom ->
// optional god rays -> tone map / grade / paper / vignette) and a self-managing render stage.
import * as THREE from 'three';

export const OUTLINE_LAYER = 1;
const OUTLINE_BIT = 1 << OUTLINE_LAYER;

/* ------------------------------------------------------------------------------------------------
 * Environment helpers
 * ---------------------------------------------------------------------------------------------- */

let webglSupport;

// three.js r170 renders with WebGL2 only; the pipeline also needs float colour buffers (HDR + normals).
export function isWebGLAvailable() {
  if (webglSupport !== undefined) return webglSupport;
  webglSupport = false;
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (gl) {
      webglSupport = !!(gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float'));
      const lose = gl.getExtension('WEBGL_lose_context');
      if (lose) lose.loseContext();
    }
  } catch (e) { /* no WebGL */ }
  return webglSupport;
}

function media(q) {
  try { return window.matchMedia(q).matches; } catch (e) { return false; }
}

export function prefersReducedMotion() {
  return media('(prefers-reduced-motion: reduce)');
}

// Touch-primary, narrow (theme breakpoint 780 px) or low-end device.
export function isMobileLike() {
  const cores = navigator.hardwareConcurrency || 8;
  const mem = navigator.deviceMemory || 8;
  return media('(pointer: coarse)') || window.innerWidth < 780 || cores <= 4 || mem <= 2;
}

// Deterministic PRNG (mulberry32). Accepts a number or a string seed.
export function seededRandom(seed = 1) {
  let a;
  if (typeof seed === 'string') {
    a = 2166136261;
    for (let i = 0; i < seed.length; i++) a = Math.imul(a ^ seed.charCodeAt(i), 16777619);
  } else {
    a = Math.floor(seed * 4294967296 + (seed | 0)) | 0;
  }
  a >>>= 0;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Enable (or disable) ink outlines for every mesh in a subtree. Points/lines/sprites never get lines.
export function markOutline(object3d, enabled = true) {
  object3d.traverse((o) => {
    if (o.isPoints || o.isLine || o.isSprite) return;
    if (enabled) o.layers.enable(OUTLINE_LAYER);
    else o.layers.disable(OUTLINE_LAYER);
  });
}

/* ------------------------------------------------------------------------------------------------
 * Toon material
 * ---------------------------------------------------------------------------------------------- */

// Replaces three's lights_toon_* chunks: banded diffuse per light, shadow side painted in a cool
// "shade" colour instead of going black, indirect (ambient / hemisphere) light tinted by the shade.
const TOON_PARS = /* glsl */`
varying vec3 vViewPosition;
uniform vec3 nprShade;
uniform float nprShadeAuto;
uniform float nprShadeLift;
uniform float nprBands;
uniform float nprSoftness;
uniform vec3 nprRimColor;
uniform float nprRimStrength;
uniform float nprRimPower;

struct ToonMaterial {
  vec3 diffuseColor;
  vec3 shadeColor;
};

// Darker, a touch more saturated and hue-shifted toward teal/violet.
vec3 nprAutoShade( vec3 c ) {
  float l = dot( c, vec3( 0.2126, 0.7152, 0.0722 ) );
  vec3 s = max( mix( vec3( l ), c, 1.25 ), 0.0 );
  return s * vec3( 0.40, 0.46, 0.70 ) + l * vec3( 0.03, 0.05, 0.13 );
}

// N-level quantised light ramp with smooth, screen-space anti-aliased steps.
float nprBand( float ndl ) {
  float n = max( nprBands - 1.0, 1.0 );
  float w = max( nprSoftness * 0.5, fwidth( ndl ) * 0.75 ); // softness = full step width in N·L
  float acc = 0.0;
  for ( int i = 0; i < 7; i ++ ) {
    if ( float( i ) >= n ) break;
    float t = float( i ) / n;
    acc += smoothstep( t - w, t + w, ndl );
  }
  return acc / n;
}

void RE_Direct_Toon( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in ToonMaterial material, inout ReflectedLight reflectedLight ) {
  float b = nprBand( dot( geometryNormal, directLight.direction ) );
  vec3 albedo = b * material.diffuseColor + ( 1.0 - b ) * nprShadeLift * material.shadeColor;
  reflectedLight.directDiffuse += directLight.color * BRDF_Lambert( albedo );
}

void RE_IndirectDiffuse_Toon( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in ToonMaterial material, inout ReflectedLight reflectedLight ) {
  reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.shadeColor );
}

#define RE_Direct RE_Direct_Toon
#define RE_IndirectDiffuse RE_IndirectDiffuse_Toon
`;

const TOON_MATERIAL = /* glsl */`
ToonMaterial material;
material.diffuseColor = diffuseColor.rgb;
material.shadeColor = mix( diffuseColor.rgb * nprShade / max( diffuse, vec3( 0.02 ) ), nprAutoShade( diffuseColor.rgb ), nprShadeAuto );
`;

const TOON_RIM = /* glsl */`
#include <aomap_fragment>
if ( nprRimStrength > 0.0 ) {
  float nprR = pow( 1.0 - saturate( dot( geometryNormal, geometryViewDir ) ), nprRimPower );
  float nprW = nprSoftness * 0.5 + fwidth( nprR );
  totalEmissiveRadiance += nprRimColor * nprRimStrength * smoothstep( 0.5 - nprW, 0.5 + nprW, nprR );
}
`;

const TOON_KEYS = ['shadeColor', 'bands', 'softness', 'shadeLift', 'rimColor', 'rimStrength', 'rimPower', 'extend', 'cacheKey'];

// MeshToonMaterial with NPR lighting. Keeps lights, shadows, fog, instancing/instanceColor, vertex
// colours, maps and skinning. All NPR materials share one GPU program (per three.js feature set).
export class NPRToonMaterial extends THREE.MeshToonMaterial {
  constructor(params = {}) {
    const base = {};
    for (const k in params) if (!TOON_KEYS.includes(k) && params[k] !== undefined) base[k] = params[k];
    super(base);
    this.nprUniforms = {
      nprShade: { value: new THREE.Color(0x000000) },
      nprShadeAuto: { value: 1 },
      nprShadeLift: { value: 0.3 },
      nprBands: { value: 3 },
      nprSoftness: { value: 0.06 },
      nprRimColor: { value: new THREE.Color(0xffe2a0) },
      nprRimStrength: { value: 0 },
      nprRimPower: { value: 3 },
    };
    this.nprExtend = params.extend || null;
    this.nprCacheKey = params.cacheKey || (this.nprExtend ? String(this.nprExtend) : '');
    const u = this.nprUniforms;
    if (params.shadeColor != null) this.shadeColor = params.shadeColor;
    if (params.bands != null) u.nprBands.value = params.bands;
    if (params.softness != null) u.nprSoftness.value = params.softness;
    if (params.shadeLift != null) u.nprShadeLift.value = params.shadeLift;
    if (params.rimColor != null) u.nprRimColor.value.set(params.rimColor);
    if (params.rimStrength != null) u.nprRimStrength.value = params.rimStrength;
    if (params.rimPower != null) u.nprRimPower.value = params.rimPower;
  }

  // Shadow-side colour of `color` (per-instance / vertex colours are scaled by the same ratio).
  // null = automatic cool hue-shift of whatever the surface colour is.
  get shadeColor() { return this.nprUniforms.nprShadeAuto.value ? null : this.nprUniforms.nprShade.value; }
  set shadeColor(v) {
    const u = this.nprUniforms;
    if (v == null) { u.nprShadeAuto.value = 1; return; }
    if (v.isColor) u.nprShade.value.copy(v); else u.nprShade.value.set(v);
    u.nprShadeAuto.value = 0;
  }
  get bands() { return this.nprUniforms.nprBands.value; }
  set bands(v) { this.nprUniforms.nprBands.value = Math.max(2, Math.min(8, v)); }
  get softness() { return this.nprUniforms.nprSoftness.value; }
  set softness(v) { this.nprUniforms.nprSoftness.value = v; }
  get shadeLift() { return this.nprUniforms.nprShadeLift.value; }
  set shadeLift(v) { this.nprUniforms.nprShadeLift.value = v; }
  get rimColor() { return this.nprUniforms.nprRimColor.value; }
  set rimColor(v) { if (v.isColor) this.nprUniforms.nprRimColor.value.copy(v); else this.nprUniforms.nprRimColor.value.set(v); }
  get rimStrength() { return this.nprUniforms.nprRimStrength.value; }
  set rimStrength(v) { this.nprUniforms.nprRimStrength.value = v; }
  get rimPower() { return this.nprUniforms.nprRimPower.value; }
  set rimPower(v) { this.nprUniforms.nprRimPower.value = v; }

  onBeforeCompile(shader) {
    Object.assign(shader.uniforms, this.nprUniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <lights_toon_pars_fragment>', TOON_PARS)
      .replace('#include <lights_toon_fragment>', TOON_MATERIAL)
      .replace('#include <aomap_fragment>', TOON_RIM);
    if (this.nprExtend) this.nprExtend(shader, { pass: 'color', material: this });
  }

  customProgramCacheKey() { return 'npr-toon-1' + this.nprCacheKey; }

  copy(source) {
    super.copy(source);
    if (source.nprUniforms) {
      for (const k in source.nprUniforms) {
        const v = source.nprUniforms[k].value;
        if (v.isColor) this.nprUniforms[k].value.copy(v); else this.nprUniforms[k].value = v;
      }
      this.nprExtend = source.nprExtend;
      this.nprCacheKey = source.nprCacheKey;
    }
    return this;
  }
}

export function createToonMaterial(params = {}) {
  return new NPRToonMaterial(params);
}

/* ------------------------------------------------------------------------------------------------
 * Normal + depth prepass material (view-space normal in rgb, 1 / view depth in alpha; 0 = empty)
 * ---------------------------------------------------------------------------------------------- */

const ND_VERT = /* glsl */`
#include <common>
#include <batching_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <clipping_planes_pars_vertex>
varying vec3 vNprNormal;
varying float vNprViewZ;
#ifdef NPR_ALPHA_TEST
uniform mat3 nprMapTransform;
varying vec2 vNprUv;
#endif
void main() {
  #include <morphinstance_vertex>
  #include <batching_vertex>
  #include <beginnormal_vertex>
  #include <morphnormal_vertex>
  #include <skinbase_vertex>
  #include <skinnormal_vertex>
  #include <begin_vertex>
  #include <morphtarget_vertex>
  #include <skinning_vertex>
  #include <defaultnormal_vertex>
  #include <project_vertex>
  #include <clipping_planes_vertex>
  vNprNormal = transformedNormal;
  vNprViewZ = - mvPosition.z;
  #ifdef NPR_ALPHA_TEST
  vNprUv = ( nprMapTransform * vec3( uv, 1.0 ) ).xy;
  #endif
}
`;

const ND_FRAG = /* glsl */`
#include <clipping_planes_pars_fragment>
varying vec3 vNprNormal;
varying float vNprViewZ;
#ifdef NPR_ALPHA_TEST
uniform sampler2D nprMap;
uniform vec4 nprMapChannel;
uniform float nprAlphaTest;
varying vec2 vNprUv;
#endif
void main() {
  #include <clipping_planes_fragment>
  #ifdef NPR_ALPHA_TEST
  if ( dot( texture2D( nprMap, vNprUv ), nprMapChannel ) < nprAlphaTest ) discard;
  #endif
  // degenerate (zero-length) normals would give NaN lines; treat them as facing the camera
  vec3 n = dot( vNprNormal, vNprNormal ) > 1e-12 ? normalize( vNprNormal ) : vec3( 0.0, 0.0, 1.0 );
  #ifdef DOUBLE_SIDED
  n *= gl_FrontFacing ? 1.0 : - 1.0;
  #endif
  gl_FragColor = vec4( n, 1.0 / max( vNprViewZ, 1e-3 ) );
}
`;

// Does `extend` patch the prepass shader at all? Colour-only extends (they only touch the colour pass)
// then share the default prepass material and program. Probed once per function on the raw shader.
const extendProbe = new WeakMap();
let probeMaterial = null;
function extendTouchesPrepass(extend) {
  let r = extendProbe.get(extend);
  if (r === undefined) {
    const shader = { name: 'npr-probe', vertexShader: ND_VERT, fragmentShader: ND_FRAG, uniforms: {}, defines: {} };
    if (!probeMaterial) probeMaterial = new THREE.ShaderMaterial();
    try {
      extend(shader, { pass: 'normal', material: probeMaterial });
      r = shader.vertexShader !== ND_VERT || shader.fragmentShader !== ND_FRAG || Object.keys(shader.defines).length > 0;
    } catch (e) {
      r = true; // cannot tell: keep a dedicated prepass program
    }
    extendProbe.set(extend, r);
  }
  return r;
}

// Material for the outline prepass. Use it (with the same `extend` as the colour material) as
// object.userData.nprNormalMaterial for geometry deformed in a custom vertex shader.
// `extend(shader, { pass: 'normal' })` may patch `#include <begin_vertex>` (modify `transformed`).
export function createNormalDepthMaterial({ side = THREE.FrontSide, alphaTest = false, extend = null, cacheKey } = {}) {
  const m = new THREE.ShaderMaterial({
    vertexShader: ND_VERT,
    fragmentShader: ND_FRAG,
    side,
    clipping: true,
    uniforms: alphaTest ? {
      nprMap: { value: null },
      nprMapTransform: { value: new THREE.Matrix3() },
      nprMapChannel: { value: new THREE.Vector4(0, 0, 0, 1) },
      nprAlphaTest: { value: 0.5 },
    } : {},
    defines: alphaTest ? { NPR_ALPHA_TEST: '' } : {},
  });
  m.name = 'npr-normal-depth';
  if (extend) {
    const key = 'npr-nd-' + (cacheKey || String(extend));
    m.onBeforeCompile = (shader) => extend(shader, { pass: 'normal', material: m });
    m.customProgramCacheKey = () => key;
  }
  return m;
}

/* ------------------------------------------------------------------------------------------------
 * Post-processing shaders
 * ---------------------------------------------------------------------------------------------- */

const FS_VERT = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4( position.xy, 0.0, 1.0 ); }
`;

// Ink edges from the normal/depth buffer. Depth: one-sided second difference of 1/z (planar surfaces,
// even grazing ones, give exactly 0; the line lands on the nearer surface only -> no double lines).
// Normals: crease detection between samples on the same surface.
// At low pixel ratios the normal/depth and edge buffers are supersampled (see edgeScale), and the composite
// resolves the line mask with a tent filter, so line borders become coverage instead of stair steps.
const EDGE_FRAG = /* glsl */`
uniform sampler2D tND;
uniform vec2 uTexel;
uniform float uThick;
uniform float uDepthThr;
uniform float uNormalThr;
uniform float uFadeStart;
uniform float uFadeEnd;
varying vec2 vUv;

float nrmEdge( vec4 c, vec4 s ) {
  float same = 1.0 - smoothstep( 0.04, 0.12, abs( s.a - c.a ) / c.a );
  return ( 1.0 - dot( c.rgb, s.rgb ) ) * same;
}

void main() {
  vec4 c = texture2D( tND, vUv );
  if ( c.a <= 0.0 ) { gl_FragColor = vec4( 0.0 ); return; }
  vec2 dd = uTexel * uThick;
  vec2 dn = uTexel * max( uThick * 0.5, 0.5 );
  float l = texture2D( tND, vUv - vec2( dd.x, 0.0 ) ).a;
  float r = texture2D( tND, vUv + vec2( dd.x, 0.0 ) ).a;
  float b = texture2D( tND, vUv - vec2( 0.0, dd.y ) ).a;
  float t = texture2D( tND, vUv + vec2( 0.0, dd.y ) ).a;
  float de = max( 2.0 * c.a - l - r, 2.0 * c.a - b - t ) / c.a;
  float z = 1.0 / c.a;
  float thr = uDepthThr * ( 1.0 + z * 0.01 );
  float depthEdge = smoothstep( thr, thr * 2.0, de );
  float ne = nrmEdge( c, texture2D( tND, vUv - vec2( dn.x, 0.0 ) ) );
  ne = max( ne, nrmEdge( c, texture2D( tND, vUv + vec2( dn.x, 0.0 ) ) ) );
  ne = max( ne, nrmEdge( c, texture2D( tND, vUv - vec2( 0.0, dn.y ) ) ) );
  ne = max( ne, nrmEdge( c, texture2D( tND, vUv + vec2( 0.0, dn.y ) ) ) );
  float normalEdge = smoothstep( uNormalThr, uNormalThr * 1.5 + 0.02, ne );
  float fade = 1.0 - smoothstep( uFadeStart, max( uFadeEnd, uFadeStart + 1e-3 ), z );
  gl_FragColor = vec4( max( depthEdge, normalEdge ) * fade, 0.0, 0.0, 1.0 );
}
`;

// Bloom: thresholded, Karis-weighted downsample (first level), dual-filter down / up chain.
const BLOOM_DOWN_FRAG = /* glsl */`
uniform sampler2D tSrc;
uniform vec2 uTexel; // source texel
uniform float uThreshold;
uniform float uKnee;
varying vec2 vUv;
vec3 pick( vec2 uv ) {
  vec3 c = texture2D( tSrc, uv ).rgb;
  #ifdef PREFILTER
  // drop NaN / Inf from scene shaders here, otherwise the blur smears them into whole blocks
  c = dot( c, vec3( 1.0 ) ) < 1e4 ? clamp( c, 0.0, 64.0 ) : vec3( 0.0 );
  float br = max( c.r, max( c.g, c.b ) );
  float soft = clamp( br - uThreshold + uKnee, 0.0, 2.0 * uKnee );
  soft = soft * soft / ( 4.0 * uKnee + 1e-4 );
  c *= max( soft, br - uThreshold ) / max( br, 1e-4 );
  c /= 1.0 + dot( c, vec3( 0.2126, 0.7152, 0.0722 ) ) * 0.25;
  #endif
  return c;
}
void main() {
  vec3 s = pick( vUv ) * 4.0;
  s += pick( vUv - uTexel );
  s += pick( vUv + uTexel );
  s += pick( vUv + vec2( uTexel.x, - uTexel.y ) );
  s += pick( vUv - vec2( uTexel.x, - uTexel.y ) );
  gl_FragColor = vec4( s / 8.0, 1.0 );
}
`;

const BLOOM_UP_FRAG = /* glsl */`
uniform sampler2D tSrc;   // lower (smaller) level
uniform sampler2D tCurr;  // this level's downsample
uniform vec2 uTexel;      // source texel
uniform float uRadius;
varying vec2 vUv;
void main() {
  vec2 h = uTexel;
  vec3 s = texture2D( tSrc, vUv + vec2( - 2.0 * h.x, 0.0 ) ).rgb;
  s += texture2D( tSrc, vUv + vec2( - h.x, h.y ) ).rgb * 2.0;
  s += texture2D( tSrc, vUv + vec2( 0.0, 2.0 * h.y ) ).rgb;
  s += texture2D( tSrc, vUv + vec2( h.x, h.y ) ).rgb * 2.0;
  s += texture2D( tSrc, vUv + vec2( 2.0 * h.x, 0.0 ) ).rgb;
  s += texture2D( tSrc, vUv + vec2( h.x, - h.y ) ).rgb * 2.0;
  s += texture2D( tSrc, vUv + vec2( 0.0, - 2.0 * h.y ) ).rgb;
  s += texture2D( tSrc, vUv + vec2( - h.x, - h.y ) ).rgb * 2.0;
  gl_FragColor = vec4( texture2D( tCurr, vUv ).rgb + s / 12.0 * uRadius, 1.0 );
}
`;

// Classic 4-sector Kuwahara, run at half resolution (painterly flattening of shading noise).
const KUWAHARA_FRAG = /* glsl */`
uniform sampler2D tSrc;
uniform vec2 uTexel;
varying vec2 vUv;
void main() {
  vec3 m0 = vec3( 0.0 ), m1 = vec3( 0.0 ), m2 = vec3( 0.0 ), m3 = vec3( 0.0 );
  vec3 s0 = vec3( 0.0 ), s1 = vec3( 0.0 ), s2 = vec3( 0.0 ), s3 = vec3( 0.0 );
  for ( int j = - RADIUS; j <= RADIUS; j ++ ) {
    for ( int i = - RADIUS; i <= RADIUS; i ++ ) {
      vec3 c = min( texture2D( tSrc, vUv + vec2( float( i ), float( j ) ) * uTexel ).rgb, vec3( 4.0 ) );
      vec3 cc = c * c;
      if ( i <= 0 && j <= 0 ) { m0 += c; s0 += cc; }
      if ( i >= 0 && j <= 0 ) { m1 += c; s1 += cc; }
      if ( i <= 0 && j >= 0 ) { m2 += c; s2 += cc; }
      if ( i >= 0 && j >= 0 ) { m3 += c; s3 += cc; }
    }
  }
  float n = float( ( RADIUS + 1 ) * ( RADIUS + 1 ) );
  m0 /= n; m1 /= n; m2 /= n; m3 /= n;
  vec3 w = vec3( 1.0 );
  float v0 = dot( s0 / n - m0 * m0, w ), v1 = dot( s1 / n - m1 * m1, w );
  float v2 = dot( s2 / n - m2 * m2, w ), v3 = dot( s3 / n - m3 * m3, w );
  vec3 r = m0; float v = v0;
  if ( v1 < v ) { v = v1; r = m1; }
  if ( v2 < v ) { v = v2; r = m2; }
  if ( v3 < v ) { r = m3; }
  gl_FragColor = vec4( r, 1.0 );
}
`;

// God rays, step 1 (at reduced resolution): the light mask. Sky / empty / far pixels of the normal-depth
// prepass transmit (so outline-layer geometry occludes), weighted by a soft disc around the light and
// optionally seeded by the scene's own brightness and hue (the glow itself emits the rays).
const RAY_MASK_FRAG = /* glsl */`
uniform sampler2D tND;
uniform sampler2D tScene;
uniform vec2 uTexel;     // mask texel (uv)
uniform vec2 uLight;     // light position (uv)
uniform float uAspect;
uniform float uRadius;   // emitting disc radius in screen heights (0 = no disc)
uniform vec2 uDist;      // view distance ramp: geometry nearer than x occludes, beyond y transmits
uniform vec2 uSeed;      // scene-luminance threshold and knee (threshold <= 0: every open pixel emits)
uniform float uEmissive; // occluders brighter than this emit too (glowing antlers, lamps); 0 = off
uniform float uSceneTint;
varying vec2 vUv;
float transmit( vec2 uv ) {
  float a = texture2D( tND, uv ).a; // 1 / view depth, 0 = nothing drawn
  return a <= 0.0 ? 1.0 : smoothstep( uDist.x, uDist.y, 1.0 / a );
}
void main() {
  vec2 o = uTexel * 0.25; // 4 taps: coverage of thin occluders instead of a single aliased sample
  float t = 0.25 * ( transmit( vUv - o ) + transmit( vUv + o ) + transmit( vUv + vec2( o.x, - o.y ) ) + transmit( vUv - vec2( o.x, - o.y ) ) );
  vec2 d = ( vUv - uLight ) * vec2( uAspect, 1.0 );
  float disc = uRadius > 0.0 ? exp( - dot( d, d ) / ( uRadius * uRadius ) ) : 1.0;
  vec3 s = texture2D( tScene, vUv ).rgb;
  s = dot( s, vec3( 1.0 ) ) < 1e4 ? clamp( s, 0.0, 64.0 ) : vec3( 0.0 );
  float l = dot( s, vec3( 0.2126, 0.7152, 0.0722 ) );
  if ( uEmissive > 0.0 ) t = max( t, smoothstep( uEmissive * 0.8, uEmissive * 1.25, l ) );
  float seed = uSeed.x > 0.0 ? smoothstep( uSeed.x - uSeed.y, uSeed.x + uSeed.y, l ) : 1.0;
  vec3 hue = mix( vec3( 1.0 ), s / max( max( s.r, max( s.g, s.b ) ), 1e-3 ), uSceneTint );
  gl_FragColor = vec4( hue * ( t * disc * seed ), 1.0 );
}
`;

// God rays, step 2: radial blur toward the light (GPU Gems 3, ch. 13), run twice: a coarse pass over the
// whole ray with a per-pixel jittered start, then a fine pass spanning one coarse step, which integrates
// the gaps (SAMPLES² effective taps: no banding, no dither noise). The fine pass turns the mean into the
// light gathered along the ray (so a shaft keeps its strength past the emitting disc) times a falloff with
// the distance from the light.
const RAY_BLUR_FRAG = /* glsl */`
uniform sampler2D tSrc;
uniform vec2 uLight;
uniform float uLength;   // fraction of the way to the light covered by this pass
uniform vec4 uGain;      // fine pass (w = 1): x = 1 / disc integral (0: keep the mean), y = ln( decay ), z = aspect, and
uniform float uSpan;     // the fraction of the way to the light the whole ray covers
varying vec2 vUv;
void main() {
  vec2 st = ( uLight - vUv ) * ( uLength / float( SAMPLES ) );
  // interleaved gradient noise: a fixed screen-space pattern (no temporal shimmer)
  vec2 uv = vUv + st * fract( 52.9829189 * fract( dot( gl_FragCoord.xy, vec2( 0.06711056, 0.00583715 ) ) ) );
  vec3 acc = vec3( 0.0 );
  for ( int i = 0; i < SAMPLES; i ++ ) {
    acc += texture2D( tSrc, uv ).rgb;
    uv += st;
  }
  acc /= float( SAMPLES );
  if ( uGain.w > 0.0 ) {
    float d = length( ( vUv - uLight ) * vec2( uGain.z, 1.0 ) ); // screen heights to the light
    if ( uGain.x > 0.0 ) acc *= max( d * uSpan * uGain.x, 1.0 );
    acc *= exp( uGain.y * d );
  }
  gl_FragColor = vec4( acc, 1.0 );
}
`;

const COMPOSITE_FRAG = /* glsl */`
uniform sampler2D tScene;
uniform sampler2D tEdge;
uniform sampler2D tBloom;
uniform sampler2D tRays;
uniform vec3 uRayColor;
uniform float uRayDepth; // 1 / depthFade (0 = off)
uniform sampler2D tPaint;
uniform sampler2D tPaper;
uniform sampler2D tND;
uniform vec2 uRes;
uniform float uPR;
uniform vec3 uLineColor;
uniform float uLineOpacity;
uniform float uBleed;
uniform float uWobble;
uniform vec2 uSeed;
uniform float uBloomStrength;
uniform float uPaintMix;
uniform float uExposure;
uniform float uContrast;
uniform float uSaturation;
uniform vec3 uTint;
uniform vec3 uLift;
uniform vec3 uGain;
uniform float uPaperStrength;
uniform float uPaperScale;
uniform vec3 uPaperTint;
uniform float uVigStrength;
uniform float uVigSoftness;
uniform vec3 uVigColor;
varying vec2 vUv;

float luma( vec3 c ) { return dot( c, vec3( 0.2126, 0.7152, 0.0722 ) ); }

// Identity below the knee (toon colours stay exact), smooth exponential shoulder to 1 above it.
vec3 toneMap( vec3 x ) {
  const float k = 0.72;
  vec3 over = max( x - k, 0.0 );
  vec3 shoulder = k + ( 1.0 - k ) * ( 1.0 - exp( - over / ( 1.0 - k ) ) );
  return mix( x, shoulder, step( k, x ) );
}

vec3 toSRGB( vec3 c ) {
  c = max( c, 0.0 );
  return mix( c * 12.92, 1.055 * pow( c, vec3( 1.0 / 2.4 ) ) - 0.055, step( 0.0031308, c ) );
}

#ifdef FXAA
// FXAA-style edge AA of the scene colour (used when the scene buffer has no MSAA). Samples are compressed
// with c / (1 + luma) so HDR highlights (rims, glows) resolve without stair-stepping, then expanded again.
vec3 fxTap( vec2 uv ) { vec3 c = max( texture2D( tScene, uv ).rgb, 0.0 ); return c / ( 1.0 + luma( c ) ); }
vec3 fxaa( vec2 uv, vec3 rgbM ) {
  vec2 px = 1.0 / uRes;
  rgbM = max( rgbM, 0.0 ) / ( 1.0 + luma( max( rgbM, 0.0 ) ) );
  float lNW = sqrt( luma( fxTap( uv + vec2( - px.x, - px.y ) ) ) );
  float lNE = sqrt( luma( fxTap( uv + vec2( px.x, - px.y ) ) ) );
  float lSW = sqrt( luma( fxTap( uv + vec2( - px.x, px.y ) ) ) );
  float lSE = sqrt( luma( fxTap( uv + vec2( px.x, px.y ) ) ) );
  float lM = sqrt( luma( rgbM ) );
  float lMin = min( lM, min( min( lNW, lNE ), min( lSW, lSE ) ) );
  float lMax = max( lM, max( max( lNW, lNE ), max( lSW, lSE ) ) );
  vec3 res = rgbM;
  if ( lMax - lMin >= max( 0.05, lMax * 0.125 ) ) {
    vec2 dir = vec2( - ( ( lNW + lNE ) - ( lSW + lSE ) ), ( lNW + lSW ) - ( lNE + lSE ) );
    float reduce = max( ( lNW + lNE + lSW + lSE ) * 0.03125, 1.0 / 128.0 );
    dir = clamp( dir / ( min( abs( dir.x ), abs( dir.y ) ) + reduce ), - 8.0, 8.0 ) * px;
    vec3 a = 0.5 * ( fxTap( uv - dir / 6.0 ) + fxTap( uv + dir / 6.0 ) );
    vec3 b = a * 0.5 + 0.25 * ( fxTap( uv - dir * 0.5 ) + fxTap( uv + dir * 0.5 ) );
    float lB = sqrt( luma( b ) );
    res = lB < lMin || lB > lMax ? a : b;
  }
  return res / max( 1.0 - luma( res ), 1e-3 );
}
#endif

void main() {
  vec2 fc = gl_FragCoord.xy;
  vec2 css = fc / uPR;
  vec4 sc = texture2D( tScene, vUv );
  vec3 col = sc.rgb;
  #ifdef ALPHA
  // additive blending can push scene alpha above 1 (src.a * src.a + dst.a); only [0, 1] is meaningful
  float alpha = clamp( sc.a, 0.0, 1.0 );
  #else
  float alpha = 1.0; // opaque canvas: whatever the scene wrote into alpha is irrelevant
  #endif
  #ifdef FXAA
  col = fxaa( vUv, col );
  #endif
  #ifdef PAINTERLY
  // keep HDR highlights (sparks, glows) crisp; only flatten the painted surfaces
  col = mix( col, texture2D( tPaint, vUv ).rgb, uPaintMix * ( 1.0 - smoothstep( 0.9, 1.6, luma( col ) ) ) );
  #endif
  col *= uExposure;

  #ifdef OUTLINE
  vec2 wob = ( texture2D( tPaper, css / 320.0 + uSeed ).ba - 0.5 ) * 2.0 * uWobble * uPR;
  vec2 euv = ( fc + wob ) / uRes;
  vec2 tx = 0.5 / uRes;
  float e = 0.25 * ( texture2D( tEdge, euv + tx ).r + texture2D( tEdge, euv - tx ).r
    + texture2D( tEdge, euv + vec2( tx.x, - tx.y ) ).r + texture2D( tEdge, euv - vec2( tx.x, - tx.y ) ).r );
  e = ( 1.0 - ( 1.0 - e ) * ( 1.0 - e ) ) * uLineOpacity;
  vec3 dark = clamp( mix( vec3( luma( col ) ), col, 1.4 ) * 0.3, 0.0, 0.45 );
  vec3 ink = mix( uLineColor, dark, uBleed );
  col = mix( col, ink, e );
  alpha = mix( alpha, 1.0, e );
  #endif

  #ifdef BLOOM
  vec3 bl = texture2D( tBloom, vUv ).rgb * uBloomStrength * uExposure;
  col += bl;
  alpha = max( alpha, min( 1.0, luma( bl ) ) );
  #endif

  #ifdef GODRAYS
  vec3 rays = texture2D( tRays, vUv ).rgb * uRayColor * uExposure;
  // in-scattering builds up with the air in front of a surface: near objects stay clear of the veil
  float ndA = texture2D( tND, vUv ).a;
  if ( uRayDepth > 0.0 && ndA > 0.0 ) rays *= 1.0 - exp( - uRayDepth / ndA );
  col += rays;
  alpha = max( alpha, min( 1.0, luma( rays ) ) );
  #endif

  col = toneMap( col );
  col = 0.18 * pow( max( col, 0.0 ) / 0.18, vec3( uContrast ) );
  col = max( mix( vec3( luma( col ) ), col, uSaturation ), 0.0 );
  col = col * uGain + uLift * ( 1.0 - col );
  col *= uTint;

  #ifdef PAPER
  vec2 pu = css / ( 256.0 * uPaperScale );
  float grain = texture2D( tPaper, pu ).r - 0.5;
  float blot = texture2D( tPaper, pu * 0.31 + 0.37 ).g - 0.5;
  col *= mix( vec3( 1.0 ), uPaperTint, uPaperStrength ) * ( 1.0 + uPaperStrength * ( grain * 1.1 + blot * 0.9 ) );
  #endif

  vec2 q = ( vUv - 0.5 ) * vec2( uRes.x / uRes.y, 1.0 );
  float d = length( q ) / length( vec2( uRes.x / uRes.y, 1.0 ) * 0.5 );
  float vig = smoothstep( 1.0 - uVigSoftness, 1.0 + uVigSoftness * 0.25, d ) * uVigStrength;
  col = mix( col, uVigColor * alpha, vig );

  #ifdef ALPHA
  col = toSRGB( col / max( alpha, 1e-4 ) ) * alpha;
  #else
  col = toSRGB( col );
  #endif
  col += ( fract( sin( dot( fc, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 ) - 0.5 ) / 255.0;

  #if NPR_DEBUG == 1
  col = texture2D( tND, vUv ).rgb * 0.5 + 0.5;
  #elif NPR_DEBUG == 2
  col = vec3( texture2D( tND, vUv ).a );
  #elif NPR_DEBUG == 3
  col = vec3( 1.0 - texture2D( tEdge, vUv ).r );
  #elif NPR_DEBUG == 4
  col = toSRGB( toneMap( texture2D( tBloom, vUv ).rgb * uBloomStrength ) );
  #elif NPR_DEBUG == 5
  col = toSRGB( toneMap( texture2D( tRays, vUv ).rgb * uRayColor ) );
  #elif NPR_DEBUG == 6
  col = texture2D( tRays, vUv ).rgb;
  #endif
  gl_FragColor = vec4( col, alpha );
}
`;

/* ------------------------------------------------------------------------------------------------
 * Procedural paper texture (tileable 256²): R fine grain, G watercolour blotches, B/A smooth noise
 * used for the hand-drawn line wobble. Generated once per page.
 * ---------------------------------------------------------------------------------------------- */

let paperData = null;

function makePaperData() {
  const N = 256;
  const data = new Uint8Array(N * N * 4);
  const rand = seededRandom(0x9a9e7);
  // Periodic value noise with `cells` lattice cells across the tile.
  const layer = (cells) => {
    const lat = new Float32Array(cells * cells);
    for (let i = 0; i < lat.length; i++) lat[i] = rand();
    return (x, y) => {
      const fx = x / N * cells, fy = y / N * cells;
      const ix = Math.floor(fx), iy = Math.floor(fy);
      let tx = fx - ix, ty = fy - iy;
      tx = tx * tx * tx * (tx * (tx * 6 - 15) + 10);
      ty = ty * ty * ty * (ty * (ty * 6 - 15) + 10);
      const x0 = ix % cells, y0 = iy % cells, x1 = (x0 + 1) % cells, y1 = (y0 + 1) % cells;
      const a = lat[y0 * cells + x0], b = lat[y0 * cells + x1], c = lat[y1 * cells + x0], d = lat[y1 * cells + x1];
      return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
    };
  };
  const g1 = layer(128), g2 = layer(64), g3 = layer(32), fib = layer(16);
  const b1 = layer(4), b2 = layer(8), b3 = layer(16);
  const w1 = layer(8), w2 = layer(8);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const i = (y * N + x) * 4;
      // grain: small tooth + faint horizontal fibres
      const grain = g1(x, y) * 0.45 + g2(x, y) * 0.35 + g3(x, y) * 0.2;
      const fibre = fib(x * 0.25, y * 4) - 0.5;
      data[i] = Math.max(0, Math.min(255, (grain + fibre * 0.35) * 255));
      data[i + 1] = (b1(x, y) * 0.55 + b2(x, y) * 0.3 + b3(x, y) * 0.15) * 255;
      data[i + 2] = w1(x, y) * 255;
      data[i + 3] = w2(x + 97, y + 31) * 255;
    }
  }
  return data;
}

/* ------------------------------------------------------------------------------------------------
 * Pipeline
 * ---------------------------------------------------------------------------------------------- */

const DEFAULT_PARAMS = () => ({
  outline: {
    enabled: true, thickness: 1.6, color: 0x2b1d17, opacity: 0.9,
    depthThreshold: 0.035, normalThreshold: 0.3,
    fadeStart: 30, fadeEnd: 90, colorBleed: 0.35, wobble: 0.75, boilFps: 0,
    // Normal/depth + edge buffer scale, a number 1..2 or 'auto' (supersample below pixel ratio 1.4 to ~1.75
    // samples per CSS px so lines don't crawl; costs ~3x prepass pixels at pr 1). Off by default.
    supersample: 1,
  },
  bloom: { enabled: true, strength: 0.9, radius: 0.75, threshold: 1.0, knee: 0.4 },
  paper: { enabled: true, strength: 0.1, scale: 1, tint: 0xfff4e2 },
  painterly: { enabled: false, radius: 3, strength: 1 },
  grade: { exposure: 1, contrast: 1, saturation: 1, tint: 0xffffff, lift: 0x000000, gain: 0xffffff },
  vignette: { strength: 0.3, softness: 0.65, color: 0x0b0d14 },
  // Volumetric light scattering ("crepuscular rays") streaming from a light, occluded by outline-layer
  // geometry (sky, empty pixels, particles and geometry beyond maxDistance let light through). Added before
  // tone mapping, so exposure / grade / vignette apply. Off by default (then it costs nothing).
  godrays: {
    enabled: false,
    // Light, read every frame: a world point (THREE.Vector3 or any {x, y, z}), an Object3D (its world
    // position), or a direction toward a light at infinity (sun, sky glow) as a THREE.Vector4 / {x, y, z}
    // with w = 0. null = off.
    position: null,
    color: 0xffe0a8,      // ray colour (multiplied by the mask hue, see sceneTint)
    intensity: 1,         // animate this (or color) for day / night; 0 skips the passes
    density: 1,           // ray length as a fraction of the distance from each pixel to the light
    decay: 0.35,          // shaft brightness left one screen height away from the light (1 = no falloff)
    radius: 0.3,          // emitting disc round the light, in screen heights (Gaussian); 0 = all open sky emits
    threshold: 0,         // > 0: only pixels brighter than this (linear scene luminance, soft knee) emit
    knee: 0.25,
    emissive: 0,          // > 0: occluders brighter than this luminance emit too (glowing antlers, lamps)
    sceneTint: 0.5,       // 0..1: rays take the hue of the sky they stream out of
    maxDistance: 80,      // view distance beyond which geometry transmits light like the sky ...
    softness: 0.4,        // ... ramping in over this fraction of maxDistance
    depthFade: 8,         // shafts build up over this view distance in front of geometry (near objects stay
                          // clear, 1 - exp(-z / depthFade)); 0 = rays veil everything equally
    fadeOffscreen: 0.35,  // rays fade out as the light leaves the view (screen heights past the edge); 0 = never
    samples: 'auto',      // taps per blur pass (two passes): 'auto' = 32 high / 20 low quality
    resolution: 'auto',   // mask / blur buffer scale of the render size: 'auto' = 0.5 high / 0.35 low
  },
  fxaa: 'auto', // FXAA-style scene AA: 'auto' = only when the scene buffer has no MSAA (low quality)
  debug: 'off', // 'off' | 'normals' | 'depth' | 'edges' | 'bloom' | 'rays' | 'raymask'
});

const DEBUG_VIEWS = { off: 0, normals: 1, depth: 2, edges: 3, bloom: 4, rays: 5, raymask: 6 };
// Face culled by three's shadow pass for each material side (WebGLShadowMap's `shadowSide`).
const SHADOW_SIDE = { [THREE.FrontSide]: THREE.BackSide, [THREE.BackSide]: THREE.FrontSide, [THREE.DoubleSide]: THREE.DoubleSide };

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !v.isColor && !Array.isArray(v);
}

function mergeDeep(target, src) {
  if (!src) return target;
  for (const k in src) {
    const v = src[k];
    if (isPlainObject(v) && isPlainObject(target[k])) mergeDeep(target[k], v);
    else if (v !== undefined) target[k] = v;
  }
  return target;
}

// Copies a colour param (hex number, CSS string or THREE.Color) into a uniform without allocating.
function syncColor(u, v) {
  if (v && v.isColor) { u.value.copy(v); return; }
  if (v === u.src) return;
  u.value.set(v);
  u.src = v;
}

export function createNPRPipeline(renderer, params, { quality = 'high' } = {}) {
  const P = mergeDeep(DEFAULT_PARAMS(), params);
  const high = quality !== 'low';
  const hasFloatRT = renderer.extensions.has('EXT_color_buffer_float');
  const samples = high && hasFloatRT ? Math.min(4, renderer.capabilities.maxSamples || 0) : 0;
  const bloomLevels = high ? 5 : 4;

  const rtOpts = { type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: false, stencilBuffer: false,
    minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false };
  const sceneRT = new THREE.WebGLRenderTarget(1, 1, { ...rtOpts, depthBuffer: true, samples });
  const ndRT = new THREE.WebGLRenderTarget(1, 1, { ...rtOpts, depthBuffer: true });
  const edgeRT = new THREE.WebGLRenderTarget(1, 1, { ...rtOpts, type: THREE.UnsignedByteType, format: THREE.RedFormat });
  const paintRT = new THREE.WebGLRenderTarget(1, 1, rtOpts);
  const down = [], up = [];
  for (let i = 0; i < bloomLevels; i++) {
    down.push(new THREE.WebGLRenderTarget(1, 1, rtOpts));
    if (i < bloomLevels - 1) up.push(new THREE.WebGLRenderTarget(1, 1, rtOpts));
  }
  // God rays: mask -> rayA, coarse blur -> rayB, fine blur -> rayA (GPU memory only once they are used).
  const rayA = new THREE.WebGLRenderTarget(1, 1, rtOpts);
  const rayB = new THREE.WebGLRenderTarget(1, 1, rtOpts);
  const targets = [sceneRT, ndRT, edgeRT, paintRT, ...down, ...up, rayA, rayB];

  if (!paperData) paperData = makePaperData();
  const paper = new THREE.DataTexture(paperData, 256, 256, THREE.RGBAFormat, THREE.UnsignedByteType,
    THREE.UVMapping, THREE.RepeatWrapping, THREE.RepeatWrapping, THREE.LinearFilter, THREE.LinearFilter);
  paper.needsUpdate = true;

  // Fullscreen triangle.
  const tri = new THREE.BufferGeometry();
  tri.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  tri.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
  const quad = new THREE.Mesh(tri);
  quad.frustumCulled = false;
  const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const post = (fragmentShader, uniforms, defines = {}) => new THREE.ShaderMaterial({
    vertexShader: FS_VERT, fragmentShader, uniforms, defines, depthTest: false, depthWrite: false,
  });
  const v2 = () => ({ value: new THREE.Vector2() });
  const col = () => ({ value: new THREE.Color() });

  const edgeMat = post(EDGE_FRAG, {
    tND: { value: ndRT.texture }, uTexel: v2(), uThick: { value: 1 }, uDepthThr: { value: 0 },
    uNormalThr: { value: 0 }, uFadeStart: { value: 0 }, uFadeEnd: { value: 0 },
  });
  const downMat = post(BLOOM_DOWN_FRAG, { tSrc: { value: null }, uTexel: v2(), uThreshold: { value: 1 }, uKnee: { value: 0.4 } });
  const prefilterMat = post(BLOOM_DOWN_FRAG, downMat.uniforms, { PREFILTER: '' });
  const upMat = post(BLOOM_UP_FRAG, { tSrc: { value: null }, tCurr: { value: null }, uTexel: v2(), uRadius: { value: 1 } });
  const paintMat = post(KUWAHARA_FRAG, { tSrc: { value: sceneRT.texture }, uTexel: v2() }, { RADIUS: 3 });
  const cu = {
    tScene: { value: sceneRT.texture }, tEdge: { value: edgeRT.texture }, tBloom: { value: up[0].texture },
    tPaint: { value: paintRT.texture }, tPaper: { value: paper }, tND: { value: ndRT.texture },
    uRes: v2(), uPR: { value: 1 }, uLineColor: col(), uLineOpacity: { value: 1 }, uBleed: { value: 0 },
    uWobble: { value: 0 }, uSeed: v2(), uBloomStrength: { value: 1 }, uPaintMix: { value: 1 },
    uExposure: { value: 1 }, uContrast: { value: 1 }, uSaturation: { value: 1 }, uTint: col(), uLift: col(),
    uGain: col(), uPaperStrength: { value: 0 }, uPaperScale: { value: 1 }, uPaperTint: col(),
    uVigStrength: { value: 0 }, uVigSoftness: { value: 0.5 }, uVigColor: col(),
    tRays: { value: rayA.texture }, uRayColor: col(), uRayDepth: { value: 0 },
  };
  const compMat = post(COMPOSITE_FRAG, cu, { NPR_DEBUG: 0 });
  compMat.transparent = false;
  compMat.blending = THREE.NoBlending;
  const rayMaskMat = post(RAY_MASK_FRAG, {
    tND: { value: ndRT.texture }, tScene: { value: sceneRT.texture }, uTexel: v2(), uLight: v2(),
    uAspect: { value: 1 }, uRadius: { value: 0 }, uDist: v2(), uSeed: v2(), uEmissive: { value: 0 }, uSceneTint: { value: 0 },
  });
  const rayBlurMat = post(RAY_BLUR_FRAG, {
    tSrc: { value: null }, uLight: v2(), uLength: { value: 1 }, uGain: { value: new THREE.Vector4() }, uSpan: { value: 1 },
  }, { SAMPLES: 32 });
  const materials = [edgeMat, downMat, prefilterMat, upMat, paintMat, compMat, rayMaskMat, rayBlurMat];

  // Prepass materials: shared defaults per side, per-material variants for alpha-tested / extended ones.
  const ndDefault = [THREE.FrontSide, THREE.BackSide, THREE.DoubleSide].map((side) => createNormalDepthMaterial({ side }));
  const ndVariants = new Map(); // source material -> { v, drop }; dropped when the source is disposed
  const ndArrays = new WeakMap();

  function ndVariant(m) {
    const alpha = m.alphaTest > 0 && !!(m.map || m.alphaMap);
    const clip = !!(m.clippingPlanes && m.clippingPlanes.length);
    const extend = m.nprExtend && extendTouchesPrepass(m.nprExtend) ? m.nprExtend : null;
    if (!alpha && !extend && !clip) return ndDefault[m.side] || ndDefault[0];
    let e = ndVariants.get(m);
    if (!e) {
      const v = createNormalDepthMaterial({ alphaTest: alpha, extend, cacheKey: m.nprCacheKey });
      const drop = () => { m.removeEventListener('dispose', drop); ndVariants.delete(m); v.dispose(); };
      m.addEventListener('dispose', drop);
      e = { v, drop };
      ndVariants.set(m, e);
    }
    const v = e.v;
    v.side = m.side;
    v.visible = m.visible;
    v.clippingPlanes = m.clippingPlanes;
    if (alpha) {
      const tex = m.alphaMap || m.map;
      v.uniforms.nprMap.value = tex;
      v.uniforms.nprMapTransform.value.copy(tex.matrix);
      v.uniforms.nprMapChannel.value.set(0, m.alphaMap ? 1 : 0, 0, m.alphaMap ? 0 : 1);
      v.uniforms.nprAlphaTest.value = m.alphaTest;
    }
    return v;
  }

  function ndMaterialFor(o) {
    const custom = o.userData.nprNormalMaterial;
    if (custom) return custom;
    const m = o.material;
    if (!Array.isArray(m)) return ndVariant(m);
    let arr = ndArrays.get(o);
    if (!arr || arr.length !== m.length) { arr = new Array(m.length); ndArrays.set(o, arr); }
    for (let i = 0; i < m.length; i++) arr[i] = ndVariant(m[i]);
    return arr;
  }

  // Per-frame swap bookkeeping (arrays grow once, then are reused: no per-frame allocation).
  const swapObj = [], swapMat = [], hidObj = [];
  let swapN = 0, hidN = 0;
  function collect(o) {
    if (o.isLight) {
      // Lights must be visible to both passes, otherwise the light hash flips each pass and every
      // lit material re-resolves its program every frame.
      if ((o.layers.mask & OUTLINE_BIT) === 0) o.layers.enable(OUTLINE_LAYER);
      return;
    }
    if ((o.layers.mask & OUTLINE_BIT) === 0) return;
    if (o.isMesh) {
      swapObj[swapN] = o; swapMat[swapN] = o.material; swapN++;
      o.material = ndMaterialFor(o);
    } else if (o.isPoints || o.isLine || o.isSprite) {
      hidObj[hidN++] = o; o.visible = false;
    }
  }

  let width = 1, height = 1, pixelRatio = 1, bufW = 1, bufH = 1, edgeScale = 1, ndW = 1, ndH = 1, rayScale = 0.5;
  const savedClear = new THREE.Color();
  const stats = { calls: 0, triangles: 0, sceneCalls: 0, sceneTriangles: 0, prepassCalls: 0, prepassTriangles: 0 };

  function blit(material, target) {
    quad.material = material;
    renderer.setRenderTarget(target);
    renderer.render(quad, quadCam);
  }

  function edgeScaleFor(pr) {
    const s = P.outline.supersample;
    if (!P.outline.enabled) return 1; // (prepass used by god rays only: no need to supersample)
    if (typeof s === 'number' && s > 0) return Math.min(2, Math.max(1, s));
    return pr < 1.4 ? Math.min(2, 1.75 / pr) : 1;
  }

  function rayScaleFor() {
    const s = P.godrays.resolution;
    return typeof s === 'number' && s > 0 ? Math.min(1, Math.max(0.125, s)) : high ? 0.5 : 0.35;
  }

  function raySamplesFor() {
    const n = P.godrays.samples;
    return typeof n === 'number' && n > 0 ? Math.min(96, Math.max(4, Math.round(n))) : high ? 32 : 20;
  }

  function setSize(w, h, pr = pixelRatio) {
    width = Math.max(1, w); height = Math.max(1, h); pixelRatio = pr;
    bufW = Math.max(1, Math.floor(width * pr)); bufH = Math.max(1, Math.floor(height * pr));
    edgeScale = edgeScaleFor(pr);
    rayScale = rayScaleFor();
    const rw = Math.max(1, Math.round(bufW * rayScale)), rh = Math.max(1, Math.round(bufH * rayScale));
    rayA.setSize(rw, rh);
    rayB.setSize(rw, rh);
    rayMaskMat.uniforms.uTexel.value.set(1 / rw, 1 / rh);
    rayMaskMat.uniforms.uAspect.value = bufW / bufH;
    ndW = Math.max(1, Math.round(bufW * edgeScale)); ndH = Math.max(1, Math.round(bufH * edgeScale));
    sceneRT.setSize(bufW, bufH);
    ndRT.setSize(ndW, ndH);
    edgeRT.setSize(ndW, ndH);
    paintRT.setSize(Math.max(1, bufW >> 1), Math.max(1, bufH >> 1));
    for (let i = 0; i < bloomLevels; i++) {
      const w2 = Math.max(1, bufW >> (i + 1)), h2 = Math.max(1, bufH >> (i + 1));
      down[i].setSize(w2, h2);
      if (up[i]) up[i].setSize(w2, h2);
    }
    cu.uRes.value.set(bufW, bufH);
    cu.uPR.value = pr;
    edgeMat.uniforms.uTexel.value.set(1 / ndW, 1 / ndH);
    paintMat.uniforms.uTexel.value.set(1 / paintRT.width, 1 / paintRT.height);
  }

  function setDefine(m, k, on) {
    const has = k in m.defines;
    if (on === has) return;
    if (on) m.defines[k] = ''; else delete m.defines[k];
    m.needsUpdate = true;
  }

  function prepass(scene, camera) {
    swapN = 0; hidN = 0;
    scene.traverseVisible(collect);
    const mask = camera.layers.mask;
    const bg = scene.background, ov = scene.overrideMaterial;
    const sm = renderer.shadowMap, au = sm.autoUpdate, nu = sm.needsUpdate;
    renderer.getClearColor(savedClear);
    const clearAlpha = renderer.getClearAlpha();
    scene.background = null; scene.overrideMaterial = null;
    camera.layers.mask = OUTLINE_BIT;
    sm.autoUpdate = false; sm.needsUpdate = false;
    renderer.setClearColor(0x000000, 0);
    try {
      renderer.setRenderTarget(ndRT);
      renderer.render(scene, camera);
    } finally {
      renderer.setClearColor(savedClear, clearAlpha);
      sm.autoUpdate = au; sm.needsUpdate = nu;
      camera.layers.mask = mask;
      scene.background = bg; scene.overrideMaterial = ov;
      for (let i = 0; i < swapN; i++) { swapObj[i].material = swapMat[i]; swapObj[i] = null; swapMat[i] = null; }
      for (let i = 0; i < hidN; i++) { hidObj[i].visible = true; hidObj[i] = null; }
    }
  }

  function raysEnabled() {
    const GR = P.godrays;
    return !!(GR && GR.enabled && GR.position);
  }

  // Screen position of the god-ray light for the render camera (into rayLight, uv units); returns the
  // fade (0 when it is behind the camera or far off-screen).
  const rayColor = col(), rayLight = new THREE.Vector2(), _rayV = new THREE.Vector4(), _rayCam = new THREE.Vector3(), _rayM = new THREE.Matrix4();
  function projectRayLight(camera) {
    const GR = P.godrays, p = GR.position;
    if (p.isObject3D) {
      p.getWorldPosition(_rayCam);
      _rayV.set(_rayCam.x, _rayCam.y, _rayCam.z, 1);
    } else if (p.w === 0) {
      // direction: a point far along it from the camera projects exactly like the light at infinity
      _rayCam.setFromMatrixPosition(camera.matrixWorld);
      const far = camera.isPerspectiveCamera ? (camera.near + camera.far) * 0.5 : 1e3;
      const l = Math.hypot(p.x, p.y, p.z) || 1;
      _rayV.set(_rayCam.x + p.x / l * far, _rayCam.y + p.y / l * far, _rayCam.z + p.z / l * far, 1);
    } else {
      _rayV.set(p.x, p.y, p.z, 1);
    }
    _rayV.applyMatrix4(camera.matrixWorldInverse);
    // facing: cosine between the view axis and the light (fades rays as the light swings behind)
    const len = Math.hypot(_rayV.x, _rayV.y, _rayV.z);
    const facing = len > 0 ? -_rayV.z / len : 0;
    if (facing <= 0 && camera.isPerspectiveCamera) return 0;
    _rayV.applyMatrix4(camera.projectionMatrix);
    const w = _rayV.w > 1e-6 ? _rayV.w : 1e-6;
    const u = THREE.MathUtils.clamp(_rayV.x / w * 0.5 + 0.5, -2, 3);
    const v = THREE.MathUtils.clamp(_rayV.y / w * 0.5 + 0.5, -2, 3);
    rayLight.set(u, v);
    let fade = camera.isPerspectiveCamera ? THREE.MathUtils.smoothstep(facing, 0, 0.2) : 1;
    if (GR.fadeOffscreen > 0) {
      const ox = Math.max(0, -u, u - 1) * (bufW / bufH), oy = Math.max(0, -v, v - 1);
      fade *= 1 - THREE.MathUtils.smoothstep(Math.hypot(ox, oy), 0, GR.fadeOffscreen);
    }
    return fade;
  }

  // Mask + two radial blur passes into rayA; returns false when there is nothing to draw.
  function renderRays(camera) {
    const GR = P.godrays;
    const fade = GR.intensity > 0 ? projectRayLight(camera) : 0;
    const k = GR.intensity * fade;
    syncColor(rayColor, GR.color);
    cu.uRayColor.value.copy(rayColor.value).multiplyScalar(k);
    if (k <= 0) return false;
    const mu = rayMaskMat.uniforms;
    mu.uLight.value.copy(rayLight);
    mu.uRadius.value = Math.max(0, GR.radius);
    const far = Math.max(1e-3, GR.maxDistance);
    mu.uDist.value.set(far * (1 - THREE.MathUtils.clamp(GR.softness, 0, 1)) - 1e-3, far);
    mu.uSeed.value.set(GR.threshold, Math.max(1e-3, GR.knee));
    mu.uEmissive.value = Math.max(0, GR.emissive);
    mu.uSceneTint.value = THREE.MathUtils.clamp(GR.sceneTint, 0, 1);
    cu.uRayDepth.value = GR.depthFade > 0 ? 1 / GR.depthFade : 0;
    blit(rayMaskMat, rayA);
    if (P.debug === 'raymask') return true;
    const bu = rayBlurMat.uniforms, n = rayBlurMat.defines.SAMPLES;
    const len = THREE.MathUtils.clamp(GR.density, 0, 1);
    bu.uLight.value.copy(rayLight);
    bu.tSrc.value = rayA.texture;
    bu.uLength.value = len;
    bu.uGain.value.set(0, 0, 0, 0);
    blit(rayBlurMat, rayB);
    bu.tSrc.value = rayB.texture;
    bu.uLength.value = len / n;
    bu.uSpan.value = len;
    // Gaussian disc: the light gathered crossing it is 0.886 r (open sky everywhere, radius 0: keep the mean)
    bu.uGain.value.set(GR.radius > 0 ? 1 / (0.886 * GR.radius) : 0, Math.log(THREE.MathUtils.clamp(GR.decay, 1e-3, 1)),
      bufW / bufH, 1);
    blit(rayBlurMat, rayA);
    return true;
  }

  // Composite variant for the current params (shared by render() and compile()).
  function syncComposite() {
    const O = P.outline, B = P.bloom, PA = P.paper, PT = P.painterly;
    setDefine(compMat, 'OUTLINE', O.enabled && O.opacity > 0);
    setDefine(compMat, 'BLOOM', B.enabled && B.strength > 0);
    setDefine(compMat, 'PAINTERLY', PT.enabled && PT.strength > 0);
    setDefine(compMat, 'PAPER', PA.enabled && PA.strength > 0);
    // (kept on while intensity animates through 0, so a day / night cycle never recompiles the composite)
    setDefine(compMat, 'GODRAYS', raysEnabled());
    const n = raySamplesFor();
    if (rayBlurMat.defines.SAMPLES !== n) { rayBlurMat.defines.SAMPLES = n; rayBlurMat.needsUpdate = true; }
    // Straight-alpha output only for a see-through canvas (three always creates an alpha context).
    setDefine(compMat, 'ALPHA', renderer.getClearAlpha() < 1);
    setDefine(compMat, 'FXAA', P.fxaa === 'auto' ? samples === 0 : !!P.fxaa);
    const dbg = DEBUG_VIEWS[P.debug] || 0;
    if (compMat.defines.NPR_DEBUG !== dbg) { compMat.defines.NPR_DEBUG = dbg; compMat.needsUpdate = true; }
    const r = Math.max(1, Math.min(6, Math.round(PT.radius)));
    if (paintMat.defines.RADIUS !== r) { paintMat.defines.RADIUS = r; paintMat.needsUpdate = true; }
  }

  // Swaps every outline-layer mesh of the scene (hidden ones too) to its prepass material; returns a restore fn.
  function swapAllForPrepass(scene) {
    const objs = [], mats = [];
    scene.traverse((o) => {
      if (o.isLight) { o.layers.enable(OUTLINE_LAYER); return; }
      if (!o.isMesh || (o.layers.mask & OUTLINE_BIT) === 0) return;
      objs.push(o); mats.push(o.material);
      o.material = ndMaterialFor(o);
    });
    return () => { for (let i = 0; i < objs.length; i++) objs[i].material = mats[i]; };
  }

  // Uploads the textures of a material now instead of during the first frame.
  function initTextures(m, done) {
    const up = (t) => {
      if (!t || !t.isTexture || done.has(t) || t.isCubeTexture || t.isVideoTexture || t.isRenderTargetTexture || t.version === 0) return;
      done.add(t);
      const img = t.image;
      if (!img || img.complete === false || (img.width === 0 && !img.data)) return;
      renderer.initTexture(t);
    };
    for (const k in m) up(m[k]);
    if (m.uniforms) for (const k in m.uniforms) up(m.uniforms[k] && m.uniforms[k].value);
  }

  // three's shadow pass draws casters with shared MeshDepthMaterial / MeshDistanceMaterial instances whose
  // programs are keyed by their settings only, so compiling equivalent stand-ins warms those programs.
  // The stand-ins are kept (until release) so the programs stay cached until the real ones pick them up.
  const shadowStandIns = new Map();
  function shadowStandIn(m, point, vsm) {
    const side = m.shadowSide != null ? m.shadowSide : vsm ? m.side : SHADOW_SIDE[m.side];
    const clip = renderer.localClippingEnabled && m.clipShadows && m.clippingPlanes ? m.clippingPlanes.length : 0;
    const key = [point, side, !!m.map, !!m.alphaMap, m.alphaTest > 0, !!m.displacementMap, clip, !!m.wireframe].join();
    let s = shadowStandIns.get(key);
    if (!s) {
      s = point ? new THREE.MeshDistanceMaterial() : new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
      shadowStandIns.set(key, s);
    }
    s.side = side; s.wireframe = m.wireframe;
    s.map = m.map; s.alphaMap = m.alphaMap; s.alphaTest = m.alphaTest;
    s.clipShadows = m.clipShadows; s.clippingPlanes = m.clippingPlanes; s.clipIntersection = m.clipIntersection;
    s.displacementMap = m.displacementMap; s.displacementScale = m.displacementScale; s.displacementBias = m.displacementBias;
    return s;
  }

  function compileShadowCasters(scene, camera) {
    const sm = renderer.shadowMap;
    if (!sm.enabled) return;
    let dir = false, point = false;
    scene.traverseVisible((o) => { if (o.isLight && o.castShadow) { if (o.isPointLight) point = true; else dir = true; } });
    const vsm = sm.type === THREE.VSMShadowMap;
    for (const isPoint of [false, true]) {
      if (isPoint ? !point : !dir) continue;
      const objs = [], mats = [];
      scene.traverse((o) => {
        if (!(o.isMesh || o.isLine || o.isPoints) || !o.castShadow || !o.material) return;
        const custom = isPoint ? o.customDistanceMaterial : o.customDepthMaterial;
        const m = o.material;
        objs.push(o); mats.push(m);
        o.material = custom || (Array.isArray(m) ? m.map((x) => shadowStandIn(x, isPoint, vsm)) : shadowStandIn(m, isPoint, vsm));
      });
      try {
        renderer.compile(scene, camera);
      } finally {
        for (let i = 0; i < objs.length; i++) objs[i].material = mats[i];
      }
    }
  }

  // Resolves once every program three.js has created is linked. With KHR_parallel_shader_compile this
  // polls without blocking; without it programs report ready at once (and link on first use).
  function programsReady() {
    const gl = renderer.getContext();
    const t0 = performance.now();
    return new Promise((resolve) => {
      const check = () => {
        const progs = renderer.info.programs || [];
        let ready = true;
        for (let i = 0; i < progs.length && ready; i++) ready = progs[i].isReady();
        if (ready || gl.isContextLost() || performance.now() - t0 > 5000) resolve();
        else setTimeout(check, 8);
      };
      check();
    });
  }

  // Warms exactly the GPU programs the next render() uses — the prepass variants for the normal/depth
  // target, the scene for the linear HDR target, the post passes — allocates the render targets and
  // uploads the scene's textures, then waits (without blocking) until the programs are linked.
  function compile(scene, camera) {
    syncComposite();
    const O = P.outline, B = P.bloom, PT = P.painterly;
    const outline = O.enabled && O.opacity > 0, bloom = B.enabled && B.strength > 0, paint = PT.enabled && PT.strength > 0;
    const rays = raysEnabled();
    if ((outline && edgeScaleFor(pixelRatio) !== edgeScale) || (rays && rayScaleFor() !== rayScale)) setSize(width, height, pixelRatio);
    const saved = renderer.getRenderTarget();
    const done = new Set();
    try {
      const used = [sceneRT];
      if (outline) used.push(ndRT, edgeRT);
      else if (rays) used.push(ndRT);
      if (rays) used.push(rayA, rayB);
      if (bloom) used.push(...down, ...up);
      if (paint) used.push(paintRT);
      for (const t of used) renderer.setRenderTarget(t);
      if (outline || rays) {
        const restore = swapAllForPrepass(scene);
        const mask = camera.layers.mask;
        camera.layers.mask = OUTLINE_BIT;
        try {
          renderer.setRenderTarget(ndRT);
          renderer.compile(scene, camera);
        } finally {
          camera.layers.mask = mask;
          restore();
        }
      }
      renderer.setRenderTarget(sceneRT);
      renderer.compile(scene, camera);
      compileShadowCasters(scene, camera); // (any non-null target: shadow maps are linear too)
      scene.traverse((o) => {
        const ms = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
        for (const m of ms) initTextures(m, done);
      });
      const passes = [[compMat, null]];
      if (outline) passes.push([edgeMat, edgeRT]);
      if (bloom) passes.push([prefilterMat, down[0]], [downMat, down[1]], [upMat, up[0]]);
      if (paint) passes.push([paintMat, paintRT]);
      if (rays) passes.push([rayMaskMat, rayA], [rayBlurMat, rayB]);
      for (const [m, target] of passes) {
        quad.material = m;
        renderer.setRenderTarget(target);
        renderer.compile(quad, quadCam);
      }
      renderer.initTexture(paper);
    } finally {
      renderer.setRenderTarget(saved);
    }
    return programsReady();
  }

  function render(scene, camera, time = 0) {
    const O = P.outline, B = P.bloom, G = P.grade, PA = P.paper, V = P.vignette, PT = P.painterly;
    const outline = O.enabled && O.opacity > 0;
    const bloom = B.enabled && B.strength > 0;
    const paint = PT.enabled && PT.strength > 0;
    const rays = raysEnabled();
    if ((outline && edgeScaleFor(pixelRatio) !== edgeScale) || (rays && rayScaleFor() !== rayScale)) setSize(width, height, pixelRatio);
    const info = renderer.info; // replaced by three.js after a context restore
    info.autoReset = false;
    info.reset();

    // Update world matrices once for both scene passes.
    const sceneAuto = scene.matrixWorldAutoUpdate, camAuto = camera.matrixWorldAutoUpdate;
    if (sceneAuto) scene.updateMatrixWorld();
    if (camAuto && camera.parent === null) camera.updateMatrixWorld();
    scene.matrixWorldAutoUpdate = false; camera.matrixWorldAutoUpdate = false;
    try {
      if (outline || rays) prepass(scene, camera); // (god rays are occluded by the prepass geometry)
      stats.prepassCalls = info.render.calls; stats.prepassTriangles = info.render.triangles;
      renderer.setRenderTarget(sceneRT);
      renderer.render(scene, camera);
      stats.sceneCalls = info.render.calls - stats.prepassCalls;
      stats.sceneTriangles = info.render.triangles - stats.prepassTriangles;
    } finally {
      scene.matrixWorldAutoUpdate = sceneAuto; camera.matrixWorldAutoUpdate = camAuto;
    }

    if (outline) {
      const eu = edgeMat.uniforms;
      eu.uThick.value = Math.max(0.5, O.thickness * pixelRatio * ndW / bufW);
      eu.uDepthThr.value = O.depthThreshold;
      eu.uNormalThr.value = O.normalThreshold;
      eu.uFadeStart.value = O.fadeStart;
      eu.uFadeEnd.value = O.fadeEnd;
      blit(edgeMat, edgeRT);
      syncColor(cu.uLineColor, O.color);
      cu.uLineOpacity.value = O.opacity;
      cu.uBleed.value = O.colorBleed;
      cu.uWobble.value = O.wobble;
      const seed = O.boilFps > 0 ? Math.floor(time * O.boilFps) : 0;
      cu.uSeed.value.set((seed * 0.618034) % 1, (seed * 0.381966 + 0.5 * (seed > 0)) % 1);
    }

    if (bloom) {
      const du = downMat.uniforms;
      du.uThreshold.value = B.threshold;
      du.uKnee.value = Math.max(1e-3, B.knee);
      let src = sceneRT;
      for (let i = 0; i < bloomLevels; i++) {
        du.tSrc.value = src.texture;
        du.uTexel.value.set(1 / src.width, 1 / src.height);
        blit(i === 0 ? prefilterMat : downMat, down[i]);
        src = down[i];
      }
      const uu = upMat.uniforms;
      uu.uRadius.value = B.radius;
      let norm = 1;
      for (let i = bloomLevels - 2; i >= 0; i--) {
        const lower = i === bloomLevels - 2 ? down[i + 1] : up[i + 1];
        uu.tSrc.value = lower.texture;
        uu.tCurr.value = down[i].texture;
        uu.uTexel.value.set(0.5 / lower.width, 0.5 / lower.height);
        blit(upMat, up[i]);
        norm = 1 + norm * B.radius;
      }
      cu.uBloomStrength.value = B.strength / norm;
    }

    syncComposite();
    if (rays) renderRays(camera);
    if (paint) {
      blit(paintMat, paintRT);
      cu.uPaintMix.value = PT.strength;
    }

    cu.uExposure.value = G.exposure;
    cu.uContrast.value = G.contrast;
    cu.uSaturation.value = G.saturation;
    syncColor(cu.uTint, G.tint);
    syncColor(cu.uLift, G.lift);
    syncColor(cu.uGain, G.gain);
    cu.uPaperStrength.value = PA.strength;
    cu.uPaperScale.value = Math.max(0.05, PA.scale);
    syncColor(cu.uPaperTint, PA.tint);
    cu.uVigStrength.value = V.strength;
    cu.uVigSoftness.value = Math.max(0.01, V.softness);
    syncColor(cu.uVigColor, V.color);
    blit(compMat, null);

    stats.calls = info.render.calls;
    stats.triangles = info.render.triangles;
  }

  // Frees GPU memory; the pipeline stays usable (three.js re-uploads on the next render).
  function releaseGPU() {
    for (const t of targets) t.dispose();
    for (const m of materials) m.dispose();
    for (const m of ndDefault) m.dispose();
    for (const e of ndVariants.values()) e.v.dispose();
    for (const m of shadowStandIns.values()) m.dispose();
    shadowStandIns.clear();
    paper.dispose();
    tri.dispose();
  }

  function dispose() {
    releaseGPU();
    for (const e of Array.from(ndVariants.values())) e.drop();
    renderer.info.autoReset = true;
  }

  return {
    params: P,
    stats,
    quality: high ? 'high' : 'low',
    samples,
    get width() { return width; },
    get height() { return height; },
    get pixelRatio() { return pixelRatio; },
    setSize,
    render,
    compile,
    releaseGPU,
    dispose,
  };
}

// Drops the GPU copies of everything in a scene (geometries, materials, textures, shadow maps) without
// making the objects unusable. Used after a context loss so three.js re-uploads them cleanly.
export function releaseSceneGPU(scene) {
  const seen = new Set();
  const free = (r) => { if (r && !seen.has(r)) { seen.add(r); r.dispose(); } };
  scene.traverse((o) => {
    if (o.geometry) free(o.geometry);
    if (o.isLight && o.shadow && o.shadow.map) { o.shadow.map.dispose(); o.shadow.map = null; }
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of mats) {
      free(m);
      for (const k in m) if (m[k] && m[k].isTexture) free(m[k]);
      if (m.uniforms) for (const k in m.uniforms) { const v = m.uniforms[k].value; if (v && v.isTexture) free(v); }
    }
  });
  if (scene.background && scene.background.isTexture) free(scene.background);
  if (scene.environment) free(scene.environment);
}

// GL objects of a lost context are dead: deleting one on the restored context logs "delete: object does
// not belong to this context". three.js' dispose listeners registered before a loss still hold such
// objects, whatever order things are disposed in. So every object is tagged with the context generation
// that created it; deletes of older generations (and all deletes while the context is lost, which are
// no-ops anyway) are dropped. Objects created before the guard was installed count as generation 0.
const GL_OBJECT_KINDS = ['Buffer', 'Framebuffer', 'Program', 'Query', 'Renderbuffer', 'Sampler', 'Shader',
  'Texture', 'TransformFeedback', 'VertexArray'];

function guardStaleDeletes(gl) {
  let generation = 0;
  const born = new WeakMap();
  for (const kind of GL_OBJECT_KINDS) {
    const create = gl['create' + kind], del = gl['delete' + kind];
    if (typeof create !== 'function' || typeof del !== 'function') continue;
    gl['create' + kind] = function (...args) {
      const obj = create.apply(gl, args);
      if (obj && generation) born.set(obj, generation);
      return obj;
    };
    gl['delete' + kind] = function (obj) {
      if (!obj || gl.isContextLost() || (born.get(obj) || 0) !== generation) return;
      del.call(gl, obj);
    };
  }
  return { newGeneration() { generation++; } };
}

/* ------------------------------------------------------------------------------------------------
 * Stage: canvas + renderer + pipeline + managed render loop
 * ---------------------------------------------------------------------------------------------- */

export function createStage(container, options = {}) {
  const o = {
    maxPixelRatio: 1.5, minPixelRatio: 0.5, clearColor: 0x000000, clearAlpha: 1, antialias: false,
    pipeline: undefined, autoQuality: true, quality: 'auto', reducedMotion: undefined,
    powerPreference: 'high-performance',
    lowMaxPixelRatio: 1.25, // cap of maxPixelRatio on 'low' quality (pass a higher value to opt out)
    ...options,
  };
  const quality = o.quality === 'high' || o.quality === 'low' ? o.quality : (isMobileLike() ? 'low' : 'high');
  const maxPR = quality === 'low' ? Math.min(o.maxPixelRatio, o.lowMaxPixelRatio) : o.maxPixelRatio;
  const reducedMotion = o.reducedMotion !== undefined ? !!o.reducedMotion : prefersReducedMotion();

  const canvas = document.createElement('canvas');
  canvas.className = 'npr-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.cssText = 'display:block;width:100%;height:100%';

  const renderer = new THREE.WebGLRenderer({
    canvas, antialias: o.antialias, alpha: o.clearAlpha < 1, depth: false, stencil: false,
    powerPreference: o.powerPreference, premultipliedAlpha: true,
  });
  renderer.setClearColor(o.clearColor, o.clearAlpha);
  const deletes = guardStaleDeletes(renderer.getContext());
  const pipeline = createNPRPipeline(renderer, o.pipeline, { quality });
  container.appendChild(canvas);

  let scene = null, camera = null;
  let width = 0, height = 0;
  const targetPR = () => Math.max(o.minPixelRatio, Math.min(window.devicePixelRatio || 1, maxPR));
  let pixelRatio = targetPR();
  let ceiling = Infinity, ceilingAt = 0, ceilingHold = 15000, liftedAt = -Infinity;
  const resizeCbs = [], updateCbs = [];
  let wanted = false, active = false, lost = false, disposed = false, failed = false;
  let intersecting = true;
  let raf = 0, lastNow = 0, time = 0, warmup = 0;
  let accMs = 0, accN = 0, goodWindows = 0, lastChange = 0;

  const stage = {
    renderer, canvas, pipeline, quality, reducedMotion, frames: 0,
    get width() { return width; },
    get height() { return height; },
    get pixelRatio() { return pixelRatio; },
    get maxPixelRatio() { return maxPR; },
    get running() { return active; },
    get time() { return time; },
    get scene() { return scene; },
    get camera() { return camera; },
    setScene, onResize, onUpdate, start, stop, renderOnce, compile, dispose,
  };

  function emit(type, detail) {
    container.dispatchEvent(new CustomEvent(type, { detail }));
  }

  function fail(err) {
    if (!failed) console.error('[npr] rendering stopped:', err);
    failed = true;
    wanted = false;
    sync();
    emit('npr:error', err);
  }

  function updateCamera() {
    if (camera && camera.isPerspectiveCamera && width > 0 && height > 0) {
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    }
  }

  function applySize(force) {
    const w = container.clientWidth, h = container.clientHeight;
    if (w === 0 || h === 0) return false;
    const prChanged = Math.abs(renderer.getPixelRatio() - pixelRatio) > 1e-3;
    if (!force && w === width && h === height && !prChanged) return false;
    width = w; height = h;
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(w, h, false);
    pipeline.setSize(w, h, pixelRatio);
    updateCamera();
    for (let i = 0; i < resizeCbs.length; i++) resizeCbs[i](w, h);
    return true;
  }

  function setPixelRatio(pr) {
    pixelRatio = pr;
    accMs = 0; accN = 0; goodWindows = 0; warmup = 5;
    applySize(true);
  }

  // Adaptive resolution: drop ~15 % when frames average > 24 ms over 45 frames; recover slowly. A level
  // that proved too slow becomes a ceiling, lifted again after a sustained run of fast frames (the hold
  // doubles each time a lifted level fails again soon). Windows with a long stall (tab switch, shader
  // compile, GC: any frame > 100 ms) are discarded, so a load-time hitch cannot cap quality.
  function adapt(interval, now) {
    if (warmup > 0) { warmup--; return; } // skip shader-compile / resume hitches
    if (interval > 100) { accMs = 0; accN = 0; warmup = 5; return; }
    accMs += interval; accN++;
    if (accN < 45) return;
    const avg = accMs / accN;
    accMs = 0; accN = 0;
    const top = targetPR();
    if (pixelRatio > top + 1e-3) { setPixelRatio(top); return; } // devicePixelRatio decreased (other screen)
    if (avg > 24) {
      goodWindows = 0;
      if (pixelRatio <= o.minPixelRatio + 1e-3) return;
      if (now - liftedAt < 2 * ceilingHold) ceilingHold = Math.min(ceilingHold * 2, 240000);
      ceiling = pixelRatio * 0.97;
      ceilingAt = lastChange = now;
      setPixelRatio(Math.max(o.minPixelRatio, pixelRatio * 0.85));
      return;
    }
    if (avg >= 18) { goodWindows = 0; return; }
    goodWindows++;
    if (ceiling < top && now - ceilingAt > ceilingHold && goodWindows >= 3) { ceiling = Infinity; liftedAt = now; }
    if (pixelRatio < Math.min(top, ceiling) - 1e-3 && now - lastChange > 5000 && goodWindows >= 3) {
      lastChange = now;
      setPixelRatio(Math.min(top, ceiling, pixelRatio * 1.1));
    }
  }

  function draw(dt) {
    for (let i = 0; i < updateCbs.length; i++) updateCbs[i](dt, time);
    pipeline.render(scene, camera, reducedMotion ? 0 : time);
    stage.frames++;
  }

  function frame(now) {
    raf = 0;
    if (!active) return;
    raf = requestAnimationFrame(frame);
    try {
      let dt = 1 / 60;
      if (lastNow) {
        const interval = now - lastNow;
        dt = Math.min(interval / 1000, 0.1);
        if (o.autoQuality) adapt(interval, now);
      }
      lastNow = now;
      time += dt;
      draw(dt);
    } catch (err) {
      fail(err);
    }
  }

  function sync() {
    const should = wanted && !lost && !disposed && !failed && intersecting && !document.hidden && !!scene && !!camera;
    if (should && !active) {
      active = true;
      lastNow = 0; accMs = 0; accN = 0; warmup = 20;
      raf = requestAnimationFrame(frame);
    } else if (!should && active) {
      active = false;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    }
  }

  function setScene(s, c) {
    scene = s; camera = c;
    updateCamera();
    sync();
  }

  function onResize(cb) {
    resizeCbs.push(cb);
    return () => { const i = resizeCbs.indexOf(cb); if (i >= 0) resizeCbs.splice(i, 1); };
  }

  function onUpdate(cb) {
    updateCbs.push(cb);
    return () => { const i = updateCbs.indexOf(cb); if (i >= 0) updateCbs.splice(i, 1); };
  }

  function start() { if (!disposed) { wanted = true; sync(); } }
  function stop() { wanted = false; sync(); }

  // Renders one frame synchronously (update callbacks get dt = 0). Returns false if it could not.
  function renderOnce() {
    if (disposed || lost || failed || !scene || !camera) return false;
    if (width === 0) applySize(true);
    if (width === 0) return false;
    try { draw(0); return true; } catch (err) { fail(err); return false; }
  }

  // Pre-compiles every program the next frame uses without blocking (KHR_parallel_shader_compile when
  // available) and uploads the scene's textures, so the first renderOnce() does not stall.
  function compile() {
    if (disposed || lost || !scene || !camera) return Promise.resolve();
    if (width === 0) applySize(true);
    try {
      return pipeline.compile(scene, camera).then(() => {}, () => {});
    } catch (err) {
      return Promise.resolve(); // the first frame then compiles synchronously instead
    }
  }

  const ro = new ResizeObserver(() => {
    if (disposed || !applySize(false)) return;
    if (!active && stage.frames > 0 && intersecting && !document.hidden) renderOnce();
  });
  ro.observe(container);
  const io = new IntersectionObserver((entries) => {
    intersecting = entries[entries.length - 1].isIntersecting;
    sync();
  });
  io.observe(container);
  const onVisibility = () => sync();
  document.addEventListener('visibilitychange', onVisibility);

  const onLost = (e) => {
    e.preventDefault();
    lost = true;
    deletes.newGeneration();
    sync();
    // Drop three's bookkeeping for the dead context now (GL deletes are no-ops while lost), so a later
    // dispose() does not touch objects of the old context.
    pipeline.releaseGPU();
    if (scene) releaseSceneGPU(scene);
    emit('npr:contextlost');
  };
  const onRestored = () => {
    lost = false;
    applySize(true);
    emit('npr:contextrestored');
    // re-link the programs off the main thread first, then resume (or repaint the still frame)
    compile().then(() => {
      if (disposed || lost) return;
      sync();
      if (!active) renderOnce();
    });
  };
  canvas.addEventListener('webglcontextlost', onLost);
  canvas.addEventListener('webglcontextrestored', onRestored);

  function dispose() {
    if (disposed) return;
    disposed = true;
    sync();
    ro.disconnect();
    io.disconnect();
    document.removeEventListener('visibilitychange', onVisibility);
    canvas.removeEventListener('webglcontextlost', onLost);
    canvas.removeEventListener('webglcontextrestored', onRestored);
    resizeCbs.length = 0;
    updateCbs.length = 0;
    pipeline.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
    canvas.remove();
    scene = null; camera = null;
  }

  applySize(true);
  return stage;
}

/* ------------------------------------------------------------------------------------------------
 * Pointer: smoothed normalised pointer position (-1..1, y up) for parallax.
 * ---------------------------------------------------------------------------------------------- */

export function createPointer(target = window, { smoothing = 3 } = {}) {
  const el = target === window ? null : target;
  const p = {
    x: 0, y: 0, rawX: 0, rawY: 0,
    update(dt) {
      const k = 1 - Math.exp(-dt * smoothing);
      p.x += (p.rawX - p.x) * k;
      p.y += (p.rawY - p.y) * k;
    },
    dispose() {
      target.removeEventListener('pointermove', onMove);
      target.removeEventListener('pointerup', onUp);
      if (el) el.removeEventListener('pointerleave', recenter);
      else document.removeEventListener('pointerout', onOut);
    },
  };
  const clamp = (v) => (v < -1 ? -1 : v > 1 ? 1 : v);
  function onMove(e) {
    let l = 0, t = 0, w = window.innerWidth, h = window.innerHeight;
    if (el) { const r = el.getBoundingClientRect(); l = r.left; t = r.top; w = r.width; h = r.height; }
    if (w <= 0 || h <= 0) return;
    p.rawX = clamp(((e.clientX - l) / w) * 2 - 1);
    p.rawY = clamp(1 - ((e.clientY - t) / h) * 2);
  }
  function recenter() { p.rawX = 0; p.rawY = 0; }
  function onUp(e) { if (e.pointerType === 'touch') recenter(); }
  function onOut(e) { if (!e.relatedTarget) recenter(); }
  target.addEventListener('pointermove', onMove, { passive: true });
  target.addEventListener('pointerup', onUp, { passive: true });
  if (el) el.addEventListener('pointerleave', recenter);
  else document.addEventListener('pointerout', onOut);
  return p;
}
