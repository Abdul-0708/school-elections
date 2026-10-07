/* Student Government Election System — shared utilities.
   Classic script (no build step, works from file:// and any static host).
   Everything hangs off window.SGE. */
(function (S) {
  'use strict';
  const U = (S.util = {});
  S.views = S.views || {};

  /* ---------------------------------------------------------------- HTML */
  // Tagged template that escapes every interpolation unless it is wrapped in raw().
  class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
  U.raw = (s) => new Raw(String(s == null ? '' : s));
  U.esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function toHtml(v) {
    if (v instanceof Raw) return v.s;
    if (Array.isArray(v)) return v.map(toHtml).join('');
    if (v == null || v === false) return '';
    return U.esc(v);
  }
  U.toHtml = toHtml;
  U.html = (strings, ...vals) => {
    let out = strings[0];
    for (let i = 0; i < vals.length; i++) out += toHtml(vals[i]) + strings[i + 1];
    return new Raw(out);
  };
  U.setHtml = (el, tpl) => { el.innerHTML = toHtml(tpl); return el; };
  U.$ = (sel, root) => (root || document).querySelector(sel);
  U.$$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  // Delegated event listener. Returns an unsubscribe function.
  U.on = (root, type, selector, fn) => {
    const h = (e) => {
      const t = e.target.closest && e.target.closest(selector);
      if (t && root.contains(t)) fn(e, t);
    };
    root.addEventListener(type, h);
    return () => root.removeEventListener(type, h);
  };
  U.attr = (cond, name, value) => (cond ? U.raw(` ${name}="${U.esc(value == null ? name : value)}"`) : '');

  /* ------------------------------------------------------------ Random */
  U.randomBytes = (n) => {
    const a = new Uint8Array(n);
    crypto.getRandomValues(a);
    return a;
  };
  U.randomHex = (bytes = 16) => Array.from(U.randomBytes(bytes), (b) => b.toString(16).padStart(2, '0')).join('');
  U.uuid = () => {
    if (crypto.randomUUID) return crypto.randomUUID();
    const b = U.randomBytes(16);
    b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
    const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  };

  /* ------------------------------------------------------ Voting codes */
  // 31 symbols: no I, L, O, 0 or 1, so codes can't be misread.  8 symbols = 31^8 ≈ 8.5e11 combinations.
  U.CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  U.generateCode = () => {
    const A = U.CODE_ALPHABET;
    let out = '';
    while (out.length < 8) {
      for (const b of U.randomBytes(16)) {
        if (b < 248 && out.length < 8) out += A[b % 31]; // rejection sampling: no modulo bias
      }
    }
    return out.slice(0, 4) + '-' + out.slice(4);
  };
  // Case-insensitive, ignores spaces and dashes.  Returns '' if it can't be a code.
  U.normalizeCode = (input) => {
    const s = String(input || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    return s.length === 8 ? s.slice(0, 4) + '-' + s.slice(4) : '';
  };
  // Pretty formatting while typing.
  U.formatCodeTyping = (input) => {
    const s = String(input || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
    return s.length > 4 ? s.slice(0, 4) + '-' + s.slice(4) : s;
  };

  /* ----------------------------------------------------------- SHA-256 */
  // Small, dependency-free SHA-256 (used by the local demo engine only).
  const SHA = (() => {
    const K = [], H = [];
    const isPrime = (n) => { for (let f = 2; f * f <= n; f++) if (n % f === 0) return false; return true; };
    const frac = (x) => ((x - Math.floor(x)) * 0x100000000) | 0;
    for (let n = 2, c = 0; c < 64; n++) {
      if (!isPrime(n)) continue;
      if (c < 8) H[c] = frac(Math.pow(n, 1 / 2));
      K[c++] = frac(Math.pow(n, 1 / 3));
    }
    return { K, H };
  })();
  const rotr = (x, n) => (x >>> n) | (x << (32 - n));
  U.sha256 = (str) => {
    const bytes = Array.from(new TextEncoder().encode(String(str)));
    const bitLen = bytes.length * 8;
    bytes.push(0x80);
    while (bytes.length % 64 !== 56) bytes.push(0);
    const hi = Math.floor(bitLen / 0x100000000), lo = bitLen >>> 0;
    bytes.push((hi >>> 24) & 255, (hi >>> 16) & 255, (hi >>> 8) & 255, hi & 255,
      (lo >>> 24) & 255, (lo >>> 16) & 255, (lo >>> 8) & 255, lo & 255);
    const h = SHA.H.slice(), K = SHA.K, w = new Array(64);
    for (let i = 0; i < bytes.length; i += 64) {
      for (let j = 0; j < 16; j++) {
        w[j] = (bytes[i + 4 * j] << 24) | (bytes[i + 4 * j + 1] << 16) | (bytes[i + 4 * j + 2] << 8) | bytes[i + 4 * j + 3];
      }
      for (let j = 16; j < 64; j++) {
        const a = w[j - 15], b = w[j - 2];
        const s0 = rotr(a, 7) ^ rotr(a, 18) ^ (a >>> 3);
        const s1 = rotr(b, 17) ^ rotr(b, 19) ^ (b >>> 10);
        w[j] = (w[j - 16] + s0 + w[j - 7] + s1) | 0;
      }
      let [a, b, c, d, e, f, g, hh] = h;
      for (let j = 0; j < 64; j++) {
        const t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[j] + w[j]) | 0;
        const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
        hh = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      h[0] = (h[0] + a) | 0; h[1] = (h[1] + b) | 0; h[2] = (h[2] + c) | 0; h[3] = (h[3] + d) | 0;
      h[4] = (h[4] + e) | 0; h[5] = (h[5] + f) | 0; h[6] = (h[6] + g) | 0; h[7] = (h[7] + hh) | 0;
    }
    return h.map((x) => (x >>> 0).toString(16).padStart(8, '0')).join('');
  };

  /* -------------------------------------------------------- Formatting */
  U.fmtInt = (n) => (Number(n) || 0).toLocaleString('en-GB');
  U.fmtPct = (n, dp = 1) => `${(Number(n) || 0).toFixed(dp)}%`;
  U.pct = (part, whole) => (whole > 0 ? (part / whole) * 100 : 0);
  const asDate = (v) => (v instanceof Date ? v : new Date(v));
  U.fmtDate = (v) => (v ? asDate(v).toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' }) : '—');
  U.fmtShortDate = (v) => (v ? asDate(v).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '—');
  U.fmtTime = (v, secs) => (v ? asDate(v).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: secs ? '2-digit' : undefined }) : '—');
  U.fmtDateTime = (v) => (v ? `${U.fmtDate(v)}, ${U.fmtTime(v)}` : '—');
  U.relTime = (v) => {
    if (!v) return 'never';
    const s = Math.round((Date.now() - asDate(v).getTime()) / 1000);
    if (s < 5) return 'just now';
    if (s < 60) return `${s}s ago`;
    if (s < 3600) return `${Math.floor(s / 60)} min ago`;
    if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
    return U.fmtShortDate(v);
  };
  U.initials = (name) => String(name || '?').trim().split(/\s+/).slice(0, 2).map((p) => p[0]).join('').toUpperCase();
  U.plural = (n, one, many) => `${U.fmtInt(n)} ${n === 1 ? one : (many || one + 's')}`;
  U.hueFromString = (s) => {
    let h = 0;
    for (const ch of String(s || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return h % 360;
  };
  U.selectionRule = (p) => {
    const min = p.min_selections, max = p.max_selections;
    if (min === 0) return max === 1 ? 'Optional — choose up to 1' : `Optional — choose up to ${max}`;
    if (min === max) return max === 1 ? 'Choose 1 candidate' : `Choose ${max} candidates`;
    return `Choose ${min} to ${max} candidates`;
  };

  /* --------------------------------------------------- Date ↔ inputs */
  const pad = (n) => String(n).padStart(2, '0');
  U.toDateInput = (iso) => { if (!iso) return ''; const d = new Date(iso); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  U.toTimeInput = (iso) => { if (!iso) return ''; const d = new Date(iso); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  U.fromDateTimeInputs = (date, time) => {
    if (!date) return null;
    const d = new Date(`${date}T${time || '00:00'}`);
    return isNaN(d) ? null : d.toISOString();
  };

  /* --------------------------------------------------------------- CSV */
  U.parseCSV = (text) => {
    const rows = [];
    let row = [], field = '', q = false;
    const s = String(text || '').replace(/^﻿/, '');
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (q) {
        if (c === '"') { if (s[i + 1] === '"') { field += '"'; i++; } else q = false; }
        else field += c;
      } else if (c === '"') q = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && s[i + 1] === '\n') i++;
        row.push(field); field = '';
        if (row.some((f) => f.trim() !== '')) rows.push(row);
        row = [];
      } else field += c;
    }
    row.push(field);
    if (row.some((f) => f.trim() !== '')) rows.push(row);
    return rows;
  };
  const csvCell = (v) => {
    let s = v == null ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // neutralise spreadsheet formula injection
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  U.toCSV = (rows) => rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
  U.download = (filename, content, mime = 'text/csv;charset=utf-8') => {
    const blob = content instanceof Blob ? content : new Blob(['﻿' + content], { type: mime });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  };
  U.slug = (s) => String(s || 'election').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'election';

  /* ------------------------------------------------------------- Timing */
  U.sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  U.debounce = (fn, ms) => {
    let t;
    return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  };
  // Runs fn at most once per `ms`, always delivering the latest call.
  U.throttle = (fn, ms) => {
    let last = 0, t = null;
    return (...a) => {
      const wait = ms - (Date.now() - last);
      clearTimeout(t);
      if (wait <= 0) { last = Date.now(); fn(...a); }
      else t = setTimeout(() => { last = Date.now(); fn(...a); }, wait);
    };
  };
  U.clamp = (n, a, b) => Math.min(b, Math.max(a, n));
  U.reducedMotion = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Animates the integer/decimal shown in el from its current value to `to`.
  U.animateNumber = (el, to, opts = {}) => {
    if (!el) return;
    const fmt = opts.format || U.fmtInt;
    const from = el.dataset.value != null ? Number(el.dataset.value) : (Number(String(el.textContent).replace(/[^0-9.-]/g, '')) || 0);
    el.dataset.value = String(to);
    if (from === to || U.reducedMotion()) { el.textContent = fmt(to); return; }
    const dur = opts.duration || 900, t0 = performance.now();
    cancelAnimationFrame(el._raf);
    const step = (t) => {
      const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3);
      el.textContent = fmt(from + (to - from) * e);
      if (k < 1) el._raf = requestAnimationFrame(step);
    };
    el._raf = requestAnimationFrame(step);
  };

  /* ------------------------------------------------------------- Images */
  // Downscales an uploaded image so it is light enough for voting stations.
  U.resizeImage = (file, maxSize = 480, quality = 0.85) => new Promise((resolve, reject) => {
    if (!file || !/^image\//.test(file.type)) return reject(new Error('Please choose an image file (JPG, PNG or WebP).'));
    if (file.size > 15 * 1024 * 1024) return reject(new Error('That image is larger than 15 MB.'));
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, maxSize / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      const g = c.getContext('2d');
      const png = file.type === 'image/png' || file.type === 'image/svg+xml';
      if (!png) { g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); }
      g.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL(png ? 'image/png' : 'image/jpeg', quality));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That image could not be read.')); };
    img.src = url;
  });
  U.dataUrlToBlob = (dataUrl) => {
    const [head, body] = dataUrl.split(',');
    const mime = (head.match(/data:([^;]+)/) || [])[1] || 'application/octet-stream';
    const bin = atob(body), arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
  };
  // Only allow image sources we expect (uploaded data URLs or http(s) URLs).
  U.safeImg = (url) => (typeof url === 'string' && /^(https?:\/\/|data:image\/(png|jpe?g|webp|gif);base64,)/i.test(url) ? url : '');

  /* -------------------------------------------------------------- Colors */
  const hexToRgb = (hex) => {
    let h = String(hex || '').replace('#', '');
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    if (!/^[0-9a-f]{6}$/i.test(h)) return null;
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  };
  const rgbToHex = (rgb) => '#' + rgb.map((v) => Math.round(U.clamp(v, 0, 255)).toString(16).padStart(2, '0')).join('');
  U.isHex = (hex) => !!hexToRgb(hex);
  U.mix = (a, b, t) => {
    const x = hexToRgb(a), y = hexToRgb(b);
    if (!x || !y) return a;
    return rgbToHex(x.map((v, i) => v + (y[i] - v) * t));
  };
  U.luminance = (hex) => {
    const rgb = hexToRgb(hex);
    if (!rgb) return 0;
    const [r, g, b] = rgb.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  U.contrast = (a, b) => {
    const la = U.luminance(a), lb = U.luminance(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  };
  U.readableOn = (bg) => (U.contrast(bg, '#ffffff') >= U.contrast(bg, '#0b1220') ? '#ffffff' : '#0b1220');
  U.rgba = (hex, a) => { const rgb = hexToRgb(hex) || [0, 0, 0]; return `rgba(${rgb.join(',')},${a})`; };

  /* ------------------------------------------------------------ Storage */
  // Browser storage only ever holds per-device conveniences (remembered tab, station id).
  U.store = {
    get(key, fallback) {
      try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); } catch (e) { return fallback; }
    },
    set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* ignore */ } },
    remove(key) { try { localStorage.removeItem(key); } catch (e) { /* ignore */ } },
  };

  /* --------------------------------------------------------------- Events */
  U.emitter = () => {
    const map = new Map();
    return {
      on(type, fn) { if (!map.has(type)) map.set(type, new Set()); map.get(type).add(fn); return () => map.get(type).delete(fn); },
      emit(type, payload) { (map.get(type) || []).forEach((fn) => { try { fn(payload); } catch (e) { console.error(e); } }); },
    };
  };
  S.bus = U.emitter();

  /* --------------------------------------------------------------- Errors */
  class ApiError extends Error {
    constructor(code, message, detail) { super(message || code); this.code = code; this.detail = detail; }
  }
  S.ApiError = ApiError;
})(window.SGE = window.SGE || {});
