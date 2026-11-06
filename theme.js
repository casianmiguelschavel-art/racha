// Temas de color: cada persona elige el suyo (se guarda en su perfil y en el móvil).
export const PRESETS = {
  fuego: { name: 'Fuego', accent: '#ff5a1f', accent2: '#ffb020' },
  oceano: { name: 'Océano', accent: '#1f6fff', accent2: '#22d3ee' },
  bosque: { name: 'Bosque', accent: '#16a34a', accent2: '#a3e635' },
  lavanda: { name: 'Lavanda', accent: '#7c3aed', accent2: '#f472b6' },
  rosa: { name: 'Rosa', accent: '#e11d74', accent2: '#fb7185' },
  menta: { name: 'Menta', accent: '#0d9488', accent2: '#5eead4' },
  noche: { name: 'Noche', accent: '#4f46e5', accent2: '#06b6d4' },
  oro: { name: 'Oro', accent: '#c2780a', accent2: '#f6c445' },
};

// Colores que se pueden cambiar uno a uno en "Personalizar colores".
export const COLOR_KEYS = [
  ['accent', 'Color principal', '--accent'],
  ['accent2', 'Color del degradado', '--accent-2'],
  ['bg', 'Fondo', '--bg'],
  ['card', 'Tarjetas', '--card'],
  ['text', 'Texto', '--text'],
  ['prot', 'Proteínas', '--c-prot'],
  ['carb', 'Carbohidratos', '--c-carb'],
  ['fat', 'Grasas', '--c-fat'],
];

export const DEFAULT_THEME = { mode: 'auto', preset: 'fuego', custom: {} };
const KEY = 'racha_theme';

export function normTheme(t) {
  return { ...DEFAULT_THEME, ...(t || {}), custom: { ...((t && t.custom) || {}) } };
}

export function cachedTheme() {
  try { return normTheme(JSON.parse(localStorage.getItem(KEY))); } catch { return normTheme(); }
}

function luminance(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return 0.3;
  const n = parseInt(m[1], 16);
  const ch = [n >> 16, (n >> 8) & 255, n & 255].map((v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

export function applyTheme(t) {
  t = normTheme(t);
  const root = document.documentElement;
  if (t.mode === 'light' || t.mode === 'dark') root.dataset.theme = t.mode;
  else delete root.dataset.theme;

  const p = PRESETS[t.preset] || PRESETS.fuego;
  const vals = { accent: p.accent, accent2: p.accent2, ...t.custom };
  for (const [k, , css] of COLOR_KEYS) {
    if (vals[k]) root.style.setProperty(css, vals[k]);
    else root.style.removeProperty(css);
  }
  // Texto sobre el color principal: blanco o negro según lo claro que sea.
  root.style.setProperty('--on-accent', luminance(vals.accent) > 0.45 ? '#111111' : '#ffffff');

  requestAnimationFrame(() => {
    const bg = getComputedStyle(root).getPropertyValue('--bg').trim();
    document.querySelectorAll('meta[name=theme-color]').forEach((m) => m.setAttribute('content', bg || '#ffffff'));
  });
  try { localStorage.setItem(KEY, JSON.stringify(t)); } catch { /* nada */ }
  return t;
}
