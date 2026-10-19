// Reliques (capsules en interne) : une relique par heure, ouverture animée, collection par rareté / gamme / champion. PWA autonome servie par l'API.
const API = '/api/v1';
const DD = 'https://ddragon.leagueoflegends.com/cdn/img/champion';
const CD = 'https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/';
const RARITIES = ['COMMON', 'RARE', 'EPIC', 'LEGENDARY', 'MYTHIC', 'ULTIMATE', 'EXALTED'];
const LABEL = { COMMON: 'Commun', RARE: 'Rare', EPIC: 'Épique', LEGENDARY: 'Légendaire', MYTHIC: 'Mythique', ULTIMATE: 'Ultime', EXALTED: 'Exalté' };
const COLOR = { COMMON: '#8a94a6', RARE: '#19e3ff', EPIC: '#a78bfa', LEGENDARY: '#ff8a3d', MYTHIC: '#ff3366', ULTIMATE: '#ffc94d', EXALTED: '#ffffff' };
const CATALOG_KEY = 'capsules.catalog.v3';
const rank = (r) => RARITIES.indexOf(r);

const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* stockage indisponible */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* idem */ } },
};

const S = {
  token: store.get('capsules.token'),
  user: JSON.parse(store.get('capsules.user') || 'null'),
  wallet: null,
  clockOffset: 0,
  cat: null,
  owned: new Map(),
  recent: [],
  view: 'open',
  type: 'STANDARD',
  busy: false,
  sound: store.get('capsules.sound') !== 'off',
  coll: { group: 'rarity', q: '', missing: false, rarity: null, open: new Set(), limits: {} },
  pushKey: null,
  roster: [null, null, null, null, null],
  friend: null,
  friends: [],
};

// ---------- API ----------
async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(S.token ? { Authorization: `Bearer ${S.token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 401 && S.token) { logout(); throw new Error('Session expirée, reconnecte-toi.'); }
  if (!res.ok) {
    let msg = `Erreur ${res.status}`;
    try { const j = await res.json(); msg = j.error || j.title || msg; } catch { /* corps vide */ }
    throw new Error(msg);
  }
  return res.status === 204 ? null : res.json();
}

function toast(msg, error = false) {
  const el = document.createElement('div');
  el.className = `toast${error ? ' error' : ''}`;
  el.textContent = msg;
  $('#toasts').append(el);
  setTimeout(() => el.remove(), 3800);
}

// ---------- Catalogue ----------
function indexCatalog(data) {
  const champ = new Map(data.champions.map((c) => [c.id, c]));
  const skin = new Map(data.skins.map((s) => [s.id, s]));
  const line = new Map(data.lines.map((l) => [l.id, l]));
  const byLine = new Map();
  const byChamp = new Map();
  const byRarity = Object.fromEntries(RARITIES.map((r) => [r, []]));
  // Les champions occupent le palier le plus rare.
  byRarity.EXALTED = data.champions.map((c) => `CHAMPION:${c.id}`);
  for (const s of data.skins) {
    byRarity[s.rarity].push(`SKIN:${s.id}`);
    for (const l of s.lines) (byLine.get(l) || byLine.set(l, []).get(l)).push(s.id);
    (byChamp.get(s.championId) || byChamp.set(s.championId, []).get(s.championId)).push(s.id);
  }
  // oddsBy.STANDARD.EPIC = { percent, duplicateEssence }
  const oddsBy = Object.fromEntries(data.odds.map((o) => [o.type, Object.fromEntries(o.rates.map((r) => [r.rarity, r]))]));
  const price = Object.fromEntries(data.odds.map((o) => [o.type, o.essenceCost]));
  return { ...data, champ, skin, line, byLine, byChamp, byRarity, oddsBy, price };
}

async function loadCatalog() {
  const cached = JSON.parse(store.get(CATALOG_KEY) || 'null');
  if (cached && Date.now() - cached.at < 6 * 3600e3) { S.cat = indexCatalog(cached.data); return; }
  // Version dans l'URL : le catalogue est aussi en cache HTTP (6 h), un changement de format doit le contourner.
  const data = await api('/capsules/catalog?v=3');
  store.set(CATALOG_KEY, JSON.stringify({ at: Date.now(), data }));
  S.cat = indexCatalog(data);
}

function item(kind, id) {
  if (kind === 'CHAMPION') {
    const c = S.cat.champ.get(id);
    if (!c) return null;
    return { key: `CHAMPION:${id}`, kind, id, name: c.name, sub: 'Champion', rarity: 'EXALTED', champ: c,
      art: `${DD}/loading/${c.alias}_0.jpg`, splash: `${DD}/splash/${c.alias}_0.jpg`, fb: null, lines: [] };
  }
  const s = S.cat.skin.get(id);
  const c = s && S.cat.champ.get(s.championId);
  if (!c) return null;
  return { key: `SKIN:${id}`, kind, id, name: s.name, sub: c.name, rarity: s.rarity, champ: c, legacy: s.legacy,
    art: `${DD}/loading/${c.alias}_${s.num}.jpg`, splash: `${DD}/splash/${c.alias}_${s.num}.jpg`, fb: s.load ? CD + s.load : null, lines: s.lines };
}
const fromKey = (key) => { const [k, id] = key.split(':'); return item(k, +id); };

// Image de secours CommunityDragon quand Data Dragon n'a pas l'écran de chargement.
document.addEventListener('error', (e) => {
  const img = e.target;
  if (img.tagName !== 'IMG') return;
  if (img.dataset.fb) { img.src = img.dataset.fb; delete img.dataset.fb; } else img.style.visibility = 'hidden';
}, true);

function cardHTML(it, { missing = false, count = 0, isNew = false, tag = 'button' } = {}) {
  if (!it) return '';
  return `<${tag} class="card r-${it.rarity}${missing ? ' missing' : ''}" data-key="${it.key}" ${tag === 'button' ? 'type="button"' : ''} aria-label="${esc(it.name)}">
    <img loading="lazy" decoding="async" src="${it.art}" ${it.fb ? `data-fb="${it.fb}"` : ''} alt="">
    <span class="shade"></span>
    ${isNew ? '<span class="new">NOUVEAU</span>' : ''}${count > 1 ? `<span class="count">×${count}</span>` : ''}
    <span class="meta"><b>${esc(it.name)}</b><span>${it.kind === 'SKIN' ? esc(it.sub) : LABEL[it.rarity]}</span></span>
  </${tag}>`;
}

// ---------- Son et vibrations ----------
const audio = {
  ctx: null,
  ensure() {
    if (!S.sound) return null;
    try { this.ctx ||= new (window.AudioContext || window.webkitAudioContext)(); } catch { return null; }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  },
  tone(freq, dur = 0.12, type = 'sine', vol = 0.12, when = 0) {
    const ctx = this.ensure(); if (!ctx) return;
    const t = ctx.currentTime + when;
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(ctx.destination); o.start(t); o.stop(t + dur + 0.02);
  },
  step(i) { this.tone(260 * Math.pow(1.26, i), 0.16, 'triangle', 0.14); },
  burst(power) {
    const ctx = this.ensure(); if (!ctx) return;
    const len = ctx.sampleRate * 0.6; const buf = ctx.createBuffer(1, len, ctx.sampleRate); const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    const src = ctx.createBufferSource(); src.buffer = buf;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 900 + power * 500;
    const g = ctx.createGain(); g.gain.value = 0.35;
    src.connect(f).connect(g).connect(ctx.destination); src.start();
    this.tone(70, 0.4, 'sine', 0.4);
  },
  chime(r) {
    const notes = [523, 659, 784, 988, 1175, 1319, 1568];
    for (let i = 0; i <= Math.max(1, r); i++) this.tone(notes[i], 0.5, 'sine', 0.09, i * 0.07);
  },
};
const buzz = (p) => { try { navigator.vibrate?.(p); } catch { /* non supporté */ } };

// ---------- Particules ----------
const fx = {
  canvas: null, ctx: null, parts: [], raf: 0,
  init() {
    this.canvas = $('#fx'); this.ctx = this.canvas.getContext('2d');
    const resize = () => { const d = devicePixelRatio || 1; this.canvas.width = innerWidth * d; this.canvas.height = innerHeight * d; this.ctx.setTransform(d, 0, 0, d, 0, 0); };
    addEventListener('resize', resize); resize();
  },
  burst(x, y, rarity, count = 120, power = 1) {
    const rainbow = rarity === 'EXALTED';
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2; const v = (2 + Math.random() * 9) * power;
      this.parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 2, life: 1, decay: 0.008 + Math.random() * 0.016,
        size: 1.5 + Math.random() * 3.5, color: rainbow ? `hsl(${Math.random() * 360} 100% 65%)` : (Math.random() < 0.25 ? '#ffffff' : COLOR[rarity]) });
    }
    this.parts.push({ ring: true, x, y, r: 10, life: 1, color: rainbow ? '#ffffff' : COLOR[rarity], power });
    if (!this.raf) this.loop();
  },
  loop() {
    const { ctx } = this;
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    ctx.globalCompositeOperation = 'lighter';
    this.parts = this.parts.filter((p) => p.life > 0);
    for (const p of this.parts) {
      if (p.ring) {
        p.r += 14 * p.power; p.life -= 0.035;
        ctx.strokeStyle = p.color; ctx.globalAlpha = Math.max(0, p.life); ctx.lineWidth = 3 + 6 * p.life;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.stroke();
        continue;
      }
      p.vx *= 0.97; p.vy = p.vy * 0.97 + 0.12; p.x += p.vx; p.y += p.vy; p.life -= p.decay;
      ctx.globalAlpha = Math.max(0, p.life); ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (0.5 + p.life), 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
    this.raf = this.parts.length ? requestAnimationFrame(() => this.loop()) : 0;
    if (!this.raf) ctx.clearRect(0, 0, innerWidth, innerHeight);
  },
};

// ---------- État et minuterie ----------
const now = () => Date.now() + S.clockOffset;

function setWallet(w) {
  S.wallet = { ...w, nextAtMs: w.nextAt ? Date.parse(w.nextAt) : null };
  S.clockOffset = Date.parse(w.serverTime) - Date.now();
  renderWallet();
}

function tick() {
  const w = S.wallet; if (!w) return;
  if (w.nextAtMs && now() >= w.nextAtMs) {
    w.available++;
    w.nextAtMs = w.available >= w.maxStock ? null : w.nextAtMs + w.intervalSeconds * 1000;
    if (w.available === w.notifyAt) toast(`${w.available} reliques en stock : ouvre-les !`);
    renderWallet();
  }
  renderTimer();
}

function renderTimer() {
  const w = S.wallet;
  if (!w.nextAtMs) { $('#next-text').textContent = w.available >= w.maxStock ? 'Stock plein' : ''; $('#timer-fill').style.width = '100%'; return; }
  const left = Math.max(0, w.nextAtMs - now());
  const m = Math.floor(left / 60000); const s = Math.floor((left % 60000) / 1000);
  $('#next-text').textContent = `prochaine dans ${m}:${String(s).padStart(2, '0')}`;
  $('#timer-fill').style.width = `${100 - (left / (w.intervalSeconds * 1000)) * 100}%`;
}

const stockOf = (type = S.type) => (type === 'PREMIUM' ? S.wallet.premiumAvailable : S.wallet.available);

function renderWallet() {
  const w = S.wallet;
  const premium = S.type === 'PREMIUM';
  const stock = stockOf();
  const has = stock > 0;
  $('#view-open').classList.toggle('premium', premium);
  $('#count-std').textContent = w.available;
  $('#count-prem').textContent = w.premiumAvailable;
  $('#stock').hidden = premium;
  $('#premium-note').hidden = !premium;
  $('#capsule').classList.toggle('empty', !has);
  $('#capsule').disabled = !has;
  $('#capsule-count').textContent = stock;
  $('#tap-hint').textContent = has ? 'Touche pour ouvrir' : premium ? `Forge-en une : ${w.essencePerPremium} essence` : 'Reviens bientôt';
  $('#pips').innerHTML = Array.from({ length: w.maxStock }, (_, i) => `<i class="pip${i < w.available ? ' on' : ''}"></i>`).join('')
    + (w.available > w.maxStock ? '' : '');
  $('#stock-text').textContent = `${w.available} / ${w.maxStock} reliques${w.available > w.maxStock ? ' (bonus)' : ''}`;
  $('#open-one').disabled = !has || S.busy;
  const n = Math.min(stock, 10);
  $('#open-all').disabled = n < 2 || S.busy;
  $('#open-all').textContent = n >= 2 ? `Ouvrir ×${n}` : 'Tout ouvrir';
  $('#essence').textContent = w.essence;
  // Jauge jusqu'au prix d'une prestige, repère au prix d'une capsule.
  $('#essence-text').textContent = `${w.essence} essence`;
  $('#essence-fill').style.width = `${Math.min(100, (w.essence / w.essencePerPremium) * 100)}%`;
  $('#essence-tick').style.left = `${(w.essencePerCapsule / w.essencePerPremium) * 100}%`;
  $('#price-std').textContent = w.essencePerCapsule;
  $('#price-prem').textContent = w.essencePerPremium;
  $('#buy-std').disabled = w.essence < w.essencePerCapsule || S.busy;
  $('#buy-prem').disabled = w.essence < w.essencePerPremium || S.busy;
  $('#pity-text').textContent = w.pityIn <= 1 ? 'Épique garanti à la prochaine' : `Épique garanti dans ${w.pityIn}`;
  $('#pity-fill').style.width = `${((10 - w.pityIn) / 9) * 100}%`;
  $('#total-opened').textContent = w.totalOpened ? `${w.totalOpened} ouvertes` : '';
  const all = w.available + w.premiumAvailable;
  const badge = $('#nav-badge'); badge.hidden = !all; badge.textContent = all;
  document.title = all ? `(${all}) Reliques` : 'Reliques';
  try { all ? navigator.setAppBadge?.(all) : navigator.clearAppBadge?.(); } catch { /* non supporté */ }
  $('#debug').hidden = !w.debug;
  renderTimer();
}

function renderRecent() {
  const el = $('#recent-strip');
  if (!S.recent.length) { el.innerHTML = '<p class="empty-note">Tes trouvailles apparaîtront ici.</p>'; return; }
  el.innerHTML = S.recent.slice(0, 20).map((d) => cardHTML(item(d.kind, d.itemId), { isNew: d.isNew })).join('');
}

// ---------- Ouverture ----------
// Passer l'animation : toucher la relique pendant la charge écourte toutes les pauses restantes.
const skipper = { on: false, wake: () => {} };
const pause = (ms) => (skipper.on ? Promise.resolve() : new Promise((r) => { const t = setTimeout(r, ms); skipper.wake = () => { clearTimeout(t); r(); }; }));
function skipAnimation() { if (skipper.on) return; skipper.on = true; skipper.wake(); }

async function openCapsules(count) {
  const type = S.type;
  if (S.busy || !S.wallet || stockOf(type) < 1) return;
  S.busy = true; renderWallet();
  audio.ensure();
  const reveal = $('#reveal'); const cap = $('#reveal-capsule');
  const startGlow = type === 'PREMIUM' ? COLOR.ULTIMATE : COLOR.RARE;
  reveal.hidden = false; reveal.style.setProperty('--glow', startGlow);
  $('#reveal-single').hidden = true; $('#reveal-multi').hidden = true; $('#reveal-actions').hidden = true; $('#rays').className = 'rays';
  skipper.on = false;
  cap.hidden = false; cap.className = 'reveal-capsule charge';
  buzz(30);
  let res;
  try {
    [res] = await Promise.all([api('/capsules/open', { method: 'POST', body: { count, type } }), pause(450)]);
  } catch (e) {
    reveal.hidden = true; S.busy = false; renderWallet(); toast(e.message, true); return;
  }
  const best = res.drops.reduce((m, d) => (rank(d.rarity) > rank(m) ? d.rarity : m), 'COMMON');

  // Montée en tension : la lueur passe par chaque palier jusqu'à la rareté obtenue.
  const steps = rank(best) <= 1 ? [best] : RARITIES.slice(2, rank(best) + 1);
  for (let i = 0; i < steps.length; i++) {
    if (skipper.on) { reveal.style.setProperty('--glow', COLOR[best]); break; }
    reveal.style.setProperty('--glow', COLOR[steps[i]]);
    if (i === steps.length - 1 && rank(best) >= 3) cap.classList.add('hard');
    audio.step(rank(steps[i])); buzz(20 + i * 15);
    await pause(count > 1 ? 320 : 420 + i * 90);
  }
  cap.className = 'reveal-capsule pop';
  await pause(220);
  const r = rank(best);
  $('#flash').className = 'flash'; void $('#flash').offsetWidth; $('#flash').className = 'flash go';
  const box = cap.getBoundingClientRect();
  fx.burst(box.left + box.width / 2, box.top + box.height / 2, best, 80 + r * 40, 0.8 + r * 0.15);
  audio.burst(r); buzz(r >= 3 ? [60, 40, 120] : 50);
  if (r >= 2) $('#rays').className = 'rays on';
  cap.hidden = true;

  for (const d of res.drops) applyDrop(d);
  setWallet(res.state);
  if (count === 1) showSingle(res.drops[0]); else showMulti(res.drops);
  renderRecent();
  if (S.view === 'collection') renderCollection();
}

function applyDrop(d) {
  const key = `${d.kind}:${d.itemId}`;
  const cur = S.owned.get(key);
  S.owned.set(key, { kind: d.kind, itemId: d.itemId, count: d.count, firstObtainedAt: cur?.firstObtainedAt || new Date().toISOString() });
  S.recent.unshift({ kind: d.kind, itemId: d.itemId, rarity: d.rarity, isNew: d.isNew });
}

function dropInfo(d, it) {
  const lines = it.lines.map((l) => S.cat.line.get(l)?.name).filter(Boolean);
  return `<div class="drop-info r-${d.rarity}">
    <div class="rarity r-${d.rarity}">${LABEL[d.rarity]}</div>
    <h2>${esc(it.name)}</h2>
    <div class="sub">${it.kind === 'SKIN' ? `Skin · ${esc(it.sub)}` : 'Champion'}${lines.length ? ` · ${esc(lines.join(', '))}` : ''}</div>
    <div class="tags">${d.isNew ? '<span class="chip-new">NOUVEAU</span>' : `<span class="chip-dup">Doublon ×${d.count} · +${d.essence} essence</span>`}
    ${d.guaranteed ? '<span class="chip-pity">Garantie</span>' : ''}</div>
  </div>`;
}

function showSingle(d) {
  const it = item(d.kind, d.itemId);
  const el = $('#reveal-single');
  const more = stockOf() > 0;
  el.innerHTML = `<div class="big-card r-${d.rarity}${more ? ' tappable' : ''}" ${more ? 'role="button" tabindex="0" aria-label="Ouvrir la relique suivante"' : ''}>
      ${cardHTML(it, { isNew: d.isNew, tag: 'div' })}</div>${dropInfo(d, it)}
    ${more ? '<p class="tap-again">Touche la carte pour ouvrir la suivante</p>' : ''}`;
  el.hidden = false;
  audio.chime(rank(d.rarity));
  showRevealActions(false);
  if (more) {
    const card = $('.big-card', el);
    // Après l'animation de retournement, pour ne pas enchaîner sur un double tap.
    setTimeout(() => {
      card.onclick = () => openNext(1);
      card.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openNext(1); } };
    }, 600);
  }
}

/** Referme la révélation et ouvre aussitôt les suivantes (même type de relique). */
function openNext(count) {
  if (stockOf() < 1) return;
  closeReveal();
  openCapsules(Math.min(count, stockOf()));
}

function showMulti(drops) {
  const grid = $('#multi-grid');
  $('#multi-title').textContent = `${drops.length} reliques`;
  $('#multi-sub').textContent = 'Touche une carte pour la révéler';
  grid.innerHTML = drops.map((d, i) => {
    const it = item(d.kind, d.itemId);
    return `<div class="flip r-${d.rarity}${rank(d.rarity) >= 2 ? ' hot' : ''}" data-i="${i}" style="animation-delay:${i * 60}ms">
      <div class="flip-inner"><div class="flip-back"><svg viewBox="0 0 200 220"><use href="#capsule-art"/></svg></div>
      <div class="flip-front">${cardHTML(it, { isNew: d.isNew, count: d.count, tag: 'div' })}</div></div></div>`;
  }).join('');
  grid.dataset.drops = JSON.stringify(drops);
  $('#reveal-multi').hidden = false;
  showRevealActions(true);
}

function flipCard(el) {
  // Toutes retournées : toucher une carte lance le lot suivant.
  if (el.classList.contains('open')) {
    if (!$$('.flip:not(.open)').length) openNext(10);
    return;
  }
  el.classList.add('open');
  const d = JSON.parse($('#multi-grid').dataset.drops)[+el.dataset.i];
  const r = rank(d.rarity);
  if (r >= 2) {
    const b = el.getBoundingClientRect();
    setTimeout(() => fx.burst(b.left + b.width / 2, b.top + b.height / 2, d.rarity, 40 + r * 20, 0.5 + r * 0.1), 250);
    audio.chime(r); buzz(r >= 4 ? [40, 30, 80] : 30);
  } else audio.tone(420 + r * 120, 0.08, 'triangle', 0.08);
  if ($$('.flip:not(.open)').length === 0) multiDone(JSON.parse($('#multi-grid').dataset.drops));
}

function multiDone(drops) {
  const news = drops.filter((d) => d.isNew).length;
  const ess = drops.reduce((s, d) => s + d.essence, 0);
  $('#multi-sub').innerHTML = `<span class="multi-summary"><b>${news}</b> nouveauté${news > 1 ? 's' : ''}${ess ? ` · <b>+${ess}</b> essence` : ''}${stockOf() ? ' · touche une carte pour continuer' : ''}</span>`;
  showRevealActions(false);
}

async function revealAll() {
  // Du plus commun au plus rare : le meilleur arrive en dernier.
  const drops = JSON.parse($('#multi-grid').dataset.drops);
  const order = $$('.flip:not(.open)').sort((a, b) => rank(drops[+a.dataset.i].rarity) - rank(drops[+b.dataset.i].rarity));
  $('#reveal-skip').hidden = true;
  for (const el of order) { flipCard(el); await sleep(rank(drops[+el.dataset.i].rarity) >= 3 ? 520 : 170); }
}

function showRevealActions(pending) {
  $('#reveal-actions').hidden = false;
  $('#reveal-skip').hidden = !pending;
  const stock = stockOf();
  $('#reveal-again').hidden = pending || stock < 1;
  $('#reveal-again').textContent = stock > 1 ? `Encore ×${Math.min(stock, 10)}` : 'Ouvrir encore';
  $('#reveal-close').hidden = pending;
}

function closeReveal() {
  $('#reveal').hidden = true; $('#rays').className = 'rays';
  S.busy = false; renderWallet();
}

// ---------- Collection ----------
// Collection affichée : la sienne, ou celle de l'ami consulté.
const lens = () => S.friend?.owned ?? S.owned;
function ownedOf(key) { return lens().get(key); }

function totals() {
  const out = {};
  for (const r of RARITIES) {
    const keys = S.cat.byRarity[r];
    out[r] = { total: keys.length, owned: keys.filter((k) => lens().has(k)).length };
  }
  return out;
}

function renderSummary() {
  const t = totals();
  const all = RARITIES.reduce((s, r) => s + t[r].total, 0);
  const own = RARITIES.reduce((s, r) => s + t[r].owned, 0);
  const pct = all ? (own / all) * 100 : 0;
  $('#ring-fg').style.strokeDasharray = `${pct} 100`;
  $('#ring-pct').textContent = `${pct < 10 ? pct.toFixed(1) : Math.round(pct)}%`;
  $('#rarity-bars').innerHTML = [...RARITIES].reverse().map((r) => `
    <button class="rbar r-${r}" data-rarity="${r}" aria-pressed="${S.coll.rarity === r}">
      <span class="name">${LABEL[r]}</span><span class="track"><i style="width:${t[r].total ? (t[r].owned / t[r].total) * 100 : 0}%"></i></span>
      <span class="num">${t[r].owned} / ${t[r].total}</span></button>`).join('');
}

function matches(it, q) {
  if (!q) return true;
  const lines = it.lines.map((l) => S.cat.line.get(l)?.name || '').join(' ');
  return `${it.name} ${it.sub} ${lines}`.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').includes(q);
}

function renderCollection() {
  if (!S.cat) return;
  renderSummary();
  const { group, missing } = S.coll;
  const q = S.coll.q.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').trim();
  const body = $('#coll-body');
  if (group === 'rarity') body.innerHTML = renderByRarity(q, missing);
  else if (group === 'line') body.innerHTML = renderByLine(q, missing);
  else body.innerHTML = renderByChampion(q, missing);
}

function renderByRarity(q, missing) {
  const sections = [...RARITIES].reverse().filter((r) => !S.coll.rarity || S.coll.rarity === r).map((r) => {
    const keys = S.cat.byRarity[r];
    const owned = keys.filter((k) => lens().has(k)).length;
    let items = keys.map(fromKey).filter((it) => it && (missing || lens().has(it.key)) && matches(it, q));
    if (!items.length) return '';
    items.sort((a, b) => (lens().has(b.key) - lens().has(a.key)) || a.name.localeCompare(b.name, 'fr'));
    const limit = S.coll.limits[r] || 60;
    const more = items.length - limit;
    items = items.slice(0, limit);
    return `<section class="r-${r}">
      <div class="group-head"><h3>${LABEL[r]}</h3><span class="mini"><i style="width:${(owned / keys.length) * 100}%"></i></span><span class="num">${owned} / ${keys.length}</span></div>
      <div class="grid">${items.map((it) => { const o = ownedOf(it.key); return cardHTML(it, { missing: !o, count: o?.count }); }).join('')}</div>
      ${more > 0 ? `<button class="btn small more" data-more="${r}">Voir ${more} de plus</button>` : ''}
    </section>`;
  }).join('');
  return sections || emptyColl();
}

function renderByLine(q, missing) {
  const rows = S.cat.lines.map((l) => {
    const ids = S.cat.byLine.get(l.id) || [];
    const its = ids.map((id) => item('SKIN', id)).filter(Boolean);
    const owned = its.filter((it) => lens().has(it.key));
    return { l, its, owned };
  }).filter(({ l, its, owned }) => its.length && (missing || owned.length)
    && (!q || l.name.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').includes(q) || its.some((it) => matches(it, q))))
    .sort((a, b) => (b.owned.length / b.its.length) - (a.owned.length / a.its.length) || b.owned.length - a.owned.length || a.l.name.localeCompare(b.l.name, 'fr'));
  if (!rows.length) return emptyColl();
  return `<div class="lines">${rows.slice(0, S.coll.limits.lines || 80).map(({ l, its, owned }) => {
    const open = S.coll.open.has(l.id);
    const complete = owned.length === its.length;
    return `<div class="line-row${complete ? ' complete' : ''}">
      <button data-line="${l.id}" aria-expanded="${open}"><span class="lname">${esc(l.name)}${complete ? ' ✦' : ''}</span><span class="lnum">${owned.length} / ${its.length}</span>
      <span class="ltrack"><i style="width:${(owned.length / its.length) * 100}%"></i></span></button>
      ${open ? `<div class="grid">${its.sort((a, b) => rank(b.rarity) - rank(a.rarity)).map((it) => { const o = ownedOf(it.key); return cardHTML(it, { missing: !o, count: o?.count }); }).join('')}</div>`
        : owned.length ? `<div class="thumbs">${owned.slice(0, 10).map((it) => `<img loading="lazy" src="${it.art}" ${it.fb ? `data-fb="${it.fb}"` : ''} alt="">`).join('')}</div>` : ''}
    </div>`;
  }).join('')}</div>${rows.length > (S.coll.limits.lines || 80) ? '<button class="btn small more" data-more="lines">Voir plus de gammes</button>' : ''}`;
}

function renderByChampion(q, missing) {
  const champs = S.cat.champions.map((c) => {
    const skins = S.cat.byChamp.get(c.id) || [];
    const ownedSkins = skins.filter((id) => lens().has(`SKIN:${id}`)).length;
    return { c, skins, ownedSkins, has: lens().has(`CHAMPION:${c.id}`) };
  }).filter(({ c, has, ownedSkins }) => (missing || has || ownedSkins) && (!q || c.name.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').includes(q)));
  if (!champs.length) return emptyColl();
  return `<div class="champ-grid">${champs.map(({ c, skins, ownedSkins, has }) => `
    <button class="champ${has ? ' owned' : ''}" data-champ="${c.id}" type="button">
      <span class="pic"><img loading="lazy" src="${DD}/loading/${c.alias}_0.jpg" alt=""></span>
      <span>${esc(c.name)}</span><span class="sk"><b>${ownedSkins}</b> / ${skins.length} skins</span>
    </button>`).join('')}</div>`;
}

function emptyColl() {
  const empty = S.friend ? `La collection de ${esc(S.friend.name)} est vide pour l'instant.` : 'Ta collection est vide : ouvre ta première relique !';
  return `<p class="empty-note">${lens().size ? 'Rien ne correspond. Active « Manquants » pour tout voir.' : empty}</p>`;
}

// ---------- Fiches ----------
function openSheet(html) { $('#sheet-body').innerHTML = html; $('#sheet').hidden = false; }
function closeSheet() { $('#sheet').hidden = true; }

function showItem(key) {
  const it = fromKey(key); if (!it) return;
  const o = ownedOf(key);
  const odds = S.cat.oddsBy.STANDARD[it.rarity];
  const chanceIn = (type) => (S.cat.oddsBy[type][it.rarity]?.percent ?? 0) / S.cat.byRarity[it.rarity].length;
  const fmt = (c) => (c === 0 ? '—' : `${c >= 0.01 ? c.toFixed(2) : c.toFixed(3)}%`);
  const lines = it.lines.map((l) => S.cat.line.get(l)).filter(Boolean);
  openSheet(`
    <div class="detail-hero" style="background-image:url('${it.splash}'), url('${it.art}')"></div>
    <div class="detail-body r-${it.rarity}">
      <div class="tags"><span class="tag">${LABEL[it.rarity]}</span>${it.legacy ? '<span class="tag line">Héritage</span>' : ''}
        ${lines.map((l) => `<button class="tag line" data-goto-line="${l.id}">${esc(l.name)}</button>`).join('')}</div>
      <h2>${esc(it.name)}</h2>
      <p class="muted">${it.kind === 'SKIN' ? `Skin de ${esc(it.sub)}` : 'Champion'}</p>
      <div class="facts">
        <div><b>${o ? `×${o.count}` : '—'}</b><span>Exemplaires</span></div>
        <div><b>${o ? new Date(o.firstObtainedAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) : 'Jamais'}</b><span>Obtenu</span></div>
        <div><b>${fmt(chanceIn('STANDARD'))}</b><span>Chance / relique</span></div>
      </div>
      <p class="muted">Chance par relique prestige : ${fmt(chanceIn('PREMIUM'))}</p>
      ${o ? `<p class="muted">Un doublon rapporte ${odds?.duplicateEssence ?? 0} essence.</p>` : '<p class="muted">Pas encore obtenu. Continue d\'ouvrir !</p>'}
    </div>`);
}

function showChampion(id) {
  const c = S.cat.champ.get(id);
  const its = [item('CHAMPION', id), ...(S.cat.byChamp.get(id) || []).map((s) => item('SKIN', s))].filter(Boolean)
    .sort((a, b) => rank(b.rarity) - rank(a.rarity));
  const own = its.filter((it) => lens().has(it.key)).length;
  openSheet(`<div class="detail-body" style="margin-top:0;padding-top:22px">
    <h2>${esc(c.name)}</h2><p class="muted">${own} / ${its.length} obtenus</p>
    <div class="grid">${its.map((it) => { const o = ownedOf(it.key); return cardHTML(it, { missing: !o, count: o?.count }); }).join('')}</div></div>`);
}

// Tableau comparatif : taux par type de capsule et essence d'un doublon (colonne du type choisi mise en avant).
function oddsHTML() {
  const pct = (type, r) => { const o = S.cat.oddsBy[type][r]; return o ? `${o.percent}%` : '—'; };
  const cls = (type) => (type === S.type ? 'sel' : 'dim');
  return `<span class="h name">Rareté</span><span class="h">Relique</span><span class="h prem">Prestige</span><span class="h">Doublon</span>
    ${[...RARITIES].reverse().map((r) => `<span class="name r-${r}">${LABEL[r]}</span>
      <span class="${cls('STANDARD')}">${pct('STANDARD', r)}</span><span class="${cls('PREMIUM')}">${pct('PREMIUM', r)}</span>
      <span>+${(S.cat.oddsBy.STANDARD[r] || S.cat.oddsBy.PREMIUM[r]).duplicateEssence}</span>`).join('')}`;
}

function oddsNote() {
  return `Prix en essence : relique ${S.cat.price.STANDARD}, prestige ${S.cat.price.PREMIUM}. « Doublon » : essence reçue quand l'objet est déjà dans ta collection. `
    + `Après ${S.cat.pityThreshold - 1} reliques sans Épique, la suivante est Épique ou mieux. La prestige ne contient pas de skin commun. Les champions sont le palier Exalté, le plus rare.`;
}

function renderOdds() {
  if (!S.cat) return;
  $('#odds-table').innerHTML = oddsHTML();
  $('#odds-note').textContent = oddsNote();
}

function showOdds() {
  openSheet(`<div class="odds"><h2>Taux de drop</h2><div class="odds-table">${oddsHTML()}</div><p class="odds-note">${esc(oddsNote())}</p></div>`);
}

function setType(type) {
  S.type = type;
  $$('.type-switch [data-type]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.type === type)));
  if (S.wallet) renderWallet();
  renderOdds();
}

// ---------- Roster et amis ----------
const ROLES = ['Top', 'Jungle', 'Mid', 'Bot', 'Support'];
const keyOf = (slot) => (slot ? `${slot.kind}:${slot.itemId}` : null);

function renderRoster() {
  const friend = S.friend;
  const slots = friend ? friend.roster : S.roster;
  const editable = !friend;
  $('#roster-title').textContent = friend ? `Roster de ${friend.name}` : 'Mon roster';
  $('#roster-hint').textContent = editable ? 'Touche un poste' : '';
  $('#roster').innerHTML = ROLES.map((role, i) => {
    const it = slots[i] && item(slots[i].kind, slots[i].itemId);
    const tag = editable ? 'button' : 'div';
    return `<${tag} class="slot${it ? ` filled r-${it.rarity}` : ''}" ${editable ? `type="button" data-slot="${i}"` : ''} aria-label="${role}${it ? ` : ${esc(it.name)}, ${LABEL[it.rarity]}` : ''}">
      ${it ? `<img loading="lazy" src="${it.art}" ${it.fb ? `data-fb="${it.fb}"` : ''} alt=""><span class="shade"></span><b>${esc(it.name)}</b><span class="rar" title="${LABEL[it.rarity]}"></span>`
        : `<span class="plus">${editable ? '+' : '—'}</span>`}
      <span class="role">${role}</span></${tag}>`;
  }).join('');
}

function showSlotPicker(index) {
  const current = keyOf(S.roster[index]);
  const used = new Set(S.roster.map(keyOf).filter((k) => k && k !== current));
  const items = [...S.owned.keys()].map(fromKey).filter((it) => it && !used.has(it.key))
    .sort((a, b) => rank(b.rarity) - rank(a.rarity) || a.name.localeCompare(b.name, 'fr'));
  openSheet(`<div class="picker">
    <h2>Poste ${ROLES[index]}</h2>
    ${items.length ? `<input type="search" id="pick-search" placeholder="Rechercher dans ta collection" autocomplete="off">` : ''}
    ${current ? `<button class="btn ghost small" data-pick-clear="${index}">Retirer du poste</button>` : ''}
    <div class="grid" id="pick-grid">${items.length ? items.map((it) => pickCard(it, index, it.key === current)).join('') : '<p class="empty-note">Ouvre des reliques pour remplir ton roster.</p>'}</div>
  </div>`);
  $('#pick-search')?.addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').trim();
    $$('#pick-grid .card').forEach((c) => { c.hidden = q && !matches(fromKey(c.dataset.pick), q); });
  });
}

function pickCard(it, index, selected) {
  return cardHTML(it, { count: 0 }).replace('class="card ', `class="card pick${selected ? ' selected' : ''} `)
    .replace(`data-key="${it.key}"`, `data-key="${it.key}" data-pick="${it.key}" data-slot-index="${index}"`);
}

async function setSlot(index, key) {
  const slots = S.roster.map((s) => (s ? { kind: s.kind, itemId: s.itemId } : null));
  slots[index] = key ? (([kind, id]) => ({ kind, itemId: +id }))(key.split(':')) : null;
  try {
    S.roster = await api('/capsules/roster', { method: 'PUT', body: { slots } });
    closeSheet(); renderRoster(); buzz(20);
  } catch (e) { toast(e.message, true); }
}

function avatarHTML(p) {
  const letter = esc((p.displayName[0] || '?').toUpperCase());
  return `<span class="avatar">${letter}${p.profileIconId ? `<img src="https://ddragon.leagueoflegends.com/cdn/img/profileicon/${p.profileIconId}.png" alt="" onerror="this.remove()">` : ''}</span>`;
}

function friendHTML(p) {
  const total = S.cat ? RARITIES.reduce((s, r) => s + S.cat.byRarity[r].length, 0) : 0;
  const pct = total ? Math.round((p.owned / total) * 1000) / 10 : 0;
  return `<div class="friend">
    <button class="friend-main" data-player="${p.userId}" type="button">
      ${avatarHTML(p)}
      <span class="who"><b>${esc(p.displayName)}</b><span>${p.riotId ? esc(p.riotId) + ' · ' : ''}${p.owned} objets · ${pct}%</span></span>
      <span class="mini-roster">${p.roster.map((s) => { const it = s && item(s.kind, s.itemId); return it ? `<img loading="lazy" class="r-${it.rarity}" src="${it.art}" alt="">` : '<i></i>'; }).join('')}</span>
    </button>
    ${p.added ? `<button class="icon-btn" data-unfriend="${p.userId}" aria-label="Retirer ${esc(p.displayName)}"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button>`
      : `<button class="btn small" data-befriend="${p.userId}">Ajouter</button>`}
  </div>`;
}

async function loadFriends() {
  try {
    const list = await api('/capsules/friends');
    S.friends = list;
    const added = list.filter((p) => p.added);
    const met = list.filter((p) => !p.added);
    $('#friends-count').textContent = added.length ? `${added.length}` : '';
    $('#friends-list').innerHTML = added.length ? added.map(friendHTML).join('')
      : '<p class="empty-note">Ajoute un ami avec son Riot ID ou son pseudo pour voir sa collection et son roster.</p>';
    $('#suggest-block').hidden = !met.length;
    $('#suggest-list').innerHTML = met.map(friendHTML).join('');
  } catch (e) { toast(e.message, true); }
}

async function addFriend(body) {
  try {
    const p = await api('/capsules/friends', { method: 'POST', body });
    toast(`${p.displayName} ajouté à tes amis`);
    await loadFriends();
    return p;
  } catch (e) { toast(e.message, true); return null; }
}

async function openPlayer(userId) {
  try {
    const res = await api(`/capsules/players/${userId}`);
    S.friend = { userId, name: res.player.displayName, added: res.player.added, roster: res.player.roster,
      owned: new Map(res.items.map((i) => [`${i.kind}:${i.itemId}`, i])) };
    S.coll.rarity = null;
    setView('collection', { friend: true });
  } catch (e) { toast(e.message, true); }
}

// ---------- Navigation ----------
function setView(v, { friend = false } = {}) {
  // Quitter la collection d'un ami : retour à la sienne.
  if (!friend) S.friend = null;
  S.view = v;
  $('#view-open').hidden = v !== 'open';
  $('#view-collection').hidden = v !== 'collection';
  $('#view-friends').hidden = v !== 'friends';
  const tab = friend ? 'friends' : v;
  $$('[data-view]').forEach((b) => (b.dataset.view === tab ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current')));
  if (v === 'collection') {
    $('#owner-bar').hidden = !S.friend;
    if (S.friend) { $('#owner-name').textContent = S.friend.name; $('#owner-follow').hidden = S.friend.added; }
    renderRoster();
    renderCollection();
  }
  if (v === 'friends') loadFriends();
  scrollTo({ top: 0 });
}

// ---------- PWA : installation et notifications ----------
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
let installEvent = null;

const isMobile = matchMedia('(pointer: coarse)').matches || innerWidth < 760;

// Entrée « Installer l'app » du menu (masquée une fois installée) et popup au premier lancement sur mobile.
function setupInstall() {
  $('#install-menu').hidden = standalone;
  addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvent = e; });
  addEventListener('appinstalled', () => { installEvent = null; $('#install-menu').hidden = true; closeSheet(); toast('App installée !'); });
  $('#install-menu').onclick = () => { $('#menu').hidden = true; showInstall(); };
}

const NEWS_KEY = 'capsules.news.friends-roster';

async function maybeShowNews() {
  if (store.get(NEWS_KEY)) return;
  store.set(NEWS_KEY, '1');
  openSheet(`<div class="news">
    <span class="kicker">Nouveau</span>
    <h2>Amis et roster</h2>
    <div class="news-item"><b>Collections de tes amis</b><span>Ajoute un ami avec son Riot ID ou son pseudo, puis explore sa collection et son roster.</span></div>
    <div class="news-item"><b>Ton roster</b><span>Mets en avant 5 objets de ta collection, un par poste : Top, Jungle, Mid, Bot, Support.</span></div>
    <button class="btn primary block" data-news-go="collection">Composer mon roster</button>
    <button class="btn ghost block" data-news-go="friends">Voir mes amis</button>
  </div>`);
  $$('[data-news-go]').forEach((b) => (b.onclick = () => { closeSheet(); setView(b.dataset.newsGo); }));
  // Le popup d'installation attend la fermeture de celui-ci.
  while (!$('#sheet').hidden) await sleep(300);
}

async function maybePromptInstall() {
  if (standalone || !isMobile || store.get('capsules.installPrompted')) return;
  // Laisse au navigateur le temps d'annoncer l'installation possible (Android).
  for (let i = 0; i < 20 && !installEvent && !isIOS; i++) await sleep(100);
  store.set('capsules.installPrompted', '1');
  showInstall(true);
}

async function installNow() {
  if (!installEvent) return;
  installEvent.prompt();
  const { outcome } = await installEvent.userChoice;
  installEvent = null;
  if (outcome === 'accepted') closeSheet();
}

function showInstall(firstLaunch = false) {
  const steps = isIOS
    ? `<ol class="install-steps"><li>Ouvre cette page dans <b>Safari</b>.</li><li>Touche <b>Partager</b> (carré avec une flèche).</li>
        <li>Choisis <b>« Sur l'écran d'accueil »</b>, puis <b>Ajouter</b>.</li></ol>`
    : `<ol class="install-steps"><li>Ouvre le menu du navigateur <b>⋮</b>.</li><li>Choisis <b>« Installer l'application »</b> ou <b>« Ajouter à l'écran d'accueil »</b>.</li></ol>`;
  openSheet(`<div class="install-sheet">
    <div class="install-icon"><img src="icons/icon-192.png" alt=""></div>
    <h2>${firstLaunch ? 'Installe Reliques' : 'Installer l\'app'}</h2>
    <p class="muted">Ouvre tes reliques en un geste depuis l'écran d'accueil, en plein écran.</p>
    <ul class="install-perks"><li>Notification quand ton stock est plein</li><li>Compteur de reliques sur l'icône</li><li>Chargement instantané</li></ul>
    ${installEvent ? '<button class="btn primary big block" id="install-now">Installer</button>' : steps}
    <button class="btn ghost block" data-close>${firstLaunch ? 'Plus tard' : 'Fermer'}</button>
  </div>`);
  $('#install-now')?.addEventListener('click', installNow);
}

const pushSupported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

function b64ToBytes(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function currentSub() {
  if (!pushSupported) return null;
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

async function setupNotify() {
  const card = $('#notify-card');
  try { S.pushKey = (await api('/capsules/push/key')).publicKey; } catch { S.pushKey = null; }
  const n = S.wallet?.notifyAt ?? 10;
  $('#notify-text').textContent = `Notification quand tu as ${n} reliques en stock.`;
  if (!S.pushKey) { card.hidden = true; return; }
  if (isIOS && !standalone) {
    card.hidden = false; $('#notify-text').textContent = 'Installe l\'app sur l\'écran d\'accueil pour être prévenu.';
    $('#notify-btn').textContent = 'Installer'; $('#notify-btn').onclick = () => showInstall(); return;
  }
  if (!pushSupported || Notification.permission === 'denied') { card.hidden = true; return; }
  const sub = Notification.permission === 'granted' ? await currentSub() : null;
  if (sub) { card.hidden = true; await sendSub(sub).catch(() => {}); return; }
  card.hidden = false;
  $('#notify-btn').onclick = enableNotify;
}

async function sendSub(sub) {
  const j = sub.toJSON();
  await api('/capsules/push/subscribe', { method: 'POST', body: { endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth } });
}

async function enableNotify() {
  try {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') { toast('Notifications refusées. Tu peux les réactiver dans les réglages du navigateur.', true); return; }
    const reg = await navigator.serviceWorker.ready;
    const sub = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(S.pushKey) });
    await sendSub(sub);
    $('#notify-card').hidden = true;
    toast(`C'est noté : on te prévient à ${S.wallet.notifyAt} reliques.`);
  } catch (e) { toast(`Activation impossible : ${e.message}`, true); }
}

// ---------- Debug (local uniquement) ----------
async function debugCall(path, body) {
  try {
    setWallet(await api(`/capsules/debug/${path}`, { method: 'POST', body }));
    if (path === 'reset') { S.owned.clear(); S.recent = []; S.roster = [null, null, null, null, null]; renderRecent(); renderRoster(); renderCollection(); }
  } catch (e) { toast(e.message, true); }
}

// ---------- Authentification ----------
let registering = false;
function showAuth() {
  $('#app').hidden = true; $('#auth').hidden = false;
  $('#name-field').hidden = !registering;
  $('#auth-submit').textContent = registering ? 'Créer mon compte' : 'Se connecter';
  $('#auth-toggle').textContent = registering ? 'Déjà un compte ? Se connecter' : 'Pas encore de compte ? Créer un compte';
  $('[name=password]').autocomplete = registering ? 'new-password' : 'current-password';
}

async function submitAuth(e) {
  e.preventDefault();
  const f = new FormData(e.target);
  const body = { email: f.get('email'), password: f.get('password'), ...(registering ? { displayName: f.get('displayName') } : {}) };
  $('#auth-error').textContent = ''; $('#auth-submit').disabled = true;
  try {
    const res = await api(`/auth/${registering ? 'register' : 'login'}`, { method: 'POST', body });
    S.token = res.token; S.user = res.user;
    store.set('capsules.token', res.token); store.set('capsules.user', JSON.stringify(res.user));
    await start();
  } catch (err) { $('#auth-error').textContent = err.message; }
  finally { $('#auth-submit').disabled = false; }
}

async function logout() {
  try { const sub = await currentSub(); if (sub && S.token) await fetch(`${API}/capsules/push/unsubscribe`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${S.token}` }, body: JSON.stringify({ endpoint: sub.endpoint }) }); } catch { /* best effort */ }
  S.token = null; S.user = null; S.owned.clear(); S.recent = []; S.friend = null;
  store.del('capsules.token'); store.del('capsules.user');
  $('#menu').hidden = true;
  showAuth();
}

async function start() {
  $('#auth').hidden = true; $('#app').hidden = false;
  $('#menu-user').innerHTML = `<b>${esc(S.user?.displayName)}</b>${esc(S.user?.email)}`;
  const slow = setTimeout(() => toast('Réveil du serveur, quelques secondes…'), 3500);
  try {
    const [state, coll] = await Promise.all([api('/capsules/state'), api('/capsules/collection'), loadCatalog()]);
    setWallet(state);
    S.owned = new Map(coll.items.map((i) => [`${i.kind}:${i.itemId}`, i]));
    S.recent = coll.recent;
    S.roster = coll.roster;
    renderRecent();
    renderOdds();
    if (S.view === 'collection') { renderRoster(); renderCollection(); }
  } catch (e) { toast(e.message, true); }
  finally { clearTimeout(slow); }
  setupNotify();
  await maybeShowNews();
  maybePromptInstall();
}

// ---------- Événements ----------
function bind() {
  $('#auth-form').addEventListener('submit', submitAuth);
  $('#auth-toggle').onclick = () => { registering = !registering; $('#auth-error').textContent = ''; showAuth(); };
  $$('[data-view]').forEach((b) => (b.onclick = () => setView(b.dataset.view)));
  $('#capsule').onclick = () => openCapsules(1);
  $('#open-one').onclick = () => openCapsules(1);
  $('#open-all').onclick = () => openCapsules(Math.min(stockOf(), 10));
  const buy = async (type) => {
    try {
      setWallet(await api('/capsules/buy', { method: 'POST', body: { type } }));
      audio.chime(type === 'PREMIUM' ? 4 : 2);
      toast(type === 'PREMIUM' ? 'Relique prestige forgée !' : 'Relique forgée !');
      setType(type);
    } catch (e) { toast(e.message, true); }
  };
  $('#buy-std').onclick = () => buy('STANDARD');
  $('#buy-prem').onclick = () => buy('PREMIUM');
  $$('.type-switch [data-type]').forEach((b) => (b.onclick = () => setType(b.dataset.type)));
  $('#reveal-close').onclick = closeReveal;
  $('#reveal-skip').onclick = revealAll;
  $('#reveal-again').onclick = () => openNext(10);
  $('#reveal-capsule').addEventListener('click', skipAnimation);
  $('#multi-grid').addEventListener('click', (e) => { const f = e.target.closest('.flip'); if (f) flipCard(f); });

  $('#menu-btn').onclick = (e) => { e.stopPropagation(); $('#menu').hidden = !$('#menu').hidden; };
  document.addEventListener('click', (e) => { if (!e.target.closest('#menu')) $('#menu').hidden = true; });
  $('#sound-toggle').onclick = () => { S.sound = !S.sound; store.set('capsules.sound', S.sound ? 'on' : 'off'); $('#sound-toggle').textContent = `Son : ${S.sound ? 'activé' : 'coupé'}`; };
  $('#sound-toggle').textContent = `Son : ${S.sound ? 'activé' : 'coupé'}`;
  $('#odds-btn').onclick = () => { $('#menu').hidden = true; if (S.cat) showOdds(); };
  $('#logout-btn').onclick = logout;

  // Cartes cliquables partout (collection, derniers tirages, fiches).
  document.addEventListener('click', (e) => {
    const pick = e.target.closest('[data-pick]');
    if (pick) { setSlot(+pick.dataset.slotIndex, pick.dataset.pick); return; }
    const clear = e.target.closest('[data-pick-clear]');
    if (clear) { setSlot(+clear.dataset.pickClear, null); return; }
    const slot = e.target.closest('[data-slot]');
    if (slot) { showSlotPicker(+slot.dataset.slot); return; }
    const player = e.target.closest('[data-player]');
    if (player) { openPlayer(player.dataset.player); return; }
    const unfriend = e.target.closest('[data-unfriend]');
    if (unfriend) { api(`/capsules/friends/${unfriend.dataset.unfriend}`, { method: 'DELETE' }).then(loadFriends).catch((err) => toast(err.message, true)); return; }
    const befriend = e.target.closest('[data-befriend]');
    if (befriend) { addFriend({ userId: befriend.dataset.befriend }); return; }
    const card = e.target.closest('button.card');
    if (card) { showItem(card.dataset.key); return; }
    const champ = e.target.closest('[data-champ]');
    if (champ) { showChampion(+champ.dataset.champ); return; }
    const goto = e.target.closest('[data-goto-line]');
    if (goto) {
      closeSheet(); const id = +goto.dataset.gotoLine;
      S.coll.group = 'line'; S.coll.open.add(id); S.coll.q = S.cat.line.get(id)?.name || ''; $('#search').value = S.coll.q;
      syncSegmented(); setView('collection');
    }
  });
  $('#friend-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = $('#friend-query');
    if (await addFriend({ query: input.value })) input.value = '';
  });
  $('#owner-back').onclick = () => setView('friends');
  $('#owner-follow').onclick = async () => {
    const p = await addFriend({ userId: S.friend.userId });
    if (p) { S.friend.added = true; $('#owner-follow').hidden = true; }
  };
  $('#sheet').addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeSheet(); });
  addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });

  $$('.segmented button').forEach((b) => (b.onclick = () => { S.coll.group = b.dataset.group; if (b.dataset.group !== 'rarity') S.coll.rarity = null; syncSegmented(); renderCollection(); }));
  let t;
  $('#search').addEventListener('input', (e) => { clearTimeout(t); t = setTimeout(() => { S.coll.q = e.target.value; renderCollection(); }, 150); });
  $('#show-missing').addEventListener('change', (e) => { S.coll.missing = e.target.checked; renderCollection(); });
  $('#rarity-bars').addEventListener('click', (e) => {
    const b = e.target.closest('[data-rarity]'); if (!b) return;
    S.coll.rarity = S.coll.rarity === b.dataset.rarity ? null : b.dataset.rarity; S.coll.group = 'rarity'; syncSegmented(); renderCollection();
  });
  $('#coll-body').addEventListener('click', (e) => {
    const line = e.target.closest('[data-line]');
    if (line) { const id = +line.dataset.line; S.coll.open.has(id) ? S.coll.open.delete(id) : S.coll.open.add(id); renderCollection(); return; }
    const more = e.target.closest('[data-more]');
    if (more) { const k = more.dataset.more; S.coll.limits[k] = (S.coll.limits[k] || (k === 'lines' ? 80 : 60)) + (k === 'lines' ? 80 : 120); renderCollection(); }
  });

  $('#debug').addEventListener('click', (e) => {
    const b = e.target.closest('[data-debug]'); if (!b) return;
    const [kind, n] = b.dataset.debug.split(':');
    if (kind === 'reset') { if (confirm('Vider collection, historique et stock ?')) debugCall('reset'); }
    else debugCall('grant', { count: kind === 'cap' ? +n : 0, essence: kind === 'ess' ? +n : 0, premium: kind === 'prem' ? +n : 0 });
  });

  addEventListener('visibilitychange', () => { if (!document.hidden && S.token) api('/capsules/state').then(setWallet).catch(() => {}); });
}

function syncSegmented() { $$('.segmented button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.group === S.coll.group))); }

// ---------- Démarrage ----------
fx.init();
bind();
setupInstall();
setInterval(tick, 1000);
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js', { scope: './' }).catch(() => {});
if (new URLSearchParams(location.search).get('view') === 'collection') S.view = 'collection';
if (S.token) { start(); setView(S.view); } else showAuth();
