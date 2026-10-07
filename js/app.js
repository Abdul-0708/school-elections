/* Boot + hash router.
   Routes
     #/                    landing page
     #/vote  · #/vote/demo voting station (live / demo)
     #/results[/demo|/id]  live results & projector screen
     #/admin[/page]        administration (sign-in required)
     #/admin/setup         first-run setup wizard */
(function (S) {
  'use strict';
  const U = S.util, UI = S.ui, html = U.html;
  S.views = S.views || {};
  S.state = { api: null, pub: null };

  const ROUTES = [
    { re: /^\/?$/, view: 'landing' },
    { re: /^\/vote(?:\/(demo))?\/?$/, view: 'station' },
    { re: /^\/results(?:\/(demo|[0-9a-f-]{36}))?\/?$/, view: 'results' },
    { re: /^\/admin(?:\/([a-z-]+))?\/?$/, view: 'admin' },
  ];

  let current = { hash: null, view: null, cleanup: null };
  const app = () => document.getElementById('app');

  S.go = (path) => { if (location.hash !== '#' + path) location.hash = '#' + path; else render(); };

  async function render() {
    const hash = location.hash || '#/';
    if (hash === current.hash) return;
    if (current.view && current.view.canLeave && !current.view.canLeave()) {
      history.replaceState(null, '', current.hash);
      return;
    }
    const path = hash.replace(/^#/, '').split('?')[0];
    const route = ROUTES.find((r) => r.re.test(path)) || ROUTES[0];
    const params = (path.match(route.re) || []).slice(1);
    if (current.cleanup) try { current.cleanup(); } catch (e) { console.error(e); }
    document.body.className = '';
    // Every screen gets its own container: late async renders from a screen we already left
    // land in a detached node instead of painting over the new screen.
    const root = document.createElement('div');
    app().replaceChildren(root);
    const view = S.views[route.view];
    const mine = (current = { hash, view, cleanup: null });
    let cleanup = null;
    try {
      cleanup = (await view.mount(root, params)) || null;
    } catch (e) {
      console.error(e);
      if (current === mine) {
        U.setHtml(root, html`<div class="page-center">${UI.errorState(e)}</div>`);
        root.querySelector('[data-retry]').onclick = () => { current.hash = null; render(); };
      }
    }
    if (current !== mine) {
      // The user navigated away while this screen was still loading: tear it down now.
      if (cleanup) try { cleanup(); } catch (e) { console.error(e); }
      return;
    }
    mine.cleanup = cleanup;
    if (!root.contains(document.activeElement) || document.activeElement === document.body) {
      const focusTarget = root.querySelector('[autofocus]');
      if (focusTarget) focusTarget.focus({ preventScroll: true });
    }
  }
  S.rerender = () => { current.hash = null; render(); };

  /* Refresh the public state (school branding + current elections). */
  S.refreshPublic = async () => {
    S.state.pub = await S.state.api.getPublic();
    S.brand.apply(S.state.pub.school);
    return S.state.pub;
  };

  function looksSecret(key) {
    const k = String(key || '');
    if (/^sb_secret_/i.test(k)) return true;
    const parts = k.split('.');
    if (parts.length === 3) {
      try {
        const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
        return payload.role === 'service_role' || payload.role === 'supabase_admin';
      } catch (e) { return false; }
    }
    return false;
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new S.ApiError('NETWORK', 'The Supabase library could not be loaded. Check the internet connection.'));
      document.head.appendChild(s);
    });
  }

  function fatal(title, text) {
    U.setHtml(app(), html`<div class="page-center"><div class="state-error fatal" role="alert">
      <div class="state-icon">${UI.icon('shield', 30)}</div><h3>${title}</h3><p>${text}</p></div></div>`);
  }

  async function boot() {
    const cfg = window.SGE_CONFIG || {};
    // Refuse to run inside another site's frame (clickjacking). Static hosts like GitHub Pages
    // cannot send a frame-ancestors header, so the app enforces it itself.
    if (window.top !== window.self) {
      return fatal('Open the election system directly',
        'For security, this page cannot run inside another website. Open its address in a browser tab.');
    }
    if (looksSecret(cfg.SUPABASE_PUBLISHABLE_KEY)) {
      return fatal('Security stop: secret key detected',
        'config.js contains a Supabase service_role / secret key. Remove it immediately, rotate the key in the Supabase dashboard, and use the publishable (anon) key instead.');
    }
    try {
      if (cfg.SUPABASE_URL && cfg.SUPABASE_PUBLISHABLE_KEY) {
        if (!window.supabase) await loadScript(cfg.SUPABASE_JS_URL);
        S.state.api = S.createSupabaseBackend(cfg);
      } else {
        S.state.api = S.createLocalBackend();
      }
      S.api = S.state.api;
      await S.refreshPublic();
    } catch (e) {
      console.error(e);
      U.setHtml(app(), html`<div class="page-center">${UI.errorState(e)}</div>`);
      app().querySelector('[data-retry]').onclick = () => location.reload();
      return;
    }
    window.addEventListener('hashchange', render);
    render();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(window.SGE);
