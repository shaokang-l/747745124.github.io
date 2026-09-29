/*
 * Translated posts (scripts/i18n-posts.js). When a visitor uses a language chip or switch, their language is remembered
 * (localStorage 'npr-lang') and home list cards / the hero ([data-i18n]) show that translation's title, date, summary
 * and link. Without a stored choice (or without storage) the server-rendered preferred translation stays.
 */
(function () {
    var KEY = 'npr-lang';

    function getPref() {
        try { return localStorage.getItem(KEY) || ''; } catch (e) { return ''; }
    }
    function setPref(v) {
        try { localStorage.setItem(KEY, v); } catch (e) {}
    }
    function lower(c) {
        return String(c || '').toLowerCase();
    }
    function pick(list, pref) {
        var p = lower(pref), i;
        for (i = 0; i < list.length; i++) if (lower(list[i].lang) === p) return list[i];
        for (i = 0; i < list.length; i++) if (lower(list[i].lang).split('-')[0] === p.split('-')[0]) return list[i];
        return null;
    }
    function each(nodes, fn) {
        for (var i = 0; i < nodes.length; i++) fn(nodes[i]);
    }

    function show(el, t) {
        // title link (and the cover link when list_thumbnail is on)
        each(el.querySelectorAll('a.posttitle, a > img.cover'), function (n) {
            var a = n.nodeName == 'A' ? n : n.parentNode;
            a.setAttribute('href', t.url);
            a.setAttribute('title', t.title);
            if (n.nodeName == 'A') n.textContent = t.title;
        });
        var f = el.querySelector('[data-i18n-field="date"]');
        if (f && t.date) f.textContent = t.date;
        f = el.querySelector('[data-i18n-field="summary"]');
        if (f && t.summary != null) f.textContent = t.summary;
        each(el.querySelectorAll('a.i18n-chip'), function (a) {
            var on = lower(a.getAttribute('hreflang')) === lower(t.lang);
            a.className = a.className.replace(/\s*\bis-shown\b/g, '') + (on ? ' is-shown' : '');
        });
        el.setAttribute('data-i18n-shown', t.lang);
    }

    function apply(root) {
        var pref = getPref();
        if (!pref || !root || !root.querySelectorAll) return;
        each(root.querySelectorAll('[data-i18n]'), function (el) {
            var list;
            try { list = JSON.parse(el.getAttribute('data-i18n')); } catch (e) { return; }
            var t = list && list.length ? pick(list, pref) : null;
            if (t && el.getAttribute('data-i18n-shown') !== t.lang) show(el, t);
        });
    }

    // remember the choice before diaspora.js handles the click (it stops propagation)
    document.addEventListener('click', function (e) {
        var a = e.target;
        while (a && a.nodeName != 'A') a = a.parentNode;
        if (!a || !/\bi18n-link\b/.test(a.className || '') || !a.getAttribute('hreflang')) return;
        setPref(a.getAttribute('hreflang'));
        apply(document);
    }, true);

    function init() {
        apply(document);
        // "Click for more" appends the next page's cards
        var primary = document.getElementById('primary');
        if (primary && window.MutationObserver) {
            new MutationObserver(function () { apply(primary); }).observe(primary, { childList: true });
        }
    }
    if (document.readyState == 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();

    window.NprI18n = { get: getPref, set: setPref, apply: apply };
})();
