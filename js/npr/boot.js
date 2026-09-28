// NPR boot: mounts the three.js forest behind the home cover (#npr-hero, forest.js), the 3D menu room
// (.nav > .npr-room, room.js) and the sub-page banners (config.pages, page-*.js). Any failure logs one
// warning and leaves the original Diaspora page in place. Debug switches: ?npr=0 disables everything,
// ?npr=low forces low quality.
const html = document.documentElement;
const MENU_SLIDE_MS = 300;   // .nav slide-out transition in diaspora.css
const HERO_REVEAL_MS = 6000; // show the painting meanwhile if the forest is this slow to appear
const ENTER_GIVE_UP_MS = 12000; // "enter the forest": restore the hero if the post never arrives
const ENTER_MAX_MS = 3000;      // ...and never hold a loaded post longer than this (flight stalled / scene lost)

const warned = new Set();
function warn(area, err) {
  if (warned.has(area)) return;
  warned.add(area);
  console.warn('[npr] ' + area + ' unavailable, keeping the original theme:', err);
}

function readConfig() {
  const el = document.getElementById('npr-config');
  if (!el) return null;
  try { return JSON.parse(el.textContent); } catch (e) { warn('config', e); return null; }
}

const whenIdle = (fn) => ('requestIdleCallback' in window ? requestIdleCallback(fn, { timeout: 3000 }) : setTimeout(fn, 800));
const domReady = () => (document.readyState === 'loading'
  ? new Promise((resolve) => document.addEventListener('DOMContentLoaded', resolve, { once: true }))
  : Promise.resolve());
const menuOpen = () => document.body.classList.contains('mu');

function createHero(el, opts) {
  let api = null, dead = false;
  html.classList.add('npr-hero-pending'); // hides the painting while the forest loads (npr.css)
  const reveal = setTimeout(() => html.classList.remove('npr-hero-pending'), HERO_REVEAL_MS);

  const fail = (err) => {
    dead = true;
    html.classList.remove('npr-hero-on', 'npr-hero-pending');
    if (err) warn('hero', err);
    if (api) try { api.dispose(); } catch (e) { /* already gone */ }
    api = null;
  };
  // core dispatches npr:error (non-bubbling) on the stage container; capture also sees nested containers
  el.addEventListener('npr:error', () => fail(), true);

  const ready = import('./forest.js')
    .then(async ({ mountForest }) => {
      await domReady(); // diaspora.js sizes #mark and binds the npr:hero listener on DOM ready
      api = await mountForest(el, opts);
      if (dead) return fail();
      html.classList.add('npr-hero-on');
      document.dispatchEvent(new CustomEvent('npr:hero'));
      // Diaspora lifts its loading state 1 s after the painting loads; the forest does not need to wait
      setTimeout(() => { html.classList.remove('loading'); document.body.classList.remove('loading'); }, 400);
      sync(menuOpen());
    })
    .catch(fail)
    .finally(() => { clearTimeout(reveal); html.classList.remove('npr-hero-pending'); });

  function sync(open) {
    if (!api || dead) return;
    try { if (open) api.stop(); else api.start(); } catch (e) { fail(e); }
  }
  return { ready, sync, api: () => (dead ? null : api) };
}

// "Enter the forest": clicking the latest post's title in the hero flies the camera into the golden light
// (forest.js enter()) while Diaspora loads the post; the post then fades in out of the white instead of
// sliding in. Diaspora.HS() does the loading / pushState as usual; only its final Diaspora.preview() call
// is held until the flight has ended. Back (popstate) shows #container again: the hero, reset meanwhile,
// fades in from the white. Reduced motion, modifier clicks or no AJAX preview: the normal behaviour.
function setupEnter(hero, reducedMotion) {
  if (reducedMotion) return;
  const TITLE = '#post0 a.posttitle';
  let busy = false;

  document.addEventListener('click', (e) => {
    const a = e.target && e.target.closest ? e.target.closest(TITLE) : null;
    if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (busy) { e.preventDefault(); e.stopPropagation(); return; }
    const api = hero.api();
    const D = window.Diaspora, $ = window.jQuery;
    const preview = document.getElementById('preview');
    if (!api || !api.enter || !D || !$ || !preview || !(window.history && history.pushState) || menuOpen()
      || !html.classList.contains('npr-hero-on')) return;
    // take the click away from Diaspora's delegated body handler (it would open the post right away)
    e.preventDefault();
    e.stopPropagation();
    busy = true;

    const origPreview = D.preview;
    let revealed = false, giveUp = 0;
    const settle = () => {
      busy = false;
      html.classList.remove('npr-enter-hold');
      api.resetEnter().then(() => html.classList.remove('npr-entering'));
    };
    const flight = Promise.race([api.enter(), new Promise((r) => setTimeout(r, ENTER_MAX_MS))]);
    html.classList.add('npr-entering');
    flight.then(() => { if (!revealed) html.classList.add('npr-enter-hold'); }); // slow load: show the loader

    D.preview = function () {
      D.preview = origPreview;
      clearTimeout(giveUp);
      const args = arguments;
      flight.then(() => {
        revealed = true;
        html.classList.remove('npr-enter-hold');
        // a fade instead of the slide: #preview starts in place, transparent (npr.css)
        preview.classList.add('npr-enter-fade');
        void preview.offsetWidth;
        let ended = false;
        const onEnd = (ev) => {
          if (ended || (ev && ev.target !== preview)) return;
          ended = true;
          preview.removeEventListener('transitionend', onEnd);
          // after Diaspora's own transitionend handler has hidden #container
          setTimeout(() => { preview.classList.remove('npr-enter-fade'); settle(); }, 0);
        };
        preview.addEventListener('transitionend', onEnd);
        setTimeout(onEnd, 1000); // (in case the fade never reports its end)
        origPreview.apply(D, args);
      });
    };
    giveUp = setTimeout(() => { if (D.preview !== origPreview) { D.preview = origPreview; D.loaded(); settle(); } }, ENTER_GIVE_UP_MS);
    try { D.HS($(a), 'push'); } catch (err) { D.preview = origPreview; clearTimeout(giveUp); settle(); warn('enter', err); }
  }, true);
}

function createRoom(el, opts) {
  const items = Array.prototype.map.call(el.parentNode.querySelectorAll('#menu-menu > li'), (li) => {
    const a = li.querySelector('a');
    return { name: a ? a.textContent.trim() : '', href: a ? a.getAttribute('href') : '', object: li.getAttribute('data-npr-object') || 'crate', el: li };
  });
  if (!items.length) return null;
  let modP = null, mountP = null, api = null, dead = false, stopTimer = 0;

  const fail = (err) => {
    dead = true;
    html.classList.remove('npr-room-on');
    if (err) warn('menu room', err);
    if (api) try { api.dispose(); } catch (e) { /* already gone */ }
    api = null;
  };
  el.addEventListener('npr:error', () => fail(), true);

  const load = () => modP || (modP = import('./room.js'));
  const onSelect = (i) => {
    const a = items[i] && items[i].el.querySelector('a');
    if (a) a.click(); // Diaspora's delegated body handler opens the AJAX preview and closes the menu
  };
  const mount = () => mountP || (mountP = load()
    .then(({ mountRoom }) => mountRoom(el, { items, onSelect, onHover() {}, ...opts }))
    .then((r) => {
      api = r;
      if (dead) return fail();
      html.classList.add('npr-room-on');
      sync(menuOpen());
    })
    .catch(fail));

  // label hover / keyboard focus highlights the matching object
  items.forEach((it, i) => {
    const on = () => { if (api) api.focus(i); };
    const off = () => { if (api) api.focus(null); };
    it.el.addEventListener('mouseenter', on);
    it.el.addEventListener('mouseleave', off);
    it.el.addEventListener('focusin', on);
    it.el.addEventListener('focusout', off);
  });

  function sync(open, intro = true) {
    clearTimeout(stopTimer);
    if (dead) return;
    if (!api) { if (open) mount(); return; }
    try {
      if (open) { api.start(); if (intro) api.playIntro(); }
      else stopTimer = setTimeout(() => { if (api) api.stop(); }, MENU_SLIDE_MS);
    } catch (e) { fail(e); }
  }
  // mount ahead of time (hidden, not running) so the first open shows the room instead of the text menu
  const warm = () => { if (!dead) mount(); };
  return { sync, warm };
}

// Sub-page vignettes: config.pages maps a page path to a scene key (module ./page-<key>.js, styles
// css/npr-page-<key>.css). A page arrives either as a full load (#single in the document) or through
// Diaspora's AJAX preview (#single inserted into #preview); the banner goes on top of #single .section.
function loadCSS(file) {
  const href = new URL('../../css/' + file, import.meta.url).href;
  if (!document.querySelector('link[href="' + href + '"]')) {
    const l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = href;
    document.head.appendChild(l);
  }
}

function createPages(pages, opts) {
  let cur = null; // { single, container, api, dead }
  const keyFor = (path) => {
    let p = decodeURI(path).replace(/index\.html$/, '');
    if (!p.endsWith('/')) p += '/';
    const key = pages[p];
    return typeof key === 'string' && /^[a-z][a-z0-9-]*$/.test(key) ? key : null;
  };
  const drop = () => {
    if (!cur) return;
    cur.dead = true;
    cur.single.classList.remove('npr-page-on');
    if (cur.api) try { cur.api.dispose(); } catch (e) { /* already gone */ }
    cur.container.remove();
    cur = null;
  };
  function check() {
    const preview = document.getElementById('preview');
    const single = preview ? preview.querySelector('#single') : document.getElementById('single');
    if (cur && cur.single === single) return;
    drop();
    const key = single && keyFor(location.pathname);
    const section = key && single.querySelector('.section');
    if (!section) return;
    const container = document.createElement('div');
    container.className = 'npr-page-scene npr-page-' + key;
    container.setAttribute('aria-hidden', 'true');
    section.insertBefore(container, section.firstChild);
    single.classList.add('npr-page-on');
    const me = cur = { single, container, api: null, dead: false };
    loadCSS('npr-pages.css');
    loadCSS('npr-page-' + key + '.css');
    import('./page-' + key + '.js')
      .then((m) => m.mountPageScene(container, { root: single, ...opts }))
      .then((api) => {
        if (me.dead) { api.dispose(); return; }
        me.api = api;
        container.classList.add('npr-ready');
        api.start();
      })
      .catch((err) => { warn('page scene ' + key, err); if (cur === me) drop(); });
  }
  return { check };
}

async function main() {
  const cfg = readConfig();
  const flag = new URLSearchParams(location.search).get('npr');
  if (!cfg || flag === '0') return;
  const heroEl = cfg.hero ? document.getElementById('npr-hero') : null;
  const roomEl = cfg.menu_room ? document.querySelector('.nav > .npr-room') : null;
  const pages = cfg.pages && Object.keys(cfg.pages).length ? cfg.pages : null;
  const pageHost = document.getElementById('preview') || document.getElementById('single');
  if (!heroEl && !roomEl && !(pages && pageHost)) return;

  let core;
  try { core = await import('./core.js'); } catch (e) { return warn('3D scenes', e); }
  if (!core.isWebGLAvailable()) return;
  const mobile = core.isMobileLike();
  if (mobile && !cfg.mobile) return;
  const opts = { quality: flag === 'low' || mobile ? 'low' : 'high', reducedMotion: core.prefersReducedMotion(), accent: cfg.accent };

  const hero = heroEl ? createHero(heroEl, opts) : null;
  if (hero) setupEnter(hero, opts.reducedMotion);
  const room = roomEl ? createRoom(roomEl, opts) : null;

  await domReady();
  if (pages && pageHost) {
    const pm = createPages(pages, opts);
    pm.check();
    const preview = document.getElementById('preview');
    if (preview) new MutationObserver(pm.check).observe(preview, { childList: true });
  }

  // pause the forest while the menu covers it; run the room only while the menu is open
  let open = menuOpen();
  new MutationObserver(() => {
    if (menuOpen() === open) return;
    open = !open;
    if (hero) hero.sync(open);
    if (room) room.sync(open);
  }).observe(document.body, { attributes: true, attributeFilter: ['class'] });

  // restored from the back/forward cache: re-apply the current menu state
  window.addEventListener('pageshow', (e) => {
    if (!e.persisted) return;
    open = menuOpen();
    if (hero) hero.sync(open);
    if (room) room.sync(open, false);
  });

  if (room) {
    const menuIcon = document.querySelector('.switchmenu');
    if (menuIcon) ['pointerenter', 'touchstart', 'focus'].forEach((t) => menuIcon.addEventListener(t, room.warm, { once: true, passive: true }));
    if (hero) hero.ready.then(() => whenIdle(room.warm));
    else whenIdle(room.warm);
  }
}

main().catch((e) => warn('3D scenes', e));
