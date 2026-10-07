/* Reusable UI components: icons, toasts, modals, confirmation dialogs, stat cards,
   empty/loading/error states, avatars and progress bars. */
(function (S) {
  'use strict';
  const U = S.util, html = U.html, raw = U.raw;
  const UI = (S.ui = {});

  /* ------------------------------------------------------------- Icons */
  const P = {
    dashboard: '<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>',
    ballot: '<path d="m9 12 2 2 4-4"/><path d="M5 7a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v12H5V7Z"/><path d="M22 19H2"/>',
    calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    award: '<circle cx="12" cy="8" r="6"/><path d="M15.48 12.89 17 22l-5-3-5 3 1.52-9.11"/>',
    key: '<circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6M15.5 7.5l3 3L22 7l-3-3"/>',
    activity: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
    chart: '<path d="M3 3v18h18"/><path d="M18 17V9M13 17V5M8 17v-3"/>',
    file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/>',
    settings: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
    trash: '<path d="M3 6h18M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>',
    grip: '<circle cx="9" cy="5" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="19" r="1"/>',
    'chevron-left': '<path d="m15 18-6-6 6-6"/>',
    'chevron-right': '<path d="m9 18 6-6-6-6"/>',
    'chevron-down': '<path d="m6 9 6 6 6-6"/>',
    'chevron-up': '<path d="m18 15-6-6-6 6"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4M12 17h.01"/>',
    info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
    lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    play: '<path d="M6 3.5v17a1 1 0 0 0 1.5.86l14-8.5a1 1 0 0 0 0-1.72l-14-8.5A1 1 0 0 0 6 3.5Z"/>',
    pause: '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>',
    stop: '<rect x="5" y="5" width="14" height="14" rx="2"/>',
    upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
    printer: '<path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>',
    maximize: '<path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"/>',
    minimize: '<path d="M8 3v3a2 2 0 0 1-2 2H3M21 8h-3a2 2 0 0 1-2-2V3M3 16h3a2 2 0 0 1 2 2v3M16 21v-3a2 2 0 0 1 2-2h3"/>',
    eye: '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
    'eye-off': '<path d="M9.88 9.88a3 3 0 1 0 4.24 4.24M10.73 5.08A10.4 10.4 0 0 1 12 5c7 0 10 7 10 7a13.2 13.2 0 0 1-1.67 2.68M6.61 6.61A13.5 13.5 0 0 0 2 12s3 7 10 7a9.7 9.7 0 0 0 5.39-1.61M2 2l20 20"/>',
    refresh: '<path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16M3 21v-5h5M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8M21 3v5h-5"/>',
    monitor: '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>',
    trophy: '<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6M18 9h1.5a2.5 2.5 0 0 0 0-5H18M4 22h16M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22M18 2H6v7a6 6 0 0 0 12 0V2Z"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.09-3.09a2 2 0 0 0-2.82 0L6 21"/>',
    search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
    sparkles: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 3v4M17 5h4M5 17v4M3 19h4"/>',
    flask: '<path d="M9 3h6M10 3v6.5L4.5 19a1.5 1.5 0 0 0 1.3 2h12.4a1.5 1.5 0 0 0 1.3-2L14 9.5V3"/><path d="M7 15h10"/>',
    shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/>',
    clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
    external: '<path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    home: '<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/>',
    copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    'arrow-right': '<path d="M5 12h14M12 5l7 7-7 7"/>',
    'arrow-left': '<path d="M19 12H5M12 19l-7-7 7-7"/>',
    'arrow-up': '<path d="m5 12 7-7 7 7M12 19V5"/>',
    'arrow-down': '<path d="M12 5v14M19 12l-7 7-7-7"/>',
    live: '<circle cx="12" cy="12" r="2"/><path d="M16.24 7.76a6 6 0 0 1 0 8.49M7.76 16.24a6 6 0 0 1 0-8.49M19.07 4.93a10 10 0 0 1 0 14.14M4.93 19.07a10 10 0 0 1 0-14.14"/>',
    archive: '<rect x="2" y="3" width="20" height="5" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8M10 12h4"/>',
    database: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/><path d="M3 12c0 1.66 4 3 9 3s9-1.34 9-3"/>',
    school: '<path d="M22 10 12 5 2 10l10 5 10-5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
    target: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
    wifi_off: '<path d="M2 2l20 20M8.5 16.5a5 5 0 0 1 7 0M2 8.82a15 15 0 0 1 4.17-2.65M10.66 5c4.01-.36 8.14.9 11.34 3.76M16.85 11.25a10 10 0 0 1 2.22 1.68M5 13a10 10 0 0 1 5.24-2.76M12 20h.01"/>',
  };
  UI.icon = (name, size = 20, cls = '') => raw(
    `<svg class="icon ${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${P[name] || P.info}</svg>`);

  /* ------------------------------------------------------------- Toasts */
  UI.toast = (message, type = 'ok', timeout = 4200) => {
    const root = document.getElementById('toast-root');
    if (!root) return;
    const icons = { ok: 'check', error: 'alert', warn: 'alert', info: 'info' };
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.setAttribute('role', type === 'error' ? 'alert' : 'status');
    U.setHtml(el, html`<span class="toast-icon">${UI.icon(icons[type] || 'info', 18)}</span><span class="toast-msg">${message}</span>
      <button class="toast-close" aria-label="Dismiss">${UI.icon('x', 16)}</button>`);
    const remove = () => { el.classList.add('leaving'); setTimeout(() => el.remove(), 220); };
    el.querySelector('.toast-close').onclick = remove;
    root.appendChild(el);
    if (timeout) setTimeout(remove, timeout);
  };
  UI.toastError = (err) => UI.toast(S.rules.message(err).text, 'error', 6500);

  /* ------------------------------------------------------------- Modals */
  const stack = [];
  const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

  /* opts: { title, body (html), size: sm|md|lg|xl, dismissible, tone, footer (html), onMount(el, close) }
     Returns { el, close(value), result: Promise } */
  UI.modal = (opts) => {
    const root = document.getElementById('modal-root');
    const prevFocus = document.activeElement;
    const id = 'm' + Math.random().toString(36).slice(2, 8);
    const wrap = document.createElement('div');
    wrap.className = 'modal-backdrop';
    U.setHtml(wrap, html`
      <div class="modal modal-${opts.size || 'md'} ${opts.tone ? 'modal-' + opts.tone : ''}" role="dialog" aria-modal="true" aria-labelledby="${id}-t">
        <div class="modal-header">
          <h2 class="modal-title" id="${id}-t">${opts.title || ''}</h2>
          ${opts.dismissible === false ? '' : html`<button class="btn btn-icon btn-ghost modal-x" data-close aria-label="Close dialog">${UI.icon('x')}</button>`}
        </div>
        <div class="modal-body">${opts.body || ''}</div>
        ${opts.footer ? html`<div class="modal-footer">${opts.footer}</div>` : ''}
      </div>`);
    let resolve;
    const result = new Promise((r) => (resolve = r));
    let closed = false;
    const close = (value) => {
      if (closed) return;
      closed = true;
      stack.splice(stack.indexOf(api), 1);
      document.removeEventListener('keydown', onKey, true);
      wrap.classList.add('leaving');
      setTimeout(() => wrap.remove(), 180);
      if (prevFocus && prevFocus.focus) try { prevFocus.focus(); } catch (e) { /* ignore */ }
      resolve(value);
    };
    const onKey = (e) => {
      if (stack[stack.length - 1] !== api) return;
      if (e.key === 'Escape' && opts.dismissible !== false) { e.preventDefault(); close(undefined); }
      if (e.key === 'Tab') {
        const f = U.$$(FOCUSABLE, wrap).filter((x) => x.offsetParent !== null);
        if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    wrap.addEventListener('mousedown', (e) => { if (e.target === wrap && opts.dismissible !== false) close(undefined); });
    wrap.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) close(undefined); });
    document.addEventListener('keydown', onKey, true);
    root.appendChild(wrap);
    const api = { el: wrap, close, result };
    stack.push(api);
    if (opts.onMount) opts.onMount(wrap, close);
    requestAnimationFrame(() => {
      const target = wrap.querySelector('[autofocus]') || wrap.querySelector('.modal-body ' + FOCUSABLE) || wrap.querySelector(FOCUSABLE);
      if (target) target.focus();
    });
    return api;
  };

  /* Confirmation dialog.  With `phrase`, the user must type it exactly (critical actions).
     With `armDelay` the confirm button only enables after a short pause (prevents double-click accidents). */
  UI.confirm = (opts) => {
    const phraseId = 'ph' + Math.random().toString(36).slice(2, 7);
    const m = UI.modal({
      title: opts.title,
      size: opts.size || 'sm',
      tone: opts.danger ? 'danger' : opts.tone,
      body: html`
        ${opts.message ? html`<div class="confirm-msg">${opts.message}</div>` : ''}
        ${opts.phrase ? html`
          <div class="field">
            <label class="label" for="${phraseId}">Type <strong class="phrase">${opts.phrase}</strong> to confirm</label>
            <input class="input input-lg mono" id="${phraseId}" autocomplete="off" spellcheck="false" autocapitalize="characters">
          </div>` : ''}`,
      footer: html`
        <button class="btn btn-secondary" data-close>${opts.cancelLabel || 'Cancel'}</button>
        <button class="btn ${opts.danger ? 'btn-danger' : 'btn-primary'}" data-ok ${opts.phrase || opts.armDelay ? 'disabled' : ''}>${opts.icon ? UI.icon(opts.icon, 18) : ''}<span>${opts.confirmLabel || 'Confirm'}</span></button>`,
    });
    const ok = m.el.querySelector('[data-ok]');
    const input = opts.phrase ? m.el.querySelector('#' + phraseId) : null;
    let armed = !opts.armDelay;
    const sync = () => { ok.disabled = !armed || (input && input.value.trim().toUpperCase() !== opts.phrase); };
    if (opts.armDelay) setTimeout(() => { armed = true; sync(); }, opts.armDelay);
    if (input) {
      input.addEventListener('input', sync);
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !ok.disabled) ok.click(); });
    }
    ok.addEventListener('click', () => m.close(input ? input.value.trim().toUpperCase() : true));
    return m.result.then((v) => (v === undefined ? false : v));
  };

  UI.alert = (title, message, tone) => UI.modal({
    title, size: 'sm', tone,
    body: html`<div class="confirm-msg">${message}</div>`,
    footer: html`<button class="btn btn-primary" data-close autofocus>OK</button>`,
  }).result;

  /* Form modal: body contains inputs with name="". onSubmit(values, form) may throw
     (Error with .fields = {name: message}) to keep the dialog open and show errors. */
  UI.formModal = (opts) => {
    const fid = 'f' + Math.random().toString(36).slice(2, 7);
    const m = UI.modal({
      title: opts.title,
      size: opts.size || 'md',
      body: html`<form id="${fid}" class="form" novalidate>${opts.body}<div class="form-error" role="alert" hidden></div></form>`,
      footer: html`
        ${opts.extraFooter || ''}
        <button class="btn btn-secondary" type="button" data-close>Cancel</button>
        <button class="btn btn-primary" type="submit" form="${fid}" data-submit>${opts.submitLabel || 'Save'}</button>`,
      onMount: opts.onMount,
    });
    const form = m.el.querySelector('form');
    const errBox = form.querySelector('.form-error');
    const btn = m.el.querySelector('[data-submit]');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      UI.clearFieldErrors(form);
      errBox.hidden = true;
      const values = UI.formValues(form);
      btn.disabled = true;
      btn.classList.add('is-busy');
      try {
        const out = await opts.onSubmit(values, form, m);
        if (out !== false) m.close(out === undefined ? true : out);
      } catch (err) {
        if (err.fields) UI.showFieldErrors(form, err.fields);
        else { errBox.textContent = S.rules.message(err).text; errBox.hidden = false; }
      } finally {
        btn.disabled = false;
        btn.classList.remove('is-busy');
      }
    });
    return m;
  };

  UI.formValues = (form) => {
    const out = {};
    U.$$('[name]', form).forEach((el) => {
      if (el.type === 'checkbox') out[el.name] = el.checked;
      else if (el.type === 'radio') { if (el.checked) out[el.name] = el.value; }
      else if (el.type === 'number') out[el.name] = el.value === '' ? null : Number(el.value);
      else if (el.type !== 'file') out[el.name] = el.value.trim();
    });
    return out;
  };
  UI.fieldError = (fields) => { const e = new Error('Please fix the highlighted fields.'); e.fields = fields; return e; };
  UI.clearFieldErrors = (form) => {
    U.$$('.field-error', form).forEach((x) => x.remove());
    U.$$('[aria-invalid]', form).forEach((x) => x.removeAttribute('aria-invalid'));
  };
  UI.showFieldErrors = (form, fields) => {
    let first = null;
    Object.entries(fields).forEach(([name, msg]) => {
      const input = form.querySelector(`[name="${name}"]`);
      if (!input) return;
      input.setAttribute('aria-invalid', 'true');
      const p = document.createElement('p');
      p.className = 'field-error';
      p.textContent = msg;
      (input.closest('.field') || input.parentElement).appendChild(p);
      if (!first) first = input;
    });
    if (first) first.focus();
  };

  /* -------------------------------------------------------- Components */
  UI.statusPill = (vs, extraCls = '') => html`<span class="status-pill tone-${vs.tone} ${extraCls}"><span class="dot"></span>${vs.label}</span>`;
  UI.badge = (text, tone = 'muted') => html`<span class="badge tone-${tone}">${text}</span>`;

  UI.statCard = ({ label, value, sub, icon, tone, id, big }) => html`
    <div class="stat-card ${tone ? 'tone-' + tone : ''} ${big ? 'stat-big' : ''}">
      <div class="stat-top"><span class="stat-label">${label}</span>${icon ? html`<span class="stat-icon">${UI.icon(icon, 18)}</span>` : ''}</div>
      <div class="stat-value tnum" ${id ? raw(`id="${U.esc(id)}"`) : ''}>${value}</div>
      ${sub ? html`<div class="stat-sub">${sub}</div>` : ''}
    </div>`;

  UI.progress = (pct, { label, tone, big } = {}) => html`
    <div class="progress ${big ? 'progress-lg' : ''} ${tone ? 'tone-' + tone : ''}" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(pct)}" ${label ? raw(`aria-label="${U.esc(label)}"`) : ''}>
      <div class="progress-fill" style="width:${U.clamp(pct, 0, 100).toFixed(2)}%"></div>
    </div>`;

  UI.avatar = (person, size = 56, cls = '') => {
    const src = U.safeImg(person && person.photo_url);
    if (src) return html`<img class="avatar ${cls}" src="${src}" alt="" width="${size}" height="${size}" style="width:${size}px;height:${size}px" loading="lazy">`;
    const hue = U.hueFromString(person && person.name);
    return html`<span class="avatar avatar-initials ${cls}" aria-hidden="true" style="width:${size}px;height:${size}px;font-size:${Math.round(size * 0.38)}px;--h:${hue}">${U.initials(person && person.name)}</span>`;
  };

  UI.logo = (school, size = 48, cls = '') => {
    const src = U.safeImg(school && school.logo_url);
    if (src) return html`<img class="logo ${cls}" src="${src}" alt="${(school && school.name) || 'School'} logo" style="height:${size}px">`;
    return html`<span class="logo logo-crest ${cls}" style="width:${size}px;height:${size}px;font-size:${Math.round(size * 0.36)}px" aria-hidden="true">${U.initials((school && school.name) || 'School')}</span>`;
  };

  UI.loading = (text = 'Loading…') => html`<div class="state-loading" role="status" aria-live="polite"><span class="spinner" aria-hidden="true"></span><span>${text}</span></div>`;

  UI.skeleton = (count = 3, kind = 'card') => html`<div class="skeleton-grid">${Array.from({ length: count }, () => html`<div class="skeleton skeleton-${kind}"></div>`)}</div>`;

  UI.empty = ({ icon = 'sparkles', title, text, action }) => html`
    <div class="state-empty">
      <div class="state-icon">${UI.icon(icon, 30)}</div>
      <h3>${title}</h3>
      ${text ? html`<p>${text}</p>` : ''}
      ${action || ''}
    </div>`;

  UI.errorState = (err, retryAttr = 'data-retry') => {
    const m = S.rules.message(err);
    return html`
      <div class="state-error" role="alert">
        <div class="state-icon">${UI.icon(err && err.code === 'NETWORK' ? 'wifi_off' : 'alert', 30)}</div>
        <h3>${m.title}</h3><p>${m.text}</p>
        <button class="btn btn-secondary" ${raw(retryAttr)}>${UI.icon('refresh', 18)}<span>Try again</span></button>
      </div>`;
  };

  UI.callout = (tone, title, text, icon) => html`
    <div class="callout tone-${tone}">
      ${UI.icon(icon || (tone === 'danger' || tone === 'warn' ? 'alert' : 'info'), 20)}
      <div>${title ? html`<strong>${title}</strong>` : ''}${text ? html`<div>${text}</div>` : ''}</div>
    </div>`;

  // Busy-state helper for async buttons.
  UI.busy = async (btn, fn) => {
    if (!btn || btn.disabled) return;
    btn.disabled = true;
    btn.classList.add('is-busy');
    try { return await fn(); } finally { btn.disabled = false; btn.classList.remove('is-busy'); }
  };

  UI.fullscreen = {
    active: () => !!document.fullscreenElement,
    toggle: (el) => {
      if (document.fullscreenElement) return document.exitFullscreen && document.exitFullscreen();
      const t = el || document.documentElement;
      return t.requestFullscreen && t.requestFullscreen().catch(() => UI.toast('Full screen is not available in this browser.', 'warn'));
    },
  };
})(window.SGE);
