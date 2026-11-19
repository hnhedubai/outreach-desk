// Vitalise browser-compatibility gate.
//
// This is intentionally written in ES5 and loaded as a CLASSIC script (not a
// module) so it runs even in browsers that cannot parse the module app below it.
// It does two things:
//   1. Feature-gate: if a hard requirement is missing, render a friendly
//      "update your browser" notice instead of leaving a blank/broken screen.
//   2. Watchdog: if the module app never marks itself booted (e.g. the module
//      failed to download or threw at parse time), surface a helpful retry
//      message rather than an endless "Opening Vitalise…" placeholder.
//
// Target support level is the last two versions of Chrome, Edge, Firefox and
// Safari on desktop; everything those support also passes this gate, so in
// practice the notice only appears for genuinely outdated browsers.
(function () {
  'use strict';

  var app = document.getElementById('app');
  var LOADING = 'Opening Vitalise';

  function detect() {
    var d = document.createElement('dialog');
    return {
      modules: ('noModule' in HTMLScriptElement.prototype),
      dialog: (typeof d.showModal === 'function'),
      arrayAt: (typeof [].at === 'function')
    };
  }

  var caps = detect();
  var ok = caps.modules && caps.dialog && caps.arrayAt;
  window.__compat = { ok: ok, caps: caps };

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function notice(title, bodyHtml) {
    if (!app) return;
    app.innerHTML =
      '<div class="compat-notice" role="alert">' +
        '<h1>' + esc(title) + '</h1>' +
        '<p>' + bodyHtml + '</p>' +
        '<p class="compat-browsers">Vitalise works best in the current ' +
          '<strong>Chrome</strong>, <strong>Edge</strong>, <strong>Firefox</strong> ' +
          'or <strong>Safari</strong>.</p>' +
      '</div>';
  }

  if (!ok) {
    var missing = [];
    if (!caps.modules) missing.push('modern JavaScript modules');
    if (!caps.dialog) missing.push('dialog windows');
    if (!caps.arrayAt) missing.push('a recent JavaScript engine');
    notice(
      'Please update your browser',
      'Your browser is missing ' + esc(missing.join(', ')) +
      ' that Vitalise needs. Please switch to a current browser to continue.'
    );
    return;
  }

  // Watchdog: only fires while the original placeholder is still showing and
  // the app has not reported booting. Real boot (login page or first render)
  // replaces the placeholder text, so this never false-positives on a slow
  // network once the app has actually started.
  var waited = 0;
  var timer = setInterval(function () {
    if (window.__vitaliseBooted) { clearInterval(timer); return; }
    var stillLoading = app && app.textContent && app.textContent.indexOf(LOADING) !== -1;
    if (!stillLoading) { clearInterval(timer); return; }
    waited += 500;
    if (waited >= 10000) {
      clearInterval(timer);
      notice(
        'Vitalise could not start',
        'The app did not load. This can happen on a slow connection or after a ' +
        'temporary error. <button type="button" class="btn primary" id="compat-reload">Reload</button>'
      );
      var r = document.getElementById('compat-reload');
      if (r) r.addEventListener('click', function () { location.reload(); });
    }
  }, 500);
})();
