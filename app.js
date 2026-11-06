import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  getFirestore, doc, getDoc, setDoc, updateDoc, collection, addDoc, deleteDoc,
  query, where, orderBy, getDocs, writeBatch,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';
import { FOODS } from './foods.js';
import { icon, logo } from './icons.js';
import { PRESETS, COLOR_KEYS, applyTheme, cachedTheme, normTheme } from './theme.js';

applyTheme(cachedTheme());

/* ================= utilidades ================= */
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = (n) => String(n).padStart(2, '0');
const dayKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const toDate = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (k, n) => { const d = toDate(k); d.setDate(d.getDate() + n); return dayKey(d); };
const diffDays = (a, b) => Math.round((Date.UTC(...b.split('-').map((x, i) => (i === 1 ? x - 1 : +x))) - Date.UTC(...a.split('-').map((x, i) => (i === 1 ? x - 1 : +x)))) / 864e5);
const fmtDay = (k) => toDate(k).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
const LETTERS = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];
const norm = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const fmtKg = (n) => Number(n).toLocaleString('es-ES', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const r0 = (n) => Math.round(+n || 0);
const r1 = (n) => Math.round((+n || 0) * 10) / 10;
const sumM = (list) => list.reduce((a, m) => ({ k: a.k + (m.kcal || 0), p: a.p + (m.p || 0), c: a.c + (m.c || 0), g: a.g + (m.g || 0) }), { k: 0, p: 0, c: 0, g: 0 });
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

const MEALS = [
  { id: 'desayuno', label: 'Desayuno', icon: 'coffee', required: false },
  { id: 'comida', label: 'Comida', icon: 'utensils', required: true },
  { id: 'cena', label: 'Cena', icon: 'moon', required: true },
  { id: 'picoteo', label: 'Picoteo', icon: 'apple', required: false },
];
const mealLabel = (id) => (MEALS.find((m) => m.id === id) || {}).label || id;

const GOALS = {
  perder: { label: 'Perder peso', desc: 'Déficit suave para bajar unos 0,5 kg por semana', icon: 'trend' },
  musculo: { label: 'Ganar músculo', desc: 'Un poco más de calorías y mucha proteína', icon: 'dumbbell' },
  mantener: { label: 'Mantenerme y tonificar', desc: 'Las mismas calorías, más proteína', icon: 'scale' },
};
const ACTIVITY = {
  baja: { label: 'Poco', desc: 'Trabajo sentado y casi sin deporte', f: 1.3 },
  media: { label: 'Normal', desc: 'Camino a diario o entreno 2-3 días', f: 1.5 },
  alta: { label: 'Mucho', desc: 'Entreno 4 o más días o trabajo físico', f: 1.7 },
};
const WATER_GOAL = 8; // vasos de 250 ml

/** Calorías y macros diarios (Mifflin-St Jeor con edad fija de 25 años). */
function calcTargets({ sex, height, weight, goalType = 'perder', activity = 'media' }) {
  const bmr = 10 * weight + 6.25 * height - 5 * 25 + (sex === 'h' ? 5 : -161);
  const tdee = bmr * (ACTIVITY[activity] || ACTIVITY.media).f;
  let kcal = goalType === 'perder' ? tdee - 500 : goalType === 'musculo' ? tdee + 250 : tdee;
  kcal = Math.max(Math.round(kcal / 10) * 10, sex === 'h' ? 1500 : 1200);
  const perKg = { perder: 1.8, musculo: 2.0, mantener: 1.6 }[goalType] || 1.8;
  const prot = Math.min(Math.round(weight * perKg), Math.round((kcal * 0.4) / 4));
  const fat = Math.round((kcal * 0.27) / 9);
  const carb = Math.max(50, Math.round((kcal - prot * 4 - fat * 9) / 4));
  return { kcal, prot, carb, fat };
}
const targets = (p) => (p.goalMode === 'manual' && p.manual ? p.manual : calcTargets(p));

/* ---------- racha (con protectores, como en Duolingo) ---------- */
function streakInfo(p, today) {
  const st = { count: 0, best: 0, lastDay: null, freezes: 0, ...((p && p.streak) || {}) };
  const base = { best: st.best || 0, freezes: st.freezes || 0 };
  if (!st.lastDay) return { ...base, n: 0, state: 'lost', missed: 0 };
  const gap = diffDays(st.lastDay, today);
  if (gap <= 0) return { ...base, n: st.count, state: 'done', missed: 0 };
  const missed = gap - 1;
  if (missed === 0) return { ...base, n: st.count, state: 'pending', missed };
  if (missed <= (st.freezes || 0)) return { ...base, n: st.count, state: 'pending', missed, saved: true };
  return { ...base, n: 0, state: 'lost', missed };
}

function nextStreak(p, complete, today) {
  const st = { count: 0, best: 0, lastDay: null, freezes: 0, ...(p.streak || {}) };
  if (complete && st.lastDay !== today) {
    const info = streakInfo(p, today);
    const { prev, ...base } = st;
    const ns = { ...base };
    if (info.state === 'pending') { ns.count = st.count + 1; ns.freezes = (st.freezes || 0) - info.missed; }
    else ns.count = 1;
    let earned = false;
    if (ns.count % 7 === 0 && ns.freezes < 2) { ns.freezes += 1; earned = true; }
    ns.lastDay = today;
    ns.best = Math.max(ns.best || 0, ns.count);
    ns.prev = base;
    return { st: ns, celebrate: true, earned };
  }
  if (!complete && st.lastDay === today) {
    const ns = st.prev ? { ...st.prev } : { count: Math.max(0, st.count - 1), best: st.best, lastDay: null, freezes: st.freezes };
    return { st: ns, celebrate: false };
  }
  return null;
}

/* ---------- avisos ---------- */
function toast(html, action) {
  const t = $('#toast');
  t.innerHTML = `<span>${html}</span>${action ? `<button>${icon('undo')}${esc(action.label)}</button>` : ''}`;
  if (action) t.querySelector('button').onclick = () => { t.classList.remove('show'); action.fn(); };
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), action ? 5000 : 2600);
}

function celebrate(n, earned) {
  const colors = ['--accent', '--accent-2', '--c-prot', '--c-carb', '--c-fat'];
  const el = document.createElement('div');
  el.className = 'celebrate';
  el.innerHTML = `<div class="confetti">${Array.from({ length: 46 }, (_, i) => `<i style="left:${Math.random() * 100}%;animation-delay:${(Math.random() * 0.7).toFixed(2)}s;animation-duration:${(2.2 + Math.random() * 1.6).toFixed(2)}s;background:var(${colors[i % 5]});--r:${Math.round(Math.random() * 720)}deg"></i>`).join('')}</div>
    <div class="cele-card">
      <div class="cele-flame">${logo(110)}</div>
      <div class="cele-n">${n}</div>
      <div class="cele-t">${n === 1 ? 'día de racha' : 'días de racha'}</div>
      <p>${earned ? `${icon('shield')} Has ganado un <b>protector de racha</b>: si un día se te olvida, tu racha se salva.` : 'Comida y cena registradas. ¡Mañana a por más!'}</p>
      <button class="btn primary big">¡Vamos!</button>
    </div>`;
  document.body.appendChild(el);
  el.querySelector('button').onclick = () => { el.classList.add('out'); setTimeout(() => el.remove(), 250); };
}

/* ================= arranque ================= */
const app = $('#app');
const configured = firebaseConfig && firebaseConfig.apiKey && !firebaseConfig.apiKey.startsWith('PEGA');
let auth, db;
const S = { user: null, profile: null, weekMeals: [], weights: [], water: 0, tab: 'hoy', today: dayKey() };
const todayMeals = () => S.weekMeals.filter((m) => m.day === S.today).sort((a, b) => a.ts - b.ts);
const isComplete = () => { const t = todayMeals(); return t.some((m) => m.type === 'comida') && t.some((m) => m.type === 'cena'); };

function screen(ic, title, text, btn) {
  app.innerHTML = `<div class="center-screen"><div class="logo-wrap">${ic}</div><h1>${title}</h1><p class="muted">${text}</p>${btn ? `<button class="btn primary" id="sbtn">${btn}</button>` : ''}</div>`;
}

if (!configured) {
  screen(logo(72), 'Falta configurar Firebase', 'Abre <b>firebase-config.js</b> y pega los datos de tu proyecto. Los pasos están en <b>LEEME.md</b>.');
} else {
  const fb = initializeApp(firebaseConfig);
  auth = getAuth(fb);
  db = getFirestore(fb);
  onAuthStateChanged(auth, onUser);
}

const userRef = (uid = S.user.uid) => doc(db, 'users', uid);
const mealsCol = (uid = S.user.uid) => collection(db, 'users', uid, 'meals');
const weightsCol = (uid = S.user.uid) => collection(db, 'users', uid, 'weights');
const daysCol = (uid = S.user.uid) => collection(db, 'users', uid, 'days');

async function onUser(u) {
  S.user = u;
  if (!u) return renderLogin();
  app.innerHTML = `<div class="center-screen"><div class="logo-wrap pulse">${logo(72)}</div></div>`;
  try {
    const snap = await getDoc(userRef());
    if (!snap.exists()) return renderOnboarding();
    S.profile = snap.data();
    if (S.profile.theme) applyTheme(S.profile.theme);
    await loadMine();
    render();
    cleanupOld();
  } catch (e) {
    console.error(e);
    if (e.code === 'permission-denied') {
      screen(`<div class="big-ic">${icon('lock')}</div>`, 'Sin acceso', 'Esta cuenta no está autorizada.', 'Salir');
      $('#sbtn').onclick = () => signOut(auth);
    } else {
      screen(`<div class="big-ic">${icon('activity')}</div>`, 'No se pudo cargar', esc(e.message), 'Reintentar');
      $('#sbtn').onclick = () => onUser(auth.currentUser);
    }
  }
}

async function loadMine() {
  S.today = dayKey();
  const [ms, ws, dd] = await Promise.all([
    getDocs(query(mealsCol(), where('day', '>=', addDays(S.today, -6)))),
    getDocs(query(weightsCol(), orderBy('day'))),
    getDoc(doc(daysCol(), S.today)),
  ]);
  S.weekMeals = ms.docs.map((d) => ({ id: d.id, ...d.data() }));
  S.weights = ws.docs.map((d) => ({ id: d.id, ...d.data() }));
  S.water = dd.exists() ? dd.data().water || 0 : 0;
}

document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'visible' && S.profile && dayKey() !== S.today) { await loadMine(); render(); }
});

/** Borra comidas y agua de hace más de 30 días. El peso se guarda siempre. */
async function cleanupOld() {
  const key = 'cleanup_' + S.user.uid;
  try { if (localStorage.getItem(key) === S.today) return; } catch { /* nada */ }
  try {
    const cutoff = addDays(S.today, -30);
    const [a, b] = await Promise.all([
      getDocs(query(mealsCol(), where('day', '<', cutoff))),
      getDocs(query(daysCol(), where('day', '<', cutoff))),
    ]);
    const docs = [...a.docs, ...b.docs].slice(0, 450);
    if (docs.length) { const wb = writeBatch(db); docs.forEach((d) => wb.delete(d.ref)); await wb.commit(); }
    try { localStorage.setItem(key, S.today); } catch { /* nada */ }
  } catch (e) { console.warn('Limpieza', e); }
}

/* ================= login ================= */
function renderLogin() {
  app.innerHTML = `
    <div class="center-screen login">
      <div class="logo-wrap glow">${logo(84)}</div>
      <h1 class="brand">Racha</h1>
      <p class="muted">Vuestro diario de comida, solo para dos.</p>
      <form id="login" class="form login-form">
        <input type="email" name="email" autocomplete="username" placeholder="Email" required aria-label="Email">
        <input type="password" name="pass" autocomplete="current-password" placeholder="Contraseña" required aria-label="Contraseña">
        <button class="btn primary big" type="submit">Entrar</button>
        <p class="error" id="err"></p>
      </form>
      <p class="muted tiny lock-note">${icon('lock')} Acceso privado</p>
    </div>`;
  $('#login').onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target, btn = f.querySelector('button');
    btn.disabled = true; $('#err').textContent = '';
    try { await signInWithEmailAndPassword(auth, f.email.value.trim(), f.pass.value); }
    catch { $('#err').textContent = 'Email o contraseña incorrectos.'; btn.disabled = false; }
  };
}

/* ================= primera vez (asistente) ================= */
function choice(name, value, checked, ic, label, desc) {
  return `<label class="choice"><input type="radio" name="${name}" value="${value}" ${checked ? 'checked' : ''} required>
    <span class="choice-box">${ic ? `<span class="tile">${icon(ic)}</span>` : ''}<span class="choice-txt"><b>${label}</b>${desc ? `<small>${desc}</small>` : ''}</span><span class="radio-dot"></span></span></label>`;
}

function renderOnboarding() {
  const O = { step: 0, name: (S.user.email || '').split('@')[0], sex: '', height: '', weight: '', goalType: 'perder', activity: 'media', target: '' };
  const N = 5;
  const html = () => {
    switch (O.step) {
      case 0: return `<div class="onb-hero">${logo(64)}</div><h1>¡Hola! ¿Cómo te llamas?</h1>
        <input class="big-input" name="name" value="${esc(O.name)}" required maxlength="20" placeholder="Tu nombre">
        <p class="onb-q">Sexo <small class="muted">(para calcular tus calorías)</small></p>
        <div class="choices row">${choice('sex', 'h', O.sex === 'h', '', 'Hombre')}${choice('sex', 'm', O.sex === 'm', '', 'Mujer')}</div>`;
      case 1: return `<h1>Tus medidas</h1><p class="muted">No te pedimos la edad.</p>
        <label class="unit-input"><span>Altura</span><input name="height" type="number" inputmode="numeric" min="120" max="230" value="${O.height}" required placeholder="170"><em>cm</em></label>
        <label class="unit-input"><span>Peso</span><input name="weight" type="number" inputmode="decimal" step="0.1" min="30" max="300" value="${O.weight}" required placeholder="70"><em>kg</em></label>`;
      case 2: return `<h1>¿Cuál es tu objetivo?</h1>
        <div class="choices">${Object.entries(GOALS).map(([k, g]) => choice('goalType', k, O.goalType === k, g.icon, g.label, g.desc)).join('')}</div>`;
      case 3: return `<h1>¿Cuánto te mueves?</h1>
        <div class="choices">${Object.entries(ACTIVITY).map(([k, a]) => choice('activity', k, O.activity === k, 'activity', a.label, a.desc)).join('')}</div>`;
      default: {
        const t = calcTargets({ sex: O.sex, height: +O.height, weight: +O.weight, goalType: O.goalType, activity: O.activity });
        return `<h1>Tu plan diario</h1><p class="muted">${GOALS[O.goalType].label}. Podrás cambiarlo cuando quieras.</p>
          <div class="plan-kcal"><b>${t.kcal}</b><span>kcal al día</span></div>
          <div class="plan-macros">
            <div class="pm prot"><b>${t.prot} g</b><span>Proteínas</span></div>
            <div class="pm carb"><b>${t.carb} g</b><span>Carbohidratos</span></div>
            <div class="pm fat"><b>${t.fat} g</b><span>Grasas</span></div>
          </div>
          <label class="unit-input"><span>Peso objetivo <small class="muted">(opcional)</small></span><input name="target" type="number" inputmode="decimal" step="0.1" min="30" max="300" value="${O.target}" placeholder="—"><em>kg</em></label>`;
      }
    }
  };
  const draw = () => {
    app.innerHTML = `<div class="onb">
      <div class="onb-top">${O.step ? `<button type="button" class="icon-btn" id="back" aria-label="Atrás">${icon('back')}</button>` : '<span class="icon-btn ghost"></span>'}
        <div class="onb-progress"><div style="width:${((O.step + 1) / N) * 100}%"></div></div><span class="icon-btn ghost"></span></div>
      <form id="onbf" class="onb-body" novalidate>${html()}
        <div class="onb-foot"><button class="btn primary big" type="submit">${O.step === N - 1 ? 'Empezar' : 'Continuar'}</button></div>
      </form></div>`;
    const f = $('#onbf');
    if ($('#back')) $('#back').onclick = () => { read(f); O.step--; draw(); };
    f.onsubmit = async (e) => {
      e.preventDefault();
      if (!f.checkValidity()) { f.reportValidity(); return; }
      read(f);
      if (O.step < N - 1) { O.step++; draw(); return; }
      const btn = f.querySelector('button[type=submit]'); btn.disabled = true;
      const weight = r1(O.weight);
      const profile = {
        name: O.name.trim(), sex: O.sex, height: +O.height, weight, startWeight: weight,
        goalType: O.goalType, activity: O.activity, targetWeight: O.target ? r1(O.target) : null,
        goalMode: 'auto', streak: { count: 0, best: 0, lastDay: null, freezes: 0 },
        created: dayKey(), recents: [], theme: cachedTheme(),
      };
      try {
        await setDoc(userRef(), profile);
        await addDoc(weightsCol(), { day: dayKey(), kg: weight, ts: Date.now() });
        onUser(S.user);
      } catch (err) { toast('Error al guardar: ' + esc(err.message)); btn.disabled = false; }
    };
    const first = f.querySelector('input:not([type=radio])');
    if (first && !first.value) first.focus();
  };
  const read = (f) => { for (const k of ['name', 'sex', 'height', 'weight', 'goalType', 'activity', 'target']) if (f[k]) O[k] = f[k].value; };
  draw();
}

/* ================= estructura principal ================= */
function render() {
  const si = streakInfo(S.profile, S.today);
  const tabs = [['hoy', 'home', 'Hoy'], ['progreso', 'trend', 'Progreso'], null, ['pareja', 'heart', 'Pareja'], ['perfil', 'user', 'Perfil']];
  app.innerHTML = `
    <header class="top">
      <div class="top-l"><div class="avatar">${esc((S.profile.name || '?').charAt(0).toUpperCase())}</div>
        <div><small class="muted">${cap(new Date().toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' }))}</small>
        <div class="hello">Hola, ${esc(S.profile.name)}</div></div></div>
      <div class="top-r">
        ${si.freezes ? `<div class="pill shield" title="Protectores de racha">${icon('shield')}<b>${si.freezes}</b></div>` : ''}
        <div class="pill streak ${si.state}" title="Racha">${icon('flame')}<b>${si.n}</b></div>
      </div>
    </header>
    <main id="view" class="page"></main>
    <nav class="tabs">${tabs.map((t) => (t
      ? `<button data-tab="${t[0]}" class="${S.tab === t[0] ? 'on' : ''}">${icon(t[1])}<span>${t[2]}</span></button>`
      : `<button class="cam-btn" id="cam" aria-label="Añadir comida">${icon('plus')}</button>`)).join('')}</nav>`;
  app.querySelectorAll('[data-tab]').forEach((b) => { b.onclick = () => { S.tab = b.dataset.tab; render(); window.scrollTo(0, 0); }; });
  $('#cam').onclick = () => openAdd();
  ({ hoy: viewHoy, progreso: viewProgreso, pareja: viewPareja, perfil: viewPerfil })[S.tab]($('#view'));
}

/* ================= HOY ================= */
function ringSvg(val, goal, size = 150, stroke = 13) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r, pct = Math.min(val / goal, 1);
  return `<svg viewBox="0 0 ${size} ${size}" class="ring ${val > goal ? 'over' : ''}">
    <defs><linearGradient id="rg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" style="stop-color:var(--accent)"/><stop offset="1" style="stop-color:var(--accent-2)"/></linearGradient></defs>
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" class="track" stroke-width="${stroke}"/>
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" class="bar" stroke-width="${stroke}" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - pct)}" transform="rotate(-90 ${size / 2} ${size / 2})"/>
  </svg>`;
}
const macroBar = (cls, label, val, goal) => `<div class="macro ${cls}">
  <div class="macro-top"><span>${label}</span><b>${r0(val)}<small> / ${goal} g</small></b></div>
  <div class="mbar"><div style="width:${Math.min(100, (val / goal) * 100)}%"></div></div></div>`;

function weekStrip() {
  let out = '';
  for (let i = 6; i >= 0; i--) {
    const d = addDays(S.today, -i);
    const ms = S.weekMeals.filter((m) => m.day === d);
    const c = ms.some((m) => m.type === 'comida'), n = ms.some((m) => m.type === 'cena');
    const st = c && n ? 'full' : c || n ? 'half' : 'none';
    out += `<div class="wd ${st} ${i === 0 ? 'today' : ''}"><small>${LETTERS[toDate(d).getDay()]}</small><span>${st === 'full' ? icon('flame') : toDate(d).getDate()}</span></div>`;
  }
  return `<div class="week">${out}</div>`;
}

function viewHoy(v) {
  const t = targets(S.profile);
  const meals = todayMeals();
  const tot = sumM(meals);
  const left = t.kcal - tot.k;
  const si = streakInfo(S.profile, S.today);
  const has = (x) => meals.some((m) => m.type === x);
  const falta = ['comida', 'cena'].filter((x) => !has(x));
  let banner;
  if (si.state === 'done') banner = `<div class="banner ok">${icon('check')}<span>¡Día completado! Llevas <b>${si.n}</b> ${si.n === 1 ? 'día' : 'días'} de racha.</span></div>`;
  else if (si.state === 'pending') banner = `<div class="banner warn">${icon('flame')}<span>Registra la ${falta.join(' y la ')} para mantener tu racha de <b>${si.n}</b>.${si.saved ? ' Ayer se te olvidó, pero un protector la salvará.' : ''}</span></div>`;
  else banner = `<div class="banner">${icon('flame')}<span>Registra la comida y la cena para empezar una racha.${si.best ? ` Tu récord: <b>${si.best}</b>.` : ''}</span></div>`;

  const mealCard = (m) => {
    const items = meals.filter((x) => x.type === m.id);
    if (!m.required && !items.length) return '';
    const s = sumM(items);
    return `<section class="card meal">
      <div class="meal-head">
        <div class="meal-title"><span class="tile">${icon(m.icon)}</span><div><b>${m.label}</b><small class="muted">${items.length ? `${s.k} kcal · ${r0(s.p)} g prot.` : 'Sin registrar'}</small></div></div>
        ${m.required ? (items.length ? `<span class="chip ok">${icon('check')}Hecho</span>` : '<span class="chip">Pendiente</span>') : ''}
      </div>
      ${items.map((x) => `<div class="item" data-edit="${x.id}" role="button" tabindex="0">
          <div class="item-main"><span class="item-name">${esc(x.name)}</span>
          <small class="item-macros">${x.qty ? `${x.qty} g ·` : ''}<i class="dot prot"></i>${r0(x.p)}g <i class="dot carb"></i>${r0(x.c)}g <i class="dot fat"></i>${r0(x.g)}g</small></div>
          <span class="item-k">${x.kcal}<small>kcal</small></span>
          <button class="icon-btn del" data-del="${x.id}" aria-label="Quitar ${esc(x.name)}">${icon('trash')}</button></div>`).join('')}
      <button class="add-line" data-add="${m.id}">${icon('plus')}Añadir a ${m.label.toLowerCase()}</button>
    </section>`;
  };

  v.innerHTML = `
    ${weekStrip()}
    ${banner}
    <section class="card summary">
      <div class="ring-wrap">${ringSvg(tot.k, t.kcal)}
        <div class="ring-txt"><b>${Math.abs(left)}</b><small>${left >= 0 ? 'kcal restantes' : 'kcal de más'}</small></div></div>
      <div class="summary-side">
        <div class="kv"><small class="muted">Comido</small><b>${tot.k}</b></div>
        <div class="kv"><small class="muted">Objetivo</small><b>${t.kcal}</b></div>
      </div>
    </section>
    <section class="card macros">
      ${macroBar('prot', 'Proteínas', tot.p, t.prot)}
      ${macroBar('carb', 'Carbohidratos', tot.c, t.carb)}
      ${macroBar('fat', 'Grasas', tot.g, t.fat)}
    </section>
    ${MEALS.map(mealCard).join('')}
    <div class="extra-add">
      ${has('desayuno') ? '' : `<button class="btn soft sm" data-add="desayuno">${icon('coffee')}Desayuno</button>`}
      ${has('picoteo') ? '' : `<button class="btn soft sm" data-add="picoteo">${icon('apple')}Picoteo</button>`}
    </div>
    <section class="card water">
      <div class="meal-head"><div class="meal-title"><span class="tile water-tile">${icon('droplet')}</span>
        <div><b>Agua</b><small class="muted">${S.water * 250} ml de ${WATER_GOAL * 250} ml</small></div></div></div>
      <div class="drops">${Array.from({ length: WATER_GOAL }, (_, i) => `<button class="drop ${i < S.water ? 'on' : ''}" data-w="${i}" aria-label="Vaso ${i + 1}">${icon('droplet')}</button>`).join('')}</div>
    </section>`;

  v.querySelectorAll('[data-add]').forEach((b) => { b.onclick = () => openAdd(b.dataset.add); });
  v.querySelectorAll('[data-del]').forEach((b) => { b.onclick = (e) => { e.stopPropagation(); deleteMeal(b.dataset.del); }; });
  v.querySelectorAll('[data-edit]').forEach((b) => {
    const open = () => { const m = S.weekMeals.find((x) => x.id === b.dataset.edit); if (m) openAdd(m.type, m); };
    b.onclick = open;
    b.onkeydown = (e) => { if (e.key === 'Enter') open(); };
  });
  v.querySelectorAll('[data-w]').forEach((b) => {
    b.onclick = async () => {
      const i = +b.dataset.w;
      S.water = i + 1 === S.water ? i : i + 1;
      render();
      try { await setDoc(doc(daysCol(), S.today), { day: S.today, water: S.water }, { merge: true }); }
      catch (e) { toast('No se pudo guardar el agua'); }
    };
  });
}

/* ---------- guardar / editar / borrar comidas ---------- */
function cleanMeal(d) {
  return {
    type: d.type, name: String(d.name || 'Comida').slice(0, 60), kcal: Math.max(0, r0(d.kcal)),
    p: Math.max(0, r1(d.p)), c: Math.max(0, r1(d.c)), g: Math.max(0, r1(d.g)),
    qty: d.qty > 0 ? r0(d.qty) : null, // gramos comidos (si se conocen)
  };
}

async function saveMeal(data, { undo = false } = {}) {
  const full = { day: S.today, ts: Date.now(), ...cleanMeal(data) };
  const ref = await addDoc(mealsCol(), full);
  S.weekMeals.push({ id: ref.id, ...full });
  const upd = {};
  const r = nextStreak(S.profile, isComplete(), S.today);
  if (r) upd.streak = r.st;
  if (!undo) {
    const rec = { n: full.name, k: full.kcal, m: [full.p, full.c, full.g], u: 'como la última vez', ...(full.qty ? { q: full.qty } : {}) };
    upd.recents = [rec, ...(S.profile.recents || []).filter((x) => norm(x.n) !== norm(rec.n))].slice(0, 12);
  }
  if (Object.keys(upd).length) { await updateDoc(userRef(), upd); Object.assign(S.profile, upd); }
  render();
  if (r && r.celebrate && !undo) celebrate(r.st.count, r.earned);
  return !!(r && r.celebrate);
}

async function updateMeal(id, data) {
  const clean = cleanMeal(data);
  await updateDoc(doc(mealsCol(), id), clean);
  Object.assign(S.weekMeals.find((x) => x.id === id), clean);
  const r = nextStreak(S.profile, isComplete(), S.today);
  if (r) { await updateDoc(userRef(), { streak: r.st }); S.profile.streak = r.st; }
  render();
  if (r && r.celebrate) celebrate(r.st.count, r.earned);
}

async function deleteMeal(id) {
  const m = S.weekMeals.find((x) => x.id === id);
  if (!m) return;
  try {
    await deleteDoc(doc(mealsCol(), id));
    S.weekMeals = S.weekMeals.filter((x) => x.id !== id);
    const r = nextStreak(S.profile, isComplete(), S.today);
    if (r) { await updateDoc(userRef(), { streak: r.st }); S.profile.streak = r.st; }
    render();
    const { id: _id, ...data } = m;
    toast(`Quitado: ${esc(m.name)}`, { label: 'Deshacer', fn: () => saveMeal(data, { undo: true }) });
  } catch (e) { toast('No se pudo quitar: ' + esc(e.message)); }
}

/* ================= hoja inferior "añadir comida" ================= */
let A = null;
const body = () => $('#sheet-body');

function defaultType() {
  const h = new Date().getHours();
  const has = (t) => todayMeals().some((m) => m.type === t);
  if (h < 11 && !has('desayuno')) return 'desayuno';
  if (h < 18) return has('comida') && !has('cena') && h >= 16 ? 'cena' : 'comida';
  return 'cena';
}

function openAdd(type, existing) {
  A = { type: type || defaultType() };
  const root = $('#sheet-root');
  root.innerHTML = `<div class="backdrop"></div><div class="sheet" role="dialog" aria-modal="true">
    <div class="grab"></div><button class="icon-btn close" aria-label="Cerrar">${icon('x')}</button><div id="sheet-body"></div></div>`;
  root.querySelector('.backdrop').onclick = closeSheet;
  root.querySelector('.close').onclick = closeSheet;
  document.body.classList.add('noscroll');
  enableDrag(root.querySelector('.sheet'));
  if (existing) stepForm(null, existing); else stepPick();
}
function closeSheet() {
  const sh = $('.sheet');
  if (!sh) return;
  sh.classList.add('closing'); $('.backdrop').classList.add('closing');
  setTimeout(() => { $('#sheet-root').innerHTML = ''; document.body.classList.remove('noscroll'); }, 200);
  A = null;
}
/** Deslizar hacia abajo para cerrar. */
function enableDrag(sh) {
  let y0 = null, dy = 0;
  sh.addEventListener('touchstart', (e) => { if (sh.scrollTop <= 0) { y0 = e.touches[0].clientY; dy = 0; } }, { passive: true });
  sh.addEventListener('touchmove', (e) => {
    if (y0 == null) return;
    dy = e.touches[0].clientY - y0;
    if (dy > 0) sh.style.transform = `translateY(${dy}px)`; else { y0 = null; sh.style.transform = ''; }
  }, { passive: true });
  sh.addEventListener('touchend', () => {
    if (y0 == null) return;
    y0 = null;
    if (dy > 110) closeSheet(); else sh.style.transform = '';
  });
}

function typeSeg() {
  return `<div class="seg type-seg" role="radiogroup" aria-label="Tipo de comida">${MEALS.map((m) => `<label><input type="radio" name="mtype" value="${m.id}" ${A.type === m.id ? 'checked' : ''}><span>${icon(m.icon)}${m.label}</span></label>`).join('')}</div>`;
}
function bindTypeSeg() { body().querySelectorAll('input[name=mtype]').forEach((r) => { r.onchange = () => { A.type = r.value; }; }); }

function stepPick() {
  const rec = (S.profile.recents || []).slice(0, 12);
  body().innerHTML = `
    <h2 class="sheet-title">Añadir comida</h2>
    ${typeSeg()}
    <label class="hero-btn"><span class="hero-ic">${icon('camera')}</span><span><b>Hacer foto al plato</b><small>Lo reconoce tu propio móvil, gratis</small></span>${icon('chevron', 'chev')}
      <input type="file" accept="image/*" capture="environment" id="ph-cam" hidden></label>
    <div class="grid4">
      <label class="mini-btn">${icon('image')}<span>Galería</span><input type="file" accept="image/*" id="ph-gal" hidden></label>
      <button class="mini-btn" id="m-bar">${icon('barcode')}<span>Código</span></button>
      <button class="mini-btn" id="m-search">${icon('search')}<span>Buscar</span></button>
      <button class="mini-btn" id="m-manual">${icon('pencil')}<span>A mano</span></button>
    </div>
    ${rec.length ? `<h3 class="sub">${icon('clock')}Recientes</h3>
      <div class="recents">${rec.map((r, i) => `<button class="recent" data-r="${i}"><b>${esc(r.n)}</b><small>${r.k} kcal</small></button>`).join('')}</div>` : ''}`;
  bindTypeSeg();
  const onFile = (e) => { const f = e.target.files[0]; if (f) stepPhoto(f); };
  $('#ph-cam').onchange = onFile;
  $('#ph-gal').onchange = onFile;
  $('#m-bar').onclick = stepBarcode;
  $('#m-search').onclick = () => stepSearch('');
  $('#m-manual').onclick = () => stepForm({ n: '', k: 0, m: [0, 0, 0], u: '' });
  body().querySelectorAll('[data-r]').forEach((b) => { b.onclick = () => stepForm(rec[+b.dataset.r]); });
}

async function stepPhoto(file) {
  const url = URL.createObjectURL(file);
  body().innerHTML = `
    <h2 class="sheet-title">Analizando…</h2>
    <div class="scan"><img src="${url}" alt=""><div class="scan-line"></div><div class="scan-corners"></div></div>
    <div class="progress"><div id="pbar"></div></div>
    <p class="muted center" id="pmsg">Reconociendo el plato…</p>`;
  let downloaded = false;
  try {
    const { classifyFood } = await import('./ai.js');
    const res = await classifyFood(file, (p) => {
      downloaded = true;
      const bar = $('#pbar'); if (!bar) return;
      bar.style.width = Math.round(p * 100) + '%';
      $('#pmsg').textContent = `Descargando el escáner (solo la primera vez): ${Math.round(p * 100)} %`;
    });
    if (!A) return;
    body().innerHTML = `
      <h2 class="sheet-title">¿Qué es?</h2>
      <div class="scan done"><img src="${url}" alt=""></div>
      ${typeSeg()}
      <div class="guesses">
        ${res.map((r, i) => `<button class="guess" data-i="${i}">
          <span class="guess-main"><b>${esc(r.food.n)}</b><small class="muted">${esc(r.food.u)} (${r.food.q} g) · ${r.food.k} kcal · ${r.food.m[0]} g prot.</small></span>
          <span class="pct"><i style="width:${Math.max(6, Math.round(r.p * 100))}%"></i><em>${Math.round(r.p * 100)}%</em></span></button>`).join('')}
      </div>
      <button class="btn ghost" id="none">${icon('search')}No es ninguno, buscar</button>
      ${downloaded ? '<p class="muted center tiny">El escáner ya está guardado en este móvil.</p>' : ''}`;
    bindTypeSeg();
    body().querySelectorAll('.guess').forEach((b) => { b.onclick = () => stepForm(res[+b.dataset.i].food); });
    $('#none').onclick = () => stepSearch('');
  } catch (e) {
    console.error(e);
    if (!A) return;
    body().innerHTML = `<h2 class="sheet-title">No se pudo analizar</h2>
      <p class="muted">Comprueba la conexión (la primera vez hay que descargar el escáner) o busca el plato.</p>
      <button class="btn primary big" id="srch">${icon('search')}Buscar plato</button>`;
    $('#srch').onclick = () => stepSearch('');
  }
}

function stepSearch(q) {
  body().innerHTML = `
    <h2 class="sheet-title">Buscar plato</h2>
    ${typeSeg()}
    <div class="search-box">${icon('search')}<input id="q" placeholder="Lentejas, pizza, pollo…" value="${esc(q)}" autocomplete="off"></div>
    <div class="results" id="res"></div>`;
  bindTypeSeg();
  const draw = () => {
    const raw = $('#q').value.trim(), t = norm(raw);
    const list = t ? FOODS.filter((f) => norm(f.n).includes(t)) : FOODS;
    $('#res').innerHTML = list.slice(0, 60).map((f) => `<button class="guess" data-n="${esc(f.n)}">
        <span class="guess-main"><b>${esc(f.n)}</b><small class="muted">${esc(f.u)} (${f.q} g) · ${f.m[0]} g prot.</small></span><span class="kc-val">${f.k}<small>kcal</small></span></button>`).join('')
      + `<button class="guess manual" id="man">${icon('pencil')}<b>Añadir “${esc(raw || 'otra cosa')}” a mano</b></button>`;
    $('#res').querySelectorAll('[data-n]').forEach((b) => { b.onclick = () => stepForm(FOODS.find((f) => f.n === b.dataset.n)); });
    $('#man').onclick = () => stepForm({ n: raw, k: 0, m: [0, 0, 0], u: '' });
  };
  $('#q').oninput = draw;
  draw();
}

/** Formulario final: ración, calorías y macros. Sirve para añadir y para editar. */
function stepForm(food, existing) {
  if (existing) A.type = existing.type;
  // "base": una cantidad conocida (q gramos) con sus calorías y macros → se puede escalar a cualquier peso.
  const base = existing
    ? (existing.qty && existing.kcal ? { k: existing.kcal, m: [existing.p || 0, existing.c || 0, existing.g || 0], q: existing.qty, u: '' } : null)
    : (food && food.k > 0 && food.q > 0 ? food : null);
  const v = existing
    ? { n: existing.name, k: existing.kcal, p: existing.p || 0, c: existing.c || 0, g: existing.g || 0 }
    : { n: food.n, k: food.k || '', p: food.m ? food.m[0] : '', c: food.m ? food.m[1] : '', g: food.m ? food.m[2] : '' };
  const per100 = base ? { k: (base.k / base.q) * 100, p: (base.m[0] / base.q) * 100, c: (base.m[1] / base.q) * 100, g: (base.m[2] / base.q) * 100 } : null;
  body().innerHTML = `
    <h2 class="sheet-title">${existing ? 'Editar comida' : base ? '¿Cuánto has comido?' : 'Añadir a mano'}</h2>
    ${typeSeg()}
    <form id="pf" class="form">
      <input name="name" class="big-input sm" value="${esc(v.n)}" required maxlength="60" placeholder="¿Qué has comido?" aria-label="Nombre">
      ${base ? `<label class="unit-input qty-input"><span>Cantidad <small class="muted">${base.u === 'como la última vez' ? `· la última vez: ${base.q} g` : base.u ? `· 1 ración (${esc(base.u)}) ≈ ${base.q} g` : ''}</small></span>
          <input name="qty" type="number" inputmode="decimal" min="1" max="5000" value="${base.q}" required><em>g</em></label>
        <div class="qchips">${(existing || base.u === 'como la última vez' ? [[0.5, '½'], [1, 'Igual'], [1.5, '×1,5'], [2, 'Doble']] : [[0.5, '½ ración'], [1, '1 ración'], [1.5, '1½'], [2, 'Doble']])
          .map(([x, l]) => `<button type="button" class="qchip ${x === 1 ? 'on' : ''}" data-x="${x}">${l}<small>${r0(base.q * x)} g</small></button>`).join('')}</div>
        <p class="muted tiny per100">Por cada 100 g: <b>${r0(per100.k)} kcal</b> · P ${r1(per100.p)} · C ${r1(per100.c)} · G ${r1(per100.g)}</p>` : ''}
      <label class="unit-input kcal-input"><span>Calorías</span><input name="kcal" type="number" inputmode="numeric" min="0" max="5000" value="${v.k}" required placeholder="0"><em>kcal</em></label>
      <div class="macro-inputs">
        <label class="mi prot"><span>Proteínas</span><input name="p" type="number" inputmode="decimal" step="0.1" min="0" max="500" value="${v.p}" placeholder="0"><em>g</em></label>
        <label class="mi carb"><span>Carbos</span><input name="c" type="number" inputmode="decimal" step="0.1" min="0" max="900" value="${v.c}" placeholder="0"><em>g</em></label>
        <label class="mi fat"><span>Grasas</span><input name="g" type="number" inputmode="decimal" step="0.1" min="0" max="500" value="${v.g}" placeholder="0"><em>g</em></label>
      </div>
      <p class="muted tiny">${existing ? 'Cambia lo que necesites.' : 'Son valores aproximados: si sabes el dato exacto, cámbialo.'}</p>
      <button class="btn primary big" type="submit">${existing ? 'Guardar cambios' : 'Guardar'}</button>
      ${existing ? `<button class="btn danger-soft big" type="button" id="delb">${icon('trash')}Quitar esta comida</button>` : ''}
    </form>`;
  bindTypeSeg();
  const f = $('#pf');
  if (base) {
    // Al cambiar los gramos se recalculan calorías y macros.
    const recalc = () => {
      const x = (+f.qty.value || 0) / base.q;
      f.kcal.value = r0(base.k * x);
      f.p.value = r1(base.m[0] * x); f.c.value = r1(base.m[1] * x); f.g.value = r1(base.m[2] * x);
      f.querySelectorAll('.qchip').forEach((b) => b.classList.toggle('on', Math.abs(base.q * +b.dataset.x - +f.qty.value) < 0.5));
    };
    f.qty.oninput = recalc;
    f.querySelectorAll('.qchip').forEach((b) => { b.onclick = () => { f.qty.value = r0(base.q * +b.dataset.x); recalc(); }; });
  }
  f.onsubmit = async (e) => {
    e.preventDefault();
    const btn = f.querySelector('button[type=submit]'); btn.disabled = true;
    const data = { type: A.type, name: f.name.value.trim(), kcal: +f.kcal.value, p: +f.p.value, c: +f.c.value, g: +f.g.value, qty: base ? +f.qty.value : (existing && existing.qty) || null };
    try {
      if (existing) { await updateMeal(existing.id, data); closeSheet(); toast('Cambios guardados'); }
      else {
        const celebrated = await saveMeal(data);
        closeSheet();
        if (!celebrated) toast(`${icon('check')} Añadido a ${mealLabel(data.type).toLowerCase()}`);
      }
    } catch (err) { toast('Error al guardar: ' + esc(err.message)); btn.disabled = false; }
  };
  if (existing) $('#delb').onclick = () => { closeSheet(); deleteMeal(existing.id); };
  if (!v.n) f.name.focus();
}

/* ---------- código de barras (Open Food Facts, gratis) ---------- */
function loadQR() {
  if (window.Html5Qrcode) return Promise.resolve();
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/html5-qrcode@2.3.8/html5-qrcode.min.js';
    s.onload = res; s.onerror = () => rej(new Error('No se pudo cargar el lector'));
    document.head.appendChild(s);
  });
}

function stepBarcode() {
  body().innerHTML = `
    <h2 class="sheet-title">Código de barras</h2>
    ${typeSeg()}
    <label class="hero-btn"><span class="hero-ic">${icon('barcode')}</span><span><b>Hacer foto al código</b><small>Acércate para que se vea grande y nítido</small></span>${icon('chevron', 'chev')}
      <input type="file" accept="image/*" capture="environment" id="bc-cam" hidden></label>
    <form id="bcf" class="form inline">
      <input name="code" inputmode="numeric" placeholder="O escribe los números" pattern="[0-9]{6,14}" required aria-label="Número del código">
      <button class="btn primary" type="submit">Buscar</button>
    </form>
    <p class="muted center" id="bcmsg"></p>`;
  bindTypeSeg();
  $('#bc-cam').onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    $('#bcmsg').textContent = 'Leyendo código…';
    try {
      await loadQR();
      const q = new window.Html5Qrcode('qr-hidden', false);
      const code = await q.scanFile(f, false);
      try { q.clear(); } catch { /* nada */ }
      lookupBarcode(code);
    } catch { $('#bcmsg').textContent = 'No se ha podido leer. Prueba más cerca o escribe los números.'; }
  };
  $('#bcf').onsubmit = (e) => { e.preventDefault(); lookupBarcode(e.target.code.value.trim()); };
}

async function lookupBarcode(code) {
  const msg = $('#bcmsg');
  if (msg) msg.textContent = `Buscando ${code}…`;
  try {
    const r = await fetch(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json?fields=product_name,product_name_es,brands,nutriments,serving_quantity`);
    const j = await r.json();
    if (j.status !== 1 || !j.product) throw new Error('nf');
    const p = j.product, n = p.nutriments || {};
    let k100 = n['energy-kcal_100g'];
    if (k100 == null && n.energy_100g != null) k100 = n.energy_100g / 4.184;
    if (k100 == null) throw new Error('nk');
    const name = [p.product_name_es || p.product_name, p.brands && p.brands.split(',')[0]].filter(Boolean).join(' · ') || 'Producto';
    stepProduct(name, { k: +k100, p: +n.proteins_100g || 0, c: +n.carbohydrates_100g || 0, g: +n.fat_100g || 0 }, +p.serving_quantity || 100);
  } catch (e) {
    if (msg) msg.textContent = e.message === 'nk'
      ? 'El producto existe pero no tiene calorías registradas. Añádelo a mano.'
      : 'No encontrado en Open Food Facts. Añádelo a mano.';
  }
}

function stepProduct(name, per100, grams) {
  body().innerHTML = `
    <h2 class="sheet-title">Producto</h2>
    ${typeSeg()}
    <form id="prf" class="form">
      <input name="name" class="big-input sm" value="${esc(name)}" required maxlength="60" aria-label="Nombre">
      <p class="muted tiny">Por 100 g: ${r0(per100.k)} kcal · P ${r1(per100.p)} · C ${r1(per100.c)} · G ${r1(per100.g)}</p>
      <label class="unit-input"><span>Cantidad</span><input name="gr" type="number" inputmode="numeric" min="1" max="3000" value="${r0(grams)}" required><em>g</em></label>
      <div class="plan-macros small" id="pk"></div>
      <button class="btn primary big" type="submit">Guardar</button>
    </form>`;
  bindTypeSeg();
  const f = $('#prf');
  const calc = () => { const x = (+f.gr.value || 0) / 100; return { kcal: r0(per100.k * x), p: r1(per100.p * x), c: r1(per100.c * x), g: r1(per100.g * x) }; };
  const upd = () => {
    const c = calc();
    $('#pk').innerHTML = `<div class="pm kc"><b>${c.kcal}</b><span>kcal</span></div><div class="pm prot"><b>${c.p} g</b><span>Prot.</span></div><div class="pm carb"><b>${c.c} g</b><span>Carbos</span></div><div class="pm fat"><b>${c.g} g</b><span>Grasas</span></div>`;
  };
  f.gr.oninput = upd; upd();
  f.onsubmit = async (e) => {
    e.preventDefault();
    const b = f.querySelector('button[type=submit]'); b.disabled = true;
    try { const cel = await saveMeal({ type: A.type, name: f.name.value.trim(), ...calc(), qty: +f.gr.value }); closeSheet(); if (!cel) toast(`${icon('check')} Añadido`); }
    catch (err) { toast('Error: ' + esc(err.message)); b.disabled = false; }
  };
}

/* ================= PROGRESO ================= */
function weightChart(weights, target) {
  const pts = weights.slice(-90);
  if (pts.length < 2) return '<p class="muted center empty">Añade más pesos para ver tu gráfica.</p>';
  const W = 340, H = 170, P = 14, PB = 26, PL = 34;
  const ks = pts.map((p) => p.kg).concat(target ? [target] : []);
  let lo = Math.min(...ks), hi = Math.max(...ks);
  if (hi - lo < 1) { lo -= 0.5; hi += 0.5; }
  lo -= (hi - lo) * 0.08; hi += (hi - lo) * 0.08;
  const x = (i) => PL + (i * (W - PL - P)) / (pts.length - 1);
  const y = (k) => P + ((hi - k) * (H - P - PB)) / (hi - lo);
  const line = pts.map((p, i) => `${x(i).toFixed(1)},${y(p.kg).toFixed(1)}`).join(' ');
  const area = `${PL},${H - PB} ${line} ${x(pts.length - 1).toFixed(1)},${H - PB}`;
  const last = pts.length - 1;
  const ticks = [hi, (hi + lo) / 2, lo].map((k) => `<line x1="${PL}" x2="${W - P}" y1="${y(k)}" y2="${y(k)}" class="grid"/><text x="${PL - 6}" y="${y(k) + 4}" class="lbl" text-anchor="end">${r0(k)}</text>`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="Evolución del peso">
    <defs><linearGradient id="wa" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--accent);stop-opacity:.28"/><stop offset="1" style="stop-color:var(--accent);stop-opacity:0"/></linearGradient></defs>
    ${ticks}
    ${target ? `<line x1="${PL}" x2="${W - P}" y1="${y(target)}" y2="${y(target)}" class="target"/><text x="${W - P}" y="${y(target) - 5}" class="lbl tgt" text-anchor="end">objetivo ${fmtKg(target)}</text>` : ''}
    <polygon points="${area}" fill="url(#wa)"/>
    <polyline points="${line}" class="line"/>
    <circle cx="${x(last)}" cy="${y(pts[last].kg)}" r="5" class="dot"/>
    <text x="${PL}" y="${H - 6}" class="lbl">${fmtDay(pts[0].day)}</text>
    <text x="${W - P}" y="${H - 6}" class="lbl" text-anchor="end">${fmtDay(pts[last].day)}</text>
  </svg>`;
}

/** Pendiente del peso (kg/día) con los datos de las últimas 6 semanas. */
function slope(ws) {
  const rec = ws.filter((w) => diffDays(w.day, S.today) <= 42);
  if (rec.length < 3) return null;
  const xs = rec.map((w) => diffDays(rec[0].day, w.day)), ys = rec.map((w) => w.kg);
  const n = xs.length, mx = xs.reduce((a, b) => a + b) / n, my = ys.reduce((a, b) => a + b) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) ** 2; }
  return den ? num / den : null;
}

function viewProgreso(v) {
  const p = S.profile, ws = S.weights, t = targets(p);
  const first = ws[0] ? ws[0].kg : p.startWeight;
  const cur = ws.length ? ws[ws.length - 1].kg : p.weight;
  const diff = cur - first;
  const tw = p.targetWeight;
  let goalHtml = `<p class="muted">Pon un peso objetivo en <b>Perfil</b> para ver cuánto te falta.</p>`;
  if (tw) {
    const total = Math.abs(first - tw) || 1, done = Math.min(1, Math.max(0, Math.abs(first - cur) / total * (Math.sign(first - tw) === Math.sign(first - cur) ? 1 : 0)));
    const sl = slope(ws), rest = tw - cur;
    let eta = '';
    if (Math.abs(rest) < 0.1) eta = '¡Objetivo conseguido! 🎉';
    else if (sl && Math.sign(sl) === Math.sign(rest)) {
      const d = new Date(); d.setDate(d.getDate() + Math.round(rest / sl));
      eta = `A este ritmo, lo conseguirás hacia el <b>${d.toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' })}</b>.`;
    } else eta = 'Sigue registrando tu peso para calcular cuándo llegarás.';
    goalHtml = `<div class="goal-line"><span>${fmtKg(first)} kg</span><span>${icon('target')} ${fmtKg(tw)} kg</span></div>
      <div class="mbar big"><div style="width:${done * 100}%"></div></div>
      <p class="muted tiny">Te faltan <b>${fmtKg(Math.abs(rest))} kg</b>. ${eta}</p>`;
  }
  // semana
  const days = Array.from({ length: 7 }, (_, i) => addDays(S.today, i - 6));
  const sums = days.map((d) => sumM(S.weekMeals.filter((m) => m.day === d)));
  const logged = sums.filter((s) => s.k > 0);
  const avgK = logged.length ? r0(logged.reduce((a, s) => a + s.k, 0) / logged.length) : 0;
  const avgP = logged.length ? r0(logged.reduce((a, s) => a + s.p, 0) / logged.length) : 0;
  const maxK = Math.max(t.kcal * 1.25, ...sums.map((s) => s.k));

  v.innerHTML = `
    <h1 class="page-title">Progreso</h1>
    <section class="card weight-hero">
      <div><small class="muted">Peso actual</small><div class="big-num">${fmtKg(cur)}<small> kg</small></div>
        <span class="chip ${diff <= 0 ? 'ok' : 'warn'}">${diff <= 0 ? icon('trend') : icon('trendUp')}${diff <= 0 ? '−' : '+'}${fmtKg(Math.abs(diff))} kg desde el inicio</span></div>
      <form id="wf" class="weight-form">
        <input name="kg" type="number" inputmode="decimal" step="0.1" min="30" max="300" placeholder="${fmtKg(cur)}" required aria-label="Nuevo peso en kg">
        <input name="day" type="date" value="${S.today}" max="${S.today}" required aria-label="Fecha">
        <button class="btn primary" type="submit">${icon('plus')}Añadir</button>
      </form>
    </section>
    <section class="card"><h2>${icon('target')}Objetivo</h2>${goalHtml}</section>
    <section class="card"><h2>${icon('trend')}Evolución</h2>${weightChart(ws, tw)}</section>
    <section class="card">
      <h2>${icon('calendar')}Últimos 7 días</h2>
      <div class="week-bars">${days.map((d, i) => `<div class="wb"><div class="wb-col"><div class="wb-bar ${sums[i].k > t.kcal ? 'over' : ''}" style="height:${(sums[i].k / maxK) * 100}%"></div>
        <div class="wb-goal" style="bottom:${(t.kcal / maxK) * 100}%"></div></div><small>${LETTERS[toDate(d).getDay()]}</small></div>`).join('')}</div>
      <div class="stats2"><div><small class="muted">Media de calorías</small><b>${avgK || '—'}</b></div><div><small class="muted">Media de proteínas</small><b>${avgP ? avgP + ' g' : '—'}</b></div></div>
    </section>
    <section class="card">
      <h2>Historial de peso</h2>
      <div class="wt">${ws.map((w, i) => {
        const d = i ? w.kg - ws[i - 1].kg : 0;
        return `<div class="wt-row"><span>${fmtDay(w.day)}</span><b>${fmtKg(w.kg)} kg</b>
          <span class="wt-d ${d < 0 ? 'down' : d > 0 ? 'up' : ''}">${i ? (d > 0 ? '+' : '−') + fmtKg(Math.abs(d)) : '—'}</span>
          <button class="icon-btn del" data-wdel="${w.id}" aria-label="Quitar peso">${icon('trash')}</button></div>`;
      }).reverse().join('') || '<p class="muted">Aún no hay pesos.</p>'}</div>
    </section>`;

  $('#wf').onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target, b = f.querySelector('button'); b.disabled = true;
    try {
      const data = { day: f.day.value, kg: r1(f.kg.value), ts: Date.now() };
      const ref = await addDoc(weightsCol(), data);
      S.weights.push({ id: ref.id, ...data });
      S.weights.sort((a, c) => (a.day === c.day ? a.ts - c.ts : a.day < c.day ? -1 : 1));
      await syncWeight();
      toast(`${icon('check')} Peso guardado`);
      render();
    } catch (err) { toast('Error: ' + esc(err.message)); b.disabled = false; }
  };
  v.querySelectorAll('[data-wdel]').forEach((b) => {
    b.onclick = async () => {
      const w = S.weights.find((x) => x.id === b.dataset.wdel);
      if (!w || !confirm(`¿Quitar el peso del ${fmtDay(w.day)} (${fmtKg(w.kg)} kg)?`)) return;
      await deleteDoc(doc(weightsCol(), w.id));
      S.weights = S.weights.filter((x) => x.id !== w.id);
      await syncWeight();
      render();
    };
  });
}

async function syncWeight() {
  if (!S.weights.length) return;
  const w = S.weights[S.weights.length - 1].kg;
  await updateDoc(userRef(), { weight: w });
  S.profile.weight = w;
}

/* ================= PAREJA ================= */
async function viewPareja(v) {
  v.innerHTML = '<h1 class="page-title">Pareja</h1><div class="card skeleton"></div><div class="card skeleton"></div>';
  try {
    const us = await getDocs(collection(db, 'users'));
    const people = await Promise.all(us.docs.map(async (d) => {
      const [ms, ws] = await Promise.all([
        getDocs(query(mealsCol(d.id), where('day', '==', S.today))),
        getDocs(query(weightsCol(d.id), orderBy('day'))),
      ]);
      return { uid: d.id, p: d.data(), meals: ms.docs.map((x) => x.data()), weights: ws.docs.map((x) => x.data()), me: d.id === S.user.uid };
    }));
    people.sort((a, b) => (a.me ? -1 : b.me ? 1 : 0));
    const other = people.filter((x) => !x.me);
    v.innerHTML = `
      <h1 class="page-title">Pareja</h1>
      ${other.length ? '' : `<div class="banner">${icon('heart')}<span>Tu pareja aún no ha entrado. Cuando lo haga, aquí veréis cómo va cada uno.</span></div>`}
      <section class="card duo">
        ${people.map((x) => { const si = streakInfo(x.p, S.today); return `<div class="duo-col">
          <div class="avatar lg">${esc((x.p.name || '?').charAt(0).toUpperCase())}</div>
          <b>${x.me ? 'Tú' : esc(x.p.name)}</b>
          <div class="pill streak ${si.state}">${icon('flame')}<b>${si.n}</b></div>
          <small class="muted">${icon('trophy')} récord ${si.best}</small></div>`; }).join(`<div class="duo-vs">${icon('heart')}</div>`)}
      </section>
      ${people.map((x) => {
        const t = targets(x.p), s = sumM(x.meals);
        const has = (k) => x.meals.some((m) => m.type === k);
        const first = x.weights[0] ? x.weights[0].kg : x.p.startWeight;
        const cur = x.weights.length ? x.weights[x.weights.length - 1].kg : x.p.weight;
        const d = cur - first;
        return `<section class="card person">
          <div class="person-head"><h2>${x.me ? 'Tú' : esc(x.p.name)}</h2><small class="muted">${esc((GOALS[x.p.goalType] || GOALS.perder).label)}</small></div>
          <div class="checks"><span class="${has('comida') ? 'on' : ''}">${icon(has('comida') ? 'check' : 'utensils')}Comida</span><span class="${has('cena') ? 'on' : ''}">${icon(has('cena') ? 'check' : 'moon')}Cena</span></div>
          ${macroBar('kc', 'Calorías', s.k, t.kcal).replace(/ g<\/small>/, ' kcal</small>')}
          ${macroBar('prot', 'Proteínas', s.p, t.prot)}
          <p class="muted">Peso: <b>${fmtKg(cur)} kg</b> · ${d <= 0 ? 'ha bajado' : 'ha subido'} ${fmtKg(Math.abs(d))} kg</p>
          ${weightChart(x.weights, x.p.targetWeight)}
        </section>`;
      }).join('')}`;
  } catch (e) {
    v.innerHTML = `<h1 class="page-title">Pareja</h1><p class="error center">No se pudo cargar: ${esc(e.message)}</p>`;
  }
}

/* ================= PERFIL ================= */
let themeSaveT;
function saveTheme(t) {
  S.profile.theme = applyTheme(t);
  clearTimeout(themeSaveT);
  themeSaveT = setTimeout(() => updateDoc(userRef(), { theme: S.profile.theme }).catch(() => {}), 700);
}

function viewPerfil(v) {
  const p = S.profile, auto = calcTargets(p), t = targets(p);
  const th = normTheme(p.theme || cachedTheme());
  const cs = getComputedStyle(document.documentElement);
  const curColor = (css) => { const val = cs.getPropertyValue(css).trim(); return /^#[0-9a-f]{6}$/i.test(val) ? val : '#888888'; };
  v.innerHTML = `
    <h1 class="page-title">Perfil</h1>
    <section class="card profile-card">
      <div class="avatar xl">${esc((p.name || '?').charAt(0).toUpperCase())}</div>
      <div><b class="pc-name">${esc(p.name)}</b><small class="muted">${esc(S.user.email)}</small>
        <div class="pc-stats"><span>${icon('flame')}${streakInfo(p, S.today).n} días</span><span>${icon('trophy')}récord ${(p.streak && p.streak.best) || 0}</span><span>${icon('shield')}${(p.streak && p.streak.freezes) || 0}</span></div></div>
    </section>

    <section class="card">
      <h2>${icon('target')}Mi objetivo</h2>
      <form id="gf" class="form">
        <div class="choices">${Object.entries(GOALS).map(([k, g]) => choice('goalType', k, (p.goalType || 'perder') === k, g.icon, g.label, g.desc)).join('')}</div>
        <div class="field"><span>Actividad</span><div class="seg">${Object.entries(ACTIVITY).map(([k, a]) => `<label><input type="radio" name="activity" value="${k}" ${(p.activity || 'media') === k ? 'checked' : ''}><span>${a.label}</span></label>`).join('')}</div></div>
        <div class="row2">
          <label class="unit-input sm"><span>Peso objetivo</span><input name="target" type="number" inputmode="decimal" step="0.1" min="30" max="300" value="${p.targetWeight || ''}" placeholder="—"><em>kg</em></label>
          <label class="unit-input sm"><span>Altura</span><input name="height" type="number" inputmode="numeric" min="120" max="230" value="${p.height}" required><em>cm</em></label>
        </div>
        <div class="row2">
          <label class="field"><span>Nombre</span><input name="name" value="${esc(p.name)}" required maxlength="20"></label>
          <div class="field"><span>Sexo</span><div class="seg"><label><input type="radio" name="sex" value="h" ${p.sex === 'h' ? 'checked' : ''}><span>Hombre</span></label><label><input type="radio" name="sex" value="m" ${p.sex === 'm' ? 'checked' : ''}><span>Mujer</span></label></div></div>
        </div>
        <button class="btn primary big" type="submit">Guardar objetivo</button>
      </form>
    </section>

    <section class="card">
      <h2>${icon('activity')}Calorías y macros</h2>
      <form id="mf" class="form">
        <div class="seg"><label><input type="radio" name="mode" value="auto" ${p.goalMode !== 'manual' ? 'checked' : ''}><span>Automático</span></label><label><input type="radio" name="mode" value="manual" ${p.goalMode === 'manual' ? 'checked' : ''}><span>Lo pongo yo</span></label></div>
        <div class="macro-inputs four">
          <label class="mi kc"><span>Calorías</span><input name="kcal" type="number" inputmode="numeric" min="800" max="6000" value="${t.kcal}"><em>kcal</em></label>
          <label class="mi prot"><span>Proteínas</span><input name="prot" type="number" inputmode="numeric" min="0" max="500" value="${t.prot}"><em>g</em></label>
          <label class="mi carb"><span>Carbos</span><input name="carb" type="number" inputmode="numeric" min="0" max="900" value="${t.carb}"><em>g</em></label>
          <label class="mi fat"><span>Grasas</span><input name="fat" type="number" inputmode="numeric" min="0" max="400" value="${t.fat}"><em>g</em></label>
        </div>
        <p class="muted tiny" id="minfo"></p>
        <button class="btn primary big" type="submit">Guardar</button>
      </form>
    </section>

    <section class="card">
      <h2>${icon('palette')}Apariencia</h2>
      <div class="field"><span>Modo</span><div class="seg" id="modeSeg">
        ${[['auto', 'phone', 'Auto'], ['light', 'sun', 'Claro'], ['dark', 'moon', 'Oscuro']].map(([k, ic, l]) => `<label><input type="radio" name="tmode" value="${k}" ${th.mode === k ? 'checked' : ''}><span class="with-ic">${icon(ic)}${l}</span></label>`).join('')}
      </div></div>
      <div class="field"><span>Tema</span><div class="swatches">
        ${Object.entries(PRESETS).map(([k, pr]) => `<button class="swatch ${th.preset === k && !th.custom.accent ? 'on' : ''}" data-preset="${k}" style="--s1:${pr.accent};--s2:${pr.accent2}" aria-label="${pr.name}"><i></i><small>${pr.name}</small></button>`).join('')}
      </div></div>
      <details class="custom-colors" ${Object.keys(th.custom).length ? 'open' : ''}>
        <summary>Personalizar cada color</summary>
        <div class="color-grid">${COLOR_KEYS.map(([k, l, css]) => `<label class="color-row"><input type="color" data-ck="${k}" value="${th.custom[k] || curColor(css)}"><span>${l}</span>${th.custom[k] ? '<em>cambiado</em>' : ''}</label>`).join('')}</div>
        <button class="btn ghost" id="resetColors">${icon('undo')}Volver a los colores del tema</button>
      </details>
    </section>

    <section class="card">
      <h2>${icon('sparkles')}Escáner de fotos</h2>
      <p class="muted">Funciona dentro de tu móvil y es gratis. La primera vez descarga unos 150 MB: mejor con WiFi.</p>
      <button class="btn soft big" id="prep">${icon('download')}Descargar escáner ahora</button>
      <div class="progress hidden" id="prepbar"><div></div></div>
    </section>

    <section class="card">
      <h2>${icon('phone')}Instalar en el iPhone</h2>
      <p class="muted">En Safari, pulsa ${icon('share', 'inline')} <b>Compartir</b> y luego <b>Añadir a pantalla de inicio</b>. Se abrirá como una app.</p>
      <p class="muted tiny">Las comidas se borran solas a los 30 días. El peso se guarda siempre.</p>
    </section>
    <button class="btn danger-soft big" id="logout">${icon('logout')}Cerrar sesión</button>`;

  // objetivo
  $('#gf').onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target;
    const data = { goalType: f.goalType.value, activity: f.activity.value, targetWeight: f.target.value ? r1(f.target.value) : null, height: +f.height.value, name: f.name.value.trim(), sex: f.sex.value };
    try { await updateDoc(userRef(), data); Object.assign(S.profile, data); toast(`${icon('check')} Objetivo guardado`); render(); }
    catch (err) { toast('Error: ' + esc(err.message)); }
  };
  // macros
  const mf = $('#mf');
  const updM = () => {
    const isAuto = mf.mode.value === 'auto';
    for (const k of ['kcal', 'prot', 'carb', 'fat']) { mf[k].readOnly = isAuto; if (isAuto) mf[k].value = auto[k]; }
    $('#minfo').textContent = isAuto ? `Calculado para "${(GOALS[p.goalType] || GOALS.perder).label.toLowerCase()}" con tu último peso. Se actualiza solo.` : 'Pon tus propios números (por ejemplo, los de tu nutricionista).';
  };
  mf.querySelectorAll('input[name=mode]').forEach((r) => { r.onchange = updM; });
  updM();
  mf.onsubmit = async (e) => {
    e.preventDefault();
    const data = mf.mode.value === 'manual'
      ? { goalMode: 'manual', manual: { kcal: +mf.kcal.value, prot: +mf.prot.value, carb: +mf.carb.value, fat: +mf.fat.value } }
      : { goalMode: 'auto' };
    try { await updateDoc(userRef(), data); Object.assign(S.profile, data); toast(`${icon('check')} Guardado`); render(); }
    catch (err) { toast('Error: ' + esc(err.message)); }
  };
  // apariencia
  v.querySelectorAll('input[name=tmode]').forEach((r) => { r.onchange = () => { saveTheme({ ...th, mode: r.value }); render(); }; });
  v.querySelectorAll('[data-preset]').forEach((b) => {
    b.onclick = () => {
      const custom = { ...th.custom }; delete custom.accent; delete custom.accent2;
      saveTheme({ ...th, preset: b.dataset.preset, custom }); render();
    };
  });
  v.querySelectorAll('[data-ck]').forEach((inp) => {
    inp.oninput = () => { th.custom[inp.dataset.ck] = inp.value; saveTheme(th); };
    inp.onchange = () => render();
  });
  $('#resetColors').onclick = () => { saveTheme({ ...th, custom: {} }); render(); };
  // escáner
  $('#prep').onclick = async () => {
    const btn = $('#prep'), bar = $('#prepbar');
    btn.disabled = true; bar.classList.remove('hidden');
    try {
      const { prepareScanner } = await import('./ai.js');
      await prepareScanner((x) => { bar.firstElementChild.style.width = Math.round(x * 100) + '%'; btn.lastChild.textContent = `Descargando… ${Math.round(x * 100)} %`; });
      bar.firstElementChild.style.width = '100%';
      btn.innerHTML = `${icon('check')}Escáner listo`;
    } catch (err) { btn.disabled = false; btn.innerHTML = `${icon('download')}Reintentar`; toast('Error: ' + esc(err.message)); }
  };
  $('#logout').onclick = () => { if (confirm('¿Cerrar sesión?')) signOut(auth); };
}
