// Reliques (capsules en interne) : une relique par heure, ouverture animée, collection par rareté / gamme / champion. PWA autonome servie par l'API.
const API = '/api/v1';
const DD = 'https://ddragon.leagueoflegends.com/cdn/img/champion';
const CD = 'https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/';
const RARITIES = ['COMMON', 'RARE', 'EPIC', 'LEGENDARY', 'MYTHIC', 'ULTIMATE', 'EXALTED'];
const LABEL = { COMMON: 'Commun', RARE: 'Rare', EPIC: 'Épique', LEGENDARY: 'Légendaire', MYTHIC: 'Mythique', ULTIMATE: 'Ultime', EXALTED: 'Exalté' };
const COLOR = { COMMON: '#8a94a6', RARE: '#19e3ff', EPIC: '#a78bfa', LEGENDARY: '#ff8a3d', MYTHIC: '#ff3366', ULTIMATE: '#ffc94d', EXALTED: '#ffffff' };
const CATALOG_KEY = 'capsules.catalog.v6';
// Build de cette coquille, gravé au déploiement par le Dockerfile ; « dev » en local.
const APP_VERSION = '__BUILD__'.includes('_') ? 'dev' : '__BUILD__';
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
  coll: { group: 'rarity', q: '', missing: false, rarity: null, role: null, open: new Set(), limits: {} },
  pushKey: null,
  roster: [null, null, null, null, null],
  friend: null,
  friends: [],
};

// ---------- API ----------
// Réveil du serveur (plan gratuit : mis en veille après 15 min, jusqu'à une minute pour repartir).
const wake = {
  since: 0, pending: 0, timer: 0,
  begin() {
    if (this.pending++ === 0) this.timer = setTimeout(() => this.show(), 2500);
  },
  end() {
    if (--this.pending > 0) return;
    clearTimeout(this.timer); this.since = 0;
    $('#wake').hidden = true;
  },
  show() {
    const el = $('#wake');
    if (!el.hidden) return;
    this.since ||= Date.now();
    el.hidden = false;
    const tick = () => {
      if (el.hidden) return;
      const s = Math.round((Date.now() - this.since) / 1000);
      $('#wake-text').textContent = `Réveil du serveur… ${s} s`;
      setTimeout(tick, 1000);
    };
    tick();
  },
};
const RETRYABLE = new Set([0, 502, 503, 504]);

/**
 * Appel d'API. retry : relance tant que le serveur se réveille (réseau coupé, 502/503/504), jusqu'à ~2 min.
 * Réservé aux appels sans effet de bord (lectures, connexion) : une ouverture n'est jamais rejouée.
 */
async function api(path, { method = 'GET', body, retry = false } = {}) {
  const deadline = Date.now() + 120_000;
  let delay = 1500;
  wake.begin();
  try {
    for (;;) {
      let res;
      const ctl = new AbortController();
      const abort = setTimeout(() => ctl.abort(), 30_000);
      try {
        res = await fetch(API + path, {
          method,
          signal: ctl.signal,
          headers: { 'Content-Type': 'application/json', ...(S.token ? { Authorization: `Bearer ${S.token}` } : {}) },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
      } catch { res = null; } finally { clearTimeout(abort); }
      const status = res?.status ?? 0;
      if (!RETRYABLE.has(status)) return await parse(res);
      if (!retry || Date.now() > deadline) throw new Error('Serveur injoignable pour le moment, réessaie dans un instant.');
      wake.show();
      await sleep(delay);
      delay = Math.min(delay * 1.5, 6000);
    }
  } finally { wake.end(); }
}

async function parse(res) {
  if (res.status === 401 && S.token) { logout(); throw new Error('Session expirée, reconnecte-toi.'); }
  if (!res.ok) {
    let msg = `Erreur ${res.status}`;
    try { const j = await res.json(); msg = j.error || j.title || msg; } catch { /* corps vide */ }
    throw new Error(msg);
  }
  return res.status === 204 ? null : res.json();
}

// ---------- Version ----------
// Le service worker sert la coquille depuis son cache : après un déploiement, l'app ouverte peut être en retard sur le serveur.
async function checkVersion() {
  let server = null;
  try { server = await (await fetch(`${API}/version`, { cache: 'no-store' })).json(); } catch { /* serveur endormi : on réessaiera */ }
  $('#menu-version').textContent = `Version ${APP_VERSION}${server?.commit ? ` · ${server.commit}` : ''}`;
  const stale = server && server.version !== 'dev' && server.version !== APP_VERSION;
  $('#update-bar').hidden = !stale;
  if (stale) $('#update-version').textContent = server.version;
}

async function applyUpdate() {
  $('#update-go').disabled = true;
  $('#update-go').textContent = 'Mise à jour…';
  const reg = await navigator.serviceWorker?.getRegistration().catch(() => null);
  if (!reg) { location.reload(); return; }
  // Le nouveau service worker télécharge la coquille puis prend la main ; on recharge dès qu'il est actif.
  navigator.serviceWorker.addEventListener('controllerchange', () => location.reload());
  await reg.update().catch(() => {});
  setTimeout(() => location.reload(), 5000);
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
  const data = await api('/capsules/catalog?v=6', { retry: true });
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
    <img loading="lazy" decoding="async" src="${esc(it.art)}" ${it.fb ? `data-fb="${esc(it.fb)}"` : ''} alt="">
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
  $('#open-one').disabled = !has || S.busy || !S.online;
  const n = Math.min(stock, 10);
  $('#open-all').disabled = n < 2 || S.busy || !S.online;
  $('#open-all').textContent = n >= 2 ? `Ouvrir ×${n}` : 'Tout ouvrir';
  $('#essence').textContent = w.essence;
  // Jauge jusqu'au prix d'une prestige, repère au prix d'une capsule.
  $('#essence-text').textContent = `${w.essence} essence`;
  $('#essence-fill').style.width = `${Math.min(100, (w.essence / w.essencePerPremium) * 100)}%`;
  $('#essence-tick').style.left = `${(w.essencePerCapsule / w.essencePerPremium) * 100}%`;
  $('#price-std').textContent = w.essencePerCapsule;
  $('#price-prem').textContent = w.essencePerPremium;
  $('#buy-std').disabled = w.essence < w.essencePerCapsule || S.busy || !S.online;
  $('#buy-prem').disabled = w.essence < w.essencePerPremium || S.busy || !S.online;
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
  if (S.busy || !S.online || !S.wallet || stockOf(type) < 1) return;
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
  saveSnapshot();
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

// Filtre par poste : le champion y joue en poste principal ou secondaire.
const playsRole = (c, role = S.coll.role) => role == null || c?.profile?.main === role || c?.profile?.secondary === role;

function matches(it, q) {
  if (!playsRole(it.champ)) return false;
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
    const its = ids.map((id) => item('SKIN', id)).filter((it) => it && playsRole(it.champ));
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
        : owned.length ? `<div class="thumbs">${owned.slice(0, 10).map((it) => `<img loading="lazy" src="${esc(it.art)}" ${it.fb ? `data-fb="${esc(it.fb)}"` : ''} alt="">`).join('')}</div>` : ''}
    </div>`;
  }).join('')}</div>${rows.length > (S.coll.limits.lines || 80) ? '<button class="btn small more" data-more="lines">Voir plus de gammes</button>' : ''}`;
}

function renderByChampion(q, missing) {
  const champs = S.cat.champions.map((c) => {
    const skins = S.cat.byChamp.get(c.id) || [];
    const ownedSkins = skins.filter((id) => lens().has(`SKIN:${id}`)).length;
    return { c, skins, ownedSkins, has: lens().has(`CHAMPION:${c.id}`) };
  }).filter(({ c, has, ownedSkins }) => (missing || has || ownedSkins) && playsRole(c) && (!q || c.name.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').includes(q)));
  if (!champs.length) return emptyColl();
  return `<div class="champ-grid">${champs.map(({ c, skins, ownedSkins, has }) => `
    <button class="champ${has ? ' owned' : ''}" data-champ="${c.id}" type="button">
      <span class="pic"><img loading="lazy" src="${esc(`${DD}/loading/${c.alias}_0.jpg`)}" alt=""></span>
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
    <div class="detail-hero" style="background-image:url('${esc(it.splash)}'), url('${esc(it.art)}')"></div>
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
    ${profileHTML(c.profile, true)}
    ${c.talent ? `<div class="talent-card"><span class="kicker">Talent d'arène</span>${talentHTML(c.talent, true)}</div>` : ''}
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
    const fit = it ? fitOf(it.champ, i) : 0;
    return `<${tag} class="slot${it ? ` filled r-${it.rarity}` : ''}" ${editable ? `type="button" data-slot="${i}"` : ''} aria-label="${role}${it ? ` : ${esc(it.name)}, ${LABEL[it.rarity]}, ${fitLabel(fit).toLowerCase()}` : ''}">
      ${it ? `<img loading="lazy" src="${esc(it.art)}" ${it.fb ? `data-fb="${esc(it.fb)}"` : ''} alt=""><span class="shade"></span><b>${esc(it.name)}</b><span class="rar" title="${LABEL[it.rarity]}"></span>
        ${it.champ.profile ? `<span class="slot-fit ${fit > 0 ? 'up' : 'down'}" title="${fitLabel(fit)}">${signed(fit)} %</span>` : ''}`
        : `<span class="plus">${editable ? '+' : '—'}</span>`}
      <span class="role">${role}</span></${tag}>`;
  }).join('');
  $('#team-coach').innerHTML = editable ? coachHTML(S.roster) : '';
}

// ---------- Aide à la composition (miroir des règles du serveur, BattleRules) ----------
const FIT = { main: 12, secondary: 8, off: -10 };
const fitOf = (c, role) => (!c?.profile ? 0 : c.profile.main === role ? FIT.main : c.profile.secondary === role ? FIT.secondary : FIT.off);
const primaryClass = (c) => c?.roles?.[0];
const rosterItems = (slots) => slots.map((s) => (s ? item(s.kind, s.itemId) : null));

/** Puissance comme au combat : rareté, poste, gamme commune et champion en double. */
function teamPower(its) {
  const filled = its.filter(Boolean);
  const lines = {};
  filled.forEach((it) => new Set(it.lines).forEach((l) => { lines[l] = (lines[l] || 0) + 1; }));
  const best = Math.max(0, ...Object.values(lines));
  let bonus = best >= 2 ? 0.03 * (best - 1) : 0;
  if (new Set(filled.map((it) => it.champ.id)).size < filled.length) bonus -= 0.10;
  return its.reduce((sum, it, i) => sum + (it ? Math.round(100 * (1 + rank(it.rarity) * 0.02) * (1 + fitOf(it.champ, i) / 100) * (1 + bonus)) : 0), 0);
}

/** Besoins de composition en teamfight : frontline, dégâts, protection ou engage. */
function teamNeeds(its) {
  const cs = its.filter(Boolean).map((it) => it.champ);
  return [
    { label: 'Frontline', ok: cs.some((c) => ['tank', 'fighter'].includes(primaryClass(c)) || c.roles.includes('tank')), tip: 'Ajoute un tank ou un combattant : sans frontline, −10 % en teamfight.' },
    { label: 'Dégâts', ok: cs.some((c) => ['marksman', 'mage', 'assassin'].includes(primaryClass(c))), tip: 'Ajoute un tireur, un mage ou un assassin : sans dégâts, −10 % en teamfight.' },
    { label: 'Protection', ok: cs.some((c) => c.roles.includes('support') || primaryClass(c) === 'tank'), tip: 'Ajoute un soutien ou un tank : sans protection ni engage, −5 % en teamfight.' },
  ];
}

function curveVerdict(its) {
  const n = { EARLY: 0, MID: 0, LATE: 0 };
  its.forEach((it) => { if (it?.champ.profile) n[it.champ.profile.curve]++; });
  if (n.EARLY >= 3) return 'Équipe early : écrase les lanes et conclus avant les derniers teamfights.';
  if (n.LATE >= 3) return 'Équipe late : tiens la phase de lanes, les derniers teamfights sont à toi.';
  if (n.MID >= 3) return 'Équipe mid : pic de puissance autour des dragons et du premier teamfight.';
  return 'Courbe équilibrée : présente à chaque phase de la partie.';
}

function coachHTML(slots) {
  const its = rosterItems(slots);
  const filled = its.filter(Boolean);
  if (!filled.length) return '<p class="coach-empty">Place tes champions : l\'analyse de l\'équipe s\'affiche ici.</p>';
  const needs = teamNeeds(its);
  const count = (style) => filled.filter((it) => it.champ.profile?.style === style).length;
  const tips = [
    ...its.map((it, i) => it && fitOf(it.champ, i) < 0
      && `${esc(it.champ.name)} est hors poste en ${ROLES[i]} (−10 %). Son poste : ${ROLES[it.champ.profile.main]}.`),
    new Set(filled.map((it) => it.champ.id)).size < filled.length && 'Champion en double : −10 % pour toute l\'équipe.',
    filled.length === 5 && needs.find((x) => !x.ok)?.tip,
    filled.length < 5 && `Encore ${5 - filled.length} poste${filled.length < 4 ? 's' : ''} à remplir pour entrer dans l'arène.`,
  ].filter(Boolean);
  const bonus = [count('TEAMFIGHT') >= 3 && 'comp teamfight +5 %', count('SOLO') >= 2 && 'split-push'].filter(Boolean);
  return `<div class="coach">
    <div class="coach-head"><span class="kicker">Analyse de l'équipe</span><span class="power">Puissance <b>${teamPower(its)}</b></span></div>
    <div class="coach-needs">${needs.map((x) => `<span class="need ${x.ok ? 'ok' : 'ko'}">${x.ok ? '✓' : '✗'} ${x.label}</span>`).join('')}</div>
    <div class="coach-curve">${its.map((it, i) => { const p = it?.champ.profile; return `<span class="cv" style="--pc:${p ? CURVE[p.curve].color : 'var(--line-2)'}"><i></i><em>${ROLES[i]}</em><b>${p ? CURVE[p.curve].label : '—'}</b><small>${p ? STYLE[p.style].label : ''}</small></span>`; }).join('')}</div>
    <p class="coach-verdict">${curveVerdict(its)}${bonus.length ? ` Bonus : ${bonus.join(', ')}.` : ''}</p>
    ${tips.length ? `<ul class="coach-tips">${tips.map((t) => `<li>${t}</li>`).join('')}</ul>` : '<p class="coach-ok">Tout le monde est à son poste et la compo est complète.</p>'}
    <button class="btn small" type="button" id="coach-optimize">Optimiser mon roster</button>
  </div>`;
}

/** Valeur d'une équipe pour l'optimiseur : puissance × besoins de composition et comp teamfight en teamfight. */
function teamScore(its) {
  const needs = teamNeeds(its);
  const fights = its.filter((it) => it?.champ.profile?.style === 'TEAMFIGHT').length;
  const comp = 1 - (needs[0].ok ? 0 : 0.10) - (needs[1].ok ? 0 : 0.10) - (needs[2].ok ? 0 : 0.05) + (fights >= 3 ? 0.05 : 0);
  return teamPower(its) * comp;
}

/**
 * Meilleur roster avec sa collection. D'abord les affectations (poste, objet) par score décroissant (rareté × bonus de poste),
 * un champion par poste ; puis échanges poste par poste tant qu'ils améliorent l'équipe (composition comprise).
 */
function suggestTeam() {
  const owned = [...S.owned.keys()].map(fromKey).filter(Boolean);
  const pairs = [];
  owned.forEach((it) => ROLES.forEach((_, r) => pairs.push({ it, r, score: (1 + rank(it.rarity) * 0.02) * (1 + fitOf(it.champ, r) / 100) })));
  pairs.sort((a, b) => b.score - a.score);
  const out = Array(5).fill(null);
  const champs = new Set();
  for (const { it, r } of pairs) {
    if (out[r] || champs.has(it.champ.id)) continue;
    out[r] = it; champs.add(it.champ.id);
  }
  for (let improved = true, rounds = 0; improved && rounds < 5; rounds++) {
    improved = false;
    for (let r = 0; r < 5; r++) {
      let best = teamScore(out);
      for (const it of owned) {
        if (out.some((o, i) => i !== r && o?.champ.id === it.champ.id)) continue;
        const trial = out.map((o, i) => (i === r ? it : o));
        const score = teamScore(trial);
        if (score > best + 0.5) { best = score; out[r] = it; improved = true; }
      }
    }
  }
  return out;
}

function showOptimize() {
  const now = rosterItems(S.roster);
  const best = suggestTeam();
  const same = best.every((it, i) => (it?.key ?? null) === (now[i]?.key ?? null));
  const row = (it, i) => `<div class="opt-row${(it?.key ?? null) !== (now[i]?.key ?? null) ? ' changed' : ''}">
    <span class="role">${ROLES[i]}</span><span class="opt-pic">${it ? `<img src="${esc(it.art)}" ${it.fb ? `data-fb="${esc(it.fb)}"` : ''} alt="">` : ''}</span>
    <span class="opt-txt"><b>${it ? esc(it.name) : '—'}</b>${it ? `<span>${it.kind === 'SKIN' ? `${esc(it.sub)} · ` : ''}${LABEL[it.rarity]}</span>` : ''}</span>
    ${it ? `<span class="fit ${fitOf(it.champ, i) > 0 ? 'up' : 'down'}">${signed(fitOf(it.champ, i))} %</span>` : ''}</div>`;
  openSheet(`<div class="optimize">
    <span class="kicker">Suggestion</span><h2>Roster optimisé</h2>
    <p class="muted">Chaque champion à son meilleur poste, une compo complète, les objets les plus rares en priorité. Les postes modifiés sont surlignés.</p>
    <div class="opt-power"><span>Puissance</span><b>${teamPower(now)}</b><span>→</span><b class="up">${teamPower(best)}</b></div>
    <div class="coach-needs">${teamNeeds(best).map((x) => `<span class="need ${x.ok ? 'ok' : 'ko'}">${x.ok ? '✓' : '✗'} ${x.label}</span>`).join('')}</div>
    <div class="opt-list">${best.map(row).join('')}</div>
    ${same ? '<p class="coach-ok">Ton roster est déjà le meilleur possible avec ta collection.</p>'
      : '<button class="btn primary block" type="button" id="opt-apply">Appliquer ce roster</button>'}
    <p class="hint">La courbe compte aussi : une équipe early doit gagner vite, une équipe late doit tenir les lanes.</p>
  </div>`);
  $('#opt-apply')?.addEventListener('click', () => saveRoster(best.map((it) => it && { kind: it.kind, itemId: it.id })));
}

// Sélecteur d'un poste : objets classés par bonus de poste (principal, secondaire, hors poste), puis par rareté.
function showSlotPicker(index) {
  const current = keyOf(S.roster[index]);
  const used = new Set(S.roster.map(keyOf).filter((k) => k && k !== current));
  const taken = new Set(S.roster.map((s, i) => i !== index && s && item(s.kind, s.itemId)?.champ.id).filter(Boolean));
  const items = [...S.owned.keys()].map(fromKey).filter((it) => it && !used.has(it.key))
    .sort((a, b) => fitOf(b.champ, index) - fitOf(a.champ, index) || rank(b.rarity) - rank(a.rarity) || a.name.localeCompare(b.name, 'fr'));
  const groups = [
    { fit: FIT.main, title: 'Poste principal', note: '+12 %' },
    { fit: FIT.secondary, title: 'Poste secondaire', note: '+8 %' },
    { fit: FIT.off, title: 'Hors poste', note: '−10 %' },
  ].map((g) => ({ ...g, its: items.filter((it) => (it.champ.profile ? fitOf(it.champ, index) : FIT.off) === g.fit) })).filter((g) => g.its.length);
  const best = items.find((it) => !taken.has(it.champ.id));
  openSheet(`<div class="picker">
    <h2>Poste ${ROLES[index]}</h2>
    <p class="muted">Les champions faits pour ce poste d'abord. Tous les postes restent ouverts, avec un malus hors poste.</p>
    ${items.length ? `<input type="search" id="pick-search" placeholder="Rechercher dans ta collection" autocomplete="off">` : ''}
    ${current ? `<button class="btn ghost small" data-pick-clear="${index}">Retirer du poste</button>` : ''}
    ${items.length ? groups.map((g) => `<section class="pick-group">
        <div class="group-head"><h3>${g.title}</h3><span class="fit ${g.fit > 0 ? 'up' : 'down'}">${g.note}</span><span class="num">${g.its.length}</span></div>
        <div class="grid">${g.its.map((it) => pickCard(it, index, { selected: it.key === current, best: it === best, dup: taken.has(it.champ.id) })).join('')}</div>
      </section>`).join('') : '<p class="empty-note">Ouvre des reliques pour remplir ton roster.</p>'}
  </div>`);
  $('#pick-search')?.addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').trim();
    $$('.picker .card').forEach((c) => {
      const it = fromKey(c.dataset.pick);
      c.hidden = !!q && !`${it.name} ${it.sub}`.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').includes(q);
    });
    $$('.pick-group').forEach((g) => { g.hidden = !$$('.card', g).some((c) => !c.hidden); });
  });
}

function pickCard(it, index, { selected = false, best = false, dup = false } = {}) {
  const p = it.champ.profile;
  const tags = `<span class="pick-tags">${best ? '<span class="pick-best">Conseillé</span>' : ''}${dup ? '<span class="pick-dup">Déjà pris</span>' : ''}
    ${p ? `<span class="ptag" style="--pc:${CURVE[p.curve].color}">${CURVE[p.curve].label}</span><span class="ptag">${STYLE[p.style].label}</span>` : ''}</span>`;
  return cardHTML(it, { count: 0 }).replace('class="card ', `class="card pick${selected ? ' selected' : ''}${dup ? ' dup' : ''} `)
    .replace(`data-key="${it.key}"`, `data-key="${it.key}" data-pick="${it.key}" data-slot-index="${index}"`)
    .replace(/<\/button>\s*$/, `${tags}</button>`);
}

async function setSlot(index, key) {
  const slots = S.roster.map((s) => (s ? { kind: s.kind, itemId: s.itemId } : null));
  slots[index] = key ? (([kind, id]) => ({ kind, itemId: +id }))(key.split(':')) : null;
  await saveRoster(slots);
}

async function saveRoster(slots) {
  try {
    S.roster = await api('/capsules/roster', { method: 'PUT', body: { slots } });
    closeSheet(); renderRoster(); buzz(20);
  } catch (e) { toast(e.message, true); }
}

function avatarHTML(p) {
  const letter = esc((p.displayName[0] || '?').toUpperCase());
  return `<span class="avatar">${letter}${p.profileIconId ? `<img src="https://ddragon.leagueoflegends.com/cdn/img/profileicon/${+p.profileIconId}.png" alt="">` : ''}</span>`;
}

function friendHTML(p) {
  const total = S.cat ? RARITIES.reduce((s, r) => s + S.cat.byRarity[r].length, 0) : 0;
  const pct = total ? Math.round((p.owned / total) * 1000) / 10 : 0;
  return `<div class="friend">
    <button class="friend-main" data-player="${p.userId}" type="button">
      ${avatarHTML(p)}
      <span class="who"><b>${esc(p.displayName)}</b><span>${p.riotId ? esc(p.riotId) + ' · ' : ''}${p.owned} objets · ${pct}%</span></span>
      <span class="mini-roster">${p.roster.map((s) => { const it = s && item(s.kind, s.itemId); return it ? `<img loading="lazy" class="r-${it.rarity}" src="${esc(it.art)}" alt="">` : '<i></i>'; }).join('')}</span>
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

// ---------- Arène : combats roster contre roster ----------
const CLASS = {
  ASSASSIN: { label: 'Assassin', color: '#ff3366' },
  MAGE: { label: 'Mage', color: '#a78bfa' },
  MARKSMAN: { label: 'Tireur', color: '#ffc94d' },
  TANK: { label: 'Tank', color: '#3ddc84' },
  FIGHTER: { label: 'Combattant', color: '#ff8a3d' },
  SUPPORT: { label: 'Soutien', color: '#19e3ff' },
};
const CURVE = {
  EARLY: { label: 'Early', color: '#ff8a3d', text: 'Fort en lane, plus faible en fin de partie.' },
  MID: { label: 'Mid', color: '#ffc94d', text: 'Au sommet autour des dragons et du premier teamfight.' },
  LATE: { label: 'Late', color: '#a78bfa', text: 'Faible en lane, redoutable dans les derniers teamfights.' },
};
const STYLE = {
  SOLO: { label: 'Solo', text: 'Gagne ses duels et pousse les side lanes.' },
  TEAMFIGHT: { label: 'Teamfight', text: 'Brille dans les combats à cinq.' },
};
const TUTO_KEY = 'capsules.tuto.arena.v3';
const TIER = {
  BRONZE: { label: 'Bronze', color: '#d08a5b' },
  SILVER: { label: 'Argent', color: '#c3cfe2' },
  GOLD: { label: 'Or', color: '#ffc94d' },
  PLATINUM: { label: 'Platine', color: '#3ddcc4' },
  DIAMOND: { label: 'Diamant', color: '#6fb7ff' },
  MASTER: { label: 'Maître', color: '#d08bff' },
};
const tierBadge = (t, big = false) => `<span class="tier${big ? ' big' : ''}" style="--tc:${TIER[t].color}">${TIER[t].label}</span>`;
const SLOT_LABEL = { P: 'Passif', Q: 'A', W: 'Z', E: 'E', R: 'R' };

/** Talent d'un champion : icône du sort, nom, touche ; avec la description en version détaillée. */
function talentHTML(t, full = false) {
  if (!t) return '';
  const icon = t.icon ? `<img src="${esc(t.icon)}" alt="" loading="lazy">` : '<svg viewBox="0 0 24 24"><use href="#cls-MAGE"/></svg>';
  return `<span class="talent${full ? ' full' : ''}" title="${esc(t.description)}"><span class="talent-ico">${icon}</span>
    <span class="talent-txt"><b>${esc(t.spell)} <em>${SLOT_LABEL[t.slot] || t.slot}</em></b>${full ? `<span>${esc(t.description)}</span>` : ''}</span></span>`;
}

/** Profil d'arène : courbe et style ; en version détaillée, postes principal et secondaire avec leur bonus. */
function profileHTML(p, full = false) {
  if (!p) return '';
  const tags = `<span class="ptags"><span class="ptag" style="--pc:${CURVE[p.curve].color}">${CURVE[p.curve].label}</span><span class="ptag">${STYLE[p.style].label}</span></span>`;
  if (!full) return tags;
  return `<div class="profile"><span class="kicker">Profil d'arène</span>
    <div class="profile-roles"><span><b>${ROLES[p.main]}</b> poste principal · +12 %</span>
      ${p.secondary != null ? `<span><b>${ROLES[p.secondary]}</b> poste secondaire · +8 %</span>` : ''}
      <span class="muted">Partout ailleurs : −10 %</span></div>
    ${tags}<p class="muted">${CURVE[p.curve].text} ${STYLE[p.style].text}</p></div>`;
}

function daysLeft(iso) {
  const d = Math.max(0, Date.parse(iso) - now()) / 86400e3;
  return d >= 1 ? `${Math.floor(d)} j` : `${Math.max(1, Math.ceil(d * 24))} h`;
}

const clsIcon = (c, extra = '') => (CLASS[c]
  ? `<svg class="cls ${extra}" style="--cc:${CLASS[c].color}" viewBox="0 0 24 24" role="img" aria-label="${CLASS[c].label}"><use href="#cls-${c}"/></svg>` : '');
const signed = (n) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '0');
const fitLabel = (f) => (f >= 10 ? 'Poste principal' : f > 0 ? 'Poste secondaire' : f < 0 ? 'Hors poste' : 'Neutre');
const unitItem = (u) => (S.cat ? item(u.kind, u.itemId) : null);
const unitImg = (u) => { const it = unitItem(u); return it ? `<img loading="lazy" src="${esc(it.art)}" ${it.fb ? `data-fb="${esc(it.fb)}"` : ''} alt="">` : ''; };

function fmtWait(ms) {
  const m = Math.ceil(ms / 60000);
  return m >= 60 ? `dans ${Math.ceil(m / 60)} h` : `dans ${m} min`;
}

function ago(iso) {
  const s = (now() - Date.parse(iso)) / 1000;
  if (s < 60) return 'à l\'instant';
  if (s < 3600) return `il y a ${Math.floor(s / 60)} min`;
  if (s < 86400) return `il y a ${Math.floor(s / 3600)} h`;
  return `il y a ${Math.floor(s / 86400)} j`;
}

function avatarInner(p) {
  return `${esc((p.displayName[0] || '?').toUpperCase())}${p.profileIconId ? `<img src="https://ddragon.leagueoflegends.com/cdn/img/profileicon/${+p.profileIconId}.png" alt="">` : ''}`;
}

const synergyHTML = (list) => `<div class="synergies">${list.length
  ? list.map((s) => `<span class="syn${s.includes('−') ? ' bad' : ''}">${esc(s)}</span>`).join('')
  : '<span class="syn none">Aucune synergie</span>'}</div>`;

async function loadArena({ quiet = false } = {}) {
  try {
    if (!S.cat) await loadCatalog();
    S.arena = await api('/capsules/arena', { retry: true });
    renderArenaBadge();
    if (S.view !== 'arena') return;
    renderArenaHead();
    renderArenaTeam();
    renderArenaBody();
  } catch (e) { if (!quiet) toast(e.message, true); }
}

function renderArenaBadge() {
  const n = S.arena?.opponents.filter((o) => o.revenge).length || 0;
  const b = $('#arena-badge'); b.hidden = !n; b.textContent = n;
}

function renderArenaHead() {
  const a = S.arena;
  $('#arena-rating').textContent = a.rating;
  $('#arena-record').textContent = a.wins + a.losses ? `${a.wins} V · ${a.losses} D` : 'Aucun combat pour l\'instant';
  $('#arena-rank').textContent = a.rank ? `#${a.rank}` : '—';
  const s = a.season;
  const span = s.nextTierAt ? s.nextTierAt - s.tierFloor : 1;
  const pct = s.nextTierAt ? Math.min(100, Math.max(0, ((a.rating - s.tierFloor) / span) * 100)) : 100;
  const next = Object.keys(TIER)[Object.keys(TIER).indexOf(s.tier) + 1];
  $('#arena-season').innerHTML = `<div class="season-top">${tierBadge(s.tier)}<span class="muted">Saison ${s.number} · fin dans ${daysLeft(s.endsAt)}</span></div>
    <div class="tier-bar" style="--tc:${TIER[s.tier].color}"><i style="width:${pct}%"></i></div>
    <span class="tier-next">${s.nextTierAt ? `${TIER[next].label} à ${s.nextTierAt} pts · encore ${s.nextTierAt - a.rating}` : 'Palier maximal atteint'}</span>`;
  if (a.lastSeason && !S.seasonShown) { S.seasonShown = true; showSeasonEnd(a.lastSeason); }
  $('#reward-pips').innerHTML = Array.from({ length: a.rewardedPerDay }, (_, i) => `<i class="${i < a.rewardedToday ? 'on' : ''}${i % 2 ? ' pair' : ''}"></i>`).join('');
  const left = a.rewardedPerDay - a.rewardedToday;
  $('#reward-text').innerHTML = left > 0
    ? `<b>+${a.winEssence}</b> essence par victoire · encore <b>${left}</b> aujourd'hui`
    : 'Essence du jour empochée · la cote compte toujours';
}

function unitCell(u) {
  return `<div class="unit r-${u.rarity}" data-unit="${u.role}" role="button" tabindex="0">
    <div class="unit-art">${unitImg(u)}<span class="role">${ROLES[u.role]}</span><span class="unit-cls">${u.classes.slice(0, 2).map((c) => clsIcon(c)).join('')}</span></div>
    <b>${esc(u.champion)}</b>
    <span class="fit ${u.fitPercent > 0 ? 'up' : u.fitPercent < 0 ? 'down' : ''}" title="${fitLabel(u.fitPercent)}">${u.fitPercent ? `${signed(u.fitPercent)} % ${u.fitPercent >= 10 ? 'poste' : u.fitPercent > 0 ? 'poste 2' : 'hors poste'}` : 'Neutre'}</span>
    ${profileHTML(u.profile)}
    ${talentHTML(u.talent)}
  </div>`;
}

function renderArenaTeam() {
  const a = S.arena;
  const el = $('#arena-team');
  if (!a.rosterReady) {
    el.innerHTML = `<div class="team-empty"><b>Ton roster n'est pas complet</b><span>Remplis les 5 postes pour entrer dans l'arène.</span>
      <button class="btn primary small" data-goto="collection">Compléter mon roster</button></div>`;
    return;
  }
  el.innerHTML = `<div class="section-head"><h2>Ton équipe</h2><span class="power">Puissance <b>${a.team.power}</b></span></div>
    <div class="units">${a.team.units.map(unitCell).join('')}</div>
    <div class="team-foot">${synergyHTML(a.team.synergies)}<button class="btn ghost small" data-goto="collection">Modifier</button></div>`;
}

function renderArenaBody() {
  const tab = S.arenaTab || 'foes';
  $$('[data-arena]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.arena === tab)));
  if (tab === 'foes') renderFoes();
  else if (tab === 'ladder') renderLadder();
  else renderHistory();
}

function foeHTML(o) {
  const p = o.player;
  const wait = o.availableAt ? Date.parse(o.availableAt) - now() : 0;
  const status = o.revenge ? '<span class="cta revenge">Revanche</span>'
    : wait > 0 ? `<span class="cta wait">${fmtWait(wait)}</span>` : '<span class="cta">Défier</span>';
  return `<button class="foe${o.revenge ? ' hot' : ''}" data-foe="${p.userId}" type="button">
    <span class="avatar">${avatarInner(p)}</span>
    <span class="who"><b>${esc(p.displayName)}</b><span>${o.rating} pts${o.friend ? ' · ami' : ''}</span></span>
    <span class="mini-roster">${p.roster.map((s) => { const it = s && S.cat && item(s.kind, s.itemId); return it ? `<img loading="lazy" class="r-${it.rarity}" src="${esc(it.art)}" alt="">` : '<i></i>'; }).join('')}</span>
    ${status}
  </button>`;
}

function renderFoes() {
  const list = S.arena.opponents;
  $('#arena-body').innerHTML = list.length ? `<div class="foes">${list.map(foeHTML).join('')}</div>`
    : '<p class="empty-note">Personne à défier pour l\'instant. Ajoute des amis : dès que leur roster est complet, ils apparaissent ici.</p>';
}

function ladderRow(e) {
  const mine = e.userId === S.user?.id;
  return `<div class="lrow${mine ? ' me' : ''}${e.rank <= 3 ? ` podium p${e.rank}` : ''}">
    <span class="rank">${e.rank}</span><span class="avatar">${avatarInner(e)}</span>
    <span class="who"><b>${esc(e.displayName)}${mine ? ' (toi)' : ''}</b><span>${e.wins} V · ${e.losses} D</span></span>
    ${tierBadge(tierOf(e.rating))}<b class="pts">${e.rating}</b></div>`;
}

async function renderLadder() {
  const body = $('#arena-body');
  body.innerHTML = '<p class="empty-note">Chargement du classement…</p>';
  try {
    const l = await api('/capsules/ladder');
    if (S.arenaTab !== 'ladder') return;
    const head = S.arena ? `<div class="ladder-head">${tierBadge(S.arena.season.tier)}<span>Saison ${S.arena.season.number} · fin dans ${daysLeft(S.arena.season.endsAt)}</span></div>` : '';
    if (!l.top.length) { body.innerHTML = `${head}<p class="empty-note">Personne n'a encore combattu cette saison : lance le premier combat !</p>`; return; }
    const meIn = l.me && l.top.some((e) => e.userId === l.me.userId);
    body.innerHTML = `${head}<div class="ladder">${l.top.map(ladderRow).join('')}${l.me && !meIn ? `<div class="lgap">···</div>${ladderRow(l.me)}` : ''}</div>`;
  } catch (e) { body.innerHTML = `<p class="empty-note">${esc(e.message)}</p>`; }
}

async function renderHistory() {
  const body = $('#arena-body');
  body.innerHTML = '<p class="empty-note">Chargement…</p>';
  try {
    const list = await api('/capsules/battles');
    if (S.arenaTab !== 'history') return;
    body.innerHTML = list.length ? `<div class="history">${list.map((h) => `
      <button class="hrow ${h.won ? 'win' : 'loss'}" data-battle="${h.id}" type="button">
        <span class="res">${h.won ? 'V' : 'D'}</span>
        <span class="who"><b>${h.attacked ? 'Attaque' : 'Défense'} · ${esc(h.opponentName)}</b><span>${ago(h.createdAt)}${h.essence ? ` · +${h.essence} essence` : ''}</span></span>
        <b class="delta ${h.ratingDelta >= 0 ? 'up' : 'down'}">${signed(h.ratingDelta)}</b>
        <svg class="play" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
      </button>`).join('')}</div>`
      : '<p class="empty-note">Aucun combat pour l\'instant. Tes attaques et tes défenses s\'afficheront ici.</p>';
  } catch (e) { body.innerHTML = `<p class="empty-note">${esc(e.message)}</p>`; }
}

// Aperçu : vis-à-vis poste par poste, contres et synergies, avant de lancer.
function muSide(u, right = false) {
  return `<span class="mu-side${right ? ' right' : ''} r-${u.rarity}">
    <span class="mu-pic">${unitImg(u)}</span>
    <span class="mu-txt"><b>${esc(u.champion)}</b>
      <span>${u.classes.slice(0, 1).map((c) => `${clsIcon(c, 'sm')}${CLASS[c].label}`).join('')}${u.fitPercent ? ` <em class="${u.fitPercent > 0 ? 'up' : 'down'}" title="${fitLabel(u.fitPercent)}">${signed(u.fitPercent)} %</em>` : ''}</span>
      ${profileHTML(u.profile)}
      ${talentHTML(u.talent)}
    </span></span>`;
}

// Contre de classe en teamfight, lu face à toute la composition adverse : chaque camp a le sien.
function matchupRow(role, a, b) {
  const d = a.counterPercent - b.counterPercent;
  return `<div class="mu ${d > 0 ? 'win' : d < 0 ? 'lose' : ''}">
    ${muSide(a)}
    <span class="mu-mid"><span class="role">${role}</span>${a.counterPercent || b.counterPercent
      ? `<em title="Contre de classe en teamfight">Teamfight<br>+${a.counterPercent} · +${b.counterPercent} %</em>` : '<em class="eq">=</em>'}</span>
    ${muSide(b, true)}
  </div>`;
}

async function openFoe(id) {
  try {
    const p = await api(`/capsules/battles/preview/${id}`);
    const wait = p.availableAt ? Date.parse(p.availableAt) - now() : 0;
    const diff = p.mine.power - p.theirs.power;
    openSheet(`<div class="preview">
      <span class="kicker">Aperçu du combat</span>
      <h2>Toi contre ${esc(p.opponent.displayName)}</h2>
      <div class="vs-head">
        <div><span class="kicker">Ta puissance</span><b>${p.mine.power}</b></div>
        <span class="vs-badge ${diff >= 0 ? 'up' : 'down'}">${diff >= 0 ? 'Favori' : 'Outsider'}</span>
        <div class="right"><span class="kicker">${p.rating} pts</span><b>${p.theirs.power}</b></div>
      </div>
      <div class="matchups">${ROLES.map((r, i) => matchupRow(r, p.mine.units[i], p.theirs.units[i])).join('')}</div>
      <div class="vs-syn"><div><span class="kicker">Tes bonus</span>${synergyHTML(p.mine.synergies)}</div>
        <div><span class="kicker">Ses bonus</span>${synergyHTML(p.theirs.synergies)}</div></div>
      <details class="talents-vs"><summary>Talents en jeu</summary>
        <div><span class="kicker">Ton équipe</span>${p.mine.units.map((u) => `<div class="tv-row"><b>${esc(u.champion)}</b>${talentHTML(u.talent, true)}</div>`).join('')}</div>
        <div><span class="kicker">En face</span>${p.theirs.units.map((u) => `<div class="tv-row"><b>${esc(u.champion)}</b>${talentHTML(u.talent, true)}</div>`).join('')}</div>
      </details>
      <p class="hint">Astuce : ton roster défend aussi. Le changer pour contrer ce joueur change aussi ta défense.</p>
      <button class="btn primary big block" id="attack-go" ${wait > 0 ? 'disabled' : ''}>${wait > 0 ? `Attends sa riposte · ${fmtWait(wait)}` : 'Lancer le combat'}</button>
      <button class="btn ghost block" data-goto="collection">Ajuster mon roster</button>
    </div>`);
    $('#attack-go').onclick = () => attack(id);
  } catch (e) { toast(e.message, true); }
}

async function attack(id) {
  const btn = $('#attack-go');
  btn.disabled = true; btn.textContent = 'Combat en cours…';
  try {
    const b = await api('/capsules/battles', { method: 'POST', body: { opponentId: id } });
    closeSheet();
    if (b.essence && S.wallet) { S.wallet.essence += b.essence; renderWallet(); saveSnapshot(); }
    await playBattle(b);
  } catch (e) { toast(e.message, true); btn.disabled = false; btn.textContent = 'Lancer le combat'; }
}

async function openBattle(id) {
  try { await playBattle(await api(`/capsules/battles/${id}`)); } catch (e) { toast(e.message, true); }
}

// Rejeu animé : carte vue de dessus, jetons des champions, effets et annonces façon jeu ; « Passer » saute à la fin.
const replay = { skip: false, wake: () => {}, battle: null, speed: 1, spectator: false };
const bpause = (ms) => (replay.skip ? Promise.resolve() : new Promise((r) => { const t = setTimeout(r, ms / replay.speed); replay.wake = () => { clearTimeout(t); r(); }; }));

// Coordonnées en % de la carte pour le camp « me » (base en bas à gauche) ; le camp adverse est le miroir (x, y) → (y, x).
const MAP = {
  base: [10, 90],
  fountain: [[8, 86], [12, 86], [10, 90], [14, 90], [10, 94]],
  rest: [[9, 32], [28, 66], [40, 60], [70, 91], [64, 88]],
  duel: { top: { 0: [9, 17] }, mid: { 2: [45, 55] }, bot: { 3: [82, 91], 4: [77, 87] } },
  gank: { top: [12, 24], mid: [41, 52], bot: [73, 89] },
  pit: { dragon: [66, 66], ancient: [34, 34] },
  pitSide: { dragon: [[0, 0], [61, 71], [0, 0], [0, 0], [57, 74]], ancient: [[0, 0], [29, 39], [0, 0], [0, 0], [25, 42]] },
  fight: { 'fight-dragon': [66, 66], 'fight-mid': [50, 50], 'fight-ancient': [34, 34] },
  cluster: [[-7, 3], [-3, 7], [-10, 9], [-5, 12], [-12, 14]],
  siege: [[-14, 4], [-10, 9], [-6, 13], [-17, 10], [-12, 16]],
  towers: [['top', [9, 36]], ['top', [9, 60]], ['mid', [38, 62]], ['mid', [26, 74]], ['bot', [64, 91]], ['bot', [40, 91]]],
  nexus: [16, 84],
};
const LANE_OF_ROLE = ['top', null, 'mid', 'bot', 'bot'];
const mirror = ([x, y]) => [y, x];
const P = (k, pt) => (k === 'me' ? pt : mirror(pt));
const add = ([x, y], [dx, dy]) => [x + dx, y + dy];
const champIcon = (u) => `${CD}v1/champion-icons/${u.kind === 'CHAMPION' ? u.itemId : Math.floor(u.itemId / 1000)}.png`;

// Particules de la carte (étincelles, ondes de choc, traits, débris).
const bfx = {
  c: null, ctx: null, parts: [], raf: 0, w: 0, h: 0,
  fit() {
    this.c = $('#b-fx'); this.ctx = this.c.getContext('2d');
    const r = $('#b-map').getBoundingClientRect(); const d = devicePixelRatio || 1;
    this.w = r.width; this.h = r.height; this.c.width = r.width * d; this.c.height = r.height * d; this.ctx.setTransform(d, 0, 0, d, 0, 0);
  },
  px([x, y]) { return [(x / 100) * this.w, (y / 100) * this.h]; },
  burst(pt, color, n = 26, power = 1) {
    if (replay.skip) return;
    const [x, y] = this.px(pt);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2; const v = (1 + Math.random() * 3.5) * power;
      this.parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 1, decay: 0.02 + Math.random() * 0.03, size: 1 + Math.random() * 2.4, color: Math.random() < 0.3 ? '#fff' : color });
    }
    this.parts.push({ ring: true, x, y, r: 4, life: 1, color, power });
    this.run();
  },
  slash(a, b, color) {
    if (replay.skip) return;
    const [x1, y1] = this.px(a); const [x2, y2] = this.px(b);
    this.parts.push({ line: true, x1, y1, x2, y2, life: 1, color });
    this.run();
  },
  debris(pt, color) {
    if (replay.skip) return;
    const [x, y] = this.px(pt);
    for (let i = 0; i < 22; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.4; const v = 1 + Math.random() * 3;
      this.parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, g: 0.12, life: 1, decay: 0.018, size: 1.5 + Math.random() * 2.5, color: Math.random() < 0.5 ? '#8a94a6' : color, square: true });
    }
    this.run();
  },
  run() { if (!this.raf) this.raf = requestAnimationFrame(() => this.loop()); },
  loop() {
    const { ctx } = this;
    ctx.clearRect(0, 0, this.w, this.h);
    ctx.globalCompositeOperation = 'lighter';
    this.parts = this.parts.filter((p) => p.life > 0);
    for (const p of this.parts) {
      ctx.globalAlpha = Math.max(0, p.life);
      if (p.ring) {
        p.r += 2.2 * p.power; p.life -= 0.04;
        ctx.strokeStyle = p.color; ctx.lineWidth = 1 + 3 * p.life;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.stroke();
      } else if (p.line) {
        p.life -= 0.06;
        ctx.strokeStyle = p.color; ctx.lineWidth = 1 + 4 * p.life; ctx.shadowColor = p.color; ctx.shadowBlur = 12;
        ctx.beginPath(); ctx.moveTo(p.x1, p.y1); ctx.lineTo(p.x2, p.y2); ctx.stroke(); ctx.shadowBlur = 0;
      } else {
        p.vx *= 0.95; p.vy = p.vy * 0.95 + (p.g || 0); p.x += p.vx; p.y += p.vy; p.life -= p.decay;
        ctx.fillStyle = p.color;
        if (p.square) ctx.fillRect(p.x, p.y, p.size, p.size);
        else { ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (0.4 + p.life), 0, Math.PI * 2); ctx.fill(); }
      }
    }
    ctx.globalAlpha = 1;
    this.raf = this.parts.length ? requestAnimationFrame(() => this.loop()) : 0;
    if (!this.raf) ctx.clearRect(0, 0, this.w, this.h);
  },
};

const TEAM_COLOR = { me: '#19e3ff', them: '#ff3366' };
const R = {};

function token(k, role) { return R.tok[k][role]; }
function at(k, role) { return R.pos[k][role]; }
function move(k, role, pt) {
  R.pos[k][role] = pt;
  const el = token(k, role);
  el.style.left = `${pt[0]}%`; el.style.top = `${pt[1]}%`;
}
function die(k, role, color) {
  if (!R.alive[k][role]) return;
  R.alive[k][role] = false;
  token(k, role).classList.add('dead');
  bfx.burst(at(k, role), color || TEAM_COLOR[k === 'me' ? 'them' : 'me'], 30, 1.1);
}
function revive(k, role, pt) {
  if (R.alive[k][role]) return;
  R.alive[k][role] = true;
  const el = token(k, role);
  el.classList.remove('dead');
  move(k, role, P(k, MAP.fountain[role]));
  if (pt) setTimeout(() => move(k, role, pt), 60);
}
function reviveAll(toRest = true) {
  for (const k of ['me', 'them']) for (let r = 0; r < 5; r++) revive(k, r, toRest ? P(k, MAP.rest[r]) : null);
}
function pulse(k, role, cls = 'cast') {
  const el = token(k, role); el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls);
}
function shake(strong = false) {
  if (replay.skip) return;
  const s = $('#b-stage'); s.classList.remove('shake', 'shake-hard'); void s.offsetWidth; s.classList.add(strong ? 'shake-hard' : 'shake');
}

function announce(title, sub = '', tone = 'me', ms = 1400) {
  if (replay.skip) return;
  const el = $('#b-announce');
  el.className = `announce ${tone}`; el.innerHTML = `<b>${esc(title)}</b>${sub ? `<span>${esc(sub)}</span>` : ''}`;
  el.hidden = false; void el.offsetWidth; el.classList.add('go');
  clearTimeout(R.announceT); R.announceT = setTimeout(() => { el.hidden = true; }, ms / replay.speed);
}

function callout(k, role, ev) {
  if (replay.skip) return;
  const u = R.units[k][role];
  const el = $('#b-callout');
  el.className = `callout ${k}`;
  el.innerHTML = `<span class="co-ico">${ev.icon ? `<img src="${esc(ev.icon)}" alt="">` : ''}</span>
    <span class="co-txt"><em>${esc(u.champion)}</em><b>${esc(u.talent?.spell || 'Talent')}</b></span>`;
  el.hidden = false; void el.offsetWidth; el.classList.add('go');
  clearTimeout(R.calloutT); R.calloutT = setTimeout(() => { el.hidden = true; }, 1300 / replay.speed);
}

function feed(html, k) {
  const li = document.createElement('li');
  li.className = `kf ${k}`; li.innerHTML = html;
  const list = $('#b-feed'); list.prepend(li);
  while (list.children.length > 4) list.lastChild.remove();
}
const face = (k, role) => `<img class="kf-face ${k}" src="${esc(champIcon(R.units[k][role]))}" alt="">`;
const KF_ICON = {
  kill: '<svg viewBox="0 0 24 24"><use href="#cls-FIGHTER"/></svg>', tower: '<svg viewBox="0 0 24 24"><use href="#ico-tower"/></svg>',
  dragon: '<svg viewBox="0 0 24 24"><use href="#cls-MAGE"/></svg>', fight: '<svg viewBox="0 0 24 24"><use href="#ico-arena"/></svg>',
};

/** Fait tomber les tours gagnées depuis l'événement précédent, de préférence dans la lane indiquée ; nexus à la fin. */
function updateTowers(ev, prev) {
  for (const side of ['A', 'B']) {
    const now = side === 'A' ? ev.towersA : ev.towersB;
    const before = side === 'A' ? prev.towersA : prev.towersB;
    const victim = (side === R.me) ? 'them' : 'me';
    for (let i = 0; i < now - before; i++) {
      const lane = ['top', 'mid', 'bot'].includes(ev.place) ? ev.place : null;
      const list = R.towers[victim];
      const t = list.find((x) => !x.down && x.lane === lane) || list.find((x) => !x.down);
      if (!t) break;
      t.down = true; t.el.classList.add('down');
      bfx.debris(t.pt, TEAM_COLOR[victim]);
      if (!replay.skip) audio.tone(120, 0.3, 'square', 0.05);
    }
  }
}

function scoreboard(ev) {
  const [km, kt, tm, tt, gm, gt] = R.me === 'A'
    ? [ev.killsA, ev.killsB, ev.towersA, ev.towersB, ev.goldA, ev.goldB] : [ev.killsB, ev.killsA, ev.towersB, ev.towersA, ev.goldB, ev.goldA];
  const bump = (sel, v) => { const n = $(sel); if (n.textContent !== String(v)) { n.textContent = v; n.classList.remove('bump'); void n.offsetWidth; n.classList.add('bump'); } };
  bump('#b-k-me', km); bump('#b-k-them', kt);
  $('#b-t-me').textContent = tm; $('#b-t-them').textContent = tt;
  $('#b-g-me').textContent = gm.toFixed(1); $('#b-g-them').textContent = gt.toFixed(1);
  $('#b-g-fill').style.width = `${gm + gt ? (gm / (gm + gt)) * 100 : 50}%`;
  $('#b-clock').textContent = `${String(ev.minute).padStart(2, '0')}:00`;
}

/** Les deux équipes se regroupent autour du lieu du teamfight. */
async function enterFight(place) {
  R.fight = place;
  reviveAll(false);
  const c = MAP.fight[place] || [50, 50];
  for (const k of ['me', 'them']) for (let r = 0; r < 5; r++) {
    const off = MAP.cluster[r];
    move(k, r, P(k, add(c, off)));
  }
  await bpause(800);
}

async function stepEvent(ev, prev) {
  const k = ev.side === R.me ? 'me' : 'them';
  const o = k === 'me' ? 'them' : 'me';
  const place = ev.place;
  const color = TEAM_COLOR[k];
  const viewerWins = k === 'me';

  if (place?.startsWith('fight-')) { if (R.fight !== place) await enterFight(place); }
  else if (place) {
    if (R.fight) R.fight = null;
    reviveAll(true);
  }

  switch (ev.kind) {
    case 'GANK':
      if (ev.actor != null && MAP.gank[place]) { move(k, ev.actor, P(k, MAP.gank[place])); pulse(k, ev.actor, 'dash'); }
      await bpause(650);
      break;
    case 'KILL':
    case 'FIRST_BLOOD': {
      if (ev.actor == null) { await bpause(700); break; }
      const duel = MAP.duel[place] || {};
      for (const [role, pt] of Object.entries(duel)) { move('me', +role, pt); move('them', +role, mirror(pt)); }
      await bpause(500);
      const target = at(o, ev.target);
      const from = at(k, ev.actor);
      move(k, ev.actor, [from[0] + (target[0] - from[0]) * 0.6, from[1] + (target[1] - from[1]) * 0.6]);
      pulse(k, ev.actor, 'dash');
      await bpause(220);
      bfx.slash(at(k, ev.actor), target, color);
      die(o, ev.target, color);
      shake();
      if (!replay.skip) { audio.tone(viewerWins ? 700 : 220, 0.14, 'sawtooth', 0.08); buzz(30); }
      feed(`${face(k, ev.actor)}${ev.icon ? `<img class="kf-spell" src="${esc(ev.icon)}" alt="">` : KF_ICON.kill}${face(o, ev.target)}`, k);
      if (ev.kind === 'FIRST_BLOOD') announce('Premier sang', R.units[k][ev.actor].champion, k, 1500);
      await bpause(900);
      break;
    }
    case 'TALENT': {
      const actor = ev.actor;
      if (actor == null) { await bpause(800); break; }
      callout(k, actor, ev);
      pulse(k, actor, 'cast');
      bfx.burst(at(k, actor), '#ffc94d', 18, 0.7);
      if (!replay.skip) { audio.tone(880, 0.16, 'sine', 0.09); audio.tone(1320, 0.22, 'sine', 0.06, 0.08); }
      if (ev.target != null) {
        await bpause(350);
        bfx.slash(at(k, actor), at(o, ev.target), '#ffc94d');
        die(o, ev.target, '#ffc94d');
        feed(`${face(k, actor)}<img class="kf-spell" src="${esc(ev.icon || '')}" alt="">${face(o, ev.target)}`, k);
      } else if (MAP.gank[place]) {
        move(k, actor, P(k, MAP.gank[place]));
        feed(`${face(k, actor)}<img class="kf-spell" src="${esc(ev.icon || '')}" alt=""><span class="kf-txt">${esc(place)}</span>`, k);
      } else if (MAP.pit[place]) {
        await objective(k, place, actor, ev);
        break;
      } else {
        feed(`${face(k, actor)}<img class="kf-spell" src="${esc(ev.icon || '')}" alt=""><span class="kf-txt">${esc(R.units[k][actor].talent?.spell || '')}</span>`, k);
      }
      await bpause(1100);
      break;
    }
    case 'OBJECTIVE':
      await objective(k, place, ev.actor ?? 1, ev);
      break;
    case 'TOWER':
      if (ev.actor != null && MAP.gank[place]) move(k, ev.actor, P(k, MAP.gank[place]));
      feed(`${face(k, ev.actor ?? 0)}${KF_ICON.tower}<span class="kf-txt">${esc(place || '')}</span>`, k);
      await bpause(250);
      break;
    case 'FIGHT': {
      if (!replay.skip) { audio.burst(2); buzz([40, 30, 80]); }
      for (let i = 0; i < 3; i++) {
        const a = R.alive.me.findIndex(Boolean); const b = R.alive.them.findIndex(Boolean);
        if (a >= 0 && b >= 0) bfx.slash(at('me', a), at('them', b), i % 2 ? TEAM_COLOR.them : TEAM_COLOR.me);
        bfx.burst(MAP.fight[place] || [50, 50], i % 2 ? TEAM_COLOR.them : TEAM_COLOR.me, 20, 1.3);
        shake(i === 2);
        await bpause(240);
      }
      for (const r of ev.down || []) { die(o, r, color); await bpause(170); }
      for (const r of ev.lost || []) { die(k, r, TEAM_COLOR[o]); await bpause(170); }
      const won = (ev.down || []).length;
      announce(viewerWins ? 'Teamfight gagné' : 'Teamfight perdu', `${won} à ${(ev.lost || []).length}`, k, 1500);
      feed(`${KF_ICON.fight}<span class="kf-txt">Teamfight ${won}–${(ev.lost || []).length}</span>`, k);
      await bpause(1300);
      break;
    }
    case 'ACE':
      announce('Ace', viewerWins ? 'Toute l\'équipe adverse est à terre' : 'Toute ton équipe est à terre', k, 1500);
      shake(true);
      if (!replay.skip) audio.burst(3);
      await bpause(1200);
      break;
    case 'END': {
      R.fight = null;
      reviveAll(false);
      const enemyBase = P(o, MAP.base);
      for (let r = 0; r < 5; r++) if (R.alive[k][r]) move(k, r, P(k, add(mirror(MAP.base), MAP.siege[r])));
      await bpause(900);
      R.nexus[o].classList.add('down');
      bfx.burst(enemyBase, TEAM_COLOR[o], 90, 2.2);
      bfx.debris(enemyBase, TEAM_COLOR[o]);
      shake(true);
      if (!replay.skip) { audio.burst(5); buzz([80, 40, 160]); }
      await bpause(900);
      break;
    }
    default:
      await bpause(600);
  }
  updateTowers(ev, prev);
  scoreboard(ev);
}

/** Objectif neutre : les deux jungles (et supports) se ruent sur la fosse, le vainqueur l'emporte. */
async function objective(k, place, actor, ev) {
  const pit = MAP.pit[place] || MAP.pit.dragon;
  const sides = MAP.pitSide[place] || MAP.pitSide.dragon;
  for (const side of ['me', 'them']) for (const r of [1, 4]) move(side, r, P(side, sides[r]));
  const icon = $(place === 'ancient' ? '#b-ancient' : '#b-dragon');
  icon.classList.remove('taken', 'me', 'them'); icon.classList.add('contest');
  await bpause(700);
  if (actor !== 1 && actor !== 4) move(k, actor, add(P(k, sides[1]), [2, -2]));
  bfx.burst(pit, TEAM_COLOR[k], 50, 1.6);
  icon.classList.remove('contest'); icon.classList.add('taken', k);
  shake();
  if (!replay.skip) audio.chime(3);
  if (ev.kind === 'TALENT') callout(k, actor, ev);
  announce(place === 'ancient' ? 'Gardien ancien' : 'Dragon', `${R.units[k][actor].champion} · ${k === 'me' ? (R.spectatorNames ? R.spectatorNames.me : 'ton équipe') : (R.spectatorNames ? R.spectatorNames.them : 'équipe adverse')}`, k, 1300);
  feed(`${face(k, actor)}${KF_ICON.dragon}<span class="kf-txt">${place === 'ancient' ? 'Gardien ancien' : 'Dragon'}</span>`, k);
  await bpause(1000);
}

function buildMap(mine, theirs) {
  R.units = { me: mine.units, them: theirs.units };
  R.tok = { me: [], them: [] }; R.pos = { me: [], them: [] }; R.alive = { me: [], them: [] };
  R.towers = { me: [], them: [] }; R.nexus = {}; R.fight = null;
  const towers = $('#b-towers'); const tokens = $('#b-tokens');
  towers.innerHTML = ''; tokens.innerHTML = '';
  for (const k of ['me', 'them']) {
    for (const [lane, pt0] of MAP.towers) {
      const pt = P(k, pt0);
      const el = document.createElement('span');
      el.className = `tower ${k}`; el.style.left = `${pt[0]}%`; el.style.top = `${pt[1]}%`;
      el.innerHTML = '<svg viewBox="0 0 24 24"><use href="#ico-tower"/></svg>';
      towers.append(el);
      R.towers[k].push({ el, lane, pt, down: false });
    }
    const n = P(k, MAP.nexus);
    const nexus = document.createElement('span');
    nexus.className = `nexus ${k}`; nexus.style.left = `${n[0]}%`; nexus.style.top = `${n[1]}%`;
    towers.append(nexus); R.nexus[k] = nexus;
    R.units[k].forEach((u, r) => {
      const el = document.createElement('span');
      el.className = `token ${k} r-${u.rarity}`;
      el.innerHTML = `<img src="${esc(champIcon(u))}" alt="${esc(u.champion)}"><i class="skull"></i>`;
      tokens.append(el);
      R.tok[k][r] = el; R.alive[k][r] = true;
      move(k, r, P(k, MAP.fountain[r]));
    });
  }
  $('#b-dragon').className = 'pit-icon dragon';
  $('#b-ancient').className = 'pit-icon ancient';
}

/** Rejoue un combat ; en spectateur (lien partagé), l'attaquant est à gauche et rien n'est « à toi ». */
async function playBattle(b, { spectator = false } = {}) {
  replay.battle = b; replay.spectator = spectator;
  const mineA = spectator || b.attacker.userId === S.user?.id;
  R.me = mineA ? 'A' : 'B';
  const [mine, theirs] = mineA ? [b.a, b.b] : [b.b, b.a];
  const [pMe, pThem] = mineA ? [b.attacker, b.defender] : [b.defender, b.attacker];
  R.spectatorNames = spectator ? { me: pMe.displayName, them: pThem.displayName } : null;
  const won = mineA === b.attackerWon;
  const el = $('#battle');
  el.hidden = false; el.className = `battle${spectator ? ' spectator' : ''}`;
  $('#b-me-av').innerHTML = avatarInner(pMe); $('#b-them-av').innerHTML = avatarInner(pThem);
  $('#b-me-name').textContent = spectator ? pMe.displayName : mineA ? 'Toi' : 'Toi (défense)'; $('#b-them-name').textContent = pThem.displayName;
  $('#b-share').hidden = true; $('#b-feed').innerHTML = ''; $('#b-end').hidden = true;
  $('#b-announce').hidden = true; $('#b-callout').hidden = true;
  $('#b-skip').hidden = false; $('#b-speed').hidden = false; $('#b-replay').hidden = true; $('#b-close').hidden = true;
  $('#b-speed').textContent = `×${replay.speed}`;
  buildMap(mine, theirs);
  bfx.fit(); bfx.parts = [];
  const zero = { minute: 0, killsA: 0, killsB: 0, towersA: 0, towersB: 0, goldA: 0, goldB: 0 };
  scoreboard(zero);
  replay.skip = false;

  await bpause(250);
  for (const k of ['me', 'them']) for (let r = 0; r < 5; r++) move(k, r, P(k, MAP.rest[r]));
  announce('Que le combat commence', `${pMe.displayName} contre ${pThem.displayName}`, 'neutral', 1500);
  await bpause(1400);

  let prev = zero;
  for (const ev of b.events) {
    if (el.hidden || replay.battle !== b) return;
    await stepEvent(ev, prev);
    prev = ev;
  }
  if (replay.battle !== b) return;
  if (replay.skip) { $('#b-announce').hidden = true; $('#b-callout').hidden = true; }

  // Écran de fin : résultat, gains et tableau des scores.
  const delta = pMe.ratingAfter - pMe.ratingBefore;
  const best = (units) => [...units].sort((x, y) => (y.kills * 2 - y.deaths) - (x.kills * 2 - x.deaths))[0];
  const winners = b.attackerWon ? b.a : b.b;
  const mvp = spectator ? best(winners.units) : best(mine.units);
  const rows = (units, k) => units.map((u, i) => `<div class="pg-row ${k}${u === mvp ? ' mvp' : ''}">
      <img src="${esc(champIcon(u))}" alt=""><span class="pg-name"><b>${esc(u.champion)}</b><em>${ROLES[i]}</em></span>
      ${u.talent?.icon ? `<img class="pg-talent" src="${esc(u.talent.icon)}" alt="" title="${esc(u.talent.spell)}">` : ''}
      <b class="pg-kd">${u.kills} / ${u.deaths}</b></div>`).join('');
  const title = spectator ? `Victoire de ${(b.attackerWon ? b.attacker : b.defender).displayName}` : won ? 'Victoire' : 'Défaite';
  $('#b-end').innerHTML = `<div class="pg-title ${spectator || won ? 'win' : 'loss'}">${esc(title)}</div>
    <div class="end-chips">
      ${spectator ? `<span class="chip">${b.minutes} min</span>` : `<span class="chip ${delta >= 0 ? 'up' : 'down'}">${signed(delta)} pts · ${pMe.ratingAfter}</span>`}
      ${!spectator && mineA && b.essence ? `<span class="chip ess">+${b.essence} essence</span>` : ''}
      <span class="chip gold">MVP · ${esc(mvp.champion)}</span></div>
    <div class="pg-board"><div class="pg-team me"><span class="kicker">${esc(spectator ? pMe.displayName : 'Ton équipe')}</span>${rows(mine.units, 'me')}</div>
      <div class="pg-team them"><span class="kicker">${esc(pThem.displayName)}</span>${rows(theirs.units, 'them')}</div></div>
    ${!spectator && mineA && won && !b.essence ? '<p class="muted">Essence du jour déjà empochée : la victoire compte pour la cote.</p>' : ''}
    ${!spectator && !won ? '<p class="muted">Regarde les vis-à-vis et les talents : un contre bien placé change tout.</p>' : ''}
    ${spectator && !S.token ? '<p class="muted">Ouvre des reliques, compose ton roster et défie tes amis.</p>' : ''}`;
  $('#b-end').hidden = false;
  el.classList.add(spectator || won ? 'won' : 'lost');
  if (spectator || won) { audio.chime(5); buzz([60, 40, 120]); } else { audio.tone(150, 0.6, 'sawtooth', 0.08); buzz(90); }
  $('#b-skip').hidden = true; $('#b-speed').hidden = true; $('#b-replay').hidden = false; $('#b-close').hidden = false;
  $('#b-close').textContent = spectator && !S.token ? 'Jouer aussi' : 'Continuer';
  $('#b-share').hidden = spectator;
}

function closeBattle() {
  $('#battle').hidden = true;
  const wasSpectator = replay.spectator;
  replay.battle = null; replay.skip = true; replay.wake(); replay.spectator = false;
  if (new URLSearchParams(location.search).has('replay')) history.replaceState(null, '', location.pathname);
  if (wasSpectator && !S.token) { showAuth(); return; }
  if (S.view === 'arena') loadArena();
}

/** Lien public du combat : partage natif, sinon copie dans le presse-papiers. */
async function shareBattle() {
  const b = replay.battle; if (!b) return;
  try {
    const { code } = await api(`/capsules/battles/${b.id}/share`, { method: 'POST' });
    const url = `${location.origin}/reliques/?replay=${encodeURIComponent(code)}`;
    const title = `${b.attacker.displayName} contre ${b.defender.displayName}`;
    if (navigator.share) { try { await navigator.share({ title, text: `Regarde ce combat : ${title}`, url }); return; } catch (e) { if (e.name === 'AbortError') return; } }
    await navigator.clipboard.writeText(url);
    toast('Lien du replay copié');
  } catch (e) { toast(e.message, true); }
}

/** Replay partagé (?replay=code) : visible sans compte. */
async function openSharedReplay(code) {
  try {
    if (!S.cat) await loadCatalog();
    const b = await api(`/replays/${encodeURIComponent(code)}`, { retry: true });
    const participant = S.user && (b.attacker.userId === S.user.id || b.defender.userId === S.user.id);
    await playBattle(b, { spectator: !participant });
  } catch (e) { toast(e.message, true); if (!S.token) showAuth(); }
}

function tierOf(rating) {
  const steps = [['MASTER', 1350], ['DIAMOND', 1250], ['PLATINUM', 1150], ['GOLD', 1050], ['SILVER', 950]];
  return (steps.find(([, min]) => rating >= min) || ['BRONZE'])[0];
}

/** Bilan de fin de saison : palier, rang et reliques reçues. */
function showSeasonEnd(r) {
  const rewards = [r.rewardStandard ? `+${r.rewardStandard} relique${r.rewardStandard > 1 ? 's' : ''}` : '', r.rewardPremium ? `+${r.rewardPremium} prestige` : '']
    .filter(Boolean).join(' · ');
  openSheet(`<div class="season-end" style="--tc:${TIER[r.tier].color}">
    <span class="kicker">Saison ${r.number} terminée</span>
    <div class="season-crest"><svg viewBox="0 0 64 64" aria-hidden="true"><path d="M32 4 56 14v18c0 14-10 24-24 28C18 56 8 46 8 32V14z"/></svg>${tierBadge(r.tier, true)}</div>
    <div class="facts"><div><b>#${r.rank}</b><span>Rang</span></div><div><b>${r.rating}</b><span>Cote finale</span></div><div><b>${r.wins} V · ${r.losses} D</b><span>Bilan</span></div></div>
    <p class="season-reward">${rewards ? `<b>${rewards}</b> ajoutées à ton stock` : `Joue au moins 5 combats dans une saison pour recevoir des reliques.`}</p>
    <p class="muted">Nouvelle saison : ta cote repart à mi-chemin de 1000. À toi de grimper !</p>
    <button class="btn primary big block" id="season-ok">${rewards ? 'Récupérer' : 'C\'est parti'}</button>
  </div>`);
  $('#season-ok').onclick = async () => {
    closeSheet();
    try {
      await api(`/capsules/seasons/${r.id}/seen`, { method: 'POST' });
      setWallet(await api('/capsules/state'));
      if (rewards) { audio.chime(5); buzz([60, 40, 120]); toast(`${rewards} : bonne ouverture !`); }
    } catch (e) { toast(e.message, true); }
  };
}

function showUnitTalent(role) {
  const u = S.arena?.team?.units[role]; if (!u?.talent) return;
  openSheet(`<div class="unit-sheet"><span class="kicker">${ROLES[u.role]} · ${fitLabel(u.fitPercent).toLowerCase()}</span><h2>${esc(u.champion)}</h2>
    ${profileHTML(u.profile, true)}${talentHTML(u.talent, true)}</div>`);
}

// ---------- Tuto (stories) ----------
const TUTO = [
  { kicker: 'L\'arène', title: 'Ton roster part au combat', text: 'Tes 5 champions affrontent ceux d\'un autre joueur, poste contre poste. Son roster se défend même quand il dort.', art: () => tutoRoster() },
  { kicker: 'Règle 1', title: 'Chacun à sa place', text: 'Chaque champion a un poste principal, parfois un secondaire. Tous les postes restent ouverts, mais hors poste il perd de la puissance.', art: () => tutoRoles() },
  { kicker: 'Règle 2', title: 'Early, mid ou late', text: 'Un champion early écrase les lanes, un late gagne les derniers teamfights. Les solos gagnent leurs duels, les teamfights brillent à cinq.', art: () => tutoCurves() },
  { kicker: 'Règle 3', title: 'Une vraie compo', text: 'Une frontline, des dégâts, de quoi protéger. Les tireurs font fondre les tanks, les assassins plongent sur les carrys mal protégés.', art: () => tutoClasses() },
  { kicker: 'Règle 4', title: 'Les bonus s\'empilent', text: 'Skins d\'une même gamme, comp teamfight, rareté : tout ajoute de la puissance.', art: () => tutoSynergy() },
  { kicker: 'Règle 5', title: 'Chaque champion a son talent', text: 'Le sort qui fait son identité change la partie : Destinée rejoint une autre lane, Retour temporel renverse un combat, Grappin attrape une cible.', art: () => tutoTalents() },
  { kicker: 'Le match', title: 'Lanes, dragons, teamfights', text: 'Gagner ses lanes rapporte de l\'or. L\'or et les dragons font pencher les teamfights. Le premier à 2 l\'emporte.', art: () => tutoTimeline() },
  { kicker: 'Récompenses', title: 'Grimpe et remplis ta forge', text: '2 victoires = 1 relique, jusqu\'à 4 victoires payées par jour. Un seul défi par joueur jusqu\'à sa riposte (ou 24 h).', art: () => tutoRewards() },
  { kicker: 'Saisons', title: 'Un mois, un classement', text: 'Grimpe de Bronze à Maître. En fin de mois, ton palier te rapporte des reliques, puis tout le monde repart pour une nouvelle saison.', art: () => tutoSeasons(), cta: 'Entrer dans l\'arène' },
];
const tuto = { i: 0, x: 0 };

function tutoRoster() {
  const slots = S.arena?.team?.units ?? S.roster.map((s) => s && { kind: s.kind, itemId: s.itemId });
  const arts = slots.map((s) => s && S.cat && item(s.kind, s.itemId));
  return `<div class="ta-roster">${ROLES.map((r, i) => `<span class="ta-card${arts[i] ? ` r-${arts[i].rarity}` : ''}" style="--i:${i}">
    ${arts[i] ? `<img src="${esc(arts[i].art)}" alt="">` : ''}<em>${r}</em></span>`).join('')}</div>
    <div class="ta-vs">VS</div>`;
}

function tutoRoles() {
  const rows = [['Poste principal', 'Leona support', '+12 %', 'up'], ['Poste secondaire', 'Malphite support', '+8 %', 'up'], ['Hors poste', 'Sion support', '−10 %', 'down']];
  return `<div class="ta-roles">${rows.map(([r, ex, v, c], i) => `<div class="ta-role" style="--i:${i}"><b>${r}</b><span><span class="ta-cls">${ex}</span><span class="fit ${c}">${v}</span></span></div>`).join('')}</div>`;
}

function tutoCurves() {
  const rows = [['EARLY', 'Lanes'], ['MID', 'Dragons et 1er teamfight'], ['LATE', 'Derniers teamfights']];
  return `<div class="ta-roles">${rows.map(([c, when], i) => `<div class="ta-role" style="--i:${i}"><b style="color:${CURVE[c].color}">${CURVE[c].label}</b><span><span class="ta-cls">${when}</span></span></div>`).join('')}</div>`;
}

function tutoClasses() {
  const rows = [['TANK', 'Encaisse assassins et combattants'], ['MARKSMAN', 'Fait fondre la frontline'], ['ASSASSIN', 'Plonge sur les carrys'], ['SUPPORT', 'Protège des assassins']];
  return `<div class="ta-roles">${rows.map(([c, t], i) => `<div class="ta-role" style="--i:${i}"><span class="ta-cls">${clsIcon(c)}${CLASS[c].label}</span><span><span class="ta-cls">${t}</span></span></div>`).join('')}</div>`;
}

function tutoSynergy() {
  const rows = [['Gamme ×3', '+6 %', 'var(--violet)'], ['Comp teamfight', '+5 %', 'var(--green)'], ['Exalté', '+12 %', 'var(--yellow)']];
  return `<div class="ta-syn">${rows.map(([l, v, c], i) => `<div class="ta-chip" style="--i:${i};--c:${c}"><span>${l}</span><b>${v}</b></div>`).join('')}
    <div class="ta-power"><span class="kicker">Puissance</span><i><i></i></i></div></div>`;
}

function tutoTalents() {
  const picks = [4, 26, 53].map((id) => S.cat?.champ.get(id)).filter((c) => c?.talent);
  return `<div class="ta-talents">${picks.map((c, i) => `<div class="ta-talent" style="--i:${i}">
    <span class="ta-portrait"><img src="${esc(`${DD}/loading/${c.alias}_0.jpg`)}" alt=""></span>
    <div><b>${esc(c.name)}</b>${talentHTML(c.talent, true)}</div></div>`).join('')}</div>`;
}

function tutoSeasons() {
  return `<div class="ta-tiers">${Object.keys(TIER).map((t, i) => `<span class="ta-tier" style="--i:${i};--tc:${TIER[t].color};--h:${30 + i * 13}%">${TIER[t].label}</span>`).join('')}</div>`;
}

function tutoTimeline() {
  const steps = [['3\'', 'Lanes', 'Duels et ganks'], ['12\'', 'Dragons', 'Bonus d\'équipe'], ['20\'', 'Teamfights', 'Premier à 2']];
  return `<div class="ta-time">${steps.map(([t, l, s], i) => `<div class="ta-step" style="--i:${i}"><span class="dot">${t}</span><b>${l}</b><span>${s}</span></div>`).join('')}</div>`;
}

function tutoRewards() {
  return `<div class="ta-rew">
    <div class="ta-eq"><span class="ta-win">V</span><span class="op">+</span><span class="ta-win">V</span><span class="op">=</span>
      <svg viewBox="0 0 64 64"><use href="#capsule-mini"/></svg></div>
    <div class="ta-elo"><span class="kicker">Cote</span><b>1000 → 1016</b></div>
    <div class="ta-podium"><i style="--h:60%"></i><i style="--h:90%"></i><i style="--h:40%"></i></div></div>`;
}

function showTuto() {
  tuto.i = 0;
  store.set(NEWS_KEY, '1');
  closeSheet();
  $('#tuto-track').innerHTML = TUTO.map((t, i) => `<section class="tuto-slide" data-slide="${i}">
    <div class="tuto-art">${t.art()}</div>
    <div class="tuto-copy"><span class="kicker">${t.kicker}</span><h2>${t.title}</h2><p>${t.text}</p></div></section>`).join('');
  $('#tuto-bars').innerHTML = TUTO.map(() => '<i><i></i></i>').join('');
  $('#tuto').hidden = false;
  tutoGo(0);
}

function tutoGo(i) {
  if (i >= TUTO.length) { closeTuto(); return; }
  tuto.i = Math.max(0, i);
  $$('.tuto-slide').forEach((s, k) => { s.classList.toggle('on', k === tuto.i); s.classList.toggle('past', k < tuto.i); });
  $$('#tuto-bars > i').forEach((b, k) => { b.className = k < tuto.i ? 'done' : k === tuto.i ? 'cur' : ''; });
  $('#tuto-prev').disabled = tuto.i === 0;
  $('#tuto-next').textContent = TUTO[tuto.i].cta || 'Suivant';
  buzz(10);
}

function closeTuto() {
  $('#tuto').hidden = true;
  store.set(TUTO_KEY, '1');
}

function bindArena() {
  $$('[data-arena]').forEach((b) => (b.onclick = () => { S.arenaTab = b.dataset.arena; renderArenaBody(); }));
  $('#tuto-btn').onclick = showTuto;
  $('#tuto-menu').onclick = () => { $('#menu').hidden = true; showTuto(); };
  $('#tuto-next').onclick = () => tutoGo(tuto.i + 1);
  $('#tuto-prev').onclick = () => tutoGo(tuto.i - 1);
  $('#tuto-x').onclick = closeTuto;
  // Toucher à droite avance, à gauche recule ; balayage horizontal.
  const track = $('#tuto-track');
  track.addEventListener('click', (e) => tutoGo(tuto.i + (e.clientX > innerWidth / 3 ? 1 : -1)));
  track.addEventListener('touchstart', (e) => { tuto.x = e.touches[0].clientX; }, { passive: true });
  track.addEventListener('touchend', (e) => {
    const dx = e.changedTouches[0].clientX - tuto.x;
    if (Math.abs(dx) > 50) { e.preventDefault(); tutoGo(tuto.i + (dx < 0 ? 1 : -1)); }
  });
  addEventListener('keydown', (e) => {
    if ($('#tuto').hidden) return;
    if (e.key === 'ArrowRight') tutoGo(tuto.i + 1);
    else if (e.key === 'ArrowLeft') tutoGo(tuto.i - 1);
    else if (e.key === 'Escape') closeTuto();
  });
  $('#b-skip').onclick = () => { replay.skip = true; replay.wake(); };
  $('#b-speed').onclick = () => { replay.speed = replay.speed === 1 ? 2 : 1; $('#b-speed').textContent = `×${replay.speed}`; };
  addEventListener('resize', () => { if (!$('#battle').hidden) bfx.fit(); });
  $('#b-replay').onclick = () => replay.battle && playBattle(replay.battle);
  $('#b-close').onclick = closeBattle;
  $('#b-share').onclick = shareBattle;
  $('#arena-team').addEventListener('click', (e) => { const u = e.target.closest('[data-unit]'); if (u) showUnitTalent(+u.dataset.unit); });
}

// ---------- Navigation ----------
function setView(v, { friend = false } = {}) {
  // Quitter la collection d'un ami : retour à la sienne.
  if (!friend) S.friend = null;
  S.view = v;
  $('#view-open').hidden = v !== 'open';
  $('#view-collection').hidden = v !== 'collection';
  $('#view-friends').hidden = v !== 'friends';
  $('#view-arena').hidden = v !== 'arena';
  const tab = friend ? 'friends' : v;
  $$('[data-view]').forEach((b) => (b.dataset.view === tab ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current')));
  if (v === 'collection') {
    $('#owner-bar').hidden = !S.friend;
    if (S.friend) { $('#owner-name').textContent = S.friend.name; $('#owner-follow').hidden = S.friend.added; }
    renderRoster();
    renderCollection();
  }
  if (v === 'friends') loadFriends();
  if (v === 'arena') {
    if (S.arena) { renderArenaHead(); renderArenaTeam(); renderArenaBody(); }
    // Tuto à la première visite, une fois le roster connu (ses cartes illustrent la première story).
    loadArena().then(() => { if (!store.get(TUTO_KEY) && S.view === 'arena' && $('#tuto').hidden) showTuto(); });
  }
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

const NEWS_KEY = 'capsules.news.arena-v3';

async function maybeShowNews() {
  if (store.get(NEWS_KEY) || !$('#tuto').hidden) return;
  store.set(NEWS_KEY, '1');
  openSheet(`<div class="news">
    <span class="kicker">Nouveau</span>
    <h2>Arène : nouveau système de combat</h2>
    <div class="news-item"><b>Postes par champion</b><span>Chaque champion a son poste principal et parfois un secondaire. Un tank au support ne suffit plus.</span></div>
    <div class="news-item"><b>Early, mid, late · solo ou teamfight</b><span>Les lanes, les dragons et les derniers combats ne récompensent pas les mêmes champions.</span></div>
    <div class="news-item"><b>Un talent par champion</b><span>Chaque champion combat avec le sort qui fait son identité : Destinée, Requiem, Retour temporel…</span></div>
    <button class="btn primary block" data-news-go="arena">Entrer dans l'arène</button>
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
    const res = await api(`/auth/${registering ? 'register' : 'login'}`, { method: 'POST', body, retry: !registering });
    S.token = res.token; S.user = res.user;
    store.set('capsules.token', res.token); store.set('capsules.user', JSON.stringify(res.user));
    await start();
  } catch (err) { $('#auth-error').textContent = err.message; }
  finally { $('#auth-submit').disabled = false; }
}

async function logout() {
  try { const sub = await currentSub(); if (sub && S.token) await fetch(`${API}/capsules/push/unsubscribe`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${S.token}` }, body: JSON.stringify({ endpoint: sub.endpoint }) }); } catch { /* best effort */ }
  store.del(snapKey());
  S.token = null; S.user = null; S.owned.clear(); S.recent = []; S.friend = null;
  store.del('capsules.token'); store.del('capsules.user');
  $('#menu').hidden = true;
  showAuth();
}

const snapKey = () => `capsules.snapshot.${S.user?.id}`;

function saveSnapshot() {
  if (!S.wallet || !S.user) return;
  const { nextAtMs, ...wallet } = S.wallet;
  store.set(snapKey(), JSON.stringify({ wallet: { ...wallet, nextAt: nextAtMs ? new Date(nextAtMs).toISOString() : null, serverTime: new Date(now()).toISOString() },
    items: [...S.owned.values()], recent: S.recent.slice(0, 30), roster: S.roster }));
}

function applyCollection(coll) {
  S.owned = new Map(coll.items.map((i) => [`${i.kind}:${i.itemId}`, i]));
  S.recent = coll.recent;
  S.roster = coll.roster;
}

function renderAll() {
  renderRecent();
  renderOdds();
  if (S.view === 'collection') { renderRoster(); renderCollection(); }
}

async function start() {
  $('#auth').hidden = true; $('#app').hidden = false;
  $('#menu-user').innerHTML = `<b>${esc(S.user?.displayName)}</b>${esc(S.user?.email)}`;
  // Dernier état connu (et catalogue en cache) affichés tout de suite ; ouvertures bloquées jusqu'à la réponse du serveur.
  S.online = false;
  const snap = JSON.parse(store.get(snapKey()) || 'null');
  const cached = JSON.parse(store.get(CATALOG_KEY) || 'null');
  if (snap && cached) {
    S.cat ||= indexCatalog(cached.data);
    applyCollection(snap);
    setWallet(snap.wallet);
    renderAll();
  }
  try {
    const [state, coll] = await Promise.all([api('/capsules/state', { retry: true }), api('/capsules/collection', { retry: true }), loadCatalog()]);
    S.online = true;
    applyCollection(coll);
    setWallet(state);
    renderAll();
    saveSnapshot();
    if (S.view !== 'arena') loadArena({ quiet: true });
  } catch (e) {
    toast(e.message, true);
    // Nouvelle tentative au prochain retour sur l'app.
    S.retryStart = true;
  }
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
    if (e.target.closest('#coach-optimize')) { showOptimize(); return; }
    const foe = e.target.closest('[data-foe]');
    if (foe) { openFoe(foe.dataset.foe); return; }
    const fight = e.target.closest('[data-battle]');
    if (fight) { openBattle(fight.dataset.battle); return; }
    const go = e.target.closest('[data-goto]');
    if (go) { closeSheet(); setView(go.dataset.goto); return; }
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
  bindArena();
  $('#owner-follow').onclick = async () => {
    const p = await addFriend({ userId: S.friend.userId });
    if (p) { S.friend.added = true; $('#owner-follow').hidden = true; }
  };
  $('#sheet').addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeSheet(); });
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && $('#tuto').hidden) closeSheet(); });

  $$('.coll-controls .segmented button').forEach((b) => (b.onclick = () => { S.coll.group = b.dataset.group; if (b.dataset.group !== 'rarity') S.coll.rarity = null; syncSegmented(); renderCollection(); }));
  let t;
  $('#search').addEventListener('input', (e) => { clearTimeout(t); t = setTimeout(() => { S.coll.q = e.target.value; renderCollection(); }, 150); });
  $('#show-missing').addEventListener('change', (e) => { S.coll.missing = e.target.checked; renderCollection(); });
  $('#role-chips').addEventListener('click', (e) => {
    const b = e.target.closest('[data-role-filter]'); if (!b) return;
    S.coll.role = b.dataset.roleFilter === '' ? null : +b.dataset.roleFilter;
    $$('#role-chips button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    renderCollection();
  });
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

  $('#update-go').onclick = applyUpdate;
  addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    checkVersion();
    if (!S.token) return;
    if (S.retryStart) { S.retryStart = false; start(); return; }
    api('/capsules/state', { retry: true }).then((w) => { S.online = true; setWallet(w); saveSnapshot(); }).catch(() => {});
  });
}

function syncSegmented() { $$('.coll-controls .segmented button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.group === S.coll.group))); }

// ---------- Démarrage ----------
fetch('/health', { cache: 'no-store' }).catch(() => {});
checkVersion();
fx.init();
bind();
setupInstall();
setInterval(tick, 1000);
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js', { scope: './' }).catch(() => {});
const params = new URLSearchParams(location.search);
const startView = params.get('view');
if (startView === 'collection' || startView === 'arena') S.view = startView;
if (S.token) { start(); setView(S.view); } else showAuth();
if (params.get('replay')) openSharedReplay(params.get('replay'));
