/* School branding → CSS custom properties.  Nothing about the school is hard-coded:
   every screen reads name, logo and colours from the school record. */
(function (S) {
  'use strict';
  const U = S.util;
  const B = (S.brand = {});

  B.DEFAULTS = {
    name: 'Your School',
    motto: '',
    academic_year: String(new Date().getFullYear()),
    primary_color: '#1d4ed8',
    secondary_color: '#0f172a',
    accent_color: '#f59e0b',
  };

  B.PRESETS = [
    { name: 'Royal', primary: '#1d4ed8', secondary: '#0f172a', accent: '#f59e0b' },
    { name: 'Emerald', primary: '#047857', secondary: '#052e2b', accent: '#facc15' },
    { name: 'Crimson', primary: '#b91c1c', secondary: '#1f0a0a', accent: '#fbbf24' },
    { name: 'Violet', primary: '#6d28d9', secondary: '#1e1033', accent: '#22d3ee' },
    { name: 'Navy & Gold', primary: '#1e3a8a', secondary: '#0b1533', accent: '#d4a017' },
    { name: 'Teal', primary: '#0f766e', secondary: '#082f2c', accent: '#fb923c' },
  ];

  B.current = { ...B.DEFAULTS };

  B.apply = (school) => {
    const s = { ...B.DEFAULTS, ...(school || {}) };
    const primary = U.isHex(s.primary_color) ? s.primary_color : B.DEFAULTS.primary_color;
    const secondary = U.isHex(s.secondary_color) ? s.secondary_color : B.DEFAULTS.secondary_color;
    const accent = U.isHex(s.accent_color) ? s.accent_color : B.DEFAULTS.accent_color;
    // Text in the brand colour must stay readable on white.
    let brandText = primary;
    for (let t = 0.1; U.contrast(brandText, '#ffffff') < 4.5 && t <= 0.8; t += 0.1) brandText = U.mix(primary, '#000000', t);
    // The broadcast screen is always dark; use the secondary colour when it is dark enough.
    const bcBase = U.luminance(secondary) < 0.06 ? secondary : U.mix(primary, '#000000', 0.78);
    const vars = {
      '--brand': primary,
      '--brand-hover': U.mix(primary, '#000000', 0.12),
      '--brand-strong': U.mix(primary, '#000000', 0.3),
      '--brand-soft': U.mix(primary, '#ffffff', 0.9),
      '--brand-softer': U.mix(primary, '#ffffff', 0.95),
      '--brand-line': U.mix(primary, '#ffffff', 0.7),
      '--brand-text': brandText,
      '--on-brand': U.readableOn(primary),
      '--brand-2': secondary,
      '--on-brand-2': U.readableOn(secondary),
      '--accent': accent,
      '--accent-soft': U.mix(accent, '#ffffff', 0.85),
      '--on-accent': U.readableOn(accent),
      '--bc-bg': bcBase,
      '--bc-bg-2': U.mix(bcBase, primary, 0.35),
      '--bc-bar': U.luminance(primary) < 0.04 ? U.mix(primary, '#ffffff', 0.35) : primary,
      '--brand-glow': U.rgba(primary, 0.35),
      '--accent-glow': U.rgba(accent, 0.4),
    };
    const root = document.documentElement.style;
    Object.entries(vars).forEach(([k, v]) => root.setProperty(k, v));
    B.current = { ...s, primary_color: primary, secondary_color: secondary, accent_color: accent };
    const fav = document.querySelector('link[rel="icon"]');
    if (fav && U.safeImg(s.logo_url)) fav.href = s.logo_url;
  };

  // "2026 Student Government Elections" — adds the year unless the name already contains it.
  B.title = (election, school) => {
    if (!election) return 'Student Government Elections';
    const year = election.academic_year || (school && school.academic_year) || '';
    const name = election.name || 'Student Government Elections';
    return year && !name.includes(String(year).slice(0, 4)) ? `${year} ${name}` : name;
  };

  B.setDocTitle = (part, school) => {
    const s = school || B.current;
    document.title = [part, s && s.name !== B.DEFAULTS.name ? s.name : null, 'Elections'].filter(Boolean).join(' · ');
  };
})(window.SGE);
