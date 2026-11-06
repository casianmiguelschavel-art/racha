// Reconocimiento de platos 100 % en el móvil (gratis, sin servidores de pago).
// Usa CLIP, un modelo abierto que compara la foto con la lista de platos de foods.js.
// La primera vez descarga el modelo (~150 MB, mejor con WiFi); después queda guardado en el navegador.
import { FOODS, FOODS_VERSION } from './foods.js';

const LIB = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.0.2';
const MODEL = 'Xenova/clip-vit-base-patch32';
const CACHE_KEY = 'clipText_' + MODEL + '_' + FOODS_VERSION + '_' + FOODS.length;

let T = null;
let textEmbeds = null; // Float32Array [FOODS.length * dim], normalizado
let dim = 0;
let visionP = null;

async function lib() {
  if (!T) {
    T = await import(LIB);
    T.env.allowLocalModels = false;
  }
  return T;
}

function makeProgress(cb) {
  const files = {};
  return (p) => {
    if (p && p.status === 'progress' && p.file) {
      files[p.file] = { l: p.loaded || 0, t: p.total || 0 };
      let l = 0, t = 0;
      for (const f of Object.values(files)) { l += f.l; t += f.t; }
      if (cb && t) cb(l / t);
    }
  };
}

function normalizeRows(data, n, d) {
  const out = new Float32Array(n * d);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = 0; j < d; j++) s += data[i * d + j] ** 2;
    s = Math.sqrt(s) || 1;
    for (let j = 0; j < d; j++) out[i * d + j] = data[i * d + j] / s;
  }
  return out;
}

function toB64(f32) {
  const u8 = new Uint8Array(f32.buffer);
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}
function fromB64(b) {
  const s = atob(b);
  const u8 = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i);
  return new Float32Array(u8.buffer);
}

async function getTextEmbeds(progress) {
  if (textEmbeds) return textEmbeds;
  try {
    const c = localStorage.getItem(CACHE_KEY);
    if (c) {
      const arr = fromB64(c);
      if (arr.length % FOODS.length === 0) {
        textEmbeds = arr; dim = arr.length / FOODS.length;
        return textEmbeds;
      }
    }
  } catch { /* sin caché */ }

  const t = await lib();
  const tok = await t.AutoTokenizer.from_pretrained(MODEL);
  const model = await t.CLIPTextModelWithProjection.from_pretrained(MODEL, { dtype: 'q8', progress_callback: progress });
  const texts = FOODS.map((f) => `a photo of ${f.en}, a type of food.`);
  const chunks = [];
  for (let i = 0; i < texts.length; i += 16) {
    const inputs = tok(texts.slice(i, i + 16), { padding: true, truncation: true });
    const { text_embeds } = await model(inputs);
    dim = text_embeds.dims[1];
    chunks.push(Float32Array.from(text_embeds.data));
  }
  const all = new Float32Array(FOODS.length * dim);
  let off = 0;
  for (const c of chunks) { all.set(c, off); off += c.length; }
  textEmbeds = normalizeRows(all, FOODS.length, dim);
  try { await model.dispose?.(); } catch { /* nada */ }
  try { localStorage.setItem(CACHE_KEY, toB64(textEmbeds)); } catch { /* sin espacio: se recalcula */ }
  return textEmbeds;
}

function getVision(progress) {
  if (!visionP) {
    visionP = (async () => {
      const t = await lib();
      const [proc, model] = await Promise.all([
        t.AutoProcessor.from_pretrained(MODEL),
        t.CLIPVisionModelWithProjection.from_pretrained(MODEL, { dtype: 'q8', progress_callback: progress }),
      ]);
      return { proc, model };
    })();
    visionP.catch(() => { visionP = null; });
  }
  return visionP;
}

/** Descarga y prepara el modelo (opcional, para hacerlo con WiFi). */
export async function prepareScanner(onProgress) {
  const prog = makeProgress(onProgress);
  await getTextEmbeds(prog);
  await getVision(prog);
}

/** Devuelve los 3 platos más probables: [{ food, p }] con p entre 0 y 1. */
export async function classifyFood(file, onProgress) {
  const prog = makeProgress(onProgress);
  const emb = await getTextEmbeds(prog);
  const { proc, model } = await getVision(prog);
  const t = await lib();
  const img = await t.RawImage.fromBlob(file);
  const inputs = await proc(img);
  const { image_embeds } = await model(inputs);
  const v = normalizeRows(image_embeds.data, 1, dim);

  const logits = FOODS.map((_, i) => {
    let s = 0;
    for (let j = 0; j < dim; j++) s += emb[i * dim + j] * v[j];
    return s * 100;
  });
  const max = Math.max(...logits);
  const exps = logits.map((x) => Math.exp(x - max));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps
    .map((e, i) => ({ food: FOODS[i], p: e / sum }))
    .sort((a, b) => b.p - a.p)
    .slice(0, 3);
}
