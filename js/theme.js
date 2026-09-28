// Night mode (warm night). The inline snippet in head.ejs has already set <html data-theme="night|day"> before
// the first paint (stored choice > ?night=1/0 > theme config npr.night_default: auto | day | night). This
// script adds the sun/moon toggle to every page (home #header, the #top bar of posts/pages, incl. the ones
// the AJAX preview inserts later), stores the choice and announces changes:
//   document 'npr:theme' CustomEvent, detail { night: boolean }   (boot.js relays it to the 3D scenes)
// API: window.NPRTheme = { isNight(), set(night), toggle() }
(function () {
    var html = document.documentElement;
    var KEY = 'npr-theme';
    var dark = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
    var buttons = [];

    function stored() {
        try { var v = localStorage.getItem(KEY); return v === 'night' || v === 'day' ? v : null; } catch (e) { return null; }
    }
    function fallback() {
        var d = html.getAttribute('data-theme-default');
        return d === 'night' || (d !== 'day' && dark && dark.matches);
    }
    function isNight() { return html.getAttribute('data-theme') === 'night'; }

    function sync() {
        var night = isNight();
        for (var i = 0; i < buttons.length; i++) {
            buttons[i].setAttribute('aria-pressed', night ? 'true' : 'false');
            buttons[i].title = night ? '切换到白天 / Day mode' : '切换到夜间 / Night mode';
        }
    }
    var animTimer = 0;
    function apply(night, remember) {
        if (remember) { try { localStorage.setItem(KEY, night ? 'night' : 'day'); } catch (e) { /* private mode */ } }
        if (night === isNight()) return;
        // colours crossfade only on a change, never on load
        html.classList.add('npr-theme-anim');
        clearTimeout(animTimer);
        animTimer = setTimeout(function () { html.classList.remove('npr-theme-anim'); }, 700);
        html.setAttribute('data-theme', night ? 'night' : 'day');
        sync();
        document.dispatchEvent(new CustomEvent('npr:theme', { detail: { night: night } }));
    }

    // the choice made in another tab; the OS setting while nothing is stored (npr.night_default: auto)
    window.addEventListener('storage', function (e) {
        if (e.key === KEY) apply(e.newValue === 'night' || (e.newValue !== 'day' && fallback()), false);
    });
    if (dark) {
        var onScheme = function () { if (!stored()) apply(fallback(), false); };
        if (dark.addEventListener) dark.addEventListener('change', onScheme);
        else if (dark.addListener) dark.addListener(onScheme);
    }
    // back/forward cache: another page may have changed the choice meanwhile
    window.addEventListener('pageshow', function (e) {
        var s = stored();
        if (e.persisted && s) apply(s === 'night', false);
    });

    // Button. Its class must not contain any of the substrings diaspora.js's body click handler looks for
    // (icon-home, icon-play, more, cover, comment, ...); the svg ignores pointer events so the target is the button.
    var ICON = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">' +
        '<g class="npr-tt-sun" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">' +
        '<circle cx="12" cy="12" r="4.2" fill="currentColor" stroke="none"/>' +
        '<path d="M12 2.6v2.3M12 19.1v2.3M2.6 12h2.3M19.1 12h2.3M5.35 5.35l1.63 1.63M17.02 17.02l1.63 1.63M5.35 18.65l1.63-1.63M17.02 6.98l1.63-1.63"/></g>' +
        '<path class="npr-tt-moon" fill="currentColor" d="M20.2 14.6A8.4 8.4 0 0 1 9.4 3.8a8.4 8.4 0 1 0 10.8 10.8z"/></svg>';
    function makeButton(where) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'npr-theme-toggle npr-tt-' + where;
        b.setAttribute('aria-label', '夜间模式 / Night mode');
        b.innerHTML = ICON;
        b.addEventListener('click', function () { apply(!isNight(), true); });
        buttons.push(b);
        return b;
    }

    // home header: to the left of the search / menu icons (their colour is set inline by diaspora.js from the
    // cover's swatches or the NPR accent; the toggle follows it)
    function addToHeader(bar) {
        if (bar.querySelector('.npr-theme-toggle')) return;
        var b = makeButton('header');
        if (!bar.querySelector('.icon-search')) b.classList.add('npr-tt-nosearch');
        bar.appendChild(b);
        var icon = bar.querySelector('.icon-menu');
        if (icon && window.MutationObserver) {
            var copy = function () { b.style.color = icon.style.color || ''; };
            copy();
            new MutationObserver(copy).observe(icon, { attributes: true, attributeFilter: ['style'] });
        }
    }
    // #top bar of a post / page: at its right end (the post's QR icon moves left a little)
    function addToTop(top) {
        if (top.querySelector('.npr-theme-toggle')) return;
        top.classList.add('npr-has-toggle');
        top.appendChild(makeButton('top'));
    }
    function scan(root) {
        var header = root.querySelector('#header > div');
        if (header) addToHeader(header);
        var tops = root.querySelectorAll('#top');
        for (var i = 0; i < tops.length; i++) addToTop(tops[i]);
        return !!(header || tops.length);
    }
    function prune() {
        buttons = buttons.filter(function (b) { return b.isConnected; });
    }

    function init() {
        var found = scan(document);
        // Diaspora's AJAX preview replaces #preview's content with the next page's #single (and its #top)
        var preview = document.getElementById('preview');
        if (preview && window.MutationObserver) {
            new MutationObserver(function () { prune(); scan(preview); sync(); }).observe(preview, { childList: true });
        }
        // any other page layout: a small floating button
        if (!found && !preview && document.body) document.body.appendChild(makeButton('float'));
        sync();
    }

    window.NPRTheme = {
        isNight: isNight,
        set: function (night) { apply(!!night, true); },
        toggle: function () { apply(!isNight(), true); }
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
