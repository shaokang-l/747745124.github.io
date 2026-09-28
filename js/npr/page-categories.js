// Categories banner ("the category bookshelf"): every category on the page is a book on an NPR bookcase —
// spine thickness follows the post count, the spine carries the name and a count badge. Hover pulls the
// book out; click follows the category's own link. mountPageScene(container, opts) — see CONTRACT-pages.
import * as THREE from 'three';
import { createStage, createToonMaterial, createPointer, markOutline, seededRandom } from './core.js';
import { C, M, TOON, vcMaterial, hash01, bookWidth, clothColors, spineAtlas, bookGeometry, hullGeometry,
  splitRows, bestRows, buildCase, WIDE } from './page-categories-shelf.js';

const DEG = Math.PI / 180;

// Screen-constant accent outline from an inflated back-face hull (as in the menu room).
const HULL_VERT = /* glsl */`
uniform float uWidth;
uniform float uPx;
void main() {
  vec4 mv = modelViewMatrix * vec4( position, 1.0 );
  vec3 n = normalize( normalMatrix * normal );
  mv.xyz += n * uWidth * uPx * max( - mv.z, 0.1 );
  gl_Position = projectionMatrix * mv;
}`;
const HULL_FRAG = /* glsl */`
uniform vec3 uColor;
void main() { gl_FragColor = vec4( uColor, 1.0 ); }`;

function blobTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.5, 'rgba(255,255,255,0.6)'); r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

function readCategories(root) {
  return [...root.querySelectorAll('.category-list .category-list-item')].map((li) => {
    const a = li.querySelector('a.category-list-link');
    const cnt = li.querySelector('.category-list-count');
    if (!a) return null;
    return { li, a, name: (a.textContent || '').trim() || '?', count: Math.max(1, parseInt(cnt && cnt.textContent, 10) || 1) };
  }).filter(Boolean);
}

// A few thousand world-space vertices of a group (the camera fit frames the real silhouette, not a box).
function silhouette(group) {
  group.updateMatrixWorld(true);
  const out = [], v = new THREE.Vector3();
  group.traverse((o) => {
    if (!o.isMesh) return;
    const P = o.geometry.attributes.position, step = Math.max(1, Math.floor(P.count / 1500));
    for (let i = 0; i < P.count; i += step) { v.fromBufferAttribute(P, i).applyMatrix4(o.matrixWorld); out.push(v.x, v.y, v.z); }
  });
  return new Float32Array(out);
}

export async function mountPageScene(container, { root, quality, reducedMotion, accent = '#f5c46a' } = {}) {
  const stage = createStage(container, {
    clearColor: C.paper,
    quality: quality || 'auto',
    reducedMotion,
    maxPixelRatio: 1.5,
    pipeline: {
      outline: { thickness: 1.6, color: 0x3a2618, opacity: 0.9, colorBleed: 0.3, wobble: 0.5, depthThreshold: 0.03, normalThreshold: 0.32 },
      bloom: { strength: 0.5, radius: 0.7, threshold: 1.0 },
      paper: { strength: 0.12, tint: 0xfff4e2 },
      grade: { exposure: 1.0, saturation: 1.02, tint: 0xfffaf2 },
      vignette: { strength: 0.1, softness: 0.7, color: 0xe6dac5 },
    },
  });
  const still = stage.reducedMotion;
  const low = stage.quality === 'low';
  const renderer = stage.renderer;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.shadowMap.autoUpdate = false;

  const accentCol = new THREE.Color(accent);
  const rand = seededRandom('niflheimr-bookshelf');
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(26, 1, 0.3, 100);
  const disposables = [];

  // --- lights: warm key from the upper left (shadows), cool fill, warm sky / brown ground
  const key = new THREE.DirectionalLight(0xffe2b8, 2.5);
  key.castShadow = true;
  key.shadow.mapSize.set(low ? 1024 : 2048, low ? 1024 : 2048);
  key.shadow.bias = -0.0005;
  key.shadow.normalBias = 0.02;
  const fill = new THREE.DirectionalLight(0xdce6ff, 0.55);
  fill.position.set(6, 2.5, 5);
  const hemi = new THREE.HemisphereLight(0xfff0da, 0x9a7a62, 1.25);
  const lamp = new THREE.PointLight(0xffc878, 1.6, 3.2, 1.6);
  scene.add(key, key.target, fill, hemi, lamp);

  // --- books from the page
  const cats = readCategories(root);
  const cloth = clothColors(cats.length, rand);
  const books = cats.map((c, i) => ({
    ...c, i, cloth: cloth[i],
    w: bookWidth(c.count),
    h: M.bookMaxH * (0.84 + 0.14 * hash01(c.name, 1)),
    d: 0.36 + 0.07 * hash01(c.name, 2),
    jit: hash01(c.name, 3),
    home: new THREE.Vector3(), mesh: null, t: 0, bounce: 0,
  }));
  const atlas = spineAtlas(books, low ? 300 : 420, renderer.capabilities.getMaxAnisotropy());
  disposables.push(atlas.tex);
  const bookMat = vcMaterial({ map: atlas.tex, rimColor: accentCol, rimPower: 2.5 });
  const frameMat = vcMaterial();
  const glowMat = createToonMaterial({ color: 0xffe6b0, emissive: 0xffc46a, emissiveIntensity: 3.2, ...TOON });
  disposables.push(bookMat, frameMat, glowMat);
  const shelfRoot = new THREE.Group();
  scene.add(shelfRoot);
  for (const b of books) {
    b.mesh = new THREE.Mesh(bookGeometry(b, atlas.uv[b.i], atlas.white), bookMat);
    b.mesh.castShadow = b.mesh.receiveShadow = true;
    b.mesh.userData.book = b;
    markOutline(b.mesh);
    shelfRoot.add(b.mesh);
    disposables.push(b.mesh.geometry);
  }

  // highlight hull, parented to the active book
  const hullMat = new THREE.ShaderMaterial({
    vertexShader: HULL_VERT, fragmentShader: HULL_FRAG, side: THREE.BackSide,
    uniforms: { uWidth: { value: 0 }, uPx: { value: 0.001 }, uColor: { value: accentCol.clone().multiplyScalar(0.95) } },
  });
  const hull = new THREE.Mesh(hullGeometry(), hullMat);
  hull.raycast = () => {};
  hull.visible = false;
  disposables.push(hullMat, hull.geometry);

  // soft contact shadow on the paper
  const blob = blobTexture();
  disposables.push(blob);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({
    map: blob, color: 0x8a7258, transparent: true, opacity: 0.45, depthWrite: false,
  }));
  ground.rotation.x = -Math.PI / 2;
  ground.renderOrder = -1;
  scene.add(ground);
  disposables.push(ground.geometry, ground.material);

  // --- bookcase for the current row count (rebuilt when the band's aspect asks for another layout)
  let shelf = null, rows = 0, wide = false, fitPts = null;
  const center = new THREE.Vector3();
  function layout(aspect) {
    const r = books.length ? bestRows(books, aspect) : 1;
    const w = aspect > WIDE.aspect;
    if (shelf && r === rows && w === wide) return false;
    if (shelf) {
      shelfRoot.remove(shelf.group);
      shelf.group.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });
    }
    rows = r; wide = w;
    const rowsOf = books.length ? splitRows(books, r) : [{ books: [], width: 0 }];
    shelf = buildCase(rowsOf, seededRandom('shelf-decor'), { frame: frameMat, glow: glowMat }, wide);
    shelfRoot.add(shelf.group);
    shelf.bounds.getCenter(center);
    fitPts = silhouette(shelf.group);
    ground.scale.set(shelf.bounds.max.x - shelf.bounds.min.x + 1.2, shelf.D * 3.2, 1);
    ground.position.x = center.x;
    ground.position.y = -0.055; ground.position.z = 0.1;
    lamp.position.copy(shelf.bulb.position).add(new THREE.Vector3(0, -0.05, 0.1));
    // shadow camera around the bookcase
    const s = Math.max(shelf.W, shelf.H) * 0.62;
    key.position.set(center.x - 4.5, center.y + 5.5, 8);
    key.target.position.copy(center);
    Object.assign(key.shadow.camera, { left: -s, right: s, top: s, bottom: -s, near: 1, far: 30 });
    key.shadow.camera.updateProjectionMatrix();
    for (const b of books) b.mesh.position.copy(b.home);
    renderer.shadowMap.needsUpdate = true;
    return true;
  }

  // --- camera: fit the bookcase bounds into the band (slight 3/4 view from the right, a bit above)
  const view = { dist: 10, target: new THREE.Vector3() };
  const tmp = new THREE.Vector3(), right = new THREE.Vector3(), up = new THREE.Vector3();
  const portrait = () => stage.width < stage.height * 1.1;
  function place(az, el) {
    const ce = Math.cos(el);
    camera.position.set(Math.sin(az) * ce, Math.sin(el), Math.cos(az) * ce).multiplyScalar(view.dist).add(view.target);
    camera.lookAt(view.target);
    camera.updateMatrixWorld();
  }
  function fit() {
    const w = stage.width || 1, h = stage.height || 1;
    camera.aspect = w / h;
    camera.fov = portrait() ? 30 : 24;
    camera.updateProjectionMatrix();
    // leave room for the hover label above the top and for parallax at the sides
    const mx = portrait() ? 0.86 : 0.78, my = portrait() ? 0.8 : 0.84;
    view.target.copy(center);
    view.dist = 12;
    for (let it = 0; it < 10; it++) {
      place(BASE_AZ, BASE_EL);
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (let i = 0; i < fitPts.length; i += 3) {
        tmp.fromArray(fitPts, i).project(camera);
        if (tmp.x < x0) x0 = tmp.x; if (tmp.x > x1) x1 = tmp.x;
        if (tmp.y < y0) y0 = tmp.y; if (tmp.y > y1) y1 = tmp.y;
      }
      const halfH = view.dist * Math.tan(camera.fov * DEG / 2), halfW = halfH * camera.aspect;
      right.setFromMatrixColumn(camera.matrixWorld, 0);
      up.setFromMatrixColumn(camera.matrixWorld, 1);
      view.target.addScaledVector(right, ((x0 + x1) / 2) * halfW).addScaledVector(up, ((y0 + y1) / 2 - 0.05) * halfH);
      view.dist *= Math.max((x1 - x0) / 2 / mx, (y1 - y0) / 2 / my);
    }
    hullMat.uniforms.uPx.value = (2 * Math.tan(camera.fov * DEG / 2)) / h;
  }
  const BASE_AZ = 9 * DEG, BASE_EL = 5 * DEG;

  function onSize(w, h) {
    if (!w || !h) return;
    layout(w / h);
    fit();
    stillRender();
  }

  // --- DOM: hover label, list <-> book sync
  const label = document.createElement('div');
  label.className = 'npr-cat-label';
  const labelName = document.createElement('b');
  const labelCount = document.createElement('span');
  label.append(labelName, labelCount);
  container.appendChild(label);

  let pointerIdx = null, listIdx = null, active = null, pointerType = 'mouse';
  const listeners = [];
  const on = (el, type, fn, opt) => { el.addEventListener(type, fn, opt); listeners.push([el, type, fn, opt]); };
  books.forEach((b) => {
    b.li.style.setProperty('--npr-book', '#' + b.cloth.toString(16).padStart(6, '0'));
    const enter = () => { listIdx = b.i; refresh(); };
    const leave = () => { if (listIdx === b.i) { listIdx = null; refresh(); } };
    on(b.a, 'mouseenter', enter);
    on(b.a, 'focus', enter);
    on(b.a, 'mouseleave', leave);
    on(b.a, 'blur', leave);
  });
  root.classList.add('npr-bookshelf-on');

  function refresh() {
    const next = pointerIdx !== null ? pointerIdx : listIdx;
    if (next === active) return;
    if (active !== null) books[active].li.classList.remove('npr-book-hot');
    active = next;
    if (active !== null) {
      const b = books[active];
      b.li.classList.add('npr-book-hot');
      hull.scale.set(b.w, b.h, b.d);
      b.mesh.add(hull);
      labelName.textContent = b.name;
      labelCount.textContent = b.count + (b.count === 1 ? ' post' : ' posts');
    } else if (hull.parent) {
      hull.parent.remove(hull);
    }
    label.classList.toggle('npr-on', active !== null);
    stage.canvas.style.cursor = pointerIdx !== null ? 'pointer' : '';
    stillRender();
  }

  // --- picking
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const meshes = books.map((b) => b.mesh);
  function pick(e) {
    const r = stage.canvas.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, 1 - ((e.clientY - r.top) / r.height) * 2);
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObjects(meshes, false)[0];
    return hit ? hit.object.userData.book.i : null;
  }
  const guard = (fn) => (e) => { try { fn(e); } catch (err) { /* never throw out of a handler */ } };
  on(stage.canvas, 'pointerdown', guard((e) => { pointerType = e.pointerType; }), { passive: true });
  on(stage.canvas, 'pointermove', guard((e) => {
    if (e.pointerType === 'touch') return;
    const i = pick(e);
    if (i !== pointerIdx) { pointerIdx = i; refresh(); }
  }), { passive: true });
  on(stage.canvas, 'pointerleave', guard(() => { if (pointerIdx !== null) { pointerIdx = null; refresh(); } }));
  on(stage.canvas, 'click', guard((e) => {
    const i = pick(e);
    if (i === null) { if (pointerType === 'touch' && pointerIdx !== null) { pointerIdx = null; refresh(); } return; }
    // touch: the first tap pulls the book out and shows its label, the second one opens it
    if (pointerType === 'touch' && pointerIdx !== i) { pointerIdx = i; refresh(); return; }
    books[i].a.click(); // synchronous, real navigation
    books[i].bounce = 1;
  }));

  // --- animation
  const pointer = createPointer(container);
  const lpos = new THREE.Vector3();
  let wasMoving = false;
  function update(dt, t) {
    pointer.update(dt);
    let moving = false;
    for (const b of books) {
      const target = b.i === active ? 1 : 0;
      if (still || dt === 0) b.t = target;
      else b.t += (target - b.t) * (1 - Math.exp(-dt * 12));
      if (Math.abs(b.t - target) < 1e-3) b.t = target;
      b.bounce = still ? 0 : Math.max(0, b.bounce - dt * 2.5);
      const e = b.t;
      // pulled out toward the viewer, lifted clear of the row and tipped forward
      const tilt = e * 0.13;
      b.mesh.position.set(b.home.x, b.home.y + Math.sin(tilt) * b.d * 0.5 + e * b.h * 0.055, b.home.z + e * 0.4);
      b.mesh.rotation.x = tilt;
      b.mesh.scale.y = 1 - Math.sin(b.bounce * Math.PI) * 0.06;
      if (b.t > 0 && b.t < 1) moving = true;
    }
    if (moving || wasMoving) renderer.shadowMap.needsUpdate = true; // books cast shadows while they slide
    wasMoving = moving;
    hullMat.uniforms.uWidth.value = active !== null ? 4 * books[active].t : 0;
    hull.visible = active !== null;

    // idle: plants sway, lamp breathes, camera parallax
    const calm = still ? 0 : 1;
    const sway = shelf.anims;
    for (let i = 0; i < sway.length; i++) sway[i].rotation.z = Math.sin(t * 0.8 + i * 1.7) * 0.035 * calm;
    glowMat.emissiveIntensity = 3.2 + Math.sin(t * 1.3) * 0.25 * calm;
    place(BASE_AZ + pointer.x * 3 * DEG * calm, BASE_EL + pointer.y * 1.5 * DEG * calm);

    // label above the active book
    if (active !== null) {
      const b = books[active];
      lpos.set(0, b.h, 0);
      b.mesh.localToWorld(lpos).project(camera);
      label.style.transform = `translate(${((lpos.x + 1) / 2) * stage.width}px, ${((1 - lpos.y) / 2) * stage.height}px) translate(-50%, calc(-100% - 10px))`;
    }
  }
  stage.onUpdate(update);

  function stillRender() {
    if (!stage.running && stage.frames > 0) { renderer.shadowMap.needsUpdate = true; stage.renderOnce(); }
  }

  stage.setScene(scene, camera);
  layout((stage.width || 16) / (stage.height || 9));
  fit();
  stage.onResize(onSize);
  await stage.compile();
  renderer.shadowMap.needsUpdate = true;
  stage.renderOnce();

  let disposed = false;
  return {
    stage,
    start() { if (disposed) return; if (still) stillRender(); else stage.start(); },
    stop() { stage.stop(); },
    dispose() {
      if (disposed) return;
      disposed = true;
      stage.stop();
      for (const [el, type, fn, opt] of listeners) el.removeEventListener(type, fn, opt);
      listeners.length = 0;
      pointer.dispose();
      for (const b of books) { b.li.classList.remove('npr-book-hot'); b.li.style.removeProperty('--npr-book'); }
      root.classList.remove('npr-bookshelf-on');
      label.remove();
      if (shelf) shelf.group.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });
      for (const d of disposables) d.dispose();
      if (key.shadow.map) key.shadow.map.dispose();
      stage.dispose();
    },
  };
}
