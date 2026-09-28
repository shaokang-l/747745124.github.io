/*
 * Lazy MathJax 3 loader for the Diaspora theme.
 * MathJax (vendored under js/mathjax/) is only downloaded when the article
 * actually contains TeX, and only the given element is typeset.
 * Usage: DiasporaMath.typeset(element)  (called on load and after AJAX previews)
 */
(function (window, document) {
    var cfgEl = document.getElementById('mathjax-config');
    if (!cfgEl) return;
    var src = cfgEl.getAttribute('data-src');
    var SKIP = /^(script|noscript|style|textarea|pre|code)$/i;
    var IGNORE = /(^|\s)(tex2jax_ignore|dno)(\s|$)/;
    // $...$, $$...$$, \(...\), \[...\], \begin{...}
    var HAS_TEX = /\$[^$]+\$|\\\(|\\\[|\\begin\{[a-zA-Z*]+\}/;
    var state = 0; // 0 = not loaded, 1 = loading, 2 = ready
    var pending = [];
    var typeset = [];

    function text(el) {
        var out = '';
        for (var n = el.firstChild; n; n = n.nextSibling) {
            if (n.nodeType === 3) {
                out += n.nodeValue;
            } else if (n.nodeType === 1 && !SKIP.test(n.nodeName) && !IGNORE.test(n.className || '')) {
                out += ' ' + text(n);
            }
        }
        return out;
    }

    function hasMath(el) {
        return HAS_TEX.test(text(el));
    }

    function attached(el) {
        return document.documentElement.contains(el);
    }

    function run(el) {
        var MJ = window.MathJax;
        MJ.startup.promise = MJ.startup.promise.then(function () {
            // forget math from previews that have been replaced
            var gone = [], keep = [];
            for (var i = 0; i < typeset.length; i++) {
                (attached(typeset[i]) ? keep : gone).push(typeset[i]);
            }
            if (gone.length) MJ.typesetClear(gone);
            typeset = keep;
            if (!attached(el)) return;
            typeset.push(el);
            return MJ.typesetPromise([el]);
        }).catch(function (err) {
            window.console && console.warn('MathJax typeset failed', err);
        });
    }

    function load() {
        state = 1;
        window.MathJax = {
            tex: {
                inlineMath: [['$', '$'], ['\\(', '\\)']],
                displayMath: [['$$', '$$'], ['\\[', '\\]']],
                processEscapes: true,
                macros: { href: '{}' },
                noundefined: { color: 'red', background: '#FFEEEE', size: '90%' }
            },
            options: {
                skipHtmlTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code'],
                ignoreHtmlClass: 'tex2jax_ignore|dno'
            },
            startup: {
                typeset: false,
                ready: function () {
                    window.MathJax.startup.defaultReady();
                    state = 2;
                    var list = pending;
                    pending = [];
                    for (var i = 0; i < list.length; i++) run(list[i]);
                }
            }
        };
        var s = document.createElement('script');
        s.src = src;
        s.async = true;
        s.onerror = function () {
            state = 0;
            window.MathJax = undefined;
        };
        document.getElementsByTagName('head')[0].appendChild(s);
    }

    window.DiasporaMath = {
        typeset: function (el) {
            if (!el || !hasMath(el)) return;
            if (state === 2) return run(el);
            pending.push(el);
            if (state === 0) load();
        }
    };

    function init() {
        window.DiasporaMath.typeset(document.getElementById('single'));
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})(window, document);
